import { describe, expect, it, vi } from "vitest";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { ConfirmProviderPaymentUseCase } from "./confirm-provider-payment-use-case.js";
import type { PaymentProviderEvidence, PaymentProviderPort } from "./payment-provider-port.js";
import { ReconcileProviderPaymentUseCase } from "./reconcile-provider-payment-use-case.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";

const scope = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  companyId: "00000000-0000-0000-0000-000000000002",
  branchId: "00000000-0000-0000-0000-000000000003",
  deviceId: "00000000-0000-0000-0000-000000000004",
  installationId: "00000000-0000-0000-0000-000000000005",
};

function authSnapshotWith(permissions: string[]): StoredAuthorizationSnapshot {
  return {
    claims: {
      snapshot_id: "00000000-0000-0000-0000-0000000000a0",
      user_id: "00000000-0000-0000-0000-0000000000a1",
      installation_id: scope.installationId,
      device_id: scope.deviceId,
      sequence: 1,
      issued_at: "2026-09-18T00:00:00Z",
      expires_at: "2030-09-18T00:00:00Z",
      assignments: [{
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        branch_id: scope.branchId,
        status: "ACTIVE",
        valid_from: "2026-09-01T00:00:00Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
      }],
      key_id: "AUTHZ_KEY_1",
    },
    signature: "x".repeat(80),
    activatedAt: "2026-09-18T00:00:00Z",
  };
}

const authSnapshot = authSnapshotWith(["PAYMENTS_PAYMENT_READ"]);

const request = {
  paymentId: "00000000-0000-0000-0000-000000000006",
  providerTransactionId: "wompi-txn-1",
  correlationId: "00000000-0000-0000-0000-000000000007",
  causationId: null,
};

function pendingQrPayment(overrides: Record<string, unknown> = {}) {
  return {
    kind: "FOUND" as const,
    payment: {
      paymentId: request.paymentId,
      saleId: "sale-1",
      method: "QR",
      status: "PENDING",
      expectedAmount: "24900.000000",
      confirmedAmount: "0.000000",
      currencyCode: "COP",
      version: 3,
      ...overrides,
    },
  };
}

function evidence(overrides: Partial<PaymentProviderEvidence> = {}): PaymentProviderEvidence {
  return {
    providerCode: "WOMPI",
    providerReference: "qr-intent-1",
    providerTransactionId: "wompi-txn-1",
    amount: "24900.000000",
    currencyCode: "COP",
    status: "APPROVED",
    receivedAt: "2026-09-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("ReconcileProviderPaymentUseCase", () => {
  it("rejects an unauthorized actor without querying the provider or the store", async () => {
    const getPaymentStatus = vi.fn();
    const store = { get: vi.fn() } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus,
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshotWith([]),
      request,
    );

    expect(result.kind).toBe("UNAUTHORIZED");
    expect(store.get).not.toHaveBeenCalled();
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_FOUND without querying the provider", async () => {
    const getPaymentStatus = vi.fn();
    const store = { get: vi.fn(() => ({ kind: "NOT_FOUND" as const })) } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus,
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "PAYMENT_NOT_FOUND" });
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("refuses to reconcile a non-QR or already-settled payment without querying the provider", async () => {
    const getPaymentStatus = vi.fn();
    const store = {
      get: vi.fn(() => pendingQrPayment({ method: "TRANSFER" })),
    } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus,
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "PAYMENT_NOT_RECONCILABLE" });
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("does not re-query the provider once the payment is already CONFIRMED locally", async () => {
    const getPaymentStatus = vi.fn();
    const store = {
      get: vi.fn(() => pendingQrPayment({ status: "CONFIRMED" })),
    } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus,
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "PAYMENT_NOT_RECONCILABLE" });
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("reports STILL_PENDING without touching the payment store", async () => {
    const store = { get: vi.fn(() => pendingQrPayment()) } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(async () => evidence({ status: "PENDING" })),
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "STILL_PENDING" });
    expect(confirm.execute).not.toHaveBeenCalled();
  });

  it("reports PROVIDER_REJECTED with the evidence and does not cancel the payment itself", async () => {
    const store = { get: vi.fn(() => pendingQrPayment()) } as unknown as SqlitePaymentStore;
    const rejectedEvidence = evidence({ status: "REJECTED" });
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(async () => rejectedEvidence),
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "PROVIDER_REJECTED", evidence: rejectedEvidence });
    expect(confirm.execute).not.toHaveBeenCalled();
  });

  it("applies an APPROVED verdict through the unmodified ConfirmProviderPaymentUseCase", async () => {
    const store = { get: vi.fn(() => pendingQrPayment({ version: 7 })) } as unknown as SqlitePaymentStore;
    const approvedEvidence = evidence();
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(async () => approvedEvidence),
      normalizeNotification: vi.fn(),
    };
    const confirmExecute = vi.fn(() => ({ kind: "CONFIRMED" as const, paymentId: request.paymentId, saleCompleted: true, confirmedCoverage: "24900.000000", payableAmount: "24900.000000" }));
    const confirm = { execute: confirmExecute } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result.kind).toBe("EVIDENCE_APPLIED");
    // Each call gets its own idempotency key — correctness comes from the
    // confirm-side guards, not from this key (see class doc).
    expect(confirmExecute).toHaveBeenCalledWith(scope, expect.objectContaining({
      paymentId: request.paymentId,
      expectedVersion: 7,
      evidence: approvedEvidence,
      correlationId: request.correlationId,
      causationId: request.causationId,
      idempotencyKey: expect.stringMatching(/^reconcile:/),
    }));
  });

  it("surfaces whatever ConfirmProviderPaymentUseCase actually decided, even when it is not a success", async () => {
    const store = { get: vi.fn(() => pendingQrPayment()) } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(async () => evidence()),
      normalizeNotification: vi.fn(),
    };
    const confirm = {
      execute: vi.fn(() => ({ kind: "PROVIDER_MISMATCH" as const })),
    } as unknown as ConfirmProviderPaymentUseCase;

    const result = await new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(
      scope,
      authSnapshot,
      request,
    );

    expect(result).toEqual({ kind: "EVIDENCE_APPLIED", outcome: { kind: "PROVIDER_MISMATCH" } });
  });

  it("propagates a provider query failure (timeout/HTTP/network) instead of inferring a status", async () => {
    const store = { get: vi.fn(() => pendingQrPayment()) } as unknown as SqlitePaymentStore;
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(async () => {
        throw new Error("Wompi API request timed out after 10000ms");
      }),
      normalizeNotification: vi.fn(),
    };
    const confirm = { execute: vi.fn() } as unknown as ConfirmProviderPaymentUseCase;

    await expect(
      new ReconcileProviderPaymentUseCase(store, provider, confirm).execute(scope, authSnapshot, request),
    ).rejects.toThrow("timed out");
    expect(confirm.execute).not.toHaveBeenCalled();
  });
});
