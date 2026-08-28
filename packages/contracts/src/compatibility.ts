import * as z from "zod";

export const ContractBoundarySchema = z.enum(["IPC", "SYNC", "HTTP"]);

export const SharedInvariantSchema = z.enum([
  "PROTOCOL_VERSION",
  "REQUEST_ID",
  "CORRELATION_ID",
  "OPERATION_ID",
  "IDEMPOTENCY_KEY",
  "ERROR_CATEGORY",
  "UNKNOWN_OUTCOME",
  "UTC_TIMESTAMP",
  "UUID_CANONICALIZATION",
]);

export const InvariantRepresentationSchema = z.enum([
  "ENVELOPE",
  "PAYLOAD",
  "HEADER_AND_ENVELOPE",
  "RESULT",
  "NOT_APPLICABLE",
]);

export const BoundaryCompatibilityEntrySchema = z.strictObject({
  boundary: ContractBoundarySchema,
  protocol_version: InvariantRepresentationSchema,
  request_id: InvariantRepresentationSchema,
  correlation_id: InvariantRepresentationSchema,
  operation_id: InvariantRepresentationSchema,
  idempotency_key: InvariantRepresentationSchema,
  error_category: InvariantRepresentationSchema,
  unknown_outcome: InvariantRepresentationSchema,
  utc_timestamp: InvariantRepresentationSchema,
  uuid_canonicalization: InvariantRepresentationSchema,
});

export const CONTRACT_BOUNDARY_COMPATIBILITY = z.array(BoundaryCompatibilityEntrySchema)
  .length(3)
  .parse([
    {
      boundary: "IPC",
      protocol_version: "ENVELOPE",
      request_id: "ENVELOPE",
      correlation_id: "ENVELOPE",
      operation_id: "PAYLOAD",
      idempotency_key: "PAYLOAD",
      error_category: "ENVELOPE",
      unknown_outcome: "RESULT",
      utc_timestamp: "ENVELOPE",
      uuid_canonicalization: "ENVELOPE",
    },
    {
      boundary: "SYNC",
      protocol_version: "PAYLOAD",
      request_id: "NOT_APPLICABLE",
      correlation_id: "PAYLOAD",
      operation_id: "PAYLOAD",
      idempotency_key: "PAYLOAD",
      error_category: "NOT_APPLICABLE",
      unknown_outcome: "NOT_APPLICABLE",
      utc_timestamp: "PAYLOAD",
      uuid_canonicalization: "PAYLOAD",
    },
    {
      boundary: "HTTP",
      protocol_version: "HEADER_AND_ENVELOPE",
      request_id: "HEADER_AND_ENVELOPE",
      correlation_id: "HEADER_AND_ENVELOPE",
      operation_id: "ENVELOPE",
      idempotency_key: "HEADER_AND_ENVELOPE",
      error_category: "ENVELOPE",
      unknown_outcome: "RESULT",
      utc_timestamp: "ENVELOPE",
      uuid_canonicalization: "HEADER_AND_ENVELOPE",
    },
  ]);

export type ContractBoundary = z.infer<typeof ContractBoundarySchema>;
export type SharedInvariant = z.infer<typeof SharedInvariantSchema>;
export type BoundaryCompatibilityEntry = z.infer<typeof BoundaryCompatibilityEntrySchema>;
