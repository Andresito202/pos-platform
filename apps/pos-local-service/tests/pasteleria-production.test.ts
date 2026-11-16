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
  UpsertBakeryFinishedPolicyUseCase,
  CreateBakeryRecipeDraftUseCase,
  ApproveBakeryRecipeUseCase,
  RecordBakeryLotAcquisitionCostUseCase,
  CreateBakeryProductionOrderUseCase,
  PlanBakeryProductionOrderUseCase,
  CancelBakeryProductionOrderUseCase,
  ConfirmBakeryProductionUseCase,
  ReleaseBakeryFinishedLotUseCase,
  GetBakeryProductionTraceUseCase,
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
const CORRELATION = "018f0000-0000-7000-8000-00000000cc71";
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ADMIN = [
  "BAKERY_RECIPE_MANAGE", "BAKERY_PRODUCTION_EXECUTE", "BAKERY_PRODUCTION_READ",
  "CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_ADJUST", "INVENTORY_STOCK_READ",
];
const CASHIER = ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ"];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = ADMIN): StoredAuthorizationSnapshot {
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
const key = (): string => { seed += 1; return `idem-pasteleria-${String(seed)}`; };

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-pasteleria-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const bakeryStore = new SqliteBakeryStore(database, sync, inventoryStore, () => NOW);
  return {
    dir, database, inventoryStore, bakeryStore,
    register: new RegisterProductUseCase(catalogStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    finishedPolicy: new UpsertBakeryFinishedPolicyUseCase(bakeryStore),
    draft: new CreateBakeryRecipeDraftUseCase(bakeryStore),
    approve: new ApproveBakeryRecipeUseCase(bakeryStore),
    cost: new RecordBakeryLotAcquisitionCostUseCase(bakeryStore),
    createOrder: new CreateBakeryProductionOrderUseCase(bakeryStore),
    plan: new PlanBakeryProductionOrderUseCase(bakeryStore),
    cancel: new CancelBakeryProductionOrderUseCase(bakeryStore),
    confirm: new ConfirmBakeryProductionUseCase(bakeryStore),
    release: new ReleaseBakeryFinishedLotUseCase(bakeryStore),
    trace: new GetBakeryProductionTraceUseCase(bakeryStore),
  };
}

async function seedMassProducts(env: Awaited<ReturnType<typeof buildEnv>>) {
  const flour = env.register.execute(SCOPE, SESSION, auth(), {
    code: "HARINA", name: "Harina", stockControlled: true,
    presentationName: "Gramo", unitCode: "G", unitPrecision: 0,
    barcode: null, priceAmount: "10.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  const sugar = env.register.execute(SCOPE, SESSION, auth(), {
    code: "AZUCAR", name: "Azúcar", stockControlled: true,
    presentationName: "Gramo", unitCode: "G", unitPrecision: 0,
    barcode: null, priceAmount: "8.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  const cake = env.register.execute(SCOPE, SESSION, auth(), {
    code: "TORTA", name: "Torta", stockControlled: true,
    presentationName: "Unidad", unitCode: "G", unitPrecision: 0,
    barcode: null, priceAmount: "25000.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  if (flour.kind !== "REGISTERED" || sugar.kind !== "REGISTERED" || cake.kind !== "REGISTERED") {
    throw new Error("seed products");
  }
  return { flour, sugar, cake };
}

describe("prompt-7 pastelería recipes and production", () => {
  it("rejects unapproved recipe for production and blocks cashier recipe manage", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    expect(env.finishedPolicy.execute(SCOPE, SESSION, auth(CASHIER), {
      productId: cake.productId, shelfLifeDays: 3, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "Resolución 2674 art.19 trazabilidad interna",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("UNAUTHORIZED");

    const policy = env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
      productId: cake.productId, shelfLifeDays: 3, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "Resolución 2674 art.19 trazabilidad interna",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(policy.kind).toBe("SAVED");

    const draft = env.draft.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null, name: "Bizcocho base",
      finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
      baseBatchQuantity: "1000.000000", expectedYieldQuantity: "900.000000",
      expectedShrinkageQuantity: "100.000000", canonicalMassUnit: "G",
      instructions: "Mezclar y hornear",
      lines: [
        {
          ingredientProductId: flour.productId, ingredientPresentationId: flour.presentationId,
          quantity: "600.000000", unitCode: "G", massQuantity: "600.000000",
        },
        {
          ingredientProductId: sugar.productId, ingredientPresentationId: sugar.presentationId,
          quantity: "400.000000", unitCode: "G", massQuantity: "400.000000",
        },
      ],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(draft.kind).toBe("CREATED");
    if (draft.kind !== "CREATED") return;

    expect(env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECIPE_NOT_APPROVED");

    const approved = env.approve.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, expectedVersion: draft.version,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(approved.kind).toBe("APPROVED");
  });

  it("produces finished lot with atomic consumption, cost snapshot and genealogy; cancel before consume; idempotent confirm", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
      productId: cake.productId, shelfLifeDays: 5, conservationCode: "AMBIENT",
      releaseRequired: true, policyBasis: "Política interna de vida útil pastelería",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });

    const draft = env.draft.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null, name: "Bizcocho",
      finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
      baseBatchQuantity: "1000.000000", expectedYieldQuantity: "900.000000",
      expectedShrinkageQuantity: "100.000000", canonicalMassUnit: "G",
      instructions: null,
      lines: [
        {
          ingredientProductId: flour.productId, ingredientPresentationId: flour.presentationId,
          quantity: "600.000000", unitCode: "G", massQuantity: "600.000000",
        },
        {
          ingredientProductId: sugar.productId, ingredientPresentationId: sugar.presentationId,
          quantity: "400.000000", unitCode: "G", massQuantity: "400.000000",
        },
      ],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (draft.kind !== "CREATED") throw new Error("draft");
    env.approve.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, expectedVersion: draft.version,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });

    const flourRecv = env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: flour.presentationId, quantity: "2000.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY",
      businessDate: "2026-09-07",
      batch: {
        code: "F-1", manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
        supplierReference: "MOLINO-A", receiptDocument: "FAC-1",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    const sugarRecv = env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: sugar.presentationId, quantity: "2000.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY",
      businessDate: "2026-09-07",
      batch: {
        code: "S-1", manufactureDate: "2026-09-01", expiryDate: "2026-11-01",
        supplierReference: "ING-B", receiptDocument: "FAC-2",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    expect(flourRecv.kind).toBe("POSTED");
    expect(sugarRecv.kind).toBe("POSTED");

    const flourLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE tenant_id=? AND presentation_id=? AND batch_code='F-1'`,
    ).get(TENANT, flour.presentationId) as { id: string };
    const sugarLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE tenant_id=? AND presentation_id=? AND batch_code='S-1'`,
    ).get(TENANT, sugar.presentationId) as { id: string };

    expect(env.cost.execute(SCOPE, SESSION, auth(), {
      lotId: flourLot.id, unitCostAmount: "2.000000", currencyCode: "COP",
      sourceKind: "GOODS_RECEIPT", sourceDocument: "FAC-1",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECORDED");
    expect(env.cost.execute(SCOPE, SESSION, auth(), {
      lotId: sugarLot.id, unitCostAmount: "3.000000", currencyCode: "COP",
      sourceKind: "GOODS_RECEIPT", sourceDocument: "FAC-2",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECORDED");

    const cancelOrder = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(cancelOrder.kind).toBe("CREATED");
    if (cancelOrder.kind !== "CREATED") return;
    expect(env.cancel.execute(SCOPE, SESSION, auth(), {
      orderId: cancelOrder.orderId, correlationId: CORRELATION, causationId: null,
    }).kind).toBe("CANCELLED");
    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(2000000000n);

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(order.kind).toBe("CREATED");
    if (order.kind !== "CREATED") return;
    expect(env.plan.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId, correlationId: CORRELATION, causationId: null,
    }).kind).toBe("PLANNED");

    const confirmKey = key();
    const confirmPayload = {
      orderId: order.orderId,
      actualQuantity: "900.000000",
      shrinkageQuantity: "100.000000",
      shrinkageReason: "EVAPORATION",
      productionDate: "2026-09-07",
      finishedBatchCode: "TORTA-20260907-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "600.000000", massQuantity: "600.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "400.000000", massQuantity: "400.000000",
        },
      ],
      directCosts: [{
        costKind: "LABOR" as const, amount: "500.000000", sourceNote: "Hora horno documentada",
      }],
      shrinkageAttributions: [
        {
          presentationId: flour.presentationId, lotId: flourLot.id,
          quantity: "60.000000", massQuantity: "60.000000",
        },
        {
          presentationId: sugar.presentationId, lotId: sugarLot.id,
          quantity: "40.000000", massQuantity: "40.000000",
        },
      ],
      idempotencyKey: confirmKey,
      correlationId: CORRELATION,
      causationId: null,
    };

    const confirmed = env.confirm.execute(SCOPE, SESSION, auth(), confirmPayload);
    expect(confirmed).toMatchObject({
      kind: "CONFIRMED",
      costStatus: "COSTED",
      sellable: false,
    });
    if (confirmed.kind !== "CONFIRMED") return;

    // 600*2 + 400*3 + 500 = 1200+1200+500 = 2900; unit = floor(2900/900)=3.222222
    expect(confirmed.totalProductionCost).toBe("2900.000000");
    expect(confirmed.unitCost).toBe("3.222222");

    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(1400000000n);
    expect(env.inventoryStore.availableUnits(SCOPE, sugar.presentationId)).toBe(1600000000n);

    const finished = env.database.native.prepare(
      `SELECT status,expiry_date,quantity_on_hand FROM inventory_lot WHERE tenant_id=? AND id=?`,
    ).get(TENANT, confirmed.finishedLotId) as {
      status: string; expiry_date: string; quantity_on_hand: string;
    };
    expect(finished.status).toBe("QUARANTINE");
    expect(finished.expiry_date).toBe("2026-09-12");
    expect(finished.quantity_on_hand).toBe("900.000000");

    const replay = env.confirm.execute(SCOPE, SESSION, auth(), confirmPayload);
    expect(replay).toMatchObject({ kind: "IDEMPOTENT", orderId: confirmed.orderId });
    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(1400000000n);

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      ...confirmPayload,
      idempotencyKey: confirmKey,
      actualQuantity: "800.000000",
    }).kind).toBe("IDEMPOTENCY_CONFLICT");

    expect(env.cancel.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId, correlationId: CORRELATION, causationId: null,
    }).kind).toBe("ALREADY_CONSUMED");

    const released = env.release.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId, idempotencyKey: key(),
      correlationId: CORRELATION, causationId: null,
    });
    expect(released.kind).toBe("RELEASED");
    expect(env.database.native.prepare(
      `SELECT status FROM inventory_lot WHERE tenant_id=? AND id=?`,
    ).get(TENANT, confirmed.finishedLotId)).toEqual({ status: "AVAILABLE" });

    const trace = env.trace.execute(SCOPE, auth(), order.orderId);
    expect(trace.kind).toBe("FOUND");
    if (trace.kind !== "FOUND") return;
    expect(trace.sources).toHaveLength(2);
    expect(trace.sources.map((s) => (s.lot as { supplier_reference: string }).supplier_reference).sort())
      .toEqual(["ING-B", "MOLINO-A"]);

    env.database.close();
    databases.pop();
    const reopened = LocalDatabase.open({ dataDirectory: env.dir });
    databases.push(reopened);
    expect(reopened.native.prepare(
      `SELECT cost_status,total_production_cost,unit_cost FROM bakery_production_order
       WHERE tenant_id=? AND id=?`,
    ).get(TENANT, order.orderId)).toEqual({
      cost_status: "COSTED",
      total_production_cost: "2900.000000",
      unit_cost: "3.222222",
    });
  });

  it("marks NOT_COSTABLE when lot acquisition cost is missing and does not invent zero", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
      productId: cake.productId, shelfLifeDays: 2, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "Vida útil autorizada",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    const draft = env.draft.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null, name: "Bizcocho sin costo",
      finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
      baseBatchQuantity: "1000.000000", expectedYieldQuantity: "1000.000000",
      expectedShrinkageQuantity: "0.000000", canonicalMassUnit: "G",
      instructions: null,
      lines: [
        {
          ingredientProductId: flour.productId, ingredientPresentationId: flour.presentationId,
          quantity: "600.000000", unitCode: "G", massQuantity: "600.000000",
        },
        {
          ingredientProductId: sugar.productId, ingredientPresentationId: sugar.presentationId,
          quantity: "400.000000", unitCode: "G", massQuantity: "400.000000",
        },
      ],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (draft.kind !== "CREATED") throw new Error("draft");
    env.approve.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, expectedVersion: draft.version,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: flour.presentationId, quantity: "600.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY", businessDate: "2026-09-07",
      batch: {
        code: "F-X", manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
        supplierReference: "MOLINO", receiptDocument: "FAC-X",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: sugar.presentationId, quantity: "400.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY", businessDate: "2026-09-07",
      batch: {
        code: "S-X", manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
        supplierReference: "ING", receiptDocument: "FAC-Y",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    const flourLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE batch_code='F-X'`,
    ).get() as { id: string };
    const sugarLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE batch_code='S-X'`,
    ).get() as { id: string };
    // Only flour costed — sugar missing → NOT_COSTABLE
    env.cost.execute(SCOPE, SESSION, auth(), {
      lotId: flourLot.id, unitCostAmount: "2.000000", currencyCode: "COP",
      sourceKind: "GOODS_RECEIPT", sourceDocument: "FAC-X",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");
    const confirmed = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1000.000000",
      shrinkageQuantity: "0.000000",
      shrinkageReason: null,
      productionDate: "2026-09-07",
      finishedBatchCode: "TORTA-NC",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "600.000000", massQuantity: "600.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "400.000000", massQuantity: "400.000000",
        },
      ],
      directCosts: [],
      shrinkageAttributions: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(confirmed).toMatchObject({
      kind: "CONFIRMED",
      costStatus: "NOT_COSTABLE",
      totalProductionCost: null,
      unitCost: null,
      sellable: true,
    });
  });

  it("rolls back production when mass reconciliation fails; no finished lot", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
      productId: cake.productId, shelfLifeDays: 2, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "OK",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    const draft = env.draft.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null, name: "Bizcocho fail",
      finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
      baseBatchQuantity: "1000.000000", expectedYieldQuantity: "1000.000000",
      expectedShrinkageQuantity: "0.000000", canonicalMassUnit: "G",
      instructions: null,
      lines: [
        {
          ingredientProductId: flour.productId, ingredientPresentationId: flour.presentationId,
          quantity: "600.000000", unitCode: "G", massQuantity: "600.000000",
        },
        {
          ingredientProductId: sugar.productId, ingredientPresentationId: sugar.presentationId,
          quantity: "400.000000", unitCode: "G", massQuantity: "400.000000",
        },
      ],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (draft.kind !== "CREATED") throw new Error("draft");
    env.approve.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, expectedVersion: draft.version,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: flour.presentationId, quantity: "600.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY", businessDate: "2026-09-07",
      batch: {
        code: "F-R", manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
        supplierReference: "M", receiptDocument: "R1",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    env.receive.execute(SCOPE, SESSION, auth(), {
      presentationId: sugar.presentationId, quantity: "400.000000",
      movementType: "PURCHASE_RECEIPT", reasonCode: "BUY", businessDate: "2026-09-07",
      batch: {
        code: "S-R", manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
        supplierReference: "M", receiptDocument: "R2",
      },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    const flourLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE batch_code='F-R'`,
    ).get() as { id: string };
    const sugarLot = env.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE batch_code='S-R'`,
    ).get() as { id: string };
    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");
    const failed = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "950.000000", // mass inputs 1000 != output 950 without shrinkage
      shrinkageQuantity: "0.000000",
      shrinkageReason: null,
      productionDate: "2026-09-07",
      finishedBatchCode: "FAIL-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "600.000000", massQuantity: "600.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "400.000000", massQuantity: "400.000000",
        },
      ],
      directCosts: [],
      shrinkageAttributions: [],
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(failed.kind).toBe("MASS_RECONCILIATION_FAILED");
    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(600000000n);
    expect(env.database.native.prepare(
      `SELECT count(*) AS n FROM inventory_lot WHERE batch_code='FAIL-1'`,
    ).get()).toEqual({ n: 0 });
  });
});
