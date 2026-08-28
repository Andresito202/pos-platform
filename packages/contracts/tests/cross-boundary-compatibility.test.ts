import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  CONTRACT_BOUNDARY_COMPATIBILITY,
  OperationResultRequestSchema,
  OperationResultResponseSchema,
  SyncOperationSchema,
  createCentralDeviceHttpRequestSchema,
  createCentralHttpResponseSchema,
} from "../src/index.js";

const requestId = "550e8400-e29b-41d4-a716-446655440101";
const correlationId = "550e8400-e29b-41d4-a716-446655440102";
const operationId = "550e8400-e29b-41d4-a716-446655440103";
const tenantId = "550e8400-e29b-41d4-a716-446655440104";
const companyId = "550e8400-e29b-41d4-a716-446655440105";
const branchId = "550e8400-e29b-41d4-a716-446655440106";
const deviceId = "550e8400-e29b-41d4-a716-446655440107";
const installationId = "550e8400-e29b-41d4-a716-446655440108";
const diagnosticId = "550e8400-e29b-41d4-a716-446655440109";
const idempotencyKey = "sale:complete:cross-boundary";

const ipcRequest = {
  protocol_version: "1.0.0",
  message_type: "operation.result.get",
  request_id: requestId,
  correlation_id: correlationId,
  payload_schema_version: "1.0.0",
  payload: { operation_id: operationId, idempotency_key: idempotencyKey },
};

const syncOperation = {
  operation_id: operationId,
  tenant_id: tenantId,
  company_id: companyId,
  branch_id: branchId,
  device_id: deviceId,
  installation_id: installationId,
  session_id: requestId,
  actor_id: correlationId,
  aggregate_type: "SALE",
  aggregate_id: diagnosticId,
  operation_type: "SALE.COMPLETE",
  authority_policy: "APPEND_ONLY_SHARED",
  local_sequence: 1,
  idempotency_key: idempotencyKey,
  expected_version: 0,
  payload_schema_version: "1.0.0",
  payload: { total_minor: 1500 },
  payload_checksum: "a".repeat(64),
  causation_id: null,
  correlation_id: correlationId,
  occurred_at_local: "2026-08-28T10:00:00Z",
  recorded_at_local: "2026-08-28T10:00:01Z",
};

const payloadSchema = z.strictObject({ total_minor: z.number().int().positive() });
const httpRequestSchema = createCentralDeviceHttpRequestSchema(payloadSchema, {
  maxBodyBytes: 4096,
  requireIdempotency: true,
});
const httpRequest = {
  contract_headers: {
    authorization: "opaque-device-credential",
    "content-type": "application/json",
    accept: "application/json",
    "x-pos-api-version": "1.0.0",
    "x-request-id": requestId,
    "x-correlation-id": correlationId,
    "x-pos-device-id": deviceId,
    "x-pos-installation-id": installationId,
    "idempotency-key": idempotencyKey,
  },
  received_body_bytes: 512,
  body: {
    protocol_version: "1.0.0",
    message_type: "sale.complete",
    request_id: requestId,
    correlation_id: correlationId,
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    tenant_id: tenantId,
    device_id: deviceId,
    payload_schema_version: "1.0.0",
    payload: { total_minor: 1500 },
  },
};

describe("TECH-003 cross-boundary compatibility", () => {
  it("publishes exactly one compatibility entry for each transport boundary", () => {
    expect(CONTRACT_BOUNDARY_COMPATIBILITY.map(({ boundary }) => boundary)).toEqual(["IPC", "SYNC", "HTTP"]);
    expect(new Set(CONTRACT_BOUNDARY_COMPATIBILITY.map(({ boundary }) => boundary)).size).toBe(3);
  });

  it("preserves operation and idempotency identity across IPC, sync and HTTP", () => {
    const ipc = OperationResultRequestSchema.parse(ipcRequest);
    const sync = SyncOperationSchema.parse(syncOperation);
    const http = httpRequestSchema.parse(httpRequest);
    expect([ipc.payload.operation_id, sync.operation_id, http.body.operation_id]).toEqual([
      operationId,
      operationId,
      operationId,
    ]);
    expect([ipc.payload.idempotency_key, sync.idempotency_key, http.body.idempotency_key]).toEqual([
      idempotencyKey,
      idempotencyKey,
      idempotencyKey,
    ]);
  });

  it("uses the same canonical UUID and UTC rules at every boundary", () => {
    expect(OperationResultRequestSchema.parse({
      ...ipcRequest,
      request_id: requestId.toUpperCase(),
    }).request_id).toBe(requestId);
    expect(SyncOperationSchema.safeParse({
      ...syncOperation,
      occurred_at_local: "2026-08-28T12:00:00+02:00",
    }).success).toBe(false);
    expect(httpRequestSchema.parse({
      ...httpRequest,
      body: { ...httpRequest.body, operation_id: operationId.toUpperCase() },
    }).body.operation_id).toBe(operationId);
  });

  it("rejects version, request and correlation drift at the transport binding", () => {
    expect(OperationResultRequestSchema.safeParse({ ...ipcRequest, protocol_version: "1" }).success).toBe(false);
    expect(SyncOperationSchema.safeParse({ ...syncOperation, payload_schema_version: "1" }).success).toBe(false);
    expect(httpRequestSchema.safeParse({
      ...httpRequest,
      contract_headers: { ...httpRequest.contract_headers, "x-correlation-id": diagnosticId },
    }).success).toBe(false);
    expect(httpRequestSchema.safeParse({
      ...httpRequest,
      contract_headers: { ...httpRequest.contract_headers, "x-pos-api-version": "2.0.0" },
    }).success).toBe(false);
  });

  it("keeps UNKNOWN_OUTCOME an application result across IPC and HTTP", () => {
    const unknownError = {
      code: "DEPENDENCY.UNKNOWN_OUTCOME",
      category: "UNKNOWN_OUTCOME",
      retryable: false,
      user_message_key: "errors.dependency.unknown_outcome",
      field_errors: [],
      current_version: null,
      required_action: "RECONCILE",
      diagnostic_id: diagnosticId,
    };
    const body = {
      protocol_version: "1.0.0",
      request_id: requestId,
      correlation_id: correlationId,
      operation_id: operationId,
      status: "UNKNOWN",
      result_code: "PENDING_RECONCILIATION",
      result_schema_version: "1.0.0",
      result: {
        operation_id: operationId,
        idempotency_key: idempotencyKey,
        status: "UNKNOWN",
        result_code: "PENDING_RECONCILIATION",
      },
      error: unknownError,
      server_time: "2026-08-28T10:30:00Z",
    };
    expect(OperationResultResponseSchema.safeParse(body).success).toBe(true);

    const httpSchema = createCentralHttpResponseSchema(
      z.strictObject({
        operation_id: z.uuid(),
        idempotency_key: z.string(),
        status: z.literal("UNKNOWN"),
        result_code: z.string(),
      }),
      { maxBodyBytes: 4096 },
    );
    const transport = {
      status_code: 202,
      contract_headers: {
        "content-type": "application/json",
        "x-pos-api-version": "1.0.0",
        "x-request-id": requestId,
        "x-correlation-id": correlationId,
      },
      serialized_body_bytes: 500,
      rate_limit: null,
      body,
    };
    expect(httpSchema.safeParse(transport).success).toBe(true);
    expect(httpSchema.safeParse({ ...transport, status_code: 503 }).success).toBe(false);
  });
});
