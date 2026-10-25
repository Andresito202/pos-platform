import * as z from "zod";
import {authorizationTrustFields,validateAuthorizationTrustSet} from "./authorization-trust-fields.js";
import { canonicalSessionTrustJson } from "./session-trust.js";

/** Approved deployment contract. LAB envelopes cannot satisfy this schema.
 * The recipient is part of the root signature, not transport metadata. */
export const AuthorizationTrustRecipientSchema=z.strictObject({
  tenant_id:z.uuid(),company_id:z.uuid(),branch_id:z.uuid(),installation_id:z.uuid(),device_id:z.uuid(),
});
export const AuthorizationTrustClaimsSchema=z.strictObject({
  ...authorizationTrustFields,
  profile:z.literal("CAMACHO_SAS_TRUST_V1"),mode:z.literal("DEPLOYMENT"),
  environment:z.enum(["PREPRODUCTION","PRODUCTION"]),recipient:AuthorizationTrustRecipientSchema,
}).superRefine(validateAuthorizationTrustSet);
export const SignedAuthorizationTrustSchema=z.strictObject({claims:AuthorizationTrustClaimsSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)});
export type AuthorizationTrustClaims=z.infer<typeof AuthorizationTrustClaimsSchema>;
export type SignedAuthorizationTrust=z.infer<typeof SignedAuthorizationTrustSchema>;
export function unsignedAuthorizationTrustBytes(claims:AuthorizationTrustClaims):Buffer{
  return Buffer.from(canonicalSessionTrustJson(AuthorizationTrustClaimsSchema.parse(claims)));
}
