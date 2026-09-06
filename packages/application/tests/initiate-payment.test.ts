import { describe, expect, it } from "vitest";
import { Actor, MerchantCollectionIdentifier, TenantScope } from "@pos-platform/domain";
import { InitiatePaymentUseCase, type InitiatePaymentCommand } from "../src/index.js";
import { FixedClock, FixedPaymentAuthorization, InMemoryPaymentAttemptRepository, InMemoryPaymentRepository, SequentialIdGenerator } from "./fakes.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function command(overrides: Partial<InitiatePaymentCommand> = {}): InitiatePaymentCommand {
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

function newUseCase(paymentRepository: InMemoryPaymentRepository, attemptRepository: InMemoryPaymentAttemptRepository, allow = true) {
  return new InitiatePaymentUseCase(paymentRepository, attemptRepository, new FixedPaymentAuthorization(allow), clock, new SequentialIdGenerator());
}

describe("InitiatePaymentUseCase", () => {
  it("initiates a PENDING payment + PENDING attempt and returns PaymentInitiated — NEVER a confirmation", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const useCase = newUseCase(paymentRepository, attemptRepository);

    const result = await useCase.execute(command());

    expect(result.kind).toBe("INITIATED");
    if (result.kind !== "INITIATED") throw new Error("unreachable");
    expect(result.payment.status).toBe("PENDING");
    expect(result.attempt.status).toBe("PENDING");
    // FASE 5 test #1: initiating a payment never produces a confirmation —
    // structurally guaranteed (InitiatePaymentResult has no CONFIRMED
    // variant) and confirmed here at runtime on both aggregates.
    expect(result.event.type).toBe("PaymentInitiated");
    expect(result.payment.status).not.toBe("CONFIRMED");
    expect(result.attempt.status).not.toBe("CONFIRMED");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const useCase = newUseCase(paymentRepository, attemptRepository, false);

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(paymentRepository.saved).toHaveLength(0);
    expect(attemptRepository.saved).toHaveLength(0);
  });

  it("rejects a non-positive amount", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const useCase = newUseCase(paymentRepository, attemptRepository);

    const result = await useCase.execute(command({ amount: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_AMOUNT" });
  });

  it("rejects a malformed amount", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const useCase = newUseCase(paymentRepository, attemptRepository);

    const result = await useCase.execute(command({ amount: "not-a-number" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_AMOUNT" });
  });

  it("idempotent replay: the SAME idempotencyKey returns the same payment without duplicating it", async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const attemptRepository = new InMemoryPaymentAttemptRepository();
    const useCase = newUseCase(paymentRepository, attemptRepository);

    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_INITIATED");
    if (replay.kind !== "ALREADY_INITIATED" || first.kind !== "INITIATED") throw new Error("unreachable");
    expect(replay.payment.id).toBe(first.payment.id);
    expect(paymentRepository.saved).toHaveLength(1);
    expect(attemptRepository.saved).toHaveLength(1);
  });
});
