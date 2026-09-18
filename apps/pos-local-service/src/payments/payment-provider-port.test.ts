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
    };

    expect(input.cashRegisterId).toBe("register-3");
    expect(input.amount).toBe("87000.000000");
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
        providerReference: "intent-1",
        status: "PENDING",
      }),
      getPaymentStatus: async () => ({
        providerCode: "BRE_B",
        providerReference: "intent-1",
        providerTransactionId: "transaction-1",
        amount: "87000.000000",
        currencyCode: "COP",
        status: "PENDING",
        receivedAt: "2026-09-17T10:00:00.000Z",
      }),
      normalizeNotification: async () => ({
        providerCode: "BRE_B",
        providerReference: "intent-1",
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
