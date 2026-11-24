import * as z from "zod";
import { UuidSchema, UuidV7Schema } from "./primitives.js";
import { CashRegisterMasterRowSchema } from "./master-snapshot.js";
import { LicenseActivationPolicySchema } from "./license-activation.js";

export const BUSINESS_API = "/v1/business/";
const positive = z.number().int().positive().max(2_147_483_647);
const email = z.email().max(320);
export const BusinessLoginBeginSchema = z.strictObject({
  email, password: z.string().min(1).max(1024),
  /** Required when Central provision sets turnstile_secret_file (public web). */
  turnstileToken: z.string().min(1).max(2048).optional(),
});
export const BusinessLoginCompleteSchema = z.strictObject({
  email, password: z.string().min(1).max(1024),
  challenge: z.string().min(1).max(128), response: z.unknown(),
  tenantId: UuidSchema, membershipId: UuidSchema,
});
export const BusinessScopeSchema = z.strictObject({ companyId: UuidSchema, branchId: UuidSchema, licenseId: UuidSchema });
const label = z.string().trim().min(1);
export const CashRegisterCreateSchema = BusinessScopeSchema.extend({
  id: UuidV7Schema, code: label.max(64), name: label.max(200), currency: z.string().regex(/^[A-Z]{3}$/), correlationId: UuidV7Schema,
});
export type CashRegisterCreateRequest = z.infer<typeof CashRegisterCreateSchema>;
export const CashRegisterEditSchema = BusinessScopeSchema.extend({
  id: UuidSchema, expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), code: label.max(64), name: label.max(200), correlationId: UuidV7Schema,
});
export const CashRegisterRetireSchema = BusinessScopeSchema.extend({ id: UuidSchema, expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), correlationId: UuidV7Schema });
export const CashRegisterPageRequestSchema = BusinessScopeSchema.extend({ after: UuidSchema.nullable() });
export const CashRegisterPageSchema = z.strictObject({ registers: z.array(CashRegisterMasterRowSchema).max(100), nextCursor: UuidSchema.nullable() });
export const BusinessContextsSchema = z.strictObject({ contexts: z.array(BusinessScopeSchema.extend({
  companyName: z.string(), branchName: z.string(), licenseName: z.string(), currency: z.string().regex(/^[A-Z]{3}$/),
})).max(100), truncated: z.boolean() });

/** Operator-managed policy; no default timeouts, GLOBAL provision or client policy. */
export const BusinessAdministrationProvisionSchema = z.strictObject({
  profile: z.literal("CAMACHO_BUSINESS_ADMINISTRATION_V1"),
  origin: z.url().refine(s => new URL(s).protocol === "https:" && new URL(s).origin === s),
  expected_database: z.literal("camacho_pos"), rp_id: z.string().min(1).max(253),
  rejection_verifier_file: z.string().min(1).max(4096),
  migration_checksums: z.strictObject(Object.fromEntries([
    "013_business_browser_sessions", "015_authorization_snapshot_sequences", "019_subscription_quotes",
    "020_subscription_payments", "022_license_activations", "023_license_offer_terms",
    "029_cash_register_master", "030_commercial_authorization_catalog", "031_business_owner_role", "032_tenant_initialization_permission", "033_cash_register_license_bindings",
  ].map(id => [id, z.string().regex(/^[a-f0-9]{64}$/)])) as Record<string, z.ZodString>),
  license_policy: LicenseActivationPolicySchema,
  renderer: z.strictObject({ directory: z.string().min(1).max(4096), maximum_asset_bytes: positive }),
  /** Absolute path to Cloudflare Turnstile secret; paired with turnstile_site_key. */
  turnstile_secret_file: z.string().min(1).max(4096).optional(),
  /** Public site key served to same-origin browser clients when Turnstile is enabled. */
  turnstile_site_key: z.string().min(10).max(128).optional(),
  limits: z.strictObject({ challenge_ms: positive, session_ms: positive, browser_ms: positive, mfa_age_ms: positive,
    reauthentication_ms: positive, idle_ms: positive, sql_lock_ms: positive, sql_statement_ms: positive,
    maximum_body_bytes: positive, maximum_pending_flows: positive, requests_per_window: positive,
    maximum_buckets: positive, request_window_ms: positive, maximum_login_per_account: positive,
    login_window_ms: positive, maximum_login_per_address: positive }),
}).superRefine((p, ctx) => {
  const l = p.limits;
  if (new URL(p.origin).hostname !== p.rp_id || l.sql_statement_ms <= l.sql_lock_ms || l.browser_ms > l.session_ms ||
      l.mfa_age_ms > l.session_ms || l.reauthentication_ms > 300_000 || l.maximum_body_bytes > 65536 ||
      Math.min(l.challenge_ms,l.session_ms,l.browser_ms) < 1000) {
    ctx.addIssue({ code: "custom", message: "BUSINESS_POLICY_INVALID" });
  }
  if ((p.turnstile_secret_file !== undefined) !== (p.turnstile_site_key !== undefined)) {
    ctx.addIssue({ code: "custom", message: "BUSINESS_TURNSTILE_PAIR_REQUIRED" });
  }
});
export type BusinessAdministrationProvision = z.infer<typeof BusinessAdministrationProvisionSchema>;
