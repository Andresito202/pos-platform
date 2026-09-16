import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool, type PoolClient } from "pg";
import {
  createCentralDeviceHttpRequestSchema,
  createCentralHttpResponseSchema,
  SyncBatchResponseSchema,
  createSyncBatchRequestSchema,
  type SyncBatchRequest,
  type SyncBatchResponse,
  type SyncOperation,
} from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";

const databaseUrl = process.env.DATABASE_URL;
const syncToken = process.env.CENTRAL_SYNC_TOKEN;
const port = Number(process.env.PORT ?? 8787);
const maxOperations = Number(process.env.SYNC_MAX_OPERATIONS ?? 100);
const maxBodyBytes = Number(process.env.SYNC_MAX_BODY_BYTES ?? 4 * 1024 * 1024);
const protocolVersion = "1.0.0";
const resultSchemaVersion = "1.0.0";

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!syncToken) throw new Error("CENTRAL_SYNC_TOKEN is required");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new Error("SYNC_MAX_OPERATIONS must be a positive integer");
if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error("SYNC_MAX_BODY_BYTES must be a positive integer");

const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 10) });
const batchSchema = createSyncBatchRequestSchema(maxOperations);
const requestSchema = createCentralDeviceHttpRequestSchema(batchSchema, {
  maxBodyBytes,
  requireIdempotency: false,
});
const responseSchema = createCentralHttpResponseSchema(SyncBatchResponseSchema, {
  maxBodyBytes,
});

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("content-length", Buffer.byteLength(payload));
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("request body exceeds configured limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function payloadChecksum(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function schemaMajor(value: string): number {
  const major = Number(value.split(".")[0]);
  if (!Number.isSafeInteger(major) || major < 1) throw new Error(`unsupported payload_schema_version=${value}`);
  return major;
}

async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function persistOperation(client: PoolClient, operation: SyncOperation, receivedAt: Date): Promise<void> {
  if (payloadChecksum(operation.payload) !== operation.payload_checksum) {
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

  const receivedAtIso = receivedAt.toISOString();
  await client.query(
    `INSERT INTO sync.sync_operations (
       id, tenant_id, company_id, branch_id, source_kind, device_id, installation_id,
       session_id, actor_type, actor_id, aggregate_type, aggregate_id, operation_type,
       idempotency_key, expected_version, authority_policy, parent_operation_id,
       causation_id, correlation_id, schema_version, payload, payload_checksum,
       sync_status, received_at_server, committed_at_server, version
     ) VALUES (
       $1, $2, $3, $4, 'CENTRAL_SERVICE', $5, $6,
       $7, 'USER', $8, $9, $10, $11,
       $12, $13, $14, NULL,
       $15, $16, $17, $18, decode($19, 'hex'),
       'SERVER_ACCEPTED', $20, clock_timestamp(), 1
     )`,
    [
      operation.operation_id,
      operation.tenant_id,
      operation.company_id,
      operation.branch_id,
      operation.device_id,
      operation.installation_id,
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
      schemaMajor(operation.payload_schema_version),
      JSON.stringify(operation.payload),
      operation.payload_checksum,
      receivedAtIso,
    ],
  );
}

async function acceptBatch(batch: SyncBatchRequest): Promise<{ result: SyncBatchResponse; committedAt: string }> {
  const client = await pool.connect();
  const receivedAt = new Date();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, batch.tenant_id);

    for (const operation of batch.operations) {
      await persistOperation(client, operation, receivedAt);
    }

    await client.query("COMMIT");

    const durable = await client.query<{
      id: string;
      received_at_server: string;
      committed_at_server: string;
    }>(
      `SELECT id, received_at_server, committed_at_server
         FROM sync.sync_operations
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [batch.tenant_id, batch.operations.map((operation) => operation.operation_id)],
    );

    const rows = new Map(durable.rows.map((row) => [row.id, row]));
    const committedAt = durable.rows.reduce<string | null>((latest, row) => {
      if (!latest || row.committed_at_server > latest) return row.committed_at_server;
      return latest;
    }, null);
    if (!committedAt || durable.rows.length !== batch.operations.length) {
      throw new Error("central commit evidence is incomplete");
    }

    const result: SyncBatchResponse = {
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
        received_at_server: rows.get(operation.operation_id)?.received_at_server ?? receivedAt.toISOString(),
        committed_at_server: rows.get(operation.operation_id)?.committed_at_server ?? committedAt,
        retryable: false,
        review_required: false,
      })),
    };
    return { result: SyncBatchResponseSchema.parse(result), committedAt };
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
  if (request.headers.authorization !== `Bearer ${syncToken}`) {
    json(response, 401, { error: "UNAUTHORIZED" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch {
    json(response, 400, { error: "INVALID_JSON" });
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    json(response, 400, { error: "INVALID_JSON" });
    return;
  }

  const requestValidation = requestSchema.safeParse({
    contract_headers: {
      authorization: request.headers.authorization,
      "content-type": String(request.headers["content-type"] ?? "").split(";")[0],
      accept: String(request.headers.accept ?? ""),
      "x-pos-api-version": String(request.headers["x-pos-api-version"] ?? ""),
      "x-request-id": String(request.headers["x-request-id"] ?? ""),
      "x-correlation-id": String(request.headers["x-correlation-id"] ?? ""),
      "x-pos-device-id": String(request.headers["x-pos-device-id"] ?? ""),
      "x-pos-installation-id": String(request.headers["x-pos-installation-id"] ?? ""),
    },
    received_body_bytes: Buffer.byteLength(raw, "utf8"),
    body: input,
  });

  if (!requestValidation.success) {
    json(response, 400, { error: "INVALID_SYNC_REQUEST", details: requestValidation.error.flatten() });
    return;
  }

  const envelope = requestValidation.data.body;
  const requestId = envelope.request_id;
  const correlationId = envelope.correlation_id;

  try {
    const accepted = await acceptBatch(envelope.payload);
    const responseBody = {
      protocol_version: protocolVersion,
      request_id: requestId,
      correlation_id: correlationId,
      operation_id: envelope.operation_id ?? null,
      status: "SUCCEEDED" as const,
      result_code: "COMMITTED",
      result_schema_version: resultSchemaVersion,
      error: null,
      server_time: accepted.committedAt,
      result: accepted.result,
    };
    const responseValidation = responseSchema.safeParse({
      status_code: 200,
      contract_headers: {
        "content-type": "application/json",
        "x-pos-api-version": protocolVersion,
        "x-request-id": requestId,
        "x-correlation-id": correlationId,
      },
      serialized_body_bytes: Buffer.byteLength(JSON.stringify(responseBody), "utf8"),
      rate_limit: null,
      body: responseBody,
    });
    if (!responseValidation.success) {
      json(response, 500, { error: "RESPONSE_CONTRACT_VIOLATION" });
      return;
    }
    json(response, 200, responseBody, {
      "x-pos-api-version": protocolVersion,
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "CENTRAL_SYNC_FAILED";
    const message = error instanceof Error ? error.message : "central sync failed";
    const status = code.endsWith("CONFLICT") ? 409 : code === "PAYLOAD_CHECKSUM_MISMATCH" ? 422 : 500;
    const category = status === 409 ? "CONFLICT" : status === 422 ? "INTEGRITY" : "INTERNAL";
    const body = {
      protocol_version: protocolVersion,
      request_id: requestId,
      correlation_id: correlationId,
      operation_id: envelope.operation_id ?? null,
      status: "REJECTED" as const,
      result_code: code,
      result_schema_version: resultSchemaVersion,
      error: { category, code, message, retryable: false },
      server_time: new Date().toISOString(),
      result: null,
    };
    json(response, status, body, {
      "x-pos-api-version": protocolVersion,
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
    });
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
