import { describe, expect, it } from "vitest";
import { Actor, TenantScope, type CashMovement, type CashShift } from "@pos-platform/domain";
import {
  OpenCashShiftUseCase,
  type CashAuthorizationPort,
  type CashShiftRepository,
  type Clock,
  type IdGenerator,
  type OpenCashShiftCommand,
} from "../src/index.js";

class InMemoryCashShiftRepository implements CashShiftRepository {
  private readonly open = new Set<string>();
  readonly saved: { shift: CashShift; movement: CashMovement }[] = [];

  private key(scope: TenantScope, cashRegisterId: string): string {
    return `${scope.tenantId}:${scope.companyId}:${scope.branchId}:${cashRegisterId}`;
  }

  seedOpenShift(scope: TenantScope, cashRegisterId: string): void {
    this.open.add(this.key(scope, cashRegisterId));
  }

  async hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string): Promise<boolean> {
    return this.open.has(this.key(scope, cashRegisterId));
  }

  async save(shift: CashShift, movement: CashMovement): Promise<void> {
    this.open.add(this.key(shift.scope, shift.cashRegisterId));
    this.saved.push({ shift, movement });
  }
}

class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date { return this.at; }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  newId(): string { this.counter += 1; return `018f0000-0000-7000-8000-00000000${String(this.counter).padStart(4, "0")}`; }
}

class FixedAuthorization implements CashAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canOpenShift(): Promise<boolean> { return this.allow; }
}

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function command(overrides: Partial<OpenCashShiftCommand> = {}): OpenCashShiftCommand {
  return {
    scope,
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: actor.id,
    openedByActor: actor,
    openingAmount: "50000",
    ...overrides,
  };
}

describe("OpenCashShiftUseCase", () => {
  it("opens a shift, persists it, and returns the domain event when authorized and no conflict", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("OPENED");
    if (result.kind !== "OPENED") throw new Error("unreachable");
    expect(result.shift.status).toBe("OPEN");
    expect(result.event.type).toBe("CashShiftOpened");
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]!.movement.shiftSequence).toBe(1);
  });

  it("rejects without touching the repository when the actor is not authorized", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.saved).toHaveLength(0);
  });

  it("checks authorization BEFORE the incompatible-shift rule, per UC-CASH-001 flow order", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenShift(scope, "018f0000-0000-7000-8000-000000000020");
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("rejects an incompatible already-open shift for the same scope and register", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenShift(scope, "018f0000-0000-7000-8000-000000000020");
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" });
    expect(repository.saved).toHaveLength(0);
  });

  it("does not block a different cash register in the same scope", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenShift(scope, "018f0000-0000-7000-8000-000000000020");
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ cashRegisterId: "018f0000-0000-7000-8000-000000000099" }));

    expect(result.kind).toBe("OPENED");
  });

  it("rejects a negative opening amount without persisting", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ openingAmount: "-1" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NEGATIVE_OPENING_AMOUNT" });
    expect(repository.saved).toHaveLength(0);
  });

  it("accepts a zero opening amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    const useCase = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ openingAmount: "0" }));

    expect(result.kind).toBe("OPENED");
  });
});
