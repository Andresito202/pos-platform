import {describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {MerchantBusinessDestinationOperations} from "../src/merchant-destination-business-operations.js";

const session={
 sessionId:"11111111-1111-4111-8111-111111111111",
 userId:"22222222-2222-4222-8222-222222222222",
 tenantId:"33333333-3333-4333-8333-333333333333",
 tenantMembershipId:"44444444-4444-4444-8444-444444444444",
};
const company="55555555-5555-4555-8555-555555555555";
function setup(companies:string[]=[company],enableNotices=false){
 const statements:{sql:string;values?:unknown[]}[]=[];
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,values?:unknown[])=>{
   statements.push({sql,...(values?{values}:{})});
   if(sql.includes("SELECT DISTINCT a.company_id"))return {rowCount:companies.length,rows:companies.map(company_id=>({company_id}))};
   if(sql.includes("FROM payments.merchant_destinations d"))return {rowCount:0,rows:[]};
   if(sql.includes("FROM payments.merchant_payment_notification_inbox"))return {rowCount:1,rows:[{
     id:"77777777-7777-4777-8777-777777777777",received_at:new Date("2026-11-07T12:00:00Z"),
     sender_label:"SMS compartido",reported_amount_cop:"4500",payer_display:"Juan Pérez",
     status:"UNVERIFIED",bank_confirmed:false,
     sale_confirmed:false,requires_independent_reconciliation:true,
   }]};
   return {rowCount:1,rows:[]};
  }),
 };
 const pool={connect:async()=>client} as unknown as Pool;
 return {service:new MerchantBusinessDestinationOperations(pool,enableNotices),statements,client};
}
describe("QR-001 BUSINESS administrative scope",()=>{
 it("allows read only for one active explicit admin company derived from the session",async()=>{
  const {service,statements}=setup();
  const result=await service.dispatch({session,action:"list",payload:{}});
  expect(result).toEqual({destinations:[]});
  expect(statements.some(s=>s.sql.includes('role.code IN (\'OWNER\',\'GENERAL_ADMIN\')'))).toBe(true);
  expect(statements.some(s=>s.sql.includes("s.last_reauthenticated_at"))).toBe(true);
  expect(statements.some(s=>s.sql.includes("app.company_id")&&s.values?.[0]===company)).toBe(true);
 });
 it("rejects cashier with no admin role, without consulting merchant payment tables",async()=>{
  const {service,statements}=setup([]);
  await expect(service.dispatch({session,action:"list",payload:{}}))
   .rejects.toThrow("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
  expect(statements.some(s=>s.sql.includes("payments.merchant_destinations"))).toBe(false);
 });
 it("rejects multiple authorized companies rather than choosing the first",async()=>{
  const {service}=setup([company,"66666666-6666-4666-8666-666666666666"]);
  await expect(service.dispatch({session,action:"list",payload:{}}))
   .rejects.toThrow("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
 });
 it("rejects caller-injected company, tenant, or admin flags",async()=>{
  const {service,statements}=setup();
  await expect(service.dispatch({session,action:"list",payload:{company_id:company,canConfigure:true}}))
   .rejects.toThrow("QR001_INVALID_REQUEST");
  expect(statements.some(s=>s.sql.includes("FROM payments.merchant_destinations"))).toBe(false);
 });
 it("rejects tampered identity before allocating a database connection",async()=>{
  const {service,statements}=setup();
  await expect(service.dispatch({session:{...session,userId:"fake"},action:"list",payload:{}}))
   .rejects.toThrow("QR001_INVALID_REQUEST");
  expect(statements).toHaveLength(0);
 });
 it("denies QR-002 notice reads when migration-enabled rollout flag is off",async()=>{
  const {service,statements}=setup();
  await expect(service.dispatch({session,action:"notices",payload:{}}))
    .rejects.toThrow("QR002_NOTIFICATIONS_NOT_ENABLED");
  expect(statements.some(x=>x.sql.includes("merchant_payment_notification_inbox"))).toBe(false);
 });
 it("shows at most 25 unverified observations to a verified company administrator",async()=>{
  const {service,statements}=setup([company],true);
  const response=await service.dispatch({session,action:"notices",payload:{}}) as {notices:Record<string,unknown>[]};
  expect(response.notices).toHaveLength(1);
  expect(response.notices[0]?.bank_confirmed).toBe(false);
  expect(response.notices[0]?.sale_confirmed).toBe(false);
  expect(response.notices[0]?.reported_amount_cop).toBe("4500");
  expect(response.notices[0]?.payer_display).toBe("Juan Pérez");
  const query=statements.find(x=>x.sql.includes("FROM payments.merchant_payment_notification_inbox"));
  expect(query?.sql).toContain("LIMIT 25");
  expect(query?.sql).not.toMatch(/payments\.payments|payment_id|sale_id|message_sha256/);
  expect(query?.values).toEqual([session.tenantId,company]);
  expect(statements.some(x=>x.sql.includes("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))).toBe(true);
 });
 it("rejects cashier and caller-specified company before exposing notifications",async()=>{
  const unauthorized=setup([],true);
  await expect(unauthorized.service.dispatch({session,action:"notices",payload:{}}))
    .rejects.toThrow("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
  expect(unauthorized.statements.some(x=>x.sql.includes("merchant_payment_notification_inbox"))).toBe(false);
  const injected=setup([company],true);
  await expect(injected.service.dispatch({session,action:"notices",payload:{company_id:company}}))
    .rejects.toThrow("QR001_INVALID_REQUEST");
  expect(injected.statements.some(x=>x.sql.includes("merchant_payment_notification_inbox"))).toBe(false);
 });

});
