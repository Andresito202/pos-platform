import {describe,expect,it,vi} from "vitest";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {PostgresUnverifiedMerchantNotificationInbox} from "../src/merchant-notification-inbox.js";
const scope={
 tenantId:"11111111-1111-4111-8111-111111111111",
 companyId:"33333333-3333-4333-8333-333333333333",
 installationId:"55555555-5555-4555-8555-555555555555",
};
const now=new Date().toISOString();
const signal={
 source:"NEQUI_NEGOCIOS_SHARED_SMS",message_sha256:"f".repeat(64),
 observed_at:now,received_at:now,sender_label:"SMS compartido",
};
function setup(opts:{deny?:boolean;duplicate?:boolean;conflict?:boolean}={}){
 const calls:Array<{sql:string;values?:unknown[]}>=[],release=vi.fn();
 const client={
  release,
  query:vi.fn(async(sql:string,values?:unknown[])=>{
   calls.push({sql,...(values?{values}:{})});
   if(sql.includes("INSERT INTO payments.merchant_payment_notification_inbox"))
     return {rowCount:opts.duplicate?0:1,rows:opts.duplicate?[]:[{id:"test"}]};
   if(sql.includes("SELECT source,observed_at"))
     return {rowCount:1,rows:[{
       source:signal.source,observed_at:signal.observed_at,
       received_at:signal.received_at,sender_label:opts.conflict?"forged":signal.sender_label,
     }]};
   return {rowCount:0,rows:[]};
  }),
 } as unknown as PoolClient;
 const gate=vi.fn(async(_client:PoolClient,_scope:typeof scope)=>{
   if(opts.deny)throw Error("QR002_BRIDGE_NOT_ENROLLED");
 });
 const pool={connect:async()=>client} as unknown as Pool;
 return {store:new PostgresUnverifiedMerchantNotificationInbox(pool,gate),gate,calls,release};
}
describe("QR-002 isolated Central non-financial inbox",()=>{
 it("uses signed bridge context and inserts only unverified evidence in one SERIALIZABLE transaction",async()=>{
  const x=setup();
  const result=await x.store.appendFromAuthenticatedBridge(scope,signal);
  expect(result.inserted).toBe(true);
  expect(result.notice.bank_confirmed).toBe(false);
  expect(result.notice.sale_confirmed).toBe(false);
  expect(x.calls[0]?.sql).toContain("SERIALIZABLE");
  expect(x.calls.some(q=>q.sql.includes("app.company_id")&&q.values?.[0]===scope.companyId)).toBe(true);
  expect(x.gate).toHaveBeenCalledOnce();
  const insert=x.calls.find(q=>q.sql.includes("INSERT INTO payments.merchant_payment_notification_inbox"));
  expect(insert?.values?.[1]).toBe(scope.tenantId);
  expect(insert?.values?.[2]).toBe(scope.companyId);
  expect(insert?.values?.[3]).toBe(scope.installationId);
  expect(insert?.sql).not.toContain("payments.payments");
  expect(x.calls.at(-1)?.sql).toBe("COMMIT");
  expect(x.release).toHaveBeenCalledOnce();
 });
 it("requires explicit enrolled bridge authorization, rolls back before insertion",async()=>{
  const x=setup({deny:true});
  await expect(x.store.appendFromAuthenticatedBridge(scope,signal)).rejects.toThrow("QR002_BRIDGE_NOT_ENROLLED");
  expect(x.calls.some(q=>q.sql.includes("INSERT INTO payments.merchant_payment_notification_inbox"))).toBe(false);
  expect(x.calls.at(-1)?.sql).toBe("ROLLBACK");
 });
 it("treats exact delivery duplicates as one observation, never another payment",async()=>{
  const x=setup({duplicate:true});
  const result=await x.store.appendFromAuthenticatedBridge(scope,signal);
  expect(result.inserted).toBe(false);
  expect(x.calls.at(-1)?.sql).toBe("COMMIT");
 });
 it("rejects same digest with conflicting evidence without overwriting the first",async()=>{
  const x=setup({duplicate:true,conflict:true});
  await expect(x.store.appendFromAuthenticatedBridge(scope,signal)).rejects.toThrow("QR002_NOTIFICATION_IDEMPOTENCY_CONFLICT");
  expect(x.calls.at(-1)?.sql).toBe("ROLLBACK");
 });
 it("rejects SMS content, spoofed company, fake settlement and stale timestamps before DB access",async()=>{
  const x=setup();
  for(const invalid of [
    {...signal,text_preview:"Cuenta personal y teléfono privado"},
    {...signal,tenant_id:"attacker"},
    {...signal,bank_confirmed:true},
    {...signal,source:"PERSONAL_NEQUI_P2P"},
    {...signal,received_at:"2020-01-01T00:00:00Z",observed_at:"2020-01-01T00:00:00Z"},
  ])await expect(x.store.appendFromAuthenticatedBridge(scope,invalid)).rejects.toThrow();
  expect(x.calls).toHaveLength(0);
 });
});
