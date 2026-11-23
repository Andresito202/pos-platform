import * as z from "zod";
import { UuidSchema, UuidV7Schema } from "./primitives.js";

const positiveLimit = z.number().int().positive().max(2_147_483_647);

/**
 * Managed Central provision for the official subscription Factus Pay HTTP
 * gateway (GET/open). Credentials stay in a separate managed file.
 */
export const SubscriptionFactusPayGatewayProvisionSchema = z.strictObject({
  profile: z.literal("CAMACHO_SUBSCRIPTION_FACTUS_PAY_GATEWAY_V1"),
  policy_reference: z.string().min(1).max(256),
  environment: z.enum(["SANDBOX", "PRODUCTION"]),
  credential_file: z.string().min(1).max(4096),
  request_timeout_ms: positiveLimit,
  maximum_response_bytes: positiveLimit,
});

export type SubscriptionFactusPayGatewayProvision =
  z.infer<typeof SubscriptionFactusPayGatewayProvisionSchema>;

/** Public durable states for autonomous paid-subscription license fulfillment. */
export const SubscriptionFulfillmentStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "ISSUED",
  "DELIVERY_PENDING",
  "ACTIVATION_PENDING",
]);

export const SubscriptionFulfillmentConfirmationSourceSchema = z.enum([
  "FACTUS_PAY_GET",
  "FACTUS_PAY_WEBHOOK_INBOX",
  "BANK_MANUAL_VERIFIED",
  "PENDING_WEBHOOK",
]);

/**
 * Opt-in deployment provision for the autonomous fulfillment worker.
 * Does not invent GLOBAL sessions or MFA; authority is the managed file +
 * registered 035 schema + pos_platform_app role.
 */
export const SubscriptionFulfillmentProvisionSchema = z.strictObject({
  profile: z.literal("CAMACHO_SUBSCRIPTION_FULFILLMENT_V1"),
  policy_reference: z.string().min(1).max(256),
  expected_database: z.string().min(1).max(63),
  migration_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  lock_timeout_ms: positiveLimit,
  statement_timeout_ms: positiveLimit,
  claim_ttl_ms: positiveLimit,
  poll_interval_ms: positiveLimit,
  max_attempts: positiveLimit.max(100),
  base_backoff_ms: positiveLimit,
  max_backoff_ms: positiveLimit,
}).refine(
  (p) => p.statement_timeout_ms > p.lock_timeout_ms,
  "statement timeout must exceed lock timeout",
).refine(
  (p) => p.max_backoff_ms >= p.base_backoff_ms,
  "max backoff must be at least base backoff",
);

export const SubscriptionFulfillmentJobViewSchema = z.strictObject({
  payment_id: UuidSchema,
  quote_id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  status: SubscriptionFulfillmentStatusSchema,
  confirmation_source: SubscriptionFulfillmentConfirmationSourceSchema,
  attempt_count: z.number().int().nonnegative(),
  last_error_code: z.string().min(1).max(128).nullable(),
  license_id: UuidSchema.nullable(),
  correlation_id: UuidV7Schema,
  next_attempt_at: z.string().datetime({ offset: true }),
  confirmed_at: z.string().datetime({ offset: true }).nullable(),
  issued_at: z.string().datetime({ offset: true }).nullable(),
});

/** Exponential backoff with jitter factor applied by the caller (0..1). */
export function subscriptionFulfillmentBackoffMs(
  attemptCount: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
  jitterRatio = 0,
): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) {
    throw new Error("FULFILLMENT_BACKOFF_ATTEMPT_INVALID");
  }
  if (!Number.isSafeInteger(baseBackoffMs) || baseBackoffMs <= 0
    || !Number.isSafeInteger(maxBackoffMs) || maxBackoffMs < baseBackoffMs) {
    throw new Error("FULFILLMENT_BACKOFF_LIMITS_INVALID");
  }
  if (!(jitterRatio >= 0 && jitterRatio <= 1)) {
    throw new Error("FULFILLMENT_BACKOFF_JITTER_INVALID");
  }
  const exp = Math.min(maxBackoffMs, baseBackoffMs * (2 ** Math.min(attemptCount, 16)));
  const jitter = Math.floor(exp * jitterRatio);
  return Math.min(maxBackoffMs, exp - jitter);
}

/** Errors that must not be treated as permanent fulfillment failures. */
export function isSubscriptionFulfillmentRetryableError(code: string): boolean {
  return [
    "FULFILLMENT_CLAIM_LOST",
    "FULFILLMENT_LOCK_TIMEOUT",
    "FULFILLMENT_STATEMENT_TIMEOUT",
    "SUBSCRIPTION_PAYMENT_NOT_PAID",
    "SUBSCRIPTION_PAYMENT_NOT_VERIFIED",
    "FACTUS_PAY_NETWORK",
    "FACTUS_PAY_TIMEOUT",
    "FACTUS_PAY_UNAVAILABLE",
    "LICENSING_ACTIVE_BUYER_REQUIRED",
  ].includes(code);
}

export type SubscriptionFulfillmentStatus = z.infer<typeof SubscriptionFulfillmentStatusSchema>;
export type SubscriptionFulfillmentConfirmationSource =
  z.infer<typeof SubscriptionFulfillmentConfirmationSourceSchema>;
export type SubscriptionFulfillmentProvision = z.infer<typeof SubscriptionFulfillmentProvisionSchema>;
export type SubscriptionFulfillmentJobView = z.infer<typeof SubscriptionFulfillmentJobViewSchema>;
