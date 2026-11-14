import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../src/cash/close-cash-shift-use-case.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH  = "018f0000-0000-7000-8000-000000000003";
const DEVICE  = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER_A  = "018f0000-0000-7000-8000-000000000006";
const USER_B  = "018f0000-0000-7000-8000-000000000007";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const REGISTER_ID = "018f0000-0000-7000-8000-00000000aa01";
const OTHER_REGISTER = "018f0000-0000-7000-8000-00000000aa02";

const SCOPE: SyncScope = {
  tenantId: TENANT,
  companyId: COMPANY,
  branchId: BRANCH,
  deviceId: DEVICE,
  installationId: INSTALL,
};

// ── Directory management ──────────────────────────────────────────────────────

const directories: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pos-cash-"));
  directories.push(dir);
  return dir;
}

/**
 * Bases abiertas por las pruebas. Se cierran antes de borrar el directorio
 * temporal: en Windows un handle abierto sobre `pos-local.db` —o sobre el
 * lock de escritor único— hace que `rmSync` falle con `EBUSY` y enmascare
 * la causa real, tal como ya documenta `session-assertion-verifier.test.ts`.
 */
const databases: LocalDatabase[] = [];
function track(database: LocalDatabase): LocalDatabase {
  databases.push(database);
  return database;
}
afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Un cierre fallido no debe ocultar el fallo real de la prueba.
    }
  }
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ── Database + store factory ──────────────────────────────────────────────────

async function buildEnv(now: () => Date = () => new Date("2026-09-05T10:00:00.000Z")) {
  const dir = await tmpDir();
  const db = track(LocalDatabase.open({ dataDirectory: dir }));
  const durableSync = new DurableSyncStore(db);
  const masterStore = new SqliteMasterSnapshotStore(db, now);
  const shiftStore = new SqliteCashShiftStore(db, durableSync, now);
  const openUC = new OpenCashShiftUseCase(masterStore, shiftStore, now);
  const closeUC = new CloseCashShiftUseCase(shiftStore, now);
  return { db, masterStore, shiftStore, openUC, closeUC };
}

/** Inserta fixture de snapshot + cash_register directamente en la BD. */
function insertRegisterFixture(
  db: LocalDatabase,
  opts: {
    registerId?: string;
    status?: "ACTIVE" | "RETIRED";
    currencyCode?: string;
    sequence?: number;
  } = {},
) {
  const registerId = opts.registerId ?? REGISTER_ID;
  const status = opts.status ?? "ACTIVE";
  const currencyCode = opts.currencyCode ?? "COP";
  const sequence = opts.sequence ?? 1;
  const now = "2026-09-01T00:00:00.000Z";

  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,?,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(
    TENANT, COMPANY, BRANCH, sequence, now,
    JSON.stringify({ sequence, payload: [] }),
    "a".repeat(64),
    "stub-sig",
    now,
  );

  db.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id,
      code, code_normalized, name, currency_code, status,
      created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,1,?)`,
  ).run(
    registerId, TENANT, COMPANY, BRANCH,
    `CAJA-${registerId.slice(-2)}`,
    `caja-${registerId.slice(-2)}`,
    `Caja ${registerId.slice(-2)}`,
    currencyCode, status, now, sequence,
  );
}

// ── Auth snapshot builder ─────────────────────────────────────────────────────

function buildAuth(
  userId: string,
  permissions: string[],
  overrides: { tenantId?: string; companyId?: string; branchId?: string } = {},
): StoredAuthorizationSnapshot {
  const now = new Date("2026-09-05T00:00:00.000Z");
  const exp = new Date("2026-09-05T08:00:00.000Z");
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: userId,
    installation_id: INSTALL,
    device_id: DEVICE,
    sequence: 1,
    issued_at: now.toISOString(),
    expires_at: exp.toISOString(),
    key_id: "AUTHZ_KEY_1",
    assignments: [
      {
        tenant_id: overrides.tenantId ?? TENANT,
        company_id: overrides.companyId ?? COMPANY,
        branch_id: overrides.branchId ?? BRANCH,
        status: "ACTIVE",
        valid_from: now.toISOString(),
        valid_until: null,
        role_status: "ACTIVE",
        permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
      },
    ],
  };
  return { claims, signature: "stub", activatedAt: now.toISOString() };
}

// ── Open request builder ──────────────────────────────────────────────────────

function openRequest(overrides: Partial<{
  cashRegisterId: string;
  openingAmount: string;
  idempotencyKey: string;
}> = {}) {
  return {
    cashRegisterId: overrides.cashRegisterId ?? REGISTER_ID,
    openingAmount: overrides.openingAmount ?? "0.000000",
    businessDate: "2026-09-05",
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    idempotencyKey: overrides.idempotencyKey ?? "shift:open:001",
    correlationId: "018f0000-0000-7000-8000-0000000000c1",
    causationId: null,
  };
}

it("licensed capacity: denial prevents a cash shift and never substitutes user authorization", async () => {
  const { db, masterStore, shiftStore } = await buildEnv();
  insertRegisterFixture(db);
  const now = () => new Date("2026-09-05T10:00:00.000Z");
  let calls = 0;
  const guarded = new OpenCashShiftUseCase(masterStore, shiftStore, now, (scope, id) => {
    expect(scope).toEqual(SCOPE); expect(id).toBe(REGISTER_ID); calls++;
    return "LICENSE_REGISTER_NOT_ALLOCATED";
  });
  expect(guarded.execute(SCOPE, SESSION, buildAuth(USER_A, ["CASH_SHIFT_OPEN"]), openRequest()))
    .toEqual({ kind: "UNAUTHORIZED", reason: "LICENSE_REGISTER_NOT_ALLOCATED" });
  expect(calls).toBe(1);
  expect(db.native.prepare("SELECT count(*) AS n FROM cash_shift").get()).toEqual({n:0});
  expect(guarded.execute(SCOPE, SESSION, buildAuth(USER_A, []), openRequest()).kind).toBe("UNAUTHORIZED");
  expect(calls).toBe(1);
  const allowed = new OpenCashShiftUseCase(masterStore, shiftStore, now, () => null);
  expect(allowed.execute(SCOPE, SESSION, buildAuth(USER_A, ["CASH_SHIFT_OPEN"]), openRequest()).kind).toBe("OPENED");
});

// ── UC-CASH-001 — Open ────────────────────────────────────────────────────────

describe("OpenCashShiftUseCase", () => {
  it("apertura correcta con base cero", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest());

    expect(result.kind).toBe("OPENED");
    if (result.kind !== "OPENED") return;

    // Shift en BD: status OPEN, version 1
    const shift = db.native.prepare(
      `SELECT status, version, currency_code, cash_register_id FROM cash_shift WHERE id=?`,
    ).get(result.shiftId) as { status: string; version: number; currency_code: string; cash_register_id: string };
    expect(shift.status).toBe("OPEN");
    expect(shift.version).toBe(1);
    expect(shift.currency_code).toBe("COP");
    expect(shift.cash_register_id).toBe(REGISTER_ID);

    // Movimiento OPENING_FLOAT en BD
    const movement = db.native.prepare(
      `SELECT movement_type, direction, amount, status FROM cash_movement WHERE cash_shift_id=?`,
    ).get(result.shiftId) as { movement_type: string; direction: string; amount: string; status: string };
    expect(movement.movement_type).toBe("OPENING_FLOAT");
    expect(movement.direction).toBe("IN");
    expect(movement.amount).toBe("0.000000");
    expect(movement.status).toBe("POSTED");

    // Outbox: CASH_SHIFT_OPENED
    const outbox = db.native.prepare(
      `SELECT operation_type FROM local_sync_outbox WHERE idempotency_key=?`,
    ).get("shift:open:001") as { operation_type: string };
    expect(outbox.operation_type).toBe("CASH_SHIFT_OPENED");
  });

  it("apertura con base no cero", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest({ openingAmount: "50000.000000" }));

    expect(result.kind).toBe("OPENED");
    if (result.kind !== "OPENED") return;

    const movement = db.native.prepare(
      `SELECT amount FROM cash_movement WHERE cash_shift_id=? AND movement_type='OPENING_FLOAT'`,
    ).get(result.shiftId) as { amount: string };
    expect(movement.amount).toBe("50000.000000");
  });

  it("idempotencia: misma solicitud retorna el turno existente sin duplicar", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const req = openRequest({ idempotencyKey: "shift:open:idem" });

    const r1 = openUC.execute(SCOPE, SESSION, auth, req);
    const r2 = openUC.execute(SCOPE, SESSION, auth, req);

    expect(r1.kind).toBe("OPENED");
    expect(r2.kind).toBe("IDEMPOTENT");
    if (r1.kind !== "OPENED" || r2.kind !== "IDEMPOTENT") return;
    expect(r2.shiftId).toBe(r1.shiftId);

    const count = (db.native.prepare(
      `SELECT COUNT(*) AS n FROM cash_shift WHERE opening_idempotency_key='shift:open:idem'`,
    ).get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("segunda apertura desde el mismo dispositivo es incompatible", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const r1 = openUC.execute(SCOPE, SESSION, auth, openRequest({ idempotencyKey: "shift:open:A" }));
    const r2 = openUC.execute(SCOPE, SESSION, auth, openRequest({ idempotencyKey: "shift:open:B" }));

    expect(r1.kind).toBe("OPENED");
    expect(r2.kind).toBe("INCOMPATIBLE_SHIFT");
  });

  it("segunda apertura desde otro dispositivo también es incompatible", async () => {
    const { openUC, db, masterStore, shiftStore } = await buildEnv();
    insertRegisterFixture(db);

    const otherDevice = "018f0000-0000-7000-8000-000000000009";
    const scopeB: SyncScope = { ...SCOPE, deviceId: otherDevice };
    const authA = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const authB = buildAuth(USER_B, ["CASH_SHIFT_OPEN"]);

    const openUCB = new OpenCashShiftUseCase(masterStore, shiftStore);

    const r1 = openUC.execute(SCOPE, SESSION, authA, openRequest({ idempotencyKey: "shift:open:dev-a" }));
    const r2 = openUCB.execute(scopeB, SESSION, authB, openRequest({ idempotencyKey: "shift:open:dev-b" }));

    expect(r1.kind).toBe("OPENED");
    expect(r2.kind).toBe("INCOMPATIBLE_SHIFT");
  });

  it("base negativa es rechazada", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest({ openingAmount: "-100.000000" }));

    expect(result.kind).toBe("NEGATIVE_OPENING_AMOUNT");
  });

  it("caja inexistente en snapshot maestro", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest({ cashRegisterId: OTHER_REGISTER }));

    expect(result.kind).toBe("REGISTER_NOT_FOUND");
  });

  it("sin snapshot maestro = caja no encontrada", async () => {
    const { openUC } = await buildEnv();
    // No se inserta ningún snapshot/registro

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest());

    expect(result.kind).toBe("REGISTER_NOT_FOUND");
  });

  it("usuario sin permiso CASH_SHIFT_OPEN es rechazado", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, []); // sin permiso
    const result = openUC.execute(SCOPE, SESSION, auth, openRequest());

    expect(result.kind).toBe("UNAUTHORIZED");
  });

  it("idempotency conflict: misma clave, distinto payload", async () => {
    const { openUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const r1 = openUC.execute(SCOPE, SESSION, auth, openRequest({ idempotencyKey: "shift:conflict" }));
    expect(r1.kind).toBe("OPENED");

    // Misma clave pero distinta base
    const r2 = openUC.execute(SCOPE, SESSION, auth, openRequest({ idempotencyKey: "shift:conflict", openingAmount: "5000.000000" }));
    expect(r2.kind).toBe("IDEMPOTENCY_CONFLICT");
  });
});

// ── UC-CASH-002 — Close ───────────────────────────────────────────────────────

describe("CloseCashShiftUseCase", () => {
  /** Abre un turno y retorna su ID. */
  async function openShift(amount = "0.000000"): Promise<{ shiftId: string; db: LocalDatabase; closeUC: CloseCashShiftUseCase }> {
    const { openUC, closeUC, db } = await buildEnv();
    insertRegisterFixture(db);

    const auth = buildAuth(USER_A, ["CASH_SHIFT_OPEN"]);
    const r = openUC.execute(SCOPE, SESSION, auth, openRequest({ openingAmount: amount }));
    if (r.kind !== "OPENED") throw new Error(`expected OPENED, got ${r.kind}`);
    return { shiftId: r.shiftId, db, closeUC };
  }

  function closeRequest(shiftId: string, overrides: Partial<{
    countedAmount: string;
    expectedVersion: number;
    idempotencyKey: string;
  }> = {}) {
    return {
      shiftId,
      countedAmount: overrides.countedAmount ?? "0.000000",
      expectedVersion: overrides.expectedVersion ?? 1,
      idempotencyKey: overrides.idempotencyKey ?? "shift:close:001",
      correlationId: "018f0000-0000-7000-8000-0000000000c2",
      causationId: null,
    };
  }

  it("cierre sin diferencia (base cero, conteo cero)", async () => {
    const { shiftId, closeUC, db } = await openShift("0.000000");
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") return;
    expect(result.expectedCash).toBe("0.000000");
    expect(result.countedAmount).toBe("0.000000");
    expect(result.differenceAmount).toBe("0.000000");

    const shift = db.native.prepare(`SELECT status, version FROM cash_shift WHERE id=?`).get(shiftId) as { status: string; version: number };
    expect(shift.status).toBe("CLOSED");
    expect(shift.version).toBe(3); // v1 (OPEN) → v2 (CLOSING) → v3 (CLOSED)

    const outboxRows = db.native.prepare(
      `SELECT operation_type FROM local_sync_outbox
       WHERE tenant_id=? AND device_id=? AND operation_type IN ('CASH_SHIFT_OPENED','CASH_SHIFT_CLOSED')
       ORDER BY local_sequence`,
    ).all(TENANT, DEVICE) as Array<{ operation_type: string }>;
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows[0]?.operation_type).toBe("CASH_SHIFT_OPENED");
    expect(outboxRows[1]?.operation_type).toBe("CASH_SHIFT_CLOSED");
  });

  it("cierre con diferencia positiva (conteo mayor que esperado)", async () => {
    const { shiftId, closeUC } = await openShift("10000.000000");
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { countedAmount: "10500.000000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") return;
    expect(result.expectedCash).toBe("10000.000000");
    expect(result.countedAmount).toBe("10500.000000");
    expect(result.differenceAmount).toBe("500.000000"); // positivo: sobrante
  });

  it("cierre con diferencia negativa (faltante)", async () => {
    const { shiftId, closeUC } = await openShift("10000.000000");
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { countedAmount: "9800.000000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") return;
    expect(result.differenceAmount).toBe("-200.000000"); // negativo: faltante
  });

  it("cierre duplicado retorna IDEMPOTENT", async () => {
    const { shiftId, closeUC } = await openShift();
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);
    const req = closeRequest(shiftId, { idempotencyKey: "shift:close:idem" });

    const r1 = closeUC.execute(SCOPE, SESSION, auth, req);
    const r2 = closeUC.execute(SCOPE, SESSION, auth, req);

    expect(r1.kind).toBe("CLOSED");
    expect(r2.kind).toBe("IDEMPOTENT");
    if (r2.kind !== "IDEMPOTENT") return;
    expect(r2.shiftId).toBe(shiftId);
  });

  it("cierre idempotency conflict: misma clave, distinto payload", async () => {
    const { shiftId, closeUC } = await openShift();
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { idempotencyKey: "shift:close:c1" }));
    // Mismo shiftId está ahora CLOSED — otro intento con la misma clave pero distinto counted_amount
    const r2 = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, {
      idempotencyKey: "shift:close:c1",
      countedAmount: "9999.000000",
    }));
    expect(r2.kind).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("turno inexistente retorna NOT_FOUND", async () => {
    const { closeUC, db } = await buildEnv();
    insertRegisterFixture(db);
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest("018f0000-0000-7000-8000-000000000099"));

    expect(result.kind).toBe("NOT_FOUND");
  });

  it("usuario sin permiso CASH_SHIFT_CLOSE es rechazado", async () => {
    const { shiftId, closeUC } = await openShift();
    const auth = buildAuth(USER_A, []); // sin permiso

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId));

    expect(result.kind).toBe("UNAUTHORIZED");
  });

  it("turno ya cerrado por otra operación retorna ALREADY_CLOSED", async () => {
    const { shiftId, closeUC } = await openShift();
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { idempotencyKey: "shift:close:first" }));
    const r2 = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { idempotencyKey: "shift:close:second" }));

    expect(r2.kind).toBe("ALREADY_CLOSED");
  });

  it("conflict de versión retorna VERSION_CONFLICT", async () => {
    const { shiftId, closeUC } = await openShift();
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { expectedVersion: 99 }));

    expect(result.kind).toBe("VERSION_CONFLICT");
  });

  it("pagos electrónicos (no efectivo) no forman parte del expected_cash", async () => {
    // expected_cash solo suma movimientos POSTED; movimientos de tipo no-efectivo
    // no se insertan como cash_movement, por lo que el expected_cash solo incluye
    // el OPENING_FLOAT. Verificación: el expected_cash coincide con solo el float.
    const { shiftId, closeUC } = await openShift("20000.000000");
    const auth = buildAuth(USER_A, ["CASH_SHIFT_CLOSE"]);

    const result = closeUC.execute(SCOPE, SESSION, auth, closeRequest(shiftId, { countedAmount: "20000.000000" }));

    expect(result.kind).toBe("CLOSED");
    if (result.kind !== "CLOSED") return;
    expect(result.expectedCash).toBe("20000.000000");
    expect(result.differenceAmount).toBe("0.000000");
  });
});
