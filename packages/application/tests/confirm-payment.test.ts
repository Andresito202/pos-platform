import { describe, expect, it } from "vitest";
import { Actor, MerchantCollectionIdentifier, TenantScope } from "@pos-platform/domain";
import { ConfirmPaymentUseCase, InitiatePaymentUseCase, type ConfirmPaymentCommand, type InitiatePaymentCommand } from "../src/index.js";
import {
  FixedClock,
  FixedPaymentAuthorization,
  FixedPaymentConfirmationAuthenticityPort,
  InMemoryPaymentAttemptRepository,
  InMemoryPaymentRepository,
  InMemoryPosNotificationPort,
  SequentialIdGenerator,
} from "./fakes.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const otherScope = new TenantScope(
  "018f0000-0000-7000-8000-0000000000ff",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function initiateCommand(overrides: Partial<InitiatePaymentCommand> = {}): InitiatePaymentCommand {
  return {
    scope,
    actor,
    collectionSubjectType: "SALE",
    collectionSubjectId: "018f0000-0000-7000-8000-000000000600",
    paymentMethod: "DYNAMIC_QR",
    authorityType: "EXTERNAL_PROVIDER",
    amount: "50000",
    currencyCode: "COP",
    collectionIdentifier: MerchantCollectionIdentifier.of("QR_STATIC", "merchant-qr-001"),
    originDeviceId: "018f0000-0000-7000-8000-000000000700",
    correlationId: "018f0000-0000-7000-8000-000000000800",
    idempotencyKey: "initiate-payment:1",
    ...overrides,
  };
}

async function seedInitiatedPayment(paymentRepository: InMemoryPaymentRepository, attemptRepository: InMemoryPaymentAttemptRepository) {
  const initiate = new InitiatePaymentUseCase(paymentRepository, attemptRepository, new FixedPaymentAuthorization(true), clock, new SequentialIdGenerator());
  const result = await initiate.execute(initiateCommand());
  if (result.kind !== "INITIATED") throw new Error("seed failed");
  return { payment: result.payment, attempt: result.attempt };
}

function confirmCommand(paymentId: string, overrides: Partial<ConfirmPaymentCommand> = {}): ConfirmPaymentCommand {
  return {
    scope,
    paymentId,
    evidence: {
      providerCode: "BRE_B_TEST",
      providerReferenceType: "TRANSACTION_ID",
      providerReference: "TX-0001",
      amount: "50000",
      currencyCode: "COP",
      occurredAt: new Date("2026-09-02T08:05:00Z"),
    },
    idempotencyKey: "confirm-payment:1",
    ...overrides,
  };
}

function newUseCase(
  paymentRepository: InMemoryPaymentRepository,
  attemptRepository: InMemoryPaymentAttemptRepository,
  notificationPort: InMemoryPosNotificationPort,
  authentic = true,
) {
  return new ConfirmPaymentUseCase(
    paymentRepository, attemptRepository, new FixedPaymentConfirmationAuthenticityPort(authentic), notificationPort, clock,
  );
}

describe("ConfirmPaymentUseCase", () => {
  it("confirms the payment and attempt, emits PaymentConfirmed, and dispatches exactly one notification", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand(payment.id));

    expect(result.kind).toBe("CONFIRMED");
    if (result.kind !== "CONFIRMED") throw new Error("unreachable");
    expect(result.payment.status).toBe("CONFIRMED");
    expect(result.attempt.status).toBe("CONFIRMED");
    expect(result.event.type).toBe("PaymentConfirmed");
    expect(result.notification.notificationType).toBe("PAYMENT_CONFIRMED");
    expect(result.notificationDispatch).toBe("DELIVERED");
    expect(notificationPort.notifications).toHaveLength(1);
  });

  it("rejects unauthenticated evidence without mutating anything", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort, false);

    const result = await useCase.execute(confirmCommand(payment.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHENTIC" });
    expect(paymentRepository.savedConfirmations).toHaveLength(0);
    expect(notificationPort.notifications).toHaveLength(0);
  });

  it("REPLAY: repeating the SAME confirmation idempotencyKey does not duplicate the confirmation or re-dispatch through the use case's own save path", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const first = await useCase.execute(confirmCommand(payment.id));
    const replay = await useCase.execute(confirmCommand(payment.id));

    expect(replay.kind).toBe("ALREADY_CONFIRMED");
    if (replay.kind !== "ALREADY_CONFIRMED" || first.kind !== "CONFIRMED") throw new Error("unreachable");
    expect(replay.payment.id).toBe(first.payment.id);
    expect(paymentRepository.savedConfirmations).toHaveLength(1);
    expect(attemptRepository.savedConfirmations).toHaveLength(1);
  });

  it("NOTIFICATION DEDUP (independent of payment idempotency): delivering the SAME notification twice returns DELIVERED then ALREADY_DELIVERED without a second confirmation", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand(payment.id));
    if (result.kind !== "CONFIRMED") throw new Error("unreachable");

    // Simulates a delivery-layer retry (reconnection, at-least-once transport)
    // redelivering the SAME already-produced notification — not a new confirmation.
    const redelivery = await notificationPort.notify(result.notification);

    expect(redelivery).toBe("ALREADY_DELIVERED");
    expect(notificationPort.notifications).toHaveLength(1);
  });

  it("SOUND DEDUP: the same confirmed event never produces more than one logical notification/sound trigger, even across N redeliveries", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);
    const result = await useCase.execute(confirmCommand(payment.id));
    if (result.kind !== "CONFIRMED") throw new Error("unreachable");

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => notificationPort.notify(result.notification)));

    expect(outcomes.filter((outcome) => outcome === "DELIVERED")).toHaveLength(0);
    expect(outcomes.filter((outcome) => outcome === "ALREADY_DELIVERED")).toHaveLength(5);
    expect(notificationPort.notifications).toHaveLength(1);
  });

  it("rejects an amount that does not match the payment's expected amount", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand(payment.id, { evidence: { ...confirmCommand(payment.id).evidence, amount: "1" } }));

    expect(result).toEqual({ kind: "REJECTED", reason: "AMOUNT_MISMATCH" });
  });

  it("rejects a currency mismatch", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand(payment.id, { evidence: { ...confirmCommand(payment.id).evidence, currencyCode: "USD" } }));

    expect(result).toEqual({ kind: "REJECTED", reason: "CURRENCY_MISMATCH" });
  });

  it("PROVIDER REFERENCE REUSE: rejects a provider reference already used to confirm a DIFFERENT payment", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment: paymentA } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);
    await useCase.execute(confirmCommand(paymentA.id));

    const initiateB = new InitiatePaymentUseCase(paymentRepository, attemptRepository, new FixedPaymentAuthorization(true), clock, new SequentialIdGenerator(100));
    const initiatedB = await initiateB.execute(initiateCommand({ idempotencyKey: "initiate-payment:2" }));
    if (initiatedB.kind !== "INITIATED") throw new Error("unreachable");

    const result = await useCase.execute(
      confirmCommand(initiatedB.payment.id, { idempotencyKey: "confirm-payment:2", evidence: { ...confirmCommand(initiatedB.payment.id).evidence, providerReference: "TX-0001" } }),
    );

    expect(result).toEqual({ kind: "REJECTED", reason: "PROVIDER_REFERENCE_ALREADY_USED" });
  });

  it("TENANT ISOLATION: a payment from a different tenant is not found, not leaked", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute({ ...confirmCommand(payment.id), scope: otherScope });

    expect(result).toEqual({ kind: "REJECTED", reason: "PAYMENT_NOT_FOUND" });
  });

  it("rejects confirming a payment that does not exist", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand("018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "PAYMENT_NOT_FOUND" });
  });

  it("NOTIFICATION CONTENT: carries the minimum fields required to show 'PAGO RECIBIDO'", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);

    const result = await useCase.execute(confirmCommand(payment.id));
    if (result.kind !== "CONFIRMED") throw new Error("unreachable");

    expect(result.notification).toMatchObject({
      notificationId: expect.any(String),
      notificationType: "PAYMENT_CONFIRMED",
      paymentId: payment.id,
      saleId: payment.collectionSubjectId,
      amount: expect.any(String),
      currencyCode: "COP",
      paymentMethod: "DYNAMIC_QR",
      providerCode: "BRE_B_TEST",
      externalReference: "TX-0001",
      occurredAt: expect.any(Date),
    });
  });

  it("propagates a repository failure instead of swallowing it", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const notificationPort = new InMemoryPosNotificationPort();
    const { payment } = await seedInitiatedPayment(paymentRepository, attemptRepository);
    const useCase = newUseCase(paymentRepository, attemptRepository, notificationPort);
    paymentRepository.saveConfirmation = async () => { throw new Error("repository unavailable"); };

    await expect(useCase.execute(confirmCommand(payment.id))).rejects.toThrow("repository unavailable");
  });
});
