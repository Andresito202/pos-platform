import { createHash, randomBytes, generateKeyPairSync } from "node:crypto";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { Pool } from "pg";

const BASE = process.env.CENTRAL_SYNC_BASE_URL;
const POSTGRES_TEST_URL = process.env.POSTGRES_TEST_URL;
const POSTGRES_ADMIN_URL = process.env.POSTGRES_ADMIN_URL;
// Fixed UUIDv7 test tenant; PostgreSQL 001 enforces platform.is_uuid_v7 on tenant IDs.
const tenantId = "018f0000-0000-7000-8000-0000000000e1";

if (!BASE) throw new Error("CENTRAL_SYNC_BASE_URL is required");
if (!POSTGRES_TEST_URL) throw new Error("POSTGRES_TEST_URL is required");
if (!POSTGRES_ADMIN_URL) throw new Error("POSTGRES_ADMIN_URL is required");

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function seedCentralScope(companyId: string, branchId: string, deviceId: string, installationId: string, credentialId: string, publicKeyPem: string): Promise<void> {
  const admin = new Pool({ connectionString: POSTGRES_ADMIN_URL, max: 1 });
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at)
       VALUES ($1,'Central Sync Gate Tenant','ACTIVE',clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)
       VALUES ($1,$2,'Central Sync Gate Company','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, tenantId],
    );
    await client.query(
      `INSERT INTO organization.branches (id,tenant_id,company_id,name,timezone,status,created_at,updated_at)
       VALUES ($1,$2,$3,'Central Sync Gate Branch','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [branchId, tenantId, companyId],
    );
    await client.query(
      `INSERT INTO identity.device_registry
        (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Ed25519','ACTIVE','GATE_DEVICE_TRUST','DEVICE_TRUST',clock_timestamp(),clock_timestamp())
       ON CONFLICT (device_id) DO UPDATE SET status='ACTIVE', device_public_key=EXCLUDED.device_public_key`,
      [deviceId, installationId, tenantId, companyId, `GATE_${deviceId}`, Buffer.from(publicKeyPem, "utf8")],
    );
    await client.query(
      `INSERT INTO identity.device_credentials
        (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'GATE_DEVICE_TRUST','DEVICE_TRUST','ACTIVE',1,clock_timestamp(),clock_timestamp()+interval '1 hour',$7,$8,clock_timestamp())
       ON CONFLICT (credential_id) DO UPDATE SET status='ACTIVE', expires_at=clock_timestamp()+interval '1 hour'`,
      [credentialId, deviceId, installationId, tenantId, companyId, `GATE_${deviceId}`,
        createHash("sha256").update(credentialId).digest("hex"), Buffer.from("central-sync-gate")],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await admin.end();
  }
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`);
  if (health.status !== 200) throw new Error(`HEALTH_FAILED status=${health.status}`);

  const operationId = uuidV7();
  const batchId = uuidV7();
  const requestId = uuidV7();
  const correlationId = uuidV7();
  const deviceId = uuidV7();
  const installationId = uuidV7();
  const credentialId = uuidV7();
  const deviceKeyPair = generateKeyPairSync("ed25519");
  const publicKeyPem = deviceKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const companyId = uuidV7();
  const branchId = uuidV7();
  const sessionId = uuidV7();
  const actorId = uuidV7();
  const aggregateId = uuidV7();
  const occurredAt = new Date().toISOString();
  const payload = { gate: "CENTRAL_SYNC", purpose: "durable-write-verification", nonce: uuidV7() };
  const idempotencyKey = `central-sync-gate-${operationId}`;

  const operation = {
    operation_id: operationId,
    tenant_id: tenantId,
    company_id: companyId,
    branch_id: branchId,
    device_id: deviceId,
    installation_id: installationId,
    session_id: sessionId,
    actor_id: actorId,
    aggregate_type: "SYNC_GATE",
    aggregate_id: aggregateId,
    operation_type: "SYNC.TEST",
    authority_policy: "APPEND_ONLY_SHARED",
    local_sequence: 1,
    idempotency_key: idempotencyKey,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload,
    payload_checksum: sha256(payload),
    causation_id: null,
    correlation_id: correlationId,
    occurred_at_local: occurredAt,
    recorded_at_local: occurredAt,
  };

  const batch = {
    batch_id: batchId,
    tenant_id: tenantId,
    company_id: companyId,
    branch_id: branchId,
    device_id: deviceId,
    installation_id: installationId,
    checkpoint_local_sequence: null,
    operations: [operation],
  };

  const envelope = {
    protocol_version: "1.0.0",
    message_type: "sync.batch.push",
    request_id: requestId,
    correlation_id: correlationId,
    tenant_id: tenantId,
    device_id: deviceId,
    payload_schema_version: "1.0.0",
    payload: batch,
  };

  const requestHeaders = (value: typeof envelope, body: string) => ({
    authorization: createDeviceRequestAuthorization({
      method: "POST" as const, path: "/v1/sync/batches",
      requestId: value.request_id, correlationId: value.correlation_id,
      credentialId, body,
    }, deviceKeyPair.privateKey),
    "content-type": "application/json",
    accept: "application/json",
    "x-pos-api-version": "1.0.0",
    "x-request-id": value.request_id,
    "x-correlation-id": value.correlation_id,
    "x-pos-device-id": deviceId,
    "x-pos-installation-id": installationId,
  });

  await seedCentralScope(companyId, branchId, deviceId, installationId, credentialId, publicKeyPem);
  const envelopeBody = JSON.stringify(envelope);
  const headers = requestHeaders(envelope, envelopeBody);
  const first = await fetch(`${BASE}/v1/sync/batches`, {
    method: "POST",
    headers,
    body: envelopeBody,
  });
  const firstText = await first.text();
  console.log(`FIRST_POST_STATUS=${first.status}`);
  console.log(firstText);
  if (first.status !== 200) throw new Error("FIRST_POST_FAILED");

  const pool = new Pool({ connectionString: POSTGRES_TEST_URL });

  try {
    const evidence = await pool.query<{
      id: string;
      tenant_id: string;
      device_id: string;
      installation_id: string;
      operation_type: string;
      idempotency_key: string;
      sync_status: string;
      payload_checksum: Buffer;
      source_kind: string;
      actor_type: string;
      version: string;
      received_at_server: string | Date;
      committed_at_server: string | Date;
    }>(
      `SELECT id, tenant_id, device_id, installation_id, operation_type, idempotency_key,
              sync_status, payload_checksum, source_kind, actor_type, version,
              received_at_server, committed_at_server
         FROM sync.sync_operations
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, operationId],
    );

    if (evidence.rowCount !== 1) throw new Error(`PERSISTENCE_ROW_COUNT=${evidence.rowCount}`);
    const row = evidence.rows[0]!;
    const checksum = Buffer.from(row.payload_checksum).toString("hex");
    if (row.tenant_id !== tenantId) throw new Error("TENANT_MISMATCH");
    if (row.device_id !== null) throw new Error("CENTRAL_DEVICE_SCOPE_NOT_NULL");
    if (row.installation_id !== null) throw new Error("CENTRAL_INSTALLATION_SCOPE_NOT_NULL");
    if (row.operation_type !== operation.operation_type) throw new Error("OPERATION_TYPE_MISMATCH");
    if (row.idempotency_key !== operation.idempotency_key) throw new Error("IDEMPOTENCY_KEY_MISMATCH");
    if (row.sync_status !== "SERVER_ACCEPTED") throw new Error(`SYNC_STATUS=${row.sync_status}`);
    if (checksum !== operation.payload_checksum) throw new Error("CHECKSUM_MISMATCH");
    if (row.source_kind !== "CENTRAL_SERVICE") throw new Error(`SOURCE_KIND=${row.source_kind}`);
    if (row.actor_type !== "USER") throw new Error(`ACTOR_TYPE=${row.actor_type}`);
    if (row.version !== "1") throw new Error(`VERSION=${row.version}`);
    if (!row.received_at_server || !row.committed_at_server) throw new Error("SERVER_TIMESTAMPS_MISSING");

    const countBefore = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync.sync_operations WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, operation.idempotency_key],
    );

    const replayEnvelope = { ...envelope, request_id: uuidV7(), correlation_id: uuidV7() };
    const replayBody = JSON.stringify(replayEnvelope);
    const replay = await fetch(`${BASE}/v1/sync/batches`, {
      method: "POST",
      headers: requestHeaders(replayEnvelope, replayBody),
      body: replayBody,
    });
    const replayText = await replay.text();
    console.log(`REPLAY_STATUS=${replay.status}`);
    console.log(replayText);
    if (replay.status !== 200) throw new Error("REPLAY_FAILED");

    const countAfter = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync.sync_operations WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, operation.idempotency_key],
    );

    console.log(`PERSISTENCE_ROW_COUNT=${evidence.rowCount}`);
    console.log(`IDEMPOTENCY_COUNT_BEFORE=${countBefore.rows[0]!.count}`);
    console.log(`IDEMPOTENCY_COUNT_AFTER=${countAfter.rows[0]!.count}`);
    if (countBefore.rows[0]!.count !== "1" || countAfter.rows[0]!.count !== "1") {
      throw new Error("IDEMPOTENCY_ROW_COUNT_FAILED");
    }

    const conflictOperation = {
      ...operation,
      operation_id: uuidV7(),
      correlation_id: uuidV7(),
      payload: { ...payload, nonce: uuidV7(), semantic_conflict: true },
    };
    const conflictBatch = {
      ...batch,
      batch_id: uuidV7(),
      operations: [{
        ...conflictOperation,
        payload_checksum: sha256(conflictOperation.payload),
      }],
    };
    const conflictRequestId = uuidV7();
    const conflictEnvelope = {
      protocol_version: "1.0.0",
      message_type: "sync.batch.push",
      request_id: conflictRequestId,
      correlation_id: conflictOperation.correlation_id,
      tenant_id: tenantId,
      device_id: deviceId,
      payload_schema_version: "1.0.0",
      payload: conflictBatch,
    };
    const conflictBody = JSON.stringify(conflictEnvelope);
    const conflict = await fetch(`${BASE}/v1/sync/batches`, {
      method: "POST",
      headers: requestHeaders(conflictEnvelope, conflictBody),
      body: conflictBody,
    });
    const conflictText = await conflict.text();
    console.log(`IDEMPOTENCY_CONFLICT_STATUS=${conflict.status}`);
    console.log(conflictText);
    if (conflict.status !== 409) throw new Error("IDEMPOTENCY_CONFLICT_NOT_REJECTED");

    const conflictCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync.sync_operations WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, operation.idempotency_key],
    );
    if (conflictCount.rows[0]!.count !== "1") throw new Error("IDEMPOTENCY_CONFLICT_MUTATED_PERSISTENCE");

    console.log("POSTGRES_PERSISTENCE=VERIFIED");
    console.log("IDEMPOTENCY_REPLAY=VERIFIED");
    console.log("IDEMPOTENCY_CONFLICT=VERIFIED");
    console.log("CENTRAL-SYNC GATE: VERIFIED");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("CENTRAL-SYNC GATE: FAILED");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
