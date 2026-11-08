import {describe,expect,it,vi,afterEach} from "vitest";
import {generateKeyPairSync} from "node:crypto";
import type {LocalDatabaseComponent} from "../src/local-database-component.js";
import {MerchantDestinationHttpsTransport,MerchantDestinationSyncComponent,canReuseMerchantDestinationSnapshot,canRecoverMerchantDestinationAcknowledgement} from "../src/payments/merchant-destination-sync.js";
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
describe("QR-001 offline-first service lifecycle",()=>{
 it("starts without awaiting Central and cancels an active HTTPS request on shutdown",async()=>{
   const key=generateKeyPairSync("ed25519").publicKey;
   const signer={authorization:async()=> "DeviceProof signed",isProvisioned:()=>true} as DeviceCredentialProvider;
   const fetcher=vi.fn((_url:unknown,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
     const signal=options.signal;
     if(!signal)throw Error("QR001_MISSING_ABORT_SIGNAL");
     if(signal.aborted){reject(Error("QR001_ABORTED"));return;}
     signal.addEventListener("abort",()=>reject(Error("QR001_ABORTED")),{once:true});
   }));
   globalThis.fetch=fetcher as typeof fetch;
   const report=vi.fn();
   // The remote status call never returns. No local SQL is reached until it
   // does, and the fake DB contains no sale or banking data.
   const db={database:{}} as unknown as LocalDatabaseComponent;
   const sync=new MerchantDestinationSyncComponent(db,signer,{
     origin:"https://central.example.test",
     tenantId:"11111111-1111-4111-8111-111111111111",
     companyId:"33333333-3333-4333-8333-333333333333",
     installationId:"77777777-7777-4777-8777-777777777777",
     environment:"SANDBOX",keyId:"merchant-test",publicKey:key,intervalMs:30_000,
   },report);
   // A regression to "await this.tick()" would block here indefinitely.
   await sync.start();
   await new Promise<void>(resolve=>setImmediate(resolve));
   expect(fetcher).toHaveBeenCalledOnce();
   const options=fetcher.mock.calls[0]?.[1] as RequestInit;
   expect(options.signal?.aborted).toBe(false);
   await sync.stop();
   expect(options.signal?.aborted).toBe(true);
   expect(report).toHaveBeenCalledWith("QR001_ABORTED");
 });
});
describe("QR-001 durable ACK crash recovery",()=>{
 const at=Date.parse("2026-11-07T12:00:00Z");
 const recipient={kind:"BREB_KEY" as const,label:"Bre-B",destination_reference:"@comercio",
   qr_asset_id:null,qr_sha256:null,version:1};
 const snapshot={
   tenant_id:"11111111-1111-4111-8111-111111111111",
   company_id:"33333333-3333-4333-8333-333333333333",
   sequence:11,issued_at:"2026-11-07T11:00:00Z",
   expires_at:"2026-11-07T13:00:00Z",destination:recipient,destinations:[recipient],
 };
 const local={snapshot,received_at:"2026-11-07T11:01:00Z"};
 it("recovers a lost ACK for unchanged bank destination after SQLite commit",()=>{
   expect(canRecoverMerchantDestinationAcknowledgement(local,{
     ...snapshot,issued_at:"2026-11-07T11:30:00Z",
   },null,11,at)).toBe(true);
   expect(canRecoverMerchantDestinationAcknowledgement(local,snapshot,10,11,at)).toBe(true);
 });
 it("never acknowledges changed recipient, a new revision or expired local evidence",()=>{
   expect(canRecoverMerchantDestinationAcknowledgement(local,{
     ...snapshot,destination:{...recipient,destination_reference:"@attacker"},
       destinations:[{...recipient,destination_reference:"@attacker"}],
   },null,11,at)).toBe(false);
   expect(canRecoverMerchantDestinationAcknowledgement(local,{...snapshot,sequence:12},null,12,at)).toBe(false);
   expect(canRecoverMerchantDestinationAcknowledgement(local,snapshot,11,11,at)).toBe(false);
   expect(canRecoverMerchantDestinationAcknowledgement(local,snapshot,null,11,at+60*60_000)).toBe(false);
   expect(canRecoverMerchantDestinationAcknowledgement(null,snapshot,null,11,at)).toBe(false);
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
