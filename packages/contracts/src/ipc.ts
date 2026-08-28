import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";
import { RuntimeCompatibilitySnapshotSchema, RuntimeHandshakeOutcomeSchema } from "./handshake.js";
import {
  ContractVersionSchema,
  IdempotencyKeySchema,
  StableCodeSchema,
  VersionIdentifierSchema,
  UuidSchema,
} from "./primitives.js";

export const IpcMessageTypeSchema = z.enum([
  "runtime.handshake",
  "runtime.status.get",
  "operation.result.get",
]);

const EmptyPayloadSchema = z.strictObject({});

export const RuntimeHandshakeRequestSchema = createRequestEnvelopeSchema(
  RuntimeCompatibilitySnapshotSchema,
).safeExtend({ message_type: z.literal("runtime.handshake") });

export const RuntimeHandshakeResponseSchema = createResponseEnvelopeSchema(RuntimeHandshakeOutcomeSchema);

export const RuntimeStatusRequestSchema = createRequestEnvelopeSchema(
  EmptyPayloadSchema,
).safeExtend({ message_type: z.literal("runtime.status.get") });

export const RuntimeStatusResultSchema = z.strictObject({
  service_version: ContractVersionSchema,
  protocol_version: ContractVersionSchema,
  service_state: StableCodeSchema,
  schema_version: VersionIdentifierSchema,
});

export const RuntimeStatusResponseSchema = createResponseEnvelopeSchema(RuntimeStatusResultSchema);

export const OperationResultQuerySchema = z.strictObject({
  operation_id: UuidSchema,
  idempotency_key: IdempotencyKeySchema,
});

export const OperationResultRequestSchema = createRequestEnvelopeSchema(
  OperationResultQuerySchema,
).safeExtend({ message_type: z.literal("operation.result.get") });

export const OperationResultStatusSchema = z.enum([
  "NOT_FOUND",
  "PENDING",
  "SUCCEEDED",
  "REJECTED",
  "UNKNOWN",
]);

export const OperationResultSchema = z.strictObject({
  operation_id: UuidSchema,
  idempotency_key: IdempotencyKeySchema,
  status: OperationResultStatusSchema,
  result_code: StableCodeSchema,
});

export const OperationResultResponseSchema = createResponseEnvelopeSchema(OperationResultSchema);

export type IpcMessageType = z.infer<typeof IpcMessageTypeSchema>;
export type OperationResultQuery = z.infer<typeof OperationResultQuerySchema>;


export const IpcRequestSchema = z.union([
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
  OperationResultRequestSchema,
]);

export const IpcResponseSchema = z.union([
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  OperationResultResponseSchema,
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;
