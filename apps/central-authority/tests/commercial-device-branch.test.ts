import {describe,it,expect,vi} from "vitest";
import {resolveCommercialDeviceBranch,type PoolClient} from "@pos-platform/database-postgres";
describe("canonical device branch resolution",()=>{
 const binding={tenantId:"tenant",companyId:"company",deviceId:"device",installationId:"installation",credentialId:"credential"};
 it("requires a unique branch and binds all five identity fields",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{branch_id:"branch"}]});
  expect(await resolveCommercialDeviceBranch({query} as unknown as PoolClient,binding)).toBe("branch");
  expect(query.mock.calls[0]?.[1]).toEqual(["tenant","device","installation","credential","company"]);
  query.mockResolvedValue({rows:[{branch_id:"a"},{branch_id:"b"}]});
  expect(await resolveCommercialDeviceBranch({query} as unknown as PoolClient,binding)).toBeNull();
  query.mockResolvedValue({rows:[]});
  expect(await resolveCommercialDeviceBranch({query} as unknown as PoolClient,binding)).toBeNull();
 });
 it("requires current license, signed activation term, entitlement and latest device credential in the canonical query",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  expect(await resolveCommercialDeviceBranch({query} as unknown as PoolClient,binding)).toBeNull();
  const sql=String(query.mock.calls[0]?.[0]);
  for(const predicate of ["e.enabled=true","l.not_before<=clock_timestamp()","l.expires_at+interval '72 hours'","l.deployment_mode='LOCAL_PERPETUAL' AND l.contract_status='ACTIVE'","(a.canonical_payload->>'not_before')::timestamptz<=clock_timestamp()","(a.canonical_payload->>'expires_at')::timestamptz>clock_timestamp()","dc.expires_at>clock_timestamp()","newer.generation>dc.generation","dc.device_key_id=d.device_key_id","a.revoked_at IS NULL"])expect(sql).toContain(predicate);
 });
});
