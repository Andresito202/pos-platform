import * as z from "zod";
import { ContractErrorSchema } from "./errors.js";
import {
  ContractVersionSchema,
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  MessageTypeSchema,
  StableCodeSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./primitives.js";

export const ResponseStatusSchema = z.enum(["SUCCEEDED", "REJECTED", "PENDING", "UNKNOWN"]);

const RequestEnvelopeMetadataSchema = z.strictObject({
  protocol_version: ContractVersionSchema,
  message_type: MessageTypeSchema,
  request_id: UuidSchema,
  correlation_id: UuidSchema,
  causation_id: UuidSchema.optional(),
  operation_id: UuidSchema.optional(),
  idempotency_key: IdempotencyKeySchema.optional(),
  tenant_id: UuidSchema.optional(),
  company_id: UuidSchema.optional(),
  branch_id: UuidSchema.optional(),
  device_id: UuidSchema.optional(),
  actor_id: UuidSchema.optional(),
  expected_version: ExpectedVersionSchema.optional(),
  payload_schema_version: ContractVersionSchema,
});

export function createRequestEnvelopeSchema<T extends z.ZodType>(payloadSchema: T) {
  return RequestEnvelopeMetadataSchema.extend({ payload: payloadSchema }).superRefine((request, context) => {
    if (request.idempotency_key !== undefined && request.operation_id === undefined) {
      context.addIssue({
        code: "custom",
        path: ["operation_id"],
        message: "operation_id is required when idempotency_key is present",
      });
    }
  });
}

export const RequestEnvelopeSchema = createRequestEnvelopeSchema(z.json());

const ResponseEnvelopeMetadataSchema = z.strictObject({
  protocol_version: ContractVersionSchema,
  request_id: UuidSchema,
  correlation_id: UuidSchema,
  operation_id: UuidSchema.nullable(),
  status: ResponseStatusSchema,
  result_code: StableCodeSchema,
  result_schema_version: ContractVersionSchema,
  error: ContractErrorSchema.nullable(),
  server_time: UtcDateTimeSchema,
});

export function createResponseEnvelopeSchema<T extends z.ZodType>(resultSchema: T) {
  return ResponseEnvelopeMetadataSchema.extend({ result: resultSchema.nullable() }).superRefine((response, context) => {
    if (response.status === "SUCCEEDED" && response.error !== null) {
      context.addIssue({ code: "custom", path: ["error"], message: "SUCCEEDED responses cannot contain an error" });
    }
    if (response.status === "REJECTED" && response.error === null) {
      context.addIssue({ code: "custom", path: ["error"], message: "REJECTED responses require an error" });
    }
    if (response.status === "UNKNOWN" && response.error !== null && response.error.category !== "UNKNOWN_OUTCOME") {
      context.addIssue({
        code: "custom",
        path: ["error", "category"],
        message: "UNKNOWN responses may only carry UNKNOWN_OUTCOME errors",
      });
    }
  });
}

export const ResponseEnvelopeSchema = createResponseEnvelopeSchema(z.json());

export type ResponseStatus = z.infer<typeof ResponseStatusSchema>;
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
