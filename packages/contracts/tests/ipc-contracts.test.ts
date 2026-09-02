import { describe, expect, it } from "vitest";
import {
  OperationConfirmRequestSchema,
  OperationResultRequestSchema,
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
} from "../src/index.js";

const metadata = {
  protocol_version: "1.0.0",
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  correlation_id: "550e8400-e29b-41d4-a716-446655440001",
  payload_schema_version: "1.0.0",
};

describe("TECH-003 IPC contracts", () => {
  it("allowlists exact runtime status messages", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: {} }).success).toBe(true);
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "shell.execute", payload: {} }).success).toBe(false);
  });
  it("rejects unexpected runtime status payload fields", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: { shell: true } }).success).toBe(false);
  });
  it("requires both identities when querying an uncertain operation", () => {
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002", idempotency_key: "sale:create:1" },
    }).success).toBe(true);
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002" },
    }).success).toBe(false);
  });
  it("accepts a domain-agnostic operation confirmation with idempotency", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: { note: "example" } },
    }).success).toBe(true);
  });
  it("requires operation_id alongside idempotency_key for operation.confirm", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {} },
    }).success).toBe(false);
  });
  it("rejects unexpected operation.confirm payload fields", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {}, shell: true },
    }).success).toBe(false);
  });
  it("wraps the strict handshake snapshot", () => {
    expect(RuntimeHandshakeRequestSchema.safeParse({
      ...metadata,
      message_type: "runtime.handshake",
      payload: {
        desktop_version: "1.4.0", service_version: "1.4.2", protocol_min: "1.2.0", protocol_max: "1.5.0",
        installation_id: "550e8400-e29b-41d4-a716-446655440010",
        device_id: "550e8400-e29b-41d4-a716-446655440011", schema_version: "003", service_state: "READY",
      },
    }).success).toBe(true);
  });
});
