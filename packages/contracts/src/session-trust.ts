import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema } from "./primitives.js";

/**
 * Trust purpose for the Ed25519 key that signs Session Assertions (SSA).
 * This is deliberately distinct from DEVICE_TRUST, licensing, snapshots and
 * update/signing trust. A key with another purpose is not a session authority.
 */
export const SessionAssertionKeyPurposeSchema = z.literal("SESSION_ASSERTION");
export type SessionAssertionKeyPurpose = z.infer<typeof SessionAssertionKeyPurposeSchema>;

export const SessionAssertionKeyStatusSchema = z.enum([
  "ACTIVE",
  "VERIFY_ONLY",
  "REVOKED",
]);
export type SessionAssertionKeyStatus = z.infer<typeof SessionAssertionKeyStatusSchema>;

/**
 * Public operational key material distributed to the Local Service.
 *
 * The signature covers exactly these claims. The root trust anchor is external
 * to this contract and must be verified out-of-band as required by DEC-022.
 */
export const SessionAssertionOperationalKeyClaimsSchema = z.strictObject({
  key_id: StableCodeSchema,
  key_purpose: SessionAssertionKeyPurposeSchema,
  environment: StableCodeSchema,
  public_key_pem: z.string().min(80).max(4096),
  status: SessionAssertionKeyStatusSchema,
  valid_from: UtcDateTimeSchema,
  valid_until: UtcDateTimeSchema.nullable(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).superRefine((claims, context) => {
  if (claims.valid_until !== null && Date.parse(claims.valid_until) <= Date.parse(claims.valid_from)) {
    context.addIssue({
      code: "custom",
      path: ["valid_until"],
      message: "valid_until must be later than valid_from",
    });
  }
});

export const SignedSessionAssertionOperationalKeySchema = z.strictObject({
  claims: SessionAssertionOperationalKeyClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export type SessionAssertionOperationalKeyClaims = z.infer<typeof SessionAssertionOperationalKeyClaimsSchema>;
export type SignedSessionAssertionOperationalKey = z.infer<typeof SignedSessionAssertionOperationalKeySchema>;

export function unsignedSessionAssertionOperationalKeyBytes(
  claims: SessionAssertionOperationalKeyClaims,
): Buffer {
  return Buffer.from(canonicalSessionTrustJson(SessionAssertionOperationalKeyClaimsSchema.parse(claims)));
}

/** Canonical JSON used by the session-trust signature boundary. */
export function canonicalSessionTrustJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not valid session trust payloads");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSessionTrustJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSessionTrustJson(item)}`).join(",")}}`;
  }
  throw new Error("unsupported session trust payload value");
}
