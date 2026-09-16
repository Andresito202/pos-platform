import { z } from "zod";

export const DeviceRegistryStatusSchema = z.enum(["PENDING", "ACTIVE", "REVOKED", "COMPROMISED", "RETIRED"]);
export type DeviceRegistryStatus = z.infer<typeof DeviceRegistryStatusSchema>;

export const DeviceRegistrationSchema = z.object({
  device_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  company_id: z.string().uuid(),
  device_key_id: z.string().min(1).max(128),
  device_public_key: z.string().min(1),
  device_public_key_algorithm: z.literal("Ed25519"),
  registered_at: z.string().datetime({ offset: true }),
  status: DeviceRegistryStatusSchema,
  credential_generation: z.number().int().positive(),
  trust_key_id: z.string().min(1).max(128),
  trust_key_purpose: z.literal("DEVICE_TRUST"),
});
export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;

export const DeviceRegistryEnrollmentRequestSchema = z.object({
  activation_id: z.string().uuid(),
  device_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  company_id: z.string().uuid(),
  device_key_id: z.string().min(1).max(128),
  device_public_key: z.string().min(1),
  device_public_key_algorithm: z.literal("Ed25519"),
  request_nonce: z.string().min(32).max(256),
  request_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  proof_signature: z.string().min(1),
  trust_key_id: z.string().min(1).max(128),
  trust_key_purpose: z.literal("DEVICE_TRUST"),
});
export type DeviceRegistryEnrollmentRequest = z.infer<typeof DeviceRegistryEnrollmentRequestSchema>;

export const DeviceCredentialSchema = z.object({
  credential_id: z.string().uuid(),
  device_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  company_id: z.string().uuid(),
  device_key_id: z.string().min(1).max(128),
  trust_key_id: z.string().min(1).max(128),
  key_purpose: z.literal("DEVICE_TRUST"),
  status: z.enum(["ACTIVE", "REVOKED", "COMPROMISED", "RETIRED"]),
  generation: z.number().int().positive(),
  issued_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  credential_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  issuer_signature: z.string().min(1),
});
export type DeviceCredential = z.infer<typeof DeviceCredentialSchema>;

export const DeviceAuthenticationRequestSchema = z.object({
  device_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  company_id: z.string().uuid(),
  credential_id: z.string().uuid(),
  challenge: z.string().min(32).max(512),
  proof_signature: z.string().min(1),
});
export type DeviceAuthenticationRequest = z.infer<typeof DeviceAuthenticationRequestSchema>;
