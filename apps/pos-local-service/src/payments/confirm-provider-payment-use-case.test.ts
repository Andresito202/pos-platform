import { describe, expect, it } from "vitest";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";
import { ConfirmProviderPaymentUseCase } from "./confirm-provider-payment-use-case.js";

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
});
