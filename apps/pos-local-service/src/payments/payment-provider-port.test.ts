import { describe, expect, it } from "vitest";
import type {
  PaymentProviderEvidence,
  PaymentProviderIntent,
  PaymentProviderPort,
} from "./payment-provider-port.js";

describe("PaymentProviderPort", () => {
  it("preserves cash-register provenance in the provider intent", () => {
    const input: PaymentProviderIntent = {
      paymentId: "payment-1",
      saleId: "sale-1",
      tenantId: "tenant-1",
      branchId: "branch-1",
      cashRegisterId: "register-3",
      amount: "87000.000000",
      currencyCode: "COP",
      idempotencyKey: "qr-intent-1",
      merchantReference: "payment-1",
    };

    expect(input.cashRegisterId).toBe("register-3");
    expect(input.amount).toBe("87000.000000");
  });

  /**
   * `DEC-016` §21. The contract must be able to express two different values
   * at once; a port that could only carry one would make the distinction
   * unrepresentable, which is how they were conflated before.
   */
  it("keeps the merchant reference separate from the local idempotency key", () => {
    const input: PaymentProviderIntent = {
      paymentId: "payment-1",
      saleId: "sale-1",
      tenantId: "tenant-1",
      branchId: "branch-1",
      cashRegisterId: "register-3",
      amount: "87000.000000",
      currencyCode: "COP",
      idempotencyKey: "caller-chosen-key-1",
      merchantReference: "payment-1",
    };

    expect(input.merchantReference).not.toBe(input.idempotencyKey);
    expect(input.merchantReference).toBe(input.paymentId);
  });

  it("carries a provider-owned checkout URL without making it financial evidence", () => {
    const result: Awaited<ReturnType<PaymentProviderPort["createPaymentIntent"]>> = {
      providerCode: "TEST_QR",
      merchantReference: "payment-1",
      status: "PENDING",
      checkout: { kind: "WEB_URL", url: "https://checkout.example.test/pay/intent-1" },
    };

    expect(result.checkout?.kind).toBe("WEB_URL");
    expect(result.checkout?.url).toBe("https://checkout.example.test/pay/intent-1");
    expect(result.status).toBe("PENDING");
  });

  it("requires external transaction identity for financial evidence", () => {
    const evidence: PaymentProviderEvidence = {
      providerCode: "BRE_B",
      providerReference: "intent-1",
      providerTransactionId: "transaction-1",
      amount: "87000.000000",
      currencyCode: "COP",
      status: "APPROVED",
      receivedAt: "2026-09-17T10:00:00.000Z",
    };

    expect(evidence.providerTransactionId).toBeTruthy();
    expect(evidence.status).toBe("APPROVED");
  });

  it("keeps the boundary implementation-independent", () => {
    const port: PaymentProviderPort = {
      createPaymentIntent: async () => ({
        providerCode: "BRE_B",
        merchantReference: "payment-1",
        status: "PENDING",
        checkout: null,
      }),
      getPaymentStatus: async () => ({
        providerCode: "BRE_B",
        providerReference: "payment-1",
        providerTransactionId: "transaction-1",
        amount: "87000.000000",
        currencyCode: "COP",
        status: "PENDING",
        receivedAt: "2026-09-17T10:00:00.000Z",
      }),
      normalizeNotification: async () => ({
        providerCode: "BRE_B",
        providerReference: "payment-1",
        providerTransactionId: "transaction-1",
        amount: "87000.000000",
        currencyCode: "COP",
        status: "PENDING",
        receivedAt: "2026-09-17T10:00:00.000Z",
      }),
    };

    expect(port).toBeDefined();
  });
});
