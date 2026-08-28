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

function exactMessage<T extends z.ZodType>(messageType: z.infer<typeof IpcMessageTypeSchema>, schema: T) {
  return schema.refine(
    (value) => typeof value === "object" && value !== null && "message_type" in value
      && value.message_type === messageType,
    { path: ["message_type"], message: `message_type must be ${messageType}` },
  );
}

const EmptyPayloadSchema = z.strictObject({});

export const RuntimeHandshakeRequestSchema = exactMessage(
  "runtime.handshake",
  createRequestEnvelopeSchema(RuntimeCompatibilitySnapshotSchema),
);

export const RuntimeHandshakeResponseSchema = createResponseEnvelopeSchema(RuntimeHandshakeOutcomeSchema);

export const RuntimeStatusRequestSchema = exactMessage(
  "runtime.status.get",
  createRequestEnvelopeSchema(EmptyPayloadSchema),
);

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

export const OperationResultRequestSchema = exactMessage(
  "operation.result.get",
  createRequestEnvelopeSchema(OperationResultQuerySchema),
);

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
