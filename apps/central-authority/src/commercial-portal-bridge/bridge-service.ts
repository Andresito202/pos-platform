import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import {
  assertSafeCommercialPortalCallbackOrigin,
  CommercialPortalIntrospectRequestSchema,
  CommercialPortalMintRequestSchema,
  CommercialPortalMintResponseSchema,
  CommercialPortalIntrospectResponseSchema,
  CommercialProvisioningRequestSchema,
  CommercialProvisioningResponseSchema,
  CommercialTrialIssueRequestSchema,
  CommercialTrialIssueResponseSchema,
  CommercialTrialExpireSweepResponseSchema,
  COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER,
} from "@pos-platform/contracts";
import type { VerifiedGlobalSession } from "./global-session-gate.js";

export type BridgeRole = "SUPERADMIN_GLOBAL";

export type PortalSession = {
  tokenHash: string;
  role: BridgeRole;
  subjectId: string;
  tenantId: "global";
  authority: "GLOBAL";
  expiresAt: Date;
  revokedAt: Date | null;
  /** Underlying GLOBAL MFA session — required for identity. */
  globalSessionId: string;
};

export type TrialLicense = {
  centralLicenseRef: string;
  trialId: string;
  email: string;
  contractStatus: "TRIAL" | "EXPIRED" | "REVOKED";
  startsAt: Date;
  expiresAt: Date;
  commercialApiOrigin: string;
  revokedAt: Date | null;
  activationDelivery?: "PENDING" | "ACTIVATED" | "CALLBACK_FAILED";
};

export type ProvisioningRecord = {
  provisioningId: string;
  idempotencyKey: string;
  orderId: string;
  licenseUnits: number;
  payload: unknown;
  payloadHash: string;
  createdAt: Date;
  tenantId?: string | null;
  licenseIds?: string[];
  fulfillment?: "QUEUED" | "ISSUED" | "ALREADY_QUEUED" | "ALREADY_ISSUED";
};

export type ReplayRecord = { jti: string; purpose: string; usedAt: Date; expiresAt: Date };

export interface CommercialPortalBridgeStore {
  putSession(session: PortalSession): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<PortalSession | null>;
  putTrial(trial: TrialLicense): Promise<void>;
  getTrialByTrialId(trialId: string): Promise<TrialLicense | null>;
  getTrialByLicenseRef(ref: string): Promise<TrialLicense | null>;
  listExpiredActiveTrials(now: Date): Promise<TrialLicense[]>;
  updateTrial(trial: TrialLicense): Promise<void>;
  putProvisioning(row: ProvisioningRecord): Promise<void>;
  getProvisioningByIdempotency(key: string): Promise<ProvisioningRecord | null>;
  claimJti(record: ReplayRecord): Promise<"CLAIMED" | "REPLAY">;
}

/** Optional hook to issue real licensing.licenses rows for trials/provisioning. */
export interface CommercialLicenseIssuer {
  issueTrialLicense(input: {
    trialId: string;
    email: string;
    startsAt: Date;
    expiresAt: Date;
    tenantId?: string;
    planId?: string;
  }): Promise<{ licenseId: string }>;
  revokeTrialLicense(licenseId: string, reason: string): Promise<void>;
  issueProvisioningLicenses(input: {
    orderId: string;
    licenseUnits: number;
    tenantId: string;
    planId: string;
    payloadHash: string;
  }): Promise<{ licenseIds: string[] }>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** In-memory store — unit tests / standalone lab only. Forbidden in production mount. */
export class MemoryCommercialPortalBridgeStore implements CommercialPortalBridgeStore {
  private readonly sessions = new Map<string, PortalSession>();
  private readonly trialsById = new Map<string, TrialLicense>();
  private readonly trialsByRef = new Map<string, TrialLicense>();
  private readonly provisioning = new Map<string, ProvisioningRecord>();
  private readonly jtis = new Map<string, ReplayRecord>();

  async putSession(session: PortalSession): Promise<void> {
    if (!session.globalSessionId) throw new Error("COMMERCIAL_BRIDGE_GLOBAL_SESSION_REQUIRED");
    this.sessions.set(session.tokenHash, session);
  }
  async getSessionByTokenHash(tokenHash: string): Promise<PortalSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }
  async putTrial(trial: TrialLicense): Promise<void> {
    this.trialsById.set(trial.trialId, trial);
    this.trialsByRef.set(trial.centralLicenseRef, trial);
  }
  async getTrialByTrialId(trialId: string): Promise<TrialLicense | null> {
    return this.trialsById.get(trialId) ?? null;
  }
  async getTrialByLicenseRef(ref: string): Promise<TrialLicense | null> {
    return this.trialsByRef.get(ref) ?? null;
  }
  async listExpiredActiveTrials(now: Date): Promise<TrialLicense[]> {
    return [...this.trialsById.values()].filter(
      (t) => t.contractStatus === "TRIAL" && t.expiresAt.getTime() <= now.getTime() && !t.revokedAt,
    );
  }
  async updateTrial(trial: TrialLicense): Promise<void> {
    await this.putTrial(trial);
  }
  async putProvisioning(row: ProvisioningRecord): Promise<void> {
    this.provisioning.set(row.idempotencyKey, row);
  }
  async getProvisioningByIdempotency(key: string): Promise<ProvisioningRecord | null> {
    return this.provisioning.get(key) ?? null;
  }
  async claimJti(record: ReplayRecord): Promise<"CLAIMED" | "REPLAY"> {
    const existing = this.jtis.get(`${record.purpose}:${record.jti}`);
    if (existing && existing.expiresAt.getTime() > Date.now()) return "REPLAY";
    this.jtis.set(`${record.purpose}:${record.jti}`, record);
    return "CLAIMED";
  }
}

export type CommercialPortalBridgeConfig = {
  bridgeKey: string;
  trialWebhookKey: string;
  fetchImpl?: typeof fetch;
  /** When set, trial/provisioning write real license rows. */
  licenseIssuer?: CommercialLicenseIssuer;
  /** Re-check underlying GLOBAL session on introspect. */
  isGlobalSessionActive?: (sessionId: string) => Promise<boolean>;
};

/**
 * Central ↔ commercial portal bridge.
 * Bridge key authenticates the service; GLOBAL MFA session grants identity.
 */
export class CommercialPortalBridgeService {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly store: CommercialPortalBridgeStore,
    private readonly config: CommercialPortalBridgeConfig,
  ) {
    if (config.bridgeKey.trim().length < 32) throw new Error("COMMERCIAL_BRIDGE_KEY_TOO_SHORT");
    if (config.trialWebhookKey.trim().length < 32) throw new Error("COMMERCIAL_TRIAL_WEBHOOK_KEY_TOO_SHORT");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  assertBridgeKey(headerValue: string | undefined): void {
    if (!headerValue || !safeEqual(headerValue, this.config.bridgeKey)) {
      throw Object.assign(new Error("COMMERCIAL_BRIDGE_FORBIDDEN"), { status: 403 });
    }
  }

  async mint(input: unknown, global: VerifiedGlobalSession) {
    if (!global?.sessionId || !global.userId) {
      throw Object.assign(new Error("GLOBAL_SESSION_REQUIRED"), { status: 401 });
    }
    const body = CommercialPortalMintRequestSchema.parse(input);
    const claim = await this.store.claimJti({
      jti: body.jti,
      purpose: "mint",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    if (claim === "REPLAY") {
      throw Object.assign(new Error("COMMERCIAL_BRIDGE_REPLAY"), { status: 409 });
    }
    const ttl = body.ttlSeconds ?? 3600;
    const accessToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.store.putSession({
      tokenHash: sha256(accessToken),
      role: "SUPERADMIN_GLOBAL",
      subjectId: global.userId,
      tenantId: "global",
      authority: "GLOBAL",
      expiresAt,
      revokedAt: null,
      globalSessionId: global.sessionId,
    });
    return CommercialPortalMintResponseSchema.parse({
      accessToken,
      tokenType: "Bearer",
      expiresAt: expiresAt.toISOString(),
      role: "SUPERADMIN_GLOBAL",
      subjectId: global.userId,
      tenantId: "global",
      authority: "GLOBAL",
    });
  }

  async introspect(authorization: string | undefined, input: unknown) {
    CommercialPortalIntrospectRequestSchema.parse(input);
    if (!authorization?.startsWith("Bearer ")) {
      return CommercialPortalIntrospectResponseSchema.parse({ active: false });
    }
    const token = authorization.slice("Bearer ".length).trim();
    if (token.length < 32) {
      return CommercialPortalIntrospectResponseSchema.parse({ active: false });
    }
    const session = await this.store.getSessionByTokenHash(sha256(token));
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return CommercialPortalIntrospectResponseSchema.parse({ active: false });
    }
    if (this.config.isGlobalSessionActive) {
      const live = await this.config.isGlobalSessionActive(session.globalSessionId);
      if (!live) return CommercialPortalIntrospectResponseSchema.parse({ active: false });
    }
    return CommercialPortalIntrospectResponseSchema.parse({
      active: true,
      role: session.role,
      subjectId: session.subjectId,
      tenantId: session.tenantId,
      authority: session.authority,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async issueTrial(input: unknown) {
    const body = CommercialTrialIssueRequestSchema.parse(input);
    const claim = await this.store.claimJti({
      jti: body.jti,
      purpose: "trial-issue",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    if (claim === "REPLAY") {
      throw Object.assign(new Error("COMMERCIAL_BRIDGE_REPLAY"), { status: 409 });
    }

    const existing = await this.store.getTrialByTrialId(body.trialId);
    if (existing && existing.contractStatus === "TRIAL" && !existing.revokedAt) {
      let delivery = existing.activationDelivery ?? "ACTIVATED";
      if (delivery === "CALLBACK_FAILED" || delivery === "PENDING") {
        delivery = await this.callbackActivate(existing);
        existing.activationDelivery = delivery;
        await this.store.updateTrial(existing);
      }
      return CommercialTrialIssueResponseSchema.parse({
        centralLicenseRef: existing.centralLicenseRef,
        contractStatus: "TRIAL",
        startsAt: existing.startsAt.toISOString(),
        expiresAt: existing.expiresAt.toISOString(),
        trialHours: 120,
        commercialActivation: delivery === "ACTIVATED" ? "ALREADY_ACTIVE" : delivery,
        idempotent: true,
      });
    }

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + 120 * 60 * 60 * 1000);
    let centralLicenseRef = uuidV7();
    if (this.config.licenseIssuer) {
      const issued = await this.config.licenseIssuer.issueTrialLicense({
        trialId: body.trialId,
        email: body.email.toLowerCase(),
        startsAt,
        expiresAt,
        ...(body.tenantId ? { tenantId: body.tenantId } : {}),
        ...(body.planId ? { planId: body.planId } : {}),
      });
      centralLicenseRef = issued.licenseId;
    }
    const trial: TrialLicense = {
      centralLicenseRef,
      trialId: body.trialId,
      email: body.email.toLowerCase(),
      contractStatus: "TRIAL",
      startsAt,
      expiresAt,
      commercialApiOrigin: body.commercialApiOrigin.replace(/\/$/, ""),
      revokedAt: null,
      activationDelivery: "PENDING",
    };
    await this.store.putTrial(trial);

    const activation = await this.callbackActivate(trial);
    trial.activationDelivery = activation;
    await this.store.updateTrial(trial);
    return CommercialTrialIssueResponseSchema.parse({
      centralLicenseRef,
      contractStatus: "TRIAL",
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      trialHours: 120,
      commercialActivation: activation,
      idempotent: false,
    });
  }

  private async callbackActivate(trial: TrialLicense): Promise<"ACTIVATED" | "CALLBACK_FAILED"> {
    try {
      const origin = assertSafeCommercialPortalCallbackOrigin(trial.commercialApiOrigin);
      const res = await this.fetchImpl(
        `${origin}/v1/crm/trial/${encodeURIComponent(trial.trialId)}/activate-from-central`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER]: this.config.trialWebhookKey,
          },
          body: JSON.stringify({
            centralLicenseRef: trial.centralLicenseRef,
            startsAt: trial.startsAt.toISOString(),
            expiresAt: trial.expiresAt.toISOString(),
            trialHours: 120,
            offlineGrace: false,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return "CALLBACK_FAILED";
      return "ACTIVATED";
    } catch {
      return "CALLBACK_FAILED";
    }
  }

  async expireSweep() {
    const now = new Date();
    const due = await this.store.listExpiredActiveTrials(now);
    let revoked = 0;
    let commercialNotified = 0;
    for (const trial of due) {
      trial.contractStatus = "REVOKED";
      trial.revokedAt = now;
      await this.store.updateTrial(trial);
      if (this.config.licenseIssuer) {
        await this.config.licenseIssuer.revokeTrialLicense(trial.centralLicenseRef, "TRIAL_120H_EXPIRED");
      }
      revoked += 1;
      try {
        const origin = assertSafeCommercialPortalCallbackOrigin(trial.commercialApiOrigin);
        const res = await this.fetchImpl(`${origin}/v1/crm/trial/expire-due`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER]: this.config.trialWebhookKey,
          },
          body: JSON.stringify({
            centralLicenseRef: trial.centralLicenseRef,
            trialId: trial.trialId,
            reason: "TRIAL_120H_EXPIRED",
            offlineGrace: false,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) commercialNotified += 1;
      } catch {
        /* CRM notify best-effort; Central revocation already recorded */
      }
    }
    return CommercialTrialExpireSweepResponseSchema.parse({
      revoked,
      commercialNotified,
      scanned: due.length,
    });
  }

  async provision(idempotencyKey: string | undefined, input: unknown) {
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw Object.assign(new Error("IDEMPOTENCY_KEY_REQUIRED"), { status: 400 });
    }
    const body = CommercialProvisioningRequestSchema.parse(input);
    const payloadHash = sha256(JSON.stringify(body));
    const existing = await this.store.getProvisioningByIdempotency(idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw Object.assign(new Error("IDEMPOTENCY_PAYLOAD_CONFLICT"), { status: 409 });
      }
      return CommercialProvisioningResponseSchema.parse({
        status: "DUPLICATE",
        provisioningId: existing.provisioningId,
        idempotencyKey: existing.idempotencyKey,
        licenseUnits: existing.licenseUnits,
        cajaRule: "ONE_LICENSE_ONE_CAJA",
        fulfillment: existing.fulfillment === "ISSUED" || existing.fulfillment === "ALREADY_ISSUED"
          ? "ALREADY_ISSUED"
          : "ALREADY_QUEUED",
        licenseIds: existing.licenseIds ?? [],
      });
    }
    const claim = await this.store.claimJti({
      jti: idempotencyKey,
      purpose: "provision",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    if (claim === "REPLAY") {
      const again = await this.store.getProvisioningByIdempotency(idempotencyKey);
      if (again) {
        if (again.payloadHash !== payloadHash) {
          throw Object.assign(new Error("IDEMPOTENCY_PAYLOAD_CONFLICT"), { status: 409 });
        }
        return CommercialProvisioningResponseSchema.parse({
          status: "DUPLICATE",
          provisioningId: again.provisioningId,
          idempotencyKey: again.idempotencyKey,
          licenseUnits: again.licenseUnits,
          cajaRule: "ONE_LICENSE_ONE_CAJA",
          fulfillment: again.fulfillment === "ISSUED" || again.fulfillment === "ALREADY_ISSUED"
            ? "ALREADY_ISSUED"
            : "ALREADY_QUEUED",
          licenseIds: again.licenseIds ?? [],
        });
      }
      throw Object.assign(new Error("COMMERCIAL_BRIDGE_REPLAY"), { status: 409 });
    }

    let licenseIds: string[] = [];
    let fulfillment: "QUEUED" | "ISSUED" = "QUEUED";
    if (this.config.licenseIssuer && body.tenantId && body.planId) {
      const issued = await this.config.licenseIssuer.issueProvisioningLicenses({
        orderId: body.orderId,
        licenseUnits: body.licenseUnits,
        tenantId: body.tenantId,
        planId: body.planId,
        payloadHash,
      });
      licenseIds = issued.licenseIds;
      fulfillment = "ISSUED";
    }

    const row: ProvisioningRecord = {
      provisioningId: `CPV-${randomBytes(12).toString("hex")}`,
      idempotencyKey,
      orderId: body.orderId,
      licenseUnits: body.licenseUnits,
      payload: body,
      payloadHash,
      createdAt: new Date(),
      tenantId: body.tenantId ?? null,
      licenseIds,
      fulfillment,
    };
    await this.store.putProvisioning(row);
    return CommercialProvisioningResponseSchema.parse({
      status: "ACCEPTED",
      provisioningId: row.provisioningId,
      idempotencyKey,
      licenseUnits: body.licenseUnits,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      fulfillment,
      licenseIds,
    });
  }
}
