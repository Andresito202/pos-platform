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
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteSaleStore } from "../src/sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../src/sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../src/payments/register-cash-payment-use-case.js";
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
const BRANCH_B = "018f0000-0000-7000-8000-0000000000b3";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc71";
const CAJA = "018f0000-0000-7000-8000-0000000000c1";
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const SCOPE_B: SyncScope = { ...SCOPE, branchId: BRANCH_B };
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ADMIN = [
  "BAKERY_RECIPE_MANAGE", "BAKERY_PRODUCTION_EXECUTE", "BAKERY_PRODUCTION_READ",
  "CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_ADJUST", "INVENTORY_STOCK_READ",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER", "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
];
const CASHIER = ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ", "PAYMENTS_PAYMENT_REGISTER"];
const SUPERVISOR = ["BAKERY_PRODUCTION_READ", "INVENTORY_STOCK_READ"];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = ADMIN, branchId: string = BRANCH): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: branchId,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

let seed = 0;
const key = (): string => { seed += 1; return `idem-pasteleria-${String(seed)}`; };

function seedCashRegister(db: LocalDatabase): void {
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
    ) VALUES (?,?,?,?,?,?,?,'COP','ACTIVE',?,NULL,1,1)`,
  ).run(CAJA, TENANT, COMPANY, BRANCH, "CAJA-P7", "caja-p7", "Caja Pasteleria", at);
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-pasteleria-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  seedCashRegister(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const bakeryStore = new SqliteBakeryStore(database, sync, inventoryStore, () => NOW);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
  const saleStore = new SqliteSaleStore(database, sync, () => NOW);
  const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);
  return {
    dir, database, inventoryStore, bakeryStore, catalogStore, cashStore,
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
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
    createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashStore, saleStore, () => NOW),
    registerCash: new RegisterCashPaymentUseCase(paymentStore, () => NOW),
  };
}

type Env = Awaited<ReturnType<typeof buildEnv>>;

async function seedMassProducts(env: Env, cakeUnit: "G" | "UND" = "G") {
  const flour = env.register.execute(SCOPE, SESSION, auth(), {
    code: `HARINA-${key()}`, name: "Harina", stockControlled: true,
    presentationName: "Gramo", unitCode: "G", unitPrecision: 0,
    barcode: null, priceAmount: "10.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  const sugar = env.register.execute(SCOPE, SESSION, auth(), {
    code: `AZUCAR-${key()}`, name: "Azúcar", stockControlled: true,
    presentationName: "Gramo", unitCode: "G", unitPrecision: 0,
    barcode: null, priceAmount: "8.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  const cake = env.register.execute(SCOPE, SESSION, auth(), {
    code: `TORTA-${key()}`, name: "Torta", stockControlled: true,
    presentationName: cakeUnit === "UND" ? "Unidad" : "Gramo",
    unitCode: cakeUnit, unitPrecision: 0,
    barcode: null, priceAmount: "25000.000000", currencyCode: "COP",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  if (flour.kind !== "REGISTERED" || sugar.kind !== "REGISTERED" || cake.kind !== "REGISTERED") {
    throw new Error("seed products");
  }
  return { flour, sugar, cake };
}

function approveRecipe(env: Env, flour: { productId: string; presentationId: string },
  sugar: { productId: string; presentationId: string },
  cake: { productId: string; presentationId: string },
  opts: {
    base?: string; yieldQty?: string; shrink?: string; releaseRequired?: boolean;
    flourQty?: string; sugarQty?: string;
  } = {},
) {
  env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
    productId: cake.productId, shelfLifeDays: 5, conservationCode: "AMBIENT",
    releaseRequired: opts.releaseRequired ?? false,
    policyBasis: "Política interna de vida útil pastelería",
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  });
  const draft = env.draft.execute(SCOPE, SESSION, auth(), {
    recipeFamilyId: null, name: "Bizcocho",
    finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
    baseBatchQuantity: opts.base ?? "1000.000000",
    expectedYieldQuantity: opts.yieldQty ?? "900.000000",
    expectedShrinkageQuantity: opts.shrink ?? "100.000000",
    canonicalMassUnit: "G",
    instructions: null,
    lines: [
      {
        ingredientProductId: flour.productId, ingredientPresentationId: flour.presentationId,
        quantity: opts.flourQty ?? "600.000000", unitCode: "G",
        massQuantity: opts.flourQty ?? "600.000000",
      },
      {
        ingredientProductId: sugar.productId, ingredientPresentationId: sugar.presentationId,
        quantity: opts.sugarQty ?? "400.000000", unitCode: "G",
        massQuantity: opts.sugarQty ?? "400.000000",
      },
    ],
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  });
  if (draft.kind !== "CREATED") throw new Error(`draft ${draft.kind}`);
  env.approve.execute(SCOPE, SESSION, auth(), {
    recipeId: draft.recipeId, expectedVersion: draft.version,
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  });
  return draft;
}

function receiveLot(
  env: Env, presentationId: string, qty: string, batchCode: string,
  unitCost: string | null,
) {
  const recv = env.receive.execute(SCOPE, SESSION, auth(), {
    presentationId, quantity: qty,
    movementType: "PURCHASE_RECEIPT", reasonCode: "BUY",
    businessDate: "2026-09-07",
    batch: {
      code: batchCode, manufactureDate: "2026-09-01", expiryDate: "2026-12-01",
      supplierReference: `SUP-${batchCode}`, receiptDocument: `FAC-${batchCode}`,
    },
    idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
  }, NOW);
  if (recv.kind !== "POSTED") throw new Error(`recv ${recv.kind}`);
  const lot = env.database.native.prepare(
    `SELECT id FROM inventory_lot WHERE tenant_id=? AND presentation_id=? AND batch_code=?`,
  ).get(TENANT, presentationId, batchCode) as { id: string };
  if (unitCost !== null) {
    expect(env.cost.execute(SCOPE, SESSION, auth(), {
      lotId: lot.id, unitCostAmount: unitCost, currencyCode: "COP",
      sourceKind: "GOODS_RECEIPT", sourceDocument: `FAC-${batchCode}`,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECORDED");
  }
  return lot;
}

describe("prompt-7 pastelería integrity", () => {
  it("rejects unapproved recipe and blocks cashier recipe manage", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    expect(env.finishedPolicy.execute(SCOPE, SESSION, auth(CASHIER), {
      productId: cake.productId, shelfLifeDays: 3, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "Resolución 2674 art.19 trazabilidad interna",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("UNAUTHORIZED");
    expect(env.trace.execute(SCOPE, auth(SUPERVISOR), "018f0000-0000-7000-8000-000000000099").kind)
      .toBe("NOT_FOUND");
    expect(env.confirm.execute(SCOPE, SESSION, auth(CASHIER), {
      orderId: "018f0000-0000-7000-8000-000000000099",
      actualQuantity: "1.000000", actualNetMassQuantity: "1.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "X",
      consumptions: [{
        ingredientPresentationId: flour.presentationId, lotId: "018f0000-0000-7000-8000-0000000000aa",
        plannedQuantity: "1.000000", actualQuantity: "1.000000", massQuantity: "1.000000",
      }],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("UNAUTHORIZED");

    env.finishedPolicy.execute(SCOPE, SESSION, auth(), {
      productId: cake.productId, shelfLifeDays: 3, conservationCode: "AMBIENT",
      releaseRequired: false, policyBasis: "OK",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    const draft = env.draft.execute(SCOPE, SESSION, auth(), {
      recipeFamilyId: null, name: "Bizcocho base",
      finishedProductId: cake.productId, finishedPresentationId: cake.presentationId,
      baseBatchQuantity: "1000.000000", expectedYieldQuantity: "900.000000",
      expectedShrinkageQuantity: "100.000000", canonicalMassUnit: "G",
      instructions: "Mezclar",
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
  });

  it("rejects omitted, unauthorized and unsubstituted recipe consumptions", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    const draft = approveRecipe(env, flour, sugar, cake);
    const flourLot = receiveLot(env, flour.presentationId, "2000.000000", "F-OMIT", "2.000000");
    const sugarLot = receiveLot(env, sugar.presentationId, "2000.000000", "S-OMIT", "3.000000");
    const rogue = env.register.execute(SCOPE, SESSION, auth(), {
      code: `MANTEQ-${key()}`, name: "Mantequilla", stockControlled: true,
      presentationName: "Gramo", unitCode: "G", unitPrecision: 0,
      barcode: null, priceAmount: "1.000000", currencyCode: "COP",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    if (rogue.kind !== "REGISTERED") throw new Error("rogue");
    const rogueLot = receiveLot(env, rogue.presentationId, "500.000000", "M-ROGUE", "4.000000");

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "900.000000", actualNetMassQuantity: "900.000000",
      shrinkageQuantity: "100.000000", shrinkageReason: "EVAPORATION",
      productionDate: "2026-09-07", finishedBatchCode: "OMIT-1",
      consumptions: [{
        ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
        plannedQuantity: "600.000000", actualQuantity: "600.000000", massQuantity: "600.000000",
      }],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECIPE_INGREDIENT_OMITTED");

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "900.000000", actualNetMassQuantity: "900.000000",
      shrinkageQuantity: "100.000000", shrinkageReason: "EVAPORATION",
      productionDate: "2026-09-07", finishedBatchCode: "SUB-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "600.000000", massQuantity: "600.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "400.000000", massQuantity: "400.000000",
        },
        {
          ingredientPresentationId: rogue.presentationId, lotId: rogueLot.id,
          plannedQuantity: "50.000000", actualQuantity: "50.000000", massQuantity: "50.000000",
        },
      ],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECIPE_INGREDIENT_UNAUTHORIZED");

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "900.000000", actualNetMassQuantity: "900.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "QTY-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "400.000000", massQuantity: "400.000000",
        },
      ],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RECIPE_QUANTITY_MISMATCH");
  });

  it("costs multi-lot flour distinctly; unit cakes use independent net mass; partial + yield; release gate", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env, "UND");
    const draft = approveRecipe(env, flour, sugar, cake, {
      base: "2.000000", yieldQty: "2.000000", shrink: "0.000000",
      flourQty: "1000.000000", sugarQty: "800.000000", releaseRequired: true,
    });
    const flourA = receiveLot(env, flour.presentationId, "600.000000", "F-A", "2.000000");
    const flourB = receiveLot(env, flour.presentationId, "600.000000", "F-B", "4.000000");
    const sugarLot = receiveLot(env, sugar.presentationId, "1000.000000", "S-M", "3.000000");

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "2.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");

    // Without measured net mass → reject (do not invent weight/unit).
    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1.000000", actualNetMassQuantity: null,
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "CAKE-NO-MASS",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourA.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: flour.presentationId, lotId: flourB.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "800.000000", actualQuantity: "800.000000", massQuantity: "800.000000",
        },
      ],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("MASS_QUANTITY_REQUIRED");

    const confirmKey = key();
    const confirmed = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      // Partial commercial yield: 1 cake of 2 planned; net mass independent.
      actualQuantity: "1.000000",
      actualNetMassQuantity: "1700.000000",
      shrinkageQuantity: "100.000000",
      shrinkageReason: "TRIM",
      productionDate: "2026-09-07",
      finishedBatchCode: "CAKE-UNIT-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourA.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: flour.presentationId, lotId: flourB.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "800.000000", actualQuantity: "800.000000", massQuantity: "800.000000",
        },
      ],
      recipeDeviations: [],
      directCosts: [{ costKind: "LABOR", amount: "100.000000", sourceNote: "Horno" }],
      shrinkageAttributions: [{
        presentationId: flour.presentationId, lotId: flourA.id,
        quantity: "100.000000", massQuantity: "100.000000",
      }],
      idempotencyKey: confirmKey, correlationId: CORRELATION, causationId: null,
    });
    // 500*2 + 500*4 + 800*3 + 100 = 1000+2000+2400+100 = 5500; unit = floor(5500/1)=5500
    expect(confirmed).toMatchObject({
      kind: "CONFIRMED",
      status: "PARTIALLY_COMPLETED",
      costStatus: "COSTED",
      totalProductionCost: "5500.000000",
      unitCost: "5500.000000",
      sellable: false,
    });
    if (confirmed.kind !== "CONFIRMED") return;

    const lot = env.database.native.prepare(
      `SELECT status,quantity_on_hand FROM inventory_lot WHERE id=?`,
    ).get(confirmed.finishedLotId) as { status: string; quantity_on_hand: string };
    expect(lot).toEqual({ status: "QUARANTINE", quantity_on_hand: "1.000000" });
    expect(env.database.native.prepare(
      `SELECT actual_net_mass_quantity FROM bakery_production_order WHERE id=?`,
    ).get(order.orderId)).toEqual({ actual_net_mass_quantity: "1700.000000" });

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1.000000", actualNetMassQuantity: "1700.000000",
      shrinkageQuantity: "100.000000", shrinkageReason: "TRIM",
      productionDate: "2026-09-07", finishedBatchCode: "CAKE-UNIT-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourA.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: flour.presentationId, lotId: flourB.id,
          plannedQuantity: "500.000000", actualQuantity: "500.000000", massQuantity: "500.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "800.000000", actualQuantity: "800.000000", massQuantity: "800.000000",
        },
      ],
      recipeDeviations: [],
      directCosts: [{ costKind: "LABOR", amount: "100.000000", sourceNote: "Horno" }],
      shrinkageAttributions: [{
        presentationId: flour.presentationId, lotId: flourA.id,
        quantity: "100.000000", massQuantity: "100.000000",
      }],
      idempotencyKey: confirmKey, correlationId: CORRELATION, causationId: null,
    }).kind).toBe("IDEMPOTENT");

    expect(env.release.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId, idempotencyKey: key(),
      correlationId: CORRELATION, causationId: null,
    }).kind).toBe("RELEASED");
  });

  it("NOT_COSTABLE keeps null costs; sale from Caja after release uses FEFO; cancel/isolation/restart", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    const draft = approveRecipe(env, flour, sugar, cake, { releaseRequired: false });
    const flourLot = receiveLot(env, flour.presentationId, "2000.000000", "F-NC", "2.000000");
    const sugarLot = receiveLot(env, sugar.presentationId, "2000.000000", "S-NC", null);

    const cancelOrder = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (cancelOrder.kind !== "CREATED") throw new Error("cancel order");
    expect(env.cancel.execute(SCOPE, SESSION, auth(), {
      orderId: cancelOrder.orderId, correlationId: CORRELATION, causationId: null,
    }).kind).toBe("CANCELLED");
    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(2000000000n);

    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");

    const confirmed = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1000.000000", actualNetMassQuantity: "1000.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "NC-1",
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
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(confirmed).toMatchObject({
      kind: "CONFIRMED",
      costStatus: "NOT_COSTABLE",
      totalProductionCost: null,
      unitCost: null,
      sellable: true,
    });
    if (confirmed.kind !== "CONFIRMED") return;
    const snap = JSON.parse((env.database.native.prepare(
      `SELECT cost_snapshot_json FROM bakery_production_order WHERE id=?`,
    ).get(order.orderId) as { cost_snapshot_json: string }).cost_snapshot_json);
    expect(snap.zero_cost_forbidden).toBe(true);
    expect(snap.definitive_cost_reported).toBe(false);
    expect(snap.commercial_sale_when_not_costable).toBe("ALLOWED_IF_LOT_SELLABLE");

    // Branch isolation: order not visible under other branch.
    expect(env.trace.execute(SCOPE_B, auth(ADMIN, BRANCH_B), order.orderId).kind).toBe("NOT_FOUND");

    const shift = env.openShift.execute(SCOPE, SESSION, auth(), {
      cashRegisterId: CAJA, openingAmount: "0.000000",
      businessDate: "2026-09-07", timezoneId: "America/Bogota", utcOffsetMinutes: -300,
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(shift.kind).toBe("OPENED");
    if (shift.kind !== "OPENED") return;

    const sale = env.createSale.execute(SCOPE, SESSION, auth(), {
      cashRegisterId: CAJA,
      idempotencyKey: key(),
      channel: "POS_LOCAL",
      businessDate: "2026-09-07",
      timezoneId: "America/Bogota",
      utcOffsetMinutes: -300,
      documentSeries: "FS-P7",
      currencyCode: "COP",
      correlationId: CORRELATION,
      causationId: null,
      lines: [{
        productId: cake.productId, presentationId: cake.presentationId, quantity: "100.000000",
      }],
    });
    expect(sale.kind).toBe("CREATED");
    if (sale.kind !== "CREATED") return;
    const pay = env.registerCash.execute(SCOPE, SESSION, auth(), {
      saleId: sale.saleId,
      amount: sale.payableAmount,
      tenderedAmount: null,
      idempotencyKey: key(),
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(pay.kind).toBe("CONFIRMED");

    env.database.close();
    databases.pop();
    const reopened = LocalDatabase.open({ dataDirectory: env.dir });
    databases.push(reopened);
    expect(reopened.native.prepare(
      `SELECT cost_status,total_production_cost,unit_cost,actual_net_mass_quantity
       FROM bakery_production_order WHERE id=?`,
    ).get(order.orderId)).toEqual({
      cost_status: "NOT_COSTABLE",
      total_production_cost: null,
      unit_cost: null,
      actual_net_mass_quantity: "1000.000000",
    });
  });

  it("rolls back on mass failure; quantity variance requires documented deviation", async () => {
    const env = await buildEnv();
    const { flour, sugar, cake } = await seedMassProducts(env);
    const draft = approveRecipe(env, flour, sugar, cake, {
      yieldQty: "1000.000000", shrink: "0.000000",
    });
    const flourLot = receiveLot(env, flour.presentationId, "800.000000", "F-R", "2.000000");
    const sugarLot = receiveLot(env, sugar.presentationId, "500.000000", "S-R", "3.000000");
    const order = env.createOrder.execute(SCOPE, SESSION, auth(), {
      recipeId: draft.recipeId, plannedQuantity: "1000.000000",
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    if (order.kind !== "CREATED") throw new Error("order");

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "950.000000", actualNetMassQuantity: "950.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "FAIL-1",
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
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("MASS_RECONCILIATION_FAILED");
    expect(env.inventoryStore.availableUnits(SCOPE, flour.presentationId)).toBe(800000000n);

    expect(env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1000.000000", actualNetMassQuantity: "1000.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "VAR-1",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "650.000000", massQuantity: "650.000000",
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "350.000000", massQuantity: "350.000000",
        },
      ],
      recipeDeviations: [], directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }).kind).toBe("DEVIATION_REQUIRED");

    const withDev = env.confirm.execute(SCOPE, SESSION, auth(), {
      orderId: order.orderId,
      actualQuantity: "1000.000000", actualNetMassQuantity: "1000.000000",
      shrinkageQuantity: "0.000000", shrinkageReason: null,
      productionDate: "2026-09-07", finishedBatchCode: "VAR-OK",
      consumptions: [
        {
          ingredientPresentationId: flour.presentationId, lotId: flourLot.id,
          plannedQuantity: "600.000000", actualQuantity: "650.000000", massQuantity: "650.000000",
          deviationKind: "QUANTITY_VARIANCE",
          deviationReason: "Ajuste báscula autorizado",
          deviationAuthorizedBy: USER,
        },
        {
          ingredientPresentationId: sugar.presentationId, lotId: sugarLot.id,
          plannedQuantity: "400.000000", actualQuantity: "350.000000", massQuantity: "350.000000",
          deviationKind: "QUANTITY_VARIANCE",
          deviationReason: "Ajuste báscula autorizado",
          deviationAuthorizedBy: USER,
        },
      ],
      recipeDeviations: [
        {
          kind: "QUANTITY_VARIANCE",
          recipePresentationId: null,
          ingredientPresentationId: flour.presentationId,
          reason: "Ajuste báscula autorizado",
          authorizedBy: USER,
        },
        {
          kind: "QUANTITY_VARIANCE",
          recipePresentationId: null,
          ingredientPresentationId: sugar.presentationId,
          reason: "Ajuste báscula autorizado",
          authorizedBy: USER,
        },
      ],
      directCosts: [], shrinkageAttributions: [],
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    });
    expect(withDev.kind).toBe("CONFIRMED");
    expect(env.database.native.prepare(
      `SELECT count(*) AS n FROM bakery_production_recipe_deviation WHERE order_id=?`,
    ).get(order.orderId)).toEqual({ n: 2 });
  });
});
