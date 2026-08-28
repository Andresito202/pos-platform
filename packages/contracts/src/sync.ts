import * as z from "zod";
import {
  ContractVersionSchema,
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  Sha256HexSchema,
  StableCodeSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./primitives.js";

export const SyncAuthorityPolicySchema = z.enum([
  "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
  "SERVER_AUTHORITATIVE",
  "APPEND_ONLY_SHARED",
  "CENTRAL_REVIEW_REQUIRED",
  "EXTERNAL_PROVIDER_AUTHORITATIVE",
  "DERIVED_PROJECTION",
]);

export const SyncOperationSchema = z.strictObject({
  operation_id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  branch_id: UuidSchema,
  device_id: UuidSchema,
  installation_id: UuidSchema,
  session_id: UuidSchema,
  actor_id: UuidSchema,
  aggregate_type: StableCodeSchema,
  aggregate_id: UuidSchema,
  operation_type: StableCodeSchema,
  authority_policy: SyncAuthorityPolicySchema,
  local_sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotency_key: IdempotencyKeySchema,
  expected_version: ExpectedVersionSchema.nullable(),
  payload_schema_version: ContractVersionSchema,
  payload: z.json(),
  payload_checksum: Sha256HexSchema,
  causation_id: UuidSchema.nullable(),
  correlation_id: UuidSchema,
  occurred_at_local: UtcDateTimeSchema,
  recorded_at_local: UtcDateTimeSchema,
});

export const SyncBatchRequestSchema = z.strictObject({
  batch_id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  branch_id: UuidSchema,
  device_id: UuidSchema,
  installation_id: UuidSchema,
  checkpoint_local_sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  operations: z.array(SyncOperationSchema).min(1),
}).superRefine((batch, context) => {
  const operationIds = new Set<string>();
  const idempotencyScopes = new Set<string>();
  let previousSequence = batch.checkpoint_local_sequence ?? 0;
  for (const [index, operation] of batch.operations.entries()) {
    for (const field of ["tenant_id", "company_id", "branch_id", "device_id", "installation_id"] as const) {
      if (operation[field] !== batch[field]) {
        context.addIssue({ code: "custom", path: ["operations", index, field], message: `${field} must match the batch scope` });
      }
    }
    const expectedSequence = previousSequence + 1;
    if (operation.local_sequence !== expectedSequence) {
      context.addIssue({
        code: "custom",
        path: ["operations", index, "local_sequence"],
        message: `local_sequence must be contiguous; expected ${expectedSequence}`,
      });
    }
    previousSequence = operation.local_sequence;
    if (operationIds.has(operation.operation_id)) {
      context.addIssue({ code: "custom", path: ["operations", index, "operation_id"], message: "operation_id must be unique within a batch" });
    }
    operationIds.add(operation.operation_id);
    const scope = `${operation.tenant_id}\u0000${operation.operation_type}\u0000${operation.idempotency_key}`;
    if (idempotencyScopes.has(scope)) {
      context.addIssue({ code: "custom", path: ["operations", index, "idempotency_key"], message: "idempotency identity must be unique within its tenant and operation type" });
    }
    idempotencyScopes.add(scope);
  }
});

export function createSyncBatchRequestSchema(maxOperations: number) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1) {
    throw new RangeError("maxOperations must be a positive safe integer");
  }
  return SyncBatchRequestSchema.superRefine((batch, context) => {
    if (batch.operations.length > maxOperations) {
      context.addIssue({ code: "custom", path: ["operations"], message: `batch exceeds maxOperations=${maxOperations}` });
    }
  });
}

export const SyncServerStatusSchema = z.enum([
  "SERVER_ACCEPTED",
  "SERVER_REJECTED",
  "CONFLICT",
  "WAITING_FOR_DEPENDENCY",
  "RETRY_SCHEDULED",
  "REVIEW_REQUIRED",
  "DEAD_LETTER",
]);

export const SyncOperationResultSchema = z.strictObject({
  operation_id: UuidSchema,
  correlation_id: UuidSchema,
  server_status: SyncServerStatusSchema,
  server_result_code: StableCodeSchema,
  aggregate_id: UuidSchema,
  previous_version: ExpectedVersionSchema.nullable(),
  new_version: ExpectedVersionSchema.nullable(),
  received_at_server: UtcDateTimeSchema,
  committed_at_server: UtcDateTimeSchema.nullable(),
  retryable: z.boolean(),
  review_required: z.boolean(),
}).superRefine((result, context) => {
  const durableStatuses = new Set(["SERVER_ACCEPTED", "SERVER_REJECTED", "CONFLICT", "REVIEW_REQUIRED", "DEAD_LETTER"]);
  if (durableStatuses.has(result.server_status) && result.committed_at_server === null) {
    context.addIssue({ code: "custom", path: ["committed_at_server"], message: `${result.server_status} requires durable server evidence` });
  }
  if (!durableStatuses.has(result.server_status) && result.committed_at_server !== null) {
    context.addIssue({ code: "custom", path: ["committed_at_server"], message: `${result.server_status} cannot advertise a durable commit` });
  }
  if (result.server_status === "RETRY_SCHEDULED" && !result.retryable) {
    context.addIssue({ code: "custom", path: ["retryable"], message: "RETRY_SCHEDULED must be retryable" });
  }
  if (result.server_status === "REVIEW_REQUIRED" && !result.review_required) {
    context.addIssue({ code: "custom", path: ["review_required"], message: "REVIEW_REQUIRED must advertise review_required" });
  }
});

export const SyncBatchResponseSchema = z.strictObject({
  batch_id: UuidSchema,
  tenant_id: UuidSchema,
  device_id: UuidSchema,
  acknowledged_through_local_sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  results: z.array(SyncOperationResultSchema).min(1),
}).superRefine((response, context) => {
  const ids = new Set<string>();
  for (const [index, result] of response.results.entries()) {
    if (ids.has(result.operation_id)) {
      context.addIssue({ code: "custom", path: ["results", index, "operation_id"], message: "operation result must be unique within the batch" });
    }
    ids.add(result.operation_id);
  }
});

export function validateSyncBatchCorrespondence(requestInput: unknown, responseInput: unknown): boolean {
  const request = SyncBatchRequestSchema.parse(requestInput);
  const response = SyncBatchResponseSchema.parse(responseInput);
  if (
    request.batch_id !== response.batch_id
    || request.tenant_id !== response.tenant_id
    || request.device_id !== response.device_id
  ) return false;

  const requestedById = new Map(request.operations.map((operation) => [operation.operation_id, operation]));
  for (const result of response.results) {
    const operation = requestedById.get(result.operation_id);
    if (!operation) return false;
    if (result.correlation_id !== operation.correlation_id || result.aggregate_id !== operation.aggregate_id) return false;
  }

  const previousCheckpoint = request.checkpoint_local_sequence ?? 0;
  if (response.acknowledged_through_local_sequence === null) {
    return request.checkpoint_local_sequence === null;
  }
  if (response.acknowledged_through_local_sequence < previousCheckpoint) return false;

  const checkpointEligibleStatuses = new Set(["SERVER_ACCEPTED", "SERVER_REJECTED"]);
  const resultByOperation = new Map(response.results.map((result) => [result.operation_id, result]));
  let durablePrefix = previousCheckpoint;

  for (const operation of request.operations) {
    const result = resultByOperation.get(operation.operation_id);
    if (!result) break;
    if (!checkpointEligibleStatuses.has(result.server_status) || result.committed_at_server === null) break;
    if (operation.local_sequence !== durablePrefix + 1) break;
    durablePrefix = operation.local_sequence;
  }

  return response.acknowledged_through_local_sequence <= durablePrefix;
}

export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;
