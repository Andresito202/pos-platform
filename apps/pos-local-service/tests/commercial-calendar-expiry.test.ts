/**
 * Fecha comercial America/Bogota vs vencimiento de lotes.
 * Casos A/B medianoche Bogotá; C reserva→cobro tras vencimiento.
 */
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { uuidV7 } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import {
  commercialBusinessDate,
  COMMERCIAL_TIMEZONE_ID,
  isLotEligibleOnCommercialDate,
} from "../src/time/commercial-calendar.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc91";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* ignore */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("commercialBusinessDate America/Bogota", () => {
  it("Case A: UTC 2026-11-24T01:00Z is still Bogotá 2026-11-23", () => {
    const instant = new Date("2026-11-24T01:00:00Z");
    expect(commercialBusinessDate(instant)).toBe("2026-11-23");
    expect(commercialBusinessDate(instant, COMMERCIAL_TIMEZONE_ID)).toBe("2026-11-23");
    // UTC slice would wrongly report the next calendar day.
    expect(instant.toISOString().slice(0, 10)).toBe("2026-11-24");
    expect(isLotEligibleOnCommercialDate("2026-11-23", commercialBusinessDate(instant))).toBe(true);
  });

  it("Case B: UTC 2026-11-24T05:01Z is Bogotá 2026-11-24", () => {
    const instant = new Date("2026-11-24T05:01:00Z");
    expect(commercialBusinessDate(instant)).toBe("2026-11-24");
    expect(isLotEligibleOnCommercialDate("2026-11-23", commercialBusinessDate(instant))).toBe(false);
  });

  it("does not depend on process timezone for commercial date", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      expect(commercialBusinessDate(new Date("2026-11-24T01:00:00Z"))).toBe("2026-11-23");
      process.env.TZ = "UTC";
      expect(commercialBusinessDate(new Date("2026-11-24T01:00:00Z"))).toBe("2026-11-23");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

function auth(): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-11-23T00:00:00.000Z",
    expires_at: "2026-11-25T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-11-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: [
        { code: "CATALOG_PRODUCT_REGISTER", status: "ACTIVE" as const },
        { code: "INVENTORY_STOCK_RECEIVE", status: "ACTIVE" as const },
      ],
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: "2026-11-23T12:00:00.000Z" };
}

function seedReadySale(database: LocalDatabase, saleId: string, at: Date): void {
  const operationId = uuidV7(at.getTime());
  const iso = at.toISOString();
  const saleNumber = ((database.native.prepare(
    "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales_sales WHERE tenant_id=? AND branch_id=?",
  ).get(TENANT, BRANCH) as { next: number }).next);
  database.native.prepare(
    `INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
     VALUES(?,?,?,'SUCCEEDED','SALE_CREATED',?,?)`,
  ).run(operationId, `sale:${saleId}`, "b".repeat(64), iso, iso);
  database.native.prepare(
    `INSERT INTO sales_sales(
      id,tenant_id,company_id,branch_id,cash_register_id,cash_shift_id,
      origin_device_id,installation_id,operator_actor_type,operator_actor_id,
      channel,status,business_date,timezone_id,utc_offset_minutes,
      document_series,sale_number,currency_code,
      subtotal_amount,discount_amount,tax_amount,fiscal_total_amount,
      commercial_rounding_adjustment,payable_amount,
      pricing_pipeline_version,pricing_policy_version,promotion_policy_version,
      tax_policy_version,rounding_policy_version,pricing_snapshot,tax_snapshot,
      calculation_checksum,operation_id,idempotency_key,request_checksum,
      correlation_id,causation_id,version,created_at,
      completed_at,cancelled_at,expired_at,server_recorded_at
    ) VALUES (
      ?,?,?,?,NULL,NULL,?,?,'USER',?,'POS','READY_FOR_PAYMENT','2026-11-23','America/Bogota',-300,
      'INV',?,'COP','1000.000000','0.000000','0.000000','1000.000000','0.000000','1000.000000',
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1',
      '{}','{}',?,?,?,?,?,NULL,1,?,NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, DEVICE, INSTALL, USER, saleNumber,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64), CORRELATION, iso,
  );
}

describe("inventory expiry uses Bogotá commercial date", () => {
  it("Case A/B: lot expiring 2026-11-23 stays sellable before Bogotá midnight and not after", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-commercial-date-"));
    directories.push(dir);
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);

    let clock = new Date("2026-11-23T12:00:00.000Z");
    const sync = new DurableSyncStore(database);
    const catalogStore = new SqliteCatalogStore(database, sync, () => clock);
    const store = new SqliteInventoryStore(database, sync, () => clock);

    const registered = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
      code: "BOG-EXP-001", name: "Lote medianoche", stockControlled: true,
      presentationName: "Und", unitCode: "UND", unitPrecision: 0, barcode: null,
      priceAmount: "1000.000000", currencyCode: "COP",
      idempotencyKey: "idem-bog-reg-1", correlationId: CORRELATION, causationId: null,
    });
    if (registered.kind !== "REGISTERED") throw new Error(registered.kind);
    const presentationId = registered.presentationId;

    expect(new ReceiveStockUseCase(store).execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "5.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-11-20",
      idempotencyKey: "idem-bog-recv-1",
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-BOG-23",
        manufactureDate: "2026-10-01",
        expiryDate: "2026-11-23",
        supplierReference: "SUP-1",
        receiptDocument: "FAC-1",
      },
    }).kind).toBe("POSTED");

    // Case A — UTC next calendar day, still Bogotá 2026-11-23.
    clock = new Date("2026-11-24T01:00:00Z");
    expect(commercialBusinessDate(clock)).toBe("2026-11-23");
    expect(store.sellableUnits(SCOPE, presentationId, clock)).toBe(5_000_000n);
    expect(store.availableUnits(SCOPE, presentationId)).toBe(5_000_000n);

    // Case B — past Bogotá midnight.
    clock = new Date("2026-11-24T05:01:00Z");
    expect(commercialBusinessDate(clock)).toBe("2026-11-24");
    expect(store.sellableUnits(SCOPE, presentationId, clock)).toBe(0n);
    expect(store.availableUnits(SCOPE, presentationId)).toBe(0n);
    // Physical stock unchanged — no automatic write-off.
    expect(store.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("5.000000");
  });

  it("Case C: reserve before Bogotá midnight; payment after expiry is rejected without debit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-commercial-reserve-"));
    directories.push(dir);
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);

    let clock = new Date("2026-11-24T01:00:00Z"); // Bogotá 2026-11-23
    const sync = new DurableSyncStore(database);
    const catalogStore = new SqliteCatalogStore(database, sync, () => clock);
    const store = new SqliteInventoryStore(database, sync, () => clock);

    const registered = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
      code: "BOG-RES-001", name: "Reserva medianoche", stockControlled: true,
      presentationName: "Und", unitCode: "UND", unitPrecision: 0, barcode: null,
      priceAmount: "1000.000000", currencyCode: "COP",
      idempotencyKey: "idem-bog-reg-2", correlationId: CORRELATION, causationId: null,
    });
    if (registered.kind !== "REGISTERED") throw new Error(registered.kind);
    const presentationId = registered.presentationId;

    expect(new ReceiveStockUseCase(store).execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "2.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-11-20",
      idempotencyKey: "idem-bog-recv-2",
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-RES-23",
        manufactureDate: "2026-10-01",
        expiryDate: "2026-11-23",
        supplierReference: "SUP-2",
        receiptDocument: "FAC-2",
      },
    }).kind).toBe("POSTED");

    const saleId = "018f0000-0000-7000-8000-0000000000d1";
    seedReadySale(database, saleId, clock);
    expect(store.createReservationInTransaction({
      scope: SCOPE, sessionId: SESSION, actorId: USER, presentationId,
      quantity: "2.000000", referenceType: "SALE", referenceId: saleId,
      idempotencyKey: `inventory_reserve:sale:${saleId}:${presentationId}`,
      requestChecksum: "a".repeat(64), correlationId: CORRELATION, causationId: null,
      expiresAt: null,
    }).kind).toBe("RESERVED");
    expect(store.availableUnits(SCOPE, presentationId)).toBe(0n);

    // Cobro after Bogotá midnight — lot no longer eligible.
    clock = new Date("2026-11-24T05:01:00Z");
    expect(store.appendSaleDeduction({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER, saleId, presentationId,
      quantity: "2.000000", businessDate: "2026-11-23",
      correlationId: CORRELATION, causationId: null,
    }).kind).toBe("INSUFFICIENT_STOCK");
    expect(store.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("2.000000");
    expect(database.native.prepare(
      "SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SALE'",
    ).get()).toEqual({ n: 0 });
    expect(database.native.prepare(
      "SELECT status FROM inventory_reservation WHERE reference_id=?",
    ).get(saleId)).toEqual({ status: "ACTIVE" });
  });
});
