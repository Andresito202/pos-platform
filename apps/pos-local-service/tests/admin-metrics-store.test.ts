import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { SqliteAdminMetricsStore } from "../src/admin/sqlite-admin-metrics-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT_A = "018f0000-0000-7000-8000-000000000001";
const TENANT_B = "018f0000-0000-7000-8000-000000000011";
const COMPANY_A = "018f0000-0000-7000-8000-000000000002";
const COMPANY_B = "018f0000-0000-7000-8000-000000000012";
const BRANCH_A = "018f0000-0000-7000-8000-000000000003";
const BRANCH_B = "018f0000-0000-7000-8000-000000000013";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const NOW = "2026-09-07T10:00:00.000Z";

const SCOPE_A: SyncScope = {
  tenantId: TENANT_A, companyId: COMPANY_A, branchId: BRANCH_A,
  deviceId: DEVICE, installationId: INSTALL,
};
const SCOPE_BRANCH_B: SyncScope = {
  tenantId: TENANT_A, companyId: COMPANY_A, branchId: BRANCH_B,
  deviceId: DEVICE, installationId: INSTALL,
};
const SCOPE_TENANT_B: SyncScope = {
  tenantId: TENANT_B, companyId: COMPANY_B, branchId: BRANCH_B,
  deviceId: DEVICE, installationId: INSTALL,
};

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openDatabase(): Promise<LocalDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "pos-admin-metrics-"));
  directories.push(dir);
  return LocalDatabase.open({ dataDirectory: dir });
}

function registerOperation(db: LocalDatabase, seed: string): string {
  const operationId = randomUUID();
  db.native.prepare(
    `INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
     VALUES (?,?,?,'SUCCEEDED','COMMITTED',?,?)`,
  ).run(operationId, `op:${seed}`, "a".repeat(64), NOW, NOW);
  return operationId;
}

function seedSale(
  db: LocalDatabase,
  scope: Pick<SyncScope, "tenantId" | "companyId" | "branchId">,
  amount: string,
  status: "COMPLETED" | "READY_FOR_PAYMENT" = "COMPLETED",
): void {
  const saleId = randomUUID();
  const operationId = registerOperation(db, saleId);
  const saleNumber = (db.native.prepare(
    "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales_sales WHERE tenant_id=? AND branch_id=?",
  ).get(scope.tenantId, scope.branchId) as { next: number }).next;
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
      ?,?,?,?,NULL,NULL,
      ?,?,'USER',?,
      'POS',?, '2026-09-07','America/Bogota',-300,
      'A',?,'COP',
      ?,'0.000000','0.000000',?,
      '0.000000',?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?,
      ?,NULL,1,?,
      ?,NULL,NULL,NULL
    )`,
  ).run(
    saleId, scope.tenantId, scope.companyId, scope.branchId,
    DEVICE, INSTALL, USER,
    status, saleNumber,
    amount, amount, amount,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), NOW,
    status === "COMPLETED" ? NOW : null,
  );
}

function seedPayment(
  db: LocalDatabase,
  scope: Pick<SyncScope, "tenantId" | "companyId" | "branchId">,
  method: "CASH" | "TRANSFER" | "QR",
  status: "CONFIRMED" | "CREATED" | "CANCELLED",
  amount: string,
): void {
  const paymentId = randomUUID();
  const groupId = randomUUID();
  const saleId = randomUUID();
  const operationId = registerOperation(db, paymentId);
  db.native.prepare(
    `INSERT INTO payments_payment_groups(
      id, tenant_id, company_id, branch_id, collection_subject_type, collection_subject_id,
      currency_code, expected_payable_amount, idempotency_key, request_checksum,
      correlation_id, causation_id, created_at
    ) VALUES (?,?,?,?,'SALE',?,'COP',?,?,?,?,NULL,?)`,
  ).run(
    groupId, scope.tenantId, scope.companyId, scope.branchId, saleId, amount,
    `group:${paymentId}`, "e".repeat(64), randomUUID(), NOW,
  );
  db.native.prepare(
    `INSERT INTO payments_payments(
      id, tenant_id, company_id, branch_id, payment_group_id, payment_method, authority_type, status,
      expected_amount, confirmed_amount, tendered_amount, change_amount, currency_code,
      origin_device_id, installation_id, operator_actor_type, operator_actor_id,
      confirmed_by_actor_type, confirmed_by_actor_id, provider_code, provider_reference,
      operation_id, idempotency_key, request_checksum, correlation_id, causation_id,
      version, created_at, confirmed_at, cancelled_at, server_recorded_at
    ) VALUES (
      ?,?,?,?,?,?,'LOCAL_DEVICE',?,
      ?,?,NULL,NULL,'COP',
      ?,?,'USER',?,
      ?,?,?,?,
      ?,?,?,?,NULL,
      1,?,?,?,NULL
    )`,
  ).run(
    paymentId, scope.tenantId, scope.companyId, scope.branchId, groupId, method, status,
    amount, status === "CONFIRMED" ? amount : "0.000000",
    DEVICE, INSTALL, USER,
    status === "CONFIRMED" ? "USER" : null,
    status === "CONFIRMED" ? USER : null,
    method === "QR" ? "FACTUS_PAY" : null,
    method === "QR" ? `ref:${paymentId}` : null,
    operationId, `pay:${paymentId}`, "f".repeat(64), randomUUID(),
    NOW,
    status === "CONFIRMED" ? NOW : null,
    status === "CANCELLED" ? NOW : null,
  );
}

describe("SqliteAdminMetricsStore isolation and payment semantics", () => {
  it("aísla ventas completadas por empresa y sucursal y filtra fecha comercial", async () => {
    const db = await openDatabase();
    seedSale(db, SCOPE_A, "1000.000000");
    seedSale(db, SCOPE_A, "500.000000");
    seedSale(db, SCOPE_A, "200.000000", "READY_FOR_PAYMENT");
    seedSale(db, SCOPE_BRANCH_B, "9999.000000");
    seedSale(db, SCOPE_TENANT_B, "7777.000000");

    const store = new SqliteAdminMetricsStore(db);
    expect(store.readSales(SCOPE_A)).toEqual({ count: 2, amount: "1500.000000" });
    expect(store.readSales(SCOPE_A, { businessDate: "2026-09-07" })).toEqual({ count: 2, amount: "1500.000000" });
    expect(store.readSales(SCOPE_A, { businessDate: "2026-09-06" })).toEqual({ count: 0, amount: "0.000000" });
    expect(store.readSales(SCOPE_BRANCH_B)).toEqual({ count: 1, amount: "9999.000000" });
    expect(store.readSales(SCOPE_TENANT_B)).toEqual({ count: 1, amount: "7777.000000" });
  });

  it("suma solo pagos CONFIRMADOS y no cuenta transferencias pendientes como recaudo", async () => {
    const db = await openDatabase();
    seedPayment(db, SCOPE_A, "CASH", "CONFIRMED", "1000.000000");
    seedPayment(db, SCOPE_A, "TRANSFER", "CONFIRMED", "2500.000000");
    seedPayment(db, SCOPE_A, "QR", "CONFIRMED", "300.000000");
    seedPayment(db, SCOPE_A, "TRANSFER", "CREATED", "8000.000000");
    seedPayment(db, SCOPE_A, "TRANSFER", "CANCELLED", "50.000000");
    seedPayment(db, SCOPE_BRANCH_B, "CASH", "CONFIRMED", "111.000000");
    seedPayment(db, SCOPE_TENANT_B, "TRANSFER", "CONFIRMED", "222.000000");

    const store = new SqliteAdminMetricsStore(db);
    expect(store.readPayments(SCOPE_A)).toEqual({
      confirmed_count: 3,
      confirmed_amount: "3800.000000",
      confirmed_cash_amount: "1000.000000",
      confirmed_transfer_amount: "2500.000000",
      confirmed_qr_amount: "300.000000",
      pending_transfer_count: 1,
    });
    expect(store.readPayments(SCOPE_BRANCH_B).confirmed_amount).toBe("111.000000");
    expect(store.readPayments(SCOPE_TENANT_B).confirmed_amount).toBe("222.000000");
  });

  it("no duplica importe sumando ventas fiscales con pagos confirmados en el store", async () => {
    const db = await openDatabase();
    seedSale(db, SCOPE_A, "1000.000000");
    seedPayment(db, SCOPE_A, "CASH", "CONFIRMED", "1000.000000");
    const store = new SqliteAdminMetricsStore(db);
    const sales = store.readSales(SCOPE_A);
    const payments = store.readPayments(SCOPE_A);
    expect(sales.amount).toBe("1000.000000");
    expect(payments.confirmed_amount).toBe("1000.000000");
    // Consumers must not add these figures; they measure different facts.
    expect(sales.amount).toBe(payments.confirmed_amount);
  });
});
