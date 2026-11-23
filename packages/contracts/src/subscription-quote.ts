import * as z from "zod";
import { UuidV7Schema, UuidSchema, UtcDateTimeSchema } from "./primitives.js";
import { LicenseOfferSelectionSchema } from "./license-offer.js";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Customer/admin selection only: no price, tax, paid flag or entitlement input. */
export const SubscriptionQuoteRequestSchema=z.strictObject({
  id:UuidV7Schema,tenant_id:UuidSchema,company_id:UuidSchema,plan_id:UuidV7Schema,
  plan_version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),selection:LicenseOfferSelectionSchema,
  idempotency_key:z.string().min(1).max(128),correlation_id:UuidV7Schema,
});
/** Internal Tax/contract-policy output, never accepted from an HTTP request.
 * Amounts and time windows are explicit. No default VAT, term or currency scale. */
export const SubscriptionQuoteTermsSchema=z.strictObject({
  policy_reference:z.string().min(1).max(256),tax_policy_reference:z.string().min(1).max(256),
  support_policy_reference:z.string().min(1).max(256),customer_verification_reference:z.string().min(1).max(256),
  tax_mode:z.enum(["INCLUDED","EXCLUDED"]),tax_minor:minor,currency_exponent:z.number().int().min(0).max(6),
  service_from:UtcDateTimeSchema,service_until:UtcDateTimeSchema.nullable(),support_until:UtcDateTimeSchema.nullable(),
  expires_at:UtcDateTimeSchema,
});
/**
 * GLOBAL records verified collection evidence against an already opened
 * subscription payment. Amounts stay quote-owned; the client cannot submit a
 * payable total or invent entitlements.
 */
export const SubscriptionPaymentConfirmRequestSchema=z.strictObject({
  payment_id:UuidSchema,
  observation_reference:z.string().trim().min(1).max(160),
  correlation_id:UuidV7Schema,
});
/** Platform merchant binding for subscription QR/FACTUS collection. Provision only. */
export const SubscriptionCollectionBindingSchema=z.strictObject({
  tenant_id:UuidSchema,company_id:UuidSchema,branch_id:UuidSchema,integration_id:UuidSchema,
});
export type SubscriptionQuoteRequest=z.infer<typeof SubscriptionQuoteRequestSchema>;
export type SubscriptionQuoteTerms=z.infer<typeof SubscriptionQuoteTermsSchema>;
export type SubscriptionPaymentConfirmRequest=z.infer<typeof SubscriptionPaymentConfirmRequestSchema>;
export type SubscriptionCollectionBinding=z.infer<typeof SubscriptionCollectionBindingSchema>;
