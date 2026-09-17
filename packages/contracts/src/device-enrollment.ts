import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";
import { DeviceTrustChallengeSchema } from "./device-trust.js";

export const EnrollmentActivationStatusSchema = z.enum(["ISSUED", "CONSUMED", "REVOKED", "EXPIRED"]);
export const EnrollmentResultStatusSchema = z.enum(["ENROLLED", "REJECTED"]);

const EnrollmentSignatureSchema = z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/);

export const DeviceEnrollmentActivationSchema = z.strictObject({
  activation_id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  activation_secret: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  status: EnrollmentActivationStatusSchema,
  issued_at: UtcDateTimeSchema,
  expires_at: UtcDateTimeSchema,
  version: z.number().int().positive(),
}).superRefine((value, context) => {
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "expires_at must be after issued_at" });
  }
});

/** Proof used before a credential exists. It binds the device key to the challenge carried by this request. */
export const DeviceEnrollmentProofSchema = z.strictObject({
  challenge_id: UuidSchema,
  device_key_id: StableCodeSchema,
  signature: EnrollmentSignatureSchema,
});

export const DeviceEnrollmentRequestSchema = z.strictObject({
  activation_id: UuidSchema,
  activation_secret: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  device_key_id: StableCodeSchema,
  device_public_key_pem: z.string().min(80).max(4096),
  challenge: DeviceTrustChallengeSchema,
  proof: DeviceEnrollmentProofSchema,
  requested_at: UtcDateTimeSchema,
  version: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.proof.challenge_id !== value.challenge.challenge_id) {
    context.addIssue({ code: "custom", path: ["proof", "challenge_id"], message: "proof challenge_id must match challenge" });
  }
  if (value.proof.device_key_id !== value.device_key_id) {
    context.addIssue({ code: "custom", path: ["proof", "device_key_id"], message: "proof device_key_id must match request device_key_id" });
  }
  if (value.challenge.tenant_id !== value.tenant_id || value.challenge.installation_id !== value.installation_id || value.challenge.device_id !== value.device_id) {
    context.addIssue({ code: "custom", path: ["challenge"], message: "challenge binding must match enrollment request" });
  }
});

export const DeviceEnrollmentResultSchema = z.strictObject({
  status: EnrollmentResultStatusSchema,
  activation_id: UuidSchema,
  credential_id: UuidSchema.nullable(),
  enrolled_at: UtcDateTimeSchema,
  reason: z.string().max(512).nullable(),
  version: z.number().int().positive(),
});

export type DeviceEnrollmentActivation = z.infer<typeof DeviceEnrollmentActivationSchema>;
export type DeviceEnrollmentProof = z.infer<typeof DeviceEnrollmentProofSchema>;
export type DeviceEnrollmentRequest = z.infer<typeof DeviceEnrollmentRequestSchema>;
export type DeviceEnrollmentResult = z.infer<typeof DeviceEnrollmentResultSchema>;
