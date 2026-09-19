import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import { SqliteCustomerStore } from "../src/customers/sqlite-customer-store.js";
import { RegisterCustomerUseCase } from "../src/customers/register-customer-use-case.js";
import { SqliteCreditStore } from "../src/credit/sqlite-credit-store.js";
import { OpenCreditAccountUseCase } from "../src/credit/open-credit-account-use-case.js";
import { GetCreditAccountUseCase } from "../src/credit/get-credit-account-use-case.js";
import { RegisterCreditPaymentUseCase } from "../src/credit/register-credit-payment-use-case.js";
import { RegisterCreditRepaymentUseCase } from "../src/credit/register-credit-repayment-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

/**
 * Crédito al cliente — `DEC-005`, `CUST-002` / `PAY-009`.
 *
 * Todo corre contra SQLite real y contra los casos de uso reales: la venta se
 * crea con su caso de uso, se fía con el suyo y se abona con el suyo. No hay
 * dobles sustituyendo la persistencia, porque lo que hay que demostrar —que la
 * deuda es el libro y que el cupo se respeta— sólo es cierto en disco.
 */

const TENANT = "018f0000-0000-7000-8000-0000000000e1";
const COMPANY = "018f0000-0000-7000-8000-0000000000e2";
const BRANCH = "018f0000-0000-7000-8000-0000000000e3";
const DEVICE = "018f0000-0000-7000-8000-0000000000e4";
const INSTALL = "018f0000-0000-7000-8000-0000000000e5";
const USER = "018f0000-0000-7000-8000-0000000000e6";
const SESSION = "018f0000-0000-7000-8000-0000000000e8";
const CAJA = "018f0000-0000-7000-8000-00000000ee01";

const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000f1";
const OTHER_COMPANY = "018f0000-0000-7000-8000-0000000000f2";
const OTHER_BRANCH = "018f0000-0000-7000-8000-0000000000f3";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const OTHER_SCOPE: SyncScope = {
  tenantId: OTHER_TENANT, companyId: OTHER_COMPANY, branchId: OTHER_BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const BUSINESS_DATE = "2026-09-06";
const ALL_PERMISSIONS = [
  "CASH_SHIFT_OPEN", "CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER", "CUSTOMERS_CUSTOMER_REGISTER",
  "CUSTOMERS_CREDIT_ACCOUNT_MANAGE", "CUSTOMERS_CREDIT_ACCOUNT_READ",
  "CUSTOMERS_CREDIT_REPAYMENT_REGISTER", "PAYMENTS_CREDIT_AUTHORIZE",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(
  permissions: readonly string[] = ALL_PERMISSIONS,
  scope: SyncScope = SCOPE,
): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ef",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: scope.tenantId, company_id: scope.companyId, branch_id: scope.branchId,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

function seedRegister(db: LocalDatabase, scope: SyncScope): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(
    scope.tenantId, scope.companyId, scope.branchId, at,
    JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at,
  );
  db.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-01','caja-01','Caja 01','COP','ACTIVE',?,NULL,1,1)`,
  ).run(CAJA, scope.tenantId, scope.companyId, scope.branchId, at);
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-credit-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  seedRegister(database, SCOPE);
  seedRegister(database, OTHER_SCOPE);

  const at = (): Date => NOW;
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, at);
  const inventoryStore = new SqliteInventoryStore(database, sync, at);
  const cashStore = new SqliteCashShiftStore(database, sync, at);
  const masterStore = new SqliteMasterSnapshotStore(database, at);
  const saleStore = new SqliteSaleStore(database, sync, at);
  const customerStore = new SqliteCustomerStore(database, sync, at);
  const creditStore = new SqliteCreditStore(database, sync, cashStore, at);
  const paymentStore = new SqlitePaymentStore(
    database, sync, cashStore, inventoryStore, at, creditStore,
  );

  return {
    database, creditStore, paymentStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, at),
    registerProduct: new RegisterProductUseCase(catalogStore),
    receiveStock: new ReceiveStockUseCase(inventoryStore),
    createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashStore, saleStore, at),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, at),
    registerCustomer: new RegisterCustomerUseCase(customerStore),
    openAccount: new OpenCreditAccountUseCase(creditStore, at),
    getAccount: new GetCreditAccountUseCase(creditStore, at),
    payOnCredit: new RegisterCreditPaymentUseCase(paymentStore, at),
    repay: new RegisterCreditRepaymentUseCase(creditStore, at),
    /** Sin proveedor de crédito: un despliegue que no fía. */
    paymentStoreWithoutCredit: new SqlitePaymentStore(
      database, sync, cashStore, inventoryStore, at,
    ),
  };
}
type Env = Awaited<ReturnType<typeof buildEnv>>;

const FISCAL = {
  identificationDocumentCode: "13",
  verificationDigit: null,
  legalOrganizationCode: "2",
  company: null,
  names: "Ana Restrepo",
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: null, phone: null, address: null,
  countryCode: "CO", municipalityCode: "05001",
} as const;

let customerSeed = 0;
function registerCustomer(env: Env, scope: SyncScope = SCOPE): string {
  customerSeed += 1;
  const identification = `10203040${String(customerSeed).padStart(2, "0")}`;
  const result = env.registerCustomer.execute(scope, SESSION, auth(ALL_PERMISSIONS, scope), {
    customer: { ...FISCAL, identification },
    idempotencyKey: `customer:credit:${scope.tenantId}:${identification}`,
    correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "REGISTERED") throw new Error(`expected REGISTERED, got ${result.kind}`);
  return result.customerId;
}

let accountSeed = 0;
function openAccount(
  env: Env, customerId: string, creditLimit: string, scope: SyncScope = SCOPE,
) {
  accountSeed += 1;
  return env.openAccount.execute(scope, SESSION, auth(ALL_PERMISSIONS, scope), {
    customerId, creditLimit, currencyCode: "COP",
    idempotencyKey: `credit:account:${String(accountSeed)}`,
    correlationId: randomUUID(), causationId: null,
  });
}

function openShift(env: Env, key = "shift:credit:1"): string {
  const result = env.openShift.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: CAJA, openingAmount: "0.000000",
    businessDate: BUSINESS_DATE, timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

let productSeed = 0;
function seedProduct(env: Env, quantity = "50.000000") {
  productSeed += 1;
  const suffix = String(productSeed).padStart(3, "0");
  const product = env.registerProduct.execute(SCOPE, SESSION, auth(), {
    code: `PANELA-${suffix}`, name: "Panela", stockControlled: true,
    presentationName: "Libra", unitCode: "LBR", unitPrecision: 0,
    barcode: `770333333${suffix}0`,
    priceAmount: "5000.000000", currencyCode: "COP",
    idempotencyKey: `catalog:credit:${suffix}`,
    correlationId: randomUUID(), causationId: null,
  });
  if (product.kind !== "REGISTERED") throw new Error(product.kind);

  const received = env.receiveStock.execute(SCOPE, SESSION, auth(), {
    presentationId: product.presentationId,
    movementType: "PURCHASE_RECEIPT",
    quantity,
    reasonCode: "INITIAL_LOAD",
    businessDate: BUSINESS_DATE,
    idempotencyKey: `stock:credit:${suffix}`,
    correlationId: randomUUID(), causationId: null,
  });
  if (received.kind !== "POSTED") throw new Error(received.kind);
  return { productId: product.productId, presentationId: product.presentationId };
}

let saleSeed = 0;
function createSale(
  env: Env,
  item: { productId: string; presentationId: string },
  options: { customerId?: string | null; quantity?: string } = {},
) {
  saleSeed += 1;
  return env.createSale.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: CAJA,
    ...(options.customerId === undefined ? {} : { customerId: options.customerId }),
    idempotencyKey: `sale:credit:${String(saleSeed)}`,
    channel: "POS_LOCAL", businessDate: BUSINESS_DATE,
    timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    documentSeries: "FS-001", currencyCode: "COP",
    correlationId: randomUUID(), causationId: null,
    lines: [{
      productId: item.productId, presentationId: item.presentationId,
      quantity: options.quantity ?? "1.000000",
    }],
  });
}

/** Una venta lista para fiar, por sus casos de uso reales. */
async function saleOnCredit(options: { limit?: string; quantity?: string } = {}) {
  const env = await buildEnv();
  openShift(env);
  const customerId = registerCustomer(env);
  const opened = openAccount(env, customerId, options.limit ?? "100000.000000");
  if (opened.kind !== "OPENED") throw new Error(opened.kind);
  const item = seedProduct(env);
  const sale = createSale(env, item, { customerId, quantity: options.quantity ?? "1.000000" });
  if (sale.kind !== "CREATED") throw new Error(sale.kind);
  return { env, customerId, accountId: opened.accountId, sale, item };
}

function payOnCredit(env: Env, saleId: string, amount: string, key = "credit:pay:1", permissions = ALL_PERMISSIONS) {
  return env.payOnCredit.execute(SCOPE, SESSION, auth(permissions), {
    saleId, amount, idempotencyKey: key, correlationId: randomUUID(), causationId: null,
  });
}

function saleRow(db: LocalDatabase, saleId: string) {
  return db.native.prepare(
    "SELECT status, customer_id, completed_at FROM sales_sales WHERE tenant_id=? AND id=?",
  ).get(TENANT, saleId) as { status: string; customer_id: string | null; completed_at: string | null };
}

function count(db: LocalDatabase, sql: string, ...params: unknown[]): number {
  return (db.native.prepare(sql).get(...params) as { n: number }).n;
}

// ── El flujo completo ────────────────────────────────────────────────────────

describe("la venta a crédito cubre, completa y deja la deuda en el libro", () => {
  // 1-8
  it("con cupo suficiente confirma, imputa, endeuda, completa y descuenta — sin tocar caja", async () => {
    const { env, customerId, accountId, sale } = await saleOnCredit({ limit: "100000.000000" });
    const cashBefore = count(env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=?", TENANT);

    const paid = payOnCredit(env, sale.saleId, sale.payableAmount);

    // 2: el pago confirma.
    expect(paid.kind).toBe("CONFIRMED");
    if (paid.kind !== "CONFIRMED") return;
    expect(paid.saleCompleted).toBe(true);

    const payment = env.database.native.prepare(
      `SELECT payment_method, authority_type, status, confirmed_amount
       FROM payments_payments WHERE tenant_id=? AND id=?`,
    ).get(TENANT, paid.paymentId) as {
      payment_method: string; authority_type: string; status: string; confirmed_amount: string;
    };
    expect(payment.payment_method).toBe("CUSTOMER_CREDIT");
    expect(payment.status).toBe("CONFIRMED");
    // Se reutiliza la autoridad existente: nadie lee esta columna y
    // `payment_method` ya distingue el crédito.
    expect(payment.authority_type).toBe("MANUAL_ATTESTATION");
    expect(payment.confirmed_amount).toBe(sale.payableAmount);

    // 3: la cobertura existe a través de la imputación, como cualquier medio.
    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=? AND payment_id=?",
      TENANT, paid.paymentId,
    )).toBe(1);

    // 4: la obligación queda en el libro.
    const ledger = env.database.native.prepare(
      `SELECT transaction_type, direction, amount, sale_id, payment_id, account_sequence
       FROM customers_credit_transactions WHERE tenant_id=? AND credit_account_id=?`,
    ).all(TENANT, accountId) as Array<{
      transaction_type: string; direction: string; amount: string;
      sale_id: string | null; payment_id: string | null; account_sequence: number;
    }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      transaction_type: "SALE_CREDIT", direction: "INCREASE",
      amount: sale.payableAmount, sale_id: sale.saleId, payment_id: paid.paymentId,
      account_sequence: 1,
    });

    // 5: la venta se completa.
    const completed = saleRow(env.database, sale.saleId);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completed_at).not.toBeNull();
    expect(completed.customer_id).toBe(customerId);

    // 6: la mercancía sale, porque el cliente se la llevó.
    expect(count(
      env.database, "SELECT COUNT(*) AS n FROM inventory_movement WHERE tenant_id=? AND sale_id=?",
      TENANT, sale.saleId,
    )).toBe(1);

    // 7: cero efectivo ficticio.
    expect(count(env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=?", TENANT))
      .toBe(cashBefore);

    // El saldo derivado y el cupo disponible cuadran.
    const account = env.getAccount.execute(SCOPE, auth(), { customerId });
    expect(account.kind).toBe("FOUND");
    if (account.kind !== "FOUND") return;
    expect(account.account.outstandingBalance).toBe(sale.payableAmount);
    expect(account.account.availableCredit).toBe("95000.000000");
  });

  // 8: el crédito no necesita turno.
  it("fía sin turno de caja abierto", async () => {
    const env = await buildEnv();
    const customerId = registerCustomer(env);
    if (openAccount(env, customerId, "100000.000000").kind !== "OPENED") throw new Error("account");
    const item = seedProduct(env);
    // Sin `openShift`: la venta nace sin turno y el efectivo la rechazaría.
    const sale = createSale(env, item, { customerId });
    if (sale.kind !== "CREATED") throw new Error(sale.kind);

    expect(payOnCredit(env, sale.saleId, sale.payableAmount).kind).toBe("CONFIRMED");
    expect(saleRow(env.database, sale.saleId).status).toBe("COMPLETED");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=?", TENANT)).toBe(0);
  });

  // 9, 10, 11
  it("el cupo es un rechazo duro: justo en el límite pasa, un peso más no", async () => {
    // Cupo exacto para una unidad de 5.000.
    const exact = await saleOnCredit({ limit: "5000.000000" });
    expect(payOnCredit(exact.env, exact.sale.saleId, exact.sale.payableAmount).kind).toBe("CONFIRMED");

    // Un peso por debajo del importe: no alcanza.
    const short = await saleOnCredit({ limit: "4999.000000" });
    const rejected = payOnCredit(short.env, short.sale.saleId, short.sale.payableAmount);
    expect(rejected.kind).toBe("CREDIT_LIMIT_EXCEEDED");
    if (rejected.kind !== "CREDIT_LIMIT_EXCEEDED") return;
    expect(rejected.availableCredit).toBe("4999.000000");

    // Y nada quedó escrito.
    expect(count(short.env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(0);
    expect(count(short.env.database, "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=?", TENANT)).toBe(0);
    expect(saleRow(short.env.database, short.sale.saleId).status).toBe("READY_FOR_PAYMENT");
  });

  it("el cupo se agota con la suma de las ventas, no con cada una por separado", async () => {
    const { env, customerId } = await saleOnCredit({ limit: "7000.000000" });
    const first = createSale(env, seedProduct(env), { customerId });
    const second = createSale(env, seedProduct(env), { customerId });
    if (first.kind !== "CREATED" || second.kind !== "CREATED") throw new Error("sale");

    expect(payOnCredit(env, first.saleId, first.payableAmount, "credit:pay:a").kind).toBe("CONFIRMED");
    // La segunda cabría sola —5.000 < 7.000— pero no sumada a la primera.
    expect(payOnCredit(env, second.saleId, second.payableAmount, "credit:pay:b").kind)
      .toBe("CREDIT_LIMIT_EXCEEDED");
  });

  // 12
  it("una venta sin adquiriente no se puede fiar", async () => {
    const env = await buildEnv();
    registerCustomer(env);
    const sale = createSale(env, seedProduct(env));
    if (sale.kind !== "CREATED") throw new Error(sale.kind);

    expect(payOnCredit(env, sale.saleId, sale.payableAmount).kind).toBe("CUSTOMER_REQUIRED");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(0);
  });

  // 13
  it("un cliente sin cuenta de crédito no fía: no se le abre una sola", async () => {
    const env = await buildEnv();
    const customerId = registerCustomer(env);
    const sale = createSale(env, seedProduct(env), { customerId });
    if (sale.kind !== "CREATED") throw new Error(sale.kind);

    expect(payOnCredit(env, sale.saleId, sale.payableAmount).kind).toBe("CREDIT_ACCOUNT_NOT_FOUND");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_accounts WHERE tenant_id=?", TENANT)).toBe(0);
  });

  // 14
  it("sin el permiso de crédito no se fía y no se escribe nada", async () => {
    const { env, sale } = await saleOnCredit();
    const withoutCredit = ALL_PERMISSIONS.filter((code) => code !== "PAYMENTS_CREDIT_AUTHORIZE");

    const result = payOnCredit(env, sale.saleId, sale.payableAmount, "credit:pay:1", withoutCredit);

    expect(result.kind).toBe("UNAUTHORIZED");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(0);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=?", TENANT)).toBe(0);
  });

  it("un despliegue sin crédito cableado lo dice en vez de fallar", async () => {
    const { env, sale } = await saleOnCredit();
    const useCase = new RegisterCreditPaymentUseCase(env.paymentStoreWithoutCredit, () => NOW);

    const result = useCase.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId, amount: sale.payableAmount,
      idempotencyKey: "credit:pay:nowire", correlationId: randomUUID(), causationId: null,
    });

    expect(result.kind).toBe("CREDIT_NOT_AVAILABLE");
  });

  // 17, 18, 26
  it("un reintento no duplica deuda, imputación ni cobertura", async () => {
    const { env, accountId, sale } = await saleOnCredit();

    const first = payOnCredit(env, sale.saleId, sale.payableAmount, "credit:pay:same");
    const replay = payOnCredit(env, sale.saleId, sale.payableAmount, "credit:pay:same");

    expect(first.kind).toBe("CONFIRMED");
    expect(replay.kind).toBe("IDEMPOTENT");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(1);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payment_attempts WHERE tenant_id=?", TENANT)).toBe(1);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=?", TENANT)).toBe(1);
    expect(count(
      env.database, "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=? AND credit_account_id=?",
      TENANT, accountId,
    )).toBe(1);
    expect(env.creditStore.outstandingBalance(SCOPE, accountId))
      .toBe(5_000_000_000n);
  });

  it("la misma clave con otro importe es conflicto, no una repetición", async () => {
    const { env, sale } = await saleOnCredit();

    expect(payOnCredit(env, sale.saleId, sale.payableAmount, "credit:pay:same").kind).toBe("CONFIRMED");
    expect(payOnCredit(env, sale.saleId, "1000.000000", "credit:pay:same").kind).toBe("IDEMPOTENCY_CONFLICT");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=?", TENANT)).toBe(1);
  });

  // 24
  it("auditoría y outbox cuentan la venta a crédito sin inventar códigos", async () => {
    const { env, sale } = await saleOnCredit();
    payOnCredit(env, sale.saleId, sale.payableAmount);

    const audit = (env.database.native.prepare(
      `SELECT action_code FROM local_operation_audit WHERE tenant_id=?
         AND action_code IN ('CREDIT_ACCOUNT_OPENED','CREDIT_SALE_RECORDED','PAYMENT_CONFIRMED','SALE_COMPLETED')
       ORDER BY rowid`,
    ).all(TENANT) as Array<{ action_code: string }>).map((row) => row.action_code);

    expect(audit).toEqual([
      "CREDIT_ACCOUNT_OPENED", "CREDIT_SALE_RECORDED", "PAYMENT_CONFIRMED", "SALE_COMPLETED",
    ]);

    const outbox = (env.database.native.prepare(
      `SELECT operation_type FROM local_sync_outbox WHERE tenant_id=?
         AND operation_type IN ('CREDIT_ACCOUNT_OPENED','CREDIT_SALE_RECORDED','PAYMENT_CONFIRMED','SALE_COMPLETED')
       ORDER BY local_sequence`,
    ).all(TENANT) as Array<{ operation_type: string }>).map((row) => row.operation_type);

    expect(outbox).toEqual([
      "CREDIT_ACCOUNT_OPENED", "CREDIT_SALE_RECORDED", "PAYMENT_CONFIRMED", "SALE_COMPLETED",
    ]);
  });

  // 25
  it("un fallo posterior a la guarda de cupo revierte también la deuda", async () => {
    // Existencia insuficiente: el rechazo ocurre al descontar, dentro de la
    // transacción que ya imputó el pago y ya escribió la obligación.
    const env = await buildEnv();
    openShift(env);
    const customerId = registerCustomer(env);
    if (openAccount(env, customerId, "100000.000000").kind !== "OPENED") throw new Error("account");
    const item = seedProduct(env, "2.000000");
    const sale = createSale(env, item, { customerId, quantity: "2.000000" });
    if (sale.kind !== "CREATED") throw new Error(sale.kind);

    // La existencia desaparece entre crear y cobrar.
    env.database.native.prepare(
      "UPDATE inventory_stock SET quantity_on_hand='0.000000' WHERE tenant_id=? AND presentation_id=?",
    ).run(TENANT, item.presentationId);

    const result = payOnCredit(env, sale.saleId, sale.payableAmount);

    expect(result.kind).toBe("INSUFFICIENT_STOCK");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(0);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=?", TENANT)).toBe(0);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=?", TENANT)).toBe(0);
    expect(saleRow(env.database, sale.saleId).status).toBe("READY_FOR_PAYMENT");
  });
});

// ── Cuentas ──────────────────────────────────────────────────────────────────

describe("la cuenta de crédito exige cupo explícito", () => {
  it("abre con cupo y es idempotente; no admite una segunda cuenta", async () => {
    const env = await buildEnv();
    const customerId = registerCustomer(env);

    const opened = openAccount(env, customerId, "50000.000000");
    expect(opened.kind).toBe("OPENED");

    const replay = env.openAccount.execute(SCOPE, SESSION, auth(), {
      customerId, creditLimit: "50000.000000", currencyCode: "COP",
      idempotencyKey: `credit:account:${String(accountSeed)}`,
      correlationId: randomUUID(), causationId: null,
    });
    expect(replay.kind).toBe("IDEMPOTENT");

    expect(openAccount(env, customerId, "90000.000000").kind).toBe("ACCOUNT_ALREADY_EXISTS");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_accounts WHERE tenant_id=?", TENANT)).toBe(1);
  });

  it("un cliente inexistente no tiene cuenta que abrir", async () => {
    const env = await buildEnv();
    expect(openAccount(env, "018f0000-0000-7000-8000-0000000000aa", "10000.000000").kind)
      .toBe("CUSTOMER_NOT_FOUND");
  });

  it("sin el permiso de administración no se abre", async () => {
    const env = await buildEnv();
    const customerId = registerCustomer(env);
    const result = env.openAccount.execute(
      SCOPE, SESSION,
      auth(ALL_PERMISSIONS.filter((code) => code !== "CUSTOMERS_CREDIT_ACCOUNT_MANAGE")),
      {
        customerId, creditLimit: "10000.000000", currencyCode: "COP",
        idempotencyKey: "credit:account:denied", correlationId: randomUUID(), causationId: null,
      },
    );
    expect(result.kind).toBe("UNAUTHORIZED");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_credit_accounts WHERE tenant_id=?", TENANT)).toBe(0);
  });

  // 15, 16
  it("ni el cliente ni la cuenta cruzan de comercio", async () => {
    const env = await buildEnv();
    const foreignCustomer = registerCustomer(env, OTHER_SCOPE);
    // El cliente existe, pero no bajo este tenant.
    expect(count(env.database, "SELECT COUNT(*) AS n FROM customers_customers WHERE id=?", foreignCustomer)).toBe(1);
    expect(openAccount(env, foreignCustomer, "10000.000000").kind).toBe("CUSTOMER_NOT_FOUND");

    // Y una cuenta del otro comercio no resuelve aquí.
    if (openAccount(env, foreignCustomer, "10000.000000", OTHER_SCOPE).kind !== "OPENED") {
      throw new Error("expected the other tenant to open its own account");
    }
    expect(env.creditStore.findAccountByCustomer(SCOPE, foreignCustomer)).toBeNull();
    expect(env.creditStore.findAccountByCustomer(OTHER_SCOPE, foreignCustomer)).not.toBeNull();
    expect(env.getAccount.execute(SCOPE, auth(), { customerId: foreignCustomer }).kind)
      .toBe("CREDIT_ACCOUNT_NOT_FOUND");
  });
});

// ── Abonos ───────────────────────────────────────────────────────────────────

describe("el abono reduce la deuda y libera cupo", () => {
  async function withDebt(limit = "100000.000000") {
    const context = await saleOnCredit({ limit });
    const paid = payOnCredit(context.env, context.sale.saleId, context.sale.payableAmount);
    if (paid.kind !== "CONFIRMED") throw new Error(paid.kind);
    return context;
  }

  function repay(
    env: Env, customerId: string, amount: string,
    options: { method?: "CASH" | "TRANSFER"; key?: string; register?: string | null } = {},
  ) {
    return env.repay.execute(SCOPE, SESSION, auth(), {
      customerId, amount, currencyCode: "COP",
      method: options.method ?? "CASH",
      cashRegisterId: options.register === undefined ? CAJA : options.register,
      businessDate: BUSINESS_DATE,
      idempotencyKey: options.key ?? "credit:repay:1",
      correlationId: randomUUID(), causationId: null,
    });
  }

  // 19, 20, 21
  it("un abono en efectivo baja el saldo, libera cupo y entra al cajón", async () => {
    const { env, customerId, accountId } = await withDebt();

    const result = repay(env, customerId, "2000.000000");

    expect(result.kind).toBe("RECORDED");
    if (result.kind !== "RECORDED") return;
    expect(result.outstandingBalance).toBe("3000.000000");
    expect(result.availableCredit).toBe("97000.000000");

    // 19: el libro lo registra como DECREASE, sin venta ni pago detrás.
    const entry = env.database.native.prepare(
      `SELECT transaction_type, direction, amount, sale_id, payment_id
       FROM customers_credit_transactions
       WHERE tenant_id=? AND credit_account_id=? AND transaction_type='CUSTOMER_PAYMENT'`,
    ).get(TENANT, accountId) as {
      transaction_type: string; direction: string; amount: string;
      sale_id: string | null; payment_id: string | null;
    };
    expect(entry).toMatchObject({ direction: "DECREASE", amount: "2000.000000", sale_id: null, payment_id: null });

    // 21: el efectivo entra como CASH_PAYMENT, no como una venta.
    const movement = env.database.native.prepare(
      `SELECT movement_type, direction, amount, status FROM cash_movement
       WHERE tenant_id=? AND movement_type='CASH_PAYMENT'`,
    ).get(TENANT) as { movement_type: string; direction: string; amount: string; status: string };
    expect(movement).toMatchObject({
      movement_type: "CASH_PAYMENT", direction: "IN", amount: "2000.000000", status: "POSTED",
    });

    // Un abono NO es el pago de una venta: no crea Payment ni imputa.
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(1);
    expect(count(env.database, "SELECT COUNT(*) AS n FROM payments_payment_allocations WHERE tenant_id=?", TENANT)).toBe(1);
  });

  it("un abono por transferencia no toca la caja", async () => {
    const { env, customerId } = await withDebt();

    const result = repay(env, customerId, "1000.000000", { method: "TRANSFER", register: null });

    expect(result.kind).toBe("RECORDED");
    expect(count(
      env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_PAYMENT'", TENANT,
    )).toBe(0);
  });

  // 22
  it("un abono mayor que la deuda se rechaza: no hay saldo a favor", async () => {
    const { env, customerId, accountId } = await withDebt();

    const result = repay(env, customerId, "5000.000001");

    expect(result.kind).toBe("REPAYMENT_EXCEEDS_BALANCE");
    if (result.kind !== "REPAYMENT_EXCEEDS_BALANCE") return;
    expect(result.outstandingBalance).toBe("5000.000000");
    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=? AND credit_account_id=? AND direction='DECREASE'",
      TENANT, accountId,
    )).toBe(0);
  });

  it("sin turno abierto el abono en efectivo se rechaza y no deja rastro", async () => {
    const env = await buildEnv();
    const customerId = registerCustomer(env);
    if (openAccount(env, customerId, "100000.000000").kind !== "OPENED") throw new Error("account");
    const item = seedProduct(env);
    const sale = createSale(env, item, { customerId });
    if (sale.kind !== "CREATED") throw new Error(sale.kind);
    if (payOnCredit(env, sale.saleId, sale.payableAmount).kind !== "CONFIRMED") throw new Error("credit");

    // Nunca se abrió turno.
    const result = repay(env, customerId, "1000.000000");

    expect(result.kind).toBe("CASH_SHIFT_MISSING");
    expect(count(env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=?", TENANT)).toBe(0);
    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=? AND direction='DECREASE'", TENANT,
    )).toBe(0);
  });

  it("un cliente sin cuenta no puede abonar", async () => {
    const env = await buildEnv();
    openShift(env);
    const customerId = registerCustomer(env);
    expect(repay(env, customerId, "1000.000000").kind).toBe("CREDIT_ACCOUNT_NOT_FOUND");
  });

  it("el abono es idempotente y no descuenta dos veces", async () => {
    const { env, customerId, accountId } = await withDebt();

    const first = repay(env, customerId, "2000.000000", { key: "credit:repay:same" });
    const replay = repay(env, customerId, "2000.000000", { key: "credit:repay:same" });

    expect(first.kind).toBe("RECORDED");
    expect(replay.kind).toBe("IDEMPOTENT");
    expect(env.creditStore.outstandingBalance(SCOPE, accountId)).toBe(3_000_000_000n);
    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM customers_credit_transactions WHERE tenant_id=? AND direction='DECREASE'", TENANT,
    )).toBe(1);
    expect(count(
      env.database, "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_PAYMENT'", TENANT,
    )).toBe(1);
  });

  // 23
  it("el saldo derivado cuadra tras varias ventas y abonos", async () => {
    const { env, customerId, accountId } = await withDebt("100000.000000");

    // Dos ventas más a crédito.
    const second = createSale(env, seedProduct(env), { customerId });
    const third = createSale(env, seedProduct(env), { customerId, quantity: "2.000000" });
    if (second.kind !== "CREATED" || third.kind !== "CREATED") throw new Error("sale");
    expect(payOnCredit(env, second.saleId, second.payableAmount, "credit:pay:2").kind).toBe("CONFIRMED");
    expect(payOnCredit(env, third.saleId, third.payableAmount, "credit:pay:3").kind).toBe("CONFIRMED");

    // Y dos abonos.
    expect(repay(env, customerId, "4000.000000", { key: "credit:repay:a" }).kind).toBe("RECORDED");
    expect(repay(env, customerId, "1000.000000", { key: "credit:repay:b" }).kind).toBe("RECORDED");

    // 5.000 + 5.000 + 10.000 − 4.000 − 1.000 = 15.000
    const account = env.getAccount.execute(SCOPE, auth(), { customerId });
    expect(account.kind).toBe("FOUND");
    if (account.kind !== "FOUND") return;
    expect(account.account.outstandingBalance).toBe("15000.000000");
    expect(account.account.availableCredit).toBe("85000.000000");

    // El saldo es exactamente la suma del libro, no una columna.
    const ledger = env.database.native.prepare(
      `SELECT direction, amount FROM customers_credit_transactions
       WHERE tenant_id=? AND credit_account_id=? ORDER BY account_sequence`,
    ).all(TENANT, accountId) as Array<{ direction: string; amount: string }>;
    const derived = ledger.reduce(
      (total, row) => row.direction === "INCREASE"
        ? total + Number(row.amount)
        : total - Number(row.amount),
      0,
    );
    expect(derived).toBe(15000);
    expect(ledger).toHaveLength(5);
  });

  it("la auditoría del abono no se confunde con la de una venta", async () => {
    const { env, customerId } = await withDebt();
    repay(env, customerId, "2000.000000");

    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM local_operation_audit WHERE tenant_id=? AND action_code='CREDIT_PAYMENT_RECORDED'",
      TENANT,
    )).toBe(1);
    expect(count(
      env.database,
      "SELECT COUNT(*) AS n FROM local_sync_outbox WHERE tenant_id=? AND operation_type='CREDIT_PAYMENT_RECORDED'",
      TENANT,
    )).toBe(1);
  });

  it("un abono de otro comercio no alcanza esta cuenta", async () => {
    const { env, customerId } = await withDebt();

    const result = env.repay.execute(OTHER_SCOPE, SESSION, auth(ALL_PERMISSIONS, OTHER_SCOPE), {
      customerId, amount: "1000.000000", currencyCode: "COP",
      method: "TRANSFER", cashRegisterId: null, businessDate: BUSINESS_DATE,
      idempotencyKey: "credit:repay:foreign", correlationId: randomUUID(), causationId: null,
    });

    expect(result.kind).toBe("CREDIT_ACCOUNT_NOT_FOUND");
  });
});
