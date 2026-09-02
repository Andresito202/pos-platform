import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import {
  CloseCashShiftUseCase,
  OpenCashShiftUseCase,
  RegisterCashMovementUseCase,
  type CashAuthorizationPort,
  type Clock,
  type CloseCashShiftCommand,
  type IdGenerator,
  type OpenCashShiftCommand,
  type RegisterCashMovementCommand,
} from "@pos-platform/application";
import {
  CASH_CALCULATION_BEHAVIOR_CHECKSUM,
  CASH_CALCULATION_BEHAVIOR_V0,
  CASH_NO_POLICY_SENTINEL_UUID,
  CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
  CASH_TOLERANCE_BEHAVIOR_V0,
  LocalDatabase,
  SqliteCashShiftRepository,
} from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-cash-close-"));
  directories.push(value);
  return value;
}
afterEach(async () => {
  for (const item of directories.splice(0)) await rm(item, { recursive: true, force: true });
});

class FixedClock implements Clock {
  constructor(private at: Date) {}
  now(): Date {
    return this.at;
  }
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
}

class AlwaysAuthorized implements CashAuthorizationPort {
  async canOpenShift(): Promise<boolean> {
    return true;
  }
  async canRegisterMovement(): Promise<boolean> {
    return true;
  }
  async canCloseShift(): Promise<boolean> {
    return true;
  }
}

class NeverAuthorized implements CashAuthorizationPort {
  async canOpenShift(): Promise<boolean> {
    return true;
  }
  async canRegisterMovement(): Promise<boolean> {
    return false;
  }
  async canCloseShift(): Promise<boolean> {
    return false;
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  newId(): string {
    this.counter += 1;
    return `018f0000-0000-7000-8000-00000000${String(this.counter).padStart(4, "0")}`;
  }
}

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const cashRegisterId = "018f0000-0000-7000-8000-000000000020";

function seedCashRegister(database: LocalDatabase): void {
  database.native
    .prepare(
      `INSERT INTO cash_registers (
        id, tenant_id, company_id, branch_id, code, code_normalized, name, currency_code, status, created_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1)`,
    )
    .run(cashRegisterId, scope.tenantId, scope.companyId, scope.branchId, "CR-1", "cr-1", "Caja principal", "COP", "2026-09-02T08:00:00.000Z");
}

function openCommand(overrides: Partial<OpenCashShiftCommand> = {}): OpenCashShiftCommand {
  return {
    scope,
    cashRegisterId,
    originDeviceId: actor.id,
    openedByActor: actor,
    openingAmount: "100000",
    idempotencyKey: "open:1",
    businessDate: "2026-09-02",
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    currencyCode: "COP",
    ...overrides,
  };
}

async function openedShift(database: LocalDatabase, idGenerator: SequentialIdGenerator, clock: FixedClock) {
  seedCashRegister(database);
  const repository = new SqliteCashShiftRepository(database);
  const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
  const result = await useCase.execute(openCommand());
  if (result.kind !== "OPENED") throw new Error("unreachable");
  return { repository, shift: result.shift };
}

function closeCommand(overrides: Partial<CloseCashShiftCommand> = {}): CloseCashShiftCommand {
  return {
    scope,
    actor,
    cashShiftId: "PLACEHOLDER",
    expectedVersion: 1,
    countedAmount: "100000",
    idempotencyKey: "close:1",
    originDeviceId: actor.id,
    currencyCode: "COP",
    ...overrides,
  };
}

function movementCommand(overrides: Partial<RegisterCashMovementCommand> = {}): RegisterCashMovementCommand {
  return {
    scope,
    cashShiftId: "PLACEHOLDER",
    actor,
    movementType: "CASH_WITHDRAWAL",
    direction: "OUT",
    amount: "20000",
    expectedVersion: 1,
    idempotencyKey: "withdrawal:1",
    originDeviceId: actor.id,
    currencyCode: "COP",
    reasonCode: "BANK_DEPOSIT",
    ...overrides,
  };
}

describe("SqliteCashShiftRepository — CASH-002 (close)", () => {
  it("persists an exact close (no difference) with no review, and round-trips the count via findCloseByIdempotencyKey", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const result = await useCase.execute(closeCommand({ cashShiftId: shift.id, countedAmount: "100000" }));

      expect(result.kind).toBe("CLOSED");
      if (result.kind !== "CLOSED") throw new Error("unreachable");
      expect(result.review).toBeNull();
      expect(result.count.differenceType).toBe("EXACT");
      expect(result.shift.status).toBe("CLOSED");
      expect(result.shift.version).toBe(2);

      const reloaded = await repository.findCloseByIdempotencyKey(scope, "close:1");
      expect(reloaded).not.toBeNull();
      expect(reloaded?.id).toBe(result.count.id);
      expect(reloaded?.expectedAmount.toString()).toBe("100000.000000");
      expect(reloaded?.countedAmount.toString()).toBe("100000.000000");
      expect(reloaded?.differenceAmount.toString()).toBe("0.000000");

      const reviewRow = database.native.prepare("SELECT COUNT(*) AS n FROM cash_difference_reviews").get() as { n: number };
      expect(reviewRow.n).toBe(0);

      const shiftRow = database.native.prepare("SELECT status, version FROM cash_shifts WHERE id = ?").get(shift.id) as {
        status: string;
        version: number;
      };
      expect(shiftRow.status).toBe("CLOSED");
      expect(shiftRow.version).toBe(2);

      // Bloque 23-D: D1's restored NOT NULL sentinel/checksum, verified through the real saveClose() path.
      const countRow = database.native
        .prepare(
          "SELECT calculation_policy_version, calculation_checksum, tolerance_policy_version, tolerance_policy_checksum FROM cash_counts WHERE id = ?",
        )
        .get(result.count.id) as {
        calculation_policy_version: string;
        calculation_checksum: string;
        tolerance_policy_version: string;
        tolerance_policy_checksum: string;
      };
      expect(countRow.calculation_policy_version).toBe(CASH_NO_POLICY_SENTINEL_UUID);
      expect(countRow.calculation_policy_version).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(countRow.tolerance_policy_version).toBe(CASH_NO_POLICY_SENTINEL_UUID);
      expect(countRow.calculation_checksum).toBe(CASH_CALCULATION_BEHAVIOR_CHECKSUM);
      expect(countRow.calculation_checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(countRow.calculation_checksum).not.toContain(CASH_CALCULATION_BEHAVIOR_V0);
      expect(countRow.tolerance_policy_checksum).toBe(CASH_TOLERANCE_BEHAVIOR_CHECKSUM);
      expect(countRow.tolerance_policy_checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(countRow.tolerance_policy_checksum).not.toContain(CASH_TOLERANCE_BEHAVIOR_V0);
    } finally {
      database.close();
    }
  });

  it("sentinel/checksum are identical regardless of tenant, device, or shift — fixed constants, not per-row values", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      seedCashRegister(database);
      const repository = new SqliteCashShiftRepository(database);
      const openUseCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const closeUseCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);

      const otherDeviceActor = Actor.device("018f0000-0000-7000-8000-000000000099");
      const firstShift = await openUseCase.execute(openCommand({ idempotencyKey: "open:x" }));
      const secondShift = await openUseCase.execute(
        openCommand({
          idempotencyKey: "open:y",
          originDeviceId: otherDeviceActor.id,
          openedByActor: otherDeviceActor,
        }),
      );
      if (firstShift.kind !== "OPENED" || secondShift.kind !== "OPENED") throw new Error("unreachable");

      const firstClose = await closeUseCase.execute(closeCommand({ cashShiftId: firstShift.shift.id, idempotencyKey: "close:x" }));
      const secondClose = await closeUseCase.execute(
        closeCommand({ cashShiftId: secondShift.shift.id, idempotencyKey: "close:y", originDeviceId: otherDeviceActor.id }),
      );
      if (firstClose.kind !== "CLOSED" || secondClose.kind !== "CLOSED") throw new Error("unreachable");

      const rows = database.native
        .prepare("SELECT id, calculation_policy_version, calculation_checksum FROM cash_counts ORDER BY created_at")
        .all() as Array<{ id: string; calculation_policy_version: string; calculation_checksum: string }>;
      expect(rows).toHaveLength(2);
      // different shifts, different devices, same tenant — sentinel/checksum must still be byte-identical
      expect(rows[0]!.calculation_policy_version).toBe(rows[1]!.calculation_policy_version);
      expect(rows[0]!.calculation_checksum).toBe(rows[1]!.calculation_checksum);
    } finally {
      database.close();
    }
  });

  it("persists a SHORTAGE close with a real cash_difference_reviews row", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const result = await useCase.execute(closeCommand({ cashShiftId: shift.id, countedAmount: "90000" }));

      expect(result.kind).toBe("CLOSED");
      if (result.kind !== "CLOSED") throw new Error("unreachable");
      expect(result.count.differenceType).toBe("SHORTAGE");
      expect(result.count.differenceAmount.toString()).toBe("-10000.000000");
      expect(result.review).not.toBeNull();

      const reviewRow = database.native
        .prepare("SELECT status, cash_count_id, cash_shift_id, tolerance_policy_version, tolerance_policy_checksum FROM cash_difference_reviews WHERE id = ?")
        .get(result.review!.id) as {
        status: string;
        cash_count_id: string;
        cash_shift_id: string;
        tolerance_policy_version: string;
        tolerance_policy_checksum: string;
      };
      expect(reviewRow.status).toBe("REVIEW_REQUIRED");
      expect(reviewRow.cash_count_id).toBe(result.count.id);
      expect(reviewRow.cash_shift_id).toBe(shift.id);
      expect(reviewRow.tolerance_policy_version).toBe(CASH_NO_POLICY_SENTINEL_UUID);
      expect(reviewRow.tolerance_policy_checksum).toBe(CASH_TOLERANCE_BEHAVIOR_CHECKSUM);
    } finally {
      database.close();
    }
  });

  it("replay: same idempotency key returns ALREADY_CLOSED with the same count, no duplicate rows", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const first = await useCase.execute(closeCommand({ cashShiftId: shift.id }));
      const second = await useCase.execute(closeCommand({ cashShiftId: shift.id }));

      expect(first.kind).toBe("CLOSED");
      expect(second.kind).toBe("ALREADY_CLOSED");
      if (first.kind !== "CLOSED" || second.kind !== "ALREADY_CLOSED") throw new Error("unreachable");
      expect(second.count.id).toBe(first.count.id);

      const count = database.native.prepare("SELECT COUNT(*) AS n FROM cash_counts").get() as { n: number };
      expect(count.n).toBe(1);
    } finally {
      database.close();
    }
  });

  it("authorization: an unauthorized actor is rejected before touching the repository", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new CloseCashShiftUseCase(repository, new NeverAuthorized(), clock, idGenerator);
      const result = await useCase.execute(closeCommand({ cashShiftId: shift.id }));

      expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
      const count = database.native.prepare("SELECT COUNT(*) AS n FROM cash_counts").get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      database.close();
    }
  });

  it("tenant isolation: findCloseByIdempotencyKey under a different tenant sees nothing", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      await useCase.execute(closeCommand({ cashShiftId: shift.id }));

      const otherTenantScope = new TenantScope("018f0000-0000-7000-8000-0000000000ff", scope.companyId, scope.branchId);
      expect(await repository.findCloseByIdempotencyKey(otherTenantScope, "close:1")).toBeNull();
    } finally {
      database.close();
    }
  });

  it(
    "real concurrency: two genuinely concurrent close attempts on the SAME shift with DIFFERENT idempotency keys — " +
    "exactly one wins CLOSED, the other loses the physical version race and is rejected, no double-close",
    async () => {
      const database = LocalDatabase.open({ dataDirectory: await directory() });
      try {
        const idGenerator = new SequentialIdGenerator();
        const clock = new FixedClock(new Date("2026-09-02T20:00:00Z"));
        const { repository, shift } = await openedShift(database, idGenerator, clock);

        const a = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
        const b = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);

        const [resultA, resultB] = await Promise.all([
          a.execute(closeCommand({ cashShiftId: shift.id, idempotencyKey: "close:a" })),
          b.execute(closeCommand({ cashShiftId: shift.id, idempotencyKey: "close:b" })),
        ]);

        const outcomes = [resultA.kind, resultB.kind].sort();
        expect(outcomes).toEqual(["CLOSED", "REJECTED"]);

        const rejected = resultA.kind === "REJECTED" ? resultA : resultB;
        if (rejected.kind !== "REJECTED") throw new Error("unreachable");
        expect(rejected.reason).toBe("VERSION_CONFLICT");

        const shiftRow = database.native.prepare("SELECT status, version FROM cash_shifts WHERE id = ?").get(shift.id) as {
          status: string;
          version: number;
        };
        expect(shiftRow.status).toBe("CLOSED");
        expect(shiftRow.version).toBe(2);

        const countRows = database.native.prepare("SELECT COUNT(*) AS n FROM cash_counts").get() as { n: number };
        expect(countRows.n).toBe(1);
      } finally {
        database.close();
      }
    },
  );
});

describe("SqliteCashShiftRepository — CASH-003 (movements)", () => {
  it("persists a movement, advances shift version, and round-trips via listPostedMovements", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const result = await useCase.execute(movementCommand({ cashShiftId: shift.id, amount: "20000" }));

      expect(result.kind).toBe("REGISTERED");
      if (result.kind !== "REGISTERED") throw new Error("unreachable");
      expect(result.shift.version).toBe(2);
      expect(result.movement.shiftSequence).toBe(2);

      const posted = await repository.listPostedMovements(shift.id);
      expect(posted).toHaveLength(2); // OPENING_FLOAT + this withdrawal
      const withdrawal = posted.find((m) => m.movementType === "CASH_WITHDRAWAL");
      expect(withdrawal?.amount.toString()).toBe("20000.000000");
      expect(withdrawal?.direction).toBe("OUT");

      const shiftRow = database.native.prepare("SELECT version, last_movement_sequence FROM cash_shifts WHERE id = ?").get(shift.id) as {
        version: number;
        last_movement_sequence: number;
      };
      expect(shiftRow.version).toBe(2);
      expect(shiftRow.last_movement_sequence).toBe(2);

      const movementRow = database.native
        .prepare("SELECT reason_code, actor_type, actor_id, currency_code FROM cash_movements WHERE id = ?")
        .get(result.movement.id) as { reason_code: string; actor_type: string; actor_id: string; currency_code: string };
      expect(movementRow.reason_code).toBe("BANK_DEPOSIT");
      expect(movementRow.actor_type).toBe("DEVICE");
      expect(movementRow.actor_id).toBe(actor.id);
      expect(movementRow.currency_code).toBe("COP");
    } finally {
      database.close();
    }
  });

  it("replay: same idempotency key returns ALREADY_REGISTERED with the same movement, no duplicate row", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      const first = await useCase.execute(movementCommand({ cashShiftId: shift.id }));
      const second = await useCase.execute(movementCommand({ cashShiftId: shift.id }));

      expect(first.kind).toBe("REGISTERED");
      expect(second.kind).toBe("ALREADY_REGISTERED");
      if (first.kind !== "REGISTERED" || second.kind !== "ALREADY_REGISTERED") throw new Error("unreachable");
      expect(second.movement.id).toBe(first.movement.id);

      const rows = database.native.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE movement_type = 'CASH_WITHDRAWAL'").get() as {
        n: number;
      };
      expect(rows.n).toBe(1);
    } finally {
      database.close();
    }
  });

  it("authorization: an unauthorized actor is rejected, no row written", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new RegisterCashMovementUseCase(repository, new NeverAuthorized(), clock, idGenerator);
      const result = await useCase.execute(movementCommand({ cashShiftId: shift.id }));

      expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
      const rows = database.native.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE movement_type = 'CASH_WITHDRAWAL'").get() as {
        n: number;
      };
      expect(rows.n).toBe(0);
    } finally {
      database.close();
    }
  });

  it("tenant isolation: findMovementByIdempotencyKey under a different tenant sees nothing", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const useCase = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      await useCase.execute(movementCommand({ cashShiftId: shift.id }));

      const otherTenantScope = new TenantScope("018f0000-0000-7000-8000-0000000000ff", scope.companyId, scope.branchId);
      expect(await repository.findMovementByIdempotencyKey(otherTenantScope, "withdrawal:1")).toBeNull();
    } finally {
      database.close();
    }
  });

  it(
    "real concurrency: two genuinely concurrent movements on the SAME shift with DIFFERENT idempotency keys — exactly " +
    "one wins REGISTERED, the other loses the physical version/sequence race and is rejected, never two movements at " +
    "the same shift_sequence",
    async () => {
      const database = LocalDatabase.open({ dataDirectory: await directory() });
      try {
        const idGenerator = new SequentialIdGenerator();
        const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
        const { repository, shift } = await openedShift(database, idGenerator, clock);

        const a = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
        const b = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);

        const [resultA, resultB] = await Promise.all([
          a.execute(movementCommand({ cashShiftId: shift.id, idempotencyKey: "withdrawal:a" })),
          b.execute(movementCommand({ cashShiftId: shift.id, idempotencyKey: "withdrawal:b" })),
        ]);

        const outcomes = [resultA.kind, resultB.kind].sort();
        expect(outcomes).toEqual(["REGISTERED", "REJECTED"]);

        const rejected = resultA.kind === "REJECTED" ? resultA : resultB;
        if (rejected.kind !== "REJECTED") throw new Error("unreachable");
        expect(rejected.reason).toBe("VERSION_CONFLICT");

        const movementRows = database.native
          .prepare("SELECT shift_sequence FROM cash_movements WHERE movement_type = 'CASH_WITHDRAWAL'")
          .all() as Array<{ shift_sequence: number }>;
        expect(movementRows).toHaveLength(1);

        const shiftRow = database.native.prepare("SELECT version FROM cash_shifts WHERE id = ?").get(shift.id) as { version: number };
        expect(shiftRow.version).toBe(2);
      } finally {
        database.close();
      }
    },
  );

  it("ExpectedCash integration: registering movements before close feeds a correct expected amount into the count", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const idGenerator = new SequentialIdGenerator();
      const clock = new FixedClock(new Date("2026-09-02T10:00:00Z"));
      const { repository, shift } = await openedShift(database, idGenerator, clock);

      const movementUseCase = new RegisterCashMovementUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      await movementUseCase.execute(movementCommand({ cashShiftId: shift.id, idempotencyKey: "withdrawal:1", amount: "15000" }));

      clock.advance(60_000);
      const closeUseCase = new CloseCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
      // opening 100000 IN, withdrawal 15000 OUT -> expected 85000
      const result = await closeUseCase.execute(closeCommand({ cashShiftId: shift.id, expectedVersion: 2, countedAmount: "85000" }));

      expect(result.kind).toBe("CLOSED");
      if (result.kind !== "CLOSED") throw new Error("unreachable");
      expect(result.count.expectedAmount.toString()).toBe("85000.000000");
      expect(result.count.differenceType).toBe("EXACT");
    } finally {
      database.close();
    }
  });
});
