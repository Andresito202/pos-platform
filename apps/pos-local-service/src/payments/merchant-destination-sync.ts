import {uuidV7} from "@pos-platform/contracts";
import type {KeyObject} from "node:crypto";
import type {DestinationProjectionState,DestinationSnapshot} from "@pos-platform/domain";
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
   const path=prefix+action,raw=JSON.stringify(body),requestId=uuidV7(),correlationId=uuidV7();
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
   // Three distinct official QR methods, each capped at 1 MiB PNG. Base64
   // expands every image to ~1.4 MiB before JSON fields/signature.
   const limit=action==="snapshot"?4_400_000:1024;
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
/**
 * Only an exact remotely acknowledged, unexpired company projection can be
 * reused; any revision mismatch, local corruption, rollback or short TTL
 * requires retrieving a new signed snapshot.
 */
export function canReuseMerchantDestinationSnapshot(
 local:{snapshot:{sequence:number;expires_at:string}}|null,
 acknowledged:number|null,current:number|null,nowMs:number,
):boolean {
 if(!local||acknowledged===null||current===null||!Number.isFinite(nowMs))return false;
 const seq=local.snapshot.sequence;
 return Number.isSafeInteger(seq)&&seq>0&&acknowledged===seq&&current===seq&&
   Date.parse(local.snapshot.expires_at)>nowMs+15*60_000;
}

/**
 * Recover a lost Central ACK after SQLite has committed. This is only allowed
 * when a newly verified Central signature matches the local recipient data
 * byte-for-byte and Central has NOT published a newer generation. No bank
 * payment is inferred by this acknowledgement.
 */
export function canRecoverMerchantDestinationAcknowledgement(
 local:DestinationProjectionState|null,
 verified:DestinationSnapshot,
 acknowledged:number|null,current:number|null,nowMs:number,
):boolean{
 if(!local||current===null||!Number.isFinite(nowMs))return false;
 const localSequence=local.snapshot.sequence;
 if(verified.sequence!==localSequence||current!==localSequence||
    (acknowledged!==null&&acknowledged>=localSequence)||
    Date.parse(local.snapshot.expires_at)<=nowMs||
    Date.parse(verified.expires_at)<=nowMs)return false;
 const source=local.snapshot.destinations??(local.snapshot.destination?[local.snapshot.destination]:[]);
 const remote=verified.destinations??(verified.destination?[verified.destination]:[]);
 return JSON.stringify(source)===JSON.stringify(remote);
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
   const company={tenantId:scope.tenantId,companyId:scope.companyId};
   try{
     // Low-bandwidth authenticated status check. A full signed PNG bundle is
     // fetched only on a new company publication or before snapshot expiry.
     const status=await this.transport.request("floor",{},controller.signal) as
       {floor?:unknown;current_sequence?:unknown};
     const sequence=(value:unknown):number|null=>{
       if(value===null)return null;
       if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)
         throw Error("QR001_INVALID_SEQUENCE_STATUS");
       return value;
     };
     if(!status||typeof status!=="object"||
        !Object.hasOwn(status,"floor")||!Object.hasOwn(status,"current_sequence"))
       throw Error("QR001_INVALID_SEQUENCE_STATUS");
     const acknowledged=sequence(status.floor);
     const current=sequence(status.current_sequence);
     const local=store.load(company);
     // A stale, unacknowledged or restored SQLite state MUST refresh.
     if(canReuseMerchantDestinationSnapshot(local,acknowledged,current,Date.now())){
       this.report("VALID_CACHED");
       return;
     }
     const floor={
       floorFor:async()=>acknowledged,
     };
     const response=await this.transport.request("snapshot",{},controller.signal) as {artifact?:unknown};
     if(!response||typeof response!=="object"||!response.artifact)
       throw Error("QR001_INVALID_SNAPSHOT_RESPONSE");
     // If Central did not receive the last ACK, a crash may leave a durable,
     // fully verified SQLite snapshot at the SAME generation. The normal CAS
     // correctly rejects replay; recover the ACK only after verifying a fresh
     // signed Central artifact with identical bank recipients and QR bytes.
     if(local&&current===local.snapshot.sequence&&
        (acknowledged===null||acknowledged<current)){
       const fresh=verifier.verify(response.artifact,scope);
       if(fresh.decision==="VALID"&&canRecoverMerchantDestinationAcknowledgement(
         local,fresh.snapshot,acknowledged,current,Date.now())){
         const ackRecovered=await this.transport.request("ack",{sequence:current},controller.signal)
           as {sequence?:unknown};
         if(typeof ackRecovered?.sequence!=="number"||
            !Number.isSafeInteger(ackRecovered.sequence)||ackRecovered.sequence<current)
           throw Error("QR001_ACK_RECOVERY_REJECTED");
         this.report("ACK_RECOVERED");
         return;
       }
     }
     const activated=await new MerchantDestinationActivationService(verifier,store,floor)
       .acceptSigned(response.artifact,scope);
     if(activated.kind!=="ACTIVATED"){this.report(activated.reason);return;}
     const ack=await this.transport.request("ack",{sequence:activated.sequence},controller.signal) as {sequence?:unknown};
     if(typeof ack?.sequence!=="number"||!Number.isSafeInteger(ack.sequence)||
       ack.sequence<activated.sequence)throw Error("QR001_ACK_REJECTED");
     this.report("ACTIVATED_AND_ACKNOWLEDGED");
   }catch(error){this.report(error instanceof Error?error.message:"QR001_SYNC_FAILURE");}

 }
}
