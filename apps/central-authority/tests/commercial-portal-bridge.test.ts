import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMERCIAL_BRIDGE_KEY_HEADER, uuidV7 } from "@pos-platform/contracts";
import {
  CommercialPortalBridgeService,
  MemoryCommercialPortalBridgeStore,
  createCommercialPortalBridgeHandler,
  ExplicitTestGlobalSessionGate,
} from "../src/commercial-portal-bridge/index.js";

const BRIDGE_KEY = "bridge-key-for-tests-min-32-characters!!";
const TRIAL_KEY = "trial-webhook-key-for-tests-min-32-chars!";

describe("commercial portal bridge", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  const store = new MemoryCommercialPortalBridgeStore();
  const gate = new ExplicitTestGlobalSessionGate();
  const activations: Array<{ url: string; body: unknown; key?: string }> = [];
  const globalUser = uuidV7();
  const globalSession = uuidV7();

  beforeAll(async () => {
    const bridge = new CommercialPortalBridgeService(store, {
      bridgeKey: BRIDGE_KEY,
      trialWebhookKey: TRIAL_KEY,
      isGlobalSessionActive: (sessionId) => gate.isSessionActive(sessionId),
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const headers = init?.headers as Record<string, string> | undefined;
        const key = headers?.["x-central-trial-webhook-key"];
        activations.push({
          url,
          body,
          ...(key !== undefined ? { key } : {}),
        });
        return new Response(JSON.stringify({ ok: true, status: "ACTIVE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const handle = createCommercialPortalBridgeHandler(bridge, gate);
    const server = createServer(async (req, res) => {
      const handled = await handle(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    close = () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  afterAll(async () => {
    await close();
  });

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(JSON.stringify(body)).toString(),
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  function globalHeaders(extra: Record<string, string> = {}) {
    return {
      [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY,
      "x-test-global-session-id": globalSession,
      "x-test-global-user-id": globalUser,
      ...extra,
    };
  }

  it("rejects mint when bridge key is present but GLOBAL MFA session is missing", async () => {
    const minted = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti: `no-global-${Date.now()}` },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(minted.status).toBe(401);
    expect(minted.json.code).toBe("GLOBAL_SESSION_REQUIRED");
  });

  it("mints GLOBAL bearer only with verified GLOBAL session and introspects", async () => {
    const minted = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti: `mint-${Date.now()}` },
      globalHeaders(),
    );
    expect(minted.status).toBe(200);
    expect(minted.json.accessToken).toBeTruthy();
    expect(minted.json.subjectId).toBe(globalUser);
    const introspect = await post(
      "/v1/sessions/introspect",
      { audience: "commercial-portal" },
      { authorization: `Bearer ${minted.json.accessToken}` },
    );
    expect(introspect.status).toBe(200);
    expect(introspect.json.active).toBe(true);
    expect(introspect.json.role).toBe("SUPERADMIN_GLOBAL");
    expect(introspect.json.authority).toBe("GLOBAL");
  });

  it("deactivates introspect when underlying GLOBAL session is revoked", async () => {
    const minted = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti: `revoke-${Date.now()}` },
      globalHeaders(),
    );
    expect(minted.status).toBe(200);
    gate.revoke(globalSession);
    const introspect = await post(
      "/v1/sessions/introspect",
      { audience: "commercial-portal" },
      { authorization: `Bearer ${minted.json.accessToken}` },
    );
    expect(introspect.json.active).toBe(false);
    // restore for later tests
    await gate.verifyForMint({
      headers: {
        "x-test-global-session-id": globalSession,
        "x-test-global-user-id": globalUser,
      },
    } as never);
  });

  it("rejects mint replay (same jti)", async () => {
    const jti = `replay-mint-${Date.now()}`;
    const first = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti },
      globalHeaders(),
    );
    expect(first.status).toBe(200);
    const second = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti },
      globalHeaders(),
    );
    expect(second.status).toBe(409);
  });

  it("issues 120h trial and callbacks commercial activate", async () => {
    const trialId = `trial_${Date.now()}`;
    const issued = await post(
      "/v1/commercial/trial/issue",
      {
        trialId,
        email: "trial@example.com",
        trialHours: 120,
        commercialApiOrigin: "http://commercial.test",
        jti: `trial-${trialId}`,
      },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(issued.status).toBe(200);
    expect(issued.json.trialHours).toBe(120);
    expect(issued.json.contractStatus).toBe("TRIAL");
    expect(issued.json.commercialActivation).toBe("ACTIVATED");
    const start = Date.parse(issued.json.startsAt);
    const end = Date.parse(issued.json.expiresAt);
    expect(end - start).toBe(120 * 60 * 60 * 1000);
    expect(activations.some((a) => a.url.includes(`/v1/crm/trial/${trialId}/activate-from-central`))).toBe(true);
    expect(activations.at(-1)?.body).toMatchObject({ offlineGrace: false });
  });

  it("accepts provisioning with idempotency and conflicts on payload reuse", async () => {
    const orderId = `ord_${Date.now()}`;
    const payload = {
      orderId,
      orderNumber: "CPC-1",
      customerEmail: "buyer@example.com",
      licenseUnits: 2,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      items: [{ label: "Plan", quantity: 2, planId: "plan1" }],
    };
    const key = `idem-${orderId}-aaaaaaaa`;
    const first = await post("/v1/commercial/provisioning", payload, {
      [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY,
      "idempotency-key": key,
    });
    expect(first.status).toBe(200);
    expect(first.json.status).toBe("ACCEPTED");
    expect(first.json.fulfillment).toBe("QUEUED");
    const second = await post("/v1/commercial/provisioning", payload, {
      [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY,
      "idempotency-key": key,
    });
    expect(second.status).toBe(200);
    expect(second.json.status).toBe("DUPLICATE");
    expect(second.json.provisioningId).toBe(first.json.provisioningId);
    const conflict = await post(
      "/v1/commercial/provisioning",
      { ...payload, licenseUnits: 3, items: [{ label: "Plan", quantity: 3 }] },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY, "idempotency-key": key },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.json.code).toBe("IDEMPOTENCY_PAYLOAD_CONFLICT");
  });

  it("forbids bridge routes without shared key", async () => {
    const res = await post("/v1/commercial/provisioning", {
      orderId: "x",
      orderNumber: "y",
      customerEmail: "a@b.co",
      licenseUnits: 1,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      items: [{ label: "A", quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });

  it("expire-sweep revokes trials at exact 120h with offlineGrace false", async () => {
    const trialId = `trial_expire_${Date.now()}`;
    const issued = await post(
      "/v1/commercial/trial/issue",
      {
        trialId,
        email: "expire@example.com",
        trialHours: 120,
        commercialApiOrigin: "http://commercial.test",
        jti: `trial-expire-${trialId}`,
      },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(issued.status).toBe(200);
    const trial = await store.getTrialByTrialId(trialId);
    expect(trial).toBeTruthy();
    // Force expiry without grace — wall clock past expires_at.
    trial!.expiresAt = new Date(Date.now() - 1_000);
    await store.updateTrial(trial!);
    const sweep = await post(
      "/v1/commercial/trial/expire-sweep",
      {},
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(sweep.status).toBe(200);
    expect(sweep.json.revoked).toBeGreaterThanOrEqual(1);
    const after = await store.getTrialByTrialId(trialId);
    expect(after?.contractStatus).toBe("REVOKED");
    expect(after?.revokedAt).toBeTruthy();
    expect(
      activations.some(
        (a) =>
          a.url.includes("/v1/crm/trial/expire-due") &&
          (a.body as { offlineGrace?: boolean; trialId?: string }).offlineGrace === false &&
          (a.body as { trialId?: string }).trialId === trialId,
      ),
    ).toBe(true);
  });

  it("issues provisioning licenses when issuer + tenant/plan present (not queue-only)", async () => {
    const licenseIds = [uuidV7(), uuidV7()];
    const issuerBridge = new CommercialPortalBridgeService(store, {
      bridgeKey: BRIDGE_KEY,
      trialWebhookKey: TRIAL_KEY,
      licenseIssuer: {
        async issueTrialLicense() {
          return { licenseId: uuidV7() };
        },
        async revokeTrialLicense() {},
        async issueProvisioningLicenses(input) {
          expect(input.licenseUnits).toBe(2);
          expect(input.tenantId).toBeTruthy();
          return { licenseIds };
        },
      },
    });
    const tenantId = uuidV7();
    const planId = uuidV7();
    const orderId = `ord_issued_${Date.now()}`;
    const key = `idem-issued-${orderId}-bbbbbbbb`;
    const result = await issuerBridge.provision(key, {
      orderId,
      orderNumber: "CPC-ISSUED",
      customerEmail: "buyer@example.com",
      licenseUnits: 2,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      tenantId,
      planId,
      items: [{ label: "Plan", quantity: 2, planId }],
    });
    expect(result.status).toBe("ACCEPTED");
    expect(result.fulfillment).toBe("ISSUED");
    expect(result.licenseIds).toEqual(licenseIds);
  });

  it("keeps multiempresa provisioning receipts isolated by tenant", async () => {
    const tenantA = uuidV7();
    const tenantB = uuidV7();
    const planId = uuidV7();
    const issuer = {
      async issueTrialLicense() {
        return { licenseId: uuidV7() };
      },
      async revokeTrialLicense() {},
      async issueProvisioningLicenses(input: { tenantId: string; licenseUnits: number }) {
        return {
          licenseIds: Array.from({ length: input.licenseUnits }, () => uuidV7()),
        };
      },
    };
    const svc = new CommercialPortalBridgeService(store, {
      bridgeKey: BRIDGE_KEY,
      trialWebhookKey: TRIAL_KEY,
      licenseIssuer: issuer,
    });
    const keyA = `idem-tenant-a-${Date.now()}-cccccccc`;
    const keyB = `idem-tenant-b-${Date.now()}-dddddddd`;
    const a = await svc.provision(keyA, {
      orderId: `ord-a-${Date.now()}`,
      orderNumber: "A-1",
      customerEmail: "a@example.com",
      licenseUnits: 1,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      tenantId: tenantA,
      planId,
      items: [{ label: "A", quantity: 1, planId }],
    });
    const b = await svc.provision(keyB, {
      orderId: `ord-b-${Date.now()}`,
      orderNumber: "B-1",
      customerEmail: "b@example.com",
      licenseUnits: 1,
      cajaRule: "ONE_LICENSE_ONE_CAJA",
      tenantId: tenantB,
      planId,
      items: [{ label: "B", quantity: 1, planId }],
    });
    expect(a.provisioningId).not.toBe(b.provisioningId);
    expect(a.licenseIds[0]).not.toBe(b.licenseIds[0]);
    const rowA = await store.getProvisioningByIdempotency(keyA);
    const rowB = await store.getProvisioningByIdempotency(keyB);
    expect(rowA?.tenantId).toBe(tenantA);
    expect(rowB?.tenantId).toBe(tenantB);
  });

  it("survives service restart when store is durable (shared store = post-restart)", async () => {
    const minted = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", jti: `persist-mint-${Date.now()}` },
      globalHeaders(),
    );
    expect(minted.status).toBe(200);
    const token = minted.json.accessToken as string;
    // New service instance over the same store (simulates process restart with Postgres).
    const restarted = new CommercialPortalBridgeService(store, {
      bridgeKey: BRIDGE_KEY,
      trialWebhookKey: TRIAL_KEY,
      isGlobalSessionActive: (sessionId) => gate.isSessionActive(sessionId),
    });
    const introspect = await restarted.introspect(`Bearer ${token}`, {
      audience: "commercial-portal",
    });
    expect(introspect.active).toBe(true);
    expect(introspect.subjectId).toBe(globalUser);
  });
});
