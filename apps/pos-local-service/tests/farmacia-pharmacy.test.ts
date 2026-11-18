import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { ChangeBatchStatusUseCase } from "../src/inventory/adjust-stock-use-case.js";
import { SqlitePharmacyStore } from "../src/pharmacy/sqlite-pharmacy-store.js";
import {
  UpsertPharmacyEstablishmentUseCase,
  UpsertPharmacyProfileUseCase,
  RegisterPharmacyPrescriptionUseCase,
  RegisterPharmacyTechnicalReceiptUseCase,
  RegisterPharmacySanitaryAlertUseCase,
} from "../src/pharmacy/pharmacy-use-cases.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const OTHER_COMPANY = "018f0000-0000-7000-8000-000000000099";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ALL = [
  "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE",
  "INVENTORY_STOCK_ADJUST",
  "INVENTORY_STOCK_READ",
  "SALES_SALE_CREATE",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = ALL, companyId = COMPANY, branchId = BRANCH): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: companyId, branch_id: branchId,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

let seed = 0;
const key = (): string => { seed += 1; return `idem-farmacia-${String(seed)}`; };

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-farmacia-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const pharmacyStore = new SqlitePharmacyStore(database, sync, () => NOW);
  return {
    database,
    catalogStore,
    inventoryStore,
    pharmacyStore,
    register: new RegisterProductUseCase(catalogStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    changeStatus: new ChangeBatchStatusUseCase(inventoryStore),
    establishment: new UpsertPharmacyEstablishmentUseCase(pharmacyStore),
    profile: new UpsertPharmacyProfileUseCase(pharmacyStore),
    prescription: new RegisterPharmacyPrescriptionUseCase(pharmacyStore),
    technicalReceipt: new RegisterPharmacyTechnicalReceiptUseCase(pharmacyStore, inventoryStore),
    alert: new RegisterPharmacySanitaryAlertUseCase(pharmacyStore, inventoryStore),
  };
}

describe("prompt-6 farmacia specialization", () => {
  it("configures drogueria establishment and OTC profile without inventing stock", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "OTC-001",
      name: "Acetaminofen 500",
      stockControlled: true,
      presentationName: "Caja",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7705000000001",
      priceAmount: "3500.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(product.kind).toBe("REGISTERED");
    if (product.kind !== "REGISTERED") throw new Error("product");

    expect(env.establishment.execute(SCOPE, SESSION, auth(), {
      establishmentType: "DROGUERIA",
      authorizedOtc: true,
      authorizedPrescription: true,
      authorizedControlledSpecial: false,
      controlledAuthorizationStatus: "NONE",
      controlledAuthorizationNote: null,
      technicalDirectorAttribution: "Regente asignado documentalmente",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW)).toMatchObject({ kind: "SAVED", version: 1 });

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Acetaminofen 500",
      genericName: "Paracetamol",
      activeIngredients: ["Paracetamol"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "TABLETA",
      manufacturer: "Lab Demo",
      sanitaryHolder: "Titular Demo",
      sanitaryRegistration: "INVIMA-DEMO-1",
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
    }, NOW)).toMatchObject({ kind: "SAVED", version: 1 });

    expect(env.inventoryStore.getStock(SCOPE, product.presentationId)).toBeNull();
    const allowed = env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE,
      productId: product.productId,
      quantity: "1.000000",
      prescriptionId: null,
      professionalCompetenceCode: null,
    });
    expect(allowed.kind).toBe("ALLOWED");
  });

  it("blocks unknown classification, unverified registration and missing prescription", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "RX-001",
      name: "Amoxicilina",
      stockControlled: true,
      presentationName: "Caja",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7705000000002",
      priceAmount: "12000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (product.kind !== "REGISTERED") throw new Error("product");

    env.establishment.execute(SCOPE, SESSION, auth(), {
      establishmentType: "DROGUERIA",
      authorizedOtc: true,
      authorizedPrescription: true,
      authorizedControlledSpecial: false,
      controlledAuthorizationStatus: "NONE",
      controlledAuthorizationNote: null,
      technicalDirectorAttribution: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Amoxicilina",
      genericName: "Amoxicilina",
      activeIngredients: ["Amoxicilina"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "CAPSULA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: null,
      registrationVerificationStatus: "UNVERIFIED",
      dispensationCategory: "UNKNOWN",
      requiresPrescription: false,
      controlledSpecial: false,
      storageCondition: "AMBIENT",
      requiresLotTracking: true,
      requiresExpiry: true,
      regulatoryReviewAt: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");

    expect(env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE, productId: product.productId, quantity: "1.000000",
      prescriptionId: null, professionalCompetenceCode: null,
    }).kind).toBe("DENIED");
    expect(env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE, productId: product.productId, quantity: "1.000000",
      prescriptionId: null, professionalCompetenceCode: null,
    })).toMatchObject({ kind: "DENIED", reason: "PHARMACY_CLASSIFICATION_UNKNOWN" });

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Amoxicilina",
      genericName: "Amoxicilina",
      activeIngredients: ["Amoxicilina"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "CAPSULA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-X",
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

    expect(env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE, productId: product.productId, quantity: "1.000000",
      prescriptionId: null, professionalCompetenceCode: null,
    })).toMatchObject({ kind: "DENIED", reason: "PHARMACY_REGISTRATION_UNVERIFIED" });

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Amoxicilina",
      genericName: "Amoxicilina",
      activeIngredients: ["Amoxicilina"],
      concentrationText: "500 mg",
      pharmaceuticalForm: "CAPSULA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-X",
      registrationVerificationStatus: "VERIFIED_MANUAL",
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

    expect(env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE, productId: product.productId, quantity: "1.000000",
      prescriptionId: null, professionalCompetenceCode: null,
    })).toMatchObject({ kind: "DENIED", reason: "PHARMACY_PRESCRIPTION_REQUIRED" });
  });

  it("keeps controlled special blocked even with stock and cashier permission", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "CTRL-001",
      name: "Controlado Demo",
      stockControlled: true,
      presentationName: "Caja",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7705000000003",
      priceAmount: "50000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (product.kind !== "REGISTERED") throw new Error("product");

    // Attempt to enable controlled without ACCREDITED evidence must fail configuration.
    expect(env.establishment.execute(SCOPE, SESSION, auth(), {
      establishmentType: "FARMACIA_DROGUERIA",
      authorizedOtc: true,
      authorizedPrescription: true,
      authorizedControlledSpecial: true,
      controlledAuthorizationStatus: "PENDING_FNE",
      controlledAuthorizationNote: "solicitud en trámite",
      technicalDirectorAttribution: "QF Demo",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("INVALID_CONFIGURATION");

    expect(env.establishment.execute(SCOPE, SESSION, auth(), {
      establishmentType: "FARMACIA_DROGUERIA",
      authorizedOtc: true,
      authorizedPrescription: true,
      authorizedControlledSpecial: true,
      controlledAuthorizationStatus: "ACCREDITED",
      controlledAuthorizationNote: "Inscripción FNE documental local — sin ACK gubernamental",
      technicalDirectorAttribution: "QF Demo",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");

    expect(env.profile.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "Controlado Demo",
      genericName: "Demo",
      activeIngredients: ["Demo"],
      concentrationText: "10 mg",
      pharmaceuticalForm: "TABLETA",
      manufacturer: "Lab",
      sanitaryHolder: "Titular",
      sanitaryRegistration: "INVIMA-C",
      registrationVerificationStatus: "VERIFIED_MANUAL",
      dispensationCategory: "CONTROLLED_SPECIAL",
      requiresPrescription: true,
      controlledSpecial: true,
      storageCondition: "CONTROLLED_ROOM",
      requiresLotTracking: true,
      requiresExpiry: true,
      regulatoryReviewAt: "2026-09-01",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("SAVED");

    const rx = env.prescription.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      prescribedQuantity: "2.000000",
      prescribedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-30T00:00:00.000Z",
      issuerProfessionalId: "MP-1",
      issuerName: "Dr Demo",
      patientReference: "PAC-HASH-1",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(rx.kind).toBe("REGISTERED");
    if (rx.kind !== "REGISTERED") throw new Error("rx");

    expect(env.pharmacyStore.evaluateLineEligibility({
      scope: SCOPE,
      productId: product.productId,
      quantity: "1.000000",
      prescriptionId: rx.prescriptionId,
      professionalCompetenceCode: "REGENTE_FARMACIA",
    })).toMatchObject({
      kind: "DENIED",
      reason: "PHARMACY_CONTROLLED_BLOCKED",
    });
  });

  it("records technical receipt rejection without available stock and quarantines accepted-then-blocked lots", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "TECH-001",
      name: "Ibuprofeno",
      stockControlled: true,
      presentationName: "Caja",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7705000000004",
      priceAmount: "8000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (product.kind !== "REGISTERED") throw new Error("product");

    // Rejected inspection: documentary only — no inventory movement.
    expect(env.technicalReceipt.execute(SCOPE, SESSION, auth(), {
      presentationId: product.presentationId,
      lotId: null,
      sanitaryRegistration: "INVIMA-T",
      batchCode: "LOT-REJ-1",
      expiryDate: "2027-01-01",
      quantity: "10.000000",
      storageCondition: "AMBIENT",
      inspectionResult: "REJECTED",
      observations: "Empaque deteriorado",
      inventoryMovementId: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("RECORDED");
    expect(env.inventoryStore.getStock(SCOPE, product.presentationId)).toBeNull();

    expect(env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: product.presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "5.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-OK-1",
        manufactureDate: "2026-08-01",
        expiryDate: "2027-08-01",
        supplierReference: "DIST-1",
        receiptDocument: "FAC-T-1",
      },
    }).kind).toBe("POSTED");
    const lot = env.inventoryStore.listBatches(SCOPE, product.presentationId)[0]!;
    expect(env.technicalReceipt.execute(SCOPE, SESSION, auth(), {
      presentationId: product.presentationId,
      lotId: lot.id,
      sanitaryRegistration: "INVIMA-T",
      batchCode: lot.batchCode,
      expiryDate: lot.expiryDate,
      quantity: "5.000000",
      storageCondition: "AMBIENT",
      inspectionResult: "QUARANTINE",
      observations: "Pendiente verificación de cadena de frío",
      inventoryMovementId: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("RECORDED");
    expect(env.inventoryStore.listBatches(SCOPE, product.presentationId)[0]?.status).toBe("QUARANTINE");
  });

  it("registers sanitary alert without claiming official INVIMA sync and isolates companies", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "ALERT-001",
      name: "Producto alerta",
      stockControlled: true,
      presentationName: "Caja",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7705000000005",
      priceAmount: "1000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (product.kind !== "REGISTERED") throw new Error("product");

    const alert = env.alert.execute(SCOPE, SESSION, auth(), {
      sourceKind: "MANUAL_AUTHORIZED",
      sourceReference: "Carga administrativa respaldada 2026-09-07",
      productId: product.productId,
      lotId: null,
      actionCode: "RECALL",
      evidenceNote: "Retiro preventivo local; no es sincronización oficial INVIMA",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(alert.kind).toBe("RECORDED");

    expect(env.establishment.execute(
      { ...SCOPE, companyId: OTHER_COMPANY },
      SESSION,
      auth(ALL, OTHER_COMPANY, BRANCH),
      {
        establishmentType: "DROGUERIA",
        authorizedOtc: true,
        authorizedPrescription: false,
        authorizedControlledSpecial: false,
        controlledAuthorizationStatus: "NONE",
        controlledAuthorizationNote: null,
        technicalDirectorAttribution: null,
        idempotencyKey: key(),
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    ).kind).toBe("SAVED");
    expect(env.pharmacyStore.getEstablishment(SCOPE)).toBeNull();
    expect(env.pharmacyStore.getEstablishment({ ...SCOPE, companyId: OTHER_COMPANY })?.authorizedOtc).toBe(true);

    expect(env.profile.execute(SCOPE, SESSION, auth([]), {
      productId: product.productId,
      productKind: "MEDICINE",
      commercialName: "X",
      genericName: null,
      activeIngredients: ["X"],
      concentrationText: null,
      pharmaceuticalForm: null,
      manufacturer: null,
      sanitaryHolder: null,
      sanitaryRegistration: null,
      registrationVerificationStatus: "UNVERIFIED",
      dispensationCategory: "OTC",
      requiresPrescription: false,
      controlledSpecial: false,
      storageCondition: "AMBIENT",
      requiresLotTracking: false,
      requiresExpiry: false,
      regulatoryReviewAt: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNAUTHORIZED");
  });
});
