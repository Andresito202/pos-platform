import { describe, expect, it } from "vitest";
import { verifyFactusPayCollectionWebhook } from "../src/factus-pay-collection-event.js";

const key = "factus-pay-webhook-test-key-0123456789";
const observedAt = new Date("2026-10-17T14:00:00.000Z");

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      reference_code: "FACT-00123",
      amount: 150000,
      status: "paid",
      payer: { name: "Cliente prueba", email: "cliente@example.com" },
      ...overrides,
    },
  };
}

describe("Factus Pay collection webhook verification", () => {
  it("authenticates and normalizes a paid collection without inventing provider data", () => {
    const result = verifyFactusPayCollectionWebhook(payload(), key, key, observedAt);

    expect(result).toEqual({
      external_transaction_id: "FACT-00123",
      external_reference: "FACT-00123",
      provider_code: "FACTUS_PAY",
      status: "APPROVED",
      amount: "150000.000000",
      currency_code: "COP",
      payer_display_name: "Cliente prueba",
      payer_reference: "cliente@example.com",
      observed_at: observedAt.toISOString(),
    });
  });

  it("rejects a missing or incorrect query key", () => {
    expect(() => verifyFactusPayCollectionWebhook(payload(), null, key, observedAt))
      .toThrow("FACTUS_PAY_UNAUTHORIZED");
    expect(() => verifyFactusPayCollectionWebhook(payload(), "wrong-key", key, observedAt))
      .toThrow("FACTUS_PAY_UNAUTHORIZED");
  });

  it("rejects weak configured secrets", () => {
    expect(() => verifyFactusPayCollectionWebhook(payload(), "short", "short", observedAt))
      .toThrow("FACTUS_PAY_WEBHOOK_KEY_TOO_SHORT");
  });

  it("does not treat non-paid collections as approval", () => {
    expect(() => verifyFactusPayCollectionWebhook(payload({ status: "pending" }), key, key, observedAt))
      .toThrow("FACTUS_PAY_COLLECTION_NOT_PAID");
  });

  it("rejects missing references and non-positive or malformed amounts", () => {
    expect(() => verifyFactusPayCollectionWebhook(payload({ reference_code: "" }), key, key, observedAt))
      .toThrow("FACTUS_PAY_REFERENCE_MISSING");
    expect(() => verifyFactusPayCollectionWebhook(payload({ amount: 0 }), key, key, observedAt))
      .toThrow("FACTUS_PAY_INVALID_AMOUNT");
    expect(() => verifyFactusPayCollectionWebhook(payload({ amount: "1e5" }), key, key, observedAt))
      .toThrow("FACTUS_PAY_INVALID_AMOUNT");
  });

  it("accepts optional payer identity as absent instead of fabricating it", () => {
    const result = verifyFactusPayCollectionWebhook(payload({ payer: undefined }), key, key, observedAt);
    expect(result.payer_display_name).toBeNull();
    expect(result.payer_reference).toBeNull();
  });
});
