import * as z from "zod";
import {UuidV7Schema,UuidSchema,StableCodeSchema} from "./primitives.js";
export const LicenseAllocationRequestSchema=z.strictObject({
  license_id:UuidSchema,credential_id:UuidSchema,idempotency_key:UuidV7Schema,correlation_id:UuidV7Schema,
  allocations:z.array(z.strictObject({register_id:UuidSchema,branch_id:UuidSchema})).min(1).max(10001),
}).refine(r=>new Set(r.allocations.map(a=>a.register_id)).size===r.allocations.length,"Duplicate cash register");
/** Trusted operator policy, never an HTTP request. No prices/tax/support defaults. */
export const LicenseActivationPolicySchema=z.strictObject({
  profile:z.literal("CAMACHO_LICENSE_ACTIVATION_V1"),policy_reference:z.string().min(1).max(256),
  subscription_grace_days:z.literal(3),grace_basis:z.literal("ELAPSED_24_HOURS"),
  perpetual_use:z.literal("NO_EXPIRY"),support_and_external_services:z.literal("SEPARATE"),
  accepted_contract_policy_references:z.array(z.string().min(1).max(256)).min(1).max(256),
  offline_capabilities:z.array(StableCodeSchema).max(256),
});
export type LicenseActivationPolicy=z.infer<typeof LicenseActivationPolicySchema>;
export const LicenseActivationProvisionSchema=z.strictObject({
  policy:LicenseActivationPolicySchema,expected_database:z.string().min(1).max(63),migration_checksum:z.string().regex(/^[a-f0-9]{64}$/),
  environment:z.enum(["PREPRODUCTION","PRODUCTION"]),key_id:StableCodeSchema,private_key_file:z.string().min(1).max(4096),
  reauthentication_ms:z.number().int().positive(),sql_lock_ms:z.number().int().positive(),sql_statement_ms:z.number().int().positive(),
  requests_per_window:z.number().int().positive(),maximum_buckets:z.number().int().positive(),request_window_ms:z.number().int().positive(),
}).refine(p=>p.sql_statement_ms>p.sql_lock_ms,"Statement timeout must exceed lock timeout");
