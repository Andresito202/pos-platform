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
});
