import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { readCatalogAvailability } from "../src/catalog/catalog-availability.js";
import { ListCatalogItemsUseCase } from "../src/catalog/list-catalog-items-use-case.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
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

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[]): StoredAuthorizationSnapshot {
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

async function buildEnv(stockControlled = true) {
  const dir = await mkdtemp(join(tmpdir(), "pos-catalog-availability-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const registered = new RegisterProductUseCase(catalogStore).execute(
    SCOPE, SESSION, auth(["CATALOG_PRODUCT_REGISTER"]), {
      code: stockControlled ? "CAJA-AVAIL-1" : "CAJA-OPEN-1",
      name: "Producto Caja",
      stockControlled,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: null,
      priceAmount: "1000.000000",
      currencyCode: "COP",
      idempotencyKey: `reg:${stockControlled ? "ctrl" : "open"}`,
      correlationId: CORRELATION,
      causationId: null,
    },
  );
  if (registered.kind !== "REGISTERED") throw new Error(registered.kind);
  return {
    catalogStore,
    inventoryStore,
    presentationId: registered.presentationId,
    receive: new ReceiveStockUseCase(inventoryStore),
    list: new ListCatalogItemsUseCase(catalogStore, inventoryStore),
  };
}

describe("catalog availability for cashier tiles", () => {
  it("tracks 20 receive → reserve 3 (=17 available) → receive 10 (=27) with idempotent replay", async () => {
    const { inventoryStore, presentationId, receive, list } = await buildEnv(true);
    const admin = auth([
      "CATALOG_PRODUCT_READ",
      "INVENTORY_STOCK_RECEIVE",
    ]);

    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "20.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:20",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");

    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toEqual({
      quantity_available: "20.000000",
      quantity_on_hand: "20.000000",
      quantity_reserved: "0.000000",
      quantity_unsellable: "0.000000",
      low_stock_threshold: null,
      availability_state: "AVAILABLE",
    });

    const reserved = inventoryStore.createReservation({
      scope: SCOPE,
      sessionId: SESSION,
      actorId: USER,
      presentationId,
      quantity: "3.000000",
      referenceType: "SALE",
      referenceId: randomUUID(),
      idempotencyKey: "res:3",
      requestChecksum: "c".repeat(64),
      correlationId: CORRELATION,
      causationId: null,
      expiresAt: null,
    });
    expect(reserved.kind).toBe("RESERVED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toMatchObject({
      quantity_available: "17.000000",
      quantity_on_hand: "20.000000",
      quantity_reserved: "3.000000",
      availability_state: "AVAILABLE",
    });

    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "10.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:10",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");

    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toMatchObject({
      quantity_available: "27.000000",
      quantity_on_hand: "30.000000",
      quantity_reserved: "3.000000",
      availability_state: "AVAILABLE",
    });

    const replay = receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "10.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:10",
      correlationId: CORRELATION,
      causationId: null,
    });
    expect(replay.kind === "POSTED" || replay.kind === "IDEMPOTENT").toBe(true);
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true).quantity_on_hand)
      .toBe("30.000000");

    const oversell = inventoryStore.createReservation({
      scope: SCOPE,
      sessionId: SESSION,
      actorId: USER,
      presentationId,
      quantity: "28.000000",
      referenceType: "SALE",
      referenceId: randomUUID(),
      idempotencyKey: "res:over",
      requestChecksum: "e".repeat(64),
      correlationId: CORRELATION,
      causationId: null,
      expiresAt: null,
    });
    expect(oversell.kind).toBe("INSUFFICIENT_STOCK");

    const listed = list.execute(SCOPE, auth(["CATALOG_PRODUCT_READ"]), {
      query: "CAJA-AVAIL-1", limit: 10, offset: 0,
    });
    expect(listed.kind).toBe("FOUND");
    if (listed.kind !== "FOUND") return;
    expect(listed.items[0]?.availability).toMatchObject({
      quantity_available: "27.000000",
      availability_state: "AVAILABLE",
    });
  });

  it("marks uncontrolled products as NOT_TRACKED without fabricating zero stock", async () => {
    const { inventoryStore, presentationId } = await buildEnv(false);
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, false)).toEqual({
      quantity_available: null,
      quantity_on_hand: null,
      quantity_reserved: null,
      quantity_unsellable: null,
      low_stock_threshold: null,
      availability_state: "NOT_TRACKED",
    });
  });

  it("marks LOW when dispensable units are at or below presentation threshold", async () => {
    const { inventoryStore, presentationId, receive } = await buildEnv(true);
    const admin = auth(["INVENTORY_STOCK_RECEIVE"]);
    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "4.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:low",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true, {
      lowStockThreshold: "5.000000",
    })).toMatchObject({
      quantity_available: "4.000000",
      availability_state: "LOW",
      low_stock_threshold: "5.000000",
    });
  });

  it("surfaces pharmacy verification without inventing sellable when physical exceeds dispensable", async () => {
    const { inventoryStore, presentationId, receive } = await buildEnv(true);
    const admin = auth(["INVENTORY_STOCK_RECEIVE"]);
    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "20.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:rx",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true, {
      pharmacyProfile: {
        productKind: "MEDICINE",
        commercialName: "Amoxicilina",
        genericName: null,
        activeIngredientsJson: "[]",
        concentrationText: null,
        pharmaceuticalForm: null,
        manufacturer: null,
        sanitaryHolder: null,
        sanitaryRegistration: "INVIMA-1",
        registrationVerificationStatus: "VERIFIED_MANUAL",
        dispensationCategory: "PRESCRIPTION",
        requiresPrescription: true,
        controlledSpecial: false,
        storageCondition: "AMBIENT",
        requiresLotTracking: true,
        requiresExpiry: true,
        regulatoryReviewAt: null,
        version: 1,
      },
    })).toMatchObject({
      quantity_available: "20.000000",
      availability_state: "VERIFICATION_REQUIRED",
    });
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true, {
      pharmacyProfile: {
        productKind: "MEDICINE",
        commercialName: "Bloqueado",
        genericName: null,
        activeIngredientsJson: "[]",
        concentrationText: null,
        pharmaceuticalForm: null,
        manufacturer: null,
        sanitaryHolder: null,
        sanitaryRegistration: "INVIMA-X",
        registrationVerificationStatus: "EXPIRED",
        dispensationCategory: "OTC",
        requiresPrescription: false,
        controlledSpecial: false,
        storageCondition: "AMBIENT",
        requiresLotTracking: false,
        requiresExpiry: false,
        regulatoryReviewAt: null,
        version: 1,
      },
    }).availability_state).toBe("RESTRICTED");
  });
});
