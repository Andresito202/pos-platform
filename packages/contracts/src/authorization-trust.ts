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

/** Both roots sign the same complete transition; a public PEM alone is never
 * a rotation request. Expiry bounds acceptance, not already accepted history. */
export const AuthorizationRootTransitionClaimsSchema=z.strictObject({
  profile:z.literal("CAMACHO_SAS_ROOT_TRANSITION_V1"),purpose:z.literal("AUTHORIZATION_TRUST_ROOT_TRANSITION"),
  issuer:authorizationTrustFields.issuer,authority_id:authorizationTrustFields.authority_id,
  environment:z.enum(["PREPRODUCTION","PRODUCTION"]),recipient:AuthorizationTrustRecipientSchema,
  old_root_spki_sha256:z.string().regex(/^[a-f0-9]{64}$/),new_root_spki_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  new_root_public_key_pem:authorizationTrustFields.keys.element.shape.public_key_pem,
  next_minimum_generation:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issued_at:authorizationTrustFields.issued_at,expires_at:authorizationTrustFields.valid_until,
}).refine(c=>Date.parse(c.expires_at)>Date.parse(c.issued_at),"invalid root transition window");
export const SignedAuthorizationRootTransitionSchema=z.strictObject({claims:AuthorizationRootTransitionClaimsSchema,
  old_signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/),new_signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)});
export type SignedAuthorizationRootTransition=z.infer<typeof SignedAuthorizationRootTransitionSchema>;
export function unsignedAuthorizationRootTransitionBytes(claims:z.infer<typeof AuthorizationRootTransitionClaimsSchema>):Buffer{
  return Buffer.from(canonicalSessionTrustJson(AuthorizationRootTransitionClaimsSchema.parse(claims)));
}
export const AuthorizationTrustDeliverySchema=z.union([SignedAuthorizationTrustSchema,z.strictObject({
  transition:SignedAuthorizationRootTransitionSchema,bundle:SignedAuthorizationTrustSchema,
})]);
/** Internal DPAPI envelope; never accepted as an HTTP delivery. */
export const AuthorizationTrustProtectedStateSchema=z.strictObject({
  profile:z.literal("SAS_TRUST_PROTECTED_STATE_V2"),bundle:SignedAuthorizationTrustSchema,
  transitions:z.array(z.strictObject({transition:SignedAuthorizationRootTransitionSchema,accepted_at:authorizationTrustFields.issued_at})).min(1).max(32),
});
