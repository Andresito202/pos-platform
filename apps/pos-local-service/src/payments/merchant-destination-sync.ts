import {randomUUID} from "node:crypto";
import {uuidV7} from "@pos-platform/contracts";
import type {KeyObject} from "node:crypto";
import type {RuntimeComponent} from "../lifecycle.js";
import type {DeviceCredentialProvider} from "../sync/device-credential.js";
import type {LocalDatabaseComponent} from "../local-database-component.js";
import {MerchantDestinationSnapshotVerifier,MERCHANT_DESTINATION_KEY_PURPOSE} from "../security/merchant-destination-snapshot-verifier.js";
import {MerchantDestinationActivationService} from "./merchant-destination-activation.js";
import {SqliteMerchantDestinationProjectionStore} from "./sqlite-merchant-destination-projection-store.js";
import {TrustedClockGuard} from "../security/trusted-clock.js";

type Action="snapshot"|"floor"|"ack";
const prefix="/v1/commercial/merchant-destinations/";
/** Separate device-proof-only fetch transport; no browser cookie, token or
 * arbitrary caller-supplied path. Native TLS verification is mandatory.
 */
export class MerchantDestinationHttpsTransport {
 private readonly origin:string;
 constructor(origin:string,private readonly signer:DeviceCredentialProvider,private readonly timeoutMs=10000){
   const u=new URL(origin);
   if(u.protocol!=="https:"||u.origin!==origin||u.username||u.password||u.hash||u.search||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0")throw Error("QR001_HTTPS_POLICY_REJECTED");
   this.origin=origin;
 }
 async request(action:Action,body:Readonly<Record<string,unknown>>,signal:AbortSignal):Promise<unknown>{
   if(!["snapshot","floor","ack"].includes(action))throw Error("QR001_INVALID_OPERATION");
   const path=prefix+action,raw=JSON.stringify(body),requestId=randomUUID(),correlationId=crypto.randomUUID();
   if(Buffer.byteLength(raw)>1024)throw Error("QR001_REQUEST_TOO_LARGE");
   const authorization=await this.signer.authorization({method:"POST",path,requestId,correlationId,body:raw});
   const response=await fetch(new URL(path,this.origin),{
     method:"POST",cache:"no-store",redirect:"error",
     body:raw,signal:AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]),
     headers:{"authorization":authorization,"x-request-id":requestId,"x-correlation-id":correlationId,"content-type":"application/json"},
   });
   if(response.status!==200||response.headers.get("content-type")!=="application/json; charset=utf-8"||
     response.headers.get("cache-control")!=="no-store"||response.headers.has("content-encoding")||
     response.headers.has("location"))throw Error("QR001_CENTRAL_RESPONSE_REJECTED");
   const declared=response.headers.get("content-length");
   const limit=action==="snapshot"?1_600_000:1024;
   if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw Error("QR001_RESPONSE_TOO_LARGE");
   if(!response.body)throw Error("QR001_EMPTY_RESPONSE");
   const reader=response.body.getReader(),chunks:Buffer[]=[];let total=0;
   try {
     while(true){
       const {done,value}=await reader.read();if(done)break;
       total+=value.byteLength;
       if(total>limit){await reader.cancel();throw Error("QR001_RESPONSE_TOO_LARGE");}
       chunks.push(Buffer.from(value));
     }
   }finally{reader.releaseLock();}
   return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,total)));
 }
}
export interface MerchantDestinationSyncProvision{
 readonly origin:string;
 readonly tenantId:string;
 readonly companyId:string;
 readonly installationId:string;
 readonly environment:"SANDBOX"|"STAGING"|"PRODUCTION";
 readonly keyId:string;
 readonly publicKey:KeyObject;
 readonly intervalMs:number;
}
/** Physical Central -> signed snapshot -> SQLite -> Central ACK pipeline. No
 * renderer access to this component and no direct bank confirmation.
 */
export class MerchantDestinationSyncComponent implements RuntimeComponent {
 readonly name="merchant-destination-sync";
 private timer:NodeJS.Timeout|undefined;
 private inFlight:Promise<void>|undefined;
 private readonly transport:MerchantDestinationHttpsTransport;
 private stopping=false;
 constructor(private readonly db:LocalDatabaseComponent,private readonly signer:DeviceCredentialProvider,
  private readonly provision:MerchantDestinationSyncProvision,
  private readonly report:(result:string)=>void) {
   if(provision.publicKey.asymmetricKeyType!=="ed25519"||provision.publicKey.type!=="public"||
      !/^[A-Za-z0-9._-]{1,96}$/.test(provision.keyId)||!Number.isSafeInteger(provision.intervalMs)||
      provision.intervalMs<5000||provision.intervalMs>3600000)throw Error("QR001_PROVISION_REJECTED");
   this.transport=new MerchantDestinationHttpsTransport(provision.origin,signer);
 }
 async start():Promise<void>{
   this.stopping=false;
   await this.tick();
   const timer=setInterval(()=>{if(this.stopping||this.inFlight)return;this.inFlight=this.tick().finally(()=>{this.inFlight=undefined;});},
      this.provision.intervalMs);
   timer.unref?.();this.timer=timer;
 }
 async stop():Promise<void>{
   this.stopping=true;
   if(this.timer)clearInterval(this.timer);
   this.timer=undefined;
   await this.inFlight;
 }
 private async tick():Promise<void>{
   if(!this.signer.isProvisioned?.()){this.report("DEVICE_NOT_PROVISIONED");return;}
   const controller=new AbortController();
   const scope={tenantId:this.provision.tenantId,companyId:this.provision.companyId,
     installationId:this.provision.installationId,environment:this.provision.environment};
   const store=new SqliteMerchantDestinationProjectionStore(this.db.database);
   const verifier=new MerchantDestinationSnapshotVerifier(
      new Map([[this.provision.keyId,{key:this.provision.publicKey,purpose:MERCHANT_DESTINATION_KEY_PURPOSE,
        status:"ACTIVE" as const}]]),new TrustedClockGuard(this.db.database));
   const floor={
     floorFor:async()=>{
       const value=await this.transport.request("floor",{},controller.signal) as {floor?:unknown};
       if(!value||typeof value!=="object"||!Object.hasOwn(value,"floor"))throw Error("QR001_INVALID_FLOOR");
       if(value.floor===null)return null;
       if(typeof value.floor!=="number"||!Number.isSafeInteger(value.floor)||value.floor<1)
         throw Error("QR001_INVALID_FLOOR");
       return value.floor;
     },
   };
   try{
     const response=await this.transport.request("snapshot",{},controller.signal) as {artifact?:unknown};
     if(!response||typeof response!=="object"||!response.artifact)throw Error("QR001_INVALID_SNAPSHOT_RESPONSE");
     const activated=await new MerchantDestinationActivationService(verifier,store,floor).acceptSigned(response.artifact,scope);
     if(activated.kind!=="ACTIVATED"){this.report(activated.reason);return;}
     const acknowledged=await this.transport.request("ack",{sequence:activated.sequence},controller.signal) as {sequence?:unknown};
     if(typeof acknowledged?.sequence!=="number"||!Number.isSafeInteger(acknowledged.sequence)||
       acknowledged.sequence<activated.sequence)throw Error("QR001_ACK_REJECTED");
     this.report("ACTIVATED_AND_ACKNOWLEDGED");
   }catch(error){this.report(error instanceof Error?error.message:"QR001_SYNC_FAILURE");}
 }
}
