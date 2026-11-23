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
 * GLOBAL asks Central to verify an opened subscription payment against the
 * authoritative Factus Pay channel (provider GET and/or signed webhook inbox).
 * Free-text references are rejected: they never confirm a payment.
 */
export const SubscriptionPaymentVerifyRequestSchema=z.strictObject({
  payment_id:UuidSchema,
  correlation_id:UuidV7Schema,
});
/** @deprecated Manual observation references are not authoritative; use verify. */
export const SubscriptionPaymentConfirmRequestSchema=SubscriptionPaymentVerifyRequestSchema;
/** Platform merchant binding for subscription QR/FACTUS collection. Provision only. */
export const SubscriptionCollectionBindingSchema=z.strictObject({
  tenant_id:UuidSchema,company_id:UuidSchema,branch_id:UuidSchema,integration_id:UuidSchema,
});
export type SubscriptionQuoteRequest=z.infer<typeof SubscriptionQuoteRequestSchema>;
export type SubscriptionQuoteTerms=z.infer<typeof SubscriptionQuoteTermsSchema>;
export type SubscriptionPaymentVerifyRequest=z.infer<typeof SubscriptionPaymentVerifyRequestSchema>;
export type SubscriptionPaymentConfirmRequest=SubscriptionPaymentVerifyRequest;
export type SubscriptionCollectionBinding=z.infer<typeof SubscriptionCollectionBindingSchema>;
