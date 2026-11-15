import {describe,expect,it,vi} from "vitest";
import type {PoolClient} from "@pos-platform/database-postgres";
import {assertMerchantAdminDuringWrite} from "../src/merchant-destination-admin-authorization.js";

const session={
  sessionId:"11111111-1111-4111-8111-111111111111",
  userId:"22222222-2222-4222-8222-222222222222",
  tenantId:"33333333-3333-4333-8333-333333333333",
  tenantMembershipId:"44444444-4444-4444-8444-444444444444",
};
const companyId="55555555-5555-4555-8555-555555555555";

function fixture(allowed:boolean){
 const query=vi.fn(async(sql:string,params?:unknown[])=>{
  if(sql.includes("lock_sas_sources_for_read"))return {rowCount:1,rows:[{}]};
  if(sql.includes("user_role_assignments"))return {rowCount:allowed?1:0,rows:allowed?[{"?column?":1}]:[]};
  throw Error("unexpected query");
 });
 return {query,client:{query} as unknown as PoolClient};
}

describe("QR-001 configured-recipient write guard",()=>{
 it("requires explicit company ADMIN role and separate provider-config grant inside SAS-locked transaction",async()=>{
  const f=fixture(true);
  await expect(assertMerchantAdminDuringWrite(f.client,session,companyId)).resolves.toBeUndefined();
  expect(f.query).toHaveBeenCalledTimes(2);
  expect(f.query.mock.calls[0]?.[0]).toContain("lock_sas_sources_for_read");
  const sql=String(f.query.mock.calls[1]?.[0]);
  for(const required of [
    "role.code='GENERAL_ADMIN'","role.scope_type='BUSINESS'",
    "permission_record.code='PAYMENTS_PROVIDER_CONFIGURE'",
    "grant_record.status='ACTIVE'","grant_record.valid_from<=clock_timestamp()",
    "a.branch_id IS NULL","a.company_id=$5","m.user_id=$2",
    "s.mfa_status='SATISFIED'","s.last_reauthenticated_at",
    "FOR SHARE OF a,m,s"
  ])expect(sql).toContain(required);
  expect(f.query.mock.calls[1]?.[1]).toEqual([
   session.sessionId,session.userId,session.tenantId,session.tenantMembershipId,companyId,
  ]);
  expect(sql).not.toContain("role.code IN ('OWNER'");
 });
 it("denies access without both an active role and an effective grant",async()=>{
  const f=fixture(false);
  await expect(assertMerchantAdminDuringWrite(f.client,session,companyId))
    .rejects.toThrow("QR001_ADMIN_WRITE_REVOKED");
 });
 it("does not enter permission query when the trusted SAS lock fails",async()=>{
  const query=vi.fn(async()=>{throw Error("SAS_LOCK_NOT_AUTHORIZED");});
  await expect(assertMerchantAdminDuringWrite({query} as unknown as PoolClient,session,companyId))
    .rejects.toThrow("SAS_LOCK_NOT_AUTHORIZED");
  expect(query).toHaveBeenCalledTimes(1);
 });
});
