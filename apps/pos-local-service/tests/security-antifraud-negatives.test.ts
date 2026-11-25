/**
 * Antifraud negatives for gaps not already covered by payment/cash/sale/inventory suites.
 * Does not re-run approved happy-path coverage from those files.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const OTHER_COMPANY = "018f0000-0000-7000-8000-000000000092";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const OTHER_REGISTER = "018f0000-0000-7000-8000-00000000aa99";
const PRODUCT = "018f0000-0000-7000-8000-0000000000a1";
const PRESENTATION = "018f0000-0000-7000-8000-0000000000a2";
const PRICE = "018f0000-0000-7000-8000-0000000000a3";
const CORRELATION = "018f0000-0000-7000-8000-0000000000c1";

const SCOPE: SyncScope = {
  tenantId: TENANT,
  companyId: COMPANY,
  branchId: BRANCH,
  deviceId: DEVICE,
  installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const directories: string[] = [];
const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      /* ignore */
    }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[]): StoredAuthorizationSnapshot {
  const claims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER,
    installation_id: INSTALL,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z",
    key_id: "AUTHZ_KEY_1",
    assignments: [
      {
        tenant_id: TENANT,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: "2026-09-01T00:00:00.000Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
      },
    ],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function openDb(): Promise<LocalDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "pos-antifraud-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  return database;
}

function insertCatalogFixture(database: LocalDatabase, amount = "1000.000000"): void {
  const at = "2026-09-01T00:00:00.000Z";
  database.native
    .prepare(
      `INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,'CAFE-AF','Café','ACTIVE',0,?,?,?,1,?,?)`,
    )
    .run(PRODUCT, TENANT, COMPANY, USER, `fixture:${TENANT}:af`, CORRELATION, at, at);
  database.native
    .prepare(
      `INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Unidad','UND',0,?,'ACTIVE',?,?)`,
    )
    .run(PRESENTATION, TENANT, PRODUCT, "7700000000999", at, at);
  database.native
    .prepare(
      `INSERT INTO catalog_price(
      id, tenant_id, presentation_id, amount, currency_code, status, created_at, updated_at
    ) VALUES (?,?,?,?,'COP','ACTIVE',?,?)`,
    )
    .run(PRICE, TENANT, PRESENTATION, amount, at, at);
}

function seedRegister(db: LocalDatabase, companyId: string, registerId: string): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native
    .prepare(
      `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
    )
    .run(
      TENANT,
      companyId,
      BRANCH,
      at,
      JSON.stringify({ sequence: 1, payload: [] }),
      "a".repeat(64),
      "sig",
      at,
    );
  db.native
    .prepare(
      `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-X','caja-x','Caja X','COP','ACTIVE',?,NULL,1,1)`,
    )
    .run(registerId, TENANT, companyId, BRANCH, at);
}

describe("antifraud negatives — price integrity", () => {
  it("mutating catalog_price after sale does not rewrite frozen line amounts", async () => {
    const database = await openDb();
    const at = (): Date => NOW;
    const durableSync = new DurableSyncStore(database);
    const catalog = new SqliteCatalogStore(database, durableSync);
    const inventory = new SqliteInventoryStore(database, durableSync, at);
    const cashStore = new SqliteCashShiftStore(database, durableSync, at);
    const saleStore = new SqliteSaleStore(database, durableSync, at);
    const useCase = new CreateSaleUseCase(catalog, inventory, cashStore, saleStore, at);
    insertCatalogFixture(database, "1000.000000");

    const created = useCase.execute(SCOPE, SESSION, auth(["SALES_SALE_CREATE"]), {
      cashRegisterId: null,
      idempotencyKey: "sale:antifraud:price",
      channel: "POS",
      businessDate: "2026-09-06",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      documentSeries: "A",
      currencyCode: "COP",
      correlationId: randomUUID(),
      causationId: null,
      lines: [{ productId: PRODUCT, presentationId: PRESENTATION, quantity: "1.000000" }],
    });
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    database.native.prepare(`UPDATE catalog_price SET amount = '1.000000' WHERE id = ?`).run(PRICE);

    const line = database.native
      .prepare(`SELECT unit_price_amount, line_total_amount FROM sales_sale_items WHERE sale_id = ?`)
      .get(created.saleId) as { unit_price_amount: string; line_total_amount: string };
    expect(line.unit_price_amount).toBe("1000.000000");
    expect(Number(line.line_total_amount)).toBeGreaterThan(1);
  });
});

describe("antifraud negatives — privilege / company boundary", () => {
  it("cannot open a cash shift for a register owned by another company", async () => {
    const db = await openDb();
    seedRegister(db, COMPANY, REGISTER);
    seedRegister(db, OTHER_COMPANY, OTHER_REGISTER);
    const sync = new DurableSyncStore(db);
    const cash = new SqliteCashShiftStore(db, sync, () => NOW);
    const master = new SqliteMasterSnapshotStore(db, () => NOW);
    const openUC = new OpenCashShiftUseCase(master, cash, () => NOW);

    const denied = openUC.execute(SCOPE, SESSION, auth(["CASH_SHIFT_OPEN"]), {
      cashRegisterId: OTHER_REGISTER,
      openingAmount: "0.000000",
      businessDate: "2026-09-06",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      idempotencyKey: "shift:open:other-co",
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(denied.kind).toBe("REGISTER_NOT_FOUND");
  });
});
