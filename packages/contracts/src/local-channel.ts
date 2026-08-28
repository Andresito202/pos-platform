import * as z from "zod";
import { ContractVersionSchema, Sha256HexSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";

export const LocalChannelFrameSchema = z.strictObject({
  protocol_version: ContractVersionSchema,
  session_id: UuidSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().min(22).max(64).regex(/^[A-Za-z0-9_-]+$/),
  sent_at: UtcDateTimeSchema,
  payload: z.json(),
  mac: Sha256HexSchema,
});
export type LocalChannelFrame = z.infer<typeof LocalChannelFrameSchema>;
