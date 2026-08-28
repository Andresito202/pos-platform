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
}).superRefine((claims, context) => {
  if (new Set(claims.entitlements).size !== claims.entitlements.length) {
    context.addIssue({ code: "custom", path: ["entitlements"], message: "entitlements must be unique" });
  }
  const issued = Date.parse(claims.issued_at); const notBefore = Date.parse(claims.not_before);
  if (issued > notBefore) context.addIssue({ code: "custom", path: ["not_before"], message: "not_before cannot precede issued_at" });
  if (claims.expires_at !== null && Date.parse(claims.expires_at) < notBefore) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "expires_at cannot precede not_before" });
  }
  if (claims.offline_grace_until !== null && claims.expires_at !== null && Date.parse(claims.offline_grace_until) < Date.parse(claims.expires_at)) {
    context.addIssue({ code: "custom", path: ["offline_grace_until"], message: "offline grace cannot precede expiry" });
  }
});
export const SignedLicenseSchema = z.strictObject({
  claims: LicenseClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export type LicenseClaims = z.infer<typeof LicenseClaimsSchema>;
export type SignedLicense = z.infer<typeof SignedLicenseSchema>;
