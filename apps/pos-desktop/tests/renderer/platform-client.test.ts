import {describe,it,expect,vi} from "vitest";
import {PlatformClient} from "../../renderer/src/platform-client.js";
import {uuidV7} from "@pos-platform/contracts";

describe("GLOBAL administration browser boundary",()=>{
  const location={protocol:"https:",origin:"https://central.example.test"};
  it("rejects file/http origins before any request",()=>{
    const fetcher=vi.fn();
    for(const protocol of ["file:","http:"])expect(()=>new PlatformClient({protocol,origin:"null"},fetcher)).toThrow("HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only same-origin cookie transport and backend versions/prices",async()=>{
    const offer={id:uuidV7(),code:"TEST_ONLY",name:"Test",billing_model:"MONTHLY",deployment_mode:"HYBRID",currency_code:"COP",price_minor:23700,
      included_registers:1,additional_register_price_minor:2000,support_price_minor:1000,support_charge:"OPTIONAL_SAME_TERM",policy_reference:"TEST_ONLY",version:4,status:"DRAFT"};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({offers:[offer]}),{status:200}));
    expect(await new PlatformClient(location,fetcher).offers()).toEqual([offer]);
    expect(fetcher).toHaveBeenCalledWith(location.origin+"/v1/platform/license-offers/catalog",expect.objectContaining({credentials:"same-origin",cache:"no-store",redirect:"error",method:"POST"}));
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({"content-type":"application/json"});
    fetcher.mockResolvedValue(new Response(JSON.stringify({offers:[{...offer,included_registers:3}]}),{status:200}));
    await expect(new PlatformClient(location,fetcher).offers()).rejects.toThrow();
  });
  it("does not invent a catalog or success when Central denies the request",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response("{}",{status:401}));
    await expect(new PlatformClient(location,fetcher).offers()).rejects.toThrow("Central");
    fetcher.mockResolvedValue(new Response("{}",{status:409}));
    await expect(new PlatformClient(location,fetcher).publish(uuidV7(),1,uuidV7())).rejects.toThrow("políticas");
  });
});
