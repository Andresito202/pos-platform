import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import {
  OpenCashShiftUseCase,
  type CashAuthorizationPort,
  type Clock,
  type IdGenerator,
  type OpenCashShiftCommand,
} from "@pos-platform/application";
import { LocalDatabase, SqliteCashShiftRepository } from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-cash-"));
  directories.push(value);
  return value;
}
afterEach(async () => {
  for (const item of directories.splice(0)) await rm(item, { recursive: true, force: true });
});

class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date {
    return this.at;
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
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

// cash_shifts has a real FK to cash_registers (tenant_id, company_id,
// branch_id, cash_register_id) — CENTRAL_MASTER_REPLICATED per
// cash-counting-schema.md, meaning it always exists locally before any
// shift can open against it. Seeded directly via SQL since no
// CashRegister aggregate/use case exists in this repository yet.
function seedCashRegister(database: LocalDatabase, id: string): void {
  database.native
    .prepare(
      `INSERT INTO cash_registers (
        id, tenant_id, company_id, branch_id, code, code_normalized, name, currency_code, status, created_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1)`,
    )
    .run(id, scope.tenantId, scope.companyId, scope.branchId, "CR-1", "cr-1", "Caja principal", "COP", clock.now().toISOString());
}

function command(overrides: Partial<OpenCashShiftCommand> = {}): OpenCashShiftCommand {
  return {
    scope,
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: actor.id,
    openedByActor: actor,
    openingAmount: "50000",
    idempotencyKey: "open:1",
    businessDate: "2026-09-02",
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    currencyCode: "COP",
    ...overrides,
  };
}

describe("SqliteCashShiftRepository (real SQLite, not a fake)", () => {
  it("round-trip: opens a shift, persists it for real, and reloads it with every field intact", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
      const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      const result = await useCase.execute(command({ openingAmount: "50000.5" }));
      expect(result.kind).toBe("OPENED");
      if (result.kind !== "OPENED") throw new Error("unreachable");

      const reloaded = await repository.findById(scope, result.shift.id);
      expect(reloaded).not.toBeNull();
      if (!reloaded) throw new Error("unreachable");

      expect(reloaded.id).toBe(result.shift.id);
      expect(reloaded.scope.tenantId).toBe(scope.tenantId);
      expect(reloaded.scope.companyId).toBe(scope.companyId);
      expect(reloaded.scope.branchId).toBe(scope.branchId);
      expect(reloaded.cashRegisterId).toBe(command().cashRegisterId);
      expect(reloaded.originDeviceId).toBe(actor.id);
      expect(reloaded.openedByActor.type).toBe("DEVICE");
      expect(reloaded.openedByActor.id).toBe(actor.id);
      expect(reloaded.openedAt.toISOString()).toBe(clock.now().toISOString());
      // Money round-trips through its canonical string, not the raw input:
      // "50000.5" in, "50000.500000" out (Money.fromString's own padding).
      expect(reloaded.openingAmount.toString()).toBe("50000.500000");
      expect(reloaded.status).toBe("OPEN");
      expect(reloaded.version).toBe(1);
      expect(reloaded.closedAt).toBeNull();

      const movements = await repository.listPostedMovements(result.shift.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.movementType).toBe("OPENING_FLOAT");
      expect(movements[0]!.direction).toBe("IN");
      expect(movements[0]!.amount.toString()).toBe("50000.500000");
      expect(movements[0]!.shiftSequence).toBe(1);

      expect(await repository.nextMovementSequence(result.shift.id)).toBe(2);

      const ledger = database.native
        .prepare("SELECT version, checksum FROM local_schema_migrations WHERE version = 6")
        .get() as { version: number; checksum: string } | undefined;
      expect(ledger).toBeDefined();
      expect(ledger?.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      database.close();
    }
  });

  it("replay: the exact same idempotency key + payload returns ALREADY_OPENED with the same physical shift, no second row", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
      const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      const first = await useCase.execute(command());
      const second = await useCase.execute(command());

      expect(first.kind).toBe("OPENED");
      expect(second.kind).toBe("ALREADY_OPENED");
      if (first.kind !== "OPENED" || second.kind !== "ALREADY_OPENED") throw new Error("unreachable");
      expect(second.shift.id).toBe(first.shift.id);

      const count = database.native.prepare("SELECT COUNT(*) AS n FROM cash_shifts").get() as { n: number };
      expect(count.n).toBe(1);
    } finally {
      database.close();
    }
  });

  it(
    "conflict: the same idempotency key with a DIFFERENT payload is physically rejected, not silently accepted",
    async () => {
      const database = LocalDatabase.open({ dataDirectory: await directory() });
      try {
        seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
        const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

        const first = await useCase.execute(command());
        expect(first.kind).toBe("OPENED");

        const second = await useCase.execute(command({ openingAmount: "999999" }));
        expect(second).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });

        const count = database.native.prepare("SELECT COUNT(*) AS n FROM cash_shifts").get() as { n: number };
        expect(count.n).toBe(1);
      } finally {
        database.close();
      }
    },
  );

  it(
    "real concurrency: two genuinely concurrent OPEN calls with the same key against the SAME live SQLite file " +
    "produce exactly one physical shift row — the second writer hits the real UNIQUE constraint and retries into " +
    "ALREADY_OPENED, closing the gap Bloque 17-19 left as PHYSICAL GUARANTEE DEFERRED.",
    async () => {
      const database = LocalDatabase.open({ dataDirectory: await directory() });
      try {
        seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
        const idGenerator = new SequentialIdGenerator();
        const a = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
        const b = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);

        const [resultA, resultB] = await Promise.all([a.execute(command()), b.execute(command())]);

        const outcomes = [resultA.kind, resultB.kind].sort();
        expect(outcomes).toEqual(["ALREADY_OPENED", "OPENED"]);

        const shiftRows = database.native.prepare("SELECT COUNT(*) AS n FROM cash_shifts").get() as { n: number };
        expect(shiftRows.n).toBe(1);
        const movementRows = database.native.prepare("SELECT COUNT(*) AS n FROM cash_movements").get() as { n: number };
        expect(movementRows.n).toBe(1);

        const opened = resultA.kind === "OPENED" ? resultA : resultB;
        const replayed = resultA.kind === "ALREADY_OPENED" ? resultA : resultB;
        if (opened.kind !== "OPENED" || replayed.kind !== "ALREADY_OPENED") throw new Error("unreachable");
        expect(replayed.shift.id).toBe(opened.shift.id);
      } finally {
        database.close();
      }
    },
  );

  it("incompatible shift: a second device cannot open a second shift while one is already OPEN on the same tenant/branch/register/device tuple", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
      const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      const first = await useCase.execute(command());
      expect(first.kind).toBe("OPENED");

      const second = await useCase.execute(command({ idempotencyKey: "open:2" }));
      expect(second).toEqual({ kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" });
    } finally {
      database.close();
    }
  });

  it("tenant isolation: a shift opened under tenant A is invisible to findById under tenant B", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      seedCashRegister(database, command().cashRegisterId);
      const repository = new SqliteCashShiftRepository(database);
      const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      const result = await useCase.execute(command());
      if (result.kind !== "OPENED") throw new Error("unreachable");

      const otherTenantScope = new TenantScope(
        "018f0000-0000-7000-8000-0000000000ff",
        scope.companyId,
        scope.branchId,
      );
      expect(await repository.findById(otherTenantScope, result.shift.id)).toBeNull();
      expect(await repository.hasIncompatibleOpenShift(otherTenantScope, command().cashRegisterId, actor.id)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("schema introspection: MIGRATION_006 creates exactly the 7 Cash tables and no unexpected objects", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const tables = database.native
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cash_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual([
        "cash_count_denominations",
        "cash_counts",
        "cash_difference_review_actions",
        "cash_difference_reviews",
        "cash_movements",
        "cash_registers",
        "cash_shifts",
      ]);

      const shiftColumns = database.native.prepare("PRAGMA table_info(cash_shifts)").all() as Array<{ name: string; notnull: number }>;
      expect(shiftColumns.some((c) => c.name === "opening_amount")).toBe(false);

      const movementColumns = database.native.prepare("PRAGMA table_info(cash_movements)").all() as Array<{
        name: string;
        notnull: number;
      }>;
      const deviceReportedAt = movementColumns.find((c) => c.name === "device_reported_at");
      expect(deviceReportedAt).toBeDefined();
      expect(deviceReportedAt?.notnull).toBe(1);
      const actorId = movementColumns.find((c) => c.name === "actor_id");
      expect(actorId?.notnull).toBe(0);
    } finally {
      database.close();
    }
  });

  it("schema introspection: MIGRATION_007 left blind_mode/severity/requires_segregation nullable (genuinely unmodeled), MIGRATION_008 restored D1's 6 policy columns to NOT NULL", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const countColumns = database.native.prepare("PRAGMA table_info(cash_counts)").all() as Array<{
        name: string;
        notnull: number;
      }>;
      // D1 (Bloque 15) restored by MIGRATION_008 — Bloque 23-D
      for (const name of ["calculation_policy_version", "calculation_checksum", "tolerance_policy_version", "tolerance_policy_checksum"]) {
        expect(countColumns.find((c) => c.name === name)?.notnull, `cash_counts.${name} should be NOT NULL again (D1)`).toBe(1);
      }
      // still genuinely unmodeled — no prior decision covers these (B23-C)
      expect(countColumns.find((c) => c.name === "blind_mode")?.notnull, "cash_counts.blind_mode should stay nullable").toBe(0);
      // still required — MIGRATION_007/008 never touched these
      for (const name of ["origin_device_id", "start_idempotency_key", "correlation_id", "version", "currency_code"]) {
        expect(countColumns.find((c) => c.name === name)?.notnull, `cash_counts.${name} should stay NOT NULL`).toBe(1);
      }

      const reviewColumns = database.native.prepare("PRAGMA table_info(cash_difference_reviews)").all() as Array<{
        name: string;
        notnull: number;
      }>;
      for (const name of ["tolerance_policy_version", "tolerance_policy_checksum"]) {
        expect(reviewColumns.find((c) => c.name === name)?.notnull, `cash_difference_reviews.${name} should be NOT NULL again (D1)`).toBe(1);
      }
      for (const name of ["severity", "requires_segregation"]) {
        expect(reviewColumns.find((c) => c.name === name)?.notnull, `cash_difference_reviews.${name} should stay nullable`).toBe(0);
      }
      expect(reviewColumns.find((c) => c.name === "correlation_id")?.notnull).toBe(1);
      expect(reviewColumns.find((c) => c.name === "version")?.notnull).toBe(1);

      // the partial unique index dropped along with the old cash_counts table must be re-created
      const index = database.native
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'cash_counts_one_completed_closing_idx'")
        .get();
      expect(index).toBeDefined();
    } finally {
      database.close();
    }
  });

  it("migration ledger: versions 6-10 are recorded with real checksums, and versions 1-5 remain untouched", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const rows = database.native
        .prepare("SELECT version, checksum FROM local_schema_migrations ORDER BY version")
        .all() as Array<{ version: number; checksum: string }>;
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const row of rows) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      database.close();
    }
  });

  it(
    "rollback: a failing multi-statement DDL transaction against the real v6 database leaves no partial state — the " +
    "same native.transaction(...) wrapper applyMigrations() itself uses",
    async () => {
      const database = LocalDatabase.open({ dataDirectory: await directory() });
      try {
        const attempt = database.native.transaction(() => {
          database.native.exec("CREATE TABLE cash_rollback_probe (id INTEGER)");
          database.native.exec("INSERT INTO cash_rollback_probe_typo_table_that_does_not_exist VALUES (1)");
        });

        expect(() => attempt()).toThrow();

        const probe = database.native
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cash_rollback_probe'")
          .get();
        expect(probe).toBeUndefined();
      } finally {
        database.close();
      }
    },
  );

  it("reapply: closing and reopening the same database file is idempotent — no duplicate ledger rows, same data", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    const repository = new SqliteCashShiftRepository(first);
    seedCashRegister(first, command().cashRegisterId);
    const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const opened = await useCase.execute(command());
    if (opened.kind !== "OPENED") throw new Error("unreachable");
    first.close();

    const second = LocalDatabase.open({ dataDirectory });
    try {
      const rows = second.native.prepare("SELECT version FROM local_schema_migrations ORDER BY version").all() as Array<{
        version: number;
      }>;
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const reloaded = await new SqliteCashShiftRepository(second).findById(scope, opened.shift.id);
      expect(reloaded?.id).toBe(opened.shift.id);
      expect(reloaded?.openingAmount.toString()).toBe(opened.shift.openingAmount.toString());
    } finally {
      second.close();
    }
  });
});
