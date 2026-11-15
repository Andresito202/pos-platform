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
function fixture(companies:string[]){
 const calls:{sql:string;params?:unknown[]}[]=[];
 const query=vi.fn(async(sql:string,params?:unknown[])=>{
   calls.push({sql,...(params===undefined?{}:{params})});
   if(sql.includes("SELECT DISTINCT a.company_id"))
     return {rowCount:companies.length,rows:companies.map(company_id=>({company_id}))};
   if(sql.includes("FROM payments.merchant_destinations d"))return {rowCount:0,rows:[]};
   return {rowCount:1,rows:[]};
 });
 const pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool;
 return {service:new MerchantBusinessDestinationOperations(pool),calls};
}
describe("QR-001 BUSINESS company ADMIN operation boundary",()=>{
 it("lists only the single company of a GENERAL_ADMIN with an effective provider-config grant",async()=>{
  const f=fixture([company]);
  await expect(f.service.dispatch({session,action:"list",payload:{}})).resolves.toEqual({destinations:[]});
  const admin=f.calls.find(c=>c.sql.includes("SELECT DISTINCT a.company_id"));
  expect(admin?.sql).toContain("role.code='GENERAL_ADMIN'");
  expect(admin?.sql).toContain("permission_record.code='PAYMENTS_PROVIDER_CONFIGURE'");
  expect(admin?.sql).toContain("s.mfa_status='SATISFIED'");
  expect(admin?.sql).toContain("s.last_reauthenticated_at");
  expect(admin?.sql).toContain("a.branch_id IS NULL");
  expect(admin?.params).toEqual([session.sessionId,session.userId,session.tenantId,session.tenantMembershipId]);
  const list=f.calls.find(c=>c.sql.includes("FROM payments.merchant_destinations d"));
  expect(list?.params).toEqual([session.tenantId,company]);
 });
 it("denies session without company ADMIN grant and never reads destination data",async()=>{
  const f=fixture([]);
  await expect(f.service.dispatch({session,action:"list",payload:{}}))
    .rejects.toThrow("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
  expect(f.calls.some(c=>c.sql.includes("FROM payments.merchant_destinations d"))).toBe(false);
 });
 it("fails closed for multiple company memberships without explicit company selection",async()=>{
  const f=fixture([company,"66666666-6666-4666-8666-666666666666"]);
  await expect(f.service.dispatch({session,action:"list",payload:{}}))
    .rejects.toThrow("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
 });
 it("rejects forged company and account before any asset or destination write",async()=>{
  const f=fixture([company]);
  await expect(f.service.dispatch({session,action:"create",payload:{company_id:company,draft:{}}}))
    .rejects.toThrow("QR001_INVALID_REQUEST");
  expect(f.calls.some(c=>c.sql.includes("INSERT INTO payments.merchant_destinations"))).toBe(false);
 });
 it("does not expose SMS routes on Nequi personal account",async()=>{
  const f=fixture([company]);
  await expect(f.service.dispatch({session,action:"notices" as "list",payload:{}}))
   .rejects.toThrow("QR001_UNSUPPORTED_ACTION");
  expect(f.calls.some(c=>c.sql.includes("merchant_payment_notification_inbox"))).toBe(false);
 });
});
