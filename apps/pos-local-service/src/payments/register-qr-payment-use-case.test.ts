import { describe, expect, it, vi } from "vitest";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { PaymentProviderIntent, PaymentProviderPort } from "./payment-provider-port.js";
import { RegisterQrPaymentUseCase } from "./register-qr-payment-use-case.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";

const scope = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  companyId: "00000000-0000-0000-0000-000000000002",
  branchId: "00000000-0000-0000-0000-000000000003",
  deviceId: "00000000-0000-0000-0000-000000000004",
  installationId: "00000000-0000-0000-0000-000000000005",
};

const authSnapshot: StoredAuthorizationSnapshot = {
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
      permissions: [{ code: "PAYMENTS_TRANSFER_REPORT", status: "ACTIVE" }],
    }],
    key_id: "AUTHZ_KEY_1",
  },
  signature: "x".repeat(80),
  activatedAt: "2026-09-18T00:00:00Z",
};

const request = {
  saleId: "00000000-0000-0000-0000-000000000006",
  amount: "87000.000000",
  idempotencyKey: "qr-1",
  correlationId: "00000000-0000-0000-0000-000000000007",
  causationId: null,
};

describe("RegisterQrPaymentUseCase", () => {
  it("uses the sale's cash register and provider idempotency key", async () => {
    const createPaymentIntent = vi.fn(async (input: PaymentProviderIntent) => ({
      providerCode: "BRE_B",
      merchantReference: input.merchantReference,
      status: "PENDING" as const,
      checkout: null,
    }));

    const store = {
      findPaymentByIdempotency: vi.fn(() => ({ kind: "NEW" as const })),
      getPaymentIntentContext: vi.fn(() => ({
        kind: "FOUND" as const,
        cashRegisterId: "00000000-0000-0000-0000-000000000008",
        currencyCode: "COP",
        payableAmount: "87000.000000",
      })),
      register: vi.fn(() => ({ kind: "REGISTERED" as const, paymentId: "payment-1" })),
    } as unknown as SqlitePaymentStore;

    const provider: PaymentProviderPort = {
      createPaymentIntent,
      getPaymentStatus: vi.fn(),
      normalizeNotification: vi.fn(),
    };

    const result = await new RegisterQrPaymentUseCase(store, provider).execute(scope, "session-1", authSnapshot, request);

    expect(result).toEqual({
      kind: "PENDING",
      paymentId: "payment-1",
      providerReference: expect.any(String),
      checkoutUrl: null,
    });
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      cashRegisterId: "00000000-0000-0000-0000-000000000008",
      idempotencyKey: "qr-1",
    }));
  });

  /**
   * `DEC-016` §21. The merchant reference is Camacho's to decide: it is the
   * `paymentId` this use case generated, never the caller-supplied
   * idempotency key and never something the adapter invents.
   */
  it("hands the provider the payment id as the merchant reference, not the idempotency key", async () => {
    const createPaymentIntent = vi.fn(async (input: PaymentProviderIntent) => ({
      providerCode: "BRE_B",
      merchantReference: input.merchantReference,
      status: "PENDING" as const,
      checkout: null,
    }));

    const store = {
      findPaymentByIdempotency: vi.fn(() => ({ kind: "NEW" as const })),
      getPaymentIntentContext: vi.fn(() => ({
        kind: "FOUND" as const,
        cashRegisterId: "00000000-0000-0000-0000-000000000008",
        currencyCode: "COP",
        payableAmount: "87000.000000",
      })),
      register: vi.fn((input: { paymentId: string }) => ({
        kind: "REGISTERED" as const,
        paymentId: input.paymentId,
      })),
    } as unknown as SqlitePaymentStore;

    const provider: PaymentProviderPort = {
      createPaymentIntent,
      getPaymentStatus: vi.fn(),
      normalizeNotification: vi.fn(),
    };

    const result = await new RegisterQrPaymentUseCase(store, provider).execute(scope, "session-1", authSnapshot, request);

    const intent = createPaymentIntent.mock.calls[0]?.[0];
    expect(intent?.merchantReference).toBe(intent?.paymentId);
    expect(intent?.merchantReference).not.toBe(request.idempotencyKey);
    expect(intent?.idempotencyKey).toBe(request.idempotencyKey);

    // The reference the store and the caller receive is that same one.
    expect(result).toMatchObject({ kind: "PENDING", providerReference: intent?.paymentId });
  });

  it("does not call the provider again for a locally idempotent request", async () => {
    const provider: PaymentProviderPort = {
      createPaymentIntent: vi.fn(),
      getPaymentStatus: vi.fn(),
      normalizeNotification: vi.fn(),
    };
    const store = {
      findPaymentByIdempotency: vi.fn(() => ({
        kind: "IDEMPOTENT" as const,
        paymentId: "payment-1",
      })),
      getPaymentIntentContext: vi.fn(),
      register: vi.fn(),
    } as unknown as SqlitePaymentStore;

    const result = await new RegisterQrPaymentUseCase(store, provider).execute(scope, "session-1", authSnapshot, request);

    expect(result).toEqual({ kind: "IDEMPOTENT", paymentId: "payment-1" });
    expect(provider.createPaymentIntent).not.toHaveBeenCalled();
  });
});
