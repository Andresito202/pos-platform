import { describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { OpenCashShiftUseCase, type OpenCashShiftCommand } from "../src/index.js";
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
const otherBranchScope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-0000000000ee",
);
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const otherDeviceActor = Actor.device("018f0000-0000-7000-8000-000000000031");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function command(overrides: Partial<OpenCashShiftCommand> = {}): OpenCashShiftCommand {
  return {
    scope,
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: actor.id,
    openedByActor: actor,
    openingAmount: "50000",
    idempotencyKey: "open:1",
    ...overrides,
  };
}

function useCase(repository: InMemoryCashShiftRepository, allow = true): OpenCashShiftUseCase {
  return new OpenCashShiftUseCase(repository, new FixedAuthorization(allow), clock, new SequentialIdGenerator());
}

describe("OpenCashShiftUseCase", () => {
  it("A/C — opens a shift with an idempotency key, persists it, and returns the domain event when authorized and no conflict", async () => {
    const repository = new InMemoryCashShiftRepository();
    const result = await useCase(repository).execute(command());

    expect(result.kind).toBe("OPENED");
    if (result.kind !== "OPENED") throw new Error("unreachable");
    expect(result.shift.status).toBe("OPEN");
    expect(result.event.type).toBe("CashShiftOpened");
    expect(repository.savedOpens).toHaveLength(1);
    expect(repository.savedOpens[0]!.movement.shiftSequence).toBe(1);
  });

  it("rejects without touching the repository when the actor is not authorized", async () => {
    const repository = new InMemoryCashShiftRepository();
    const result = await useCase(repository, false).execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.savedOpens).toHaveLength(0);
  });

  it("checks authorization BEFORE the idempotency lookup and the incompatible-shift rule, per UC-CASH-001 flow order", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenRegister(scope, "018f0000-0000-7000-8000-000000000020", actor.id);
    const result = await useCase(repository, false).execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("F/G/H — an unauthorized replay of an already-opened shift's key does NOT leak ALREADY_OPENED (auth precedes idempotency)", async () => {
    const repository = new InMemoryCashShiftRepository();
    const first = await useCase(repository).execute(command());
    expect(first.kind).toBe("OPENED");

    const result = await useCase(repository, false).execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("rejects an incompatible already-open shift for the same scope, register and device", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenRegister(scope, "018f0000-0000-7000-8000-000000000020", actor.id);
    const result = await useCase(repository).execute(command({ idempotencyKey: "open:2" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" });
    expect(repository.savedOpens).toHaveLength(0);
  });

  it("does not block a different cash register in the same scope", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenRegister(scope, "018f0000-0000-7000-8000-000000000020", actor.id);
    const result = await useCase(repository).execute(command({ cashRegisterId: "018f0000-0000-7000-8000-000000000099" }));

    expect(result.kind).toBe("OPENED");
  });

  it("Q — a different device opening the same register is not blocked by hasIncompatibleOpenShift (the check is scoped to the exact 4-tuple, per cash-counting-schema.md:59)", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenRegister(scope, "018f0000-0000-7000-8000-000000000020", actor.id);

    const result = await useCase(repository).execute(command({ originDeviceId: otherDeviceActor.id, idempotencyKey: "open:device-2" }));

    expect(result.kind).toBe("OPENED");
  });

  it("Q — the SAME device on the SAME register is still blocked", async () => {
    const repository = new InMemoryCashShiftRepository();
    repository.seedOpenRegister(scope, "018f0000-0000-7000-8000-000000000020", actor.id);

    const result = await useCase(repository).execute(command({ idempotencyKey: "open:same-device" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" });
  });

  it("rejects a negative opening amount without persisting", async () => {
    const repository = new InMemoryCashShiftRepository();
    const result = await useCase(repository).execute(command({ openingAmount: "-1" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NEGATIVE_OPENING_AMOUNT" });
    expect(repository.savedOpens).toHaveLength(0);
  });

  it("accepts a zero opening amount", async () => {
    const repository = new InMemoryCashShiftRepository();
    const result = await useCase(repository).execute(command({ openingAmount: "0" }));

    expect(result.kind).toBe("OPENED");
  });

  describe("idempotency", () => {
    it("D/O/P/R — retry with the SAME key and SAME payload returns ALREADY_OPENED, without a second shift, movement, or event", async () => {
      const repository = new InMemoryCashShiftRepository();
      const first = await useCase(repository).execute(command());
      expect(first.kind).toBe("OPENED");
      if (first.kind !== "OPENED") throw new Error("unreachable");

      // A fresh use case instance simulates "the original caller never saw
      // the response" — the guarantee lives in persistence, not in reusing
      // the same in-process object.
      const replay = await useCase(repository).execute(command());

      expect(replay).toEqual({ kind: "ALREADY_OPENED", shift: first.shift });
      expect(repository.savedOpens).toHaveLength(1);
      expect("event" in replay).toBe(false);
    });

    it("E/S — retry with the SAME key but a DIFFERENT actor is an IDEMPOTENCY_CONFLICT, not a replay", async () => {
      const repository = new InMemoryCashShiftRepository();
      const first = await useCase(repository).execute(command());
      expect(first.kind).toBe("OPENED");

      const otherUser = Actor.forUser("018f0000-0000-7000-8000-000000000099");
      const result = await useCase(repository).execute(command({ openedByActor: otherUser }));

      expect(result).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      expect(repository.savedOpens).toHaveLength(1);
    });

    it("E/T — retry with the SAME key but a DIFFERENT cashRegisterId is an IDEMPOTENCY_CONFLICT", async () => {
      const repository = new InMemoryCashShiftRepository();
      const first = await useCase(repository).execute(command());
      expect(first.kind).toBe("OPENED");

      const result = await useCase(repository).execute(command({ cashRegisterId: "018f0000-0000-7000-8000-0000000000ab" }));

      expect(result).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      expect(repository.savedOpens).toHaveLength(1);
    });

    it("E — retry with the SAME key but a DIFFERENT openingAmount is an IDEMPOTENCY_CONFLICT", async () => {
      const repository = new InMemoryCashShiftRepository();
      const first = await useCase(repository).execute(command());
      expect(first.kind).toBe("OPENED");

      const result = await useCase(repository).execute(command({ openingAmount: "60000" }));

      expect(result).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      expect(repository.savedOpens).toHaveLength(1);
    });

    it("L — two OPEN requests with different keys on different registers both succeed independently", async () => {
      const repository = new InMemoryCashShiftRepository();
      const first = await useCase(repository).execute(command({ idempotencyKey: "open:a" }));
      const second = await useCase(repository).execute(
        command({ idempotencyKey: "open:b", cashRegisterId: "018f0000-0000-7000-8000-000000000099" }),
      );

      expect(first.kind).toBe("OPENED");
      expect(second.kind).toBe("OPENED");
      expect(repository.savedOpens).toHaveLength(2);
    });

    it("I — TENANT ESCAPE: a key used in tenant A does not resolve as a replay in tenant B — the request proceeds as a new one under B's own rules", async () => {
      const repository = new InMemoryCashShiftRepository();
      const idGenerator = new SequentialIdGenerator();
      const shared = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, idGenerator);
      const first = await shared.execute(command());
      if (first.kind !== "OPENED") throw new Error("unreachable");

      const result = await shared.execute(command({ scope: otherTenantScope }));

      // Proceeds as a genuinely new request in tenant B — not a leaked
      // replay of tenant A's shift, and not blocked by tenant A's register.
      if (result.kind !== "OPENED") throw new Error("unreachable");
      expect(result.shift.id).not.toBe(first.shift.id);
    });

    it("J — BRANCH ESCAPE: a key used in one branch does not resolve as a replay in a different branch of the same tenant", async () => {
      const repository = new InMemoryCashShiftRepository();
      const idGenerator = new SequentialIdGenerator();
      const shared = new OpenCashShiftUseCase(repository, new FixedAuthorization(true), clock, idGenerator);
      const first = await shared.execute(command());
      if (first.kind !== "OPENED") throw new Error("unreachable");

      const result = await shared.execute(command({ scope: otherBranchScope }));

      if (result.kind !== "OPENED") throw new Error("unreachable");
      expect(result.shift.id).not.toBe(first.shift.id);
    });

    it(
      "M — CONCURRENCY (documented limitation, not a false guarantee): two truly concurrent requests with the SAME key " +
      "can both pass the lookup before either saves, producing two shifts. APPLICATION GUARANTEE covers sequential " +
      "retries only; PHYSICAL GUARANTEE is DEFERRED to the UNIQUE constraint designed in Bloque 17, not yet materialized.",
      async () => {
        const repository = new InMemoryCashShiftRepository();
        const a = useCase(repository);
        const b = useCase(repository);

        const [resultA, resultB] = await Promise.all([a.execute(command()), b.execute(command())]);

        // Both may report OPENED under true interleaving — this in-memory
        // repository has no atomic check-and-set, exactly like the real
        // application layer without a database transaction + UNIQUE.
        const outcomes = [resultA.kind, resultB.kind];
        expect(outcomes.every((kind) => kind === "OPENED" || kind === "ALREADY_OPENED")).toBe(true);
        expect(repository.savedOpens.length).toBeGreaterThanOrEqual(1);
      },
    );

    it("N — two concurrent requests with DIFFERENT keys on different registers both succeed, unaffected by each other", async () => {
      const repository = new InMemoryCashShiftRepository();
      const a = useCase(repository);
      const b = useCase(repository);

      const [resultA, resultB] = await Promise.all([
        a.execute(command({ idempotencyKey: "open:concurrent-a" })),
        b.execute(command({ idempotencyKey: "open:concurrent-b", cashRegisterId: "018f0000-0000-7000-8000-000000000099" })),
      ]);

      expect(resultA.kind).toBe("OPENED");
      expect(resultB.kind).toBe("OPENED");
      expect(repository.savedOpens).toHaveLength(2);
    });
  });
});
