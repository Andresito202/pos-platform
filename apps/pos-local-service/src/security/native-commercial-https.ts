import {request} from "node:https";
import {validateNativeClientRegistration,validateCommercialHttpsOrigin,CommercialHttpV2,type NativeClientRegistration} from "@pos-platform/contracts";
import type {NativeCommercialCentralTransport,NativeCentralPath} from "./native-commercial-coordinator.js";

const routes=new Set<NativeCentralPath>(["/v1/commercial/native-request-challenges","/v1/commercial/native-requests","/v1/commercial/token",
  "/v1/commercial/refresh","/v1/business-session/assertions","/v1/business-session/authorization"]);

/** Deployment transport: system TLS only, pinned configured origin and closed
 * operations. No DNS/CA overrides, redirect following or caller-owned URL. */
export class NativeCommercialHttps implements NativeCommercialCentralTransport{
  private readonly origin:string;
  constructor(registration:NativeClientRegistration,private readonly timeoutMs:number){
    this.origin=validateCommercialHttpsOrigin(validateNativeClientRegistration(registration).authorizationOrigin);
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>2_147_483_647)throw Error("NATIVE_HTTPS_EXPLICIT_TIMEOUT_REQUIRED");
  }
  async post(path:NativeCentralPath,body:string,headers:Readonly<Record<string,string>>,signal:AbortSignal):Promise<unknown>{
    if(!routes.has(path)||typeof body!=="string"||Buffer.byteLength(body)>16384||Object.keys(headers).some(k=>
      !["authorization","x-request-id","x-correlation-id",CommercialHttpV2.accessHeader].includes(k)))throw Error("NATIVE_CENTRAL_REQUEST_REJECTED");
    const deadline=AbortSignal.timeout(this.timeoutMs);
    const response=await fetch(new URL(path,this.origin),{method:"POST",body,headers:{...headers,"content-type":"application/json"},
      cache:"no-store",redirect:"error",signal:AbortSignal.any([signal,deadline])});
    try{
      if(response.status!==200||response.headers.get("content-type")!=="application/json; charset=utf-8"||response.headers.get("cache-control")!=="no-store"||
        response.headers.has("location")||response.headers.has("content-encoding"))throw Error("NATIVE_CENTRAL_RESPONSE_REJECTED");
      const length=response.headers.get("content-length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)>262144))throw Error("NATIVE_RESPONSE_TOO_LARGE");
      if(!response.body)throw Error("NATIVE_RESPONSE_EMPTY");const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>262144){await reader.cancel();throw Error("NATIVE_RESPONSE_TOO_LARGE");}chunks.push(Buffer.from(value));}}
      finally{reader.releaseLock();}
      signal.throwIfAborted();return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,size)));
    }finally{if(response.body&&!response.bodyUsed)await response.body.cancel().catch(()=>undefined);}
  }
}

/** Approved laboratory composition only; no production origin/key is selected.
 * HTTPS is consumed in the Service; no proof or secret is returned over IPC. */
export class IsolatedNativeCommercialHttps implements NativeCommercialCentralTransport {
  private readonly origin:string;
  constructor(registration:NativeClientRegistration,private readonly input:{mode:"ISOLATED_VALIDATION";port:number;ca:Buffer;timeoutMs:number}){
    this.origin=validateNativeClientRegistration(registration).authorizationOrigin;
    if(process.env.NODE_ENV!=="test"||input.mode!=="ISOLATED_VALIDATION"||this.origin!=="https://business.example.test"||
      !Number.isSafeInteger(input.port)||input.port<1||input.port>65535||!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0)
      throw Error("NATIVE_HTTPS_ISOLATED_POLICY_REQUIRED");
  }
  post(path:NativeCentralPath,body:string,headers:Readonly<Record<string,string>>,signal:AbortSignal):Promise<unknown>{
    if(!["/v1/commercial/native-request-challenges","/v1/commercial/native-requests","/v1/commercial/token","/v1/commercial/refresh",
      "/v1/business-session/assertions","/v1/business-session/authorization"].includes(path))throw Error("NATIVE_CENTRAL_ROUTE_REJECTED");
    return new Promise((resolve,reject)=>{
      const req=request({host:"127.0.0.1",port:this.input.port,servername:new URL(this.origin).hostname,ca:this.input.ca,signal,
        minVersion:"TLSv1.2",agent:false,path,method:"POST",headers:{...headers,host:new URL(this.origin).host,
          "content-type":"application/json","content-length":Buffer.byteLength(body)}},res=>{
        const chunks:Buffer[]=[];let size=0;
        res.on("data",chunk=>{size+=chunk.length;if(size>256*1024)res.destroy(Error("NATIVE_RESPONSE_TOO_LARGE"));else chunks.push(Buffer.from(chunk));});
        res.on("error",reject);res.on("end",()=>{
          if(res.statusCode!==200||res.headers["content-type"]?.split(";")[0]!=="application/json"||res.headers["cache-control"]!=="no-store"){
            reject(Error("NATIVE_CENTRAL_REJECTED"));return;}
          try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error("NATIVE_RESPONSE_INVALID"));}
        });
      });req.setTimeout(this.input.timeoutMs,()=>req.destroy(Error("NATIVE_CENTRAL_TIMEOUT")));req.on("error",reject);req.end(body);
    });
  }
}
