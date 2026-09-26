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
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { AdjustStockUseCase } from "../src/inventory/adjust-stock-use-case.js";
import { GetStockUseCase } from "../src/inventory/get-stock-use-case.js";
import { TraceLotUseCase } from "../src/inventory/trace-lot-use-case.js";
import { ListExpiringLotsUseCase } from "../src/inventory/list-expiring-lots-use-case.js";
import { lotExpiryState } from "../src/inventory/receive-lot-use-case.js";
import { NEAR_EXPIRY_DAYS } from "@pos-platform/contracts";
import { scale6ToBigInt } from "../src/money.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const OTHER_BRANCH = "018f0000-0000-7000-8000-000000000033";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";
const ABSENT_PRESENTATION = "018f0000-0000-7000-8000-0000000000aa";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ALL = [
  "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE",
  "INVENTORY_STOCK_ADJUST",
  "INVENTORY_STOCK_READ",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = ALL): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

let seed = 0;
const key = (): string => { seed += 1; return `idem-inventory-${String(seed)}`; };

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-inventory-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const store = new SqliteInventoryStore(database, sync, () => NOW);

  const registered = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
    code: "ARROZ-001",
    name: "Arroz Blanco",
    stockControlled: true,
    presentationName: "Libra",
    unitCode: "LBR",
    unitPrecision: 2,
    barcode: "7709876543210",
    priceAmount: "3200.000000",
    currencyCode: "COP",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  });
  if (registered.kind !== "REGISTERED") throw new Error(`fixture failed: ${registered.kind}`);

  return {
    database, store,
    presentationId: registered.presentationId,
    receive: new ReceiveStockUseCase(store),
    adjust: new AdjustStockUseCase(store),
    get: new GetStockUseCase(store),
  };
}

const receipt = (presentationId: string, overrides: Record<string, unknown> = {}) => ({
  presentationId,
  movementType: "PURCHASE_RECEIPT" as const,
  quantity: "10.000000",
  reasonCode: "SUPPLIER_DELIVERY",
  businessDate: "2026-09-07",
  idempotencyKey: key(),
  correlationId: CORRELATION,
  causationId: null,
  ...overrides,
});

describe("entrada de existencia", () => {
  it("crea la fila de existencia y deja el libro cuadrado con ella", async () => {
    const { receive, get, database, presentationId } = await buildEnv();

    const posted = receive.execute(SCOPE, SESSION, auth(), receipt(presentationId));
    expect(posted.kind).toBe("POSTED");
    if (posted.kind !== "POSTED") return;
    expect(posted.quantityAfter).toBe("10.000000");
    expect(posted.stockSequence).toBe(1);

    const found = get.execute(SCOPE, auth(), presentationId);
    expect(found.kind).toBe("FOUND");
    if (found.kind !== "FOUND") return;
    expect(found.stock.quantityOnHand).toBe("10.000000");

    // La existencia es derivada: tiene que coincidir con la suma del libro.
    const movements = database.native.prepare(
      "SELECT direction, quantity FROM inventory_movement WHERE tenant_id=? AND presentation_id=?",
    ).all(TENANT, presentationId) as Array<{ direction: string; quantity: string }>;
    const ledger = movements.reduce(
      (total, row) => total + (row.direction === "IN" ? 1n : -1n) * scale6ToBigInt(row.quantity),
      0n,
    );
    expect(ledger).toBe(scale6ToBigInt(found.stock.quantityOnHand));
  });

  it("acumula sobre lo que ya había y hace avanzar la secuencia", async () => {
    const { receive, presentationId } = await buildEnv();

    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId));
    const second = receive.execute(
      SCOPE, SESSION, auth(), receipt(presentationId, { quantity: "2.500000" }),
    );

    expect(second.kind).toBe("POSTED");
    if (second.kind !== "POSTED") return;
    expect(second.quantityAfter).toBe("12.500000");
    expect(second.stockSequence).toBe(2);
  });

  it("no acepta una presentación que no está en el catálogo", async () => {
    const { receive } = await buildEnv();
    const outcome = receive.execute(SCOPE, SESSION, auth(), receipt(ABSENT_PRESENTATION));
    expect(outcome.kind).toBe("PRESENTATION_NOT_FOUND");
  });

  it("la existencia es por sucursal: otra sucursal parte de cero", async () => {
    const { receive, get, store, presentationId } = await buildEnv();
    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId));

    // **La misma base de datos**, otra sucursal. Consultar una segunda base
    // daría cero siempre y no probaría nada sobre el alcance.
    const otherScope: SyncScope = { ...SCOPE, branchId: OTHER_BRANCH };
    expect(store.availableUnits(otherScope, presentationId)).toBe(0n);
    expect(store.availableUnits(SCOPE, presentationId)).toBe(10_000_000n);
    expect(get.execute(SCOPE, auth(), presentationId).kind).toBe("FOUND");
  });

  it("un reintento con la misma clave no suma dos veces", async () => {
    const { receive, presentationId } = await buildEnv();
    const request = receipt(presentationId);

    const first = receive.execute(SCOPE, SESSION, auth(), request);
    const replay = receive.execute(SCOPE, SESSION, auth(), request);

    expect(first.kind).toBe("POSTED");
    expect(replay.kind).toBe("IDEMPOTENT");
    if (replay.kind !== "IDEMPOTENT") return;
    expect(replay.quantityAfter).toBe("10.000000");
  });

  it("la misma clave con otra cantidad es un conflicto, no un segundo asiento", async () => {
    const { receive, presentationId } = await buildEnv();
    const request = receipt(presentationId);

    receive.execute(SCOPE, SESSION, auth(), request);
    const conflicting = receive.execute(
      SCOPE, SESSION, auth(), { ...request, quantity: "99.000000" },
    );

    expect(conflicting.kind).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("exige INVENTORY_STOCK_RECEIVE", async () => {
    const { receive, presentationId } = await buildEnv();
    const outcome = receive.execute(
      SCOPE, SESSION, auth(["INVENTORY_STOCK_READ"]), receipt(presentationId),
    );
    expect(outcome.kind).toBe("UNAUTHORIZED");
  });
});

describe("ajuste de existencia", () => {
  it("resta y deja el motivo y el actor en el rastro", async () => {
    const { receive, adjust, database, presentationId } = await buildEnv();
    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId));

    const adjusted = adjust.execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "SHRINKAGE",
      quantity: "1.500000",
      reasonCode: "DAMAGED_GOODS",
      lotCode: null,
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });

    expect(adjusted.kind).toBe("POSTED");
    if (adjusted.kind !== "POSTED") return;
    expect(adjusted.quantityAfter).toBe("8.500000");

    // Se localiza por el movimiento concreto, no por orden: ambos asientos
    // comparten `created_at` y ordenar por él no distingue cuál es cuál.
    const audit = database.native.prepare(
      `SELECT a.actor_id, a.reason_code
       FROM local_operation_audit a
       JOIN inventory_movement m ON m.tenant_id = a.tenant_id AND m.id = a.resource_id
       WHERE a.tenant_id=? AND a.action_code='INVENTORY_MOVEMENT_APPEND'
         AND m.movement_type='SHRINKAGE'`,
    ).get(TENANT) as { actor_id: string; reason_code: string };
    expect(audit.actor_id).toBe(USER);
    expect(audit.reason_code).toBe("DAMAGED_GOODS");
  });

  it("no deja la existencia por debajo de cero", async () => {
    const { receive, adjust, get, presentationId } = await buildEnv();
    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId, { quantity: "3.000000" }));

    const outcome = adjust.execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "ADJUSTMENT_NEGATIVE",
      quantity: "4.000000",
      reasonCode: "COUNT_CORRECTION",
      lotCode: null,
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });

    expect(outcome.kind).toBe("INSUFFICIENT_STOCK");
    if (outcome.kind !== "INSUFFICIENT_STOCK") return;
    expect(outcome.available).toBe("3.000000");

    // Y el rechazo no dejó rastro escrito.
    const stock = get.execute(SCOPE, auth(), presentationId);
    expect(stock.kind).toBe("FOUND");
    if (stock.kind !== "FOUND") return;
    expect(stock.stock.quantityOnHand).toBe("3.000000");
    expect(stock.stock.lastMovementSequence).toBe(1);
  });

  it("recibir no basta para ajustar: son permisos distintos", async () => {
    const { receive, adjust, presentationId } = await buildEnv();
    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId));

    const outcome = adjust.execute(
      SCOPE, SESSION, auth(["INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_READ"]),
      {
        presentationId,
        movementType: "ADJUSTMENT_NEGATIVE",
        quantity: "1.000000",
        reasonCode: "COUNT_CORRECTION",
        lotCode: null,
        businessDate: "2026-09-07",
        idempotencyKey: key(),
        correlationId: CORRELATION,
        causationId: null,
      },
    );

    expect(outcome.kind).toBe("UNAUTHORIZED");
  });
});

describe("consulta de existencia", () => {
  it("distingue «nunca tuvo movimiento» de «se agotó»", async () => {
    const { receive, adjust, get, presentationId } = await buildEnv();

    expect(get.execute(SCOPE, auth(), presentationId).kind).toBe("NOT_FOUND");

    receive.execute(SCOPE, SESSION, auth(), receipt(presentationId, { quantity: "1.000000" }));
    adjust.execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "ADJUSTMENT_NEGATIVE",
      quantity: "1.000000",
      reasonCode: "COUNT_CORRECTION",
      lotCode: null,
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });

    const emptied = get.execute(SCOPE, auth(), presentationId);
    expect(emptied.kind).toBe("FOUND");
    if (emptied.kind !== "FOUND") return;
    expect(emptied.stock.quantityOnHand).toBe("0.000000");
  });

  it("exige INVENTORY_STOCK_READ", async () => {
    const { get, presentationId } = await buildEnv();
    const outcome = get.execute(SCOPE, auth(["INVENTORY_STOCK_RECEIVE"]), presentationId);
    expect(outcome.kind).toBe("UNAUTHORIZED");
  });
});

describe("el esquema no admite un movimiento incoherente", () => {
  it("rechaza una venta que sume existencia", async () => {
    const { database, presentationId } = await buildEnv();

    expect(() => database.native.prepare(
      `INSERT INTO inventory_movement(
        id, tenant_id, company_id, branch_id, presentation_id, stock_sequence,
        movement_type, direction, quantity, quantity_after, reason_code, sale_id,
        actor_type, actor_id, operation_id, idempotency_key, correlation_id,
        business_date, occurred_at, created_at
      ) VALUES (?,?,?,?,?,1,'SALE','IN','1.000000','1.000000','X',?,'USER',?,?,?,?,'2026-09-07',?,?)`,
    ).run(
      "018f0000-0000-7000-8000-0000000000b1", TENANT, COMPANY, BRANCH, presentationId,
      "018f0000-0000-7000-8000-0000000000b2", USER,
      "018f0000-0000-7000-8000-0000000000b3", "raw-1", CORRELATION,
      NOW.toISOString(), NOW.toISOString(),
    )).toThrow(/CHECK constraint/i);
  });

  it("rechaza una recepción que declare una venta", async () => {
    const { database, presentationId } = await buildEnv();

    expect(() => database.native.prepare(
      `INSERT INTO inventory_movement(
        id, tenant_id, company_id, branch_id, presentation_id, stock_sequence,
        movement_type, direction, quantity, quantity_after, reason_code, sale_id,
        actor_type, actor_id, operation_id, idempotency_key, correlation_id,
        business_date, occurred_at, created_at
      ) VALUES (?,?,?,?,?,1,'PURCHASE_RECEIPT','IN','1.000000','1.000000','X',?,'USER',?,?,?,?,'2026-09-07',?,?)`,
    ).run(
      "018f0000-0000-7000-8000-0000000000b4", TENANT, COMPANY, BRANCH, presentationId,
      "018f0000-0000-7000-8000-0000000000b5", USER,
      "018f0000-0000-7000-8000-0000000000b6", "raw-2", CORRELATION,
      NOW.toISOString(), NOW.toISOString(),
    )).toThrow(/CHECK constraint/i);
  });

  it("rechaza una existencia negativa escrita directamente", async () => {
    const { database, presentationId } = await buildEnv();

    expect(() => database.native.prepare(
      `INSERT INTO inventory_stock(
        tenant_id, company_id, branch_id, presentation_id,
        quantity_on_hand, last_movement_sequence, version, created_at, updated_at
      ) VALUES (?,?,?,?,'-1.000000',1,1,?,?)`,
    ).run(
      TENANT, COMPANY, BRANCH, presentationId, NOW.toISOString(), NOW.toISOString(),
    )).toThrow(/CHECK constraint/i);
  });
});

describe("asignación de venta a lote: la finalización reintentada no descuenta dos veces", () => {
  // La prueba del vertical («reintentar el cobro») se corta en la capa de
  // pagos y nunca llega aquí. Esta llama al almacén directamente: es la única
  // que mide la guarda `IDEMPOTENT` de `appendSaleDeduction`.
  it("la segunda llamada con la misma venta es IDEMPOTENT y deja una sola asignación", async () => {
    const { store, database, presentationId } = await buildEnv();
    const received = store.receiveLot({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER, presentationId,
      lotCode: "L-UNICO", quantity: "10.000000",
      manufacturedDate: null, expiryDate: "2026-09-30",
      reasonCode: "SUPPLIER_DELIVERY", businessDate: "2026-09-07",
      idempotencyKey: key(), requestChecksum: "a".repeat(64),
      correlationId: CORRELATION, causationId: null,
    });
    expect(received.kind).toBe("RECEIVED");

    const sale = {
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER,
      saleId: "018f0000-0000-7000-8000-000000005a1e", presentationId,
      quantity: "3.000000", businessDate: "2026-09-07",
      correlationId: CORRELATION, causationId: null,
    };
    expect(store.appendSaleDeduction(sale).kind).toBe("POSTED");
    expect(store.appendSaleDeduction(sale).kind).toBe("IDEMPOTENT");

    const allocations = database.native.prepare(
      "SELECT quantity FROM inventory_lot_allocation WHERE tenant_id=? AND sale_id=?",
    ).all(TENANT, sale.saleId) as Array<{ quantity: string }>;
    expect(allocations).toEqual([{ quantity: "3.000000" }]);

    const lot = database.native.prepare(
      "SELECT quantity_on_hand FROM inventory_lot WHERE tenant_id=? AND lot_code='L-UNICO'",
    ).get(TENANT) as { quantity_on_hand: string };
    expect(lot.quantity_on_hand).toBe("7.000000");
  });
});

describe("ajuste con lote nombrado: el lote se busca en la sucursal del contexto", () => {
  /**
   * Regresión de `MIGRATION_028`, medida el 2026-09-26: con la unicidad sin
   * sucursal, la segunda recepción se sumaba al lote de la otra sucursal
   * —un lote de 20 con 10 de existencia, y una sucursal con 10 y sin lote—.
   */
  it("el mismo código recibido en dos sucursales da dos lotes, cada uno con lo suyo", async () => {
    const { store, database, presentationId } = await buildEnv();
    const base = {
      sessionId: SESSION, operatorUserId: USER, presentationId, lotCode: "L-COMPARTIDO",
      quantity: "10.000000", manufacturedDate: null, expiryDate: null,
      reasonCode: "SUPPLIER_DELIVERY", businessDate: "2026-09-07",
      requestChecksum: "e".repeat(64), correlationId: CORRELATION, causationId: null,
    };
    const other = store.receiveLot({ ...base, scope: { ...SCOPE, branchId: OTHER_BRANCH }, idempotencyKey: key() });
    const own = store.receiveLot({ ...base, scope: SCOPE, idempotencyKey: key() });
    expect(other.kind).toBe("RECEIVED");
    expect(own.kind).toBe("RECEIVED");
    if (other.kind !== "RECEIVED" || own.kind !== "RECEIVED") return;
    expect(own.lotId).not.toBe(other.lotId);
    expect(own.lotQuantityOnHand).toBe("10.000000");

    const lots = database.native.prepare(
      "SELECT branch_id, quantity_on_hand FROM inventory_lot WHERE tenant_id=? ORDER BY branch_id",
    ).all(TENANT);
    expect(lots).toEqual([
      { branch_id: BRANCH, quantity_on_hand: "10.000000" },
      { branch_id: OTHER_BRANCH, quantity_on_hand: "10.000000" },
    ]);
  });

  // El código de lote lo teclea el operador. Buscarlo sólo por tenant dejaría
  // que una merma en esta sucursal descontara la tanda de otra.
  it("un lote de otra sucursal es LOT_NOT_FOUND y no se descuenta nada", async () => {
    const { store, database, presentationId } = await buildEnv();
    const otherScope: SyncScope = { ...SCOPE, branchId: OTHER_BRANCH };
    const received = store.receiveLot({
      scope: otherScope, sessionId: SESSION, operatorUserId: USER, presentationId,
      lotCode: "L-AJENO", quantity: "10.000000",
      manufacturedDate: null, expiryDate: null,
      reasonCode: "SUPPLIER_DELIVERY", businessDate: "2026-09-07",
      idempotencyKey: key(), requestChecksum: "b".repeat(64),
      correlationId: CORRELATION, causationId: null,
    });
    expect(received.kind).toBe("RECEIVED");
    const own = store.appendMovementInTransaction({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER,
      movementId: "018f0000-0000-7000-8000-00000000a001",
      operationId: "018f0000-0000-7000-8000-00000000a002",
      presentationId, movementType: "OPENING_COUNT", quantity: "10.000000",
      reasonCode: "INITIAL_COUNT", saleId: null, businessDate: "2026-09-07",
      idempotencyKey: key(), requestChecksum: "c".repeat(64),
      correlationId: CORRELATION, causationId: null,
    });
    expect(own.kind).toBe("POSTED");

    const outcome = store.adjustWithLots({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER,
      movementId: "018f0000-0000-7000-8000-00000000a003",
      operationId: "018f0000-0000-7000-8000-00000000a004",
      presentationId, movementType: "SHRINKAGE", quantity: "4.000000",
      reasonCode: "DAMAGED", saleId: null, businessDate: "2026-09-07",
      idempotencyKey: key(), requestChecksum: "d".repeat(64),
      correlationId: CORRELATION, causationId: null,
    }, "L-AJENO");
    expect(outcome.kind).toBe("LOT_NOT_FOUND");

    const lot = database.native.prepare(
      "SELECT quantity_on_hand FROM inventory_lot WHERE tenant_id=? AND lot_code='L-AJENO'",
    ).get(TENANT) as { quantity_on_hand: string };
    expect(lot.quantity_on_hand).toBe("10.000000");
    const stock = database.native.prepare(
      "SELECT quantity_on_hand FROM inventory_stock WHERE tenant_id=? AND branch_id=? AND presentation_id=?",
    ).get(TENANT, BRANCH, presentationId) as { quantity_on_hand: string };
    expect(stock.quantity_on_hand).toBe("10.000000");
  });
});

describe("rastro de lote: permiso, sucursal y tope", () => {
  function receiveLotIn(
    store: SqliteInventoryStore, scope: SyncScope, presentationId: string, lotCode: string, quantity: string,
  ): void {
    const r = store.receiveLot({
      scope, sessionId: SESSION, operatorUserId: USER, presentationId, lotCode, quantity,
      manufacturedDate: null, expiryDate: null, reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07", idempotencyKey: key(), requestChecksum: "f".repeat(64),
      correlationId: CORRELATION, causationId: null,
    });
    if (r.kind !== "RECEIVED") throw new Error(`fixture failed: ${r.kind}`);
  }

  function sell(store: SqliteInventoryStore, presentationId: string, saleId: string, quantity: string): void {
    const r = store.appendSaleDeduction({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER, saleId, presentationId, quantity,
      businessDate: "2026-09-07", correlationId: CORRELATION, causationId: null,
    });
    if (r.kind !== "POSTED") throw new Error(`fixture failed: ${r.kind}`);
  }

  it("sin permiso de leer existencia es UNAUTHORIZED", async () => {
    const { store, presentationId } = await buildEnv();
    receiveLotIn(store, SCOPE, presentationId, "L-PERM", "5.000000");
    const trace = new TraceLotUseCase(store);
    expect(trace.execute(SCOPE, auth(["INVENTORY_STOCK_RECEIVE"]), presentationId, "L-PERM", NOW).kind)
      .toBe("UNAUTHORIZED");
    expect(trace.execute(SCOPE, auth(), presentationId, "L-PERM", NOW).kind).toBe("FOUND");
  });

  // El código lo teclea el operador: buscarlo sólo por tenant devolvería la
  // tanda de otra sucursal, con ventas que esta sucursal no hizo.
  it("un lote de otra sucursal no se rastrea desde esta", async () => {
    const { store, presentationId } = await buildEnv();
    receiveLotIn(store, { ...SCOPE, branchId: OTHER_BRANCH }, presentationId, "L-OTRA", "5.000000");
    const trace = new TraceLotUseCase(store);
    expect(trace.execute(SCOPE, auth(), presentationId, "L-OTRA", NOW).kind).toBe("NOT_FOUND");
  });

  /**
   * Un rastro cortado en silencio es un retiro que deja ventas fuera sin
   * saberlo. Si hay más salidas que el tope, `truncated` lo dice, y lo
   * recibido se calcula sobre todas, no sobre las devueltas.
   */
  it("con más salidas que el tope, devuelve el tope, marca truncated y cuadra con todas", async () => {
    const { store, presentationId } = await buildEnv();
    receiveLotIn(store, SCOPE, presentationId, "L-TOPE", "10.000000");
    sell(store, presentationId, "018f0000-0000-7000-8000-000000005b01", "1.000000");
    sell(store, presentationId, "018f0000-0000-7000-8000-000000005b02", "2.000000");
    sell(store, presentationId, "018f0000-0000-7000-8000-000000005b03", "3.000000");

    const cut = store.traceLot(TENANT, BRANCH, presentationId, "L-TOPE", 2);
    expect(cut?.truncated).toBe(true);
    expect(cut?.outflows.map((o) => o.quantity)).toEqual(["1.000000", "2.000000"]);
    expect(cut?.quantityReceived).toBe("10.000000");

    const whole = store.traceLot(TENANT, BRANCH, presentationId, "L-TOPE", 3);
    expect(whole?.truncated).toBe(false);
    expect(whole?.outflows).toHaveLength(3);
  });
});

describe("herencia de lote al abrir una paca: lo que no da exacto no se inventa", () => {
  /**
   * El caso de uso comprueba que el TOTAL convertido sea exacto; un reparto
   * entre dos tandas puede no serlo. 0,000003 + 0,999997 de origen con factor
   * 0,5 dan cuotas de 0,0000015 y 0,4999985: ninguna cabe en escala 6. No se
   * redondea para fabricar un lote: esas unidades entran sin lote.
   */
  it("si la cuota de un lote no da exacta en escala 6, esas unidades entran sin lote", async () => {
    const { store, database, presentationId } = await buildEnv();
    const catalogStore = new SqliteCatalogStore(database, new DurableSyncStore(database), () => NOW);
    const target = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
      code: "ARROZ-MEDIA", name: "Arroz media libra", stockControlled: true,
      presentationName: "Media libra", unitCode: "LBR", unitPrecision: 6,
      barcode: "7709876543227", priceAmount: "1600.000000", currencyCode: "COP",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (target.kind !== "REGISTERED") throw new Error(`fixture failed: ${target.kind}`);

    for (const [lotCode, quantity, expiry] of [
      ["L-A", "0.000003", "2026-09-30"],
      ["L-B", "0.999997", "2026-12-31"],
    ] as const) {
      const r = store.receiveLot({
        scope: SCOPE, sessionId: SESSION, operatorUserId: USER, presentationId, lotCode, quantity,
        manufacturedDate: null, expiryDate: expiry, reasonCode: "SUPPLIER_DELIVERY",
        businessDate: "2026-09-07", idempotencyKey: key(), requestChecksum: "9".repeat(64),
        correlationId: CORRELATION, causationId: null,
      });
      expect(r.kind).toBe("RECEIVED");
    }

    const converted = store.applyConversion({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER,
      sourcePresentationId: presentationId, targetPresentationId: target.presentationId,
      sourceQuantity: "1.000000", targetQuantity: "0.500000",
      reasonCode: "BREAK_PACK", businessDate: "2026-09-07",
      idempotencyKey: key(), requestChecksum: "8".repeat(64),
      correlationId: CORRELATION, causationId: null,
    });
    expect(converted.kind).toBe("CONVERTED");

    // Las dos tandas de origen se consumieron; en destino no hay lote inventado.
    expect(database.native.prepare(
      "SELECT COUNT(*) n FROM inventory_lot WHERE tenant_id=? AND presentation_id=?",
    ).get(TENANT, target.presentationId)).toEqual({ n: 0 });
    expect(database.native.prepare(
      "SELECT quantity_on_hand FROM inventory_stock WHERE tenant_id=? AND presentation_id=?",
    ).get(TENANT, target.presentationId)).toEqual({ quantity_on_hand: "0.500000" });
  });
});

/**
 * «Próximo a vencer»: 7 días, decisión del propietario del 2026-09-26. La
 * frontera se fija exacta —el séptimo día cuenta, el octavo no— y también
 * donde el calendario se complica: fin de mes, fin de año y febrero bisiesto.
 */
describe("estado de vencimiento: la frontera de NEAR_EXPIRY", () => {
  it("el umbral por omisión es el del contrato, y el contrato dice 7", () => {
    expect(NEAR_EXPIRY_DAYS).toBe(7);
    expect(lotExpiryState("2026-09-29", "2026-09-22")).toBe("NEAR_EXPIRY");
    expect(lotExpiryState("2026-09-30", "2026-09-22")).toBe("VALID");
  });

  it.each([
    ["2026-09-21", "EXPIRED"],     // ayer
    ["2026-09-22", "NEAR_EXPIRY"], // hoy: se vende hoy, y avisa
    ["2026-09-29", "NEAR_EXPIRY"], // día 7: cuenta
    ["2026-09-30", "VALID"],       // día 8: no
  ])("con negocio el 2026-09-22, vencer el %s es %s", (expiry, state) => {
    expect(lotExpiryState(expiry, "2026-09-22", 7)).toBe(state);
  });

  it("cruza fin de año y febrero bisiesto sin correrse un día", () => {
    expect(lotExpiryState("2027-01-04", "2026-12-28", 7)).toBe("NEAR_EXPIRY");
    expect(lotExpiryState("2027-01-05", "2026-12-28", 7)).toBe("VALID");
    // 2028 es bisiesto: del 25 de febrero, 7 días son el 3 de marzo.
    expect(lotExpiryState("2028-03-03", "2028-02-25", 7)).toBe("NEAR_EXPIRY");
    expect(lotExpiryState("2028-03-04", "2028-02-25", 7)).toBe("VALID");
  });

  it("sin vencimiento declarado no es ninguno de los tres", () => {
    expect(lotExpiryState(null, "2026-09-22", 7)).toBe("NO_EXPIRY");
  });
});

describe("lo que vence esta semana: permiso, sucursal y tope", () => {
  function receiveIn(store: SqliteInventoryStore, scope: SyncScope, presentationId: string, code: string, expiry: string): void {
    const r = store.receiveLot({
      scope, sessionId: SESSION, operatorUserId: USER, presentationId, lotCode: code,
      quantity: "1.000000", manufacturedDate: null, expiryDate: expiry,
      reasonCode: "SUPPLIER_DELIVERY", businessDate: "2026-09-07", idempotencyKey: key(),
      requestChecksum: "7".repeat(64), correlationId: CORRELATION, causationId: null,
    });
    if (r.kind !== "RECEIVED") throw new Error(`fixture failed: ${r.kind}`);
  }

  it("sin permiso de leer existencia es UNAUTHORIZED", async () => {
    const { store } = await buildEnv();
    expect(new ListExpiringLotsUseCase(store)
      .execute(SCOPE, auth(["INVENTORY_STOCK_RECEIVE"]), "2026-09-07", NOW).kind).toBe("UNAUTHORIZED");
  });

  // Lo que vence en otra sucursal es existencia de otra sucursal.
  it("no lista tandas de otra sucursal", async () => {
    const { store, presentationId } = await buildEnv();
    receiveIn(store, { ...SCOPE, branchId: OTHER_BRANCH }, presentationId, "L-OTRA", "2026-09-08");
    receiveIn(store, SCOPE, presentationId, "L-PROPIA", "2026-09-08");
    const result = new ListExpiringLotsUseCase(store).execute(SCOPE, auth(), "2026-09-07", NOW);
    expect(result.kind).toBe("LISTED");
    if (result.kind !== "LISTED") return;
    expect(result.lots.map((lot) => lot.lotCode)).toEqual(["L-PROPIA"]);
  });

  it("con más tandas que el tope devuelve el tope y marca truncated", async () => {
    const { store, presentationId } = await buildEnv();
    for (const code of ["L-1", "L-2", "L-3"]) receiveIn(store, SCOPE, presentationId, code, "2026-09-08");
    const cut = store.listExpiringLots(TENANT, BRANCH, "2026-09-14", 2);
    expect(cut.lots).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    expect(store.listExpiringLots(TENANT, BRANCH, "2026-09-14", 3).truncated).toBe(false);
  });
});
