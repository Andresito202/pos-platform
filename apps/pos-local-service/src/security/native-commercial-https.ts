import {request} from "node:https";
import {validateNativeClientRegistration,type NativeClientRegistration} from "@pos-platform/contracts";
import type {NativeCommercialCentralTransport,NativeCentralPath} from "./native-commercial-coordinator.js";

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
    if(!["/v1/commercial/native-request-challenges","/v1/commercial/native-requests","/v1/commercial/token",
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
