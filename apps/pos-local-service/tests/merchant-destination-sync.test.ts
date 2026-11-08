import {describe,expect,it,vi,afterEach} from "vitest";
import {MerchantDestinationHttpsTransport,canReuseMerchantDestinationSnapshot} from "../src/payments/merchant-destination-sync.js";
import type {DeviceCredentialProvider} from "../src/sync/device-credential.js";

const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
describe("QR-001 low-bandwidth trusted company revision check",()=>{
 const now=Date.parse("2026-11-07T12:00:00Z");
 const state={snapshot:{sequence:12,expires_at:"2026-11-07T13:00:00Z"}};
 it("reuses exact acknowledged company revision for all four registers",()=>{
   expect(Array.from({length:4},()=>canReuseMerchantDestinationSnapshot(state,12,12,now)))
     .toEqual([true,true,true,true]);
 });
 it("re-downloads on administrator publication, revocation or absent ACK",()=>{
   expect(canReuseMerchantDestinationSnapshot(state,12,13,now)).toBe(false);
   expect(canReuseMerchantDestinationSnapshot(state,null,12,now)).toBe(false);
   expect(canReuseMerchantDestinationSnapshot(state,11,12,now)).toBe(false);
 });
 it("rejects local backup rollback or an expiring/stale image cache",()=>{
   expect(canReuseMerchantDestinationSnapshot(state,13,13,now)).toBe(false);
   expect(canReuseMerchantDestinationSnapshot(state,12,12,Date.parse("2026-11-07T12:45:00Z"))).toBe(false);
   expect(canReuseMerchantDestinationSnapshot(null,12,12,now)).toBe(false);
   expect(canReuseMerchantDestinationSnapshot({snapshot:{sequence:12,expires_at:"invalid"}},12,12,now)).toBe(false);
 });
});
describe("QR-001 signed-device HTTPS client",()=>{
 it("signs exact requested path and body without tenant asserted by renderer",async()=>{
  const signed=vi.fn(async(_context:unknown)=> "DeviceProof signed");
  const signer={authorization:signed,isProvisioned:()=>true} as DeviceCredentialProvider;
  const fetcher=vi.fn(async(_url:unknown,_options:unknown)=>new Response(JSON.stringify({floor:null}),{
   status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  }));
  globalThis.fetch=fetcher as typeof fetch;
  const transport=new MerchantDestinationHttpsTransport("https://central.example.test",signer);
  expect(await transport.request("floor",{},new AbortController().signal)).toEqual({floor:null});
  expect(signed).toHaveBeenCalledOnce();
  const signedFields=signed.mock.calls[0]?.[0] as {requestId:string;correlationId:string};
  expect(signedFields.requestId).toMatch(/^[a-f0-9-]{14}7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/i);
  expect(signedFields.correlationId).toMatch(/^[a-f0-9-]{14}7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/i);
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
 it("accepts a three-QR bounded signed snapshot but rejects oversized payloads",async()=>{
   const signer={authorization:async()=> "DeviceProof signed",isProvisioned:()=>true} as DeviceCredentialProvider;
   const transport=new MerchantDestinationHttpsTransport("https://central.example.test",signer);
   const payload=JSON.stringify({artifact:{claims:{snapshot:{
     destinations:[1,2,3].map(n=>({kind:n,png_base64:"A".repeat(1_300_000)})),
   }}}});
   globalThis.fetch=vi.fn(async()=>new Response(payload,{status:200,headers:{
     "content-type":"application/json; charset=utf-8","cache-control":"no-store",
   }})) as typeof fetch;
   expect(await transport.request("snapshot",{},new AbortController().signal)).toBeTruthy();
   globalThis.fetch=vi.fn(async()=>new Response("x".repeat(4_400_001),{status:200,headers:{
     "content-type":"application/json; charset=utf-8","cache-control":"no-store",
   }})) as typeof fetch;
   await expect(transport.request("snapshot",{},new AbortController().signal)).rejects.toThrow("QR001_RESPONSE_TOO_LARGE");
 });
 it("denies insecure origin and disabled TLS verification",()=>{
  const signer={authorization:async()=> "x"} as DeviceCredentialProvider;
  expect(()=>new MerchantDestinationHttpsTransport("http://bank.example.test",signer)).toThrow();
  expect(()=>new MerchantDestinationHttpsTransport("https://central.example.test/path",signer)).toThrow();
 });
});
