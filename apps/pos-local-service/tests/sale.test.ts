import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SandboxCatalogStore } from "../src/sales/sandbox-catalog-store.js";
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
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

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
const UNIT_ID = "018f0000-0000-7000-8000-000000000012";
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
  catalog: SandboxCatalogStore;
  saleStore: SqliteSaleStore;
  useCase: CreateSaleUseCase;
} {
  const durableSync = new DurableSyncStore(database);
  const catalog = new SandboxCatalogStore(database);
  const saleStore = new SqliteSaleStore(database, durableSync, () => new Date("2026-09-05T10:00:00.000Z"));
  const useCase = new CreateSaleUseCase(catalog, saleStore, () => new Date("2026-09-05T10:00:00.000Z"));
  return { catalog, saleStore, useCase };
}

function insertFixture(
  catalog: SandboxCatalogStore,
  amount = "1000.000000",
  tenantId = TENANT,
  taxRate: string | null = null,
): void {
  catalog.insertFixture(
    {
      id: PRODUCT_ID,
      tenant_id: tenantId,
      company_id: COMPANY,
      branch_id: BRANCH,
      name: "Café Americano",
      status: "ACTIVE",
      stock_controlled: false,
    },
    {
      id: PRESENTATION_ID,
      tenant_id: tenantId,
      product_id: PRODUCT_ID,
      name: "Unidad",
      unit_id: UNIT_ID,
      unit_code: "UND",
      unit_precision: 0,
      status: "ACTIVE",
    },
    {
      id: PRICE_RULE_ID,
      tenant_id: tenantId,
      presentation_id: PRESENTATION_ID,
      amount,
      currency_code: "COP",
      status: "ACTIVE",
    },
    taxRate === null
      ? undefined
      : {
          presentation_id: PRESENTATION_ID,
          code_reference: "SKU-CAFE-001",
          unit_measure_code: "94",
          standard_code: "999",
          tax_code: "01",
          tax_rate: taxRate,
        },
  );
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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog, "1025.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog, "1025.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog, "1025.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog);

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    // No insertamos fixture

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("CATALOG_NOT_FOUND");

    database.close();
  });

  it("returns PRICE_NOT_FOUND when no active price for presentation", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);

    // Insertamos solo producto y presentación, sin precio
    database.native.prepare(
      `INSERT INTO sandbox_catalog_product(id,tenant_id,company_id,branch_id,name,status,stock_controlled)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(PRODUCT_ID, TENANT, COMPANY, BRANCH, "Test", "ACTIVE", 0);
    database.native.prepare(
      `INSERT INTO sandbox_catalog_presentation(id,tenant_id,product_id,name,unit_id,unit_code,unit_precision,status)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(PRESENTATION_ID, TENANT, PRODUCT_ID, "Unidad", UNIT_ID, "UND", 0, "ACTIVE");

    const authSnapshot = buildAuthSnapshot();
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("PRICE_NOT_FOUND");

    database.close();
  });

  it("enforces cross-tenant isolation: fixture in OTHER_TENANT is invisible to TENANT", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);

    // Fixture para OTHER_TENANT
    insertFixture(catalog, "1000.000000", OTHER_TENANT);

    const authSnapshot = buildAuthSnapshot();
    // La venta se crea en TENANT pero el catálogo solo existe en OTHER_TENANT
    const result = useCase.execute(scope, SESSION_ID, authSnapshot, buildRequest());
    expect(result.kind).toBe("CATALOG_NOT_FOUND");

    database.close();
  });

  it("increments sale counter monotonically for the same series", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog, "1000.000000");

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
    const db1 = LocalDatabase.open({ dataDirectory: dir1 });
    const db2 = LocalDatabase.open({ dataDirectory: dir2 });

    const stores1 = buildStores(db1);
    const stores2 = buildStores(db2);
    insertFixture(stores1.catalog, "1025.000000");
    insertFixture(stores2.catalog, "1025.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, saleStore, useCase } = buildStores(database);
    insertFixture(catalog, "1025.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, useCase } = buildStores(database);
    insertFixture(catalog, "1000.000000", TENANT, "19.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, useCase } = buildStores(database);
    insertFixture(catalog, "1000.000000");

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
    const database = LocalDatabase.open({ dataDirectory: dir });
    const { catalog, useCase } = buildStores(database);
    insertFixture(catalog, "1000.000000");

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
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    expect(() => { insertRate(database, "19.000000"); }).not.toThrow();
  });

  /** `D-14` impuesto desde el origen: una tasa DIAN no tiene más de dos decimales. */
  it("rechaza una tasa con más de dos decimales significativos", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    expect(() => { insertRate(database, "19.005000"); }).toThrow();
  });

  it("rechaza una tasa mayor que 100, que no es un impuesto sino un error de captura", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    expect(() => { insertRate(database, "190.000000"); }).toThrow();
  });

  it("acepta el 100 exacto, que es el límite y no un error", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    expect(() => { insertRate(database, "100.000000"); }).not.toThrow();
  });

  it("rechaza una tasa que no es escala 6", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    expect(() => { insertRate(database, "19.00"); }).toThrow();
  });
});
