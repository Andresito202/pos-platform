import { createHash } from "node:crypto";
import { createPostgresPool, uuidV7 } from "@pos-platform/database-postgres";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required");
  return value;
}

function uuid(value: string, name: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(name + " must be a lowercase UUIDv7");
  }
  return value;
}

const databaseUrl = required("FACTUS_PAY_DATABASE_URL");
const secret = required("FACTUS_PAY_WEBHOOK_SECRET");
const tenantId = uuid(required("FACTUS_PAY_TENANT_ID"), "FACTUS_PAY_TENANT_ID");
const companyId = uuid(required("FACTUS_PAY_COMPANY_ID"), "FACTUS_PAY_COMPANY_ID");
const integrationId = uuid(required("FACTUS_PAY_INTEGRATION_ID"), "FACTUS_PAY_INTEGRATION_ID");
if (secret.length < 32 || secret.length > 512) throw new Error("FACTUS_PAY_WEBHOOK_SECRET must contain 32 to 512 characters");

const pool = createPostgresPool(databaseUrl, 1, "pos-platform-factus-pay-key-registration");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const integration = await client.query(
    `SELECT i.id
       FROM integrations.external_integrations i
      WHERE i.tenant_id=$1 AND i.company_id=$2 AND i.id=$3
        AND i.provider_code_snapshot='FACTUS_PAY' AND i.status='ACTIVE'
        AND (SELECT count(*) FROM integrations.integration_credential_bindings b
              WHERE b.tenant_id=i.tenant_id AND b.company_id=i.company_id
                AND b.integration_id=i.id AND b.status='ACTIVE')=1
      FOR SHARE`,
    [tenantId, companyId, integrationId],
  );
  if (integration.rowCount !== 1) throw new Error("FACTUS_PAY_ACTIVE_INTEGRATION_NOT_FOUND_OR_AMBIGUOUS");
  const digest = createHash("sha256").update(secret, "utf8").digest("hex");
  const inserted = await client.query(
    `INSERT INTO integrations.factus_pay_webhook_keys
      (id,tenant_id,company_id,integration_id,secret_sha256,status,created_at,revoked_at,version)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',clock_timestamp(),NULL,1)
     RETURNING id::text`,
    [uuidV7(), tenantId, companyId, integrationId, digest],
  );
  await client.query("COMMIT");
  process.stdout.write(JSON.stringify({
    status: "REGISTERED",
    webhook_key_id: inserted.rows[0]?.id,
    tenant_id: tenantId,
    company_id: companyId,
    integration_id: integrationId,
    note: "Secret was hashed before persistence and is not printed. Configure the same secret in the Factus Pay webhook settings.",
  }) + "\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
