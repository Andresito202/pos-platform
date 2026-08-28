import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";

export const LicenseModeSchema = z.enum(["HYBRID", "LOCAL_PERPETUAL"]);
export const LicenseClaimsSchema = z.strictObject({
  license_id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  mode: LicenseModeSchema,
  entitlements: z.array(StableCodeSchema).max(256),
  issued_at: UtcDateTimeSchema,
  not_before: UtcDateTimeSchema,
  expires_at: UtcDateTimeSchema.nullable(),
  offline_grace_until: UtcDateTimeSchema.nullable(),
  key_id: StableCodeSchema,
});
export const SignedLicenseSchema = z.strictObject({
  claims: LicenseClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export type LicenseClaims = z.infer<typeof LicenseClaimsSchema>;
export type SignedLicense = z.infer<typeof SignedLicenseSchema>;
