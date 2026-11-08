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
function setup(companies:string[]=[company]){
 const statements:{sql:string;values?:unknown[]}[]=[];
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,values?:unknown[])=>{
   statements.push({sql,...(values?{values}:{})});
   if(sql.includes("SELECT DISTINCT a.company_id"))return {rowCount:companies.length,rows:companies.map(company_id=>({company_id}))};
   if(sql.includes("FROM payments.merchant_destinations d"))return {rowCount:0,rows:[]};
   return {rowCount:1,rows:[]};
  }),
 };
 const pool={connect:async()=>client} as unknown as Pool;
 return {service:new MerchantBusinessDestinationOperations(pool),statements,client};
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
});
