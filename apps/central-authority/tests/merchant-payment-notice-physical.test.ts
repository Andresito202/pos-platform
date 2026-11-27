import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, describe, expect, it } from "vitest";
import { MERCHANT_PAYMENT_NOTICE_PATH, uuidV7 } from "@pos-platform/contracts";
import { createPostgresPool } from "@pos-platform/database-postgres";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { createMerchantPaymentNoticeHandler } from "../src/merchant-payment-notice-ingest.js";

const adminUrl = process.env.MERCHANT_NOTICE_TEST_ADMIN_URL;
const runtimeUrl = process.env.MERCHANT_NOTICE_TEST_RUNTIME_URL;

describe.skipIf(!adminUrl || !runtimeUrl)("merchant notice handler and PostgreSQL 041", () => {
  const admin = createPostgresPool(adminUrl!, 2);
  const runtime = createPostgresPool(runtimeUrl!, 3);
  const tenant = uuidV7();
  const company = uuidV7();
  const foreignCompany = uuidV7();

  afterAll(async () => {
    await Promise.all([admin.end(), runtime.end()]);
  });

  async function provision(companyId: string, consent: boolean) {
    const installation = uuidV7();
    const device = uuidV7();
    const credential = uuidV7();
    const key = generateKeyPairSync("ed25519");
    await admin.query(`
      INSERT INTO identity.device_registry
        (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'Ed25519','ACTIVE','TEST_TRUST','DEVICE_TRUST',now(),now())
    `, [device, installation, tenant, companyId, device, Buffer.from(key.publicKey.export({ type: "spki", format: "pem" }))]);
    await admin.query(`
      INSERT INTO identity.device_credentials
        (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
      VALUES ($1,$2,$3,$4,$5,$8,'TEST_TRUST','DEVICE_TRUST','ACTIVE',1,now(),now()+interval '1 hour',$6,$7,now())
    `, [credential, device, installation, tenant, companyId,
      createHash("sha256").update(credential).digest("hex"), Buffer.from("test"), device]);
    if (consent) await admin.query(`
      INSERT INTO payments.merchant_notification_bridge_consents(tenant_id,company_id,installation_id,granted_by)
      VALUES($1,$2,$3,$4)
    `, [tenant, companyId, installation, uuidV7()]);
    return { key: key.privateKey, credential, installation };
  }

  it("persists only consented, unverified observations and deduplicates across bridges in one company", async () => {
    await admin.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Avisos','ACTIVE',now(),now())", [tenant]);
    for (const id of [company, foreignCompany]) await admin.query(`
      INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)
      VALUES($1,$2,'Avisos','America/Bogota','COP','ACTIVE',now(),now())
    `, [id, tenant]);

    const first = await provision(company, true);
    const second = await provision(company, true);
    const foreign = await provision(foreignCompany, false);
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      const authority = `127.0.0.1:${address.port}`;
      const url = `http://${authority}${MERCHANT_PAYMENT_NOTICE_PATH}`;
      const handler = createMerchantPaymentNoticeHandler(runtime, `https://${authority}`, async (request, limit) => {
        const chunks: Buffer[] = [];
        let count = 0;
        for await (const chunk of request) {
          count += chunk.length;
          if (count > limit) throw new Error("controlled test body limit");
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString("utf8");
      }, () => true);
      server.on("request", (request, response) => { void handler(request, response); });
      const body = JSON.stringify({
        source: "NEQUI_NEGOCIOS_SHARED_SMS", observed_at: new Date().toISOString(),
        message_sha256: "a".repeat(64), reported_amount_cop: 10000,
      });
      function signed(bridge: typeof first, raw = body) {
        const requestId = uuidV7();
        const correlationId = uuidV7();
        return {
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-correlation-id": correlationId,
          authorization: createDeviceRequestAuthorization({
            method: "POST", path: MERCHANT_PAYMENT_NOTICE_PATH,
            requestId, correlationId, body: raw, credentialId: bridge.credential,
          }, bridge.key),
        };
      }
      async function submit(headers: ReturnType<typeof signed>, raw = body) {
        const response = await fetch(url, { method: "POST", headers, body: raw });
        return [response.status, await response.json()];
      }
      const proof = signed(first);
      expect(await submit(proof)).toEqual([202, { code: "MERCHANT_NOTICE_UNVERIFIED" }]);
      expect(await submit(proof)).toEqual([403, { code: "MERCHANT_NOTICE_FORBIDDEN" }]);
      expect(await submit(signed(second))).toEqual([202, { code: "MERCHANT_NOTICE_UNVERIFIED" }]);
      expect(await submit(signed(foreign))).toEqual([403, { code: "MERCHANT_NOTICE_FORBIDDEN" }]);
      const rawWithClaim = JSON.stringify({ ...JSON.parse(body), bank_confirmed: true });
      expect(await submit(signed(first, rawWithClaim), rawWithClaim)).toEqual([400, { code: "INVALID_MERCHANT_NOTICE" }]);
      await admin.query("UPDATE payments.merchant_notification_bridge_consents SET revoked_at=now() WHERE installation_id=$1",
        [first.installation]);
      expect(await submit(signed(first))).toEqual([403, { code: "MERCHANT_NOTICE_FORBIDDEN" }]);

      const rows = await admin.query(`
        SELECT company_id,status,bank_confirmed,sale_confirmed,reported_amount_cop
        FROM payments.merchant_payment_notification_inbox WHERE tenant_id=$1
      `, [tenant]);
      expect(rows.rows).toEqual([{
        company_id: company, status: "UNVERIFIED", bank_confirmed: false,
        sale_confirmed: false, reported_amount_cop: 10000,
      }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
