import {afterEach,describe,expect,it,vi} from "vitest";
import {MerchantNoticeFeedSyncComponent} from "../src/payments/merchant-notice-feed.js";
import type {DeviceCredentialProvider} from "../src/sync/device-credential.js";

const savedFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=savedFetch;vi.restoreAllMocks();});
const item={
 id:"01900000-0000-7000-8000-000000000031",
 received_at:"2026-11-07T12:00:00Z",
 reported_amount_cop:4500,payer_display:"Juan Pérez",
 status:"UNVERIFIED",bank_confirmed:false,sale_confirmed:false,
};
const device={
 isProvisioned:()=>true,
 authorization:vi.fn(async()=> "DeviceProof test"),
} as DeviceCredentialProvider;
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{
 "content-type":"application/json; charset=utf-8","cache-control":"no-store",
}});

describe("QR-002 near-live company feed on Windows",()=>{
 it("starts local-first, verifies signed-device route, exposes only unverified notice",async()=>{
  const calls=vi.fn(async(_url:unknown,_opts:unknown)=>response({notices:[item]}));
  globalThis.fetch=calls as typeof fetch;
  const errors:string[]=[];
  const sync=new MerchantNoticeFeedSyncComponent("https://central.example.test",device,x=>errors.push(x));
  await sync.start();
  try{
   await vi.waitFor(()=>expect(sync.snapshot().outcome).toBe("AVAILABLE"),{timeout:1500});
   expect(sync.snapshot().notices).toHaveLength(1);
   expect(sync.snapshot().notices[0]?.reported_amount_cop).toBe(4500);
   expect(sync.snapshot().notices[0]?.payer_display).toBe("Juan Pérez");
   expect(sync.snapshot().notices[0]?.bank_confirmed).toBe(false);
   const [url,opts]=calls.mock.calls[0]!;
   expect(String(url)).toBe("https://central.example.test/v1/commercial/merchant-notifications/recent");
   expect((opts as RequestInit).headers).toMatchObject({authorization:"DeviceProof test"});
   expect(errors).toEqual([]);
  }finally{await sync.stop();}
  expect(sync.snapshot()).toEqual({outcome:"UNAVAILABLE",checked_at:null,notices:[]});
 });
 it("does not expose a spoofed bank-confirmed result even from HTTPS",async()=>{
  globalThis.fetch=vi.fn(async()=>response({notices:[{...item,bank_confirmed:true}]})) as typeof fetch;
  const errors:string[]=[];
  const sync=new MerchantNoticeFeedSyncComponent("https://central.example.test",device,x=>errors.push(x));
  await sync.start();
  try{
   await vi.waitFor(()=>expect(errors.length).toBeGreaterThan(0),{timeout:1500});
   expect(sync.snapshot().outcome).toBe("UNAVAILABLE");
  }finally{await sync.stop();}
 });
 it("accepts an exact numeric Content-Length and rejects a nonnumeric one",async()=>{
  const run=async(contentLength:string)=>{
   const errors:string[]=[];
   globalThis.fetch=vi.fn(async()=>{
    const res=response({notices:[item]});
    res.headers.set("content-length",contentLength);
    return res;
   }) as typeof fetch;
   const feed=new MerchantNoticeFeedSyncComponent("https://central.example.test",device,x=>errors.push(x));
   await feed.start();
   try{
    await vi.waitFor(()=>expect(feed.snapshot().outcome==="AVAILABLE"||errors.length>0).toBe(true),{timeout:1500});
    return {outcome:feed.snapshot().outcome,errors};
   }finally{await feed.stop();}
  };
  const length=new TextEncoder().encode(JSON.stringify({notices:[item]})).byteLength;
  expect((await run(String(length))).outcome).toBe("AVAILABLE");
  const invalid=await run("12invalid");
  expect(invalid.outcome).toBe("UNAVAILABLE");
  expect(invalid.errors).toContain("QR002_FEED_TOO_LARGE");
 });
 it("rejects insecure Central URL",()=>{
  expect(()=>new MerchantNoticeFeedSyncComponent("http://central.example.test",device,()=>{}))
    .toThrow("QR002_HTTPS_ORIGIN_REJECTED");
 });
});
