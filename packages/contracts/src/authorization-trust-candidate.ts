import * as z from "zod";
import { canonicalSessionTrustJson } from "./session-trust.js";
import {authorizationTrustFields,validateAuthorizationTrustSet} from "./authorization-trust-fields.js";

/** DEC-011 candidate, deliberately impossible to parse as a production profile.
 * Approval of this laboratory experiment is not approval of a wire protocol. */
export const AuthorizationTrustCandidateClaimsSchema = z.strictObject({
  ...authorizationTrustFields,
  profile: z.literal("DEC011_LAB_CANDIDATE_1"),
  mode: z.literal("ISOLATED_VALIDATION"),
  environment: z.literal("isolated-validation"),
}).superRefine(validateAuthorizationTrustSet);

export const SignedAuthorizationTrustCandidateSchema = z.strictObject({
  claims: AuthorizationTrustCandidateClaimsSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type AuthorizationTrustCandidateClaims = z.infer<typeof AuthorizationTrustCandidateClaimsSchema>;
export type SignedAuthorizationTrustCandidate = z.infer<typeof SignedAuthorizationTrustCandidateSchema>;
export function unsignedAuthorizationTrustCandidateBytes(claims: AuthorizationTrustCandidateClaims): Buffer {
  return Buffer.from(canonicalSessionTrustJson(AuthorizationTrustCandidateClaimsSchema.parse(claims)));
}
