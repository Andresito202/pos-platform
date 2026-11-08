import {uuidV7,MerchantNoticeItemSchema,type MerchantNoticesGetResult} from "@pos-platform/contracts";
import type {DeviceCredentialProvider} from "../sync/device-credential.js";
import type {RuntimeComponent} from "../lifecycle.js";

const PATH="/v1/commercial/merchant-notifications/recent";
const POLL_MS=5000;
const FRESH_MS=15000;
const MAX_RESPONSE_BYTES=32000;

/**
 * Company-bound device HTTPS feed. Never accepts a cashier-provided company,
 * source, sale ID or amount. Only the server-selected device company is read.
 * An SMS is a provisional alert, NEVER a bank receipt or sale confirmation.
 */
export class MerchantNoticeFeedSyncComponent implements RuntimeComponent{
 readonly name="merchant-notice-feed";
 private readonly origin:string;
 private timer:NodeJS.Timeout|undefined;
 private inFlight:Promise<void>|undefined;
 private abort:AbortController|undefined;
 private stopped=true;
 private lastReadAt=0;
 private currentNotices:MerchantNoticesGetResult["notices"]=[];
 constructor(origin:string,private readonly signer:DeviceCredentialProvider,
  private readonly report:(code:string)=>void){
  const u=new URL(origin);
  if(u.protocol!=="https:"||u.origin!==origin||u.username||u.password||u.search||u.hash||
     process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0")
    throw Error("QR002_HTTPS_ORIGIN_REJECTED");
  this.origin=origin;
 }
 snapshot():MerchantNoticesGetResult{
  if(this.stopped||!this.lastReadAt||Date.now()-this.lastReadAt>FRESH_MS)
    return {outcome:"UNAVAILABLE",checked_at:null,notices:[]};
  return {outcome:"AVAILABLE",checked_at:new Date(this.lastReadAt).toISOString(),
    notices:this.currentNotices.map(item=>({...item}))};
 }
 async start():Promise<void>{
  this.stopped=false;
  const launch=()=>{
   if(this.stopped||this.inFlight)return;
   const controller=new AbortController();this.abort=controller;
   this.inFlight=this.readFromCentral(controller.signal)
     .catch(error=>this.report(error instanceof Error?error.message:"QR002_FEED_FAILED"))
     .finally(()=>{if(this.abort===controller)this.abort=undefined;this.inFlight=undefined;});
  };
  launch();
  this.timer=setInterval(launch,POLL_MS);this.timer.unref?.();
 }
 async stop():Promise<void>{
  this.stopped=true;
  if(this.timer)clearInterval(this.timer);this.timer=undefined;
  this.abort?.abort();
  await this.inFlight;
  this.lastReadAt=0;this.currentNotices=[];
 }
 private async readFromCentral(signal:AbortSignal):Promise<void>{
  if(!this.signer.isProvisioned?.())throw Error("QR002_DEVICE_NOT_PROVISIONED");
  const requestId=uuidV7(),correlationId=uuidV7(),body="{}";
  const authorization=await this.signer.authorization({
   method:"POST",path:PATH,requestId,correlationId,body,
  });
  const response=await fetch(new URL(PATH,this.origin),{
   method:"POST",body,cache:"no-store",redirect:"error",
   signal:AbortSignal.any([signal,AbortSignal.timeout(4500)]),
   headers:{"authorization":authorization,"content-type":"application/json",
    "x-request-id":requestId,"x-correlation-id":correlationId},
  });
  if(response.status!==200||
     response.headers.get("content-type")!=="application/json; charset=utf-8"||
     response.headers.get("cache-control")!=="no-store"||
     response.headers.has("content-encoding")||response.headers.has("location"))
   throw Error("QR002_FEED_UNTRUSTED_RESPONSE");
  const declared=response.headers.get("content-length");
  if(declared!==null&&(!/^\\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES))
   throw Error("QR002_FEED_TOO_LARGE");
  if(!response.body)throw Error("QR002_FEED_NO_BODY");
  const reader=response.body.getReader(),chunks:Buffer[]=[];let total=0;
  try{
   while(true){
    const next=await reader.read();if(next.done)break;
    total+=next.value.byteLength;
    if(total>MAX_RESPONSE_BYTES){await reader.cancel();throw Error("QR002_FEED_TOO_LARGE");}
    chunks.push(Buffer.from(next.value));
   }
  }finally{reader.releaseLock();}
  let parsed:unknown;
  try{parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,total)));}
  catch{throw Error("QR002_FEED_BAD_JSON");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("QR002_FEED_BAD_SCHEMA");
  const obj=parsed as Record<string,unknown>;
  if(Object.keys(obj).length!==1||!Array.isArray(obj.notices)||obj.notices.length>25)
   throw Error("QR002_FEED_BAD_SCHEMA");
  const notices=obj.notices.map(item=>MerchantNoticeItemSchema.parse(item));
  if(this.stopped||signal.aborted)return;
  this.currentNotices=notices;this.lastReadAt=Date.now();
 }
}
