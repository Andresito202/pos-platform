import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";

export const EnrollmentActivationStatusSchema = z.enum(["ISSUED", "CONSUMED", "REVOKED", "EXPIRED"]);
export const EnrollmentResultStatusSchema = z.enum(["ENROLLED", "REJECTED"]);

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

export const DeviceEnrollmentRequestSchema = z.strictObject({
  activation_id: UuidSchema,
  activation_secret: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  device_key_id: StableCodeSchema,
  device_public_key_pem: z.string().min(80).max(4096),
  requested_at: UtcDateTimeSchema,
  version: z.number().int().positive(),
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
export type DeviceEnrollmentRequest = z.infer<typeof DeviceEnrollmentRequestSchema>;
export type DeviceEnrollmentResult = z.infer<typeof DeviceEnrollmentResultSchema>;
