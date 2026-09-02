import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { PostgresCashShiftRepository, PostgresDatabase } from "../src/index.js";
import { applyCashSchema, databaseUrl, dropDatabase, recreateDatabase, roleUrl } from "./test-support.js";

const DB_NAME = "cash_adapter_test";

class FixedClock implements Clock {
  constructor(private at: Date) {}
  now(): Date { return this.at; }
  advance(ms: number): void { this.at = new Date(this.at.getTime() + ms); }
}
class AlwaysAuthorized implements CashAuthorizationPort {
  async canOpenShift(): Promise<boolean> { return true; }
  async canRegisterMovement(): Promise<boolean> { return true; }
  async canCloseShift(): Promise<boolean> { return true; }
}
class NeverAuthorized implements CashAuthorizationPort {
  async canOpenShift(): Promise<boolean> { return false; }
  async canRegisterMovement(): Promise<boolean> { return false; }
  async canCloseShift(): Promise<boolean> { return false; }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `018f0000-0000-7000-8000-${idCounter.toString().padStart(12, "0")}`;
}
class SequentialIdGenerator implements IdGenerator {
  newId(): string { return newId(); }
}

function scope(tenantId: string, companyId: string, branchId: string): TenantScope {
  return new TenantScope(tenantId, companyId, branchId);
}

describe("PostgresCashShiftRepository (real PostgreSQL, not a fake)", () => {
  let database: PostgresDatabase;
  let repository: PostgresCashShiftRepository;
  const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

  beforeAll(async () => {
    await recreateDatabase(DB_NAME);
    await applyCashSchema(databaseUrl(DB_NAME));
  }, 60_000);

  afterAll(async () => {
    await database?.close();
    await dropDatabase(DB_NAME);
  });

  async function seedTenant(): Promise<{ scope: TenantScope; actor: Actor; cashRegisterId: string }> {
    const tenantId = newId();
    const companyId = newId();
    const branchId = newId();
    const cashRegisterId = newId();
    const deviceId = newId();
    const adminPool = new (await import("pg")).Pool({ connectionString: databaseUrl(DB_NAME) });
    try {
      await adminPool.query(
        `INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES ($1,'T','ACTIVE',clock_timestamp(),clock_timestamp())`,
        [tenantId],
      );
      await adminPool.query(
        `INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,'C','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())`,
        [companyId, tenantId],
      );
      await adminPool.query(
        `INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES ($1,$2,$3,'B','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())`,
        [branchId, tenantId, companyId],
      );
      const client = await adminPool.connect();
      try {
        await client.query("SET ROLE pos_app");
        await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
        await client.query(
          `INSERT INTO cash.cash_registers(id,tenant_id,company_id,branch_id,code,code_normalized,name,currency_code,status,created_at,version) VALUES ($1,$2,$3,$4,'CR-1','cr-1','Caja','COP','ACTIVE',clock_timestamp(),1)`,
          [cashRegisterId, tenantId, companyId, branchId],
        );
        await client.query("RESET ROLE");
      } finally {
        client.release();
      }
    } finally {
      await adminPool.end();
    }
    return { scope: scope(tenantId, companyId, branchId), actor: Actor.device(deviceId), cashRegisterId };
  }

  function openCommand(fixture: { scope: TenantScope; actor: Actor; cashRegisterId: string }, overrides: Partial<OpenCashShiftCommand> = {}): OpenCashShiftCommand {
    return {
      scope: fixture.scope,
      cashRegisterId: fixture.cashRegisterId,
      originDeviceId: fixture.actor.id,
      openedByActor: fixture.actor,
      openingAmount: "100000",
      idempotencyKey: "open:1",
      businessDate: "2026-09-02",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      currencyCode: "COP",
      ...overrides,
    };
  }

  beforeAll(() => {
    database = PostgresDatabase.open(roleUrl(databaseUrl(DB_NAME), "pos_app"));
  });

  it("OPEN: persists a shift and round-trips it exactly via the real adapter", async () => {
    const fixture = await seedTenant();
    repository = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const useCase = new OpenCashShiftUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

    const result = await useCase.execute(openCommand(fixture, { openingAmount: "50000.5" }));
    expect(result.kind).toBe("OPENED");
    if (result.kind !== "OPENED") throw new Error("unreachable");

    const reloaded = await repository.findById(fixture.scope, result.shift.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe(result.shift.id);
    expect(reloaded?.openingAmount.toString()).toBe("50000.500000");
    expect(reloaded?.status).toBe("OPEN");
    expect(reloaded?.version).toBe(1);

    const movements = await repository.listPostedMovements(result.shift.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe("OPENING_FLOAT");
  });

  it("OPEN: replay (same key+payload) returns ALREADY_OPENED; conflict (same key, different payload) is rejected", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const useCase = new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

    const first = await useCase.execute(openCommand(fixture));
    const replay = await useCase.execute(openCommand(fixture));
    expect(first.kind).toBe("OPENED");
    expect(replay.kind).toBe("ALREADY_OPENED");

    const conflict = await useCase.execute(openCommand(fixture, { openingAmount: "999999" }));
    expect(conflict).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
  });

  it("OPEN: unauthorized actor is rejected before touching the repository", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const useCase = new OpenCashShiftUseCase(repo, new NeverAuthorized(), clock, new SequentialIdGenerator());
    const result = await useCase.execute(openCommand(fixture));
    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("OPEN: tenant isolation — a shift in tenant A is invisible to findById under tenant B", async () => {
    const fixtureA = await seedTenant();
    const fixtureB = await seedTenant();
    const repoA = new PostgresCashShiftRepository(database, fixtureA.scope.tenantId);
    const useCase = new OpenCashShiftUseCase(repoA, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const result = await useCase.execute(openCommand(fixtureA));
    if (result.kind !== "OPENED") throw new Error("unreachable");

    const repoB = new PostgresCashShiftRepository(database, fixtureB.scope.tenantId);
    expect(await repoB.findById(fixtureB.scope, result.shift.id)).toBeNull();
  });

  it("OPEN: real concurrency — two genuinely concurrent opens with the SAME key produce exactly one physical shift", async () => {
    const fixture = await seedTenant();
    const repoA = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const repoB = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const shared = new SequentialIdGenerator();
    const a = new OpenCashShiftUseCase(repoA, new AlwaysAuthorized(), clock, shared);
    const b = new OpenCashShiftUseCase(repoB, new AlwaysAuthorized(), clock, shared);

    const [resultA, resultB] = await Promise.all([a.execute(openCommand(fixture)), b.execute(openCommand(fixture))]);
    const outcomes = [resultA.kind, resultB.kind].sort();
    expect(outcomes).toEqual(["ALREADY_OPENED", "OPENED"]);

    const opened = resultA.kind === "OPENED" ? resultA : resultB;
    const replayed = resultA.kind === "ALREADY_OPENED" ? resultA : resultB;
    if (opened.kind !== "OPENED" || replayed.kind !== "ALREADY_OPENED") throw new Error("unreachable");
    expect(replayed.shift.id).toBe(opened.shift.id);
  });

  it("OPEN: real concurrency — two DIFFERENT keys on the same register/device race the incompatible-shift constraint", async () => {
    const fixture = await seedTenant();
    const repoA = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const repoB = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const shared = new SequentialIdGenerator();
    const a = new OpenCashShiftUseCase(repoA, new AlwaysAuthorized(), clock, shared);
    const b = new OpenCashShiftUseCase(repoB, new AlwaysAuthorized(), clock, shared);

    const [resultA, resultB] = await Promise.all([
      a.execute(openCommand(fixture, { idempotencyKey: "open:a" })),
      b.execute(openCommand(fixture, { idempotencyKey: "open:b" })),
    ]);
    const kinds = [resultA.kind, resultB.kind].sort();
    // either outcome is a legitimate resolution of the race (ALREADY_OPENED can only happen if
    // the idempotency constraint was hit instead of the incompatible-shift one; both are real
    // physical constraints on cash_shifts and which fires first is not deterministic)
    expect(kinds.includes("OPENED")).toBe(true);
    expect(["ALREADY_OPENED", "REJECTED"]).toContain(kinds.find((k) => k !== "OPENED"));
  });

  it("CLOSE: persists an exact close with no review, round-trips via findCloseByIdempotencyKey", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const openUseCase = new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const opened = await openUseCase.execute(openCommand(fixture, { openingAmount: "100000" }));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    const closeUseCase = new CloseCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const result = await closeUseCase.execute({
      scope: fixture.scope,
      actor: fixture.actor,
      cashShiftId: opened.shift.id,
      expectedVersion: 1,
      countedAmount: "100000",
      idempotencyKey: "close:1",
      originDeviceId: fixture.actor.id,
      currencyCode: "COP",
    } satisfies CloseCashShiftCommand);

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.review).toBeNull();
    expect(result.count.differenceType).toBe("EXACT");
    expect(result.shift.status).toBe("CLOSED");

    const reloaded = await repo.findCloseByIdempotencyKey(fixture.scope, "close:1");
    expect(reloaded?.id).toBe(result.count.id);
    expect(reloaded?.differenceAmount.toString()).toBe("0.000000");
  });

  it("CLOSE: a SHORTAGE difference creates a real review row, verified via the domain object", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const openUseCase = new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const opened = await openUseCase.execute(openCommand(fixture, { openingAmount: "100000" }));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    const closeUseCase = new CloseCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const result = await closeUseCase.execute({
      scope: fixture.scope,
      actor: fixture.actor,
      cashShiftId: opened.shift.id,
      expectedVersion: 1,
      countedAmount: "90000",
      idempotencyKey: "close:1",
      originDeviceId: fixture.actor.id,
      currencyCode: "COP",
    } satisfies CloseCashShiftCommand);

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") throw new Error("unreachable");
    expect(result.count.differenceType).toBe("SHORTAGE");
    expect(result.review).not.toBeNull();
    expect(result.review?.cashCountId).toBe(result.count.id);
  });

  it("CLOSE: real concurrency — two different close keys on the same shift race the version guard, exactly one wins", async () => {
    const fixture = await seedTenant();
    const repoOpen = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const opened = await new OpenCashShiftUseCase(repoOpen, new AlwaysAuthorized(), clock, idGen).execute(openCommand(fixture, { openingAmount: "100000" }));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    const repoA = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const repoB = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const a = new CloseCashShiftUseCase(repoA, new AlwaysAuthorized(), clock, idGen);
    const b = new CloseCashShiftUseCase(repoB, new AlwaysAuthorized(), clock, idGen);
    const baseCommand = {
      scope: fixture.scope, actor: fixture.actor, cashShiftId: opened.shift.id, expectedVersion: 1,
      countedAmount: "100000", originDeviceId: fixture.actor.id, currencyCode: "COP",
    };
    const [resultA, resultB] = await Promise.all([
      a.execute({ ...baseCommand, idempotencyKey: "close:a" }),
      b.execute({ ...baseCommand, idempotencyKey: "close:b" }),
    ]);
    const kinds = [resultA.kind, resultB.kind].sort();
    expect(kinds).toEqual(["CLOSED", "REJECTED"]);
    const rejected = resultA.kind === "REJECTED" ? resultA : resultB;
    if (rejected.kind !== "REJECTED") throw new Error("unreachable");
    expect(rejected.reason).toBe("VERSION_CONFLICT");
  });

  it("MOVEMENT: persists, advances shift version, and feeds ExpectedCash into a correct close", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const opened = await new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen).execute(openCommand(fixture, { openingAmount: "100000" }));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    const movementUseCase = new RegisterCashMovementUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const movementCommand: RegisterCashMovementCommand = {
      scope: fixture.scope, cashShiftId: opened.shift.id, actor: fixture.actor,
      movementType: "CASH_WITHDRAWAL", direction: "OUT", amount: "15000", expectedVersion: 1,
      idempotencyKey: "withdrawal:1", originDeviceId: fixture.actor.id, currencyCode: "COP", reasonCode: "BANK_DEPOSIT",
    };
    const registered = await movementUseCase.execute(movementCommand);
    expect(registered.kind).toBe("REGISTERED");
    if (registered.kind !== "REGISTERED") throw new Error("unreachable");
    expect(registered.shift.version).toBe(2);

    const posted = await repo.listPostedMovements(opened.shift.id);
    expect(posted).toHaveLength(2);

    const closeUseCase = new CloseCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const closed = await closeUseCase.execute({
      scope: fixture.scope, actor: fixture.actor, cashShiftId: opened.shift.id, expectedVersion: 2,
      countedAmount: "85000", idempotencyKey: "close:1", originDeviceId: fixture.actor.id, currencyCode: "COP",
    });
    expect(closed.kind).toBe("CLOSED");
    if (closed.kind !== "CLOSED") throw new Error("unreachable");
    expect(closed.count.expectedAmount.toString()).toBe("85000.000000");
    expect(closed.count.differenceType).toBe("EXACT");
  });

  it("MOVEMENT: replay (same key) returns ALREADY_REGISTERED with the same movement", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const opened = await new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen).execute(openCommand(fixture));
    if (opened.kind !== "OPENED") throw new Error("unreachable");
    const useCase = new RegisterCashMovementUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const command: RegisterCashMovementCommand = {
      scope: fixture.scope, cashShiftId: opened.shift.id, actor: fixture.actor,
      movementType: "CASH_WITHDRAWAL", direction: "OUT", amount: "5000", expectedVersion: 1,
      idempotencyKey: "withdrawal:1", originDeviceId: fixture.actor.id, currencyCode: "COP", reasonCode: "TEST",
    };
    const first = await useCase.execute(command);
    const second = await useCase.execute(command);
    expect(first.kind).toBe("REGISTERED");
    expect(second.kind).toBe("ALREADY_REGISTERED");
    if (first.kind !== "REGISTERED" || second.kind !== "ALREADY_REGISTERED") throw new Error("unreachable");
    expect(second.movement.id).toBe(first.movement.id);
  });

  it("MOVEMENT: real concurrency — two different movement keys on the same shift race the sequence/version guard", async () => {
    const fixture = await seedTenant();
    const repoOpen = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const opened = await new OpenCashShiftUseCase(repoOpen, new AlwaysAuthorized(), clock, idGen).execute(openCommand(fixture));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    const repoA = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const repoB = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const a = new RegisterCashMovementUseCase(repoA, new AlwaysAuthorized(), clock, idGen);
    const b = new RegisterCashMovementUseCase(repoB, new AlwaysAuthorized(), clock, idGen);
    const base = { scope: fixture.scope, cashShiftId: opened.shift.id, actor: fixture.actor, movementType: "CASH_WITHDRAWAL" as const, direction: "OUT" as const, amount: "1000", expectedVersion: 1, originDeviceId: fixture.actor.id, currencyCode: "COP", reasonCode: "TEST" };
    const [resultA, resultB] = await Promise.all([
      a.execute({ ...base, idempotencyKey: "withdrawal:a" }),
      b.execute({ ...base, idempotencyKey: "withdrawal:b" }),
    ]);
    const kinds = [resultA.kind, resultB.kind].sort();
    expect(kinds).toEqual(["REGISTERED", "REJECTED"]);
    const rejected = resultA.kind === "REJECTED" ? resultA : resultB;
    if (rejected.kind !== "REJECTED") throw new Error("unreachable");
    expect(rejected.reason).toBe("VERSION_CONFLICT");

    const movements = await repoOpen.listPostedMovements(opened.shift.id);
    expect(movements.filter((m) => m.movementType === "CASH_WITHDRAWAL")).toHaveLength(1);
  });

  it("ROLLBACK: a failing saveClose leaves no partial cash_counts/cash_shifts write behind", async () => {
    const fixture = await seedTenant();
    const repo = new PostgresCashShiftRepository(database, fixture.scope.tenantId);
    const idGen = new SequentialIdGenerator();
    const opened = await new OpenCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen).execute(openCommand(fixture));
    if (opened.kind !== "OPENED") throw new Error("unreachable");

    // force a version conflict deliberately by closing with a stale expectedVersion after a real
    // movement has already advanced the shift — saveClose's UPDATE affects 0 rows, and the whole
    // transaction (including the cash_counts INSERT that would otherwise follow) rolls back.
    await new RegisterCashMovementUseCase(repo, new AlwaysAuthorized(), clock, idGen).execute({
      scope: fixture.scope, cashShiftId: opened.shift.id, actor: fixture.actor,
      movementType: "CASH_WITHDRAWAL", direction: "OUT", amount: "1000", expectedVersion: 1,
      idempotencyKey: "withdrawal:1", originDeviceId: fixture.actor.id, currencyCode: "COP", reasonCode: "TEST",
    });

    const closeUseCase = new CloseCashShiftUseCase(repo, new AlwaysAuthorized(), clock, idGen);
    const result = await closeUseCase.execute({
      scope: fixture.scope, actor: fixture.actor, cashShiftId: opened.shift.id, expectedVersion: 1, // stale on purpose
      countedAmount: "100000", idempotencyKey: "close:rollback", originDeviceId: fixture.actor.id, currencyCode: "COP",
    });
    expect(result.kind).toBe("REJECTED");

    const countAfter = await repo.findCloseByIdempotencyKey(fixture.scope, "close:rollback");
    expect(countAfter).toBeNull();
    const stillOpen = await repo.findById(fixture.scope, opened.shift.id);
    expect(stillOpen?.status).toBe("OPEN");
  });
});
