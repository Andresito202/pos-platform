import { describe, expect, it } from "vitest";
import {
  WOMPI_PROVIDER_CODE,
  WompiCurrencyMismatchError,
  mapWompiStatus,
  toPaymentProviderOutcome,
  type WompiTransaction,
} from "./wompi-transaction.js";

/** Unwraps the evidence variant, failing loudly when the outcome is UNKNOWN. */
function evidenceOf(outcome: ReturnType<typeof toPaymentProviderOutcome>) {
  if (outcome.kind !== "EVIDENCE") throw new Error(`expected EVIDENCE, got ${outcome.kind}`);
  return outcome.evidence;
}

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

  /**
   * `DECLINED` and `VOIDED` are verdicts. `ERROR` is not, and `D-3` took it
   * out of this function's domain entirely — the type no longer accepts it.
   */
  it("folds the two commercial refusals into REJECTED", () => {
    expect(mapWompiStatus("DECLINED")).toBe("REJECTED");
    expect(mapWompiStatus("VOIDED")).toBe("REJECTED");
  });
});

describe("toPaymentProviderOutcome", () => {
  it("normalizes an approved transaction into the existing evidence contract", () => {
    const outcome = toPaymentProviderOutcome(transaction(), "2026-09-18T10:00:00.000Z");

    expect(evidenceOf(outcome)).toEqual({
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
    const outcome = toPaymentProviderOutcome(
      transaction({ status: "PENDING" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidenceOf(outcome).status).toBe("PENDING");
  });

  it("normalizes a declined transaction as REJECTED", () => {
    const outcome = toPaymentProviderOutcome(
      transaction({ status: "DECLINED" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidenceOf(outcome).status).toBe("REJECTED");
  });

  it("normalizes a voided transaction as REJECTED", () => {
    const outcome = toPaymentProviderOutcome(
      transaction({ status: "VOIDED" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidenceOf(outcome).status).toBe("REJECTED");
  });

  /**
   * `D-3`. Wompi reporting `ERROR` means its own processing failed. Until
   * `D-3` this produced `REJECTED`, turning a provider malfunction into a
   * verdict against the customer. It is uncertainty, and it carries no
   * evidence the system may act on.
   */
  it("reports a Wompi ERROR transaction as UNKNOWN, never as a rejection", () => {
    const outcome = toPaymentProviderOutcome(
      transaction({ status: "ERROR" }),
      "2026-09-18T10:00:00.000Z",
    );

    expect(outcome).toEqual({ kind: "UNKNOWN", reason: "PROVIDER_ERROR" });
  });

  it("carries the payer reference only when Wompi reports one", () => {
    const withEmail = toPaymentProviderOutcome(
      transaction({ customer_email: "buyer@example.test" }),
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidenceOf(withEmail).payerReference).toBe("buyer@example.test");

    const withoutEmail = toPaymentProviderOutcome(transaction(), "2026-09-18T10:00:00.000Z");
    expect(evidenceOf(withoutEmail).payerReference).toBeUndefined();
  });

  it("rejects a non-COP transaction rather than silently converting currency", () => {
    expect(() =>
      toPaymentProviderOutcome(transaction({ currency: "USD" }), "2026-09-18T10:00:00.000Z"),
    ).toThrow(WompiCurrencyMismatchError);
  });
});
