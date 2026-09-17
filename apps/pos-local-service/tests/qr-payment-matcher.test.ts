import { describe, expect, it } from "vitest";
import { matchQrPaymentObservation, type PendingQrPayment } from "../src/payments/qr-payment-matcher.js";
import type { QrPaymentObservation } from "@pos-platform/contracts";

const pending: PendingQrPayment[] = [
  { paymentId: "11111111-1111-4111-8111-111111111111", saleId: "22222222-2222-4222-8222-222222222222", expectedAmount: "87500.000000", currencyCode: "COP", version: 1 },
];

const observation: QrPaymentObservation = {
  external_transaction_id: "tx-001",
  external_reference: "POS-001",
  provider_code: "WOMPI",
  status: "APPROVED",
  amount: "87500.000000",
  currency_code: "COP",
  payer_display_name: null,
  payer_reference: "cliente@example.com",
  observed_at: "2026-09-17T12:00:00.000Z",
};

describe("QR payment matcher", () => {
  it("matches exactly one approved payment", () => {
    expect(matchQrPaymentObservation(observation, pending, []).outcome).toBe("MATCHED");
  });

  it("rejects ambiguity instead of choosing a sale", () => {
    expect(matchQrPaymentObservation(observation, [...pending, { ...pending[0]!, paymentId: "33333333-3333-4333-8333-333333333333" }], []).outcome).toBe("AMBIGUOUS");
  });

  it("deduplicates an already observed external transaction", () => {
    expect(matchQrPaymentObservation(observation, pending, new Set(["tx-001"])).outcome).toBe("DUPLICATE_EXTERNAL_TRANSACTION");
  });

  it("never confirms a different amount", () => {
    expect(matchQrPaymentObservation({ ...observation, amount: "87501.000000" }, pending, []).outcome).toBe("AMOUNT_MISMATCH");
  });
});
