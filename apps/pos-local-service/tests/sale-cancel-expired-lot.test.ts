/**
 * 3C-1: recovery when a SALE reservation's lot expires before payment.
 */
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { uuidV7, CanonicalPermission } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CancelSaleUseCase } from "../src/sales/cancel-sale-use-case.js";
import { commercialBusinessDate } from "../src/time/commercial-calendar.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc71";

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

function auth(permissions: string[] = [
  CanonicalPermission.CATALOG_PRODUCT_REGISTER,
  CanonicalPermission.INVENTORY_STOCK_RECEIVE,
  CanonicalPermission.SALES_SALE_CANCEL,
]): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-11-23T00:00:00.000Z",
    expires_at: "2026-11-25T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-11-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: "2026-11-23T12:00:00.000Z" };
}

function seedReadySale(database: LocalDatabase, saleId: string, at: Date, status = "READY_FOR_PAYMENT"): void {
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
      ?,?,?,?,NULL,NULL,?,?,'USER',?,'POS',?,'2026-11-23','America/Bogota',-300,
      'INV',?,'COP','1000.000000','0.000000','0.000000','1000.000000','0.000000','1000.000000',
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1',
      '{}','{}',?,?,?,?,?,NULL,1,?,NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, DEVICE, INSTALL, USER, status, saleNumber,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64), CORRELATION, iso,
  );
}

describe("3C-1 expired lot sale recovery", () => {
  it("rejects deduction after Bogotá midnight, cancels sale, releases hold idempotently, survives restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-sale-cancel-"));
    directories.push(dir);
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);

    let clock = new Date("2026-11-24T01:00:00Z"); // Bogotá 2026-11-23
    const sync = new DurableSyncStore(database);
    const catalogStore = new SqliteCatalogStore(database, sync, () => clock);
    const inventory = new SqliteInventoryStore(database, sync, () => clock);
    const saleStore = new SqliteSaleStore(database, sync, () => clock);
    const cancel = new CancelSaleUseCase(saleStore, inventory, () => clock);

    const registered = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
      code: "REC-001", name: "Recuperacion", stockControlled: true,
      presentationName: "Und", unitCode: "UND", unitPrecision: 0, barcode: null,
      priceAmount: "1000.000000", currencyCode: "COP",
      idempotencyKey: "idem-rec-reg", correlationId: CORRELATION, causationId: null,
    });
    if (registered.kind !== "REGISTERED") throw new Error(registered.kind);
    const presentationId = registered.presentationId;

    expect(new ReceiveStockUseCase(inventory).execute(SCOPE, SESSION, auth(), {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "3.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-11-20",
      idempotencyKey: "idem-rec-recv",
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-REC",
        manufactureDate: "2026-10-01",
        expiryDate: "2026-11-23",
        supplierReference: "SUP",
        receiptDocument: "FAC",
      },
    }).kind).toBe("POSTED");

    const saleId = "018f0000-0000-7000-8000-0000000000e1";
    seedReadySale(database, saleId, clock);
    expect(inventory.createReservationInTransaction({
      scope: SCOPE, sessionId: SESSION, actorId: USER, presentationId,
      quantity: "3.000000", referenceType: "SALE", referenceId: saleId,
      idempotencyKey: `inventory_reserve:sale:${saleId}:${presentationId}`,
      requestChecksum: "a".repeat(64), correlationId: CORRELATION, causationId: null,
      expiresAt: null,
    }).kind).toBe("RESERVED");
    expect(inventory.availableUnits(SCOPE, presentationId)).toBe(0n);

    // Manual release of SALE hold refused while sale is active.
    const reservationId = (database.native.prepare(
      "SELECT id FROM inventory_reservation WHERE reference_id=?",
    ).get(saleId) as { id: string }).id;
    expect(inventory.releaseReservation({
      scope: SCOPE, sessionId: SESSION, actorId: USER, reservationId,
      reasonCode: "MANUAL_ATTEMPT", idempotencyKey: "manual-release",
      requestChecksum: "d".repeat(64), correlationId: CORRELATION, causationId: null,
    })).toBe("CONFLICT");

    // Cobro after Bogotá midnight — no SALE movement, stock intact, hold ACTIVE.
    clock = new Date("2026-11-24T05:01:00Z");
    expect(commercialBusinessDate(clock)).toBe("2026-11-24");
    expect(inventory.appendSaleDeduction({
      scope: SCOPE, sessionId: SESSION, operatorUserId: USER, saleId, presentationId,
      quantity: "3.000000", businessDate: "2026-11-23",
      correlationId: CORRELATION, causationId: null,
    }).kind).toBe("INSUFFICIENT_STOCK");
    expect(inventory.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("3.000000");
    expect(database.native.prepare(
      "SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SALE'",
    ).get()).toEqual({ n: 0 });
    expect(database.native.prepare(
      "SELECT status FROM inventory_reservation WHERE reference_id=?",
    ).get(saleId)).toEqual({ status: "ACTIVE" });

    // Restart before resolving — hold and stock survive reopen.
    database.close();
    const reopened = LocalDatabase.open({ dataDirectory: dir });
    databases.push(reopened);
    const sync2 = new DurableSyncStore(reopened);
    const inventory2 = new SqliteInventoryStore(reopened, sync2, () => clock);
    const saleStore2 = new SqliteSaleStore(reopened, sync2, () => clock);
    const cancel2 = new CancelSaleUseCase(saleStore2, inventory2, () => clock);
    expect(inventory2.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("3.000000");
    expect(reopened.native.prepare(
      "SELECT status FROM inventory_reservation WHERE reference_id=?",
    ).get(saleId)).toEqual({ status: "ACTIVE" });

    // Authorized cancel releases hold; second cancel is idempotent.
    const cancelled = cancel2.execute(SCOPE, SESSION, auth(), {
      saleId,
      reasonCode: "LOT_EXPIRED_BEFORE_PAYMENT",
      idempotencyKey: "idem-sale-cancel-1",
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(cancelled).toEqual({ kind: "CANCELLED", saleId, released: 1 });
    // Physical stock intact; sellable remains 0 because the lot is past Bogotá day.
    expect(inventory2.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("3.000000");
    expect(inventory2.sellableUnits(SCOPE, presentationId)).toBe(0n);
    expect(reopened.native.prepare(
      "SELECT status FROM sales_sales WHERE id=?",
    ).get(saleId)).toEqual({ status: "CANCELLED" });
    expect(reopened.native.prepare(
      "SELECT status FROM inventory_reservation WHERE reference_id=?",
    ).get(saleId)).toEqual({ status: "RELEASED" });
    expect(reopened.native.prepare(
      "SELECT count(*) AS n FROM local_sync_outbox WHERE operation_type='SALE_CANCELLED'",
    ).get()).toEqual({ n: 1 });
    expect(reopened.native.prepare(
      "SELECT count(*) AS n FROM local_sync_outbox WHERE operation_type='INVENTORY_RESERVATION_RELEASE'",
    ).get()).toEqual({ n: 1 });
    expect(reopened.native.prepare(
      "SELECT count(*) AS n FROM local_operation_audit WHERE action_code='SALE_CANCELLED'",
    ).get()).toEqual({ n: 1 });

    expect(cancel2.execute(SCOPE, SESSION, auth(), {
      saleId,
      reasonCode: "LOT_EXPIRED_BEFORE_PAYMENT",
      idempotencyKey: "idem-sale-cancel-1",
      correlationId: CORRELATION,
      causationId: null,
    })).toEqual({ kind: "IDEMPOTENT", saleId, released: 0 });

    expect(cancel2.execute(SCOPE, SESSION, auth(), {
      saleId,
      reasonCode: "LOT_EXPIRED_BEFORE_PAYMENT",
      idempotencyKey: "idem-sale-cancel-2",
      correlationId: CORRELATION,
      causationId: null,
    })).toEqual({ kind: "IDEMPOTENT", saleId, released: 0 });

    // Without cancel permission — denied.
    expect(cancel2.execute(SCOPE, SESSION, auth([
      CanonicalPermission.CATALOG_PRODUCT_REGISTER,
    ]), {
      saleId,
      reasonCode: "NO_PERM",
      idempotencyKey: "idem-sale-cancel-denied",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("UNAUTHORIZED");
  });

  it("refuses cancel when confirmed coverage exists; pending CREATED payments must cancel first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-sale-cancel-pay-"));
    directories.push(dir);
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);
    const clock = new Date("2026-11-23T15:00:00Z");
    const sync = new DurableSyncStore(database);
    const inventory = new SqliteInventoryStore(database, sync, () => clock);
    const saleStore = new SqliteSaleStore(database, sync, () => clock);
    const cancel = new CancelSaleUseCase(saleStore, inventory, () => clock);

    const saleId = "018f0000-0000-7000-8000-0000000000e2";
    seedReadySale(database, saleId, clock, "PAYMENT_IN_PROGRESS");

    const groupId = uuidV7();
    const paymentId = uuidV7();
    const paymentOpId = uuidV7();
    const nowIso = clock.toISOString();
    database.native.prepare(
      `INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
       VALUES(?,?,?,'SUCCEEDED','PAYMENT_REGISTERED',?,?)`,
    ).run(paymentOpId, "pay-created", "f".repeat(64), nowIso, nowIso);
    database.native.prepare(
      `INSERT INTO payments_payment_groups(
        id,tenant_id,company_id,branch_id,collection_subject_type,collection_subject_id,
        currency_code,expected_payable_amount,idempotency_key,request_checksum,
        correlation_id,causation_id,created_at
      ) VALUES (?,?,?,?,'SALE',?,'COP','1000.000000',?,?,?,?,?)`,
    ).run(groupId, TENANT, COMPANY, BRANCH, saleId, "g-key", "e".repeat(64), CORRELATION, null, nowIso);
    database.native.prepare(
      `INSERT INTO payments_payments(
        id,tenant_id,company_id,branch_id,payment_group_id,payment_method,authority_type,status,
        expected_amount,confirmed_amount,tendered_amount,change_amount,currency_code,
        origin_device_id,installation_id,operator_actor_type,operator_actor_id,
        confirmed_by_actor_type,confirmed_by_actor_id,provider_code,provider_reference,
        operation_id,idempotency_key,request_checksum,correlation_id,causation_id,
        version,created_at,confirmed_at,cancelled_at,server_recorded_at
      ) VALUES (?,?,?,?,?,'TRANSFER','MANUAL_ATTESTATION','CREATED',
        '500.000000','0.000000',NULL,NULL,'COP',?,?,'USER',?,NULL,NULL,'BANK','REF',
        ?,?,?,?,?,1,?,NULL,NULL,NULL)`,
    ).run(
      paymentId, TENANT, COMPANY, BRANCH, groupId, DEVICE, INSTALL, USER,
      paymentOpId, "pay-created", "f".repeat(64), CORRELATION, null, nowIso,
    );

    expect(cancel.execute(SCOPE, SESSION, auth(), {
      saleId, reasonCode: "BLOCKED", idempotencyKey: "cancel-pending",
      correlationId: CORRELATION, causationId: null,
    }).kind).toBe("PENDING_PAYMENTS_MUST_CANCEL");

    // Mark payment cancelled and add confirmed allocation → reconciliation required.
    database.native.prepare(
      "UPDATE payments_payments SET status='CANCELLED', cancelled_at=? WHERE id=?",
    ).run(nowIso, paymentId);
    database.native.prepare(
      `INSERT INTO payments_payment_allocations(
        id,tenant_id,payment_group_id,payment_id,collection_subject_type,collection_subject_id,
        amount,currency_code,allocation_sequence,created_at
      ) VALUES (?,?,?,?,'SALE',?,'400.000000','COP',1,?)`,
    ).run(uuidV7(), TENANT, groupId, paymentId, saleId, nowIso);

    expect(cancel.execute(SCOPE, SESSION, auth(), {
      saleId, reasonCode: "BLOCKED", idempotencyKey: "cancel-confirmed",
      correlationId: CORRELATION, causationId: null,
    }).kind).toBe("CONFIRMED_COVERAGE_REQUIRES_RECONCILIATION");
    expect(database.native.prepare(
      "SELECT status FROM sales_sales WHERE id=?",
    ).get(saleId)).toEqual({ status: "PAYMENT_IN_PROGRESS" });
  });
});
