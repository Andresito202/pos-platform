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
import { AdjustStockUseCase,ChangeBatchStatusUseCase } from "../src/inventory/adjust-stock-use-case.js";
import { GetStockUseCase } from "../src/inventory/get-stock-use-case.js";
import { scale6ToBigInt } from "../src/money.js";
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
const ABSENT_PRESENTATION = "018f0000-0000-7000-8000-0000000000aa";

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
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
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
const key = (): string => { seed += 1; return `idem-inventory-${String(seed)}`; };

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-inventory-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const store = new SqliteInventoryStore(database, sync, () => NOW);

  const registered = new RegisterProductUseCase(catalogStore).execute(SCOPE, SESSION, auth(), {
    code: "ARROZ-001",
    name: "Arroz Blanco",
    stockControlled: true,
    presentationName: "Libra",
    unitCode: "LBR",
    unitPrecision: 2,
    barcode: "7709876543210",
    priceAmount: "3200.000000",
    currencyCode: "COP",
    idempotencyKey: key(),
    correlationId: CORRELATION,
    causationId: null,
  });
  if (registered.kind !== "REGISTERED") throw new Error(`fixture failed: ${registered.kind}`);

  return {
    database, store,
    presentationId: registered.presentationId,
    receive: new ReceiveStockUseCase(store),
    adjust: new AdjustStockUseCase(store),
    get: new GetStockUseCase(store),
  };
}

const receipt = (presentationId: string, overrides: Record<string, unknown> = {}) => ({
  presentationId,
  movementType: "PURCHASE_RECEIPT" as const,
  quantity: "10.000000",
  reasonCode: "SUPPLIER_DELIVERY",
  businessDate: "2026-09-07",
  idempotencyKey: key(),
  correlationId: CORRELATION,
  causationId: null,
  ...overrides,
});


const batch=(code:string,expiryDate:string|null,overrides:Record<string,unknown>={})=>({
  code,manufactureDate:"2026-09-01",expiryDate,
  supplierReference:"SUPPLIER-ABC",receiptDocument:"FAC-2026-101",
  ...overrides,
});
function batchReceive(presentationId:string,code:string,expiryDate:string|null,quantity="3.000000"){
  return receipt(presentationId,{quantity,batch:batch(code,expiryDate)});
}
describe("shared v22 batch ledger and FEFO on original inventory",()=>{
 it("creates a document-linked lot in the same SQLite transaction as stock, audit and outbox",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  const req=batchReceive(presentationId,"LOT-001","2026-10-01");
  expect(receive.execute(SCOPE,SESSION,auth(),req).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),req).kind).toBe("IDEMPOTENT");
  expect(store.listBatches(SCOPE,presentationId)).toMatchObject([{
    batchCode:"LOT-001",quantityOnHand:"3.000000",expiryDate:"2026-10-01",
    supplierReference:"SUPPLIER-ABC",receiptDocument:"FAC-2026-101",
  }]);
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("3.000000");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_movement").get()).toEqual({n:1});
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement").get()).toEqual({n:1});
  expect(database.native.prepare("SELECT count(*) AS n FROM local_sync_outbox WHERE aggregate_type='INVENTORY_STOCK'").get()).toEqual({n:1});
  expect(database.native.prepare("SELECT count(*) AS n FROM local_operation_audit WHERE action_code='INVENTORY_MOVEMENT_APPEND'").get()).toEqual({n:1});
  expect(()=>database.native.prepare("UPDATE inventory_lot_movement SET reason_code='TAMPER'").run()).toThrow(/append-only/);
 });
 it("never invents a historical lot for existing unallocated stock",async()=>{
  const {receive,store,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),receipt(presentationId)).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"NEW","2026-10-01")).kind)
    .toBe("LEGACY_STOCK_RECONCILIATION_REQUIRED");
  expect(store.isLotTracked(SCOPE,presentationId)).toBe(false);
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("10.000000");
 });
 it("allocates FEFO exactly and never consumes quarantined or expired batches",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"LATER","2026-09-20","3.000000")).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"EARLIER","2026-09-10","2.000000")).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"EXPIRED","2026-09-06","4.000000")).kind).toBe("POSTED");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("9.000000");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(5_000_000n);
  const sale=store.appendSaleDeduction({
    scope:SCOPE,sessionId:SESSION,operatorUserId:USER,
    saleId:"018f0000-0000-7000-8000-0000000000de",
    presentationId,quantity:"4.000000",businessDate:"2026-09-07",
    correlationId:CORRELATION,causationId:null,
  });
  expect(sale.kind).toBe("POSTED");
  const lots=store.listBatches(SCOPE,presentationId);
  expect(lots.find(x=>x.batchCode==="EARLIER")?.quantityOnHand).toBe("0.000000");
  expect(lots.find(x=>x.batchCode==="LATER")?.quantityOnHand).toBe("1.000000");
  expect(lots.find(x=>x.batchCode==="EXPIRED")?.quantityOnHand).toBe("4.000000");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("5.000000");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(1_000_000n);
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SALE'").get()).toEqual({n:2});
 });
 it("quarantine and recall change sellable quantity, keep physical quantity and retain immutable history",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"Q","2026-09-30")).kind).toBe("POSTED");
  const lot=store.listBatches(SCOPE,presentationId)[0]!;
  const status=(state:"QUARANTINE"|"AVAILABLE"|"BLOCKED"|"RECALLED",idempotencyKey:string)=>store.changeBatchStatus({
    scope:SCOPE,lotId:lot.id,status:state,actorId:USER,reasonCode:"QUALITY_REVIEW",
    idempotencyKey,requestChecksum:"a".repeat(64),
  });
  expect(status("QUARANTINE","q-01")).toBe("UPDATED");
  expect(status("QUARANTINE","q-01")).toBe("IDEMPOTENT");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(0n);
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("3.000000");
  expect(status("RECALLED","q-02")).toBe("UPDATED");
  expect(status("AVAILABLE","q-03")).toBe("CONFLICT");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_status_event").get()).toEqual({n:2});
 });
 it("rejects changes from a foreign branch and detects lot-specific loss without making global stock negative",async()=>{
  const {receive,adjust,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"LOT","2026-09-30")).kind).toBe("POSTED");
  const lot=store.listBatches(SCOPE,presentationId)[0]!;
  expect(store.listBatches({...SCOPE,branchId:OTHER_BRANCH},presentationId)).toEqual([]);
  expect(adjust.execute(SCOPE,SESSION,auth(),{
    ...receipt(presentationId,{quantity:"4.000000"}),movementType:"SHRINKAGE",lotId:lot.id,
  }).kind).toBe("INSUFFICIENT_STOCK");
  expect(adjust.execute(SCOPE,SESSION,auth(),{
    ...receipt(presentationId,{quantity:"1.000000"}),movementType:"SHRINKAGE",lotId:lot.id,
  }).kind).toBe("POSTED");
  expect(store.listBatches(SCOPE,presentationId)[0]?.quantityOnHand).toBe("2.000000");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("2.000000");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SHRINKAGE'").get()).toEqual({n:1});
 });
 it("permits explicit material consumption only under signed inventory-adjustment permission",async()=>{
  const {receive,adjust,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"RAW-MATERIAL","2026-11-30")).kind).toBe("POSTED");
  const lot=store.listBatches(SCOPE,presentationId)[0]!;
  const consumption={
    ...receipt(presentationId,{quantity:"1.000000",reasonCode:"MATERIAL_CONSUMPTION"}),
    movementType:"ADJUSTMENT_NEGATIVE" as const,lotId:lot.id,
  };
  const denied=adjust.execute(SCOPE,SESSION,auth([]),consumption);
  expect(denied.kind).toBe("UNAUTHORIZED");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("3.000000");
  expect(adjust.execute(SCOPE,SESSION,auth(),consumption).kind).toBe("POSTED");
  expect(database.native.prepare("SELECT event_type FROM inventory_lot_movement WHERE direction='OUT'").get())
    .toEqual({event_type:"MATERIAL_CONSUMPTION"});
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("2.000000");
 });
 it("requires signed backend stock-adjust grant before lot recall or quarantine",async()=>{
  const {receive,store,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"RECALL","2026-10-10")).kind).toBe("POSTED");
  const lot=store.listBatches(SCOPE,presentationId)[0]!;
  const useCase=new ChangeBatchStatusUseCase(store);
  const req={lotId:lot.id,status:"RECALLED" as const,reasonCode:"SAFETY_RECALL",
    idempotencyKey:key(),correlationId:CORRELATION,causationId:null};
  expect(useCase.execute(SCOPE,SESSION,auth([]),req).kind).toBe("UNAUTHORIZED");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(3_000_000n);
  expect(useCase.execute(SCOPE,SESSION,auth(),req).kind).toBe("UPDATED");
  expect(useCase.execute(SCOPE,SESSION,auth(),req).kind).toBe("IDEMPOTENT");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(0n);
 });
 it("refuses fractions outside presentation precision and preserves ledger on rejection",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  const reply=receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"BAD","2026-09-30","0.000001"));
  expect(reply.kind).toBe("QUANTITY_PRECISION_EXCEEDED");
  expect(store.isLotTracked(SCOPE,presentationId)).toBe(false);
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement").get()).toEqual({n:0});
 });
});
