import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uuidV7 } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { LicenseCapacityAuthority } from "../src/license-capacity-authority.js";
const guard=vi.hoisted(()=>vi.fn());
vi.mock("../src/license-administration.js",()=>({requireLicenseAdministrator:guard}));
beforeEach(()=>{guard.mockReset().mockResolvedValue({});});
function fixture(){
 const tenant=uuidV7(),company=uuidV7(),branch=uuidV7(),device=uuidV7(),credential=uuidV7();
 const query=vi.fn(async(sql:string,_args?:unknown[])=>({rows:
 sql.includes("current_user=")?[{ok:true}]:sql.startsWith("SELECT tenant_id")?[{tenant_id:tenant}]:
 sql.includes("SELECT co.id")?[{id:company,trade_name:"Comercio Real"}]:
 sql.includes("SELECT id,name")?[{id:branch,name:"Sucursal Norte"}]:
 sql.includes("SELECT dc.credential_id")?[{credential_id:credential,device_id:device,expires_at:new Date("2027-01-01T00:00:00Z"),issuer_signature:"secret"}]:[],rowCount:0}));
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}));
 const authority=new LicenseCapacityAuthority({connect} as unknown as Pool,{profile:"CAMACHO_LICENSE_ACTIVATION_V1",policy_reference:"TEST",subscription_grace_days:3,grace_basis:"ELAPSED_24_HOURS",perpetual_use:"NO_EXPIRY",support_and_external_services:"SEPARATE",accepted_contract_policy_references:["TEST"],offline_capabilities:["CASH_REGISTER"]},
 {keyId:"TEST",privateKey:generateKeyPairSync("ed25519").privateKey,environment:"PREPRODUCTION"},{reauthenticationMs:60000,lockTimeoutMs:1000,statementTimeoutMs:2000});
 return{authority,query,release,connect,tenant,company,branch,device,credential};
}
describe("license-derived assignment options",()=>{
 it("derives tenant/company from license, bounds reads and returns no secret material",async()=>{
  const f=fixture(),licenseId=uuidV7();const result=await f.authority.assignmentContext(uuidV7(),{licenseId});
  expect(result).toMatchObject({licenseId,company:{id:f.company,name:"Comercio Real"},branches:[{id:f.branch,name:"Sucursal Norte"}],credentials:[{id:f.credential,deviceId:f.device}],branchesTruncated:false,credentialsTruncated:false});
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(f.query).toHaveBeenCalledWith(expect.stringContaining("FROM organization.branches"),[f.tenant,f.company]);
  expect(f.query).toHaveBeenCalledWith(expect.stringContaining("dc.expires_at>clock_timestamp()"),[f.tenant,f.company]);
  expect(f.query).toHaveBeenCalledWith("SELECT set_config('app.tenant_id',$1,true)",[f.tenant]);
  expect(guard).toHaveBeenCalledTimes(2);expect(f.query).toHaveBeenLastCalledWith("COMMIT");
 });
 it("rejects caller scope and IDs before opening a transaction",async()=>{
  const f=fixture();for(const input of [{licenseId:"bad"},{licenseId:uuidV7(),tenantId:uuidV7()}])await expect(f.authority.assignmentContext(uuidV7(),input)).rejects.toThrow();
  expect(f.connect).not.toHaveBeenCalled();
 });
 it("does not read tenant data after revoked permission",async()=>{
  const f=fixture();guard.mockRejectedValue(Error("DENIED"));await expect(f.authority.assignmentContext(uuidV7(),{licenseId:uuidV7()})).rejects.toThrow("DENIED");
  expect(f.query.mock.calls.some(([sql])=>sql.startsWith("SELECT tenant_id"))).toBe(false);expect(f.query).toHaveBeenLastCalledWith("ROLLBACK");expect(f.release).toHaveBeenCalledOnce();
 });
});
