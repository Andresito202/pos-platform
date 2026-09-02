import { describe, expect, it } from "vitest";
import { Actor, CashMovement, CashShift, Money, TenantScope } from "@pos-platform/domain";
import { CloseCashShiftUseCase, type CloseCashShiftCommand } from "../src/index.js";
import { FixedAuthorization, FixedClock, InMemoryCashShiftRepository, SequentialIdGenerator } from "./fakes.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const otherTenantScope = new TenantScope(
  "018f0000-0000-7000-8000-0000000000ff",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const openedAt = new Date("2026-09-02T08:00:00Z");
const closedAt = new Date("2026-09-02T20:00:00Z");
const clock = new FixedClock(closedAt);

function openShift(openingAmount = "200000"): CashShift {
  return CashShift.open({
    id: "018f0000-0000-7000-8000-000000000900",
    scope,
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: actor.id,
    openedByActor: actor,
    openedAt,
    openingAmount: Money.fromString(openingAmount),
  });
}

function command(overrides: Partial<CloseCashShiftCommand> = {}): CloseCashShiftCommand {
  return {
    scope,
    actor,
    cashShiftId: "018f0000-0000-7000-8000-000000000900",
    expectedVersion: 1,
    countedAmount: "200000",
    idempotencyKey: "close:1",
    ...overrides,
  };
}

describe("CloseCashShiftUseCase", () => {
  it("closes with no difference (escenario 1: esperado == contado)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    repository.seedPostedMovement(CashMovement.openingFloat(openShift(), "018f0000-0000-7000-8000-000000000901", openedAt));
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.count.differenceType).toBe("EXACT");
    expect(result.review).toBeNull();
    expect(result.differenceDetected).toBeNull();
    expect(result.shift.status).toBe("CLOSED");
    expect(result.shift.version).toBe(2);
    expect(repository.savedCloses).toHaveLength(1);
  });

  it("closes with a shortage, creating a CashDifferenceReview (escenario 5: esperado 200000, contado 190000)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    repository.seedPostedMovement(CashMovement.openingFloat(openShift(), "018f0000-0000-7000-8000-000000000901", openedAt));
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ countedAmount: "190000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.count.differenceType).toBe("SHORTAGE");
    expect(result.count.differenceAmount.toString()).toBe("-10000.000000");
    expect(result.review?.status).toBe("REVIEW_REQUIRED");
    expect(result.differenceDetected).not.toBeNull();
  });

  it("closes with an overage, creating a CashDifferenceReview (escenario 6: esperado 200000, contado 205000)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    repository.seedPostedMovement(CashMovement.openingFloat(openShift(), "018f0000-0000-7000-8000-000000000901", openedAt));
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ countedAmount: "205000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.count.differenceType).toBe("OVERAGE");
    expect(result.review?.status).toBe("REVIEW_REQUIRED");
  });

  it("rejects when the shift does not exist", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_FOUND" });
  });

  it("rejects without consulting idempotency or persisting when the actor is not authorized", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.savedCloses).toHaveLength(0);
  });

  it("checks authorization BEFORE idempotency replay, so an unauthorized actor cannot learn a shift is already closed", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift().close(closedAt));
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("rejects when the shift belongs to a different tenant", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ scope: otherTenantScope }));

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_FOUND" });
  });

  it("rejects a shift that is already closed (genuinely different request, different idempotency key)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift().close(closedAt));
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ idempotencyKey: "a-different-close-attempt" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_OPEN" });
  });

  it("rejects a stale expected_version", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("rejects a malformed counted amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ countedAmount: "not-a-number" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_COUNTED_AMOUNT" });
  });

  it("rejects a negative counted amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ countedAmount: "-1" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_COUNTED_AMOUNT" });
  });

  it(
    "idempotent replay: retrying a completed close with the SAME key returns the same CashCount, " +
    "even though the shift is now CLOSED (must not be evaluated as SHIFT_NOT_OPEN)",
    async () => {
      const repository = new InMemoryCashShiftRepository();
      repository.seedShift(openShift());
      const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

      const first = await useCase.execute(command());
      expect(first.kind).toBe("CLOSED");

      const replay = await useCase.execute(command());
      expect(replay.kind).toBe("ALREADY_CLOSED");
      expect(repository.savedCloses).toHaveLength(1);
    },
  );

  it("does not create a movement or another financial event on replay — only one CashCount ever exists", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    await useCase.execute(command());
    await useCase.execute(command());
    await useCase.execute(command());

    expect(repository.savedCloses).toHaveLength(1);
  });

  it("propagates a repository failure instead of swallowing it", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    repository.saveClose = async () => { throw new Error("repository unavailable"); };
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    await expect(useCase.execute(command())).rejects.toThrow("repository unavailable");
  });

  it("computes expected cash from ALL posted movements, not just the opening float", async () => {
    const repository = new InMemoryCashShiftRepository();
    const shift = openShift("500000");
    repository.seedShift(shift);
    const opening = CashMovement.openingFloat(shift, "018f0000-0000-7000-8000-000000000901", openedAt);
    const withdrawal = CashMovement.withdrawal(shift, "018f0000-0000-7000-8000-000000000902", 2, Money.fromString("300000"), openedAt);
    repository.seedPostedMovement(opening);
    repository.seedPostedMovement(withdrawal);
    const useCase = new CloseCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ countedAmount: "200000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.count.expectedAmount.toString()).toBe("200000.000000");
    expect(result.count.differenceType).toBe("EXACT");
  });
});
