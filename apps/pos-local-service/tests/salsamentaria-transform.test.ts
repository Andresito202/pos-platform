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
import { AddPresentationUseCase, UpsertFoodPolicyUseCase } from "../src/catalog/add-presentation-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { ExecuteTransformUseCase } from "../src/inventory/execute-transform-use-case.js";
import { ChangeBatchStatusUseCase } from "../src/inventory/adjust-stock-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const OTHER_BRANCH = "018f0000-0000-7000-8000-000000000033";
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
const key = (): string => { seed += 1; return `idem-salsamentaria-${String(seed)}`; };

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-salsamentaria-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  return {
    database,
    catalogStore,
    inventoryStore,
    register: new RegisterProductUseCase(catalogStore),
    addPresentation: new AddPresentationUseCase(catalogStore),
    foodPolicy: new UpsertFoodPolicyUseCase(catalogStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    transform: new ExecuteTransformUseCase(inventoryStore),
    changeStatus: new ChangeBatchStatusUseCase(inventoryStore),
  };
}

describe("prompt-5 multi-presentation catalog", () => {
  it("registers secondary presentations without inventing stock and upserts food policy", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "POLLO-ENT",
      name: "Pollo entero",
      stockControlled: true,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7701000000001",
      priceAmount: "18000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(product.kind).toBe("REGISTERED");
    if (product.kind !== "REGISTERED") throw new Error("product missing");

    const kg = env.addPresentation.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      presentationName: "Kilogramo",
      unitCode: "KGM",
      unitPrecision: 3,
      barcode: "7701000000002",
      priceAmount: "9500.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(kg.kind).toBe("REGISTERED");
    if (kg.kind !== "REGISTERED") throw new Error("kg missing");

    expect(env.inventoryStore.getStock(SCOPE, kg.presentationId)).toBeNull();
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM catalog_presentation WHERE product_id=?",
    ).get(product.productId)).toEqual({ n: 2 });

    const policy = env.foodPolicy.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      conservationCode: "CHILLED",
      requiresLotTracking: true,
      requiresExpiry: true,
      notes: "Cadena de frío del establecimiento",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(policy).toMatchObject({ kind: "SAVED", version: 1 });
    expect(env.catalogStore.getFoodPolicy(SCOPE, product.productId)).toMatchObject({
      conservationCode: "CHILLED",
      requiresLotTracking: true,
      requiresExpiry: true,
      version: 1,
    });

    expect(env.addPresentation.execute(SCOPE, SESSION, auth([]), {
      productId: product.productId,
      presentationName: "Porción",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: null,
      priceAmount: "5000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNAUTHORIZED");
  });

  it("rejects unknown product and duplicate barcode without partial writes", async () => {
    const env = await buildEnv();
    const product = env.register.execute(SCOPE, SESSION, auth(), {
      code: "QUESO-01",
      name: "Queso campesino",
      stockControlled: true,
      presentationName: "Bloque",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7702000000001",
      priceAmount: "12000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (product.kind !== "REGISTERED") throw new Error("product missing");

    expect(env.addPresentation.execute(SCOPE, SESSION, auth(), {
      productId: "018f0000-0000-7000-8000-0000000000aa",
      presentationName: "Porción",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7702000000002",
      priceAmount: "3000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("PRODUCT_NOT_FOUND");

    expect(env.addPresentation.execute(SCOPE, SESSION, auth(), {
      productId: product.productId,
      presentationName: "Paquete",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7702000000001",
      priceAmount: "3000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("BARCODE_ALREADY_REGISTERED");
  });
});

describe("prompt-5 transform integrity", () => {
  async function poultryFixture() {
    const env = await buildEnv();
    const whole = env.register.execute(SCOPE, SESSION, auth(), {
      code: "POLLO-W",
      name: "Pollo entero",
      stockControlled: true,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7703000000001",
      priceAmount: "20000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (whole.kind !== "REGISTERED") throw new Error("whole missing");

    const breast = env.register.execute(SCOPE, SESSION, auth(), {
      code: "POLLO-PECH",
      name: "Pechuga",
      stockControlled: true,
      presentationName: "Kilogramo",
      unitCode: "KGM",
      unitPrecision: 3,
      barcode: "7703000000002",
      priceAmount: "14000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    const wings = env.register.execute(SCOPE, SESSION, auth(), {
      code: "POLLO-ALAS",
      name: "Alas",
      stockControlled: true,
      presentationName: "Kilogramo",
      unitCode: "KGM",
      unitPrecision: 3,
      barcode: "7703000000003",
      priceAmount: "9000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    const legs = env.register.execute(SCOPE, SESSION, auth(), {
      code: "POLLO-PIER",
      name: "Piernas",
      stockControlled: true,
      presentationName: "Kilogramo",
      unitCode: "KGM",
      unitPrecision: 3,
      barcode: "7703000000004",
      priceAmount: "10000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (breast.kind !== "REGISTERED" || wings.kind !== "REGISTERED" || legs.kind !== "REGISTERED") {
      throw new Error("output products missing");
    }

    expect(env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: whole.presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "2.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-WHOLE-1",
        manufactureDate: "2026-09-01",
        expiryDate: "2026-09-20",
        supplierReference: "AVICOLA-1",
        receiptDocument: "FAC-W-1",
      },
    }).kind).toBe("POSTED");

    const lot = env.inventoryStore.listBatches(SCOPE, whole.presentationId)[0]!;
    return { ...env, whole, breast, wings, legs, lot };
  }

  it("documents merma without a second physical debit and keeps exact stock balance", async () => {
    const env = await poultryFixture();
    const executable = {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG" as const,
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [
        {
          presentationId: env.breast.presentationId,
          quantity: "0.800000",
          massQuantity: "0.800000",
          batchCode: "LOT-BREAST-1",
        },
        {
          presentationId: env.wings.presentationId,
          quantity: "0.400000",
          massQuantity: "0.400000",
          batchCode: "LOT-WINGS-1",
        },
        {
          presentationId: env.legs.presentationId,
          quantity: "0.600000",
          massQuantity: "0.600000",
          batchCode: "LOT-LEGS-1",
        },
      ],
      shrinkage: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "0.200000",
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    };

    // Negative expectation of the old defect: double debit would leave 0.
    // Correct behavior consumes the input once → 1 unit remains of 2.
    const posted = env.transform.execute(SCOPE, SESSION, auth(), executable, NOW);
    expect(posted.kind).toBe("POSTED");
    if (posted.kind !== "POSTED") throw new Error("transform missing");

    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("1.000000");
    expect(env.inventoryStore.listBatches(SCOPE, env.whole.presentationId)[0]?.quantityOnHand).toBe("1.000000");
    expect(env.inventoryStore.getStock(SCOPE, env.breast.presentationId)?.quantityOnHand).toBe("0.800000");
    expect(env.inventoryStore.getStock(SCOPE, env.wings.presentationId)?.quantityOnHand).toBe("0.400000");
    expect(env.inventoryStore.getStock(SCOPE, env.legs.presentationId)?.quantityOnHand).toBe("0.600000");

    // Merma line exists for audit; no SHRINKAGE movement was posted.
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_line WHERE order_id=? AND direction='SHRINKAGE'",
    ).get(posted.orderId)).toEqual({ n: 1 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_movement WHERE movement_type='SHRINKAGE'",
    ).get()).toEqual({ n: 0 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SHRINKAGE'",
    ).get()).toEqual({ n: 0 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='MATERIAL_CONSUMPTION'",
    ).get()).toEqual({ n: 1 });

    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM local_operation_audit WHERE action_code='INVENTORY_TRANSFORM_POSTED'",
    ).get()).toEqual({ n: 1 });
    const outbox = env.database.native.prepare(
      "SELECT operation_type, operation_json AS payload FROM local_sync_outbox WHERE operation_type='INVENTORY_TRANSFORM_POST'",
    ).get() as { operation_type: string; payload: string };
    expect(outbox.operation_type).toBe("INVENTORY_TRANSFORM_POST");
    const outboxEnvelope = JSON.parse(outbox.payload) as {
      aggregate_type: string;
      payload: {
        shrinkage_documentary: boolean;
        source_lots: unknown[];
        lines: Array<{ direction: string }>;
      };
    };
    expect(outboxEnvelope.aggregate_type).toBe("INVENTORY_TRANSFORM");
    expect(outboxEnvelope.payload.shrinkage_documentary).toBe(true);
    expect(outboxEnvelope.payload.source_lots).toHaveLength(1);
    expect(outboxEnvelope.payload.lines.filter((line) => line.direction === "SHRINKAGE")).toHaveLength(1);

    expect(env.transform.execute(SCOPE, SESSION, auth(), executable, NOW).kind).toBe("IDEMPOTENT");
  });

  it("rejects cross-unit production without measured mass and rejects null-mass inventing stock", async () => {
    const env = await poultryFixture();
    // Defect: UND → KGM with canonicalMassUnit=null invents kg without measurement.
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: null,
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: null,
      }],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "1.000000",
        massQuantity: null,
        batchCode: "LOT-INVENTED",
      }],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNIT_EQUIVALENCE_FAILED");

    // Merma without mass mode is also forbidden.
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: null,
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: null,
      }],
      outputs: [{
        presentationId: env.whole.presentationId,
        quantity: "1.000000",
        massQuantity: null,
        batchCode: "LOT-SAME-UNIT",
      }],
      shrinkage: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: null,
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("MASS_RECONCILIATION_FAILED");

    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("2.000000");
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_order",
    ).get()).toEqual({ n: 0 });
  });

  it("rejects mass quantity that disagrees with a mass presentation unit", async () => {
    const env = await poultryFixture();
    // Breast is KGM: quantity 0.800000 must equal massQuantity under canonical KG.
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG",
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "0.800000",
        massQuantity: "1.500000",
        batchCode: "LOT-ARBITRARY-MASS",
      }],
      shrinkage: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "0.500000",
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNIT_EQUIVALENCE_FAILED");
    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("2.000000");
  });

  it("preserves multi-input genealogy with earliest expiry and MIXED supplier", async () => {
    const env = await poultryFixture();
    expect(env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: env.whole.presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "1.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-WHOLE-2",
        manufactureDate: "2026-09-02",
        expiryDate: "2026-09-15",
        supplierReference: "AVICOLA-2",
        receiptDocument: "FAC-W-2",
      },
    }).kind).toBe("POSTED");
    const lots = env.inventoryStore.listBatches(SCOPE, env.whole.presentationId);
    const first = lots.find((lot) => lot.batchCode === "LOT-WHOLE-1")!;
    const second = lots.find((lot) => lot.batchCode === "LOT-WHOLE-2")!;

    const posted = env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG",
      inputs: [
        {
          presentationId: env.whole.presentationId,
          lotId: first.id,
          quantity: "1.000000",
          massQuantity: "2.000000",
        },
        {
          presentationId: env.whole.presentationId,
          lotId: second.id,
          quantity: "1.000000",
          massQuantity: "1.500000",
        },
      ],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "3.200000",
        massQuantity: "3.200000",
        batchCode: "LOT-MIXED-OUT",
      }],
      shrinkage: [{
        presentationId: env.whole.presentationId,
        lotId: first.id,
        quantity: "1.000000",
        massQuantity: "0.300000",
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(posted.kind).toBe("POSTED");
    if (posted.kind !== "POSTED") throw new Error("mixed transform missing");

    const outLot = env.inventoryStore.listBatches(SCOPE, env.breast.presentationId)[0]!;
    expect(outLot.expiryDate).toBe("2026-09-15");
    expect(outLot.supplierReference).toBe("MIXED");
    expect(outLot.receiptDocument).toBe("MIXED");

    const audit = env.database.native.prepare(
      "SELECT details_json AS details FROM local_operation_audit WHERE action_code='INVENTORY_TRANSFORM_POSTED'",
    ).get() as { details: string };
    const details = JSON.parse(audit.details) as {
      source_lots: Array<{ lot_id: string; expiry_date: string | null; supplier_reference: string }>;
    };
    expect(details.source_lots).toHaveLength(2);
    expect(details.source_lots.map((lot) => lot.lot_id).sort()).toEqual([first.id, second.id].sort());
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_line WHERE order_id=? AND direction='INPUT'",
    ).get(posted.orderId)).toEqual({ n: 2 });
  });

  it("rolls back completely, blocks reserved lots, and isolates company scope", async () => {
    const env = await poultryFixture();
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG",
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [
        {
          presentationId: env.breast.presentationId,
          quantity: "1.000000",
          massQuantity: "1.000000",
          batchCode: "LOT-OK",
        },
        {
          presentationId: "018f0000-0000-7000-8000-0000000000aa",
          quantity: "1.000000",
          massQuantity: "1.000000",
          batchCode: "LOT-BAD",
        },
      ],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("PRESENTATION_NOT_FOUND");
    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("2.000000");
    expect(env.inventoryStore.getStock(SCOPE, env.breast.presentationId)).toBeNull();

    const hold = env.inventoryStore.createReservationInTransaction({
      scope: SCOPE, sessionId: SESSION, actorId: USER,
      presentationId: env.whole.presentationId, quantity: "2.000000",
      referenceType: "MANUAL", referenceId: "hold-transform-1",
      idempotencyKey: "reserve-transform-1", requestChecksum: "a".repeat(64),
      correlationId: CORRELATION, causationId: null, expiresAt: null,
    });
    expect(hold.kind).toBe("RESERVED");
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG",
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "2.000000",
        massQuantity: "2.000000",
        batchCode: "LOT-RESERVED",
      }],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("LOT_RESERVED");

    expect(env.transform.execute(
      { ...SCOPE, companyId: OTHER_COMPANY },
      SESSION,
      auth(ALL, OTHER_COMPANY, BRANCH),
      {
        reasonCode: "BUTCHER_BREAKDOWN",
        businessDate: "2026-09-07",
        canonicalMassUnit: "KG",
        inputs: [{
          presentationId: env.whole.presentationId,
          lotId: env.lot.id,
          quantity: "1.000000",
          massQuantity: "2.000000",
        }],
        outputs: [{
          presentationId: env.breast.presentationId,
          quantity: "2.000000",
          massQuantity: "2.000000",
          batchCode: "LOT-OTHER-CO",
        }],
        shrinkage: [],
        idempotencyKey: key(),
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    ).kind).toBe("LOT_NOT_FOUND");

    expect(env.transform.execute({ ...SCOPE, branchId: OTHER_BRANCH }, SESSION, auth(), {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG",
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "2.000000",
        massQuantity: "2.000000",
        batchCode: "LOT-OTHER-BR",
      }],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNAUTHORIZED");

    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_order",
    ).get()).toEqual({ n: 0 });
  });

  it("allows same-unit conservation without mass and rejects quantity imbalance", async () => {
    const env = await buildEnv();
    const pack = env.register.execute(SCOPE, SESSION, auth(), {
      code: "EMB-01",
      name: "Embutido",
      stockControlled: true,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7704000000001",
      priceAmount: "5000.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    const piece = env.register.execute(SCOPE, SESSION, auth(), {
      code: "EMB-02",
      name: "Embutido porción",
      stockControlled: true,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7704000000002",
      priceAmount: "2500.000000",
      currencyCode: "COP",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (pack.kind !== "REGISTERED" || piece.kind !== "REGISTERED") throw new Error("pack fixture");
    expect(env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: pack.presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "4.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
      batch: {
        code: "LOT-PACK-1",
        manufactureDate: "2026-09-01",
        expiryDate: "2026-10-01",
        supplierReference: "SUP-1",
        receiptDocument: "FAC-P-1",
      },
    }).kind).toBe("POSTED");
    const lot = env.inventoryStore.listBatches(SCOPE, pack.presentationId)[0]!;

    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "REPACK",
      businessDate: "2026-09-07",
      canonicalMassUnit: null,
      inputs: [{
        presentationId: pack.presentationId,
        lotId: lot.id,
        quantity: "2.000000",
        massQuantity: null,
      }],
      outputs: [{
        presentationId: piece.presentationId,
        quantity: "3.000000",
        massQuantity: null,
        batchCode: "LOT-PIECE-BAD",
      }],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UNIT_EQUIVALENCE_FAILED");

    const posted = env.transform.execute(SCOPE, SESSION, auth(), {
      reasonCode: "REPACK",
      businessDate: "2026-09-07",
      canonicalMassUnit: null,
      inputs: [{
        presentationId: pack.presentationId,
        lotId: lot.id,
        quantity: "2.000000",
        massQuantity: null,
      }],
      outputs: [{
        presentationId: piece.presentationId,
        quantity: "2.000000",
        massQuantity: null,
        batchCode: "LOT-PIECE-1",
      }],
      shrinkage: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(posted.kind).toBe("POSTED");
    expect(env.inventoryStore.getStock(SCOPE, pack.presentationId)?.quantityOnHand).toBe("2.000000");
    expect(env.inventoryStore.getStock(SCOPE, piece.presentationId)?.quantityOnHand).toBe("2.000000");
  });
});
