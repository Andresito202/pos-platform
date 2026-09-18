import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  PaymentRegisterCashRequestSchema,
  PaymentTransferConfirmRequestSchema,
  type AuthorizationSnapshotClaims,
} from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../src/cash/close-cash-shift-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../src/payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../src/payments/confirm-transfer-payment-use-case.js";
import { CancelPaymentUseCase } from "../src/payments/cancel-payment-use-case.js";
import { GetPaymentUseCase } from "../src/payments/get-payment-use-case.js";
import { RegisterQrPaymentUseCase } from "../src/payments/register-qr-payment-use-case.js";
import { ConfirmProviderPaymentUseCase } from "../src/payments/confirm-provider-payment-use-case.js";
import type { PaymentProviderEvidence, PaymentProviderPort } from "../src/payments/payment-provider-port.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
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

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const ALL_PERMISSIONS = [
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
  "PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_TRANSFER_REPORT",
  "PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_CANCEL", "PAYMENTS_PAYMENT_READ",
];

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-payment-"));
  directories.push(value);
  return value;
}

/**
 * Bases abiertas por `buildEnv`. Se cierran antes de borrar el directorio
 * temporal: en Windows un handle abierto sobre `pos-local.db` —o sobre el
 * lock de escritor único— hace que `rmSync` falle con `EBUSY` y enmascare
 * la causa real, tal como ya documenta `session-assertion-verifier.test.ts`.
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

function auth(permissions: string[] = ALL_PERMISSIONS): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER,
    installation_id: INSTALL,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z",
    key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function buildEnv() {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);

  return {
    database, cashStore, inventoryStore, paymentStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
    closeShift: new CloseCashShiftUseCase(cashStore, () => NOW),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
    registerTransfer: new RegisterTransferPaymentUseCase(paymentStore, () => NOW),
    confirmTransfer: new ConfirmTransferPaymentUseCase(paymentStore, () => NOW),
    cancel: new CancelPaymentUseCase(paymentStore, () => NOW),
    get: new GetPaymentUseCase(paymentStore, () => NOW),
    registerQr: new RegisterQrPaymentUseCase(paymentStore, qrProvider()),
    confirmProvider: new ConfirmProviderPaymentUseCase(paymentStore),
  };
}

/** Caja activa en la proyección maestra, igual que en `cash.test.ts`. */
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

/**
 * Inserta una venta en `READY_FOR_PAYMENT`.
 *
 * Sales V1 ya tiene su propia cobertura en `sale.test.ts`; aquí la venta es
 * fixture para que las aserciones sean sobre Payment y su frontera con Cash.
 */
function seedSale(
  db: LocalDatabase,
  options: { saleId?: string; payable?: string; shiftId?: string | null; cashRegisterId?: string | null; status?: string } = {},
): string {
  const saleId = options.saleId ?? randomUUID();
  const payable = options.payable ?? "10000.000000";
  const shiftId = options.shiftId === undefined ? null : options.shiftId;
  const cashRegisterId = options.cashRegisterId === undefined
    ? (shiftId === null ? null : REGISTER)
    : options.cashRegisterId;
  const operationId = randomUUID();
  const at = NOW.toISOString();
  const zero = "0.000000";
  // `sales_sales_document_idx` es UNIQUE por (tenant, branch, serie, número):
  // una prueba que siembre dos ventas necesita numeración distinta.
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
      'POS',?, '2026-09-06','America/Bogota',-300,
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
    saleId, TENANT, COMPANY, BRANCH, cashRegisterId, shiftId,
    DEVICE, INSTALL, USER,
    options.status ?? "READY_FOR_PAYMENT",
    saleNumber,
    payable, zero, zero, payable, zero, payable,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), at,
  );
  return saleId;
}

/**
 * Siembra un producto, su presentación y una línea de venta que lo referencia.
 *
 * Las ventas sembradas por `seedSale` no tienen líneas, así que la salida de
 * mercancía no llega a ejecutarse. Ésta añade lo que falta para que sí lo haga.
 *
 * `stockControlled` es parámetro y no constante: una prueba que afirme «sin
 * control no hay movimiento» necesita una línea **real** de un producto sin
 * control. Sembrar una venta sin líneas la haría pasar aunque el filtro por
 * `stock_controlled` no existiera — comprobado por mutación.
 */
function seedSaleLine(
  db: LocalDatabase,
  saleId: string,
  quantity = "2.000000",
  stockControlled = true,
): { productId: string; presentationId: string } {
  const productId = randomUUID();
  const presentationId = randomUUID();
  const at = NOW.toISOString();

  db.native.prepare(
    `INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,?,'Arroz Blanco','ACTIVE',?,?,?,?,1,?,?)`,
  ).run(
    productId, TENANT, COMPANY, `ARROZ-${productId.slice(0, 8)}`,
    stockControlled ? 1 : 0, USER, `catalog:${productId}`, randomUUID(), at, at,
  );

  db.native.prepare(
    `INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Libra','LBR',2,NULL,'ACTIVE',?,?)`,
  ).run(presentationId, TENANT, productId, at, at);

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
    ) VALUES (
      ?,?,?,1,
      ?,NULL,?,
      'Arroz Blanco','Libra',NULL,
      ?,'LBR',2,
      ?,'5000.000000','10000.000000',
      ?,'10000.000000',?,'10000.000000',
      '{}','{}',
      NULL,NULL,NULL,NULL
    )`,
  ).run(
    randomUUID(), TENANT, saleId,
    productId, presentationId,
    presentationId,
    quantity,
    zero, zero,
  );

  return { productId, presentationId };
}

/** Abre un turno real por el caso de uso de 4D y devuelve su id. */
function openShift(env: Awaited<ReturnType<typeof buildEnv>>, key = "shift:1"): string {
  const result = env.openShift.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: REGISTER, openingAmount: "0.000000",
    businessDate: "2026-09-06", timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

function cashRequest(saleId: string, amount: string, key: string, tendered: string | null = null) {
  return {
    saleId, amount, tenderedAmount: tendered,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  };
}

function saleStatus(db: LocalDatabase, saleId: string): { status: string; completed_at: string | null } {
  return db.native.prepare("SELECT status, completed_at FROM sales_sales WHERE tenant_id=? AND id=?")
    .get(TENANT, saleId) as { status: string; completed_at: string | null };
}

// ── Efectivo ──────────────────────────────────────────────────────────────────

describe("pago en efectivo", () => {
  it("cobertura completa confirma, asienta en caja y completa la venta en una transacción", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));

    expect(result.kind).toBe("CONFIRMED");
    if (result.kind !== "CONFIRMED") return;
    expect(result.saleCompleted).toBe(true);
    expect(result.confirmedCoverage).toBe("10000.000000");

    const sale = saleStatus(env.database, saleId);
    expect(sale.status).toBe("COMPLETED");
    expect(sale.completed_at).not.toBeNull();

    // Caja: un CASH_SALE / IN / POSTED, escrito por el puerto.
    const movement = env.database.native.prepare(
      `SELECT movement_type, direction, amount, status, shift_sequence
       FROM cash_movement WHERE tenant_id=? AND cash_shift_id=? AND movement_type='CASH_SALE'`,
    ).get(TENANT, shiftId) as { movement_type: string; direction: string; amount: string; status: string; shift_sequence: number };
    expect(movement.direction).toBe("IN");
    expect(movement.status).toBe("POSTED");
    expect(movement.amount).toBe("10000.000000");
    expect(movement.shift_sequence).toBe(2); // 1 es el OPENING_FLOAT

    const payment = env.database.native.prepare(
      "SELECT status, confirmed_amount FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, result.paymentId) as { status: string; confirmed_amount: string };
    expect(payment.status).toBe("CONFIRMED");
    expect(payment.confirmed_amount).toBe("10000.000000");
  });

  it("cobertura parcial confirma el pago pero NO completa la venta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "4000.000000", "pay:1"));

    expect(result.kind).toBe("CONFIRMED");
    if (result.kind !== "CONFIRMED") return;
    expect(result.saleCompleted).toBe(false);
    expect(result.confirmedCoverage).toBe("4000.000000");
    expect(saleStatus(env.database, saleId).status).toBe("PAYMENT_IN_PROGRESS");
  });

  it("pago mixto: el segundo componente completa la venta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "4000.000000", "pay:1"));
    const second = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "6000.000000", "pay:2"));

    expect(second.kind).toBe("CONFIRMED");
    if (second.kind !== "CONFIRMED") return;
    expect(second.saleCompleted).toBe(true);
    expect(second.confirmedCoverage).toBe("10000.000000");
    expect(saleStatus(env.database, saleId).status).toBe("COMPLETED");

    // Un solo grupo de cobro por venta.
    const groups = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM payments_payment_groups WHERE tenant_id=? AND collection_subject_id=?",
    ).get(TENANT, saleId) as { n: number };
    expect(groups.n).toBe(1);
  });

  it("el sobrepago se rechaza ANTES de confirmar", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000001", "pay:1"));

    expect(result.kind).toBe("OVERPAYMENT_NOT_ALLOWED");
    expect(saleStatus(env.database, saleId).status).toBe("READY_FOR_PAYMENT");
    const payments = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?",
    ).get(TENANT) as { n: number };
    expect(payments.n).toBe(0);
  });

  it("el vuelto lo calcula la capa confiable y no genera un segundo movimiento", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "9500.000000" });

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(), cashRequest(saleId, "9500.000000", "pay:1", "10000.000000"),
    );

    expect(result.kind).toBe("CONFIRMED");
    if (result.kind !== "CONFIRMED") return;
    expect(result.changeAmount).toBe("500.000000");

    // D-5: forense en el pago, un solo movimiento neto en caja.
    const stored = env.database.native.prepare(
      "SELECT tendered_amount, change_amount FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, result.paymentId) as { tendered_amount: string; change_amount: string };
    expect(stored.tendered_amount).toBe("10000.000000");
    expect(stored.change_amount).toBe("500.000000");

    const movements = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND cash_shift_id=? AND movement_type<>'OPENING_FLOAT'",
    ).get(TENANT, shiftId) as { n: number };
    expect(movements.n).toBe(1);
  });

  it("entregar menos de lo cobrado se rechaza", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId });

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1", "9000.000000"),
    );
    expect(result.kind).toBe("INSUFFICIENT_TENDER");
  });
});

// ── Frontera con caja ─────────────────────────────────────────────────────────

describe("frontera con caja", () => {
  it("el CASH_SALE entra en el expectedCash del cierre de turno", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));

    const closed = env.closeShift.execute(SCOPE, SESSION, auth(), {
      shiftId, countedAmount: "10000.000000", expectedVersion: 1,
      idempotencyKey: "close:1", correlationId: randomUUID(), causationId: null,
    });

    expect(closed.kind).toBe("CLOSED");
    if (closed.kind !== "CLOSED") return;
    expect(closed.expectedCash).toBe("10000.000000");
    expect(closed.differenceAmount).toBe("0.000000");
  });

  it("un turno cerrado rechaza el pago y no deja rastro", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.closeShift.execute(SCOPE, SESSION, auth(), {
      shiftId, countedAmount: "0.000000", expectedVersion: 1,
      idempotencyKey: "close:1", correlationId: randomUUID(), causationId: null,
    });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));

    expect(result.kind).toBe("CASH_SHIFT_NOT_OPEN");
    // La transacción revierte por completo: ni pago, ni imputación, ni venta tocada.
    const counts = env.database.native.prepare(
      `SELECT
         (SELECT COUNT(*) FROM payments_payments WHERE tenant_id=?) AS payments,
         (SELECT COUNT(*) FROM payments_payment_allocations WHERE tenant_id=?) AS allocations`,
    ).get(TENANT, TENANT) as { payments: number; allocations: number };
    expect(counts.payments).toBe(0);
    expect(counts.allocations).toBe(0);
    expect(saleStatus(env.database, saleId).status).toBe("READY_FOR_PAYMENT");
  });

  it("una venta sin turno de caja no admite efectivo", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    openShift(env);
    const saleId = seedSale(env.database, { shiftId: null });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));
    expect(result.kind).toBe("CASH_SHIFT_MISSING");
  });
});

// ── Transferencia ─────────────────────────────────────────────────────────────

describe("transferencia por atestiguación manual", () => {
  function transferRequest(saleId: string, amount: string, key: string) {
    return {
      saleId, amount, providerCode: "NEQUI", providerReference: "REF-1",
      idempotencyKey: key, correlationId: randomUUID(), causationId: null,
    };
  }

  it("reportar deja el pago en CREATED, sin imputar ni completar", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });

    const result = env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest(saleId, "10000.000000", "t:1"));

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") return;

    const payment = env.database.native.prepare(
      "SELECT status, confirmed_amount FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, result.paymentId) as { status: string; confirmed_amount: string };
    expect(payment.status).toBe("CREATED");
    expect(payment.confirmed_amount).toBe("0.000000");

    const allocations = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=?",
    ).get(TENANT) as { n: number };
    expect(allocations.n).toBe(0);
    expect(saleStatus(env.database, saleId).status).toBe("PAYMENT_IN_PROGRESS");
  });

  it("confirmar imputa y completa la venta", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest(saleId, "10000.000000", "t:1"));
    if (registered.kind !== "REGISTERED") throw new Error("expected REGISTERED");

    const confirmed = env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "t:1:confirm", correlationId: randomUUID(), causationId: null,
    });

    expect(confirmed.kind).toBe("CONFIRMED");
    if (confirmed.kind !== "CONFIRMED") return;
    expect(confirmed.saleCompleted).toBe(true);
    expect(saleStatus(env.database, saleId).status).toBe("COMPLETED");
  });

  it("una versión desactualizada no confirma", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database);
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest(saleId, "10000.000000", "t:1"));
    if (registered.kind !== "REGISTERED") throw new Error("expected REGISTERED");

    const result = env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 99,
      idempotencyKey: "t:1:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(result.kind).toBe("VERSION_CONFLICT");
  });

  it("confirmar dos veces no imputa dos veces", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest(saleId, "10000.000000", "t:1"));
    if (registered.kind !== "REGISTERED") throw new Error("expected REGISTERED");

    const request = {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "t:1:confirm", correlationId: randomUUID(), causationId: null,
    };
    env.confirmTransfer.execute(SCOPE, SESSION, auth(), request);
    const second = env.confirmTransfer.execute(SCOPE, SESSION, auth(), request);

    expect(second.kind).toBe("IDEMPOTENT");
    const allocations = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=?",
    ).get(TENANT) as { n: number };
    expect(allocations.n).toBe(1);
  });
});


function qrProvider(): PaymentProviderPort {
  return {
    async createPaymentIntent(input) {
      return {
        providerCode: "TEST_QR",
        providerReference: `QR-INTENT-${input.paymentId}`,
        status: "PENDING" as const,
        checkout: null,
      };
    },
    async getPaymentStatus(): Promise<PaymentProviderEvidence> {
      return {
        providerCode: "TEST_QR",
        providerReference: "QR-INTENT-1",
        providerTransactionId: "TX-1",
        amount: "10000.000000",
        currencyCode: "COP",
        status: "APPROVED",
        receivedAt: NOW.toISOString(),
      };
    },
    async normalizeNotification(): Promise<PaymentProviderEvidence> {
      return {
        providerCode: "TEST_QR",
        providerReference: "QR-INTENT-1",
        providerTransactionId: "TX-1",
        amount: "10000.000000",
        currencyCode: "COP",
        status: "APPROVED",
        receivedAt: NOW.toISOString(),
      };
    },
  };
}

describe("QR — autoridad externa y confirmación por evidencia", () => {
  it("crea PENDING y sólo evidencia APPROVED inequívoca completa la venta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });

    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      idempotencyKey: "qr:1", correlationId: randomUUID(), causationId: null,
    });

    expect(registered.kind).toBe("PENDING");
    if (registered.kind !== "PENDING") return;

    const pending = env.get.execute(SCOPE, auth(), { paymentId: registered.paymentId });
    expect(pending.kind).toBe("FOUND");
    if (pending.kind !== "FOUND") return;
    expect(pending.payment.status).toBe("PENDING");
    expect(pending.payment.confirmedAmount).toBe("0.000000");

    const confirmed = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId,
      expectedVersion: 1,
      evidence: {
        providerCode: "TEST_QR",
        providerReference: registered.providerReference,
        providerTransactionId: "TX-1",
        amount: "10000.000000",
        currencyCode: "COP",
        status: "APPROVED",
        receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:1:confirm",
      correlationId: randomUUID(),
      causationId: null,
    });

    expect(confirmed.kind).toBe("CONFIRMED");
    if (confirmed.kind !== "CONFIRMED") return;
    expect(confirmed.saleCompleted).toBe(true);
    expect(saleStatus(env.database, saleId).status).toBe("COMPLETED");
  });

  it("rechaza evidencia REJECTED, incompleta o de proveedor/transacción distinta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      idempotencyKey: "qr:2", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    const rejected = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId, expectedVersion: 1,
      evidence: {
        providerCode: "TEST_QR", providerReference: registered.providerReference,
        providerTransactionId: "TX-2", amount: "10000.000000",
        currencyCode: "COP", status: "REJECTED", receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:2:reject", correlationId: randomUUID(), causationId: null,
    });
    expect(rejected.kind).toBe("EVIDENCE_NOT_AUTHORIZED");

    const wrongProvider = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId, expectedVersion: 1,
      evidence: {
        providerCode: "OTHER", providerReference: registered.providerReference,
        providerTransactionId: "TX-2", amount: "10000.000000",
        currencyCode: "COP", status: "APPROVED", receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:2:wrong-provider", correlationId: randomUUID(), causationId: null,
    });
    expect(wrongProvider.kind).toBe("PROVIDER_MISMATCH");

    expect(saleStatus(env.database, saleId).status).toBe("PAYMENT_IN_PROGRESS");
  });

  it("la misma transacción externa no puede confirmar otro pago", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const sale1 = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const sale2 = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });

    const first = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: sale1, amount: "10000.000000",
      idempotencyKey: "qr:3:a", correlationId: randomUUID(), causationId: null,
    });
    const second = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: sale2, amount: "10000.000000",
      idempotencyKey: "qr:3:b", correlationId: randomUUID(), causationId: null,
    });
    if (first.kind !== "PENDING" || second.kind !== "PENDING") throw new Error("expected PENDING");

    const a = env.confirmProvider.execute(SCOPE, {
      paymentId: first.paymentId, expectedVersion: 1,
      evidence: {
        providerCode: "TEST_QR", providerReference: first.providerReference,
        providerTransactionId: "TX-SAME", amount: "10000.000000",
        currencyCode: "COP", status: "APPROVED", receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:3:confirm-a", correlationId: randomUUID(), causationId: null,
    });
    expect(a.kind).toBe("CONFIRMED");

    const b = env.confirmProvider.execute(SCOPE, {
      paymentId: second.paymentId, expectedVersion: 1,
      evidence: {
        providerCode: "TEST_QR", providerReference: second.providerReference,
        providerTransactionId: "TX-SAME", amount: "10000.000000",
        currencyCode: "COP", status: "APPROVED", receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:3:confirm-b", correlationId: randomUUID(), causationId: null,
    });
    expect(b.kind).toBe("PROVIDER_TRANSACTION_CONFLICT");
    expect(saleStatus(env.database, sale2).status).toBe("PAYMENT_IN_PROGRESS");
  });
});

// ── MIGRATION_016 — transaction id observado antes de confirmar (DEC-016 §20) ──

describe("transacción de proveedor observada antes de confirmar", () => {
  it("persiste y relee el id observado sin cambiar el estado del pago", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      idempotencyKey: "qr:observed:1", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    expect(env.paymentStore.getObservedProviderTransaction(SCOPE, registered.paymentId)).toBeNull();

    const recorded = env.paymentStore.recordObservedProviderTransaction(
      SCOPE, registered.paymentId, "TX-REDIRECT-1", "2026-09-18T12:00:00.000Z",
    );
    expect(recorded).toEqual({ kind: "RECORDED" });

    expect(env.paymentStore.getObservedProviderTransaction(SCOPE, registered.paymentId)).toEqual({
      providerTransactionId: "TX-REDIRECT-1",
      observedAt: "2026-09-18T12:00:00.000Z",
    });

    // No autoritativo: el pago sigue PENDING, sólo confirmProviderPayment lo mueve.
    const pending = env.get.execute(SCOPE, auth(), { paymentId: registered.paymentId });
    if (pending.kind !== "FOUND") throw new Error("expected FOUND");
    expect(pending.payment.status).toBe("PENDING");
  });

  it("recording overwrites a previously observed id (last write wins for this non-authoritative hint)", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      idempotencyKey: "qr:observed:2", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    env.paymentStore.recordObservedProviderTransaction(SCOPE, registered.paymentId, "TX-A", "2026-09-18T12:00:00.000Z");
    env.paymentStore.recordObservedProviderTransaction(SCOPE, registered.paymentId, "TX-B", "2026-09-18T12:05:00.000Z");

    expect(env.paymentStore.getObservedProviderTransaction(SCOPE, registered.paymentId)).toEqual({
      providerTransactionId: "TX-B",
      observedAt: "2026-09-18T12:05:00.000Z",
    });
  });

  it("returns PAYMENT_NOT_FOUND for an unknown payment", async () => {
    const env = await buildEnv();
    const outcome = env.paymentStore.recordObservedProviderTransaction(
      SCOPE, randomUUID(), "TX-1", NOW.toISOString(),
    );
    expect(outcome).toEqual({ kind: "PAYMENT_NOT_FOUND" });
  });

  it("returns PAYMENT_NOT_RECONCILABLE once the payment is already CONFIRMED", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000",
      idempotencyKey: "qr:observed:3", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    const confirmed = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId, expectedVersion: 1,
      evidence: {
        providerCode: "TEST_QR", providerReference: registered.providerReference,
        providerTransactionId: "TX-CONFIRMED", amount: "10000.000000",
        currencyCode: "COP", status: "APPROVED", receivedAt: NOW.toISOString(),
      },
      idempotencyKey: "qr:observed:3:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(confirmed.kind).toBe("CONFIRMED");

    const outcome = env.paymentStore.recordObservedProviderTransaction(
      SCOPE, registered.paymentId, "TX-LATE", NOW.toISOString(),
    );
    expect(outcome).toEqual({ kind: "PAYMENT_NOT_RECONCILABLE" });
  });

  it("MIGRATION_016 enforces the id/timestamp pair and forbids two attempts from observing the same Wompi transaction", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const sale1 = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });
    const sale2 = seedSale(env.database, { cashRegisterId: REGISTER, shiftId, payable: "10000.000000" });

    const first = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: sale1, amount: "10000.000000",
      idempotencyKey: "qr:observed:4:a", correlationId: randomUUID(), causationId: null,
    });
    const second = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: sale2, amount: "10000.000000",
      idempotencyKey: "qr:observed:4:b", correlationId: randomUUID(), causationId: null,
    });
    if (first.kind !== "PENDING" || second.kind !== "PENDING") throw new Error("expected PENDING");

    // CHECK: no puede haber un id sin su timestamp de observación.
    expect(() => env.database.native.prepare(
      `UPDATE payments_payment_attempts SET observed_provider_transaction_id='TX-ORPHAN'
       WHERE tenant_id=? AND payment_id=?`,
    ).run(TENANT, first.paymentId)).toThrow(/CHECK/);

    // Índice único: el mismo id de Wompi no puede quedar observado en dos intentos.
    env.paymentStore.recordObservedProviderTransaction(SCOPE, first.paymentId, "TX-SHARED", NOW.toISOString());
    expect(() =>
      env.paymentStore.recordObservedProviderTransaction(SCOPE, second.paymentId, "TX-SHARED", NOW.toISOString()),
    ).toThrow(/UNIQUE/);
  });
});

// ── Idempotencia ──────────────────────────────────────────────────────────────

describe("idempotencia", () => {
  it("el reintento devuelve el mismo pago sin asentar caja de nuevo", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    const request = cashRequest(saleId, "10000.000000", "pay:1");

    const first = env.registerCash.execute(SCOPE, SESSION, auth(), request);
    const second = env.registerCash.execute(SCOPE, SESSION, auth(), request);

    expect(first.kind).toBe("CONFIRMED");
    expect(second.kind).toBe("IDEMPOTENT");
    if (first.kind !== "CONFIRMED" || second.kind !== "IDEMPOTENT") return;
    expect(second.paymentId).toBe(first.paymentId);

    const movements = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_SALE'",
    ).get(TENANT) as { n: number };
    expect(movements.n).toBe(1);
  });

  it("misma clave con distinto payload es conflicto", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "4000.000000", "pay:1"));
    const conflict = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "5000.000000", "pay:1"));

    expect(conflict.kind).toBe("IDEMPOTENCY_CONFLICT");
  });
});

// ── Cancelación ───────────────────────────────────────────────────────────────

describe("cancelación", () => {
  it("un pago no confirmado se cancela", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database);
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), {
      saleId, amount: "10000.000000", providerCode: null, providerReference: null,
      idempotencyKey: "t:1", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "REGISTERED") throw new Error("expected REGISTERED");

    const result = env.cancel.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "cancel:1", correlationId: randomUUID(), causationId: null,
    });

    expect(result.kind).toBe("CANCELLED");
    const payment = env.database.native.prepare(
      "SELECT status FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, registered.paymentId) as { status: string };
    expect(payment.status).toBe("CANCELLED");
  });

  it("un pago confirmado NO se cancela — DEC-002 prohíbe sobrescribirlo", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    const confirmed = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));
    if (confirmed.kind !== "CONFIRMED") throw new Error("expected CONFIRMED");

    const result = env.cancel.execute(SCOPE, SESSION, auth(), {
      paymentId: confirmed.paymentId, expectedVersion: 1,
      idempotencyKey: "cancel:1", correlationId: randomUUID(), causationId: null,
    });

    expect(result.kind).toBe("PAYMENT_NOT_CANCELLABLE");
  });
});

// ── Venta ─────────────────────────────────────────────────────────────────────

describe("guardas sobre la venta", () => {
  it("una venta ya completada no admite más pagos", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "1000.000000", "pay:2"));
    expect(result.kind).toBe("SALE_ALREADY_COMPLETED");
  });

  it("una venta inexistente o de otro tenant no es alcanzable", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    openShift(env);

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(randomUUID(), "1000.000000", "pay:1"));
    expect(result.kind).toBe("SALE_NOT_FOUND");
  });

  it("una venta en DRAFT no es pagable", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, status: "DRAFT" });

    const result = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "1000.000000", "pay:1"));
    expect(result.kind).toBe("SALE_NOT_PAYABLE");
  });
});

// ── Seguridad ─────────────────────────────────────────────────────────────────

describe("seguridad", () => {
  it("sin permiso de registro no se cobra", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId });

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(["CASH_SHIFT_OPEN"]), cashRequest(saleId, "10000.000000", "pay:1"),
    );
    expect(result.kind).toBe("UNAUTHORIZED");
  });

  it("reportar y confirmar exigen permisos distintos", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database);
    const reporterOnly = auth(["PAYMENTS_TRANSFER_REPORT"]);

    const registered = env.registerTransfer.execute(SCOPE, SESSION, reporterOnly, {
      saleId, amount: "10000.000000", providerCode: null, providerReference: null,
      idempotencyKey: "t:1", correlationId: randomUUID(), causationId: null,
    });
    expect(registered.kind).toBe("REGISTERED");
    if (registered.kind !== "REGISTERED") return;

    // Quien sólo puede reportar no puede atestiguar.
    const confirmed = env.confirmTransfer.execute(SCOPE, SESSION, reporterOnly, {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "t:1:c", correlationId: randomUUID(), causationId: null,
    });
    expect(confirmed.kind).toBe("UNAUTHORIZED");
  });

  it("el contrato IPC rechaza identidad e importe confirmado del llamador", () => {
    const base = {
      protocol_version: "1.0.0", payload_schema_version: "1.0.0",
      message_type: "payment.register.cash",
      request_id: randomUUID(), correlation_id: randomUUID(),
      operation_id: randomUUID(), idempotency_key: "k",
      payload: { sale_id: randomUUID(), amount: "1000.000000", tendered_amount: null },
    };

    // Campos de identidad en el sobre.
    for (const field of ["tenant_id", "company_id", "branch_id", "device_id", "actor_id"]) {
      expect(() => PaymentRegisterCashRequestSchema.parse({ ...base, [field]: randomUUID() }),
        `${field} must be rejected`).toThrow();
    }

    // El llamador no decide el importe confirmado ni la cobertura.
    expect(() => PaymentRegisterCashRequestSchema.parse({
      ...base, payload: { ...base.payload, confirmed_amount: "1000.000000" },
    })).toThrow();

    // Mutante sin idempotencia.
    const { idempotency_key: _key, ...withoutKey } = base;
    expect(() => PaymentRegisterCashRequestSchema.parse(withoutKey)).toThrow();

    // Confirmación sin versión esperada.
    expect(() => PaymentTransferConfirmRequestSchema.parse({
      ...base, message_type: "payment.transfer.confirm",
      payload: { payment_id: randomUUID() },
    })).toThrow();
  });
});

// ── Consulta ──────────────────────────────────────────────────────────────────

describe("consulta", () => {
  it("devuelve el pago con su estado e importes", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    const confirmed = env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));
    if (confirmed.kind !== "CONFIRMED") throw new Error("expected CONFIRMED");

    const result = env.get.execute(SCOPE, auth(), { paymentId: confirmed.paymentId });

    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") return;
    expect(result.payment.status).toBe("CONFIRMED");
    expect(result.payment.method).toBe("CASH");
    expect(result.payment.saleId).toBe(saleId);
    expect(result.payment.confirmedAmount).toBe("10000.000000");
  });

  it("un pago inexistente devuelve NOT_FOUND", async () => {
    const env = await buildEnv();
    const result = env.get.execute(SCOPE, auth(), { paymentId: randomUUID() });
    expect(result.kind).toBe("NOT_FOUND");
  });

  it("sin permiso de lectura no se consulta", async () => {
    const env = await buildEnv();
    const result = env.get.execute(SCOPE, auth([]), { paymentId: randomUUID() });
    expect(result.kind).toBe("UNAUTHORIZED");
  });
});

// ── Auditoría y outbox ────────────────────────────────────────────────────────

describe("auditoría y outbox", () => {
  it("un cobro completo deja auditoría y outbox de pago y de venta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:1"));

    const audit = env.database.native.prepare(
      `SELECT action_code, actor_type, actor_id FROM local_operation_audit
       WHERE action_code IN ('PAYMENT_CONFIRMED','SALE_COMPLETED') ORDER BY action_code`,
    ).all() as Array<{ action_code: string; actor_type: string; actor_id: string }>;
    expect(audit.map((row) => row.action_code)).toEqual(["PAYMENT_CONFIRMED", "SALE_COMPLETED"]);
    expect(audit.every((row) => row.actor_type === "USER" && row.actor_id === USER)).toBe(true);

    const outbox = env.database.native.prepare(
      `SELECT operation_type FROM local_sync_outbox
       WHERE operation_type IN ('PAYMENT_CONFIRMED','SALE_COMPLETED') ORDER BY operation_type`,
    ).all() as Array<{ operation_type: string }>;
    expect(outbox.map((row) => row.operation_type)).toEqual(["PAYMENT_CONFIRMED", "SALE_COMPLETED"]);
  });

  it("un pago rechazado no deja outbox", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    env.registerCash.execute(SCOPE, SESSION, auth(), cashRequest(saleId, "99999.000000", "pay:1"));

    const outbox = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM local_sync_outbox WHERE operation_type LIKE 'PAYMENT_%'",
    ).get() as { n: number };
    expect(outbox.n).toBe(0);
  });
});

// ── Idempotencia canónica en runtime_operations (D-1 / D-2) ──────────────────

/**
 * `runtime_operations` es el ancla canónica de idempotencia de las operaciones
 * Payment. Estas pruebas fijan las dos correcciones:
 *
 * `D-1` — confirmar NO sobrescribe la clave del registro.
 * `D-2` — un conflicto de clave es un resultado de contrato, jamás un
 *          `SqliteError` que el canal IPC traduciría en cierre de socket.
 */
describe("idempotencia anclada en runtime_operations", () => {
  function transfer(saleId: string, amount: string, key: string) {
    return {
      saleId, amount, providerCode: null, providerReference: null,
      idempotencyKey: key, correlationId: randomUUID(), causationId: null,
    };
  }

  it("1. registrar una transferencia dos veces es idempotente", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const request = transfer(saleId, "4000.000000", "reg:1");

    const first = env.registerTransfer.execute(SCOPE, SESSION, auth(), request);
    const second = env.registerTransfer.execute(SCOPE, SESSION, auth(), request);

    expect(first.kind).toBe("REGISTERED");
    expect(second.kind).toBe("IDEMPOTENT");
    if (first.kind !== "REGISTERED" || second.kind !== "IDEMPOTENT") return;
    expect(second.paymentId).toBe(first.paymentId);

    const payments = env.database.native.prepare(
      "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?",
    ).get(TENANT) as { n: number };
    expect(payments.n).toBe(1);
  });

  it("2. confirmar dos veces es idempotente", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "4000.000000", "reg:1"));
    if (registered.kind !== "REGISTERED") throw new Error("setup");

    const confirmRequest = {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "conf:1", correlationId: randomUUID(), causationId: null,
    };
    const first = env.confirmTransfer.execute(SCOPE, SESSION, auth(), confirmRequest);
    const second = env.confirmTransfer.execute(SCOPE, SESSION, auth(), confirmRequest);

    expect(first.kind).toBe("CONFIRMED");
    expect(second.kind).toBe("IDEMPOTENT");
  });

  it("3. confirmar con la misma clave y distinto checksum es IDEMPOTENCY_CONFLICT", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const a = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "4000.000000", "reg:A"));
    const b = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "5000.000000", "reg:B"));
    if (a.kind !== "REGISTERED" || b.kind !== "REGISTERED") throw new Error("setup");

    env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: a.paymentId, expectedVersion: 1,
      idempotencyKey: "conf:shared", correlationId: randomUUID(), causationId: null,
    });

    // Misma clave, otro pago ⇒ otro checksum. Resultado de contrato, no excepción.
    let outcome: string;
    try {
      outcome = env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
        paymentId: b.paymentId, expectedVersion: 1,
        idempotencyKey: "conf:shared", correlationId: randomUUID(), causationId: null,
      }).kind;
    } catch (error) {
      outcome = `THREW: ${(error as Error).message}`;
    }
    expect(outcome).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("4. cancelar dos veces es idempotente", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database);
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "4000.000000", "reg:1"));
    if (registered.kind !== "REGISTERED") throw new Error("setup");

    const cancelRequest = {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "cancel:1", correlationId: randomUUID(), causationId: null,
    };
    const first = env.cancel.execute(SCOPE, SESSION, auth(), cancelRequest);
    const second = env.cancel.execute(SCOPE, SESSION, auth(), cancelRequest);

    expect(first.kind).toBe("CANCELLED");
    expect(second.kind).toBe("IDEMPOTENT");
  });

  it("5. cancelar con la misma clave y distinto checksum es IDEMPOTENCY_CONFLICT", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database);
    const a = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "4000.000000", "reg:A"));
    const b = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "5000.000000", "reg:B"));
    if (a.kind !== "REGISTERED" || b.kind !== "REGISTERED") throw new Error("setup");

    env.cancel.execute(SCOPE, SESSION, auth(), {
      paymentId: a.paymentId, expectedVersion: 1,
      idempotencyKey: "cancel:shared", correlationId: randomUUID(), causationId: null,
    });

    let outcome: string;
    try {
      outcome = env.cancel.execute(SCOPE, SESSION, auth(), {
        paymentId: b.paymentId, expectedVersion: 1,
        idempotencyKey: "cancel:shared", correlationId: randomUUID(), causationId: null,
      }).kind;
    } catch (error) {
      outcome = `THREW: ${(error as Error).message}`;
    }
    expect(outcome).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("6. el registro original sigue siendo idempotente DESPUÉS de confirmar", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const request = transfer(saleId, "10000.000000", "reg:1");
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), request);
    if (registered.kind !== "REGISTERED") throw new Error("setup");

    env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "conf:1", correlationId: randomUUID(), causationId: null,
    });

    // D-1: la fila conserva la clave de registro, de modo que el reintento del
    // registro original sigue reconociéndose.
    const stored = env.database.native.prepare(
      "SELECT idempotency_key FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(TENANT, registered.paymentId) as { idempotency_key: string };
    expect(stored.idempotency_key).toBe("reg:1");

    const replay = env.registerTransfer.execute(SCOPE, SESSION, auth(), request);
    expect(replay.kind).toBe("IDEMPOTENT");
    if (replay.kind !== "IDEMPOTENT") return;
    expect(replay.paymentId).toBe(registered.paymentId);
  });

  it("7. transferencia PARCIAL: registro→confirmación→registro no duplica nada ni lanza", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    // 4000 de 10000: la venta NO se completa, de modo que la guarda
    // SALE_ALREADY_COMPLETED no puede enmascarar el defecto.
    const request = transfer(saleId, "4000.000000", "reg:1");
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), request);
    if (registered.kind !== "REGISTERED") throw new Error("setup");

    env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "conf:1", correlationId: randomUUID(), causationId: null,
    });
    expect(saleStatus(env.database, saleId).status).toBe("PAYMENT_IN_PROGRESS");

    let replayKind: string;
    try {
      replayKind = env.registerTransfer.execute(SCOPE, SESSION, auth(), request).kind;
    } catch (error) {
      replayKind = `THREW: ${(error as Error).message}`;
    }
    expect(replayKind).toBe("IDEMPOTENT");

    const counts = env.database.native.prepare(
      `SELECT
         (SELECT COUNT(*) FROM payments_payments WHERE tenant_id=?) AS payments,
         (SELECT COUNT(*) FROM payments_payment_allocations WHERE tenant_id=?) AS allocations,
         (SELECT COUNT(*) FROM local_sync_outbox WHERE operation_type='SALE_COMPLETED') AS completions,
         (SELECT COUNT(*) FROM runtime_operations WHERE idempotency_key='reg:1') AS registerOps`,
    ).get(TENANT, TENANT) as
      { payments: number; allocations: number; completions: number; registerOps: number };

    expect(counts.payments).toBe(1);
    expect(counts.allocations).toBe(1);
    expect(counts.completions).toBe(0);
    expect(counts.registerOps).toBe(1);
  });

  it("8. una repetición legítima nunca produce una excepción que rompa el canal IPC", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });

    // Se repiten las tres operaciones mutantes; ninguna debe lanzar.
    const cashRequestValue = cashRequest(saleId, "10000.000000", "cash:1");
    const transferSale = seedSale(env.database, { payable: "10000.000000" });
    const transferRequest = transfer(transferSale, "4000.000000", "reg:1");

    expect(() => {
      env.registerCash.execute(SCOPE, SESSION, auth(), cashRequestValue);
      env.registerCash.execute(SCOPE, SESSION, auth(), cashRequestValue);

      const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest);
      env.registerTransfer.execute(SCOPE, SESSION, auth(), transferRequest);
      if (registered.kind !== "REGISTERED") throw new Error("setup");

      const confirmRequest = {
        paymentId: registered.paymentId, expectedVersion: 1,
        idempotencyKey: "conf:1", correlationId: randomUUID(), causationId: null,
      };
      env.confirmTransfer.execute(SCOPE, SESSION, auth(), confirmRequest);
      env.confirmTransfer.execute(SCOPE, SESSION, auth(), confirmRequest);
    }).not.toThrow();
  });

  it("9. cada operación deja su propia fila en runtime_operations", async () => {
    const env = await buildEnv();
    const saleId = seedSale(env.database, { payable: "10000.000000" });
    const registered = env.registerTransfer.execute(SCOPE, SESSION, auth(), transfer(saleId, "10000.000000", "reg:1"));
    if (registered.kind !== "REGISTERED") throw new Error("setup");

    env.confirmTransfer.execute(SCOPE, SESSION, auth(), {
      paymentId: registered.paymentId, expectedVersion: 1,
      idempotencyKey: "conf:1", correlationId: randomUUID(), causationId: null,
    });

    const keys = env.database.native.prepare(
      `SELECT idempotency_key, result_code FROM runtime_operations
       WHERE idempotency_key IN ('reg:1','conf:1','sale_completion:conf:1')
       ORDER BY idempotency_key`,
    ).all() as Array<{ idempotency_key: string; result_code: string }>;

    expect(keys).toEqual([
      { idempotency_key: "conf:1", result_code: "PAYMENT_CONFIRMED" },
      { idempotency_key: "reg:1", result_code: "PAYMENT_REGISTERED" },
      { idempotency_key: "sale_completion:conf:1", result_code: "SALE_COMPLETED" },
    ]);
  });
});

// ── Inventario: la mercancía sale con la venta ───────────────────────────────

describe("salida de existencia al completar la venta", () => {
  /** Da entrada a existencia por el almacén, que aquí es fixture. */
  function seedStock(
    env: Awaited<ReturnType<typeof buildEnv>>,
    presentationId: string,
    quantity: string,
  ): void {
    const outcome = env.inventoryStore.appendMovementInTransaction({
      scope: SCOPE,
      sessionId: SESSION,
      operatorUserId: USER,
      movementId: randomUUID(),
      operationId: randomUUID(),
      presentationId,
      movementType: "OPENING_COUNT",
      quantity,
      reasonCode: "FIXTURE",
      saleId: null,
      businessDate: "2026-09-06",
      idempotencyKey: `fixture-stock:${presentationId}`,
      requestChecksum: "f".repeat(64),
      correlationId: randomUUID(),
      causationId: null,
    });
    if (outcome.kind !== "POSTED") throw new Error(`stock fixture failed: ${outcome.kind}`);
  }

  it("descuenta lo vendido en la misma transacción que completa la venta", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    const { presentationId } = seedSaleLine(env.database, saleId, "2.000000");
    seedStock(env, presentationId, "5.000000");

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:stock:1"),
    );

    expect(result.kind).toBe("CONFIRMED");
    if (result.kind !== "CONFIRMED") return;
    expect(result.saleCompleted).toBe(true);
    expect(saleStatus(env.database, saleId).status).toBe("COMPLETED");

    const stock = env.inventoryStore.getStock(SCOPE, presentationId);
    expect(stock?.quantityOnHand).toBe("3.000000");

    const movement = env.database.native.prepare(
      `SELECT movement_type, direction, quantity, sale_id FROM inventory_movement
       WHERE tenant_id=? AND sale_id=?`,
    ).get(TENANT, saleId) as {
      movement_type: string; direction: string; quantity: string; sale_id: string;
    };
    expect(movement.movement_type).toBe("SALE");
    expect(movement.direction).toBe("OUT");
    expect(movement.quantity).toBe("2.000000");
  });

  /**
   * El caso que obliga a que todo sea una sola transacción: la existencia
   * desapareció entre crear y cobrar. El cobro **entero** se revierte, de modo
   * que el cajero lo ve antes de que el dinero quede tomado.
   */
  it("revierte el cobro completo si ya no hay existencia que sacar", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    const { presentationId } = seedSaleLine(env.database, saleId, "2.000000");
    seedStock(env, presentationId, "1.000000");

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:stock:2"),
    );

    expect(result.kind).toBe("INSUFFICIENT_STOCK");
    if (result.kind !== "INSUFFICIENT_STOCK") return;
    expect(result.presentationId).toBe(presentationId);
    expect(result.available).toBe("1.000000");

    // Nada quedó escrito: ni pago, ni movimiento de caja, ni salida de mercancía,
    // y la venta sigue cobrable.
    const payments = env.database.native.prepare(
      "SELECT COUNT(*) AS total FROM payments_payments WHERE tenant_id=?",
    ).get(TENANT) as { total: number };
    const cashSales = env.database.native.prepare(
      "SELECT COUNT(*) AS total FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_SALE'",
    ).get(TENANT) as { total: number };
    const deductions = env.database.native.prepare(
      "SELECT COUNT(*) AS total FROM inventory_movement WHERE tenant_id=? AND movement_type='SALE'",
    ).get(TENANT) as { total: number };

    expect(payments.total).toBe(0);
    expect(cashSales.total).toBe(0);
    expect(deductions.total).toBe(0);
    expect(saleStatus(env.database, saleId).status).toBe("READY_FOR_PAYMENT");
    expect(env.inventoryStore.getStock(SCOPE, presentationId)?.quantityOnHand).toBe("1.000000");
  });

  it("un producto sin control de existencia no genera movimiento", async () => {
    const env = await buildEnv();
    seedRegister(env.database);
    const shiftId = openShift(env);
    const saleId = seedSale(env.database, { shiftId, payable: "10000.000000" });
    // Línea real, con producto sin control y **sin existencia sembrada**: si el
    // filtro por `stock_controlled` desapareciera, el descuento fallaría por
    // falta de existencia y esta prueba lo vería.
    seedSaleLine(env.database, saleId, "2.000000", false);

    const result = env.registerCash.execute(
      SCOPE, SESSION, auth(), cashRequest(saleId, "10000.000000", "pay:stock:3"),
    );

    expect(result.kind).toBe("CONFIRMED");
    const movements = env.database.native.prepare(
      "SELECT COUNT(*) AS total FROM inventory_movement WHERE tenant_id=?",
    ).get(TENANT) as { total: number };
    expect(movements.total).toBe(0);
  });
});
