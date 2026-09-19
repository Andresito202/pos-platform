import { describe, expect, it, vi } from "vitest";
import type { PaymentProviderEvidence } from "./payment-provider-port.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";
import { ConfirmProviderPaymentUseCase } from "./confirm-provider-payment-use-case.js";

const scope = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  companyId: "00000000-0000-0000-0000-000000000002",
  branchId: "00000000-0000-0000-0000-000000000003",
  deviceId: "00000000-0000-0000-0000-000000000004",
  installationId: "00000000-0000-0000-0000-000000000005",
};

function evidence(overrides: Partial<PaymentProviderEvidence> = {}): PaymentProviderEvidence {
  return {
    providerCode: "BRE_B",
    providerReference: "payment-1",
    providerTransactionId: "tx-1",
    amount: "87000.000000",
    currencyCode: "COP",
    status: "APPROVED",
    receivedAt: "2026-09-18T18:00:00.000Z",
    ...overrides,
  };
}

function request(evidenceOverrides: Partial<PaymentProviderEvidence> = {}) {
  return {
    paymentId: "00000000-0000-0000-0000-000000000006",
    expectedVersion: 1,
    evidence: evidence(evidenceOverrides),
    idempotencyKey: "provider-confirm-1",
    correlationId: "00000000-0000-0000-0000-000000000007",
    causationId: null,
  };
}

describe("ConfirmProviderPaymentUseCase", () => {
  it("does not allow non-approved provider evidence to reach the payment store", () => {
    const useCase = new ConfirmProviderPaymentUseCase({} as SqlitePaymentStore);

    const result = useCase.execute(
      {
        tenantId: "00000000-0000-0000-0000-000000000001",
        companyId: "00000000-0000-0000-0000-000000000002",
        branchId: "00000000-0000-0000-0000-000000000003",
        deviceId: "00000000-0000-0000-0000-000000000004",
        installationId: "00000000-0000-0000-0000-000000000005",
      },
      {
        paymentId: "00000000-0000-0000-0000-000000000006",
        expectedVersion: 1,
        evidence: {
          providerCode: "BRE_B",
          providerReference: "intent-1",
          providerTransactionId: "tx-1",
          amount: "87000.000000",
          currencyCode: "COP",
          status: "PENDING",
          receivedAt: "2026-09-18T18:00:00.000Z",
        },
        idempotencyKey: "provider-confirm-1",
        correlationId: "00000000-0000-0000-0000-000000000007",
        causationId: null,
      },
    );

    expect(result).toEqual({ kind: "EVIDENCE_NOT_AUTHORIZED" });
  });

  /**
   * `D-3`. Only positive, verified approval moves money. The three other
   * answers a provider can now give are each a reason not to confirm, and
   * none of them may reach the store: `PENDING` means not yet, `REJECTED`
   * means no, and `UNKNOWN` means the question was never answered.
   */
  it.each([
    ["PENDING" as const],
    ["REJECTED" as const],
  ])("refuses to confirm on %s evidence", (status) => {
    const store = { confirmProviderPayment: vi.fn() };
    const useCase = new ConfirmProviderPaymentUseCase(store as unknown as SqlitePaymentStore);

    expect(useCase.execute(scope, request({ status }))).toEqual({ kind: "EVIDENCE_NOT_AUTHORIZED" });
    expect(store.confirmProviderPayment).not.toHaveBeenCalled();
  });

  /**
   * `UNKNOWN` never arrives here as an evidence object at all: the port
   * models it as a variant that carries no evidence, so it is unrepresentable
   * as a confirmation input. This asserts that property of the contract —
   * the reason a timeout cannot be mistaken for an approval.
   */
  it("cannot be handed an UNKNOWN outcome as evidence", () => {
    // @ts-expect-error UNKNOWN is not an evidence status; the contract forbids it.
    const unrepresentable: PaymentProviderEvidence["status"] = "UNKNOWN";
    expect(unrepresentable).toBe("UNKNOWN");
  });

  it("confirms only when the evidence is APPROVED and carries both identities", () => {
    let received: { providerReference: string; providerTransactionId: string } | undefined;
    const store = {
      confirmProviderPayment: vi.fn((input: { providerReference: string; providerTransactionId: string }) => {
        received = input;
        return { kind: "CONFIRMED" as const };
      }),
    };
    const useCase = new ConfirmProviderPaymentUseCase(store as unknown as SqlitePaymentStore);

    useCase.execute(scope, request());

    expect(store.confirmProviderPayment).toHaveBeenCalledTimes(1);
    expect(received?.providerReference).toBe("payment-1");
    expect(received?.providerTransactionId).toBe("tx-1");
  });

  it.each([
    ["providerCode" as const],
    ["providerReference" as const],
    ["providerTransactionId" as const],
  ])("refuses APPROVED evidence missing %s", (field) => {
    const store = { confirmProviderPayment: vi.fn() };
    const useCase = new ConfirmProviderPaymentUseCase(store as unknown as SqlitePaymentStore);

    expect(useCase.execute(scope, request({ [field]: "  " }))).toEqual({ kind: "EVIDENCE_NOT_AUTHORIZED" });
    expect(store.confirmProviderPayment).not.toHaveBeenCalled();
  });
});
