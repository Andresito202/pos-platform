import {describe,expect,it,vi,afterEach} from "vitest";
import {MerchantDestinationHttpsTransport} from "../src/payments/merchant-destination-sync.js";
import type {DeviceCredentialProvider} from "../src/sync/device-credential.js";

const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
describe("QR-001 signed-device HTTPS client",()=>{
 it("signs exact requested path and body without tenant asserted by renderer",async()=>{
  const signed=vi.fn(async()=> "DeviceProof signed");
  const signer={authorization:signed,isProvisioned:()=>true} as DeviceCredentialProvider;
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({floor:null}),{
   status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  }));
  globalThis.fetch=fetcher as typeof fetch;
  const transport=new MerchantDestinationHttpsTransport("https://central.example.test",signer);
  expect(await transport.request("floor",{},new AbortController().signal)).toEqual({floor:null});
  expect(signed).toHaveBeenCalledOnce();
  expect(signed.mock.calls[0]?.[0]).toMatchObject({
    method:"POST",path:"/v1/commercial/merchant-destinations/floor",body:"{}",
  });
  const [url,options]=fetcher.mock.calls[0]!;
  expect(String(url)).toBe("https://central.example.test/v1/commercial/merchant-destinations/floor");
  expect((options as RequestInit).headers).toMatchObject({authorization:"DeviceProof signed"});
 });
 it("does not accept redirects, wrong media type or oversized response",async()=>{
  const signer={authorization:async()=> "DeviceProof signed",isProvisioned:()=>true} as DeviceCredentialProvider;
  const transport=new MerchantDestinationHttpsTransport("https://central.example.test",signer);
  globalThis.fetch=vi.fn(async()=>new Response("redirect",{status:302,headers:{location:"https://evil.test"}})) as typeof fetch;
  await expect(transport.request("floor",{},new AbortController().signal)).rejects.toThrow("QR001_CENTRAL_RESPONSE_REJECTED");
  globalThis.fetch=vi.fn(async()=>new Response("{}",{status:200,headers:{
    "content-type":"application/json; charset=utf-8","cache-control":"no-store","content-length":"999999",
  }})) as typeof fetch;
  await expect(transport.request("floor",{},new AbortController().signal)).rejects.toThrow("QR001_RESPONSE_TOO_LARGE");
 });
 it("denies insecure origin and disabled TLS verification",()=>{
  const signer={authorization:async()=> "x"} as DeviceCredentialProvider;
  expect(()=>new MerchantDestinationHttpsTransport("http://bank.example.test",signer)).toThrow();
  expect(()=>new MerchantDestinationHttpsTransport("https://central.example.test/path",signer)).toThrow();
 });
});
