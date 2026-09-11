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
 * Vertical de venta a cobro, **sin fixtures entre las dos mitades**.
 *
 * ## Por qué este fichero existe
 *
 * `CreateSaleUseCase` escribía `cash_register_id` y `cash_shift_id` **siempre**
 * `NULL`, y `SqlitePaymentStore` rechaza con `CASH_SHIFT_MISSING` cuando el
 * turno es nulo. Es decir: **una venta creada por el camino canónico no se podía
 * cobrar en efectivo**, con el turno abierto o sin él.
 *
 * El defecto sobrevivió a 1021 pruebas porque **ninguna encadenaba las dos
 * mitades**: `payment.test.ts` siembra la venta con `seedSale(…, { shiftId })`,
 * que escribe el turno a mano, y `sale.test.ts` nunca cobra. Cada mitad se
 * probaba contra un fixture que la otra no producía, y el hueco quedaba
 * exactamente en la juntura.
 *
 * Por eso esta prueba **no siembra ninguna venta**: abre el turno con su caso de
 * uso, registra el producto con el suyo, crea la venta con el suyo y la cobra
 * con el suyo. Si alguna de las cuatro piezas deja de encajar con la siguiente,
 * falla aquí.
 */

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const OTHER_REGISTER = "018f0000-0000-7000-8000-00000000aa02";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const BUSINESS_DATE = "2026-09-06";

const PERMISSIONS = [
  "CASH_SHIFT_OPEN",
  "CATALOG_PRODUCT_REGISTER",
  "SALES_SALE_CREATE",
  "PAYMENTS_PAYMENT_REGISTER",
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
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
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

/** Proyección maestra y cajas activas. Es lo único que se siembra, y no es una venta. */
function seedRegisters(db: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at);

  for (const [id, code] of [[REGISTER, "CAJA-01"], [OTHER_REGISTER, "CAJA-02"]] as const) {
    db.native.prepare(
      `INSERT OR IGNORE INTO cash_register(
        id, tenant_id, company_id, branch_id, code, code_normalized, name,
        currency_code, status, created_at, retired_at, version, last_seen_sequence
      ) VALUES (?,?,?,?,?,?,?,'COP','ACTIVE',?,NULL,1,1)`,
    ).run(id, TENANT, COMPANY, BRANCH, code, code.toLowerCase(), code, at);
  }
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-vertical-"));
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
    database,
    cashStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, at),
    registerProduct: new RegisterProductUseCase(catalogStore),
    createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashStore, saleStore, at),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, at),
  };
}

type Env = Awaited<ReturnType<typeof buildEnv>>;

function openShift(env: Env, cashRegisterId = REGISTER, key = "shift:vertical:1"): string {
  const result = env.openShift.execute(SCOPE, SESSION, auth(), {
    cashRegisterId, openingAmount: "0.000000",
    businessDate: BUSINESS_DATE, timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

/** Registra un artículo vendible por su caso de uso y devuelve sus identificadores. */
function registerProduct(env: Env): { productId: string; presentationId: string } {
  const result = env.registerProduct.execute(SCOPE, SESSION, auth(), {
    code: "PAN-001", name: "Pan tajado",
    stockControlled: false,
    presentationName: "Bolsa", unitCode: "UND", unitPrecision: 0,
    barcode: "7701111111111",
    priceAmount: "5000.000000", currencyCode: "COP",
    idempotencyKey: "catalog:vertical:1", correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "REGISTERED") throw new Error(`expected REGISTERED, got ${result.kind}`);
  return { productId: result.productId, presentationId: result.presentationId };
}

function createSale(env: Env, item: { productId: string; presentationId: string }, key = "sale:vertical:1") {
  return env.createSale.execute(SCOPE, SESSION, auth(), {
    idempotencyKey: key,
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

describe("de la venta al cobro, sin fixtures intermedios", () => {
  it("una venta creada con el turno abierto se cobra en efectivo y queda COMPLETED", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env);
    const item = registerProduct(env);

    const created = createSale(env, item);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    // El vínculo con la caja es lo que faltaba: sin él, el cobro de abajo
    // rechazaba con CASH_SHIFT_MISSING.
    const beforePayment = saleRow(env.database, created.saleId);
    expect(beforePayment.cash_shift_id).toBe(shiftId);
    expect(beforePayment.cash_register_id).toBe(REGISTER);
    expect(beforePayment.status).toBe("READY_FOR_PAYMENT");

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId,
      amount: created.payableAmount,
      tenderedAmount: null,
      idempotencyKey: "pay:vertical:1",
      correlationId: randomUUID(),
      causationId: null,
    });

    expect(paid.kind).toBe("CONFIRMED");
    if (paid.kind !== "CONFIRMED") return;
    expect(paid.saleCompleted).toBe(true);

    expect(saleRow(env.database, created.saleId).status).toBe("COMPLETED");

    // El asiento de caja existe y cuelga del turno que abrió este dispositivo.
    const movement = env.database.native.prepare(
      `SELECT cash_shift_id, direction, amount FROM cash_movement
       WHERE tenant_id=? AND movement_type='CASH_SALE'`,
    ).get(TENANT) as { cash_shift_id: string; direction: string; amount: string };
    expect(movement.cash_shift_id).toBe(shiftId);
    expect(movement.direction).toBe("IN");
    expect(movement.amount).toBe(created.payableAmount);
  });

  /**
   * El esquema admite la venta sin caja —`CHECK((cash_register_id IS NULL) =
   * (cash_shift_id IS NULL))` sólo exige que viajen juntos—, y hay canales que
   * no pasan por caja. Lo que no puede ocurrir es que **haya** turno y la venta
   * no lo lleve.
   */
  it("sin turno abierto la venta se crea sin caja, y el efectivo la rechaza visiblemente", async () => {
    const env = await buildEnv();
    const item = registerProduct(env);

    const created = createSale(env, item);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    const row = saleRow(env.database, created.saleId);
    expect(row.cash_shift_id).toBeNull();
    expect(row.cash_register_id).toBeNull();

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId,
      amount: created.payableAmount,
      tenderedAmount: null,
      idempotencyKey: "pay:vertical:2",
      correlationId: randomUUID(),
      causationId: null,
    });

    expect(paid.kind).toBe("CASH_SHIFT_MISSING");
    expect(saleRow(env.database, created.saleId).status).toBe("READY_FOR_PAYMENT");
  });

  /**
   * `open()` sólo impide un segundo turno en la **misma** caja, así que un
   * dispositivo puede tener dos turnos abiertos en cajas distintas. Vincular
   * uno al azar imputaría el efectivo a un arqueo ajeno sin que nadie lo notara;
   * quedarse sin vínculo hace que el cobro falle de forma visible. Se elige el
   * fallo visible (`D-23`).
   */
  it("con dos turnos abiertos del mismo dispositivo no adivina la caja", async () => {
    const env = await buildEnv();
    openShift(env, REGISTER, "shift:vertical:a");
    openShift(env, OTHER_REGISTER, "shift:vertical:b");

    expect(env.cashStore.findOpenShiftForDevice(SCOPE)).toEqual({ kind: "AMBIGUOUS", count: 2 });

    const item = registerProduct(env);
    const created = createSale(env, item);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    const row = saleRow(env.database, created.saleId);
    expect(row.cash_shift_id).toBeNull();
    expect(row.cash_register_id).toBeNull();
  });

  /**
   * La resolución es **por dispositivo**, no por sucursal. Sin este filtro, una
   * caja vecina con turno abierto se llevaría la venta de un dispositivo que no
   * ha abierto la suya, y el efectivo acabaría en el arqueo de otro cajero.
   *
   * Comprobado por mutación: quitar `origin_device_id` de la consulta no rompía
   * ninguna prueba antes de existir ésta.
   */
  it("no toma el turno abierto por otro dispositivo", async () => {
    const env = await buildEnv();

    // Otro dispositivo, misma sucursal, su propia caja.
    const otherDeviceScope: SyncScope = { ...SCOPE, deviceId: "018f0000-0000-7000-8000-0000000000d9" };
    const opened = env.openShift.execute(otherDeviceScope, SESSION, auth(), {
      cashRegisterId: OTHER_REGISTER, openingAmount: "0.000000",
      businessDate: BUSINESS_DATE, timezoneId: "America/Bogota", utcOffsetMinutes: -300,
      idempotencyKey: "shift:vertical:other", correlationId: randomUUID(), causationId: null,
    });
    expect(opened.kind).toBe("OPENED");

    // Este dispositivo no abrió ninguno: no hereda el del vecino.
    expect(env.cashStore.findOpenShiftForDevice(SCOPE)).toEqual({ kind: "NONE" });

    const item = registerProduct(env);
    const created = createSale(env, item);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    expect(saleRow(env.database, created.saleId).cash_shift_id).toBeNull();
  });

  it("un turno en CLOSING no admite venta nueva", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env);

    env.database.native.prepare(
      "UPDATE cash_shift SET status='CLOSING' WHERE tenant_id=? AND id=?",
    ).run(TENANT, shiftId);

    expect(env.cashStore.findOpenShiftForDevice(SCOPE)).toEqual({ kind: "NONE" });
  });
});
