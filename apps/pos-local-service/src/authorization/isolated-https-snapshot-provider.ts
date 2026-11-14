import {request} from "node:https";
import {SignedAuthorizationSnapshotSchema,validateCommercialHttpsOrigin,UuidV7Schema,UuidSchema,type SignedAuthorizationSnapshot} from "@pos-platform/contracts";
import {parseDeviceRequestAuthorization} from "@pos-platform/device-trust";
import type {SnapshotProvider} from "./snapshot-provider.js";
import type {SnapshotBinding} from "./authorization-snapshot-store.js";

type SnapshotHttpRequest={requestId:string;correlationId:string;body:string;timeoutMs:number};
export type AuthorizationHttpsConfiguration=SnapshotHttpRequest&(
  {mode:"ISOLATED_VALIDATION";port:number;ca:Buffer;accessToken:string;authorization:string}|
  {mode:"SYSTEM_TRUST";origin:string;authenticate:(request:Readonly<SnapshotHttpRequest&{method:"POST";path:"/v1/business-session/authorization"}>)=>Promise<Readonly<Record<string,string>>>});
/** Existing SnapshotProvider, now with explicit system-TLS deployment support.
 * Inputs are privileged per-request custody, never renderer or environment.
 * No redirect, TLS bypass, unsigned acceptance or production activation switch. */
export class HttpsAuthorizationSnapshotProvider implements SnapshotProvider {
  constructor(private readonly input:AuthorizationHttpsConfiguration){
    if(input.mode==="ISOLATED_VALIDATION"){
      if(process.env.NODE_ENV!=="test"||!Number.isSafeInteger(input.port)||input.port<1||input.port>65535)throw Error("SAS_ISOLATED_HTTPS_REQUIRED");
    }else if(input.mode==="SYSTEM_TRUST"){
      validateCommercialHttpsOrigin(input.origin);if("ca" in input||"port" in input)throw Error("SAS_SYSTEM_TLS_OVERRIDE_REJECTED");
      if(typeof input.authenticate!=="function"||"accessToken" in input||"authorization" in input)throw Error("SAS_APPROVED_NATIVE_AUTHENTICATOR_REQUIRED");
    }else throw Error("SAS_HTTPS_MODE_REQUIRED");
    try{
      const body=JSON.parse(input.body);if(!body||Object.keys(body).length!==1)throw Error();UuidSchema.parse(body.session_id);
      UuidV7Schema.parse(input.requestId);UuidV7Schema.parse(input.correlationId);
      if(input.mode==="ISOLATED_VALIDATION"&&(!parseDeviceRequestAuthorization(input.authorization)||typeof input.accessToken!=="string"||input.accessToken.length>8192||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.accessToken)))throw Error();
    }catch{throw Error("SAS_AUTHENTICATED_REQUEST_REQUIRED");}
    if(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0)throw Error("SAS_REQUEST_TIMEOUT_REQUIRED");
    this.input=Object.freeze({...input,...(input.mode==="ISOLATED_VALIDATION"?{ca:Buffer.from(input.ca)}:{})});
  }
  async fetch(_binding:SnapshotBinding):Promise<SignedAuthorizationSnapshot>{
    const i=this.input;
    const target=i.mode==="SYSTEM_TRUST"?new URL(i.origin):new URL("https://business.example.test");
    let authentication:Readonly<Record<string,string>>;
    if(i.mode==="ISOLATED_VALIDATION")authentication={authorization:i.authorization,"x-isolated-business-access":i.accessToken};
    else try{authentication=await i.authenticate(Object.freeze({method:"POST" as const,path:"/v1/business-session/authorization" as const,
      requestId:i.requestId,correlationId:i.correlationId,body:i.body,timeoutMs:i.timeoutMs}));}
    catch{throw Error("SAS_NATIVE_AUTHENTICATOR_UNAVAILABLE");}
    if(!parseDeviceRequestAuthorization(authentication.authorization??""))throw Error("SAS_NATIVE_AUTHENTICATION_REJECTED");
    if(i.mode==="SYSTEM_TRUST")for(const [name,value] of Object.entries(authentication)){
      if((name!=="authorization"&&!/^x-[a-z0-9-]+$/.test(name))||["x-request-id","x-correlation-id","x-isolated-business-access"].includes(name)||name.startsWith("x-forwarded-")||
        typeof value!=="string"||value.length>8192||/[\r\n]/.test(value))throw Error("SAS_NATIVE_AUTHENTICATION_REJECTED");
    }
    return new Promise((resolve,reject)=>{
      const req=request({host:i.mode==="ISOLATED_VALIDATION"?"127.0.0.1":target.hostname,port:i.mode==="ISOLATED_VALIDATION"?i.port:target.port||443,
        servername:target.hostname,...(i.mode==="ISOLATED_VALIDATION"?{ca:i.ca}:{}),rejectUnauthorized:true,minVersion:"TLSv1.2",agent:false,
        path:"/v1/business-session/authorization",method:"POST",headers:{...authentication,host:target.host,"content-type":"application/json",
          "content-length":Buffer.byteLength(i.body),"x-request-id":i.requestId,"x-correlation-id":i.correlationId}},res=>{
        const chunks:Buffer[]=[];let size=0;
        res.on("data",chunk=>{size+=chunk.length;if(size>256*1024)res.destroy(Error("SAS_RESPONSE_TOO_LARGE"));else chunks.push(Buffer.from(chunk));});
        res.on("error",reject);res.on("end",()=>{
          if(res.statusCode!==200||res.headers["cache-control"]!=="no-store"||res.headers["content-type"]?.split(";")[0]!=="application/json"){
            reject(Error("SAS_PROVIDER_REJECTED"));return;}
          try{resolve(SignedAuthorizationSnapshotSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))));}catch(e){reject(e);}
        });
      });req.setTimeout(i.timeoutMs,()=>req.destroy(Error("SAS_PROVIDER_TIMEOUT")));req.on("error",reject);req.end(i.body);
    });
  }
}
// Source-compatible alias for the existing isolated composition and test driver.
export class IsolatedHttpsSnapshotProvider extends HttpsAuthorizationSnapshotProvider {
  constructor(input:Extract<AuthorizationHttpsConfiguration,{mode:"ISOLATED_VALIDATION"}>){super(input);}
}
