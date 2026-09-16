import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool, type PoolClient } from "pg";
import {
  createSyncBatchRequestSchema,
  SyncBatchResponseSchema,
  type SyncBatchRequest,
  type SyncBatchResponse,
  type SyncOperation,
} from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;
const syncToken = process.env.CENTRAL_SYNC_TOKEN;
const maxOperations = Number(process.env.SYNC_MAX_OPERATIONS ?? 100);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!syncToken) throw new Error("CENTRAL_SYNC_TOKEN is required");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new Error("SYNC_MAX_OPERATIONS must be a positive integer");

const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 10) });
const batchSchema = createSyncBatchRequestSchema(maxOperations);

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

function unauthorized(response: ServerResponse): void {
  json(response, 401, { error: "UNAUTHORIZED" });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
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

function schemaVersion(value: string): number {
  const major = Number(value.split(".")[0]);
  if (!Number.isSafeInteger(major) || major < 1) throw new Error(`unsupported payload_schema_version=${value}`);
  return major;
}

function checksum(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

async function lockTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function persistOperation(client: PoolClient, operation: SyncOperation, receivedAt: Date): Promise<"inserted" | "duplicate"> {
  const computedChecksum = checksum(operation.payload);
  if (computedChecksum !== operation.payload_checksum) {
    throw Object.assign(new Error("payload checksum mismatch"), { code: "PAYLOAD_CHECKSUM_MISMATCH" });
  }

  const existing = await client.query<{
    id: string;
    payload_checksum: Buffer;
    idempotency_key: string;
    operation_type: string;
  }>(
    `SELECT id, payload_checksum, idempotency_key, operation_type
       FROM sync.sync_operations
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [operation.tenant_id, operation.operation_id],
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    const existingChecksum = Buffer.from(row.payload_checksum).toString("hex");
    if (existingChecksum !== operation.payload_checksum) {
      throw Object.assign(new Error("operation_id replay has a different checksum"), { code: "OPERATION_CHECKSUM_CONFLICT" });
    }
    if (row.idempotency_key !== operation.idempotency_key || row.operation_type !== operation.operation_type) {
      throw Object.assign(new Error("operation_id replay has different immutable identity"), { code: "OPERATION_IDENTITY_CONFLICT" });
    }
    return "duplicate";
  }

  const idempotency = await client.query<{ id: string; payload_checksum: Buffer }>(
    `SELECT id, payload_checksum
       FROM sync.sync_operations
      WHERE tenant_id = $1 AND operation_type = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [operation.tenant_id, operation.operation_type, operation.idempotency_key],
  );
  if (idempotency.rowCount) {
    const existingChecksum = Buffer.from(idempotency.rows[0].payload_checksum).toString("hex");
    if (existingChecksum !== operation.payload_checksum) {
      throw Object.assign(new Error("idempotency key replay has a different checksum"), { code: "IDEMPOTENCY_CHECKSUM_CONFLICT" });
    }
    throw Object.assign(new Error("idempotency key belongs to another operation_id"), { code: "IDEMPOTENCY_OPERATION_CONFLICT" });
  }

  const now = receivedAt.toISOString();
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
       'SERVER_ACCEPTED', $18, $18, 1
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
      now,
    ],
  );
  return "inserted";
}

async function acceptBatch(batch: SyncBatchRequest): Promise<SyncBatchResponse> {
  const client = await pool.connect();
  const receivedAt = new Date();
  try {
    await client.query("BEGIN");
    await lockTenant(client, batch.tenant_id);

    for (const operation of batch.operations) {
      await persistOperation(client, operation, receivedAt);
    }

    await client.query("COMMIT");
    const committedAt = new Date().toISOString();
    const response: SyncBatchResponse = {
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      device_id: batch.device_id,
      acknowledged_through_local_sequence: batch.operations.at(-1)?.local_sequence ?? null,
      results: batch.operations.map((operation) => ({
        operation_id: operation.operation_id,
        correlation_id: operation.correlation_id,
        server_status: "SERVER_ACCEPTED",
        server_result_code: "COMMITTED",
        aggregate_id: operation.aggregate_id,
        previous_version: null,
        new_version: null,
        received_at_server: receivedAt.toISOString(),
        committed_at_server: committedAt,
        retryable: false,
        review_required: false,
      })),
    };
    return SyncBatchResponseSchema.parse(response);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { status: "ok" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/sync/batches") {
    json(response, 404, { error: "NOT_FOUND" });
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${syncToken}`) {
    unauthorized(response);
    return;
  }

  try {
    const input = batchSchema.parse(await readBody(request));
    const result = await acceptBatch(input);
    json(response, 200, result);
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "ZodError") {
      json(response, 400, { error: "INVALID_SYNC_BATCH", details: error });
      return;
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "CENTRAL_SYNC_FAILED";
    const message = error instanceof Error ? error.message : "central sync failed";
    const conflict = code.endsWith("CONFLICT");
    json(response, conflict ? 409 : 500, { error: code, message });
  }
});

server.listen(port, () => {
  console.log(`central-api listening on :${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down central-api`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
