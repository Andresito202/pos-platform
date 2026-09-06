import { describe, expect, it } from "vitest";
import {
  Actor,
  MerchantCollectionIdentifier,
  Money,
  Payment,
  PaymentAttempt,
  PaymentConfirmed,
  PaymentConfirmedNotificationRequested,
  PaymentDomainError,
  PaymentInitiated,
  TenantScope,
  roleMayInitiatePayment,
  type InitiatePaymentAttemptInput,
  type InitiatePaymentInput,
} from "../src/index.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const now = new Date("2026-09-02T10:00:00Z");

function paymentInput(overrides: Partial<InitiatePaymentInput> = {}): InitiatePaymentInput {
  return {
    id: "018f0000-0000-7000-8000-000000000500",
    scope,
    collectionSubjectType: "SALE",
    collectionSubjectId: "018f0000-0000-7000-8000-000000000600",
    paymentMethod: "DYNAMIC_QR",
    authorityType: "EXTERNAL_PROVIDER",
    expectedAmount: Money.fromString("50000"),
    currencyCode: "COP",
    originDeviceId: "018f0000-0000-7000-8000-000000000700",
    initiatedByActor: actor,
    correlationId: "018f0000-0000-7000-8000-000000000800",
    createdAt: now,
    ...overrides,
  };
}

function attemptInput(overrides: Partial<InitiatePaymentAttemptInput> = {}): InitiatePaymentAttemptInput {
  return {
    id: "018f0000-0000-7000-8000-000000000900",
    scope,
    paymentId: "018f0000-0000-7000-8000-000000000500",
    attemptNumber: 1,
    paymentMethod: "DYNAMIC_QR",
    authorityType: "EXTERNAL_PROVIDER",
    amount: Money.fromString("50000"),
    currencyCode: "COP",
    collectionIdentifier: MerchantCollectionIdentifier.of("QR_STATIC", "merchant-qr-001"),
    correlationId: "018f0000-0000-7000-8000-000000000800",
    initiatedAt: now,
    ...overrides,
  };
}

describe("MerchantCollectionIdentifier", () => {
  it("accepts a QR_STATIC identifier", () => {
    const identifier = MerchantCollectionIdentifier.of("QR_STATIC", "merchant-qr-001");
    expect(identifier.type).toBe("QR_STATIC");
    expect(identifier.value).toBe("merchant-qr-001");
  });

  it("accepts a KEY identifier (Llave)", () => {
    const identifier = MerchantCollectionIdentifier.of("KEY", "3001234567");
    expect(identifier.type).toBe("KEY");
  });

  it("rejects an empty value", () => {
    expect(() => MerchantCollectionIdentifier.of("KEY", "   ")).toThrow(PaymentDomainError);
  });

  it("is never treated as proof of payment — it carries no status/confirmation field of its own", () => {
    const identifier = MerchantCollectionIdentifier.of("QR_STATIC", "merchant-qr-001");
    expect(Object.keys(identifier)).toEqual(["type", "value"]);
  });

  it("equals() compares content", () => {
    const a = MerchantCollectionIdentifier.of("KEY", "3001234567");
    const b = MerchantCollectionIdentifier.of("KEY", "3001234567");
    expect(a.equals(b)).toBe(true);
  });
});

describe("Payment.initiate", () => {
  it("creates a PENDING payment at version 1 with zero confirmed amount", () => {
    const payment = Payment.initiate(paymentInput());
    expect(payment.status).toBe("PENDING");
    expect(payment.version).toBe(1);
    expect(payment.confirmedAmount.equals(Money.zero())).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    expect(() => Payment.initiate(paymentInput({ expectedAmount: Money.zero() }))).toThrow(PaymentDomainError);
  });

  it("rejects an empty currency code", () => {
    expect(() => Payment.initiate(paymentInput({ currencyCode: "" }))).toThrow(PaymentDomainError);
  });
});

describe("Payment.confirm", () => {
  it("transitions PENDING -> CONFIRMED, sets confirmedAmount = expectedAmount, increments version", () => {
    const payment = Payment.initiate(paymentInput());
    const confirmed = payment.confirm(1, now);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.version).toBe(2);
    expect(confirmed.confirmedAmount.equals(confirmed.expectedAmount)).toBe(true);
  });

  it("rejects a stale expectedVersion with PAYMENT_VERSION_CONFLICT", () => {
    const payment = Payment.initiate(paymentInput());
    try {
      payment.confirm(99, now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentDomainError);
      expect((error as PaymentDomainError).code).toBe("PAYMENT_VERSION_CONFLICT");
    }
  });

  it("rejects confirming a payment that is not PENDING (PAYMENT_NOT_PENDING)", () => {
    const payment = Payment.initiate(paymentInput());
    const confirmed = payment.confirm(1, now);
    try {
      confirmed.confirm(2, now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentDomainError);
      expect((error as PaymentDomainError).code).toBe("PAYMENT_NOT_PENDING");
    }
  });
});

describe("PaymentAttempt.initiate", () => {
  it("creates a PENDING attempt at version 1 with no provider evidence yet", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    expect(attempt.status).toBe("PENDING");
    expect(attempt.version).toBe(1);
    expect(attempt.providerCode).toBeNull();
    expect(attempt.providerReference).toBeNull();
  });

  it("carries the merchant collection identifier as informational metadata only", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    expect(attempt.collectionIdentifier?.type).toBe("QR_STATIC");
  });

  it("rejects a non-positive amount", () => {
    expect(() => PaymentAttempt.initiate(attemptInput({ amount: Money.zero() }))).toThrow(PaymentDomainError);
  });
});

describe("PaymentAttempt.confirm", () => {
  it("transitions PENDING -> CONFIRMED with real provider evidence, increments version", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    const confirmed = attempt.confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.version).toBe(2);
    expect(confirmed.providerCode).toBe("BRE_B_TEST");
    expect(confirmed.providerReference).toBe("TX-0001");
  });

  it("rejects a stale expectedVersion with ATTEMPT_VERSION_CONFLICT", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    expect(() => attempt.confirm(99, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now)).toThrow(PaymentDomainError);
  });

  it("rejects confirming a non-PENDING attempt (ATTEMPT_NOT_PENDING) — same idempotent-replay-first discipline the use case relies on", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    const confirmed = attempt.confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now);
    try {
      confirmed.confirm(2, "BRE_B_TEST", "TRANSACTION_ID", "TX-0002", now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentDomainError);
      expect((error as PaymentDomainError).code).toBe("ATTEMPT_NOT_PENDING");
    }
  });

  it("rejects an empty provider code", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    expect(() => attempt.confirm(1, "  ", "TRANSACTION_ID", "TX-0001", now)).toThrow(PaymentDomainError);
  });

  it("rejects an empty provider reference", () => {
    const attempt = PaymentAttempt.initiate(attemptInput());
    expect(() => attempt.confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "  ", now)).toThrow(PaymentDomainError);
  });
});

describe("Domain events", () => {
  it("PaymentInitiated references the payment and its tenant/company", () => {
    const payment = Payment.initiate(paymentInput());
    const event = PaymentInitiated.from(payment, now);
    expect(event).toMatchObject({ type: "PaymentInitiated", paymentId: payment.id, tenantId: scope.tenantId, companyId: scope.companyId });
  });

  it("PaymentConfirmed carries amount/currency/method/provider evidence", () => {
    const payment = Payment.initiate(paymentInput()).confirm(1, now);
    const attempt = PaymentAttempt.initiate(attemptInput()).confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now);
    const event = PaymentConfirmed.from(payment, attempt, now);
    expect(event).toMatchObject({
      type: "PaymentConfirmed",
      paymentId: payment.id,
      amount: "50000.000000",
      currencyCode: "COP",
      paymentMethod: "DYNAMIC_QR",
      providerCode: "BRE_B_TEST",
      providerReference: "TX-0001",
    });
  });

  it("PaymentConfirmedNotificationRequested derives a deterministic notificationId from paymentId, not a random one", () => {
    const payment = Payment.initiate(paymentInput()).confirm(1, now);
    const attempt = PaymentAttempt.initiate(attemptInput()).confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now);
    const confirmed = PaymentConfirmed.from(payment, attempt, now);

    const notificationA = PaymentConfirmedNotificationRequested.from(confirmed);
    const notificationB = PaymentConfirmedNotificationRequested.from(confirmed);

    expect(notificationA.notificationId).toBe(notificationB.notificationId);
    expect(notificationA.notificationId).toBe(`payment-confirmed:${payment.id}`);
    expect(notificationA.notificationType).toBe("PAYMENT_CONFIRMED");
    expect(notificationA.saleId).toBe(payment.collectionSubjectId);
  });

  it("PaymentConfirmedNotificationRequested is never itself a Payment/PaymentAttempt status — Payment.status is unaffected by how many times it is derived", () => {
    const payment = Payment.initiate(paymentInput()).confirm(1, now);
    const attempt = PaymentAttempt.initiate(attemptInput()).confirm(1, "BRE_B_TEST", "TRANSACTION_ID", "TX-0001", now);
    const confirmed = PaymentConfirmed.from(payment, attempt, now);

    PaymentConfirmedNotificationRequested.from(confirmed);
    PaymentConfirmedNotificationRequested.from(confirmed);
    PaymentConfirmedNotificationRequested.from(confirmed);

    expect(payment.status).toBe("CONFIRMED");
  });
});

describe("roleMayInitiatePayment fails closed unconditionally (no permission-matrix.md row for payments.transfer.report)", () => {
  it.each(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const)(
    "denies %s",
    (role) => { expect(roleMayInitiatePayment(role)).toBe(false); },
  );
});
