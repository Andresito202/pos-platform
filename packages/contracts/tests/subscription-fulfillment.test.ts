import { describe, expect, it } from "vitest";
import {
  SubscriptionFulfillmentProvisionSchema,
  isSubscriptionFulfillmentRetryableError,
  subscriptionFulfillmentBackoffMs,
  uuidV7,
} from "../src/index.js";

describe("subscription fulfillment contracts", () => {
  it("requires opt-in provision profile and registered 035 checksum", () => {
    expect(() => SubscriptionFulfillmentProvisionSchema.parse({
      profile: "CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
      policy_reference: "TEST_POLICY",
      expected_database: "pos_central",
      migration_checksum: "a".repeat(64),
      lock_timeout_ms: 2000,
      statement_timeout_ms: 10000,
      claim_ttl_ms: 30000,
      poll_interval_ms: 5000,
      max_attempts: 12,
      base_backoff_ms: 1000,
      max_backoff_ms: 60000,
    })).not.toThrow();

    expect(() => SubscriptionFulfillmentProvisionSchema.parse({
      profile: "CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
      policy_reference: "TEST_POLICY",
      expected_database: "pos_central",
      migration_checksum: "a".repeat(64),
      lock_timeout_ms: 10000,
      statement_timeout_ms: 2000,
      claim_ttl_ms: 30000,
      poll_interval_ms: 5000,
      max_attempts: 12,
      base_backoff_ms: 1000,
      max_backoff_ms: 60000,
    })).toThrow();
  });

  it("keeps network/provider timeouts retryable and amount mismatches permanent", () => {
    expect(isSubscriptionFulfillmentRetryableError("FACTUS_PAY_TIMEOUT")).toBe(true);
    expect(isSubscriptionFulfillmentRetryableError("FACTUS_PAY_NETWORK")).toBe(true);
    expect(isSubscriptionFulfillmentRetryableError("SUBSCRIPTION_PAYMENT_NOT_PAID")).toBe(true);
    expect(isSubscriptionFulfillmentRetryableError("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH")).toBe(false);
    expect(isSubscriptionFulfillmentRetryableError("LICENSING_PAYMENT_CONTRACT_CONFLICT")).toBe(false);
  });

  it("applies bounded exponential backoff for recovery after failure", () => {
    expect(subscriptionFulfillmentBackoffMs(0, 1000, 60000)).toBe(1000);
    expect(subscriptionFulfillmentBackoffMs(1, 1000, 60000)).toBe(2000);
    expect(subscriptionFulfillmentBackoffMs(3, 1000, 60000)).toBe(8000);
    expect(subscriptionFulfillmentBackoffMs(20, 1000, 60000)).toBe(60000);
    expect(subscriptionFulfillmentBackoffMs(2, 1000, 60000, 0.5)).toBeLessThanOrEqual(4000);
    expect(() => subscriptionFulfillmentBackoffMs(-1, 1000, 60000)).toThrow();
    void uuidV7;
  });
});
