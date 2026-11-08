import {describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {PostgresMerchantDestinationStore} from "../src/merchant-destination-postgres-store.js";

const TENANT="11111111-1111-4111-8111-111111111111";
const COMPANY="33333333-3333-4333-8333-333333333333";
const FOREIGN="44444444-4444-4444-8444-444444444444";
const ID="77777777-7777-4777-8777-777777777777";

function setup(failQuery?:string){
 const statements:Array<{sql:string;values:unknown[]|undefined}>=[];
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,values?:unknown[])=>{
    statements.push({sql,values});
    if(failQuery && sql.includes(failQuery))throw new Error("DATABASE_FAIL");
    if(sql.includes("SELECT d.id"))return {rowCount:0,rows:[]};
    if(sql.includes("RETURNING sequence::text"))return {rowCount:1,rows:[{sequence:"1"}]};
    return {rowCount:1,rows:[]};
  }),
 };
 const pool={connect:async()=>client} as unknown as Pool;
 return {store:new PostgresMerchantDestinationStore(pool,{tenantId:TENANT,companyId:COMPANY}),statements,client};
}
describe("QR-001 Central DB transaction boundary",()=>{
 it("sets RLS scope in each transaction, then commits and releases",async()=>{
  const {store,statements,client}=setup();
  const result=await store.transaction(async tx=>tx.getDestination(TENANT,COMPANY,ID));
  expect(result).toBeNull();
  expect(statements[0]?.sql).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  expect(statements.some(s=>s.sql.includes("app.tenant_id")&&s.values?.[0]===TENANT)).toBe(true);
  expect(statements.some(s=>s.sql.includes("app.company_id")&&s.values?.[0]===COMPANY)).toBe(true);
  expect(statements.at(-1)?.sql).toBe("COMMIT");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("rejects a different company before executing a SELECT",async()=>{
  const {store,statements,client}=setup();
  await expect(store.transaction(async tx=>tx.getDestination(TENANT,FOREIGN,ID))).rejects.toThrow("NOT_FOUND");
  expect(statements.some(s=>s.sql.includes("SELECT d.id"))).toBe(false);
  expect(statements.at(-1)?.sql).toBe("ROLLBACK");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("rolls back when event/outbox append fails",async()=>{
  const {store,statements,client}=setup("merchant_destination_outbox");
  await expect(store.transaction(async tx=>{
    await tx.appendAuditAndOutbox({
      type:"DESTINATION_PUBLISHED",tenant_id:TENANT,company_id:COMPANY,
      destination_id:ID,destination_version:2,
      actor_user_id:ID,at:"2026-11-07T12:00:00.000Z",
    });
  })).rejects.toThrow("DATABASE_FAIL");
  expect(statements.some(s=>s.sql.includes("merchant_destination_events"))).toBe(true);
  expect(statements.some(s=>s.sql.includes("merchant_destination_sequences"))).toBe(true);
  expect(statements.at(-1)?.sql).toBe("ROLLBACK");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("never accepts a foreign record for insert",async()=>{
  const {store,statements}=setup();
  await expect(store.transaction(async tx=>tx.createDraft({
    id:ID,tenant_id:TENANT,company_id:FOREIGN,version:1,status:"DRAFT",
    kind:"NEQUI_NUMBER",label:"Test",destination_reference:"3001234567",
    qr_asset_id:null,qr_sha256:null,created_by_user_id:ID,
    published_at:null,revoked_at:null,
  }))).rejects.toThrow("NOT_FOUND");
  expect(statements.some(s=>s.sql.includes("INSERT INTO payments.merchant_destinations"))).toBe(false);
 });
});
