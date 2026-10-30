import { createHash, randomBytes, generateKeyPairSync } from "node:crypto";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { Pool } from "pg";
import { runIsolatedDeviceEnrollmentGate } from "./central-device-enrollment-gate.js";


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

async function seedCentralScope(scopeTenantId: string, companyId: string, branchId: string, deviceId: string, installationId: string, credentialId: string, publicKeyPem: string): Promise<void> {
  const admin = new Pool({ connectionString: POSTGRES_ADMIN_URL, max: 1 });
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at)
       VALUES ($1,'Central Sync Gate Tenant','ACTIVE',clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [scopeTenantId],
    );
    await client.query(
      `INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)
       VALUES ($1,$2,'Central Sync Gate Company','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, scopeTenantId],
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
      [deviceId, installationId, scopeTenantId, companyId, `GATE_${deviceId}`, Buffer.from(publicKeyPem, "utf8")],
    );
    await client.query(
      `INSERT INTO identity.device_credentials
        (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'GATE_DEVICE_TRUST','DEVICE_TRUST','ACTIVE',1,clock_timestamp(),clock_timestamp()+interval '1 hour',$7,$8,clock_timestamp())
       ON CONFLICT (credential_id) DO UPDATE SET status='ACTIVE', expires_at=clock_timestamp()+interval '1 hour'`,
      [credentialId, deviceId, installationId, scopeTenantId, companyId, `GATE_${deviceId}`,
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

  await seedCentralScope(tenantId, companyId, branchId, deviceId, installationId, credentialId, publicKeyPem);
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

  const exactReplay = await fetch(`${BASE}/v1/sync/batches`, {
    method: "POST",
    headers,
    body: envelopeBody,
  });
  const exactReplayText = await exactReplay.text();
  console.log(`EXACT_PROOF_REPLAY_STATUS=${exactReplay.status}`);
  console.log(exactReplayText);
  if (exactReplay.status !== 409) throw new Error("EXACT_PROOF_REPLAY_NOT_REJECTED");

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

    if (process.env.CAMACHO_ISOLATED_SYNC_LAB === "YES") {
      // The authenticated device belongs to tenantId. A signed request trying
      // to write to another tenant must be rejected without any persistence.
      const foreignTenantId = uuidV7();
      const foreignOperationId = uuidV7();
      const foreignBatch = {
        ...batch,
        batch_id: uuidV7(),
        tenant_id: foreignTenantId,
        operations: [{
          ...operation,
          operation_id: foreignOperationId,
          tenant_id: foreignTenantId,
          idempotency_key: `cross-tenant-gate-${foreignOperationId}`,
        }],
      };
      const foreignEnvelope = {
        ...envelope,
        request_id: uuidV7(),
        correlation_id: uuidV7(),
        tenant_id: foreignTenantId,
        payload: foreignBatch,
      };
      const foreignBody = JSON.stringify(foreignEnvelope);
      const foreign = await fetch(`${BASE}/v1/sync/batches`, {
        method: "POST",
        headers: requestHeaders(foreignEnvelope, foreignBody),
        body: foreignBody,
      });
      const foreignText = await foreign.text();
      if (foreign.status !== 422) throw new Error(`CROSS_TENANT_STATUS=${foreign.status}:${foreignText.slice(0, 300)}`);
      const foreignRejection = JSON.parse(foreignText) as { result_code?: string };
      if (foreignRejection.result_code !== "SYNC.DEVICE_BINDING_MISMATCH") {
        throw new Error(`CROSS_TENANT_REJECTION_UNEXPECTED=${foreignRejection.result_code ?? "UNKNOWN"}`);
      }
      const foreignPersistence = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM sync.sync_operations WHERE id=$1",
        [foreignOperationId],
      );
      if (foreignPersistence.rows[0]?.count !== "0") throw new Error("CROSS_TENANT_PERSISTENCE_LEAK");
      console.log("CROSS_TENANT_DEVICE_BINDING=REJECTED");
      console.log("CROSS_TENANT_PERSISTENCE_ROWS=0");
  
      // A second, legitimately enrolled tenant must be able to sync independently.
      // Distinct Ed25519 keys, device identity and tenant scope are mandatory.
      const secondTenantId = uuidV7();
      const secondCompanyId = uuidV7();
      const secondBranchId = uuidV7();
      const secondDeviceId = uuidV7();
      const secondInstallationId = uuidV7();
      const secondCredentialId = uuidV7();
      const secondKeys = generateKeyPairSync("ed25519");
      const secondPublicKey = secondKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
      await seedCentralScope(secondTenantId, secondCompanyId, secondBranchId,
        secondDeviceId, secondInstallationId, secondCredentialId, secondPublicKey);
      const secondOperationId = uuidV7();
      const secondOperation = {
        ...operation,
        operation_id: secondOperationId,
        tenant_id: secondTenantId,
        company_id: secondCompanyId,
        branch_id: secondBranchId,
        device_id: secondDeviceId,
        installation_id: secondInstallationId,
        idempotency_key: `tenant-b-${secondOperationId}`,
        correlation_id: uuidV7(),
      };
      const secondBatch = {
        ...batch,
        batch_id: uuidV7(),
        tenant_id: secondTenantId,
        company_id: secondCompanyId,
        branch_id: secondBranchId,
        device_id: secondDeviceId,
        installation_id: secondInstallationId,
        operations: [secondOperation],
      };
      const secondEnvelope = {
        ...envelope,
        tenant_id: secondTenantId,
        device_id: secondDeviceId,
        request_id: uuidV7(),
        correlation_id: uuidV7(),
        payload: secondBatch,
      };
      const secondBody = JSON.stringify(secondEnvelope);
      const secondAuthorization = createDeviceRequestAuthorization({
        method: "POST", path: "/v1/sync/batches",
        requestId: secondEnvelope.request_id,
        correlationId: secondEnvelope.correlation_id,
        credentialId: secondCredentialId, body: secondBody,
      }, secondKeys.privateKey);
      const secondResult = await fetch(`${BASE}/v1/sync/batches`, {
        method: "POST",
        headers: {
          ...requestHeaders(envelope, envelopeBody),
          authorization: secondAuthorization,
          "x-request-id": secondEnvelope.request_id,
          "x-correlation-id": secondEnvelope.correlation_id,
          "x-pos-device-id": secondDeviceId,
          "x-pos-installation-id": secondInstallationId,
        },
        body: secondBody,
      });
      if (secondResult.status !== 200) {
        throw new Error(`SECOND_TENANT_SYNC_FAILED:${secondResult.status}:${(await secondResult.text()).slice(0, 300)}`);
      }
      const scoped = await pool.query<{ tenant_id: string; count: string }>(
        `SELECT tenant_id::text, count(*)::text AS count
           FROM sync.sync_operations WHERE id = ANY($1::uuid[])
           GROUP BY tenant_id ORDER BY tenant_id`,
        [[operationId, secondOperationId]],
      );
      if (scoped.rowCount !== 2
        || scoped.rows.some((row) => row.count !== "1")
        || !scoped.rows.some((row) => row.tenant_id === tenantId)
        || !scoped.rows.some((row) => row.tenant_id === secondTenantId)) {
        throw new Error("TWO_TENANT_PERSISTENCE_ISOLATION_FAILED");
      }
      console.log("TWO_TENANT_INDEPENDENT_AUTHENTICATED_SYNC=VERIFIED");
  
      // Query through the ACTUAL unprivileged runtime role, not the superuser.
      // Each transaction carries an independent tenant context; RLS must return
      // only that tenant's persisted operation and no row without a context.
      const appUrl = new URL(POSTGRES_ADMIN_URL!);
      if (appUrl.hostname !== "127.0.0.1" || appUrl.port !== "55436"
        || appUrl.pathname !== "/postgres" || appUrl.username !== "postgres") {
        throw new Error("RLS_GATE_DISPOSABLE_DATABASE_REQUIRED");
      }
      appUrl.username = "pos_platform_app";
      appUrl.password = "";
      const appPool = new Pool({ connectionString: appUrl.toString(), max: 1 });
      try {
        const appClient = await appPool.connect();
        try {
          const probe = async (tenantContext: string | null): Promise<string[]> => {
            await appClient.query("BEGIN");
            try {
              if (tenantContext !== null) {
                await appClient.query("SELECT set_config('app.tenant_id',$1,true)", [tenantContext]);
              }
              const visible = await appClient.query<{ tenant_id: string }>(
                "SELECT tenant_id::text FROM sync.sync_operations WHERE id=ANY($1::uuid[])",
                [[operationId, secondOperationId]],
              );
              await appClient.query("COMMIT");
              return visible.rows.map((row) => row.tenant_id);
            } catch (error) {
              await appClient.query("ROLLBACK").catch(() => undefined);
              throw error;
            }
          };
          const withoutScope = await probe(null);
          const tenantAOnly = await probe(tenantId);
          const tenantBOnly = await probe(secondTenantId);
          const afterScope = await probe(null);
          if (withoutScope.length !== 0 || afterScope.length !== 0
            || tenantAOnly.length !== 1 || tenantAOnly[0] !== tenantId
            || tenantBOnly.length !== 1 || tenantBOnly[0] !== secondTenantId) {
            throw new Error("RLS_RUNTIME_TENANT_READ_ISOLATION_FAILED");
          }
          console.log("RLS_RUNTIME_TENANT_READ_ISOLATION=VERIFIED");
          console.log("RLS_TRANSACTION_CONTEXT_RESET=VERIFIED");
        } finally {
          appClient.release();
        }
      } finally {
        await appPool.end();
      }
      const issued = await runIsolatedDeviceEnrollmentGate({
        adminUrl: POSTGRES_ADMIN_URL!, tenantId, companyId, uuidV7,
      });
      if (issued.activationRows !== 1 || issued.credentialRows !== 1 || !issued.replayRejected) {
        throw new Error("DEVICE_ENROLLMENT_POSTGRES_EVIDENCE_INVALID");
      }
      console.log("DEVICE_ENROLLMENT_POSTGRES_ISSUANCE=VERIFIED");
      console.log("DEVICE_ENROLLMENT_ACTIVATION_REPLAY=REJECTED");
    }

    if (process.env.CAMACHO_ISOLATED_SYNC_LAB === "YES") {
      // The same enrolled lab device sends an operation originating in REAL SQLite.
      // First response is discarded after Central commits; the second signed
      // request must deduplicate in PostgreSQL and then advance local checkpoint.
      // Lazy-load the cross-package laboratory fixture. A static source import
      // would bring apps/pos-local-service outside target-migrations rootDir.
      const localGateUrl = new URL(
        "../../../apps/pos-local-service/src/sync/isolated-central-sqlite-gate.ts",
        import.meta.url,
      );
      const fixture = await import(localGateUrl.href) as {
        runIsolatedSqliteGate(input: {
          scope: { tenantId: string; companyId: string; branchId: string; deviceId: string; installationId: string };
          baseUrl: string;
          uuidV7(): string;
          authorization(context: {
            method: "POST"; path: string; requestId: string; correlationId: string; body: string;
          }): Promise<string>;
        }): Promise<{ operationId: string; idempotencyKey: string; localCheckpoint: number; localInboxRows: number; recoveredInterruptedDispatches: number }>;
      };
      const sqlite = await fixture.runIsolatedSqliteGate({
        scope: { tenantId, companyId, branchId, deviceId, installationId },
        baseUrl: BASE!,
        uuidV7,
        authorization: async (context) => createDeviceRequestAuthorization({
          ...context, credentialId,
        }, deviceKeyPair.privateKey),
      });
      const durableSqliteOperation = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sync.sync_operations
         WHERE tenant_id=$1 AND id=$2 AND idempotency_key=$3 AND sync_status='SERVER_ACCEPTED'`,
        [tenantId, sqlite.operationId, sqlite.idempotencyKey],
      );
      if (durableSqliteOperation.rows[0]?.count !== "1") {
        throw new Error("SQLITE_CENTRAL_POSTGRES_DEDUPLICATION_FAILED");
      }
      console.log("SQLITE_OUTBOX_CENTRAL_POSTGRES=VERIFIED");
      console.log(`SQLITE_CHECKPOINT=${sqlite.localCheckpoint}`);
      console.log(`SQLITE_INBOX_ROW_COUNT=${sqlite.localInboxRows}`);
      console.log("SQLITE_RESPONSE_LOSS_RECOVERY=VERIFIED");
      if (sqlite.recoveredInterruptedDispatches !== 1) throw new Error("SQLITE_RESTART_PROOF_MISSING");
      console.log("SQLITE_RESTART_IN_FLIGHT_RECOVERY=VERIFIED");

    }

    console.log("POSTGRES_PERSISTENCE=VERIFIED");
    console.log("IDEMPOTENCY_REPLAY=VERIFIED");
    console.log("DEVICE_PROOF_REPLAY=REJECTED");
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
