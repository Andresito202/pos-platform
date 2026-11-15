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

describe("prompt-5 atomic butcher transform", () => {
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

  it("posts multi-output transform with mass reconcile, genealogy, audit and outbox", async () => {
    const env = await poultryFixture();
    const request = {
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
        quantity: "0.000000",
        massQuantity: "0.200000",
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    };
    // Shrinkage quantity must be positive — document merma as remaining mass against leftover units.
    // Use a partial quantity debit for merma on the same lot instead of zero quantity.
    const executable = {
      ...request,
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
    };
    const posted = env.transform.execute(SCOPE, SESSION, auth(), executable, NOW);
    expect(posted.kind).toBe("POSTED");
    if (posted.kind !== "POSTED") throw new Error("transform missing");

    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("0.000000");
    expect(env.inventoryStore.getStock(SCOPE, env.breast.presentationId)?.quantityOnHand).toBe("0.800000");
    expect(env.inventoryStore.getStock(SCOPE, env.wings.presentationId)?.quantityOnHand).toBe("0.400000");
    expect(env.inventoryStore.getStock(SCOPE, env.legs.presentationId)?.quantityOnHand).toBe("0.600000");

    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_order WHERE id=?",
    ).get(posted.orderId)).toEqual({ n: 1 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_line WHERE order_id=?",
    ).get(posted.orderId)).toEqual({ n: 5 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM local_operation_audit WHERE action_code='INVENTORY_TRANSFORM_POSTED'",
    ).get()).toEqual({ n: 1 });
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM local_sync_outbox WHERE operation_type='INVENTORY_TRANSFORM_POST'",
    ).get()).toEqual({ n: 1 });

    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      ...executable,
      idempotencyKey: executable.idempotencyKey,
    }, NOW).kind).toBe("IDEMPOTENT");
  });

  it("rolls back completely when an output fails and blocks reserved/expired/blocked lots", async () => {
    const env = await poultryFixture();
    const base = {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: null as "KG" | null,
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: null,
      }],
      outputs: [
        {
          presentationId: env.breast.presentationId,
          quantity: "0.500000",
          massQuantity: null,
          batchCode: "LOT-B-FAIL",
        },
        {
          presentationId: "018f0000-0000-7000-8000-0000000000aa",
          quantity: "0.500000",
          massQuantity: null,
          batchCode: "LOT-BAD",
        },
      ],
      shrinkage: [] as Array<{
        presentationId: string; lotId: string; quantity: string; massQuantity: string | null;
      }>,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    };
    expect(env.transform.execute(SCOPE, SESSION, auth(), base, NOW).kind).toBe("PRESENTATION_NOT_FOUND");
    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("2.000000");
    expect(env.inventoryStore.getStock(SCOPE, env.breast.presentationId)).toBeNull();
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_order",
    ).get()).toEqual({ n: 0 });

    const hold = env.inventoryStore.createReservationInTransaction({
      scope: SCOPE, sessionId: SESSION, actorId: USER,
      presentationId: env.whole.presentationId, quantity: "2.000000",
      referenceType: "MANUAL", referenceId: "hold-transform-1",
      idempotencyKey: "reserve-transform-1", requestChecksum: "a".repeat(64),
      correlationId: CORRELATION, causationId: null, expiresAt: null,
    });
    expect(hold.kind).toBe("RESERVED");
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      ...base,
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "0.500000",
        massQuantity: null,
        batchCode: "LOT-RESERVED-BLOCK",
      }],
      idempotencyKey: key(),
    }, NOW).kind).toBe("LOT_RESERVED");
    expect(env.inventoryStore.getStock(SCOPE, env.whole.presentationId)?.quantityOnHand).toBe("2.000000");

    // Free reservation then block the lot.
    if (hold.kind !== "RESERVED") throw new Error("hold missing");
    expect(env.inventoryStore.releaseReservationInTransaction({
      scope: SCOPE, sessionId: SESSION, actorId: USER, reservationId: hold.reservationId,
      reasonCode: "HOLD_CANCELLED", idempotencyKey: "release-transform-1",
      requestChecksum: "b".repeat(64), correlationId: CORRELATION, causationId: null,
    })).toBe("RELEASED");

    expect(env.changeStatus.execute(SCOPE, SESSION, auth(), {
      lotId: env.lot.id,
      status: "BLOCKED",
      reasonCode: "QUALITY_HOLD",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("UPDATED");
    expect(env.transform.execute(SCOPE, SESSION, auth(), {
      ...base,
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "0.500000",
        massQuantity: null,
        batchCode: "LOT-BLOCKED",
      }],
      idempotencyKey: key(),
    }, NOW).kind).toBe("LOT_NOT_SELLABLE");
  });

  it("rejects mass imbalance and unauthorized actors without writing", async () => {
    const env = await poultryFixture();
    const request = {
      reasonCode: "BUTCHER_BREAKDOWN",
      businessDate: "2026-09-07",
      canonicalMassUnit: "KG" as const,
      inputs: [{
        presentationId: env.whole.presentationId,
        lotId: env.lot.id,
        quantity: "1.000000",
        massQuantity: "2.000000",
      }],
      outputs: [{
        presentationId: env.breast.presentationId,
        quantity: "1.000000",
        massQuantity: "1.000000",
        batchCode: "LOT-IMBALANCE",
      }],
      shrinkage: [] as Array<{
        presentationId: string; lotId: string; quantity: string; massQuantity: string | null;
      }>,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    };
    expect(env.transform.execute(SCOPE, SESSION, auth(), request, NOW).kind)
      .toBe("MASS_RECONCILIATION_FAILED");
    expect(env.transform.execute(SCOPE, SESSION, auth([]), {
      ...request,
      canonicalMassUnit: null,
      inputs: [{ ...request.inputs[0]!, massQuantity: null }],
      outputs: [{ ...request.outputs[0]!, massQuantity: null }],
      idempotencyKey: key(),
    }, NOW).kind).toBe("UNAUTHORIZED");
    // Auth assignments stay on BRANCH: other-branch scope fails closed before lot IO.
    expect(env.transform.execute({ ...SCOPE, branchId: OTHER_BRANCH }, SESSION, auth(), {
      ...request,
      canonicalMassUnit: null,
      inputs: [{ ...request.inputs[0]!, massQuantity: null }],
      outputs: [{ ...request.outputs[0]!, massQuantity: null }],
      idempotencyKey: key(),
    }, NOW).kind).toBe("UNAUTHORIZED");
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_transform_order",
    ).get()).toEqual({ n: 0 });
  });
});
