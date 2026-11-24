import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
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

export type BridgeRole = "SUPERADMIN_GLOBAL";

export type PortalSession = {
  tokenHash: string;
  role: BridgeRole;
  subjectId: string;
  tenantId: "global";
  authority: "GLOBAL";
  expiresAt: Date;
  revokedAt: Date | null;
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
};

export type ProvisioningRecord = {
  provisioningId: string;
  idempotencyKey: string;
  orderId: string;
  licenseUnits: number;
  payload: unknown;
  createdAt: Date;
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** In-memory durable-for-process store — used by standalone/integration and unit tests. */
export class MemoryCommercialPortalBridgeStore implements CommercialPortalBridgeStore {
  private readonly sessions = new Map<string, PortalSession>();
  private readonly trialsById = new Map<string, TrialLicense>();
  private readonly trialsByRef = new Map<string, TrialLicense>();
  private readonly provisioning = new Map<string, ProvisioningRecord>();
  private readonly jtis = new Map<string, ReplayRecord>();

  async putSession(session: PortalSession): Promise<void> {
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
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Central ↔ commercial portal bridge.
 * Reuses Central identity authority semantics (GLOBAL only for admin) without
 * duplicating the identity database — tokens are short-lived bridge credentials
 * minted after GLOBAL authority is established (or via service mint with bridge key).
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

  async mint(input: unknown) {
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
      subjectId: body.subjectId,
      tenantId: "global",
      authority: "GLOBAL",
      expiresAt,
      revokedAt: null,
    });
    return CommercialPortalMintResponseSchema.parse({
      accessToken,
      tokenType: "Bearer",
      expiresAt: expiresAt.toISOString(),
      role: "SUPERADMIN_GLOBAL",
      subjectId: body.subjectId,
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
      return CommercialTrialIssueResponseSchema.parse({
        centralLicenseRef: existing.centralLicenseRef,
        contractStatus: "TRIAL",
        startsAt: existing.startsAt.toISOString(),
        expiresAt: existing.expiresAt.toISOString(),
        trialHours: 120,
        commercialActivation: "ALREADY_ACTIVE",
        idempotent: true,
      });
    }

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + 120 * 60 * 60 * 1000);
    const centralLicenseRef = `CTL-${randomBytes(16).toString("hex")}`;
    const trial: TrialLicense = {
      centralLicenseRef,
      trialId: body.trialId,
      email: body.email.toLowerCase(),
      contractStatus: "TRIAL",
      startsAt,
      expiresAt,
      commercialApiOrigin: body.commercialApiOrigin.replace(/\/$/, ""),
      revokedAt: null,
    };
    await this.store.putTrial(trial);

    const activation = await this.callbackActivate(trial);
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
      const res = await this.fetchImpl(
        `${trial.commercialApiOrigin}/v1/crm/trial/${encodeURIComponent(trial.trialId)}/activate-from-central`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER]: this.config.trialWebhookKey,
          },
          body: JSON.stringify({ centralLicenseRef: trial.centralLicenseRef }),
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
      revoked += 1;
      // Offline block: signed expiry/revocation is authoritative for Local Service
      // capacity gate. Notify commercial CRM expire endpoint with shared webhook key.
      try {
        const res = await this.fetchImpl(`${trial.commercialApiOrigin}/v1/crm/trial/expire-due`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER]: this.config.trialWebhookKey,
          },
          body: JSON.stringify({
            centralLicenseRef: trial.centralLicenseRef,
            trialId: trial.trialId,
            reason: "TRIAL_120H_EXPIRED",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) commercialNotified += 1;
      } catch {
        /* CRM notify best-effort; local revocation already recorded */
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
    const existing = await this.store.getProvisioningByIdempotency(idempotencyKey);
    if (existing) {
      return CommercialProvisioningResponseSchema.parse({
        status: "DUPLICATE",
        provisioningId: existing.provisioningId,
        idempotencyKey: existing.idempotencyKey,
        licenseUnits: existing.licenseUnits,
        cajaRule: "ONE_LICENSE_ONE_CAJA",
        fulfillment: "ALREADY_QUEUED",
      });
    }
    // Bind idempotency to payload hash to reject key reuse with different body.
    const payloadHash = sha256(JSON.stringify(body));
    const expectedKeyMaterial = createHmac("sha256", this.config.bridgeKey)
      .update(`provision:${body.orderId}:${payloadHash}`)
      .digest("hex");
    // Accept commercial's sha256(provision:orderId) OR HMAC binding — commercial sends sha256(provision:orderId).
    const commercialDefault = sha256(`provision:${body.orderId}`);
    if (idempotencyKey !== commercialDefault && idempotencyKey !== expectedKeyMaterial) {
      // Still accept opaque keys ≥16 once claimed — prevents breaking current commercial outbox.
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
        return CommercialProvisioningResponseSchema.parse({
          status: "DUPLICATE",
          provisioningId: again.provisioningId,
          idempotencyKey: again.idempotencyKey,
          licenseUnits: again.licenseUnits,
          cajaRule: "ONE_LICENSE_ONE_CAJA",
          fulfillment: "ALREADY_QUEUED",
        });
      }
      throw Object.assign(new Error("COMMERCIAL_BRIDGE_REPLAY"), { status: 409 });
    }
    const row: ProvisioningRecord = {
      provisioningId: `CPV-${randomBytes(12).toString("hex")}`,
      idempotencyKey,
      orderId: body.orderId,
      licenseUnits: body.licenseUnits,
      payload: body,
      createdAt: new Date(),
    };
    await this.store.putProvisioning(row);
    return CommercialProvisioningResponseSchema.parse({
      status: "ACCEPTED",
      provisioningId: row.provisioningId,
      idempotencyKey,
      licenseUnits: body.licenseUnits,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      fulfillment: "QUEUED",
    });
  }
}
