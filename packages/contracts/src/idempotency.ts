import * as z from "zod";
import { IdempotencyKeySchema, Sha256HexSchema, UuidSchema } from "./primitives.js";

export const IdempotencyIdentitySchema = z.strictObject({
  operation_id: UuidSchema,
  idempotency_key: IdempotencyKeySchema,
  payload_checksum: Sha256HexSchema,
});

export const IdempotencyDecisionSchema = z.enum(["DISTINCT", "REPLAY", "CONFLICT"]);

export type IdempotencyIdentity = z.infer<typeof IdempotencyIdentitySchema>;
export type IdempotencyDecision = z.infer<typeof IdempotencyDecisionSchema>;

export function classifyIdempotency(
  existingInput: IdempotencyIdentity,
  incomingInput: IdempotencyIdentity,
): IdempotencyDecision {
  const existing = IdempotencyIdentitySchema.parse(existingInput);
  const incoming = IdempotencyIdentitySchema.parse(incomingInput);

  const sameOperation = existing.operation_id === incoming.operation_id;
  const sameKey = existing.idempotency_key === incoming.idempotency_key;
  const sameChecksum = existing.payload_checksum === incoming.payload_checksum;

  if (!sameOperation && !sameKey) return "DISTINCT";
  if (sameOperation && sameKey && sameChecksum) return "REPLAY";
  return "CONFLICT";
}
