import { describe, expect, it } from "vitest";
import {
  SyncBatchRequestSchema,
  SyncBatchResponseSchema,
  createSyncBatchRequestSchema,
  validateSyncBatchCorrespondence,
} from "../src/index.js";

const tenant = "550e8400-e29b-41d4-a716-446655440020";
const company = "550e8400-e29b-41d4-a716-446655440021";
const branch = "550e8400-e29b-41d4-a716-446655440022";
const device = "550e8400-e29b-41d4-a716-446655440023";
const operation = {
  operation_id: "550e8400-e29b-41d4-a716-446655440024", tenant_id: tenant, company_id: company, branch_id: branch, device_id: device,
  session_id: "550e8400-e29b-41d4-a716-446655440025", actor_id: "550e8400-e29b-41d4-a716-446655440026",
  aggregate_type: "SALE", aggregate_id: "550e8400-e29b-41d4-a716-446655440027", operation_type: "SALE.COMPLETE",
  authority_policy: "APPEND_ONLY_SHARED", local_sequence: 1, idempotency_key: "sale:complete:1", expected_version: 0,
  payload_schema_version: "1.0.0", payload: { total_minor: 1500 }, payload_checksum: "a".repeat(64),
  causation_id: null, correlation_id: "550e8400-e29b-41d4-a716-446655440028",
  occurred_at_local: "2026-08-28T10:00:00Z", recorded_at_local: "2026-08-28T10:00:01Z",
};
const batch = { batch_id: "550e8400-e29b-41d4-a716-446655440029", tenant_id: tenant, company_id: company, branch_id: branch, device_id: device, checkpoint_local_sequence: 0, operations: [operation] };
const result = {
  operation_id: operation.operation_id, correlation_id: operation.correlation_id, server_status: "SERVER_ACCEPTED",
  server_result_code: "SYNC.ACCEPTED", aggregate_id: operation.aggregate_id, previous_version: 0, new_version: 1,
  received_at_server: "2026-08-28T10:00:02Z", committed_at_server: "2026-08-28T10:00:03Z", retryable: false, review_required: false,
};
const response = { batch_id: batch.batch_id, tenant_id: tenant, device_id: device, acknowledged_through_local_sequence: 1, results: [result] };

describe("TECH-003 local-central sync contracts", () => {
  it("accepts a scoped ordered sync batch", () => expect(SyncBatchRequestSchema.safeParse(batch).success).toBe(true));
  it("rejects cross-tenant operations", () => expect(SyncBatchRequestSchema.safeParse({ ...batch, operations: [{ ...operation, tenant_id: company }] }).success).toBe(false));
  it("rejects non-increasing local sequence", () => expect(SyncBatchRequestSchema.safeParse({ ...batch, operations: [operation, { ...operation, operation_id: company, idempotency_key: "sale:2" }] }).success).toBe(false));
  it("enforces configured batch quantity", () => expect(createSyncBatchRequestSchema(1).safeParse({ ...batch, operations: [operation, { ...operation, operation_id: company, local_sequence: 2, idempotency_key: "sale:2" }] }).success).toBe(false));
  it("requires commit evidence for accepted operations", () => expect(SyncBatchResponseSchema.safeParse({ ...response, results: [{ ...result, committed_at_server: null }] }).success).toBe(false));
  it("requires retry semantics for scheduled retry", () => expect(SyncBatchResponseSchema.safeParse({ ...response, results: [{ ...result, server_status: "RETRY_SCHEDULED", committed_at_server: null }] }).success).toBe(false));
  it("accepts partial batch result vocabularies independently", () => expect(SyncBatchResponseSchema.safeParse(response).success).toBe(true));
  it("matches every requested operation exactly once", () => {
    expect(validateSyncBatchCorrespondence(batch, response)).toBe(true);
    expect(validateSyncBatchCorrespondence(batch, { ...response, results: [{ ...result, operation_id: company }] })).toBe(false);
  });
  it("rejects checkpoints beyond the submitted sequence", () => expect(validateSyncBatchCorrespondence(batch, { ...response, acknowledged_through_local_sequence: 2 })).toBe(false));
  it("rejects checkpoint regression", () => expect(validateSyncBatchCorrespondence(
    { ...batch, checkpoint_local_sequence: 1, operations: [{ ...operation, local_sequence: 2 }] },
    { ...response, acknowledged_through_local_sequence: 0 },
  )).toBe(false));
  it("does not acknowledge through a non-durable retry result", () => {
    const retry = { ...result, server_status: "RETRY_SCHEDULED", committed_at_server: null, retryable: true };
    expect(validateSyncBatchCorrespondence(batch, { ...response, results: [retry] })).toBe(false);
  });
  it("requires durable evidence for explicit conflicts", () => expect(SyncBatchResponseSchema.safeParse({
    ...response,
    results: [{ ...result, server_status: "CONFLICT", committed_at_server: null }],
  }).success).toBe(false));
});
