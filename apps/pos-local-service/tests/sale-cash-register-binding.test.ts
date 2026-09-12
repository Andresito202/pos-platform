import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

/**
 * La caja selecciona el turno de la venta — `DEC-012` §25.2.
 *
 * ## Por qué este fichero existe
 *
 * `CreateSaleUseCase` escribía `cash_register_id` y `cash_shift_id` **siempre
 * `NULL`**, y `SqlitePaymentStore` rechaza con `CASH_SHIFT_MISSING` cuando el
 * turno es nulo: una venta creada por el camino canónico **no se podía cobrar
 * en efectivo**. El defecto sobrevivió porque **ninguna prueba encadenaba las
 * dos mitades**: los pagos se probaban sobre ventas sembradas a mano con turno,
 * y las ventas nunca se cobraban.
 *
 * Aquí **no se siembra ninguna venta**: se abre el turno, se registra el
 * producto, se crea la venta y se cobra, cada paso con su caso de uso real.
 *
 * ## Y por qué el selector es la caja
 *
 * `DEC-012` §25.2 fija como máximo un `CashShift` `OPEN`/`CLOSING` por
 * `(tenant, sucursal, caja)`. Nombrar la caja determina el turno sin
 * ambigüedad. §25.3 **niega** que `origin_device_id` exprese propiedad sobre la
 * caja, y dos terminales pueden trabajar la misma caja legítimamente: un
 * selector por dispositivo le rompería el cobro al segundo.
 */

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE_A = "018f0000-0000-7000-8000-000000000004";
const DEVICE_B = "018f0000-0000-7000-8000-0000000000b4";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CAJA_1 = "018f0000-0000-7000-8000-00000000aa01";
const CAJA_2 = "018f0000-0000-7000-8000-00000000aa02";
const CAJA_SIN_TURNO = "018f0000-0000-7000-8000-00000000aa03";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE_A, installationId: INSTALL,
};
/** Mismo tenant, misma sucursal, **otro terminal**. */
const SCOPE_B: SyncScope = { ...SCOPE, deviceId: DEVICE_B };

const NOW = new Date("2026-09-06T10:00:00.000Z");
const BUSINESS_DATE = "2026-09-06";
const PERMISSIONS = [
  "CASH_SHIFT_OPEN", "CATALOG_PRODUCT_REGISTER",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE_A,
    sequence: 1, issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: PERMISSIONS.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

/** Proyección maestra y tres cajas activas. Es lo único sembrado, y no es una venta. */
function seedRegisters(db: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at);

  for (const [id, code] of [[CAJA_1, "CAJA-01"], [CAJA_2, "CAJA-02"], [CAJA_SIN_TURNO, "CAJA-03"]] as const) {
    db.native.prepare(
      `INSERT OR IGNORE INTO cash_register(
        id, tenant_id, company_id, branch_id, code, code_normalized, name,
        currency_code, status, created_at, retired_at, version, last_seen_sequence
      ) VALUES (?,?,?,?,?,?,?,'COP','ACTIVE',?,NULL,1,1)`,
    ).run(id, TENANT, COMPANY, BRANCH, code, code.toLowerCase(), code, at);
  }
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-register-binding-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  seedRegisters(database);

  const at = (): Date => NOW;
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, at);
  const inventoryStore = new SqliteInventoryStore(database, sync, at);
  const cashStore = new SqliteCashShiftStore(database, sync, at);
  const masterStore = new SqliteMasterSnapshotStore(database, at);
  const saleStore = new SqliteSaleStore(database, sync, at);
  const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, at);

  return {
    database, cashStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, at),
    registerProduct: new RegisterProductUseCase(catalogStore),
    createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashStore, saleStore, at),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, at),
  };
}
type Env = Awaited<ReturnType<typeof buildEnv>>;

function openShift(env: Env, cashRegisterId: string, key: string, scope: SyncScope = SCOPE): string {
  const result = env.openShift.execute(scope, SESSION, auth(), {
    cashRegisterId, openingAmount: "0.000000",
    businessDate: BUSINESS_DATE, timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

let productSeed = 0;
function registerProduct(env: Env): { productId: string; presentationId: string } {
  productSeed += 1;
  const result = env.registerProduct.execute(SCOPE, SESSION, auth(), {
    code: `PAN-${String(productSeed).padStart(3, "0")}`, name: "Pan tajado",
    stockControlled: false,
    presentationName: "Bolsa", unitCode: "UND", unitPrecision: 0,
    barcode: `770111111${String(productSeed).padStart(4, "0")}`,
    priceAmount: "5000.000000", currencyCode: "COP",
    idempotencyKey: `catalog:binding:${String(productSeed)}`,
    correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "REGISTERED") throw new Error(`expected REGISTERED, got ${result.kind}`);
  return { productId: result.productId, presentationId: result.presentationId };
}

let saleSeed = 0;
function createSale(
  env: Env,
  item: { productId: string; presentationId: string },
  cashRegisterId: string | null,
  scope: SyncScope = SCOPE,
) {
  saleSeed += 1;
  return env.createSale.execute(scope, SESSION, auth(), {
    cashRegisterId,
    idempotencyKey: `sale:binding:${String(saleSeed)}`,
    channel: "POS_LOCAL",
    businessDate: BUSINESS_DATE,
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    documentSeries: "FS-001",
    currencyCode: "COP",
    correlationId: randomUUID(),
    causationId: null,
    lines: [{ productId: item.productId, presentationId: item.presentationId, quantity: "1.000000" }],
  });
}

function saleRow(db: LocalDatabase, saleId: string): {
  status: string; cash_shift_id: string | null; cash_register_id: string | null;
} {
  return db.native.prepare(
    "SELECT status, cash_shift_id, cash_register_id FROM sales_sales WHERE tenant_id=? AND id=?",
  ).get(TENANT, saleId) as { status: string; cash_shift_id: string | null; cash_register_id: string | null };
}

describe("la caja selecciona el turno de la venta", () => {
  // TEST 1 · 2 · 3
  it("la caja indicada resuelve su turno y queda persistida en la venta", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA_1, "shift:1");
    const created = createSale(env, registerProduct(env), CAJA_1);

    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    const row = saleRow(env.database, created.saleId);
    expect(row.cash_register_id).toBe(CAJA_1);
    expect(row.cash_shift_id).toBe(shiftId);
  });

  // TEST 3 (vertical completa) — la venta llega a COMPLETED
  it("la venta así creada se cobra en efectivo y queda COMPLETED", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA_1, "shift:1");
    const created = createSale(env, registerProduct(env), CAJA_1);
    if (created.kind !== "CREATED") throw new Error(created.kind);

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:binding:1", correlationId: randomUUID(), causationId: null,
    });

    expect(paid.kind).toBe("CONFIRMED");
    if (paid.kind !== "CONFIRMED") return;
    expect(paid.saleCompleted).toBe(true);
    expect(saleRow(env.database, created.saleId).status).toBe("COMPLETED");

    const movement = env.database.native.prepare(
      "SELECT cash_shift_id, direction FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_SALE'",
    ).get(TENANT) as { cash_shift_id: string; direction: string };
    expect(movement.cash_shift_id).toBe(shiftId);
    expect(movement.direction).toBe("IN");
  });

  // TEST 4 · 8 — el dispositivo no interviene (DEC-012 §25.3)
  it("dos terminales distintos venden sobre la misma caja y obtienen el mismo turno", async () => {
    const env = await buildEnv();
    // El turno lo abre el terminal A.
    const shiftId = openShift(env, CAJA_1, "shift:1", SCOPE);
    const item = registerProduct(env);

    const fromA = createSale(env, item, CAJA_1, SCOPE);
    const fromB = createSale(env, item, CAJA_1, SCOPE_B);

    if (fromA.kind !== "CREATED" || fromB.kind !== "CREATED") throw new Error("expected CREATED");
    // El terminal B **no** abrió turno alguno: si el dispositivo participara en
    // la selección, su venta quedaría sin caja.
    expect(saleRow(env.database, fromA.saleId).cash_shift_id).toBe(shiftId);
    expect(saleRow(env.database, fromB.saleId).cash_shift_id).toBe(shiftId);
  });

  // TEST 5 — varias cajas en la sucursal, ninguna confusión
  it("con dos cajas abiertas cada venta va exactamente a la suya", async () => {
    const env = await buildEnv();
    const shift1 = openShift(env, CAJA_1, "shift:1");
    const shift2 = openShift(env, CAJA_2, "shift:2");
    expect(shift1).not.toBe(shift2);

    const item = registerProduct(env);
    const en1 = createSale(env, item, CAJA_1);
    const en2 = createSale(env, item, CAJA_2);

    if (en1.kind !== "CREATED" || en2.kind !== "CREATED") throw new Error("expected CREATED");
    expect(saleRow(env.database, en1.saleId).cash_shift_id).toBe(shift1);
    expect(saleRow(env.database, en2.saleId).cash_shift_id).toBe(shift2);
  });

  // TEST 6 — caja sin turno: el error existente, no uno nuevo
  it("una caja sin turno deja la venta sin vínculo y el efectivo la rechaza", async () => {
    const env = await buildEnv();
    openShift(env, CAJA_1, "shift:1"); // hay turno, pero en OTRA caja
    const created = createSale(env, registerProduct(env), CAJA_SIN_TURNO);

    if (created.kind !== "CREATED") throw new Error(created.kind);
    const row = saleRow(env.database, created.saleId);
    expect(row.cash_shift_id).toBeNull();
    expect(row.cash_register_id).toBeNull();

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:binding:2", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CASH_SHIFT_MISSING");
  });

  // TEST 7 — venta sin ámbito de caja
  it("sin caja indicada la venta es válida y conserva el par en NULL", async () => {
    const env = await buildEnv();
    openShift(env, CAJA_1, "shift:1");
    const created = createSale(env, registerProduct(env), null);

    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    const row = saleRow(env.database, created.saleId);
    expect(row.cash_shift_id).toBeNull();
    expect(row.cash_register_id).toBeNull();
  });

  /**
   * Un turno en `CLOSING` **se vincula** a propósito: existe, y el pago lo
   * rechaza con `CASH_SHIFT_NOT_OPEN` (`DEC-016` §10.3). No vincularlo diría
   * «no hay turno», que sería falso mientras se está cuadrando.
   */
  it("un turno en CLOSING se vincula y el pago lo rechaza por estado, no por ausencia", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA_1, "shift:1");
    env.database.native.prepare(
      "UPDATE cash_shift SET status='CLOSING' WHERE tenant_id=? AND id=?",
    ).run(TENANT, shiftId);

    const created = createSale(env, registerProduct(env), CAJA_1);
    if (created.kind !== "CREATED") throw new Error(created.kind);
    expect(saleRow(env.database, created.saleId).cash_shift_id).toBe(shiftId);

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:binding:3", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CASH_SHIFT_NOT_OPEN");
  });

  /**
   * TEST 9 — el índice único parcial impide dos turnos activos por caja, así que
   * dos filas sólo pueden venir de corrupción. Elegir una imputaría el efectivo
   * a un arqueo ajeno sin que nadie lo notara: se falla de forma explícita.
   */
  it("si la unicidad se rompe no elige ninguno: falla explícitamente", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA_1, "shift:1");

    // Se corrompe el dato saltándose el índice: se duplica la fila con otro id.
    const row = env.database.native.prepare(
      "SELECT * FROM cash_shift WHERE tenant_id=? AND id=?",
    ).get(TENANT, shiftId) as Record<string, unknown>;
    env.database.native.prepare("DROP INDEX cash_shift_active_idx").run();
    const columns = Object.keys(row);
    env.database.native.prepare(
      `INSERT INTO cash_shift(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    ).run(...columns.map((c) => {
      // También hay unicidad por `(tenant, dispositivo, clave de apertura)`: la
      // corrupción que se simula es la del turno activo, no la de idempotencia.
      if (c === "id") return "018f0000-0000-7000-8000-0000000000cc";
      if (c === "opening_idempotency_key") return "corrupted-duplicate";
      return row[c];
    }));

    expect(() => env.cashStore.findActiveShiftForRegister(SCOPE, CAJA_1))
      .toThrow(/uniqueness violated/i);
  });

  // TEST 8 — no queda ningún camino que consulte por dispositivo
  it("no existe resolución de turno por dispositivo", async () => {
    const env = await buildEnv();
    // El terminal A abre turno en CAJA_1; nadie abre en CAJA_SIN_TURNO.
    openShift(env, CAJA_1, "shift:1", SCOPE);
    // Preguntar por una caja sin turno devuelve null aunque el mismo dispositivo
    // tenga turno abierto en otra caja: la caja manda, no el terminal.
    expect(env.cashStore.findActiveShiftForRegister(SCOPE, CAJA_SIN_TURNO)).toBeNull();
  });
});
