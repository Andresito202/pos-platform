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
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../src/payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../src/payments/confirm-transfer-payment-use-case.js";
import { SqlitePharmacyStore } from "../src/pharmacy/sqlite-pharmacy-store.js";
import {
  UpsertPharmacyEstablishmentUseCase,
  UpsertPharmacyProfileUseCase,
  RegisterPharmacyPrescriptionUseCase,
} from "../src/pharmacy/pharmacy-use-cases.js";
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
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ALL = [
  "CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_ADJUST",
  "INVENTORY_STOCK_READ", "SALES_SALE_CREATE",
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
  "PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_TRANSFER_REPORT",
  "PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_CANCEL", "PAYMENTS_PAYMENT_READ",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
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
const key = (): string => { seed += 1; return `idem-pharm-pay-${String(seed)}`; };

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

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-farmacia-pay-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const saleStore = new SqliteSaleStore(database, sync, () => NOW);
  const pharmacyStore = new SqlitePharmacyStore(database, sync, () => NOW);
  const paymentStore = new SqlitePaymentStore(
    database, sync, cashStore, inventoryStore, () => NOW, pharmacyStore,
  );
  seedRegister(database);
  return {
    database, pharmacyStore, inventoryStore, paymentStore,
    register: new RegisterProductUseCase(catalogStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    establishment: new UpsertPharmacyEstablishmentUseCase(pharmacyStore),
    profile: new UpsertPharmacyProfileUseCase(pharmacyStore),
    prescription: new RegisterPharmacyPrescriptionUseCase(pharmacyStore),
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
    createSale: new CreateSaleUseCase(
      catalogStore, inventoryStore, cashStore, saleStore, () => NOW, pharmacyStore,
    ),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
    registerTransfer: new RegisterTransferPaymentUseCase(paymentStore, () => NOW),
    confirmTransfer: new ConfirmTransferPaymentUseCase(paymentStore, () => NOW),
  };
}

async function prepareOtcSale(env: Awaited<ReturnType<typeof buildEnv>>, qty = "1.000000") {
  const product = env.register.execute(SCOPE, SESSION, auth(), {
    code: `OTC-${key()}`,
    name: "Acetaminofen",
    stockControlled: true,
    presentationName: "Caja",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: `770${String(seed).padStart(10, "0")}`,
    priceAmount: "10000.000000",
    currencyCode: "COP",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW);
  if (product.kind !== "REGISTERED") throw new Error("product");
  expect(env.establishment.execute(SCOPE, SESSION, auth(), {
    establishmentType: "DROGUERIA",
    authorizedOtc: true,
    authorizedPrescription: true,
    authorizedControlledSpecial: false,
    controlledAuthorizationStatus: "NONE",
    controlledAuthorizationNote: null,
    technicalDirectorAttribution: "Regente",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW).kind).toBe("SAVED");
  expect(env.profile.execute(SCOPE, SESSION, auth(), {
    productId: product.productId,
    productKind: "MEDICINE",
    commercialName: "Acetaminofen",
    genericName: "Paracetamol",
    activeIngredients: ["Paracetamol"],
    concentrationText: "500 mg",
    pharmaceuticalForm: "TABLETA",
    manufacturer: "Lab",
    sanitaryHolder: "Titular",
    sanitaryRegistration: "INVIMA-OK",
    registrationVerificationStatus: "VERIFIED_MANUAL",
    dispensationCategory: "OTC",
    requiresPrescription: false,
    controlledSpecial: false,
    storageCondition: "AMBIENT",
    requiresLotTracking: true,
    requiresExpiry: true,
    regulatoryReviewAt: "2026-09-01",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW).kind).toBe("SAVED");
  expect(env.receive.execute(SCOPE, SESSION, auth(), {
    presentationId: product.presentationId,
    movementType: "PURCHASE_RECEIPT",
    quantity: "20.000000",
    reasonCode: "SUPPLIER_DELIVERY",
    businessDate: "2026-09-07",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
    batch: {
      code: `LOT-${seed}`,
      manufactureDate: "2026-08-01",
      expiryDate: "2027-08-01",
      supplierReference: "DIST-1",
      receiptDocument: "FAC-1",
    },
  }).kind).toBe("POSTED");
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
  const sale = env.createSale.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: REGISTER,
    channel: "POS_COUNTER",
    businessDate: "2026-09-07",
    timezoneId: "America/Bogota",
    utcOffsetMinutes: -300,
    documentSeries: "A",
    currencyCode: "COP",
    lines: [{
      productId: product.productId,
      presentationId: product.presentationId,
      quantity: qty,
      pharmacyPrescriptionId: null,
    }],
    pharmacyProfessionalCompetenceCode: null,
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  });
  if (sale.kind !== "CREATED") throw new Error(`sale ${sale.kind}`);
  return { product, sale, shift };
}

describe("prompt-6 pharmacy payment confirmation gates", () => {
  it("allows ordinary OTC cash confirmation when eligibility holds", async () => {
    const env = await buildEnv();
    const { sale } = await prepareOtcSale(env);
    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: sale.payableAmount,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(paid.kind).toBe("CONFIRMED");
    if (paid.kind !== "CONFIRMED") return;
    expect(paid.saleCompleted).toBe(true);
  });

  it("blocks cash confirmation after classification becomes unknown", async () => {
    const env = await buildEnv();
    const { sale, product } = await prepareOtcSale(env);
    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Acetaminofen",
      genericName: "Paracetamol",
      activeIngredients: ["Paracetamol"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "TABLETA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-OK",
      registrationVerificationStatus: "VERIFIED_MANUAL",
      dispensationCategory: "UNKNOWN",
      requiresPrescription: false,
      controlledSpecial: false,
      storageCondition: "AMBIENT",
      requiresLotTracking: true,
      requiresExpiry: true,
      regulatoryReviewAt: "2026-09-01",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");
    const paid = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: sale.payableAmount,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(paid).toMatchObject({ kind: "PHARMACY_ELIGIBILITY_LOST" });
    expect(env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(TENANT, sale.saleId)).toEqual({ status: "READY_FOR_PAYMENT" });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM payments_payments WHERE tenant_id=? AND payment_group_id IN (SELECT id FROM payments_payment_groups WHERE collection_subject_id=?)",
    ).get(TENANT, sale.saleId)).toEqual({ n: 0 });
  });

  it("blocks transfer confirmation (not only report) when eligibility is lost", async () => {
    const env = await buildEnv();
    const { sale, product } = await prepareOtcSale(env);
    const reported = env.registerTransfer.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      providerCode: "BANK_TRANSFER",
      providerReference: "REF-1",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(reported.kind).toBe("REGISTERED");
    if (reported.kind !== "REGISTERED") return;
    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Acetaminofen",
      genericName: "Paracetamol",
      activeIngredients: ["Paracetamol"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "TABLETA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-OK",
      registrationVerificationStatus: "UNVERIFIED",
      dispensationCategory: "PRESCRIPTION",
      requiresPrescription: true,
      controlledSpecial: false,
      storageCondition: "AMBIENT",
      requiresLotTracking: true,
      requiresExpiry: true,
      regulatoryReviewAt: "2026-09-01",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");
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
    expect(env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(TENANT, sale.saleId)).toEqual({ status: "PAYMENT_IN_PROGRESS" });
  });

  it("rejects unauthorized cashier permission before pharmacy or payment writes", async () => {
    const env = await buildEnv();
    const { sale } = await prepareOtcSale(env);
    const denied = env.registerCash.execute(SCOPE, SESSION, auth(["SALES_SALE_CREATE"]), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: sale.payableAmount,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(denied.kind).toBe("UNAUTHORIZED");
  });

  it("keeps idempotent cash replay without double completion after success", async () => {
    const env = await buildEnv();
    const { sale } = await prepareOtcSale(env);
    const idem = key();
    const first = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: sale.payableAmount,
      idempotencyKey: idem,
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");
    const second = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: sale.payableAmount,
      idempotencyKey: idem,
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(second.kind).toBe("IDEMPOTENT");
  });

  it("blocks completing partial cash when eligibility is lost before the covering payment", async () => {
    const env = await buildEnv();
    const { sale, product } = await prepareOtcSale(env, "2.000000");
    const half = "10000.000000";
    const first = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: half,
      tenderedAmount: half,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");
    if (first.kind !== "CONFIRMED") return;
    expect(first.saleCompleted).toBe(false);

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Acetaminofen",
      genericName: "Paracetamol",
      activeIngredients: ["Paracetamol"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "TABLETA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-OK",
      registrationVerificationStatus: "VERIFIED_MANUAL",
      dispensationCategory: "UNKNOWN",
      requiresPrescription: false,
      controlledSpecial: false,
      storageCondition: "AMBIENT",
      requiresLotTracking: true,
      requiresExpiry: true,
      regulatoryReviewAt: "2026-09-01",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");

    const second = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: half,
      tenderedAmount: half,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(second).toMatchObject({ kind: "PHARMACY_ELIGIBILITY_LOST" });
    expect(env.database.native.prepare(
      "SELECT status FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(TENANT, sale.saleId)).toEqual({ status: "PAYMENT_IN_PROGRESS" });
    expect(env.database.native.prepare(
      `SELECT count(*) AS n FROM pharmacy_dispensation
       WHERE tenant_id=? AND sale_id=? AND status='BLOCKED_RECORD'
         AND json_extract(eligibility_snapshot_json,'$.reconciliation_pending')=1`,
    ).get(TENANT, sale.saleId)).toEqual({ n: 1 });
    expect(env.database.native.prepare(
      `SELECT count(*) AS n FROM pharmacy_dispensation
       WHERE tenant_id=? AND sale_id=? AND status='BLOCKED_RECORD'
         AND json_extract(eligibility_snapshot_json,'$.bank_reversal_claimed')=1`,
    ).get(TENANT, sale.saleId)).toEqual({ n: 0 });
  });

  it("survives service restart: open DB again and still block lost eligibility on cash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-farmacia-restart-"));
    directories.push(dir);
    let saleId = "";
    let payable = "";
    {
      const database = LocalDatabase.open({ dataDirectory: dir });
      databases.push(database);
      const sync = new DurableSyncStore(database);
      const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
      const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
      const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
      const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
      const saleStore = new SqliteSaleStore(database, sync, () => NOW);
      const pharmacyStore = new SqlitePharmacyStore(database, sync, () => NOW);
      const paymentStore = new SqlitePaymentStore(
        database, sync, cashStore, inventoryStore, () => NOW, pharmacyStore,
      );
      seedRegister(database);
      const env = {
        database, pharmacyStore,
        register: new RegisterProductUseCase(catalogStore),
        receive: new ReceiveStockUseCase(inventoryStore),
        establishment: new UpsertPharmacyEstablishmentUseCase(pharmacyStore),
        profile: new UpsertPharmacyProfileUseCase(pharmacyStore),
        openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
        createSale: new CreateSaleUseCase(
          catalogStore, inventoryStore, cashStore, saleStore, () => NOW, pharmacyStore,
        ),
        registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
      };
      const prepared = await (async () => {
        // reuse prepare path inline via temporary env shape
        return prepareOtcSale(env as never);
      })();
      saleId = prepared.sale.saleId;
      payable = prepared.sale.payableAmount;
      expect(env.profile.execute(SCOPE, SESSION, auth(), {
        productId: prepared.product.productId,
        productKind: "MEDICINE",
        commercialName: "Acetaminofen",
        genericName: "Paracetamol",
        activeIngredients: ["Paracetamol"],
        concentrationText: "500 mg",
        pharmaceuticalForm: "TABLETA",
        manufacturer: "Lab",
        sanitaryHolder: "Titular",
        sanitaryRegistration: "INVIMA-OK",
        registrationVerificationStatus: "VERIFIED_MANUAL",
        dispensationCategory: "UNKNOWN",
        requiresPrescription: false,
        controlledSpecial: false,
        storageCondition: "AMBIENT",
        requiresLotTracking: true,
        requiresExpiry: true,
        regulatoryReviewAt: "2026-09-01",
        idempotencyKey: key(),
        correlationId: CORRELATION,
        causationId: null,
      }, NOW).kind).toBe("SAVED");
      database.close();
      databases.pop();
    }
    {
      const database = LocalDatabase.open({ dataDirectory: dir });
      databases.push(database);
      const sync = new DurableSyncStore(database);
      const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
      const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
      const pharmacyStore = new SqlitePharmacyStore(database, sync, () => NOW);
      const paymentStore = new SqlitePaymentStore(
        database, sync, cashStore, inventoryStore, () => NOW, pharmacyStore,
      );
      const registerCash = new RegisterCashPaymentUseCase(paymentStore, () => NOW);
      const paid = registerCash.execute(SCOPE, SESSION, auth(), {
        saleId,
        amount: payable,
        tenderedAmount: payable,
        idempotencyKey: key(),
        correlationId: CORRELATION,
        causationId: null,
      });
      expect(paid).toMatchObject({ kind: "PHARMACY_ELIGIBILITY_LOST" });
    }
  });
});
