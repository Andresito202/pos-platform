import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import {
  CreateSaleUseCase,
  PRICING_PIPELINE_VERSION,
  TAX_POLICY_VERSION,
  ROUNDING_POLICY_VERSION,
} from "../src/sales/create-sale-use-case.js";
import { bigIntToScale6, scale6ToBigInt } from "../src/money.js";
import {
  nearestFiftyHalfAwayFromZero,
  quantityFitsUnitPrecision,
  calculateSaleLine,
  calculateSaleTotals,
} from "../src/sales/sale-calculation.js";
import { canonicalJson } from "../src/channel/canonical-json.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-sale-"));
  directories.push(value);
  return value;
}
/**
 * Bases abiertas por las pruebas. Se cierran **antes** de borrar el directorio.
 *
 * En Windows, `rmSync` sobre un `pos-local.db` todavía abierto falla con
 * `EBUSY` y enmascara la causa real —lo mismo que ya documentan
 * `payment.test.ts` y `session-assertion-verifier.test.ts`—. En Linux el
 * `unlink` de un archivo abierto funciona, así que el defecto sólo aparece en
 * el runner de Windows: exactamente lo que pasó en `b7b3628`.
 *
 * Cerrar aquí, y no en cada prueba, evita que la próxima que abra una base
 * tenga que acordarse.
 */
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Un cierre fallido no debe ocultar el fallo real de la prueba.
    }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

/** Abre una base rastreada: el `afterEach` la cierra. */
function openTracked(dataDirectory: string): LocalDatabase {
  const database = LocalDatabase.open({ dataDirectory });
  databases.push(database);
  return database;
}

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER_ID = "018f0000-0000-7000-8000-000000000006";
const SESSION_ID = "018f0000-0000-7000-8000-000000000007";
const OTHER_TENANT = "018f0000-0000-7000-8000-000000000099";

const PRODUCT_ID = "018f0000-0000-7000-8000-000000000010";
const PRESENTATION_ID = "018f0000-0000-7000-8000-000000000011";
const CORRELATION_ID = "018f0000-0000-7000-8000-0000000000c1";
const PRICE_RULE_ID = "018f0000-0000-7000-8000-000000000013";

const scope: SyncScope = {
  tenantId: TENANT,
  companyId: COMPANY,
  branchId: BRANCH,
  deviceId: DEVICE,
  installationId: INSTALL,
};

/** Snapshot de autorización SANDBOX con SALES_SALE_CREATE. */
function buildAuthSnapshot(
  userId = USER_ID,
  tenantId = TENANT,
  companyId = COMPANY,
  branchId = BRANCH,
): StoredAuthorizationSnapshot {
  const now = new Date("2026-09-05T00:00:00.000Z");
  const exp = new Date("2026-09-05T08:00:00.000Z");
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000a1",
    user_id: userId,
    installation_id: INSTALL,
    device_id: DEVICE,
    sequence: 1,
    issued_at: now.toISOString(),
    expires_at: exp.toISOString(),
    key_id: "AUTHZ_KEY_1",
    assignments: [
      {
        tenant_id: tenantId,
        company_id: companyId,
        branch_id: branchId,
        status: "ACTIVE",
        valid_from: now.toISOString(),
        valid_until: null,
        role_status: "ACTIVE",
        permissions: [{ code: "SALES_SALE_CREATE", status: "ACTIVE" }],
      },
    ],
  };
  return { claims, signature: "stub-signature", activatedAt: now.toISOString() };
}

function buildRequest(overrides: Partial<{
  idempotencyKey: string;
  documentSeries: string;
  lines: Array<{ productId: string; presentationId: string; quantity: string }>;
}> = {}): Parameters<CreateSaleUseCase["execute"]>[3] {
  return {
    // Las pruebas de Sales V1 no pasan por caja: su objeto es el cálculo y la
    // persistencia de la venta, no el arqueo.
    cashRegisterId: null,
    idempotencyKey: overrides.idempotencyKey ?? "sale:test:001",
    channel: "POS_LOCAL",
    businessDate: "2026-09-05",
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    documentSeries: overrides.documentSeries ?? "FS-001",
    currencyCode: "COP",
    correlationId: "018f0000-0000-7000-8000-000000000020",
    causationId: null,
    lines: overrides.lines ?? [
      { productId: PRODUCT_ID, presentationId: PRESENTATION_ID, quantity: "1.000000" },
    ],
  };
}

function buildStores(database: LocalDatabase): {
  catalog: SqliteCatalogStore;
  inventory: SqliteInventoryStore;
  saleStore: SqliteSaleStore;
  useCase: CreateSaleUseCase;
} {
  const at = (): Date => new Date("2026-09-05T10:00:00.000Z");
  const durableSync = new DurableSyncStore(database);
  const catalog = new SqliteCatalogStore(database, durableSync);
  const inventory = new SqliteInventoryStore(database, durableSync, at);
  const cashStore = new SqliteCashShiftStore(database, durableSync, at);
  const saleStore = new SqliteSaleStore(database, durableSync, at);
  const useCase = new CreateSaleUseCase(catalog, inventory, cashStore, saleStore, at);
  return { catalog, inventory, saleStore, useCase };
}

/**
 * Inserta el catálogo de prueba con identificadores fijos.
 *
 * No usa `SqliteCatalogStore.register`: ese caso de uso genera los UUID, y las
 * pruebas necesitan referirse al mismo producto y a la misma presentación desde
 * la petición de venta. Es un fixture, y por eso escribe directo.
 */
function insertFixture(
  database: LocalDatabase,
  amount = "1000.000000",
  tenantId = TENANT,
  taxRate: string | null = null,
  unitPrecision = 0,
  stockControlled = false,
): void {
  const at = "2026-09-01T00:00:00.000Z";
  database.native.prepare(
    `INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,'CAFE-001','Café Americano','ACTIVE',?,?,?,?,1,?,?)`,
  ).run(
    PRODUCT_ID, tenantId, COMPANY, stockControlled ? 1 : 0,
    USER_ID, `fixture:${tenantId}`, CORRELATION_ID, at, at,
  );

  database.native.prepare(
    `INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Unidad','UND',?,?,'ACTIVE',?,?)`,
  ).run(PRESENTATION_ID, tenantId, PRODUCT_ID, unitPrecision, `770000000000${tenantId.slice(-1)}`, at, at);

  database.native.prepare(
    `INSERT INTO catalog_price(
      id, tenant_id, presentation_id, amount, currency_code, status, created_at, updated_at
    ) VALUES (?,?,?,?,'COP','ACTIVE',?,?)`,
  ).run(PRICE_RULE_ID, tenantId, PRESENTATION_ID, amount, at, at);

  if (taxRate !== null) {
    database.native.prepare(
      `INSERT INTO catalog_fiscal_attribute(
        tenant_id, presentation_id, code_reference, unit_measure_code,
        standard_code, tax_code, tax_rate, status, created_at, updated_at
      ) VALUES (?,?,'SKU-CAFE-001','94','999','01',?,'ACTIVE',?,?)`,
    ).run(tenantId, PRESENTATION_ID, taxRate, at, at);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// UNIT: sale-calculation
// ────────────────────────────────────────────────────────────────────────────

describe("scale6ToBigInt and bigIntToScale6", () => {
  it("converts correctly", () => {
    expect(scale6ToBigInt("1000.000000")).toBe(1_000_000_000n);
    expect(scale6ToBigInt("0.000000")).toBe(0n);
    expect(scale6ToBigInt("1.500000")).toBe(1_500_000n);
    expect(bigIntToScale6(1_000_000_000n)).toBe("1000.000000");
    expect(bigIntToScale6(0n)).toBe("0.000000");
    expect(bigIntToScale6(1_500_000n)).toBe("1.500000");
    expect(bigIntToScale6(-25_000_000n)).toBe("-25.000000");
  });

  it("rejects invalid format", () => {
    expect(() => scale6ToBigInt("1000")).toThrow();
    expect(() => scale6ToBigInt("1000.00000")).toThrow();
    expect(() => scale6ToBigInt("1000.1234567")).toThrow();
    expect(() => scale6ToBigInt("mil")).toThrow();
  });

  /**
   * El negativo **sí** es forma canónica, y antes no lo era.
   *
   * `commercial_rounding_adjustment` es el único campo firmado del esquema y su
   * `CHECK` tiene una rama `OR` explícita para `-[0-9]*.[0-9]{6}`:
   * `bigIntToScale6` emite ese valor, la base lo acepta y lo guarda. Con la
   * versión anterior, **leerlo de vuelta lanzaba**. La aserción que exigía ese
   * fallo codificaba el defecto, no un guardián.
   */
  it("la ida y la vuelta cierran, también en negativo", () => {
    for (const units of [0n, 1n, -1n, 50_000_000n, -50_000_000n, 18_000_000_000n]) {
      expect(scale6ToBigInt(bigIntToScale6(units))).toBe(units);
    }
  });
});

describe("nearestFiftyHalfAwayFromZero", () => {
  const SCALE = 1_000_000n;

  it("rounds to nearest 50", () => {
    // 1025 → 1050
    expect(nearestFiftyHalfAwayFromZero(1025n * SCALE)).toBe(1050n * SCALE);
    // 1074 → 1050
    expect(nearestFiftyHalfAwayFromZero(1074n * SCALE)).toBe(1050n * SCALE);
    // 1075 → 1100 (half away from zero)
    expect(nearestFiftyHalfAwayFromZero(1075n * SCALE)).toBe(1100n * SCALE);
    // 1050 → 1050 (already a multiple)
    expect(nearestFiftyHalfAwayFromZero(1050n * SCALE)).toBe(1050n * SCALE);
    // 0 → 0
    expect(nearestFiftyHalfAwayFromZero(0n)).toBe(0n);
    // 25 → 50 (half away from zero: ties round away)
    expect(nearestFiftyHalfAwayFromZero(25n * SCALE)).toBe(50n * SCALE);
  });

  it("handles negative values", () => {
    // -1025 → -1050
    expect(nearestFiftyHalfAwayFromZero(-1025n * SCALE)).toBe(-1050n * SCALE);
    // -1074 → -1050
    expect(nearestFiftyHalfAwayFromZero(-1074n * SCALE)).toBe(-1050n * SCALE);
    // -1075 → -1100 (half away from zero)
    expect(nearestFiftyHalfAwayFromZero(-1075n * SCALE)).toBe(-1100n * SCALE);
    // -25 → -50 (half away from zero)
    expect(nearestFiftyHalfAwayFromZero(-25n * SCALE)).toBe(-50n * SCALE);
  });
});

describe("calculateSaleLine", () => {
  it("computes correctly for 1 unit at 1000 COP", () => {
    const result = calculateSaleLine("1000.000000", "1.000000");
    expect(result.unitPriceUnits).toBe(1_000_000_000n);
    expect(result.quantityUnits).toBe(1_000_000n);
    expect(result.grossUnits).toBe(1_000_000_000n);
    expect(result.discountUnits).toBe(0n);
    expect(result.taxableUnits).toBe(1_000_000_000n);
    expect(result.taxUnits).toBe(0n);
    expect(result.lineTotalUnits).toBe(1_000_000_000n);
  });

  it("computes correctly for 2 units at 1000 COP", () => {
    const result = calculateSaleLine("1000.000000", "2.000000");
    expect(result.grossUnits).toBe(2_000_000_000n);
  });
});

describe("calculateSaleTotals", () => {
  it("computes totals with NEAREST_50 rounding", () => {
    // fiscal_total = 1025, payable = 1050, rounding = +25
    const line = calculateSaleLine("1025.000000", "1.000000");
    const totals = calculateSaleTotals([line]);
    expect(totals.fiscalTotalUnits).toBe(1_025_000_000n);
    expect(totals.payableUnits).toBe(1_050_000_000n);
    expect(totals.commercialRoundingAdjustmentUnits).toBe(25_000_000n);
  });

  it("applies negative rounding when fiscal_total closer to lower multiple", () => {
    // fiscal_total = 1074, payable = 1050, rounding = -24
    const line = calculateSaleLine("1074.000000", "1.000000");
    const totals = calculateSaleTotals([line]);
    expect(totals.fiscalTotalUnits).toBe(1_074_000_000n);
    expect(totals.payableUnits).toBe(1_050_000_000n);
    expect(totals.commercialRoundingAdjustmentUnits).toBe(-24_000_000n);
  });

  it("no rounding when fiscal_total is already a multiple of 50", () => {
    const line = calculateSaleLine("1050.000000", "1.000000");
    const totals = calculateSaleTotals([line]);
    expect(totals.payableUnits).toBe(1_050_000_000n);
    expect(totals.commercialRoundingAdjustmentUnits).toBe(0n);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// INTEGRATION: CreateSaleUseCase
// ────────────────────────────────────────────────────────────────────────────

describe("CreateSaleUseCase", () => {
  it("creates a sale atomically: sale, items, counter, outbox and audit in one commit", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database, "1025.000000");

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") return;

    expect(result.saleNumber).toBe(1);
    expect(result.payableAmount).toBe("1050.000000");
    expect(result.calculationChecksum).toHaveLength(64);

    // Verifica sale en base de datos
    const saleRow = database.native.prepare(
      "SELECT status, sale_number, payable_amount, operator_actor_type, operator_actor_id FROM sales_sales WHERE id=?",
    ).get(result.saleId) as {
      status: string;
      sale_number: number;
      payable_amount: string;
      operator_actor_type: string;
      operator_actor_id: string;
    };
    expect(saleRow.status).toBe("READY_FOR_PAYMENT");
    expect(saleRow.sale_number).toBe(1);
    expect(saleRow.payable_amount).toBe("1050.000000");
    expect(saleRow.operator_actor_type).toBe("USER");
    expect(saleRow.operator_actor_id).toBe(USER_ID);

    // Verifica item
    const itemRow = database.native.prepare(
      "SELECT line_number, product_id, unit_price_amount, gross_amount, tax_amount, line_total_amount FROM sales_sale_items WHERE sale_id=?",
    ).get(result.saleId) as {
      line_number: number;
      product_id: string;
      unit_price_amount: string;
      gross_amount: string;
      tax_amount: string;
      line_total_amount: string;
    };
    expect(itemRow.line_number).toBe(1);
    expect(itemRow.product_id).toBe(PRODUCT_ID);
    expect(itemRow.unit_price_amount).toBe("1025.000000");
    expect(itemRow.gross_amount).toBe("1025.000000");
    expect(itemRow.tax_amount).toBe("0.000000");
    expect(itemRow.line_total_amount).toBe("1025.000000");

    // Verifica counter
    const counterRow = database.native.prepare(
      "SELECT last_number FROM sales_document_series_counter WHERE tenant_id=? AND branch_id=? AND series=?",
    ).get(TENANT, BRANCH, "FS-001") as { last_number: number };
    expect(counterRow.last_number).toBe(1);

    // Verifica outbox
    const outboxRow = database.native.prepare(
      "SELECT status, operation_type FROM local_sync_outbox WHERE tenant_id=? AND idempotency_key=?",
    ).get(TENANT, "sale:test:001") as { status: string; operation_type: string };
    expect(outboxRow.status).toBe("PENDING");
    expect(outboxRow.operation_type).toBe("SALE_CREATED");

    // Verifica auditoría
    const auditRow = database.native.prepare(
      "SELECT actor_type, actor_id, action_code, resource_id FROM local_operation_audit WHERE resource_id=?",
    ).get(result.saleId) as { actor_type: string; actor_id: string; action_code: string; resource_id: string };
    expect(auditRow.actor_type).toBe("USER");
    expect(auditRow.actor_id).toBe(USER_ID);
    expect(auditRow.action_code).toBe("SALE_CREATED");

    database.close();
  });

  it("returns IDEMPOTENT for the same idempotency_key + same checksum", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database, "1025.000000");

    const authSnapshot = buildAuthSnapshot();
    const request = buildRequest();

    const first = useCase.execute(scope, SESSION_ID, authSnapshot, request);
    expect(first.kind).toBe("CREATED");

    const second = useCase.execute(scope, SESSION_ID, authSnapshot, request);
    expect(second.kind).toBe("IDEMPOTENT");
    if (second.kind !== "IDEMPOTENT") return;

    // El segundo retorna el mismo saleId
    if (first.kind === "CREATED") {
      expect(second.saleId).toBe(first.saleId);
      expect(second.saleNumber).toBe(first.saleNumber);
    }

    // No se crea una segunda venta
    const count = (database.native.prepare(
      "SELECT COUNT(*) AS c FROM sales_sales WHERE tenant_id=?",
    ).get(TENANT) as { c: number }).c;
    expect(count).toBe(1);

    database.close();
  });

  it("returns IDEMPOTENCY_CONFLICT for same key but different request content", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database, "1025.000000");

    const authSnapshot = buildAuthSnapshot();
    const firstRequest = buildRequest({ idempotencyKey: "conflict-key" });
    const secondRequest = buildRequest({
      idempotencyKey: "conflict-key",
      documentSeries: "FS-999", // misma clave, distinto payload
    });

    const first = useCase.execute(scope, SESSION_ID, authSnapshot, firstRequest);
    expect(first.kind).toBe("CREATED");

    const second = useCase.execute(scope, SESSION_ID, authSnapshot, secondRequest);
    expect(second.kind).toBe("IDEMPOTENCY_CONFLICT");

    database.close();
  });

  it("returns UNAUTHORIZED when user lacks SALES_SALE_CREATE permission", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database);

    const now = new Date("2026-09-05T00:00:00.000Z");
    const exp = new Date("2026-09-05T08:00:00.000Z");
    const noPermSnapshot: StoredAuthorizationSnapshot = {
      claims: {
        snapshot_id: "018f0000-0000-7000-8000-0000000000b1",
        user_id: USER_ID,
        installation_id: INSTALL,
        device_id: DEVICE,
        sequence: 1,
        issued_at: now.toISOString(),
        expires_at: exp.toISOString(),
        key_id: "AUTHZ_KEY_1",
        assignments: [
          {
            tenant_id: TENANT,
            company_id: COMPANY,
            branch_id: BRANCH,
            status: "ACTIVE",
            valid_from: now.toISOString(),
            valid_until: null,
            role_status: "ACTIVE",
            permissions: [], // sin permisos
          },
        ],
      },
      signature: "stub",
      activatedAt: now.toISOString(),
    };

    const result = useCase.execute(scope, SESSION_ID, noPermSnapshot, buildRequest());
    expect(result.kind).toBe("UNAUTHORIZED");

    database.close();
  });

  it("returns CATALOG_NOT_FOUND when product does not exist", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    // No insertamos fixture

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("CATALOG_NOT_FOUND");

    database.close();
  });

  it("returns PRICE_NOT_FOUND when no active price for presentation", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);

    // Producto y presentación sin precio activo: la venta debe rechazarse.
    const at = "2026-09-01T00:00:00.000Z";
    database.native.prepare(
      `INSERT INTO catalog_product(
        id, tenant_id, company_id, code, name, status, stock_controlled,
        registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
      ) VALUES (?,?,?,'SIN-PRECIO','Test','ACTIVE',0,?,'fixture:sin-precio',?,1,?,?)`,
    ).run(PRODUCT_ID, TENANT, COMPANY, USER_ID, CORRELATION_ID, at, at);
    database.native.prepare(
      `INSERT INTO catalog_presentation(
        id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
        status, created_at, updated_at
      ) VALUES (?,?,?,'Unidad','UND',0,NULL,'ACTIVE',?,?)`,
    ).run(PRESENTATION_ID, TENANT, PRODUCT_ID, at, at);

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("PRICE_NOT_FOUND");

    database.close();
  });

  it("enforces cross-tenant isolation: fixture in OTHER_TENANT is invisible to TENANT", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);

    // Fixture para OTHER_TENANT
    insertFixture(database, "1000.000000", OTHER_TENANT);

    const authSnapshot = buildAuthSnapshot();
    // La venta se crea en TENANT pero el catálogo solo existe en OTHER_TENANT
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("CATALOG_NOT_FOUND");

    database.close();
  });

  it("increments sale counter monotonically for the same series", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database, "1000.000000");

    const authSnapshot = buildAuthSnapshot();

    const r1 = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest({ idempotencyKey: "sale-001" }));
    const r2 = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest({ idempotencyKey: "sale-002" }));
    const r3 = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest({ idempotencyKey: "sale-003" }));

    expect(r1.kind).toBe("CREATED");
    expect(r2.kind).toBe("CREATED");
    expect(r3.kind).toBe("CREATED");
    if (r1.kind === "CREATED") expect(r1.saleNumber).toBe(1);
    if (r2.kind === "CREATED") expect(r2.saleNumber).toBe(2);
    if (r3.kind === "CREATED") expect(r3.saleNumber).toBe(3);

    database.close();
  });

  it("calculation checksum is deterministic for same inputs", async () => {
    const dir1 = await directory();
    const dir2 = await directory();
    const db1 = openTracked(dir1);
    const db2 = openTracked(dir2);

    const stores1 = buildStores(db1);
    const stores2 = buildStores(db2);
    insertFixture(db1, "1025.000000");
    insertFixture(db2, "1025.000000");

    const authSnapshot = buildAuthSnapshot();
    const r1 = stores1.useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest({ idempotencyKey: "chk-001" }));
    const r2 = stores2.useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest({ idempotencyKey: "chk-001" }));

    expect(r1.kind).toBe("CREATED");
    expect(r2.kind).toBe("CREATED");
    if (r1.kind === "CREATED" && r2.kind === "CREATED") {
      expect(r1.calculationChecksum).toBe(r2.calculationChecksum);
    }

    db1.close();
    db2.close();
  });

  it("canonical-json uses code point order, not locale order", () => {
    // 'a' < 'b' < 'z' < '{' in code points — localeCompare can differ
    // Verificamos que las claves se ordenen por code point
    const result = canonicalJson({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("rounding policy version is frozen in calculation_checksum", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(database, "1025.000000");

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") return;

    const saleRow = database.native.prepare(
      "SELECT rounding_policy_version, tax_policy_version, pricing_pipeline_version FROM sales_sales WHERE id=?",
    ).get(result.saleId) as {
      rounding_policy_version: string;
      tax_policy_version: string;
      pricing_pipeline_version: string;
    };
    expect(saleRow.rounding_policy_version).toBe(ROUNDING_POLICY_VERSION);
    expect(saleRow.tax_policy_version).toBe(TAX_POLICY_VERSION);
    expect(saleRow.pricing_pipeline_version).toBe(PRICING_PIPELINE_VERSION);

    database.close();
  });
});


// ────────────────────────────────────────────────────────────────────────────
// Impuesto por línea — `D-9`
// ────────────────────────────────────────────────────────────────────────────

/**
 * Hasta ahora `calculateSaleLine` devolvía `taxUnits: 0n` fijo, con el
 * comentario «SANDBOX Tax EXCLUDED: siempre 0». Estas pruebas fijan las dos
 * cosas que cambian: que el impuesto se calcula de verdad cuando el catálogo
 * declara una tasa, y que **cuando no la declara el cero queda marcado como
 * desconocimiento, no como exención**.
 */

describe("calculateSaleLine — impuesto", () => {
  it("sin tasa el impuesto es cero y el total de línea es la base", () => {
    const line = calculateSaleLine("18000.000000", "2.000000");
    expect(bigIntToScale6(line.taxableUnits)).toBe("36000.000000");
    expect(bigIntToScale6(line.taxUnits)).toBe("0.000000");
    expect(bigIntToScale6(line.lineTotalUnits)).toBe("36000.000000");
  });

  it("con el 19 % calcula el impuesto y lo suma al total de línea", () => {
    const line = calculateSaleLine("18000.000000", "2.000000", "19.000000");
    expect(bigIntToScale6(line.taxUnits)).toBe("6840.000000");
    expect(bigIntToScale6(line.lineTotalUnits)).toBe("42840.000000");
  });

  it("con el 8 % del INC también", () => {
    const line = calculateSaleLine("10000.000000", "1.000000", "8.000000");
    expect(bigIntToScale6(line.taxUnits)).toBe("800.000000");
  });

  it("una tasa del 0 % es distinta de no tener tasa sólo en el snapshot, no en el importe", () => {
    expect(bigIntToScale6(calculateSaleLine("100.000000", "1.000000", "0.000000").taxUnits))
      .toBe("0.000000");
  });

  /** Sin coma flotante: el resultado es exacto y se trunca, nunca se redondea. */
  it("trunca a escala 6 en vez de redondear", () => {
    // 0,333333 % de 100 = 0,333333 → 0,000333 tras dividir por 100
    const line = calculateSaleLine("100.000000", "1.000000", "0.330000");
    expect(bigIntToScale6(line.taxUnits)).toBe("0.330000");
  });
});

describe("venta con impuesto — extremo a extremo", () => {
  it("congela la tasa aplicada en el snapshot de la línea", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, useCase } = buildStores(database);
    insertFixture(database, "1000.000000", TENANT, "19.000000");

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());
    expect(result.kind).toBe("CREATED");

    const row = database.native.prepare(
      "SELECT taxable_amount, tax_amount, line_total_amount, tax_calculation_snapshot FROM sales_sale_items",
    ).get() as {
      taxable_amount: string; tax_amount: string;
      line_total_amount: string; tax_calculation_snapshot: string;
    };

    expect(row.taxable_amount).toBe("1000.000000");
    expect(row.tax_amount).toBe("190.000000");
    expect(row.line_total_amount).toBe("1190.000000");

    const snapshot = JSON.parse(row.tax_calculation_snapshot) as Record<string, unknown>;
    expect(snapshot["model"]).toBe("RATE_APPLIED");
    expect(snapshot["tax_code"]).toBe("01");
    expect(snapshot["rate"]).toBe("19.000000");
    expect(snapshot["tax_amount"]).toBe("190.000000");
  });

  /**
   * La afirmación central del bloque: un cero sin atributos fiscales **no dice
   * «exento»**. Emitir una factura desde una línea así declararía exento algo
   * que nadie ha declarado exento.
   */
  it("sin atributos fiscales el cero queda marcado como desconocimiento", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, useCase } = buildStores(database);
    insertFixture(database, "1000.000000");

    useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());

    const row = database.native.prepare(
      "SELECT tax_amount, tax_calculation_snapshot FROM sales_sale_items",
    ).get() as { tax_amount: string; tax_calculation_snapshot: string };

    expect(row.tax_amount).toBe("0.000000");
    const snapshot = JSON.parse(row.tax_calculation_snapshot) as Record<string, unknown>;
    expect(snapshot["model"]).toBe("NO_FISCAL_ATTRIBUTES");
    expect(snapshot).not.toHaveProperty("rate");
  });

  it("la venta cuenta cuántas líneas quedaron sin atributos fiscales", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { catalog, useCase } = buildStores(database);
    insertFixture(database, "1000.000000");

    useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());

    const row = database.native.prepare(
      "SELECT tax_snapshot FROM sales_sales",
    ).get() as { tax_snapshot: string };
    const snapshot = JSON.parse(row.tax_snapshot) as Record<string, unknown>;

    expect(snapshot["lines_without_fiscal_attributes"]).toBe(1);
    // El snapshot de la venta ya no afirma una tasa única: sería falso en cuanto
    // hubiera dos tipos impositivos en la misma factura.
    expect(snapshot).not.toHaveProperty("rate");
    expect(snapshot).not.toHaveProperty("category");
  });
});

describe("MIGRATION_013 — la tasa lleva sus restricciones en disco", () => {
  const insertRate = (database: LocalDatabase, rate: string): void => {
    database.native.prepare(
      `INSERT INTO catalog_fiscal_attribute(
        tenant_id, presentation_id, code_reference, unit_measure_code,
        standard_code, tax_code, tax_rate, status, created_at, updated_at
      ) VALUES (?,?,'SKU-1','94','999','01',?,'ACTIVE','t','t')`,
    ).run(TENANT, PRESENTATION_ID, rate);
  };

  it("acepta una tasa con dos decimales", async () => {
    const database = openTracked(await directory());
    expect(() => { insertRate(database, "19.000000"); }).not.toThrow();
  });

  /** `D-14` impuesto desde el origen: una tasa DIAN no tiene más de dos decimales. */
  it("rechaza una tasa con más de dos decimales significativos", async () => {
    const database = openTracked(await directory());
    expect(() => { insertRate(database, "19.005000"); }).toThrow();
  });

  it("rechaza una tasa mayor que 100, que no es un impuesto sino un error de captura", async () => {
    const database = openTracked(await directory());
    expect(() => { insertRate(database, "190.000000"); }).toThrow();
  });

  it("acepta el 100 exacto, que es el límite y no un error", async () => {
    const database = openTracked(await directory());
    expect(() => { insertRate(database, "100.000000"); }).not.toThrow();
  });

  it("rechaza una tasa que no es escala 6", async () => {
    const database = openTracked(await directory());
    expect(() => { insertRate(database, "19.00"); }).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Precisión de la unidad — seguridad del dinero
// ────────────────────────────────────────────────────────────────────────────

/**
 * `unit_precision` existía en el catálogo, se arrastraba hasta el snapshot de la
 * línea y **no gobernaba nada**. El contrato IPC acepta cualquier escala 6
 * porque no ve el catálogo, así que se podía vender `0.000001` de una botella y
 * cobrarlo. Comprobado con sonda antes de escribir la regla.
 */

describe("quantityFitsUnitPrecision", () => {
  it("una unidad discreta (precisión 0) sólo admite enteros", () => {
    expect(quantityFitsUnitPrecision("1.000000", 0)).toBe(true);
    expect(quantityFitsUnitPrecision("12.000000", 0)).toBe(true);
    expect(quantityFitsUnitPrecision("0.500000", 0)).toBe(false);
    expect(quantityFitsUnitPrecision("0.000001", 0)).toBe(false);
  });

  it("un peso (precisión 3) admite tres decimales y no seis", () => {
    expect(quantityFitsUnitPrecision("0.333000", 3)).toBe(true);
    expect(quantityFitsUnitPrecision("1.250000", 3)).toBe(true);
    expect(quantityFitsUnitPrecision("0.333333", 3)).toBe(false);
  });

  it("con precisión 6 todo cabe, que es el máximo de la escala", () => {
    expect(quantityFitsUnitPrecision("0.333333", 6)).toBe(true);
  });
});

describe("venta — la cantidad respeta la precisión de la unidad", () => {
  it("rechaza media botella cuando la unidad es discreta", async () => {
    const database = openTracked(await directory());
    const { catalog, useCase } = buildStores(database);
    insertFixture(database);

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), {
      ...buildRequest(),
      lines: [{ productId: PRODUCT_ID, presentationId: PRESENTATION_ID, quantity: "0.500000" }],
    });

    expect(result.kind).toBe("QUANTITY_PRECISION_EXCEEDED");
    if (result.kind !== "QUANTITY_PRECISION_EXCEEDED") throw new Error("estados");
    expect(result.unitPrecision).toBe(0);
  });

  /** La cantidad imposible no debe llegar a multiplicarse por ningún precio. */
  it("y no deja ni venta ni línea en la base", async () => {
    const database = openTracked(await directory());
    const { catalog, useCase } = buildStores(database);
    insertFixture(database);

    useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), {
      ...buildRequest(),
      lines: [{ productId: PRODUCT_ID, presentationId: PRESENTATION_ID, quantity: "0.000001" }],
    });

    expect((database.native.prepare("SELECT count(*) AS n FROM sales_sales")
      .get() as { n: number }).n).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM sales_sale_items")
      .get() as { n: number }).n).toBe(0);
  });

  it("acepta la cantidad entera de siempre", async () => {
    const database = openTracked(await directory());
    const { catalog, useCase } = buildStores(database);
    insertFixture(database);

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());
    expect(result.kind).toBe("CREATED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// INTEGRATION: disponibilidad al crear la venta
// ────────────────────────────────────────────────────────────────────────────

describe("CreateSaleUseCase y la existencia", () => {
  /** Da entrada a existencia sin pasar por el caso de uso: aquí es un fixture. */
  function seedStock(inventory: SqliteInventoryStore, quantity: string): void {
    const outcome = inventory.appendMovementInTransaction({
      scope,
      sessionId: SESSION_ID,
      operatorUserId: USER_ID,
      movementId: "018f0000-0000-7000-8000-0000000000d1",
      operationId: "018f0000-0000-7000-8000-0000000000d2",
      presentationId: PRESENTATION_ID,
      movementType: "OPENING_COUNT",
      quantity,
      reasonCode: "FIXTURE",
      saleId: null,
      businessDate: "2026-09-05",
      idempotencyKey: `fixture-stock:${quantity}`,
      requestChecksum: "f".repeat(64),
      correlationId: "018f0000-0000-7000-8000-000000000020",
      causationId: null,
    });
    if (outcome.kind !== "POSTED") throw new Error(`stock fixture failed: ${outcome.kind}`);
  }

  it("un producto sin control de existencia se vende aunque no haya inventario", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { useCase } = buildStores(database);
    insertFixture(database);

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());
    expect(result.kind).toBe("CREATED");
  });

  it("rechaza la venta de un producto controlado sin existencia", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { useCase } = buildStores(database);
    insertFixture(database, "1000.000000", TENANT, null, 0, true);

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());

    expect(result.kind).toBe("INSUFFICIENT_STOCK");
    if (result.kind !== "INSUFFICIENT_STOCK") return;
    expect(result.available).toBe("0.000000");
    expect(result.requested).toBe("1.000000");
    expect(result.presentationId).toBe(PRESENTATION_ID);
  });

  it("la acepta cuando hay existencia suficiente", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { inventory, useCase } = buildStores(database);
    insertFixture(database, "1000.000000", TENANT, null, 0, true);
    seedStock(inventory, "5.000000");

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());
    expect(result.kind).toBe("CREATED");
  });

  /**
   * La comprobación es por **total pedido**, no por línea. Con 3 en existencia
   * y dos líneas de 2, comprobar cada línea por separado dejaría pasar la venta
   * y el descuento posterior encontraría existencia negativa.
   */
  it("suma las líneas de la misma presentación antes de comparar", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { inventory, useCase } = buildStores(database);
    insertFixture(database, "1000.000000", TENANT, null, 0, true);
    seedStock(inventory, "3.000000");

    const result = useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest({
      lines: [
        { productId: PRODUCT_ID, presentationId: PRESENTATION_ID, quantity: "2.000000" },
        { productId: PRODUCT_ID, presentationId: PRESENTATION_ID, quantity: "2.000000" },
      ],
    }));

    expect(result.kind).toBe("INSUFFICIENT_STOCK");
    if (result.kind !== "INSUFFICIENT_STOCK") return;
    expect(result.requested).toBe("4.000000");
    expect(result.available).toBe("3.000000");
  });

  it("la venta rechazada no deja venta ni movimiento", async () => {
    const dir = await directory();
    const database = openTracked(dir);
    const { useCase } = buildStores(database);
    insertFixture(database, "1000.000000", TENANT, null, 0, true);

    useCase.execute(scope, SESSION_ID, buildAuthSnapshot(), buildRequest());

    const sales = database.native.prepare(
      "SELECT COUNT(*) AS total FROM sales_sales WHERE tenant_id=?",
    ).get(TENANT) as { total: number };
    const movements = database.native.prepare(
      "SELECT COUNT(*) AS total FROM inventory_movement WHERE tenant_id=?",
    ).get(TENANT) as { total: number };

    expect(sales.total).toBe(0);
    expect(movements.total).toBe(0);
  });
});
