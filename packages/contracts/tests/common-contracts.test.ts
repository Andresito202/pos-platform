import { describe, expect, it } from "vitest";
import {
  ContractErrorSchema,
  ContractVersionRangeSchema,
  IdempotencyIdentitySchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  classifyIdempotency,
  compareContractVersions,
  isContractVersionCompatible,
} from "../src/index.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "550e8400-e29b-41d4-a716-446655440001";
const operationId = "550e8400-e29b-41d4-a716-446655440002";
const diagnosticId = "550e8400-e29b-41d4-a716-446655440003";
const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);

const baseError = {
  code: "VALIDATION.INVALID_INPUT",
  category: "VALIDATION" as const,
  retryable: false,
  user_message_key: "errors.validation.invalid_input",
  field_errors: [],
  current_version: null,
  required_action: null,
  diagnostic_id: diagnosticId,
};

const baseRequest = {
  protocol_version: "1.0.0",
  message_type: "sales.command.create",
  request_id: requestId,
  correlation_id: correlationId,
  operation_id: operationId,
  idempotency_key: "sale:create:0001",
  payload_schema_version: "1.0.0",
  payload: { sale_id: "S-1" },
};

const baseResponse = {
  protocol_version: "1.0.0",
  request_id: requestId,
  correlation_id: correlationId,
  operation_id: operationId,
  status: "SUCCEEDED" as const,
  result_code: "OK",
  result_schema_version: "1.0.0",
  result: { accepted: true },
  error: null,
  server_time: "2026-08-28T05:00:00Z",
};

describe("TECH-003 common executable contracts", () => {
  it("compares and validates bounded contract versions", () => {
    expect(compareContractVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareContractVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareContractVersions("1.1.9", "1.2.0")).toBe(-1);
    expect(isContractVersionCompatible("1.2.0", { min: "1.0.0", max: "1.9.9" })).toBe(true);
    expect(isContractVersionCompatible("2.0.0", { min: "1.0.0", max: "1.9.9" })).toBe(false);
  });

  it("rejects invalid version ranges and non-canonical versions", () => {
    expect(ContractVersionRangeSchema.safeParse({ min: "2.0.0", max: "1.9.9" }).success).toBe(false);
    expect(RequestEnvelopeSchema.safeParse({ ...baseRequest, protocol_version: "01.0.0" }).success).toBe(false);
  });

  it("compares arbitrarily large canonical version segments without Number precision loss", () => {
    expect(compareContractVersions("9007199254740993.0.0", "9007199254740992.999.999")).toBe(1);
  });

  it("accepts a strict request envelope", () => {
    expect(RequestEnvelopeSchema.parse(baseRequest)).toEqual(baseRequest);
  });

  it("rejects unknown request fields", () => {
    expect(RequestEnvelopeSchema.safeParse({ ...baseRequest, injected_admin: true }).success).toBe(false);
  });

  it("requires operation identity when an idempotency key is present", () => {
    const { operation_id: _operationId, ...withoutOperation } = baseRequest;
    expect(RequestEnvelopeSchema.safeParse(withoutOperation).success).toBe(false);
  });

  it("rejects non-JSON request payloads", () => {
    expect(RequestEnvelopeSchema.safeParse({ ...baseRequest, payload: { value: 1n } }).success).toBe(false);
  });

  it("accepts a successful response without an error", () => {
    expect(ResponseEnvelopeSchema.parse(baseResponse)).toEqual(baseResponse);
  });

  it("requires server_time to be an RFC 3339 UTC instant", () => {
    expect(ResponseEnvelopeSchema.safeParse({
      ...baseResponse,
      server_time: "2026-08-28T07:00:00+02:00",
    }).success).toBe(false);
  });

  it("requires an error for REJECTED responses", () => {
    expect(ResponseEnvelopeSchema.safeParse({ ...baseResponse, status: "REJECTED", error: null }).success).toBe(false);
  });

  it("forbids an error on SUCCEEDED responses", () => {
    expect(ResponseEnvelopeSchema.safeParse({ ...baseResponse, error: baseError }).success).toBe(false);
  });

  it("aligns UNKNOWN responses with UNKNOWN_OUTCOME errors", () => {
    expect(ResponseEnvelopeSchema.safeParse({
      ...baseResponse,
      status: "UNKNOWN",
      result: null,
      error: { ...baseError, category: "UNKNOWN_OUTCOME", code: "EXTERNAL.UNKNOWN_OUTCOME" },
    }).success).toBe(true);
    expect(ResponseEnvelopeSchema.safeParse({
      ...baseResponse,
      status: "UNKNOWN",
      result: null,
      error: baseError,
    }).success).toBe(false);
  });

  it("keeps structured errors strict and refuses stack leakage", () => {
    expect(ContractErrorSchema.safeParse({ ...baseError, stack: "secret internal stack" }).success).toBe(false);
  });

  it("limits retry_after_ms to rate-limited errors", () => {
    expect(ContractErrorSchema.safeParse({ ...baseError, retry_after_ms: 1000 }).success).toBe(false);
    expect(ContractErrorSchema.safeParse({
      ...baseError,
      category: "RATE_LIMITED",
      code: "DEPENDENCY.RATE_LIMITED",
      retryable: true,
      retry_after_ms: 1000,
    }).success).toBe(true);
  });

  it("classifies replay, collision and distinct idempotency identities", () => {
    const existing = IdempotencyIdentitySchema.parse({
      operation_id: operationId,
      idempotency_key: "sale:create:0001",
      payload_checksum: checksumA,
    });
    expect(classifyIdempotency(existing, existing)).toBe("REPLAY");
    expect(classifyIdempotency(existing, { ...existing, payload_checksum: checksumB })).toBe("CONFLICT");
    expect(classifyIdempotency(existing, {
      operation_id: "550e8400-e29b-41d4-a716-446655440004",
      idempotency_key: "sale:create:0002",
      payload_checksum: checksumB,
    })).toBe("DISTINCT");
  });

  it("rejects non-canonical SHA-256 checksum text", () => {
    expect(IdempotencyIdentitySchema.safeParse({
      operation_id: operationId,
      idempotency_key: "sale:create:0001",
      payload_checksum: "A".repeat(64),
    }).success).toBe(false);
  });
});
