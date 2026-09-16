import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool, type PoolClient } from "pg";

interface SyncOperation {
  operation_id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  device_id: string;
  installation_id: string;
  session_id: string;
  actor_id: string;
  aggregate_type: string;
  aggregate_id: string;
  operation_type: string;
  authority_policy: string;
  local_sequence: number;
  idempotency_key: string;
  expected_version: number | null;
  payload_schema_version: string;
  payload: unknown;
  payload_checksum: string;
  causation_id: string | null;
  correlation_id: string;
  occurred_at_local: string;
  recorded_at_local: string;
}

interface SyncBatchRequest {
  batch_id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  device_id: string;
  installation_id: string;
  checkpoint_local_sequence: number | null;
  operations: SyncOperation[];
}

interface SyncBatchResponse {
  batch_id: string;
  tenant_id: string;
  device_id: string;
  acknowledged_through_local_sequence: number | null;
  results: Array<{
    operation_id: string;
    correlation_id: string;
    server_status: "SERVER_ACCEPTED";
    server_result_code: "COMMITTED";
    aggregate_id: string;
    previous_version: number | null;
    new_version: number | null;
    received_at_server: string;
    committed_at_server: string;
    retryable: false;
    review_required: false;
  }>;
}

const databaseUrl = process.env.DATABASE_URL;
const syncToken = process.env.CENTRAL_SYNC_TOKEN;
const port = Number(process.env.PORT ?? 8787);
const maxOperations = Number(process.env.SYNC_MAX_OPERATIONS ?? 100);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!syncToken) throw new Error("CENTRAL_SYNC_TOKEN is required");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new Error("SYNC_MAX_OPERATIONS must be a positive integer");

const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 10) });
const contractsModulePath = new URL("../../../packages/contracts/src/sync.ts", import.meta.url).href;
const { createSyncBatchRequestSchema, SyncBatchResponseSchema } = await import(contractsModulePath) as typeof import("../../../packages/contracts/src/sync.js");
const batchSchema = createSyncBatchRequestSchema(maxOperations);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not valid channel payloads");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("unsupported channel payload value");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 10 * 1024 * 1024) throw new Error("request body exceeds 10 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function payloadChecksum(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function schemaVersion(value: string): number {
  const major = Number(value.split(".")[0]);
  if (!Number.isSafeInteger(major) || major < 1) throw new Error(`unsupported payload_schema_version=${value}`);
  return major;
}

async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function persist(client: PoolClient, operation: SyncOperation, receivedAt: Date): Promise<void> {
  if (payloadChecksum(operation.payload) !== operation.payload_checksum) {
    throw Object.assign(new Error("payload checksum mismatch"), { code: "PAYLOAD_CHECKSUM_MISMATCH" });
  }

  const existing = await client.query<{ id: string; payload_checksum: Buffer; idempotency_key: string; operation_type: string }>(
    `SELECT id, payload_checksum, idempotency_key, operation_type
       FROM sync.sync_operations
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [operation.tenant_id, operation.operation_id],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    const storedChecksum = Buffer.from(row.payload_checksum).toString("hex");
    if (storedChecksum !== operation.payload_checksum) {
      throw Object.assign(new Error("operation_id replay has a different checksum"), { code: "OPERATION_CHECKSUM_CONFLICT" });
    }
    if (row.idempotency_key !== operation.idempotency_key || row.operation_type !== operation.operation_type) {
      throw Object.assign(new Error("operation_id replay has different immutable identity"), { code: "OPERATION_IDENTITY_CONFLICT" });
    }
    return;
  }

  const idempotency = await client.query<{ id: string; payload_checksum: Buffer }>(
    `SELECT id, payload_checksum
       FROM sync.sync_operations
      WHERE tenant_id = $1 AND operation_type = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [operation.tenant_id, operation.operation_type, operation.idempotency_key],
  );
  if (idempotency.rowCount) {
    const storedChecksum = Buffer.from(idempotency.rows[0].payload_checksum).toString("hex");
    if (storedChecksum !== operation.payload_checksum) {
      throw Object.assign(new Error("idempotency key replay has a different checksum"), { code: "IDEMPOTENCY_CHECKSUM_CONFLICT" });
    }
    throw Object.assign(new Error("idempotency key belongs to another operation_id"), { code: "IDEMPOTENCY_OPERATION_CONFLICT" });
  }

  const receivedAtServer = receivedAt.toISOString();
  await client.query(
    `INSERT INTO sync.sync_operations (
       id, tenant_id, company_id, branch_id, source_kind, device_id, installation_id,
       session_id, actor_type, actor_id, aggregate_type, aggregate_id, operation_type,
       idempotency_key, expected_version, authority_policy, parent_operation_id,
       causation_id, correlation_id, schema_version, payload, payload_checksum,
       sync_status, received_at_server, committed_at_server, version
     ) VALUES (
       $1, $2, $3, $4, 'CENTRAL_SERVICE', NULL, NULL,
       $5, 'USER', $6, $7, $8, $9,
       $10, $11, $12, NULL,
       $13, $14, $15, $16, decode($17, 'hex'),
       'SERVER_ACCEPTED', $18, clock_timestamp(), 1
     )`,
    [
      operation.operation_id,
      operation.tenant_id,
      operation.company_id,
      operation.branch_id,
      operation.session_id,
      operation.actor_id,
      operation.aggregate_type,
      operation.aggregate_id,
      operation.operation_type,
      operation.idempotency_key,
      operation.expected_version,
      operation.authority_policy,
      operation.causation_id,
      operation.correlation_id,
      schemaVersion(operation.payload_schema_version),
      JSON.stringify(operation.payload),
      operation.payload_checksum,
      receivedAtServer,
    ],
  );
}

async function accept(batch: SyncBatchRequest): Promise<SyncBatchResponse> {
  const client = await pool.connect();
  const receivedAt = new Date();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, batch.tenant_id);
    for (const operation of batch.operations) await persist(client, operation, receivedAt);
    await client.query("COMMIT");

    const committedRows = await pool.query<{ id: string; received_at_server: string; committed_at_server: string }>(
      `SELECT id, received_at_server, committed_at_server
         FROM sync.sync_operations
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [batch.tenant_id, batch.operations.map((operation) => operation.operation_id)],
    );
    const durable = new Map(committedRows.rows.map((row) => [row.id, row]));
    return SyncBatchResponseSchema.parse({
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      device_id: batch.device_id,
      acknowledged_through_local_sequence: batch.operations.at(-1)?.local_sequence ?? null,
      results: batch.operations.map((operation) => {
        const row = durable.get(operation.operation_id);
        if (!row) throw new Error(`durable sync row missing for ${operation.operation_id}`);
        return {
          operation_id: operation.operation_id,
          correlation_id: operation.correlation_id,
          server_status: "SERVER_ACCEPTED",
          server_result_code: "COMMITTED",
          aggregate_id: operation.aggregate_id,
          previous_version: null,
          new_version: null,
          received_at_server: new Date(row.received_at_server).toISOString(),
          committed_at_server: new Date(row.committed_at_server).toISOString(),
          retryable: false,
          review_required: false,
        };
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/sync/batches") {
    send(response, 404, { error: "NOT_FOUND" });
    return;
  }
  if (request.headers.authorization !== `Bearer ${syncToken}`) {
    send(response, 401, { error: "UNAUTHORIZED" });
    return;
  }

  try {
    const batch = batchSchema.parse(await readJson(request)) as SyncBatchRequest;
    send(response, 200, await accept(batch));
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "ZodError") {
      send(response, 400, { error: "INVALID_SYNC_BATCH", details: error });
      return;
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "CENTRAL_SYNC_FAILED";
    const message = error instanceof Error ? error.message : "central sync failed";
    send(response, code.endsWith("CONFLICT") ? 409 : 500, { error: code, message });
  }
});

server.listen(port, () => console.log(`central sync API listening on :${port}`));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down central sync API`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
