import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,dirname } from "node:path";
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
import { randomUUID } from "node:crypto";
import { ApprovePresentationConversionUseCase,ConvertPresentationUseCase } from "../src/inventory/presentation-conversion-use-cases.js";
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

describe("shared v23 exact presentation conversion",()=>{
  async function fixture(){
    const env=await buildEnv();
    const product=env.database.native.prepare(
      "SELECT product_id FROM catalog_presentation WHERE tenant_id=? AND id=?"
    ).get(TENANT,env.presentationId) as {product_id:string};
    const target=randomUUID(),at=NOW.toISOString();
    env.database.native.prepare(`INSERT INTO catalog_presentation(
      id,tenant_id,product_id,name,unit_code,unit_precision,barcode,status,created_at,updated_at)
      VALUES(?,?,?,'Caja 2 unidades','UND',0,NULL,'ACTIVE',?,?)`)
      .run(target,TENANT,product.product_id,at,at);
    return {...env,target,approve:new ApprovePresentationConversionUseCase(env.store),
      convert:new ConvertPresentationUseCase(env.store)};
  }
  it("atomically debits source, credits target, keeps genealogy and blocks altered replay",async()=>{
    const env=await fixture();
    expect(env.receive.execute(SCOPE,SESSION,auth(),batchReceive(env.presentationId,"SOURCE","2026-09-30")).kind).toBe("POSTED");
    const lot=env.store.listBatches(SCOPE,env.presentationId)[0]!;
    const approved=env.approve.execute(SCOPE,SESSION,auth(),{
      sourcePresentationId:env.presentationId,targetPresentationId:env.target,
      numerator:"2",denominator:"1",version:1,idempotencyKey:key(),
      correlationId:CORRELATION,causationId:null,
    },NOW);
    expect(approved.kind).toBe("APPROVED");
    if(!approved.ruleId)throw Error("conversion fixture approval missing");
    const request={ruleId:approved.ruleId,sourceLotId:lot.id,quantity:"2.000000",
      reasonCode:"PRESENTATION_CONVERSION",businessDate:"2026-09-07",
      idempotencyKey:key(),correlationId:CORRELATION,causationId:null};
    const converted=env.convert.execute(SCOPE,SESSION,auth(),request,NOW);
    expect(converted.kind).toBe("CONVERTED");
    expect(converted.targetQuantity).toBe("4.000000");
    expect(env.store.getStock(SCOPE,env.presentationId)?.quantityOnHand).toBe("1.000000");
    expect(env.store.getStock(SCOPE,env.target)?.quantityOnHand).toBe("4.000000");
    expect(env.store.listBatches(SCOPE,env.target)).toMatchObject([
      {quantityOnHand:"4.000000",expiryDate:"2026-09-30",status:"AVAILABLE"},
    ]);
    expect(env.convert.execute(SCOPE,SESSION,auth(),request,NOW).kind).toBe("IDEMPOTENT");
    expect(env.convert.execute(SCOPE,SESSION,auth(),{...request,quantity:"1.000000"},NOW).kind).toBe("CONFLICT");
    expect(env.database.native.prepare("SELECT count(*) AS n FROM inventory_conversion_event").get()).toEqual({n:1});
    expect(env.database.native.prepare(
      "SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='CONVERSION'"
    ).get()).toEqual({n:2});
    expect(()=>env.database.native.prepare(
      "UPDATE inventory_conversion_event SET source_quantity='4.000000'"
    ).run()).toThrow(/append-only/);
    env.database.assertIntegrity();
  });
  it("rejects forbidden conversion and does not write partial movements",async()=>{
    const env=await fixture();
    expect(env.receive.execute(SCOPE,SESSION,auth(),batchReceive(env.presentationId,"FORBIDDEN","2026-09-06")).kind).toBe("POSTED");
    const lot=env.store.listBatches(SCOPE,env.presentationId)[0]!;
    const approved=env.approve.execute(SCOPE,SESSION,auth(),{
      sourcePresentationId:env.presentationId,targetPresentationId:env.target,
      numerator:"1",denominator:"3",version:1,idempotencyKey:key(),
      correlationId:CORRELATION,causationId:null,
    },NOW);
    expect(approved.kind).toBe("APPROVED");
    const request={ruleId:approved.ruleId!,sourceLotId:lot.id,quantity:"1.000000",
      reasonCode:"PRESENTATION_CONVERSION",businessDate:"2026-09-07",
      idempotencyKey:key(),correlationId:CORRELATION,causationId:null};
    expect(env.convert.execute(SCOPE,SESSION,auth([]),request,NOW).kind).toBe("UNAUTHORIZED");
    expect(env.convert.execute(SCOPE,SESSION,auth(),request,NOW).kind).toBe("QUANTITY_PRECISION_EXCEEDED");
    // No fractional destination unit may be rounded to 0 or 1.
    expect(env.database.native.prepare("SELECT count(*) AS n FROM inventory_conversion_event").get()).toEqual({n:0});
    expect(env.store.getStock(SCOPE,env.presentationId)?.quantityOnHand).toBe("3.000000");
    const other=env.convert.execute({...SCOPE,branchId:OTHER_BRANCH},SESSION,auth(),request,NOW);
    expect(other.kind).not.toBe("CONVERTED");
  });
});

describe("shared v22 batch ledger and FEFO on original inventory",()=>{
 it("persists exact lot balance and audit through SQLite process restart",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"PERSIST","2026-12-01")).kind).toBe("POSTED");
  const directory=dirname(database.native.name);
  database.close();
  const reopened=LocalDatabase.open({dataDirectory:directory});
  databases.push(reopened);
  const fresh=new SqliteInventoryStore(reopened,new DurableSyncStore(reopened),()=>NOW);
  expect(fresh.listBatches(SCOPE,presentationId)[0]?.quantityOnHand).toBe("3.000000");
  expect(fresh.availableUnits(SCOPE,presentationId)).toBe(3_000_000n);
  expect(reopened.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement").get()).toEqual({n:1});
  reopened.assertIntegrity();
 });
 it("treats a duplicated receipt with altered supplier/documents as an idempotency conflict",async()=>{
  const {receive,store,presentationId}=await buildEnv();
  const first=batchReceive(presentationId,"SOURCE","2026-10-10");
  expect(receive.execute(SCOPE,SESSION,auth(),first).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),{
    ...first,batch:batch("SOURCE","2026-10-10",{receiptDocument:"FAKE-DOCUMENT"}),
  }).kind).toBe("IDEMPOTENCY_CONFLICT");
  expect(store.listBatches(SCOPE,presentationId)[0]?.quantityOnHand).toBe("3.000000");
 });
 it("never sells more than eligible FEFO stock even if physical stock is greater",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"FRESH","2026-09-30")).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"OLD","2026-09-05")).kind).toBe("POSTED");
  const result=store.appendSaleDeduction({
    scope:SCOPE,sessionId:SESSION,operatorUserId:USER,
    saleId:"018f0000-0000-7000-8000-0000000000ab",
    presentationId,quantity:"4.000000",businessDate:"2026-09-07",
    correlationId:CORRELATION,causationId:null,
  });
  expect(result).toEqual({kind:"INSUFFICIENT_STOCK",available:"3.000000"});
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("6.000000");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='SALE'").get()).toEqual({n:0});
 });
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
  expect(database.native.prepare("SELECT count(*) AS n FROM local_sync_outbox WHERE operation_type='INVENTORY_MOVEMENT_APPEND'").get()).toEqual({n:1});
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
 it("rejects expired or quarantined material consumption but permits audited disposal",async()=>{
  const {receive,adjust,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"EXPIRED-INGREDIENT","2026-09-06")).kind).toBe("POSTED");
  const expired=store.listBatches(SCOPE,presentationId)[0]!;
  const consume=(lotId:string)=>({
    ...receipt(presentationId,{quantity:"1.000000",reasonCode:"MATERIAL_CONSUMPTION"}),
    movementType:"ADJUSTMENT_NEGATIVE" as const,lotId,
  });
  expect(adjust.execute(SCOPE,SESSION,auth(),consume(expired.id)).kind).toBe("LOT_NOT_SELLABLE");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"QUARANTINED-INGREDIENT","2026-09-30")).kind).toBe("POSTED");
  const quarantined=store.listBatches(SCOPE,presentationId).find(x=>x.batchCode==="QUARANTINED-INGREDIENT")!;
  const change=new ChangeBatchStatusUseCase(store);
  expect(change.execute(SCOPE,SESSION,auth(),{
    lotId:quarantined.id,status:"QUARANTINE",reasonCode:"QUALITY_HOLD",
    idempotencyKey:key(),correlationId:CORRELATION,causationId:null,
  }).kind).toBe("UPDATED");
  expect(adjust.execute(SCOPE,SESSION,auth(),consume(quarantined.id)).kind).toBe("LOT_NOT_SELLABLE");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("6.000000");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='MATERIAL_CONSUMPTION'").get()).toEqual({n:0});
  const loss={
    ...receipt(presentationId,{quantity:"1.000000",reasonCode:"QUALITY_DISPOSAL"}),
    movementType:"SHRINKAGE" as const,lotId:quarantined.id,
  };
  expect(adjust.execute(SCOPE,SESSION,auth(),loss).kind).toBe("POSTED");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("5.000000");
 });
 it("returns the committed lot debit on replay after a subsequent quarantine",async()=>{
  const {receive,adjust,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"INGREDIENT","2026-09-30")).kind).toBe("POSTED");
  const lot=store.listBatches(SCOPE,presentationId)[0]!;
  const operation={
    ...receipt(presentationId,{quantity:"1.000000",reasonCode:"MATERIAL_CONSUMPTION"}),
    movementType:"ADJUSTMENT_NEGATIVE" as const,lotId:lot.id,
  };
  expect(adjust.execute(SCOPE,SESSION,auth(),operation).kind).toBe("POSTED");
  const lotState=new ChangeBatchStatusUseCase(store);
  expect(lotState.execute(SCOPE,SESSION,auth(),{
    lotId:lot.id,status:"QUARANTINE",reasonCode:"QUALITY_REVIEW",
    idempotencyKey:key(),correlationId:CORRELATION,causationId:null,
  }).kind).toBe("UPDATED");
  expect(adjust.execute(SCOPE,SESSION,auth(),operation).kind).toBe("IDEMPOTENT");
  expect(adjust.execute(SCOPE,SESSION,auth(),{...operation,idempotencyKey:operation.idempotencyKey,
    quantity:"2.000000"}).kind).toBe("IDEMPOTENCY_CONFLICT");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("2.000000");
  expect(database.native.prepare("SELECT count(*) AS n FROM inventory_lot_movement WHERE event_type='MATERIAL_CONSUMPTION'").get()).toEqual({n:1});
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
 it("INV-015 reserves reduce availability without changing physical stock and release restores it",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"HOLD-A","2026-09-12","2.000000")).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"HOLD-B","2026-09-20","3.000000")).kind).toBe("POSTED");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("5.000000");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(5_000_000n);
  const first=store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"4.000000",
    referenceType:"MANUAL",referenceId:"order-1",idempotencyKey:"reserve-1",
    requestChecksum:"c".repeat(64),correlationId:CORRELATION,causationId:null,expiresAt:null,
  });
  expect(first.kind).toBe("RESERVED");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("5.000000");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(1_000_000n);
  const second=store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"2.000000",
    referenceType:"MANUAL",referenceId:"order-2",idempotencyKey:"reserve-2",
    requestChecksum:"d".repeat(64),correlationId:CORRELATION,causationId:null,expiresAt:null,
  });
  expect(second).toEqual({kind:"INSUFFICIENT_STOCK",available:"1.000000"});
  expect(store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"4.000000",
    referenceType:"MANUAL",referenceId:"order-1",idempotencyKey:"reserve-1",
    requestChecksum:"c".repeat(64),correlationId:CORRELATION,causationId:null,expiresAt:null,
  })).toMatchObject({kind:"IDEMPOTENT"});
  expect(store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"4.000000",
    referenceType:"MANUAL",referenceId:"order-1",idempotencyKey:"reserve-1",
    requestChecksum:"e".repeat(64),correlationId:CORRELATION,causationId:null,expiresAt:null,
  }).kind).toBe("IDEMPOTENCY_CONFLICT");
  if(first.kind!=="RESERVED")throw new Error("expected reservation");
  expect(store.releaseReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,reservationId:first.reservationId,
    reasonCode:"HOLD_CANCELLED",idempotencyKey:"release-1",requestChecksum:"f".repeat(64),
    correlationId:CORRELATION,causationId:null,
  })).toBe("RELEASED");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(5_000_000n);
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("5.000000");
  expect(database.native.prepare(
    "SELECT count(*) AS n FROM local_sync_outbox WHERE operation_type='INVENTORY_RESERVATION_CREATE'"
  ).get()).toEqual({n:1});
 });
 it("INV-015 sale reservation is consumed by FEFO deduction without double debit",async()=>{
  const {receive,store,database,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"S1","2026-09-11","2.000000")).kind).toBe("POSTED");
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"S2","2026-09-25","2.000000")).kind).toBe("POSTED");
  const saleId="018f0000-0000-7000-8000-0000000000f1";
  const reserved=store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"3.000000",
    referenceType:"SALE",referenceId:saleId,idempotencyKey:`inventory_reserve:sale:${saleId}:${presentationId}`,
    requestChecksum:"a".repeat(64),correlationId:CORRELATION,causationId:null,expiresAt:null,
  });
  expect(reserved.kind).toBe("RESERVED");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(1_000_000n);
  expect(store.appendSaleDeduction({
    scope:SCOPE,sessionId:SESSION,operatorUserId:USER,saleId,presentationId,
    quantity:"3.000000",businessDate:"2026-09-07",correlationId:CORRELATION,causationId:null,
  }).kind).toBe("POSTED");
  expect(store.appendSaleDeduction({
    scope:SCOPE,sessionId:SESSION,operatorUserId:USER,saleId,presentationId,
    quantity:"3.000000",businessDate:"2026-09-07",correlationId:CORRELATION,causationId:null,
  }).kind).toBe("IDEMPOTENT");
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("1.000000");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(1_000_000n);
  expect(store.listBatches(SCOPE,presentationId).find(x=>x.batchCode==="S1")?.quantityOnHand).toBe("0.000000");
  expect(store.listBatches(SCOPE,presentationId).find(x=>x.batchCode==="S2")?.quantityOnHand).toBe("1.000000");
  expect(database.native.prepare(
    "SELECT status FROM inventory_reservation WHERE reference_id=?"
  ).get(saleId)).toEqual({status:"CONSUMED"});
  const operation=JSON.parse(String((database.native.prepare(
    "SELECT operation_json AS p FROM local_sync_outbox WHERE operation_type='INVENTORY_MOVEMENT_APPEND' ORDER BY local_sequence DESC LIMIT 1"
  ).get() as {p:string}).p));
  expect(operation.payload?.lot_allocations?.length).toBe(2);
 });
 it("INV-015 expires due reservations without inventing inbound stock",async()=>{
  const {receive,store,presentationId}=await buildEnv();
  expect(receive.execute(SCOPE,SESSION,auth(),batchReceive(presentationId,"EXP","2026-09-30","2.000000")).kind).toBe("POSTED");
  expect(store.createReservationInTransaction({
    scope:SCOPE,sessionId:SESSION,actorId:USER,presentationId,quantity:"2.000000",
    referenceType:"MANUAL",referenceId:"temp-hold",idempotencyKey:"reserve-exp",
    requestChecksum:"1".repeat(64),correlationId:CORRELATION,causationId:null,
    expiresAt:"2026-09-07T09:00:00.000Z",
  }).kind).toBe("RESERVED");
  expect(store.availableUnits(SCOPE,presentationId)).toBe(0n);
  expect(store.expireDueReservations(SCOPE,NOW)).toBe(1);
  expect(store.availableUnits(SCOPE,presentationId)).toBe(2_000_000n);
  expect(store.getStock(SCOPE,presentationId)?.quantityOnHand).toBe("2.000000");
 });
});
