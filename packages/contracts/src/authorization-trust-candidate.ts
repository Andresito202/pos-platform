import * as z from "zod";
import { SessionTrustCodeSchema, canonicalSessionTrustJson } from "./session-trust.js";
import { UtcDateTimeSchema } from "./primitives.js";

/** DEC-011 candidate, deliberately impossible to parse as a production profile.
 * Approval of this laboratory experiment is not approval of a wire protocol. */
const KeySchema = z.strictObject({
  key_id: SessionTrustCodeSchema,
  purpose: z.literal("AUTHORIZATION_SNAPSHOT"),
  // Exactly one public PEM. createPublicKey alone also accepts private PEMs or
  // ignores trailing material, which must never be published in this field.
  public_key_pem: z.string().min(80).max(4096).regex(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/),
  status: z.enum(["ACTIVE", "VERIFY_ONLY", "REVOKED"]),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  valid_from: UtcDateTimeSchema,
  valid_until: UtcDateTimeSchema,
}).refine(k => Date.parse(k.valid_until) > Date.parse(k.valid_from), "invalid key window");

export const AuthorizationTrustCandidateClaimsSchema = z.strictObject({
  profile: z.literal("DEC011_LAB_CANDIDATE_1"),
  mode: z.literal("ISOLATED_VALIDATION"),
  schema_version: z.literal(1),
  purpose: z.literal("AUTHORIZATION_SNAPSHOT"),
  environment: z.literal("isolated-validation"),
  issuer: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  }, "exact HTTPS issuer required"),
  authority_id: SessionTrustCodeSchema,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  complete: z.literal(true),
  issued_at: UtcDateTimeSchema,
  valid_from: UtcDateTimeSchema,
  valid_until: UtcDateTimeSchema,
  // Cumulative public history, including terminal revocation tombstones.
  keys: z.array(KeySchema).min(1).max(128),
}).superRefine((c, ctx) => {
  if (Date.parse(c.valid_until) <= Date.parse(c.valid_from) || Date.parse(c.issued_at) > Date.parse(c.valid_from))
    ctx.addIssue({ code: "custom", message: "invalid bundle window" });
  if (new Set(c.keys.map(k => k.key_id)).size !== c.keys.length)
    ctx.addIssue({ code: "custom", message: "duplicate key identifier" });
});

export const SignedAuthorizationTrustCandidateSchema = z.strictObject({
  claims: AuthorizationTrustCandidateClaimsSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type AuthorizationTrustCandidateClaims = z.infer<typeof AuthorizationTrustCandidateClaimsSchema>;
export type SignedAuthorizationTrustCandidate = z.infer<typeof SignedAuthorizationTrustCandidateSchema>;
export function unsignedAuthorizationTrustCandidateBytes(claims: AuthorizationTrustCandidateClaims): Buffer {
  return Buffer.from(canonicalSessionTrustJson(AuthorizationTrustCandidateClaimsSchema.parse(claims)));
}
