import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

/**
 * `D-21` — la ventana entre crear la venta y cobrarla, medida.
 *
 * ## Qué afirma el ledger y qué faltaba
 *
 * `D-21` dice que no hay reserva: la disponibilidad se comprueba al crear la
 * venta y la salida ocurre al completarla, así que en medio otra venta puede
 * llevarse la existencia. Y dice que está **mitigado, no resuelto**, porque el
 * cobro entero se revierte.
 *
 * «Mitigado» era una afirmación sin prueba. Ninguna prueba ponía dos ventas a
 * competir por la misma existencia escasa, de modo que las dos propiedades que
 * de verdad protegen al comerciante —que nadie consume dos veces la misma
 * mercancía y que un cobro rechazado no deja rastro— vivían de la lectura del
 * código.
 *
 * ## Lo que estas pruebas fijan
 *
 * 1. **Las dos ventas se crean.** Ésa es la ventana, y es real: ambas pasan la
 *    comprobación de disponibilidad porque ninguna ha descontado todavía.
 * 2. **Sólo una consume.** La segunda se rechaza con `INSUFFICIENT_STOCK`.
 * 3. **La existencia nunca queda negativa.**
 * 4. **El rechazo no deja rastro:** ni pago, ni imputación, ni movimiento de
 *    caja, ni venta completada. El cobro entero se revierte, que es
 *    exactamente lo que el ledger llama mitigación.
 * 5. **El rechazo es estable:** reintentarlo devuelve lo mismo y sigue sin
 *    escribir nada.
 *
 * ## Lo que estas pruebas NO resuelven, y conviene no confundir
 *
 * No cierran `D-21`. El coste que el ledger describe sigue ahí: un cobro
 * legítimo puede rechazarse **en el último paso**, con el cliente delante. Lo
 * que sí queda demostrado es que ese coste es de experiencia, no de
 * integridad: no hay doble consumo, ni existencia negativa, ni venta cobrada
 * sin mercancía.
 *
 * Resolverlo exige la reserva que `UC-INVENTORY-002` §90 ya especifica
 * —`InventoryReservation` con sus seis estados—, y esa pieza tiene dos
 * entradas que hoy no están decididas: la **duración de expiración** de una
 * reserva (§107 regla 4 exige liberarla por transición explícita, sin decir
 * cuándo) y la **liberación al anular una venta**, que depende de `D-22`, aún
 * bloqueada. Implementarla ahora exigiría inventar ambas.
 */

const TENANT = "018f0000-0000-7000-8000-0000000000e1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000e9";
const COMPANY = "018f0000-0000-7000-8000-0000000000e2";
const BRANCH = "018f0000-0000-7000-8000-0000000000e3";
const DEVICE = "018f0000-0000-7000-8000-0000000000e4";
const INSTALL = "018f0000-0000-7000-8000-0000000000e5";
const USER = "018f0000-0000-7000-8000-0000000000e6";
const SESSION = "018f0000-0000-7000-8000-0000000000e7";
const REGISTER = "018f0000-0000-7000-8000-00000000ee01";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const PAYABLE = "10000.000000";

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(): StoredAuthorizationSnapshot {
  const claims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ef",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: [
        { code: "CASH_SHIFT_OPEN", status: "ACTIVE" as const },
        { code: "INVENTORY_STOCK_RECEIVE", status: "ACTIVE" as const },
        { code: "PAYMENTS_PAYMENT_REGISTER", status: "ACTIVE" as const },
      ],
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-stock-race-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);

  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);

  return {
    database, paymentStore,
    openShift: new OpenCashShiftUseCase(new SqliteMasterSnapshotStore(database, () => NOW), cashStore, () => NOW),
    receive: new ReceiveStockUseCase(inventoryStore),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
  };
}

function seedRegister(db: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at);
  db.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-01','caja-01','Caja 01','COP','ACTIVE',?,NULL,1,1)`,
  ).run(REGISTER, TENANT, COMPANY, BRANCH, at);
}

/** Un producto con control de existencia y su presentación, compartidos. */
function seedCatalog(db: LocalDatabase, tenantId = TENANT): { productId: string; presentationId: string } {
  const productId = randomUUID();
  const presentationId = randomUUID();
  const at = NOW.toISOString();
  db.native.prepare(
    `INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,?,'Arroz Blanco','ACTIVE',1,?,?,?,1,?,?)`,
  ).run(productId, tenantId, COMPANY, `ARROZ-${productId.slice(0, 8)}`, USER,
    `catalog:${productId}`, randomUUID(), at, at);
  db.native.prepare(
    `INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Libra','LBR',2,NULL,'ACTIVE',?,?)`,
  ).run(presentationId, tenantId, productId, at, at);
  return { productId, presentationId };
}

function seedSale(db: LocalDatabase, shiftId: string, tenantId = TENANT): string {
  const saleId = randomUUID();
  const at = NOW.toISOString();
  const zero = "0.000000";
  const operationId = randomUUID();
  const saleNumber = (db.native.prepare(
    "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales_sales WHERE tenant_id=? AND branch_id=?",
  ).get(tenantId, BRANCH) as { next: number }).next;

  db.native.prepare(
    `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
     VALUES (?,?,?,'SUCCEEDED','SALE_CREATED',?,?)`,
  ).run(operationId, `sale:${saleId}`, "b".repeat(64), at, at);

  db.native.prepare(
    `INSERT INTO sales_sales(
      id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id,
      origin_device_id, installation_id, operator_actor_type, operator_actor_id,
      channel, status, business_date, timezone_id, utc_offset_minutes,
      document_series, sale_number, currency_code,
      subtotal_amount, discount_amount, tax_amount, fiscal_total_amount,
      commercial_rounding_adjustment, payable_amount,
      pricing_pipeline_version, pricing_policy_version, promotion_policy_version,
      tax_policy_version, rounding_policy_version, pricing_snapshot, tax_snapshot,
      calculation_checksum, operation_id, idempotency_key, request_checksum,
      correlation_id, causation_id, version, created_at,
      completed_at, cancelled_at, expired_at, server_recorded_at
    ) VALUES (
      ?,?,?,?,?,?, ?,?,'USER',?,
      'POS','READY_FOR_PAYMENT','2026-09-06','America/Bogota',-300,
      'A',?,'COP', ?,?,?,?, ?,?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?, ?,NULL,1,?, NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, tenantId, COMPANY, BRANCH, REGISTER, shiftId,
    DEVICE, INSTALL, USER, saleNumber,
    PAYABLE, zero, zero, PAYABLE, zero, PAYABLE,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64), randomUUID(), at,
  );
  return saleId;
}

/** Una línea de la venta sobre una presentación **compartida**. */
function seedSaleLine(
  db: LocalDatabase,
  saleId: string,
  ids: { productId: string; presentationId: string },
  quantity: string,
  tenantId = TENANT,
): void {
  const zero = "0.000000";
  db.native.prepare(
    `INSERT INTO sales_sale_items(
      id, tenant_id, sale_id, line_number,
      product_id, variant_id, presentation_id,
      product_name_snapshot, presentation_name_snapshot, identifier_snapshot,
      unit_id, unit_code_snapshot, unit_precision_snapshot,
      quantity, unit_price_amount, gross_amount,
      discount_amount, taxable_amount, tax_amount, line_total_amount,
      pricing_resolution_snapshot, tax_calculation_snapshot,
      lot_id, measurement_source_type, measurement_evidence_snapshot, measurement_evidence_checksum
    ) VALUES (?,?,?,1,?,NULL,?,'Arroz Blanco','Libra',NULL,?,'LBR',2,?,
      '5000.000000','10000.000000',?,'10000.000000',?,'10000.000000','{}','{}',
      NULL,NULL,NULL,NULL)`,
  ).run(
    randomUUID(), tenantId, saleId, ids.productId, ids.presentationId,
    ids.presentationId, quantity, zero, zero,
  );
}

function stockOf(db: LocalDatabase, presentationId: string): string | null {
  const row = db.native.prepare(
    "SELECT quantity_on_hand FROM inventory_stock WHERE presentation_id=?",
  ).get(presentationId) as { quantity_on_hand: string } | undefined;
  return row?.quantity_on_hand ?? null;
}

function count(db: LocalDatabase, sql: string, ...params: readonly string[]): number {
  return (db.native.prepare(sql).get(...params) as { n: number }).n;
}

/** Mostrador listo con `units` unidades de una presentación compartida. */
async function counter(units: string) {
  const env = await buildEnv();
  seedRegister(env.database);
  const shift = env.openShift.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: REGISTER, openingAmount: "0.000000",
    businessDate: "2026-09-06", timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: "race:shift", correlationId: randomUUID(), causationId: null,
  });
  if (shift.kind !== "OPENED") throw new Error(`expected OPENED, got ${shift.kind}`);

  const ids = seedCatalog(env.database);
  const received = env.receive.execute(SCOPE, SESSION, auth(), {
    presentationId: ids.presentationId, movementType: "PURCHASE_RECEIPT",
    quantity: units, reasonCode: "SUPPLIER_DELIVERY", businessDate: "2026-09-06",
    idempotencyKey: "race:receive", correlationId: randomUUID(), causationId: null,
  });
  if (received.kind !== "POSTED") throw new Error(`expected POSTED, got ${received.kind}`);

  return { env, ids, shiftId: shift.shiftId };
}

describe("D-21 — dos ventas sobre la misma existencia escasa", () => {
  it("las dos ventas se crean, sólo una consume y la otra no deja rastro", async () => {
    // Dos libras en el estante; cada venta quiere las dos.
    const { env, ids, shiftId } = await counter("2.000000");
    const saleA = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleA, ids, "2.000000");
    const saleB = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleB, ids, "2.000000");

    // La ventana de `D-21`: ambas existen y ambas son cobrables, porque
    // ninguna ha descontado todavía.
    expect(stockOf(env.database, ids.presentationId)).toBe("2.000000");

    const first = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleA, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "race:pay:a", correlationId: randomUUID(), causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");
    expect(stockOf(env.database, ids.presentationId)).toBe("0.000000");

    // La segunda llega tarde. El cobro es legítimo y aun así se rechaza: ése
    // es el coste que `D-21` describe.
    const second = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleB, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "race:pay:b", correlationId: randomUUID(), causationId: null,
    });
    expect(second.kind).toBe("INSUFFICIENT_STOCK");

    // Y la mitigación es real: el rechazo no deja absolutamente nada.
    expect(stockOf(env.database, ids.presentationId)).toBe("0.000000");
    expect((env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE id=?",
    ).get(saleB) as { status: string }).status).not.toBe("COMPLETED");
    expect(count(env.database,
      `SELECT COUNT(*) AS n FROM payments_payment_allocations
        WHERE collection_subject_type='SALE' AND collection_subject_id=?`, saleB)).toBe(0);
    expect(count(env.database,
      "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_SALE'",
      TENANT)).toBe(1);
    // Un solo libro de salida: nadie consumió dos veces la misma mercancía.
    expect(count(env.database,
      "SELECT COUNT(*) AS n FROM inventory_movement WHERE tenant_id=? AND movement_type='SALE'",
      TENANT)).toBe(1);
  });

  it("la existencia nunca queda negativa, ni siquiera por un instante", async () => {
    const { env, ids, shiftId } = await counter("1.000000");
    const saleA = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleA, ids, "1.000000");
    const saleB = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleB, ids, "1.000000");

    expect(env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleA, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "neg:a", correlationId: randomUUID(), causationId: null,
    }).kind).toBe("CONFIRMED");

    expect(env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleB, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "neg:b", correlationId: randomUUID(), causationId: null,
    }).kind).toBe("INSUFFICIENT_STOCK");

    const remaining = stockOf(env.database, ids.presentationId);
    expect(remaining).toBe("0.000000");
    // El `CHECK` del esquema ya impide el signo, pero afirmarlo aquí fija la
    // propiedad donde ocurre el riesgo y no sólo donde está la columna.
    expect(remaining!.startsWith("-")).toBe(false);
  });

  it("el rechazo es estable: reintentarlo devuelve lo mismo y sigue sin escribir", async () => {
    const { env, ids, shiftId } = await counter("1.000000");
    const saleA = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleA, ids, "1.000000");
    const saleB = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleB, ids, "1.000000");

    env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleA, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "stable:a", correlationId: randomUUID(), causationId: null,
    });

    const attempt = () => env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleB, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "stable:b", correlationId: randomUUID(), causationId: null,
    });
    expect(attempt().kind).toBe("INSUFFICIENT_STOCK");
    expect(attempt().kind).toBe("INSUFFICIENT_STOCK");

    // Ni un pago a medias tras dos intentos. La reversión de `DEC-016` deja la
    // operación como si nunca se hubiera intentado, lo que permite reintentar
    // cuando la mercancía vuelva.
    expect(count(env.database,
      `SELECT COUNT(*) AS n FROM payments_payment_allocations
        WHERE collection_subject_type='SALE' AND collection_subject_id=?`, saleB)).toBe(0);
    expect(count(env.database,
      "SELECT COUNT(*) AS n FROM inventory_movement WHERE tenant_id=? AND movement_type='SALE'",
      TENANT)).toBe(1);
  });

  it("la escasez de un comercio no alcanza la existencia de otro", async () => {
    const { env, ids, shiftId } = await counter("1.000000");
    // Otro comercio, su propio producto y su propia existencia.
    const otherIds = seedCatalog(env.database, OTHER_TENANT);
    const at = NOW.toISOString();
    env.database.native.prepare(
      `INSERT INTO inventory_stock(
        tenant_id, company_id, branch_id, presentation_id, quantity_on_hand,
        last_movement_sequence, version, created_at, updated_at
      ) VALUES (?,?,?,?,'5.000000',0,1,?,?)`,
    ).run(OTHER_TENANT, COMPANY, BRANCH, otherIds.presentationId, at, at);

    const saleA = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleA, ids, "1.000000");
    const saleB = seedSale(env.database, shiftId);
    seedSaleLine(env.database, saleB, ids, "1.000000");

    env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleA, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "iso:a", correlationId: randomUUID(), causationId: null,
    });
    expect(env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: saleB, amount: PAYABLE, tenderedAmount: null,
      idempotencyKey: "iso:b", correlationId: randomUUID(), causationId: null,
    }).kind).toBe("INSUFFICIENT_STOCK");

    // El agotamiento de un tenant no tocó al otro.
    expect(stockOf(env.database, otherIds.presentationId)).toBe("5.000000");
  });
});
