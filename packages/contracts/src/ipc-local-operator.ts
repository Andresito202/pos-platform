import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";

/**
 * Local operator password login is not a BUSINESS/SSA grant.
 * Messages use an authenticated Local Service transport, not renderer claims.
 * Production authorization continues to require signed SSA + SAS.
 */
export const LocalOperatorLoginRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(512),
  }),
).safeExtend({ message_type: z.literal("local.operator.login") });

export const LocalOperatorSessionRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({}),
).safeExtend({ message_type: z.literal("local.operator.session") });

export const LocalOperatorLogoutRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({}),
).safeExtend({ message_type: z.literal("local.operator.logout") });

export const LocalOperatorResultSchema = z.strictObject({
  outcome: z.enum(["AUTHENTICATED", "DENIED", "RATE_LIMITED", "NO_SESSION", "SIGNED_OUT", "UNAVAILABLE"]),
  username: z.string().nullable(),
  role: z.enum(["ADMINISTRADOR","SUPERVISOR","CAJERO","SUPERADMINISTRADOR"]).nullable(),
  expires_at: z.iso.datetime().nullable(),
});

export const LocalOperatorResponseSchema = createResponseEnvelopeSchema(LocalOperatorResultSchema);
