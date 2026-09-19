import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../src/cash/close-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import { GetPaymentUseCase } from "../src/payments/get-payment-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

/**
 * El núcleo transaccional del POS, encadenado de extremo a extremo.
 *
 * ## Qué añade este fichero y qué no repite
 *
 * `sale-cash-register-binding.test.ts` ya demuestra que la **caja** selecciona
 * el turno (`DEC-012` §25.2) y que el dispositivo no participa (§25.3).
 * `sale.test.ts` ya cubre idempotencia, autorización y reversión del cálculo.
 * `payment.test.ts` cubre el cobro y sus invariantes. Nada de eso se repite.
 *
 * Lo que faltaba era una sola prueba que recorriera
 *
 * ```
 * turno OPEN → sale.create → venta persistida → cobro → estado comercial
 *            → auditoría / outbox / idempotencia coherentes
 * ```
 *
 * afirmando el **rastro completo en la misma corrida**, y —lo que de verdad no
 * estaba probado en ninguna parte— que el turno de **otro tenant** no alcanza
 * esta venta. El selector filtra por `tenant_id` y `branch_id` desde que se
 * escribió, pero ninguna prueba lo sostenía: una regresión que quitara el
 * filtro de tenant habría pasado verde.
 *
 * Todo corre contra SQLite real y contra los casos de uso reales del Local
 * Service. No hay dobles: lo que estas pruebas afirman está escrito en disco.
 */

const TENANT = "018f0000-0000-7000-8000-0000000000c1";
const COMPANY = "018f0000-0000-7000-8000-0000000000c2";
const BRANCH = "018f0000-0000-7000-8000-0000000000c3";
const DEVICE = "018f0000-0000-7000-8000-0000000000c4";
const INSTALL = "018f0000-0000-7000-8000-0000000000c5";
const USER = "018f0000-0000-7000-8000-0000000000c6";
const SESSION = "018f0000-0000-7000-8000-0000000000c8";

/** Otro comercio, con su propia caja del mismo identificador. */
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000d1";
const OTHER_COMPANY = "018f0000-0000-7000-8000-0000000000d2";
const OTHER_BRANCH = "018f0000-0000-7000-8000-0000000000d3";

const CAJA = "018f0000-0000-7000-8000-00000000cc01";
const CAJA_SIN_TURNO = "018f0000-0000-7000-8000-00000000cc02";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const OTHER_SCOPE: SyncScope = {
  tenantId: OTHER_TENANT, companyId: OTHER_COMPANY, branchId: OTHER_BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const BUSINESS_DATE = "2026-09-06";
const PERMISSIONS = [
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE", "CATALOG_PRODUCT_REGISTER",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_PAYMENT_READ",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(scope: SyncScope = SCOPE): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000cf",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: scope.tenantId, company_id: scope.companyId, branch_id: scope.branchId,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: PERMISSIONS.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

/** Cajas activas de un comercio. Lo único sembrado; ninguna venta lo está. */
function seedRegisters(db: LocalDatabase, scope: SyncScope, registers: readonly string[]): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(
    scope.tenantId, scope.companyId, scope.branchId, at,
    JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at,
  );

  let index = 0;
  for (const id of registers) {
    index += 1;
    const code = `CAJA-0${String(index)}`;
    db.native.prepare(
      `INSERT OR IGNORE INTO cash_register(
        id, tenant_id, company_id, branch_id, code, code_normalized, name,
        currency_code, status, created_at, retired_at, version, last_seen_sequence
      ) VALUES (?,?,?,?,?,?,?,'COP','ACTIVE',?,NULL,1,1)`,
    ).run(id, scope.tenantId, scope.companyId, scope.branchId, code, code.toLowerCase(), code, at);
  }
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-core-flow-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  seedRegisters(database, SCOPE, [CAJA, CAJA_SIN_TURNO]);
  seedRegisters(database, OTHER_SCOPE, [CAJA]);

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
    closeShift: new CloseCashShiftUseCase(cashStore, at),
    registerProduct: new RegisterProductUseCase(catalogStore),
    createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashStore, saleStore, at),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, at),
    getPayment: new GetPaymentUseCase(paymentStore, at),
  };
}
type Env = Awaited<ReturnType<typeof buildEnv>>;

function openShift(env: Env, register: string, key: string, scope: SyncScope = SCOPE): string {
  const result = env.openShift.execute(scope, SESSION, auth(scope), {
    cashRegisterId: register, openingAmount: "0.000000",
    businessDate: BUSINESS_DATE, timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

let productSeed = 0;
function registerProduct(env: Env): { productId: string; presentationId: string } {
  productSeed += 1;
  const suffix = String(productSeed).padStart(3, "0");
  const result = env.registerProduct.execute(SCOPE, SESSION, auth(), {
    code: `CAFE-${suffix}`, name: "Cafe molido", stockControlled: false,
    presentationName: "Libra", unitCode: "LBR", unitPrecision: 0,
    barcode: `770222222${suffix}0`,
    priceAmount: "5000.000000", currencyCode: "COP",
    idempotencyKey: `catalog:core:${suffix}`,
    correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "REGISTERED") throw new Error(`expected REGISTERED, got ${result.kind}`);
  return { productId: result.productId, presentationId: result.presentationId };
}

let saleSeed = 0;
function createSale(
  env: Env,
  item: { productId: string; presentationId: string },
  register: string | null,
  options: { key?: string; quantity?: string; scope?: SyncScope } = {},
) {
  saleSeed += 1;
  const scope = options.scope ?? SCOPE;
  return env.createSale.execute(scope, SESSION, auth(scope), {
    cashRegisterId: register,
    idempotencyKey: options.key ?? `sale:core:${String(saleSeed)}`,
    channel: "POS_LOCAL",
    businessDate: BUSINESS_DATE,
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    documentSeries: "FS-001",
    currencyCode: "COP",
    correlationId: randomUUID(),
    causationId: null,
    lines: [{
      productId: item.productId, presentationId: item.presentationId,
      quantity: options.quantity ?? "1.000000",
    }],
  });
}

function saleRow(db: LocalDatabase, saleId: string, tenant = TENANT) {
  return db.native.prepare(
    `SELECT status, cash_shift_id, cash_register_id, payable_amount, completed_at
     FROM sales_sales WHERE tenant_id=? AND id=?`,
  ).get(tenant, saleId) as {
    status: string;
    cash_shift_id: string | null;
    cash_register_id: string | null;
    payable_amount: string;
    completed_at: string | null;
  };
}

function auditCodes(db: LocalDatabase, tenant = TENANT): string[] {
  return (db.native.prepare(
    "SELECT action_code FROM local_operation_audit WHERE tenant_id=? ORDER BY rowid",
  ).all(tenant) as Array<{ action_code: string }>).map((row) => row.action_code);
}

function outboxTypes(db: LocalDatabase, tenant = TENANT): string[] {
  return (db.native.prepare(
    "SELECT operation_type FROM local_sync_outbox WHERE tenant_id=? ORDER BY local_sequence",
  ).all(tenant) as Array<{ operation_type: string }>).map((row) => row.operation_type);
}

// ── A, F, G: la cadena completa ──────────────────────────────────────────────

describe("el núcleo transaccional recorre turno → venta → cobro", () => {
  it("con turno OPEN la venta nace ligada, se cobra y llega a COMPLETED", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA, "shift:core:1");
    const item = registerProduct(env);

    // A: la venta se crea contra la caja que la operación nombra.
    const created = createSale(env, item, CAJA);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    const persisted = saleRow(env.database, created.saleId);
    expect(persisted.status).toBe("READY_FOR_PAYMENT");
    expect(persisted.cash_register_id).toBe(CAJA);
    expect(persisted.cash_shift_id).toBe(shiftId);
    expect(persisted.payable_amount).toBe(created.payableAmount);

    // F: el cobro completo lleva la venta a su estado comercial final en la
    // misma transacción que imputa el pago (`DEC-016` §5.2).
    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:core:1", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CONFIRMED");
    if (paid.kind !== "CONFIRMED") return;
    expect(paid.saleCompleted).toBe(true);

    const completed = saleRow(env.database, created.saleId);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completed_at).not.toBeNull();

    // El pago es legible por su caso de uso, no sólo por la tabla.
    const read = env.getPayment.execute(SCOPE, auth(), { paymentId: paid.paymentId });
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") return;
    expect(read.payment.status).toBe("CONFIRMED");
    expect(read.payment.saleId).toBe(created.saleId);
    expect(read.payment.confirmedAmount).toBe(created.payableAmount);

    // G: auditoría y outbox cuentan la misma historia, en orden y sin huecos.
    //
    // `CATALOG_PRODUCT_REGISTER` va en infinitivo mientras los demás códigos
    // van en participio. Es una inconsistencia real del catálogo de códigos,
    // no de esta prueba: se afirma lo que el código emite hoy. Renombrarlo
    // afectaría a lo ya encolado hacia el servidor y no pertenece a este
    // bloque.
    const chain = [
      "CASH_SHIFT_OPENED", "CATALOG_PRODUCT_REGISTER",
      "SALE_CREATED", "PAYMENT_CONFIRMED", "SALE_COMPLETED",
    ];
    expect(auditCodes(env.database)).toEqual(chain);
    expect(outboxTypes(env.database)).toEqual(chain);

    // La caja recibió el asiento del cobro, y lo hizo Payments a través de
    // `CashPort`: no escribe caja por su cuenta.
    const movements = env.database.native.prepare(
      `SELECT movement_type, amount FROM cash_movement
       WHERE tenant_id=? AND cash_shift_id=? ORDER BY shift_sequence`,
    ).all(TENANT, shiftId) as Array<{ movement_type: string; amount: string }>;
    expect(movements.map((row) => row.movement_type)).toEqual(["OPENING_FLOAT", "CASH_SALE"]);
    expect(movements[1]?.amount).toBe(created.payableAmount);
  });

  // ── B ──────────────────────────────────────────────────────────────────────

  it("sin turno OPEN en esa caja la venta no se liga y el cobro la rechaza", async () => {
    const env = await buildEnv();
    openShift(env, CAJA, "shift:core:1");
    const created = createSale(env, registerProduct(env), CAJA_SIN_TURNO);

    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    const persisted = saleRow(env.database, created.saleId);
    expect(persisted.cash_shift_id).toBeNull();
    expect(persisted.cash_register_id).toBeNull();

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:core:2", correlationId: randomUUID(), causationId: null,
    });

    // El rechazo llega al cobrar, no al crear: `sales_sales` obliga por
    // esquema a que caja y turno sean ambos nulos o ambos no nulos
    // (`CHECK((cash_register_id IS NULL) = (cash_shift_id IS NULL))`), y
    // `DEC-016` §10.3 sitúa aquí la negativa. La venta existe; lo que no
    // existe es dónde asentar el efectivo.
    expect(paid.kind).toBe("CASH_SHIFT_MISSING");
    expect(saleRow(env.database, created.saleId).status).toBe("READY_FOR_PAYMENT");
  });

  // ── C ──────────────────────────────────────────────────────────────────────

  it("el turno de otro comercio no alcanza esta venta aunque la caja se llame igual", async () => {
    const env = await buildEnv();
    // El otro comercio abre turno en **su** caja, que comparte identificador.
    const foreignShift = openShift(env, CAJA, "shift:core:other", OTHER_SCOPE);

    const created = createSale(env, registerProduct(env), CAJA);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    const persisted = saleRow(env.database, created.saleId);
    expect(persisted.cash_shift_id).toBeNull();
    expect(persisted.cash_register_id).toBeNull();
    expect(persisted.cash_shift_id).not.toBe(foreignShift);

    // Y el dinero tampoco cruza: sin turno propio no hay dónde asentarlo.
    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:core:3", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CASH_SHIFT_MISSING");

    // El selector, consultado directamente, tampoco lo ve.
    expect(env.cashStore.findActiveShiftForRegister(SCOPE, CAJA)).toBeNull();
    expect(env.cashStore.findActiveShiftForRegister(OTHER_SCOPE, CAJA)?.shiftId).toBe(foreignShift);
  });

  // ── D ──────────────────────────────────────────────────────────────────────

  it("un turno en CLOSING liga la venta y el cobro la rechaza por estado", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA, "shift:core:1");
    env.database.native.prepare(
      "UPDATE cash_shift SET status='CLOSING' WHERE tenant_id=? AND id=?",
    ).run(TENANT, shiftId);

    const created = createSale(env, registerProduct(env), CAJA);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    // Se liga a propósito: el turno existe. Decir «no hay turno» mientras se
    // cuadra sería un diagnóstico falso.
    expect(saleRow(env.database, created.saleId).cash_shift_id).toBe(shiftId);

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:core:4", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CASH_SHIFT_NOT_OPEN");
  });

  // ── E ──────────────────────────────────────────────────────────────────────

  it("repetir la clave de idempotencia devuelve la misma venta y no crea otra", async () => {
    const env = await buildEnv();
    openShift(env, CAJA, "shift:core:1");
    const item = registerProduct(env);

    const first = createSale(env, item, CAJA, { key: "sale:core:same" });
    const second = createSale(env, item, CAJA, { key: "sale:core:same" });

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("IDEMPOTENT");
    if (first.kind !== "CREATED" || second.kind !== "IDEMPOTENT") return;
    expect(second.saleId).toBe(first.saleId);
    expect(second.saleNumber).toBe(first.saleNumber);
    expect(second.calculationChecksum).toBe(first.calculationChecksum);

    const total = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM sales_sales WHERE tenant_id=?",
    ).get(TENANT) as { n: number };
    expect(total.n).toBe(1);

    // Una sola operación canónica, y un solo asiento de venta en el outbox.
    expect(auditCodes(env.database).filter((code) => code === "SALE_CREATED")).toHaveLength(1);
    expect(outboxTypes(env.database).filter((type) => type === "SALE_CREATED")).toHaveLength(1);
  });

  // ── H ──────────────────────────────────────────────────────────────────────

  it("si el cobro falla al final no deja pago, ni caja, ni venta completada", async () => {
    const env = await buildEnv();
    const shiftId = openShift(env, CAJA, "shift:core:1");
    const created = createSale(env, registerProduct(env), CAJA);
    if (created.kind !== "CREATED") throw new Error(created.kind);

    // El turno se cierra **después** de crear la venta: el rechazo sólo puede
    // conocerse dentro de la transacción que ya imputó el pago, así que esto
    // ejercita la reversión real, no una validación previa.
    const closed = env.closeShift.execute(SCOPE, SESSION, auth(), {
      shiftId, countedAmount: "0.000000", expectedVersion: 1,
      idempotencyKey: "shift:core:close", correlationId: randomUUID(), causationId: null,
    });
    expect(closed.kind).toBe("CLOSED");

    const auditBefore = auditCodes(env.database).length;
    const outboxBefore = outboxTypes(env.database).length;

    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: created.saleId, amount: created.payableAmount, tenderedAmount: null,
      idempotencyKey: "pay:core:rollback", correlationId: randomUUID(), causationId: null,
    });
    expect(paid.kind).toBe("CASH_SHIFT_NOT_OPEN");

    // Nada sobrevive al rechazo: ni pago, ni intento, ni imputación, ni
    // movimiento de caja, ni operación canónica, ni rastro.
    for (const table of [
      "payments_payments", "payments_payment_attempts", "payments_payment_allocations",
    ]) {
      const rows = env.database.native.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id=?`,
      ).get(TENANT) as { n: number };
      expect(rows.n, table).toBe(0);
    }
    const operations = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM runtime_operations WHERE idempotency_key=?",
    ).get("pay:core:rollback") as { n: number };
    expect(operations.n).toBe(0);
    expect(auditCodes(env.database)).toHaveLength(auditBefore);
    expect(outboxTypes(env.database)).toHaveLength(outboxBefore);
    expect(saleRow(env.database, created.saleId).status).toBe("READY_FOR_PAYMENT");
  });
});
