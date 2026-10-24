import {request} from "node:https";
import {SignedAuthorizationSnapshotSchema,type SignedAuthorizationSnapshot} from "@pos-platform/contracts";
import type {SnapshotProvider} from "./snapshot-provider.js";
import type {SnapshotBinding} from "./authorization-snapshot-store.js";

/** Real HTTPS adapter for the existing SnapshotProvider, temporary laboratory
 * only. Credentials supplied by native custody, never renderer or environment.
 * No fallback to TLS bypass, redirects, unsigned JSON or production activation. */
export class IsolatedHttpsSnapshotProvider implements SnapshotProvider {
  constructor(private readonly input:{mode:"ISOLATED_VALIDATION";port:number;ca:Buffer;accessToken:string;
    authorization:string;requestId:string;correlationId:string;body:string;timeoutMs:number}){
    if(process.env.NODE_ENV!=="test"||input.mode!=="ISOLATED_VALIDATION"||!Number.isSafeInteger(input.port)||input.port<1||input.port>65535||
      !Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0)throw Error("SAS_ISOLATED_HTTPS_REQUIRED");
  }
  fetch(_binding:SnapshotBinding):Promise<SignedAuthorizationSnapshot>{
    const i=this.input;
    return new Promise((resolve,reject)=>{
      const req=request({host:"127.0.0.1",port:i.port,servername:"business.example.test",ca:i.ca,minVersion:"TLSv1.2",agent:false,
        path:"/v1/business-session/authorization",method:"POST",headers:{host:"business.example.test","content-type":"application/json",
          "content-length":Buffer.byteLength(i.body),authorization:i.authorization,"x-request-id":i.requestId,"x-correlation-id":i.correlationId,
          "x-isolated-business-access":i.accessToken}},res=>{
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
