import { describe, expect, it } from "vitest";
import { Actor, CashShift, Money, TenantScope } from "@pos-platform/domain";
import { RegisterCashMovementUseCase, type RegisterCashMovementCommand } from "../src/index.js";
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
const clock = new FixedClock(new Date("2026-09-02T09:00:00Z"));

function openShift(): CashShift {
  return CashShift.open({
    id: "018f0000-0000-7000-8000-000000000900",
    scope,
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: actor.id,
    openedByActor: actor,
    openedAt: new Date("2026-09-02T08:00:00Z"),
    openingAmount: Money.fromString("500000"),
  });
}

function command(overrides: Partial<RegisterCashMovementCommand> = {}): RegisterCashMovementCommand {
  return {
    scope,
    cashShiftId: "018f0000-0000-7000-8000-000000000900",
    actor,
    movementType: "CASH_WITHDRAWAL",
    direction: "OUT",
    amount: "50000",
    expectedVersion: 1,
    idempotencyKey: "withdrawal:1",
    ...overrides,
  };
}

describe("RegisterCashMovementUseCase", () => {
  it("registers a valid withdrawal, persists it, and advances the shift version", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.movement).toMatchObject({ movementType: "CASH_WITHDRAWAL", direction: "OUT", shiftSequence: 1 });
    expect(result.shift.version).toBe(2);
    expect(result.event.type).toBe("CashMovementPosted");
    expect(repository.savedMovements).toHaveLength(1);
  });

  it("rejects when the shift belongs to a different tenant (scope mismatch, not just id)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ scope: otherTenantScope }));

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_FOUND" });
    expect(repository.savedMovements).toHaveLength(0);
  });

  it("rejects when the shift does not exist", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_FOUND" });
  });

  it("rejects when the shift is already closed", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift().close(new Date("2026-09-02T20:00:00Z")));
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_OPEN" });
  });

  it("rejects when the actor is not authorized", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.savedMovements).toHaveLength(0);
  });

  it("checks shift-open BEFORE authorization — UC-CASH-003's own order, the REVERSE of UC-CASH-001", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift().close(new Date("2026-09-02T20:00:00Z")));
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    // If authorization ran first, this would be NOT_AUTHORIZED. It must be
    // SHIFT_NOT_OPEN, proving the shift-state check happened first.
    expect(result).toEqual({ kind: "REJECTED", reason: "SHIFT_NOT_OPEN" });
  });

  it("rejects a zero amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ amount: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NON_POSITIVE_AMOUNT" });
  });

  it("rejects a negative amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ amount: "-1" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NON_POSITIVE_AMOUNT" });
  });

  it("rejects a malformed amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ amount: "not-a-number" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NON_POSITIVE_AMOUNT" });
  });

  it("replays idempotently: same key returns the same movement without a second save", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    expect(first.kind).toBe("REGISTERED");

    const replay = await useCase.execute(command());
    expect(replay.kind).toBe("ALREADY_REGISTERED");
    expect(repository.savedMovements).toHaveLength(1);
  });

  it("rejects a stale expected_version (concurrency conflict)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("propagates a repository failure instead of swallowing it", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedShift(openShift());
    repository.saveMovement = async () => { throw new Error("repository unavailable"); };
    const useCase = new RegisterCashMovementUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    await expect(useCase.execute(command())).rejects.toThrow("repository unavailable");
  });
});
