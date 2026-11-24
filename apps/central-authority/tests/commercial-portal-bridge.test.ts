import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMERCIAL_BRIDGE_KEY_HEADER } from "@pos-platform/contracts";
import {
  CommercialPortalBridgeService,
  MemoryCommercialPortalBridgeStore,
  createCommercialPortalBridgeHandler,
} from "../src/commercial-portal-bridge/index.js";

const BRIDGE_KEY = "bridge-key-for-tests-min-32-characters!!";
const TRIAL_KEY = "trial-webhook-key-for-tests-min-32-chars!";

describe("commercial portal bridge", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  const store = new MemoryCommercialPortalBridgeStore();
  const activations: Array<{ url: string; body: unknown; key?: string }> = [];

  beforeAll(async () => {
    const bridge = new CommercialPortalBridgeService(store, {
      bridgeKey: BRIDGE_KEY,
      trialWebhookKey: TRIAL_KEY,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const headers = init?.headers as Record<string, string> | undefined;
        activations.push({
          url,
          body,
          key: headers?.["x-central-trial-webhook-key"],
        });
        return new Response(JSON.stringify({ ok: true, status: "ACTIVE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const handle = createCommercialPortalBridgeHandler(bridge);
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
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(JSON.stringify(body)).toString(), ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  it("mints GLOBAL bearer and introspects active session", async () => {
    const minted = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", subjectId: "global-admin-1", jti: `mint-${Date.now()}` },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(minted.status).toBe(200);
    expect(minted.json.accessToken).toBeTruthy();
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

  it("rejects mint replay (same jti)", async () => {
    const jti = `replay-mint-${Date.now()}`;
    const first = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", subjectId: "global-admin-2", jti },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
    );
    expect(first.status).toBe(200);
    const second = await post(
      "/v1/sessions/commercial-bridge/mint",
      { role: "SUPERADMIN_GLOBAL", subjectId: "global-admin-2", jti },
      { [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY },
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
    expect(activations.at(-1)?.key).toBe(TRIAL_KEY);
  });

  it("accepts provisioning with idempotency and rejects replay divergence via duplicate key", async () => {
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
    const second = await post("/v1/commercial/provisioning", payload, {
      [COMMERCIAL_BRIDGE_KEY_HEADER]: BRIDGE_KEY,
      "idempotency-key": key,
    });
    expect(second.status).toBe(200);
    expect(second.json.status).toBe("DUPLICATE");
    expect(second.json.provisioningId).toBe(first.json.provisioningId);
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
});
