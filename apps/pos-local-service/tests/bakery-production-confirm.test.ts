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
import { SqliteBakeryStore } from "../src/bakery/sqlite-bakery-store.js";
import {
  ApproveBakeryRecipeUseCase,
  ConfirmBakeryProductionUseCase,
  CreateBakeryProductionOrderUseCase,
  CreateBakeryRecipeDraftUseCase,
  PlanBakeryProductionOrderUseCase,
  UpsertBakeryFinishedPolicyUseCase,
  UpsertBakeryIngredientProfileUseCase,
} from "../src/bakery/bakery-use-cases.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000bb01";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T15:00:00.000Z"); // America/Bogota commercial 2026-09-07
const PERMS = [
  "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE",
  "INVENTORY_STOCK_READ",
  "BAKERY_RECIPE_MANAGE",
  "BAKERY_PRODUCTION_EXECUTE",
  "BAKERY_PRODUCTION_READ",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = PERMS): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-01T00:00:00.000Z",
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
const key = (): string => { seed += 1; return `idem-bakery-3c4-${String(seed)}`; };

async function openEnv(dataDirectory: string, now: () => Date = () => NOW) {
  const database = LocalDatabase.open({ dataDirectory });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, now);
  const inventoryStore = new SqliteInventoryStore(database, sync, now);
  const bakeryStore = new SqliteBakeryStore(database, sync, inventoryStore, now);
  return {
    database,
    dataDirectory,
    sync,
    catalogStore,
    inventoryStore,
    bakeryStore,
    register: new RegisterProductUseCase(catalogStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    ingredientProfile: new UpsertBakeryIngredientProfileUseCase(bakeryStore),
    finishedPolicy: new UpsertBakeryFinishedPolicyUseCase(bakeryStore),
    createRecipe: new CreateBakeryRecipeDraftUseCase(bakeryStore),
    approveRecipe: new ApproveBakeryRecipeUseCase(bakeryStore),
    createOrder: new CreateBakeryProductionOrderUseCase(bakeryStore),
    planOrder: new PlanBakeryProductionOrderUseCase(bakeryStore),
    confirm: new ConfirmBakeryProductionUseCase(bakeryStore),
  };
}

async function buildEnv(now: () => Date = () => NOW) {
  const dir = await mkdtemp(join(tmpdir(), "pos-bakery-3c4-"));
  directories.push(dir);
  return openEnv(dir, now);
}

async function seedCatalog(env: Awaited<ReturnType<typeof buildEnv>>, flourExpiry: string) {
  const flour = env.register.execute(SCOPE, SESSION, auth(), {
    code: "HARINA-01",
    name: "Harina trigo",
    stockControlled: true,
    presentationName: "Unidad",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7708000000001",
    priceAmount: "3000.000000",
    currencyCode: "COP",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW);
  const bread = env.register.execute(SCOPE, SESSION, auth(), {
    code: "PAN-01",
    name: "Pan tajado",
    stockControlled: true,
    presentationName: "Unidad",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7708000000002",
    priceAmount: "4500.000000",
    currencyCode: "COP",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW);
  if (flour.kind !== "REGISTERED" || bread.kind !== "REGISTERED") {
    throw new Error("catalog seed failed");
  }

  expect(env.ingredientProfile.execute(SCOPE, SESSION, auth(), {
    productId: flour.productId,
    purchasePresentationId: flour.presentationId,
    consumptionUnitCode: "UND",
    consumptionUnitPrecision: 0,
    approvedConversionFactor: null,
    approvedConversionFromUnit: null,
    approvedConversionToUnit: null,
    conservationCode: "AMBIENT",
    requiresLotTracking: true,
    requiresExpiry: true,
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW).kind).toBe("SAVED");

  expect(env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
    productId: bread.productId,
    shelfLifeDays: 2,
    conservationCode: "AMBIENT",
    releaseRequired: false,
    policyBasis: "SHELF_LIFE_DAYS",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  }, NOW).kind).toBe("SAVED");

  expect(env.receive.execute(SCOPE, SESSION, auth(), {
    presentationId: flour.presentationId,
    movementType: "PURCHASE_RECEIPT",
    quantity: "5.000000",
    reasonCode: "SUPPLIER_DELIVERY",
    businessDate: "2026-09-07",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
    batch: {
      code: "LOT-FLOUR-1",
      manufactureDate: "2026-09-01",
      expiryDate: flourExpiry,
      supplierReference: "MOLINO-1",
      receiptDocument: "FAC-F-1",
    },
  }).kind).toBe("POSTED");

  const lot = env.inventoryStore.listBatches(SCOPE, flour.presentationId)[0]!;
  return { flour, bread, lot };
}

describe("3C-4 bakery production confirm", () => {
  it("registers recipe, plans, confirms with ingredient debit and finished credit via transform", async () => {
    const env = await buildEnv();
    const { flour, bread, lot } = await seedCatalog(env, "2026-09-20");

    const draft = env.createRecipe.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null,
      name: "Pan base",
      finishedProductId: bread.productId,
      finishedPresentationId: bread.presentationId,
      baseBatchQuantity: "1.000000",
      expectedYieldQuantity: "10.000000",
      expectedShrinkageQuantity: "0.000000",
      canonicalMassUnit: "KG",
      instructions: null,
      lines: [{
        ingredientProductId: flour.productId,
        ingredientPresentationId: flour.presentationId,
        quantity: "1.000000",
        unitCode: "UND",
        massQuantity: null,
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(draft.kind).toBe("CREATED");
    if (draft.kind !== "CREATED") throw new Error("recipe missing");

    expect(env.approveRecipe.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      expectedVersion: draft.version,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("APPROVED");

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      plannedQuantity: "1.000000",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(order.kind).toBe("CREATED");
    if (order.kind !== "CREATED") throw new Error("order missing");

    expect(env.planOrder.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("PLANNED");

    const flourBefore = env.inventoryStore.getStock(SCOPE, flour.presentationId)?.quantityOnHand;
    const breadBefore = env.inventoryStore.getStock(SCOPE, bread.presentationId)?.quantityOnHand ?? "0.000000";
    expect(flourBefore).toBe("5.000000");
    expect(breadBefore).toBe("0.000000");

    const confirmKey = key();
    const confirmed = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "10.000000",
      actualNetMassQuantity: "0.900000",
      shrinkageQuantity: "0.100000",
      shrinkageReason: "HORNEADO",
      productionDate: "2026-09-07",
      finishedBatchCode: "PAN-20260907-1",
      consumptions: [{
        ingredientPresentationId: flour.presentationId,
        lotId: lot.id,
        plannedQuantity: "1.000000",
        actualQuantity: "1.000000",
        massQuantity: "1.000000",
      }],
      recipeDeviations: [],
      directCosts: [],
      shrinkageAttributions: [{
        presentationId: flour.presentationId,
        lotId: lot.id,
        quantity: "1.000000",
        massQuantity: "0.100000",
      }],
      idempotencyKey: confirmKey,
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(confirmed.kind).toBe("CONFIRMED");
    if (confirmed.kind !== "CONFIRMED") throw new Error("confirm missing");
    expect(confirmed.status).toBe("COMPLETED");
    expect(confirmed.sellable).toBe(true);
    expect(confirmed.finishedExpiryDate).toBe("2026-09-09");

    expect(env.inventoryStore.getStock(SCOPE, flour.presentationId)?.quantityOnHand).toBe("4.000000");
    expect(env.inventoryStore.getStock(SCOPE, bread.presentationId)?.quantityOnHand).toBe("10.000000");

    const movements = env.database.native.prepare(
      `SELECT movement_type, presentation_id, quantity FROM inventory_movement
       WHERE tenant_id=? AND reason_code='BAKERY_PRODUCTION' ORDER BY id`,
    ).all(TENANT) as Array<{ movement_type: string; presentation_id: string; quantity: string }>;
    expect(movements.some((row) =>
      row.movement_type === "TRANSFER_OUT"
      && row.presentation_id === flour.presentationId
      && row.quantity === "1.000000")).toBe(true);
    expect(movements.some((row) =>
      row.movement_type === "TRANSFER_IN"
      && row.presentation_id === bread.presentationId
      && row.quantity === "10.000000")).toBe(true);

    const audit = env.database.native.prepare(
      `SELECT action_code FROM local_operation_audit
       WHERE tenant_id=? AND action_code='BAKERY_PRODUCTION_CONFIRMED'`,
    ).all(TENANT) as Array<{ action_code: string }>;
    expect(audit).toHaveLength(1);

    const outbox = env.database.native.prepare(
      `SELECT operation_type FROM local_sync_outbox
       WHERE tenant_id=? AND operation_type='BAKERY_PRODUCTION_CONFIRMED'`,
    ).all(TENANT) as Array<{ operation_type: string }>;
    expect(outbox).toHaveLength(1);

    // Idempotent reconfirm with the same key must not invent a second debit/credit.
    const again = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "10.000000",
      actualNetMassQuantity: "0.900000",
      shrinkageQuantity: "0.100000",
      shrinkageReason: "HORNEADO",
      productionDate: "2026-09-07",
      finishedBatchCode: "PAN-20260907-1",
      consumptions: [{
        ingredientPresentationId: flour.presentationId,
        lotId: lot.id,
        plannedQuantity: "1.000000",
        actualQuantity: "1.000000",
        massQuantity: "1.000000",
      }],
      recipeDeviations: [],
      directCosts: [],
      shrinkageAttributions: [{
        presentationId: flour.presentationId,
        lotId: lot.id,
        quantity: "1.000000",
        massQuantity: "0.100000",
      }],
      idempotencyKey: confirmKey,
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(again.kind).toBe("IDEMPOTENT");
    expect(env.inventoryStore.getStock(SCOPE, flour.presentationId)?.quantityOnHand).toBe("4.000000");
    expect(env.inventoryStore.getStock(SCOPE, bread.presentationId)?.quantityOnHand).toBe("10.000000");
  });

  it("rejects confirm when ingredient lot is expired on commercial date and leaves stock unchanged", async () => {
    const env = await buildEnv();
    const { flour, bread, lot } = await seedCatalog(env, "2026-09-06"); // expired vs Bogotá 2026-09-07

    const draft = env.createRecipe.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null,
      name: "Pan vencido",
      finishedProductId: bread.productId,
      finishedPresentationId: bread.presentationId,
      baseBatchQuantity: "1.000000",
      expectedYieldQuantity: "10.000000",
      expectedShrinkageQuantity: "0.000000",
      canonicalMassUnit: "KG",
      instructions: null,
      lines: [{
        ingredientProductId: flour.productId,
        ingredientPresentationId: flour.presentationId,
        quantity: "1.000000",
        unitCode: "UND",
        massQuantity: null,
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (draft.kind !== "CREATED") throw new Error("recipe missing");
    expect(env.approveRecipe.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      expectedVersion: draft.version,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("APPROVED");

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      plannedQuantity: "1.000000",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (order.kind !== "CREATED") throw new Error("order missing");

    // Available units exclude expired lots → plan blocks before physical write.
    const planned = env.planOrder.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(planned.kind).toBe("INSUFFICIENT_INGREDIENTS");

    // Confirm from DRAFT still reaches transform and must fail closed.
    const rejected = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "10.000000",
      actualNetMassQuantity: "0.900000",
      shrinkageQuantity: "0.100000",
      shrinkageReason: null,
      productionDate: "2026-09-07",
      finishedBatchCode: "PAN-EXPIRED-1",
      consumptions: [{
        ingredientPresentationId: flour.presentationId,
        lotId: lot.id,
        plannedQuantity: "1.000000",
        actualQuantity: "1.000000",
        massQuantity: "1.000000",
      }],
      recipeDeviations: [],
      directCosts: [],
      shrinkageAttributions: [{
        presentationId: flour.presentationId,
        lotId: lot.id,
        quantity: "1.000000",
        massQuantity: "0.100000",
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(rejected.kind).toBe("LOT_NOT_SELLABLE");
    expect(env.inventoryStore.getStock(SCOPE, flour.presentationId)?.quantityOnHand).toBe("5.000000");
    expect(env.inventoryStore.getStock(SCOPE, bread.presentationId)).toBeNull();
  });

  it("recovers confirm idempotency after local database reopen without inventing stock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-bakery-restart-"));
    directories.push(dir);
    const env = await openEnv(dir);
    const { flour, bread, lot } = await seedCatalog(env, "2026-09-20");

    const draft = env.createRecipe.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null,
      name: "Pan restart",
      finishedProductId: bread.productId,
      finishedPresentationId: bread.presentationId,
      baseBatchQuantity: "1.000000",
      expectedYieldQuantity: "10.000000",
      expectedShrinkageQuantity: "0.000000",
      canonicalMassUnit: "KG",
      instructions: null,
      lines: [{
        ingredientProductId: flour.productId,
        ingredientPresentationId: flour.presentationId,
        quantity: "1.000000",
        unitCode: "UND",
        massQuantity: null,
      }],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (draft.kind !== "CREATED") throw new Error("recipe missing");
    expect(env.approveRecipe.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      expectedVersion: draft.version,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("APPROVED");
    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId,
      plannedQuantity: "1.000000",
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    if (order.kind !== "CREATED") throw new Error("order missing");
    expect(env.planOrder.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      correlationId: CORRELATION,
      causationId: null,
    }, NOW).kind).toBe("PLANNED");

    const confirmKey = "idem-bakery-restart-confirm-1";
    const payload = {
      orderId: order.orderId,
      actualQuantity: "10.000000",
      actualNetMassQuantity: "0.900000",
      shrinkageQuantity: "0.100000",
      shrinkageReason: "HORNEADO",
      productionDate: "2026-09-07",
      finishedBatchCode: "PAN-RESTART-1",
      consumptions: [{
        ingredientPresentationId: flour.presentationId,
        lotId: lot.id,
        plannedQuantity: "1.000000",
        actualQuantity: "1.000000",
        massQuantity: "1.000000",
      }],
      recipeDeviations: [] as const,
      directCosts: [] as const,
      shrinkageAttributions: [{
        presentationId: flour.presentationId,
        lotId: lot.id,
        quantity: "1.000000",
        massQuantity: "0.100000",
      }],
      idempotencyKey: confirmKey,
      correlationId: CORRELATION,
      causationId: null,
    };
    expect(env.confirm.execute(SCOPE, SESSION, auth(), payload, NOW).kind).toBe("CONFIRMED");
    env.database.close();
    databases.pop();

    const reopened = await openEnv(dir);
    const replay = reopened.confirm.execute(SCOPE, SESSION, auth(), payload, NOW);
    expect(replay.kind).toBe("IDEMPOTENT");
    expect(reopened.inventoryStore.getStock(SCOPE, flour.presentationId)?.quantityOnHand).toBe("4.000000");
    expect(reopened.inventoryStore.getStock(SCOPE, bread.presentationId)?.quantityOnHand).toBe("10.000000");
  });

  it("denies production confirm without BAKERY_PRODUCTION_EXECUTE", async () => {
    const env = await buildEnv();
    const denied = env.confirm.execute(SCOPE, SESSION, auth(["BAKERY_PRODUCTION_READ"]), {
      orderId: "018f0000-0000-7000-8000-00000000dead",
      actualQuantity: "1.000000",
      actualNetMassQuantity: "1.000000",
      shrinkageQuantity: "0.000000",
      shrinkageReason: null,
      productionDate: "2026-09-07",
      finishedBatchCode: "X",
      consumptions: [],
      recipeDeviations: [],
      directCosts: [],
      shrinkageAttributions: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    }, NOW);
    expect(denied.kind).toBe("UNAUTHORIZED");
  });
});
