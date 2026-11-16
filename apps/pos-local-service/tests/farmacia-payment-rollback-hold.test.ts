import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7, type AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../src/payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../src/payments/confirm-transfer-payment-use-case.js";
import { SqlitePharmacyStore } from "../src/pharmacy/sqlite-pharmacy-store.js";
import type { PharmacySaleEligibilityPort } from "../src/payments/pharmacy-sale-eligibility-port.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const PRODUCT = "018f0000-0000-7000-8000-0000000000c1";
const PRESENTATION = "018f0000-0000-7000-8000-0000000000c2";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc99";
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ALL = [
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
  "PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_TRANSFER_REPORT",
  "PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_CANCEL", "PAYMENTS_PAYMENT_READ",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep */ }
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
const key = (): string => { seed += 1; return `idem-rollback-hold-${String(seed)}`; };

/**
 * First N eligibility checks succeed; subsequent checks deny.
 * Reconciliation persistence uses the real pharmacy store so holds outlive
 * PaymentRollback of the confirming payment transaction.
 */
class ScriptedPharmacyPort implements PharmacySaleEligibilityPort {
  private calls = 0;
  constructor(
    private readonly pharmacyStore: SqlitePharmacyStore,
    private readonly allowCount: number,
  ) {}
  revalidateSaleEligibility(_scope: SyncScope, _saleId: string) {
    this.calls += 1;
    if (this.calls <= this.allowCount) return { kind: "OK" as const };
    return { kind: "DENIED" as const, reason: "PHARMACY_CLASSIFICATION_UNKNOWN" };
  }
  recordPaymentReconciliationPending(
    input: Parameters<PharmacySaleEligibilityPort["recordPaymentReconciliationPending"]>[0],
  ): void {
    this.pharmacyStore.recordPaymentReconciliationPending(input);
  }
  get callCount(): number { return this.calls; }
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

function seedCatalogAndSale(db: LocalDatabase, payable = "20000.000000"): string {
  const at = NOW.toISOString();
  const saleId = randomUUID();
  const operationId = uuidV7(NOW.getTime());
  const zero = "0.000000";

  db.native.prepare(
    `INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,'RX-ROLL','Medicamento','ACTIVE',0,?,?,?,1,?,?)`,
  ).run(PRODUCT, TENANT, COMPANY, USER, `catalog:${PRODUCT}`, randomUUID(), at, at);

  db.native.prepare(
    `INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Caja','UND',0,NULL,'ACTIVE',?,?)`,
  ).run(PRESENTATION, TENANT, PRODUCT, at, at);

  const saleNumber = ((db.native.prepare(
    "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales_sales WHERE tenant_id=? AND branch_id=?",
  ).get(TENANT, BRANCH) as { next: number }).next);

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
      ?,?,?,?,?,?,
      ?,?,'USER',?,
      'POS','READY_FOR_PAYMENT','2026-09-07','America/Bogota',-300,
      'A',?,'COP',
      ?,?,?,?,
      ?,?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?,
      ?,NULL,1,?,
      NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, null, null,
    DEVICE, INSTALL, USER,
    saleNumber,
    payable, zero, zero, payable, zero, payable,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), at,
  );

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
    ) VALUES (
      ?,?,?,1,
      ?,NULL,?,
      'Medicamento','Caja',NULL,
      ?,'UND',0,
      '2.000000','10000.000000','20000.000000',
      ?,'20000.000000',?,'20000.000000',
      '{}','{}',
      NULL,NULL,NULL,NULL
    )`,
  ).run(randomUUID(), TENANT, saleId, PRODUCT, PRESENTATION, PRESENTATION, zero, zero);

  db.native.prepare(
    `INSERT INTO pharmacy_dispensation(
      tenant_id,company_id,branch_id,id,sale_id,product_id,presentation_id,prescription_id,
      dispensation_category,eligibility_snapshot_json,status,actor_id,session_id,created_at
    ) VALUES (?,?,?,?,?,?,?,NULL,'OTC',?,'AUTHORIZED',?,?,?)`,
  ).run(
    TENANT, COMPANY, BRANCH, randomUUID(), saleId, PRODUCT, PRESENTATION,
    JSON.stringify({ path: "OTC", professional_competence_code: null }),
    USER, SESSION, at,
  );
  return saleId;
}

function bindSaleToShift(db: LocalDatabase, saleId: string, shiftId: string): void {
  db.native.prepare(
    `UPDATE sales_sales SET cash_shift_id=?, cash_register_id=? WHERE tenant_id=? AND id=?`,
  ).run(shiftId, REGISTER, TENANT, saleId);
}

function confirmedPaymentCount(db: LocalDatabase, saleId: string): number {
  return (db.native.prepare(
    `SELECT count(*) AS n FROM payments_payments p
     JOIN payments_payment_groups g ON g.tenant_id=p.tenant_id AND g.id=p.payment_group_id
     WHERE p.tenant_id=? AND g.collection_subject_id=? AND p.status='CONFIRMED'`,
  ).get(TENANT, saleId) as { n: number }).n;
}

function allocationCount(db: LocalDatabase, saleId: string): number {
  return (db.native.prepare(
    `SELECT count(*) AS n FROM payments_payment_allocations
     WHERE tenant_id=? AND collection_subject_type='SALE' AND collection_subject_id=?`,
  ).get(TENANT, saleId) as { n: number }).n;
}

function reconciliationHoldCount(db: LocalDatabase, saleId: string): number {
  return (db.native.prepare(
    `SELECT count(*) AS n FROM pharmacy_dispensation
     WHERE tenant_id=? AND sale_id=? AND status='BLOCKED_RECORD'
       AND json_extract(eligibility_snapshot_json,'$.reconciliation_pending')=1`,
  ).get(TENANT, saleId) as { n: number }).n;
}

function reconciliationAuditCount(db: LocalDatabase, saleId: string): number {
  return (db.native.prepare(
    `SELECT count(*) AS n FROM local_operation_audit
     WHERE tenant_id=? AND resource_id=? AND action_code='PHARMACY_PAYMENT_RECONCILIATION_PENDING'`,
  ).get(TENANT, saleId) as { n: number }).n;
}

function cashMovementCount(db: LocalDatabase, shiftId: string): number {
  return (db.native.prepare(
    `SELECT count(*) AS n FROM cash_movement WHERE tenant_id=? AND cash_shift_id=?`,
  ).get(TENANT, shiftId) as { n: number }).n;
}

async function buildEnv(scriptedAllows: number) {
  const dir = await mkdtemp(join(tmpdir(), "pos-pharm-rollback-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const pharmacyStore = new SqlitePharmacyStore(database, sync, () => NOW);
  const scripted = new ScriptedPharmacyPort(pharmacyStore, scriptedAllows);
  const paymentStore = new SqlitePaymentStore(
    database, sync, cashStore, inventoryStore, () => NOW, scripted,
  );
  seedRegister(database);
  return {
    dir, database, pharmacyStore, scripted, paymentStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
    registerTransfer: new RegisterTransferPaymentUseCase(paymentStore, () => NOW),
    confirmTransfer: new ConfirmTransferPaymentUseCase(paymentStore, () => NOW),
  };
}

describe("prompt-6 pharmacy hold survives PaymentRollback after writes", () => {
  it("cash: second validation fails after writes; prior coverage intact; hold+audit durable across reopen", async () => {
    // allowCount=2: early on first half, early on covering half; 3rd call = completeSaleIfCovered deny
    const env = await buildEnv(2);
    const saleId = seedCatalogAndSale(env.database);
    const shift = env.openShift.execute(SCOPE, SESSION, auth(), {
      cashRegisterId: REGISTER,
      openingAmount: "0.000000",
      businessDate: "2026-09-07",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    if (shift.kind !== "OPENED") throw new Error("shift");
    bindSaleToShift(env.database, saleId, shift.shiftId);

    const first = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000", tenderedAmount: "10000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");
    if (first.kind !== "CONFIRMED") return;
    expect(first.saleCompleted).toBe(false);
    expect(confirmedPaymentCount(env.database, saleId)).toBe(1);
    expect(allocationCount(env.database, saleId)).toBe(1);
    const cashMovesBefore = cashMovementCount(env.database, shift.shiftId);

    const second = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000", tenderedAmount: "10000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(second).toMatchObject({ kind: "PHARMACY_ELIGIBILITY_LOST" });
    expect(env.scripted.callCount).toBeGreaterThanOrEqual(3);

    expect(confirmedPaymentCount(env.database, saleId)).toBe(1);
    expect(allocationCount(env.database, saleId)).toBe(1);
    expect(cashMovementCount(env.database, shift.shiftId)).toBe(cashMovesBefore);
    expect(env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(TENANT, saleId)).toEqual({ status: "PAYMENT_IN_PROGRESS" });

    expect(reconciliationHoldCount(env.database, saleId)).toBe(1);
    expect(reconciliationAuditCount(env.database, saleId)).toBe(1);
    expect(env.database.native.prepare(
      `SELECT count(*) AS n FROM pharmacy_dispensation
       WHERE tenant_id=? AND sale_id=? AND status='BLOCKED_RECORD'
         AND json_extract(eligibility_snapshot_json,'$.bank_reversal_claimed')=1`,
    ).get(TENANT, saleId)).toEqual({ n: 0 });

    env.database.close();
    databases.pop();
    const reopened = LocalDatabase.open({ dataDirectory: env.dir });
    databases.push(reopened);
    expect(reconciliationHoldCount(reopened, saleId)).toBe(1);
    expect(reconciliationAuditCount(reopened, saleId)).toBe(1);
    expect(confirmedPaymentCount(reopened, saleId)).toBe(1);
    expect(allocationCount(reopened, saleId)).toBe(1);
    const pharmacyStore = new SqlitePharmacyStore(reopened, new DurableSyncStore(reopened), () => NOW);
    expect(pharmacyStore.revalidateSaleEligibility(SCOPE, saleId)).toMatchObject({
      kind: "DENIED",
      reason: "PHARMACY_RECONCILIATION_HOLD",
    });
  });

  it("transfer: second validation fails after confirm writes; CREATED restored; hold durable", async () => {
    const env = await buildEnv(2);
    const saleId = seedCatalogAndSale(env.database);
    const shift = env.openShift.execute(SCOPE, SESSION, auth(), {
      cashRegisterId: REGISTER,
      openingAmount: "0.000000",
      businessDate: "2026-09-07",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    if (shift.kind !== "OPENED") throw new Error("shift");
    bindSaleToShift(env.database, saleId, shift.shiftId);

    const first = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000", tenderedAmount: "10000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");
    if (first.kind !== "CONFIRMED") return;

    const reported = env.registerTransfer.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      providerCode: "BANK_TRANSFER", providerReference: "REF-ROLL",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(reported.kind).toBe("REGISTERED");
    if (reported.kind !== "REGISTERED") return;
    const row = env.database.native.prepare(
      "SELECT id, version, status FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, reported.paymentId) as { id: string; version: number; status: string };
    expect(row.status).toBe("CREATED");

    const confirmed = env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: row.id,
      expectedVersion: row.version,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(confirmed).toMatchObject({ kind: "PHARMACY_ELIGIBILITY_LOST" });

    expect(env.database.native.prepare(
      "SELECT status FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, row.id)).toEqual({ status: "CREATED" });
    expect(confirmedPaymentCount(env.database, saleId)).toBe(1);
    expect(allocationCount(env.database, saleId)).toBe(1);
    expect(env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(TENANT, saleId)).toEqual({ status: "PAYMENT_IN_PROGRESS" });
    expect(reconciliationHoldCount(env.database, saleId)).toBe(1);
    expect(reconciliationAuditCount(env.database, saleId)).toBe(1);

    env.database.close();
    databases.pop();
    const reopened = LocalDatabase.open({ dataDirectory: env.dir });
    databases.push(reopened);
    expect(reconciliationHoldCount(reopened, saleId)).toBe(1);
    expect(confirmedPaymentCount(reopened, saleId)).toBe(1);
    expect(reopened.native.prepare(
      "SELECT status FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, row.id)).toEqual({ status: "CREATED" });
  });

  it("unauthorized actor never reaches pharmacy revalidation on cash", async () => {
    const env = await buildEnv(0);
    const saleId = seedCatalogAndSale(env.database);
    const shift = env.openShift.execute(SCOPE, SESSION, auth(), {
      cashRegisterId: REGISTER,
      openingAmount: "0.000000",
      businessDate: "2026-09-07",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    if (shift.kind !== "OPENED") throw new Error("shift");
    bindSaleToShift(env.database, saleId, shift.shiftId);
    const denied = env.registerCash.execute(SCOPE, SESSION, auth(["SALES_SALE_CREATE"]), {
      saleId, amount: "20000.000000", tenderedAmount: "20000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(denied.kind).toBe("UNAUTHORIZED");
    expect(env.scripted.callCount).toBe(0);
  });
});
