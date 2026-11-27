import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { COMMERCIAL_BRIDGE_KEY_HEADER, uuidV7 } from "@pos-platform/contracts";
import { createPostgresPool } from "@pos-platform/database-postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  CommercialPortalBridgeService,
  PostgresCommercialLicenseIssuer,
  PostgresCommercialPortalBridgeStore,
  createCommercialPortalBridgeHandler,
} from "../src/commercial-portal-bridge/index.js";
import { ExplicitTestGlobalSessionGate } from "./commercial-portal-test-gate.js";

const adminUrl = process.env.COMMERCIAL_PROVISIONING_TEST_ADMIN_URL;
const runtimeUrl = process.env.COMMERCIAL_PROVISIONING_TEST_RUNTIME_URL;

describe.skipIf(!adminUrl || !runtimeUrl)("commercial provisioning recovery over HTTP and PostgreSQL", () => {
  const admin = createPostgresPool(adminUrl!, 2);
  const runtime = createPostgresPool(runtimeUrl!, 5);

  afterAll(async () => {
    await Promise.all([admin.end(), runtime.end()]);
  });

  it("preserves the receipt and licenses through a lost receipt update and concurrent retries", async () => {
    const tenantId = uuidV7();
    const planId = uuidV7();
    await admin.query(`INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at)
      VALUES($1,'Commercial recovery test','ACTIVE',now(),now())`, [tenantId]);
    await admin.query(`INSERT INTO licensing.plans
      (id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,created_at,updated_at)
      VALUES($1,$2,'Commercial recovery test','PERPETUAL','LOCAL_PERPETUAL','COP',29900,'ACTIVE',now(),now())`,
    [planId, `test-${planId}`]);
    await admin.query(`INSERT INTO licensing.plan_entitlements
      (id,plan_id,capability_code,enabled,limit_type,limit_value,created_at)
      VALUES($1,$2,'TEST_CAPABILITY',true,'FINITE',1,now())`, [uuidV7(), planId]);

    const store = new PostgresCommercialPortalBridgeStore(runtime);
    const bridgeKey = randomBytes(32).toString("hex");
    const config = { bridgeKey, trialWebhookKey: randomBytes(32).toString("hex") };
    const gate = new ExplicitTestGlobalSessionGate();
    const issuer = new PostgresCommercialLicenseIssuer(runtime);
    let handler = createCommercialPortalBridgeHandler(new CommercialPortalBridgeService(store, config), gate);
    const server = createServer((request, response) => { void handler(request, response); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const orderId = `test-${uuidV7()}`;
      const idempotencyKey = randomBytes(24).toString("hex");
      const payload = {
        orderId, orderNumber: "CPC-RECOVERY", customerEmail: "buyer@example.com", tenantId, planId,
        licenseUnits: 2, cajaRule: "ONE_LICENSE_ONE_CAJA", items: [{ label: "Plan", quantity: 2, planId }],
      };
      async function post(body: unknown = payload, key = bridgeKey, requestId = idempotencyKey) {
        const response = await fetch(`${baseUrl}/v1/commercial/provisioning`, {
          method: "POST",
          headers: { "content-type": "application/json", [COMMERCIAL_BRIDGE_KEY_HEADER]: key,
            "idempotency-key": requestId },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }
      const initial = await post();
      expect(initial).toMatchObject({ status: 200, body: { status: "ACCEPTED", fulfillment: "QUEUED", licenseIds: [] } });
      const legacyKey = randomBytes(24).toString("hex");
      const legacy = { ...payload, tenantId: undefined };
      expect(await post(legacy, bridgeKey, legacyKey)).toMatchObject({ status: 200, body: { fulfillment: "QUEUED" } });
      handler = createCommercialPortalBridgeHandler(new CommercialPortalBridgeService(store, { ...config, licenseIssuer: issuer }), gate);
      expect(await post()).toMatchObject({ status: 200, body: { fulfillment: "ALREADY_QUEUED" } });
      handler = createCommercialPortalBridgeHandler(new CommercialPortalBridgeService(store,
        { ...config, licenseIssuer: issuer, recoverBoundProvisioning: true }), gate);
      expect((await post(payload, randomBytes(32).toString("hex"))).status).toBe(403);
      expect((await post({ ...payload, customerEmail: "changed@example.com" })).status).toBe(409);
      expect(await post(legacy, bridgeKey, legacyKey)).toMatchObject({ status: 200, body: { fulfillment: "ALREADY_QUEUED" } });

      // This receipt predates the plan change. Recovery may not create a recurring license without its term.
      await admin.query("UPDATE licensing.plans SET billing_model='MONTHLY', deployment_mode='HYBRID' WHERE id=$1", [planId]);
      expect(await post()).toMatchObject({ status: 409, body: { code: "PROVISION_SUBSCRIPTION_TERM_REQUIRED" } });
      await admin.query("UPDATE licensing.plans SET billing_model='PERPETUAL', deployment_mode='LOCAL_PERPETUAL' WHERE id=$1", [planId]);

      const failure = vi.spyOn(store, "completeQueuedProvisioning")
        .mockRejectedValueOnce(new Error("Test receipt write interruption"));
      expect(await post()).toMatchObject({ status: 503, body: { code: "COMMERCIAL_PROVISIONING_RECOVERY_PENDING" } });
      failure.mockRestore();
      expect((await store.getProvisioningByIdempotency(idempotencyKey))?.fulfillment).toBe("QUEUED");
      const persisted = await admin.query<{ id: string }>(`SELECT id::text FROM licensing.licenses
        WHERE tenant_id=$1 AND plan_id=$2 ORDER BY commercial_reference`, [tenantId, planId]);
      const licenseIds = persisted.rows.map(row => row.id);
      expect(licenseIds).toHaveLength(2);
      const retried = await Promise.all([post(), post()]);
      for (const result of retried) {
        expect(result).toMatchObject({ status: 200, body: { status: "DUPLICATE", fulfillment: "ALREADY_ISSUED",
          provisioningId: initial.body.provisioningId, licenseIds } });
      }
      expect(await store.getProvisioningByIdempotency(idempotencyKey)).toMatchObject({ fulfillment: "ISSUED", licenseIds });
      const grants = await admin.query(`SELECT e.id FROM licensing.license_entitlements e
        JOIN licensing.licenses l ON l.id=e.license_id WHERE l.tenant_id=$1 AND l.plan_id=$2`, [tenantId, planId]);
      expect(grants.rowCount).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
