import { describe, expect, it } from "vitest";
import {
  WOMPI_PROVIDER_CODE,
  WompiCurrencyMismatchError,
  mapWompiStatus,
  toPaymentProviderEvidence,
  type WompiTransaction,
} from "./wompi-transaction.js";

function transaction(overrides: Partial<WompiTransaction> = {}): WompiTransaction {
  return {
    id: "1234-1600000000-12345",
    reference: "order-249",
    status: "APPROVED",
    amount_in_cents: 2490000,
    currency: "COP",
    ...overrides,
  };
}

describe("mapWompiStatus", () => {
  it("maps APPROVED and PENDING directly", () => {
    expect(mapWompiStatus("APPROVED")).toBe("APPROVED");
    expect(mapWompiStatus("PENDING")).toBe("PENDING");
  });

  it("folds every non-terminal-success Wompi status into REJECTED without inventing new internal states", () => {
    expect(mapWompiStatus("DECLINED")).toBe("REJECTED");
    expect(mapWompiStatus("VOIDED")).toBe("REJECTED");
    expect(mapWompiStatus("ERROR")).toBe("REJECTED");
  });
});

describe("toPaymentProviderEvidence", () => {
  it("normalizes an approved transaction into the existing evidence contract", () => {
    const evidence = toPaymentProviderEvidence(transaction(), "2026-09-18T10:00:00.000Z");

    expect(evidence).toEqual({
      providerCode: WOMPI_PROVIDER_CODE,
      providerReference: "order-249",
      providerTransactionId: "1234-1600000000-12345",
      amount: "24900.000000",
      currencyCode: "COP",
      status: "APPROVED",
      receivedAt: "2026-09-18T10:00:00.000Z",
    });
  });

  it("normalizes a pending transaction", () => {
    const evidence = toPaymentProviderEvidence(
      transaction({ status: "PENDING" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidence.status).toBe("PENDING");
  });

  it("normalizes a declined transaction as REJECTED", () => {
    const evidence = toPaymentProviderEvidence(
      transaction({ status: "DECLINED" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidence.status).toBe("REJECTED");
  });

  it("carries the payer reference only when Wompi reports one", () => {
    const withEmail = toPaymentProviderEvidence(
      transaction({ customer_email: "buyer@example.test" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(withEmail.payerReference).toBe("buyer@example.test");

    const withoutEmail = toPaymentProviderEvidence(transaction(), "2026-09-18T10:00:00.000Z");
    expect(withoutEmail.payerReference).toBeUndefined();
  });

  it("rejects a non-COP transaction rather than silently converting currency", () => {
    expect(() =>
      toPaymentProviderEvidence(transaction({ currency: "USD" }), "2026-09-18T10:00:00.000Z"),
    ).toThrow(WompiCurrencyMismatchError);
  });
});
