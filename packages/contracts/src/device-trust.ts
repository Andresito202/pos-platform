import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";

export const DeviceTrustKeyPurposeSchema = z.literal("DEVICE_TRUST");
export const DeviceTrustKeyStatusSchema = z.enum(["ACTIVE", "VERIFY_ONLY", "REVOKED"]);

const PublicKeyPemSchema = z.string().min(80).max(4096);
const SignatureSchema = z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** Public operational key authorized by the embedded root trust anchor. */
export const DeviceTrustOperationalKeyClaimsSchema = z.strictObject({
  key_id: StableCodeSchema,
  key_purpose: DeviceTrustKeyPurposeSchema,
  public_key_pem: PublicKeyPemSchema,
  status: DeviceTrustKeyStatusSchema,
  valid_from: UtcDateTimeSchema,
  version: z.number().int().positive(),
});

export const SignedDeviceTrustOperationalKeySchema = z.strictObject({
  claims: DeviceTrustOperationalKeyClaimsSchema,
  signature: SignatureSchema,
});

/** Device credential issued after a successful enrollment. */
export const DeviceTrustCredentialClaimsSchema = z.strictObject({
  credential_id: UuidSchema,
  key_id: StableCodeSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  device_public_key_pem: PublicKeyPemSchema,
  issued_at: UtcDateTimeSchema,
  not_before: UtcDateTimeSchema,
  expires_at: UtcDateTimeSchema.nullable(),
  version: z.number().int().positive(),
}).superRefine((claims, context) => {
  if (Date.parse(claims.issued_at) > Date.parse(claims.not_before)) {
    context.addIssue({ code: "custom", path: ["not_before"], message: "not_before cannot precede issued_at" });
  }
  if (claims.expires_at !== null && Date.parse(claims.expires_at) < Date.parse(claims.not_before)) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "expires_at cannot precede not_before" });
  }
});

export const SignedDeviceTrustCredentialSchema = z.strictObject({
  claims: DeviceTrustCredentialClaimsSchema,
  signature: SignatureSchema,
});

export const DeviceTrustChallengeSchema = z.strictObject({
  challenge_id: UuidSchema,
  tenant_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  nonce: z.string().min(43).max(86).regex(/^[A-Za-z0-9_-]+$/),
  issued_at: UtcDateTimeSchema,
  expires_at: UtcDateTimeSchema,
});

export const DeviceTrustProofSchema = z.strictObject({
  credential_id: UuidSchema,
  key_id: StableCodeSchema,
  challenge_id: UuidSchema,
  signature: SignatureSchema,
});

export type DeviceTrustOperationalKeyClaims = z.infer<typeof DeviceTrustOperationalKeyClaimsSchema>;
export type SignedDeviceTrustOperationalKey = z.infer<typeof SignedDeviceTrustOperationalKeySchema>;
export type DeviceTrustCredentialClaims = z.infer<typeof DeviceTrustCredentialClaimsSchema>;
export type SignedDeviceTrustCredential = z.infer<typeof SignedDeviceTrustCredentialSchema>;
export type DeviceTrustChallenge = z.infer<typeof DeviceTrustChallengeSchema>;
export type DeviceTrustProof = z.infer<typeof DeviceTrustProofSchema>;
