import { describe, expect, it } from "vitest";
import {
  ContractErrorSchema,
  createCentralDeviceHttpRequestSchema,
  createCentralHttpResponseSchema,
  createCursorPageSchema,
  createCursorPaginationRequestSchema,
  expectedRetryAfterSeconds,
  httpStatusForErrorCategory,
  validateCentralDevicePrincipal,
} from "../src/index.js";
import * as z from "zod";

const requestId = "550e8400-e29b-41d4-a716-446655440040";
const correlationId = "550e8400-e29b-41d4-a716-446655440041";
const operationId = "550e8400-e29b-41d4-a716-446655440042";
const tenantId = "550e8400-e29b-41d4-a716-446655440043";
const deviceId = "550e8400-e29b-41d4-a716-446655440044";
const installationId = "550e8400-e29b-41d4-a716-446655440045";
const diagnosticId = "550e8400-e29b-41d4-a716-446655440046";

const payloadSchema = z.strictObject({ heartbeat: z.boolean() });
const requestSchema = createCentralDeviceHttpRequestSchema(payloadSchema, { maxBodyBytes: 4096, requireIdempotency: true });

const request = {
  headers: {
    authorization: "opaque-device-credential",
    "content-type": "application/json",
    accept: "application/json",
    "x-pos-api-version": "1.0.0",
    "x-request-id": requestId,
    "x-correlation-id": correlationId,
    "x-pos-device-id": deviceId,
    "x-pos-installation-id": installationId,
    "idempotency-key": "heartbeat:1",
  },
  received_body_bytes: 512,
  body: {
    protocol_version: "1.0.0",
    message_type: "device.heartbeat",
    request_id: requestId,
    correlation_id: correlationId,
    operation_id: operationId,
    idempotency_key: "heartbeat:1",
    tenant_id: tenantId,
    device_id: deviceId,
    payload_schema_version: "1.0.0",
    payload: { heartbeat: true },
  },
};

const principal = {
  tenant_id: tenantId,
  device_id: deviceId,
  installation_id: installationId,
  authentication_method: "DEVICE_SESSION",
};

const baseResponseBody = {
  protocol_version: "1.0.0",
  request_id: requestId,
  correlation_id: correlationId,
  operation_id: operationId,
  status: "SUCCEEDED" as const,
  result_code: "OK",
  result_schema_version: "1.0.0",
  result: { accepted: true },
  error: null,
  server_time: "2026-08-28T10:30:00Z",
};

const responseHeaders = {
  "content-type": "application/json" as const,
  "x-pos-api-version": "1.0.0",
  "x-request-id": requestId,
  "x-correlation-id": correlationId,
};

describe("TECH-003 central HTTP contracts", () => {
  it("binds normalized HTTP headers to the common request envelope", () => {
    expect(requestSchema.safeParse(request).success).toBe(true);
    expect(requestSchema.safeParse({
      ...request,
      headers: { ...request.headers, "x-request-id": diagnosticId },
    }).success).toBe(false);
    expect(requestSchema.safeParse({
      ...request,
      headers: { ...request.headers, "idempotency-key": "heartbeat:other" },
    }).success).toBe(false);
  });

  it("rejects header injection and oversized measured bodies", () => {
    expect(requestSchema.safeParse({
      ...request,
      headers: { ...request.headers, authorization: "credential\r\ninjected: true" },
    }).success).toBe(false);
    expect(requestSchema.safeParse({ ...request, received_body_bytes: 4097 }).success).toBe(false);
  });

  it("requires idempotency for configured command endpoints", () => {
    const noIdempotency = {
      ...request,
      headers: { ...request.headers, "idempotency-key": undefined },
      body: { ...request.body, operation_id: undefined, idempotency_key: undefined },
    };
    expect(requestSchema.safeParse(noIdempotency).success).toBe(false);
  });

  it("binds the request to a previously verified device principal", () => {
    expect(validateCentralDevicePrincipal(request, principal, payloadSchema, { maxBodyBytes: 4096, requireIdempotency: true })).toBe(true);
    expect(validateCentralDevicePrincipal(request, { ...principal, installation_id: diagnosticId }, payloadSchema, { maxBodyBytes: 4096, requireIdempotency: true })).toBe(false);
  });

  it("maps canonical rejected errors to deterministic HTTP status codes", () => {
    expect(httpStatusForErrorCategory("VALIDATION")).toBe(400);
    expect(httpStatusForErrorCategory("AUTHENTICATION")).toBe(401);
    expect(httpStatusForErrorCategory("AUTHORIZATION")).toBe(403);
    expect(httpStatusForErrorCategory("NOT_FOUND")).toBe(404);
    expect(httpStatusForErrorCategory("CONFLICT")).toBe(409);
    expect(httpStatusForErrorCategory("INTEGRITY")).toBe(422);
    expect(httpStatusForErrorCategory("RATE_LIMITED")).toBe(429);
    expect(httpStatusForErrorCategory("DEPENDENCY_UNAVAILABLE")).toBe(503);
    expect(httpStatusForErrorCategory("INTERNAL")).toBe(500);
    expect(httpStatusForErrorCategory("UNKNOWN_OUTCOME")).toBeNull();
  });

  it("keeps UNKNOWN_OUTCOME at the application layer instead of inventing a transport failure", () => {
    const schema = createCentralHttpResponseSchema(z.strictObject({ accepted: z.boolean() }), { maxBodyBytes: 4096 });
    const unknownError = {
      code: "DEPENDENCY.UNKNOWN_OUTCOME",
      category: "UNKNOWN_OUTCOME" as const,
      retryable: false,
      user_message_key: "errors.dependency.unknown_outcome",
      field_errors: [],
      current_version: null,
      required_action: "RECONCILE",
      diagnostic_id: diagnosticId,
    };
    expect(schema.safeParse({
      status_code: 202,
      headers: responseHeaders,
      serialized_body_bytes: 400,
      rate_limit: null,
      body: { ...baseResponseBody, status: "UNKNOWN", result: null, error: unknownError, result_code: "PENDING_RECONCILIATION" },
    }).success).toBe(true);
    expect(schema.safeParse({
      status_code: 503,
      headers: responseHeaders,
      serialized_body_bytes: 400,
      rate_limit: null,
      body: { ...baseResponseBody, status: "UNKNOWN", result: null, error: unknownError, result_code: "PENDING_RECONCILIATION" },
    }).success).toBe(false);
  });

  it("requires coherent 429, Retry-After and rate-limit state", () => {
    const schema = createCentralHttpResponseSchema(z.strictObject({ accepted: z.boolean() }), { maxBodyBytes: 4096 });
    const rateError = ContractErrorSchema.parse({
      code: "HTTP.RATE_LIMITED",
      category: "RATE_LIMITED",
      retryable: true,
      user_message_key: "errors.http.rate_limited",
      field_errors: [],
      current_version: null,
      required_action: "RETRY_LATER",
      diagnostic_id: diagnosticId,
      retry_after_ms: 1501,
    });
    const rateLimited = {
      status_code: 429,
      headers: { ...responseHeaders, "retry-after": "2" },
      serialized_body_bytes: 500,
      rate_limit: {
        policy_id: "DEVICE.API",
        scope: "DEVICE" as const,
        limit: 100,
        remaining: 0,
        reset_at: "2026-08-28T10:31:00Z",
      },
      body: {
        ...baseResponseBody,
        status: "REJECTED" as const,
        result: null,
        result_code: "HTTP.RATE_LIMITED",
        error: rateError,
      },
    };
    expect(schema.safeParse(rateLimited).success).toBe(true);
    expect(schema.safeParse({ ...rateLimited, headers: responseHeaders }).success).toBe(false);
    expect(schema.safeParse({
      ...rateLimited,
      headers: { ...responseHeaders, "retry-after": "1" },
    }).success).toBe(false);
    expect(expectedRetryAfterSeconds(rateError)).toBe("2");
  });

  it("enforces cursor pagination without total-count assumptions", () => {
    const requestPage = createCursorPaginationRequestSchema(100, 2048);
    expect(requestPage.safeParse({ cursor: null, page_size: 50 }).success).toBe(true);
    expect(requestPage.safeParse({ cursor: null, page_size: 101 }).success).toBe(false);

    const pageSchema = createCursorPageSchema(z.strictObject({ id: z.string() }), 2048);
    expect(pageSchema.safeParse({ items: [{ id: "1" }], next_cursor: "opaque-next", has_more: true }).success).toBe(true);
    expect(pageSchema.safeParse({ items: [{ id: "1" }], next_cursor: null, has_more: true }).success).toBe(false);
  });

  it("rejects unknown response transport fields and output bodies over the configured bound", () => {
    const schema = createCentralHttpResponseSchema(z.strictObject({ accepted: z.boolean() }), { maxBodyBytes: 1024 });
    expect(schema.safeParse({
      status_code: 200,
      headers: responseHeaders,
      serialized_body_bytes: 500,
      rate_limit: null,
      body: baseResponseBody,
      debug_stack: "forbidden",
    }).success).toBe(false);
    expect(schema.safeParse({
      status_code: 200,
      headers: responseHeaders,
      serialized_body_bytes: 1025,
      rate_limit: null,
      body: baseResponseBody,
    }).success).toBe(false);
  });
});
