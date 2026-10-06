import { describe, expect, it } from "vitest";
import {
  SyncBatchRequestSchema,
  SyncBatchResponseSchema,
  createSyncBatchRequestSchema,
  validateSyncBatchCorrespondence,
} from "../src/index.js";

const tenant = "01890f5a-0000-7000-8000-000000000020";
const company = "01890f5a-0000-7000-8000-000000000021";
const branch = "01890f5a-0000-7000-8000-000000000022";
const device = "01890f5a-0000-7000-8000-000000000023";
const installation = "01890f5a-0000-7000-8000-000000000030";
const operation = {
  operation_id: "01890f5a-0000-7000-8000-000000000024", tenant_id: tenant, company_id: company, branch_id: branch, device_id: device, installation_id: installation,
  session_id: "01890f5a-0000-7000-8000-000000000025", actor_id: "01890f5a-0000-7000-8000-000000000026",
  aggregate_type: "SALE", aggregate_id: "01890f5a-0000-7000-8000-000000000027", operation_type: "SALE.COMPLETE",
  authority_policy: "APPEND_ONLY_SHARED", local_sequence: 1, idempotency_key: "sale:complete:1", expected_version: 0,
  payload_schema_version: "1.0.0", payload: { total_minor: 1500 }, payload_checksum: "a".repeat(64),
  causation_id: null, correlation_id: "01890f5a-0000-7000-8000-000000000028",
  occurred_at_local: "2026-08-28T10:00:00Z", recorded_at_local: "2026-08-28T10:00:01Z",
};
const batch = { batch_id: "01890f5a-0000-7000-8000-000000000029", tenant_id: tenant, company_id: company, branch_id: branch, device_id: device, installation_id: installation, checkpoint_local_sequence: 0, operations: [operation] };
const result = {
  operation_id: operation.operation_id, correlation_id: operation.correlation_id, server_status: "SERVER_ACCEPTED",
  server_result_code: "SYNC.ACCEPTED", aggregate_id: operation.aggregate_id, previous_version: 0, new_version: 1,
  received_at_server: "2026-08-28T10:00:02Z", committed_at_server: "2026-08-28T10:00:03Z", retryable: false, review_required: false,
};
const response = { batch_id: batch.batch_id, tenant_id: tenant, device_id: device, acknowledged_through_local_sequence: 1, results: [result] };

describe("TECH-003 local-central sync contracts", () => {
  it("accepts a scoped ordered sync batch", () => expect(SyncBatchRequestSchema.safeParse(batch).success).toBe(true));
  it("rejects cross-tenant operations", () => expect(SyncBatchRequestSchema.safeParse({ ...batch, operations: [{ ...operation, tenant_id: company }] }).success).toBe(false));
  it("rejects non-contiguous local sequence", () => {
    expect(SyncBatchRequestSchema.safeParse({ ...batch, operations: [{ ...operation, local_sequence: 2 }] }).success).toBe(false);
    expect(SyncBatchRequestSchema.safeParse({
      ...batch,
      operations: [operation, { ...operation, operation_id: company, local_sequence: 3, idempotency_key: "sale:2" }],
    }).success).toBe(false);
  });
  it("preserves installation identity in the batch and each operation", () => {
    expect(SyncBatchRequestSchema.safeParse({
      ...batch,
      operations: [{ ...operation, installation_id: "01890f5a-0000-7000-8000-000000000031" }],
    }).success).toBe(false);
  });
  it("enforces configured batch quantity", () => expect(createSyncBatchRequestSchema(1).safeParse({ ...batch, operations: [operation, { ...operation, operation_id: company, local_sequence: 2, idempotency_key: "sale:2" }] }).success).toBe(false));
  it("requires commit evidence for accepted operations", () => expect(SyncBatchResponseSchema.safeParse({ ...response, results: [{ ...result, committed_at_server: null }] }).success).toBe(false));
  it("requires retry semantics for scheduled retry", () => expect(SyncBatchResponseSchema.safeParse({ ...response, results: [{ ...result, server_status: "RETRY_SCHEDULED", committed_at_server: null }] }).success).toBe(false));
  it("accepts partial batch result vocabularies independently", () => expect(SyncBatchResponseSchema.safeParse(response).success).toBe(true));
  it("accepts a duplicate-free partial result subset and validates identity binding", () => {
    expect(validateSyncBatchCorrespondence(batch, response)).toBe(true);
    expect(validateSyncBatchCorrespondence(batch, { ...response, results: [{ ...result, operation_id: company }] })).toBe(false);
    expect(validateSyncBatchCorrespondence(batch, { ...response, results: [{ ...result, correlation_id: company }] })).toBe(false);

    const secondOperation = {
      ...operation,
      operation_id: "01890f5a-0000-7000-8000-000000000032",
      aggregate_id: "01890f5a-0000-7000-8000-000000000033",
      correlation_id: "01890f5a-0000-7000-8000-000000000034",
      local_sequence: 2,
      idempotency_key: "sale:complete:2",
    };
    const twoOperationBatch = { ...batch, operations: [operation, secondOperation] };
    expect(validateSyncBatchCorrespondence(twoOperationBatch, response)).toBe(true);
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

  it("does not advance the checkpoint through unresolved durable outcomes", () => {
    for (const server_status of ["CONFLICT", "REVIEW_REQUIRED", "DEAD_LETTER"] as const) {
      const unresolved = {
        ...result,
        server_status,
        committed_at_server: "2026-08-28T10:00:03Z",
        review_required: server_status === "REVIEW_REQUIRED",
      };
      expect(validateSyncBatchCorrespondence(batch, {
        ...response,
        acknowledged_through_local_sequence: 1,
        results: [unresolved],
      })).toBe(false);
      expect(validateSyncBatchCorrespondence(batch, {
        ...response,
        acknowledged_through_local_sequence: 0,
        results: [unresolved],
      })).toBe(true);
    }
  });
});
