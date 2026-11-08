import {describe,expect,it,vi} from "vitest";
import type {PoolClient,Pool} from "@pos-platform/database-postgres";
import {assertMerchantAdminDuringWrite} from "../src/merchant-destination-admin-authorization.js";
import {PostgresMerchantDestinationStore} from "../src/merchant-destination-postgres-store.js";
const session={sessionId:"11111111-1111-4111-8111-111111111111",
 userId:"22222222-2222-4222-8222-222222222222",
 tenantId:"33333333-3333-4333-8333-333333333333",
 tenantMembershipId:"44444444-4444-4444-8444-444444444444"};
const companyId="55555555-5555-4555-8555-555555555555";
describe("QR-001 atomic bank recipient authorization",()=>{
 it("locks administrative grants and BUSINESS session within write transaction",async()=>{
  const sql:string[]=[];
  const client={query:vi.fn(async(q:string)=>{sql.push(q);return {rowCount:1,rows:[{id:1}]};}),
    release:vi.fn()} as unknown as PoolClient;
  const pool={connect:async()=>client} as unknown as Pool;
  const store=new PostgresMerchantDestinationStore(pool,{tenantId:session.tenantId,companyId},
    c=>assertMerchantAdminDuringWrite(c,session,companyId));
  await store.transaction(async()=>true);
  expect(sql.some(x=>x.includes("FOR SHARE OF a,role,m,s"))).toBe(true);
  expect(sql.at(-1)).toBe("COMMIT");
 });
 it("rolls back before touching sensitive payments when role revoked",async()=>{
  const sql:string[]=[];
  const client={query:vi.fn(async(q:string)=>{
     sql.push(q);
     return {rowCount:q.includes("FOR SHARE OF a,role,m,s")?0:1,rows:[]};
   }),release:vi.fn()} as unknown as PoolClient;
  const pool={connect:async()=>client} as Pool;
  const store=new PostgresMerchantDestinationStore(pool,{tenantId:session.tenantId,companyId},
    c=>assertMerchantAdminDuringWrite(c,session,companyId));
  await expect(store.transaction(async tx=>{
    await tx.createDraft({} as never);
    return true;
  })).rejects.toThrow("QR001_ADMIN_WRITE_REVOKED");
  expect(sql.at(-1)).toBe("ROLLBACK");
  expect(sql.some(x=>x.includes("INSERT INTO payments.merchant_destinations"))).toBe(false);
 });
});
