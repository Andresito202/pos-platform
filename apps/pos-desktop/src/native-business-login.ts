import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {createServer} from "node:http";
import {request} from "node:https";
import {validateNativeClientRegistration,type NativeClientRegistration,SignedSessionAssertionSchema,SessionActivateResponseSchema} from "@pos-platform/contracts";
import type {ServiceChannel} from "./channel-bridge.js";
import {randomUUID} from "node:crypto";

/** Main-only delivery. The Local Service verifies signature/binding/sequence;
 * activation is identity only and cannot replace backend capabilities/grants. */
export async function activateNativeBusinessAssertion(input:unknown,channel:ServiceChannel):Promise<"ACTIVATED"|"REJECTED">{
  const assertion=SignedSessionAssertionSchema.parse(input),requestId=randomUUID(),correlationId=randomUUID();
  const response=SessionActivateResponseSchema.parse(await channel.request({protocol_version:"1.0.0",message_type:"session.activate",
    request_id:requestId,correlation_id:correlationId,payload_schema_version:"1.0.0",payload:{session_assertion:assertion}}));
  if(response.request_id!==requestId||response.correlation_id!==correlationId)throw Error("NATIVE_SSA_RESPONSE_CORRELATION_REJECTED");
  if(response.status==="SUCCEEDED"&&response.result_code==="ACTIVATED"&&response.result?.outcome==="ACTIVATED"&&
    response.result.sequence===assertion.claims.sequence&&response.result.current_sequence===null&&response.result.decision===null)return "ACTIVATED";
  return "REJECTED";
}

export interface NativeCredentialProtection {
  isEncryptionAvailable():boolean;
  encryptString(value:string):Buffer;
  decryptString(value:Buffer):string;
}
/** Main-process custody only, using Electron safeStorage/Windows DPAPI.
 * No disk persistence until an approved recovery/retention policy is supplied.
 * A process restart requires fresh authentication. Never expose this to preload. */
export class NativeBusinessCredentialVault {
  private encrypted:Buffer|null=null;
  private attempt:object|null=null;
  constructor(private readonly protection:NativeCredentialProtection){
    if(!protection.isEncryptionAvailable())throw Error("NATIVE_OS_CUSTODY_UNAVAILABLE");
  }
  replace(credentials:{accessToken:string;refreshToken:string}){
    this.clear();
    if(!this.protection.isEncryptionAvailable()||!validCredentials(credentials))throw Error("NATIVE_CREDENTIALS_REJECTED");
    this.encrypted=this.protection.encryptString(JSON.stringify(credentials));
  }
  /** Local custody lease, not authentication evidence. Copies cannot redeem it. */
  beginAttempt():object{this.clear();this.attempt=Object.freeze({});return this.attempt;}
  replaceForAttempt(attempt:object,credentials:{accessToken:string;refreshToken:string}):boolean{
    if(attempt!==this.attempt)return false;
    this.replace(credentials);return true;
  }
  clearAttempt(attempt:object){if(attempt===this.attempt)this.clear();}
  /** Privileged native consumer only: JWT still needs authority/device/SSA validation. */
  async use<T>(consumer:(tokens:Readonly<{accessToken:string;refreshToken:string}>)=>Promise<T>):Promise<T|null>{
    if(!this.encrypted)return null;
    const tokens:unknown=JSON.parse(this.protection.decryptString(this.encrypted));
    if(!validCredentials(tokens)){this.clear();throw Error("NATIVE_CUSTODY_CORRUPT");}
    return consumer(Object.freeze(tokens));
  }
  clear(){this.encrypted?.fill(0);this.encrypted=null;this.attempt=null;}
}
function validCredentials(value:unknown):value is {accessToken:string;refreshToken:string}{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===2&&typeof v.accessToken==="string"&&v.accessToken.length<=8192&&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.accessToken)&&typeof v.refreshToken==="string"&&/^[A-Za-z0-9_-]{64}$/.test(v.refreshToken);
}
export type NativeLoginResult="CREDENTIALS_STORED"|"CANCELLED"|"FAILED";
type Exchange={code:string;verifier:string;state:string};

/** Existing central token contract, OS TLS trust, no redirects or ambient browser credentials. */
export function exchangeNativeBusinessCode(registration:NativeClientRegistration,input:Exchange,timeoutMs:number){
  const trusted=validateNativeClientRegistration(registration);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error("NATIVE_EXCHANGE_TIMEOUT_REQUIRED");
  if(!/^[A-Za-z0-9._~-]{16,512}$/.test(input.code)||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)||
    !/^[A-Za-z0-9_-]{32,256}$/.test(input.state))throw Error("NATIVE_EXCHANGE_INPUT_REJECTED");
  const payload=JSON.stringify({grant_type:"authorization_code",code:input.code,code_verifier:input.verifier,state:input.state,
    client_id:trusted.clientId,redirect_uri:trusted.redirectUri});
  return new Promise<{accessToken:string;refreshToken:string}>((resolve,reject)=>{
    const fail=()=>reject(Error("NATIVE_EXCHANGE_REJECTED"));
    const req=request(new URL("/v1/commercial/token",trusted.authorizationOrigin),{method:"POST",minVersion:"TLSv1.2",agent:false,
      headers:{"content-type":"application/json","content-length":Buffer.byteLength(payload)}},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>16384){res.destroy();fail();return;}chunks.push(chunk);});
      res.on("error",fail);res.on("end",()=>{
        if(res.statusCode!==200||res.headers["content-type"]?.split(";",1)[0]!=="application/json"||res.headers["cache-control"]!=="no-store"){fail();return;}
        try{const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!validCredentials(parsed)){fail();return;}resolve(parsed);}catch{fail();}
      });
    });req.setTimeout(timeoutMs,()=>{req.destroy();fail();});req.on("error",fail);req.end(payload);
  });
}

/** Privileged native transport. It grants no POS permission and is not mounted
 * in production-entry until the browser entry and D3 registration are approved.
 * The fixed exact registered callback is retained; dynamic-port registration
 * is deliberately not inferred from RFC 8252 without a central policy. */
export async function beginNativeBusinessLogin(input:{
  registration:NativeClientRegistration;timeoutMs:number;vault:NativeBusinessCredentialVault;
  openSystemBrowser:(authorizationUrl:string)=>Promise<void>;
  exchange:(registration:NativeClientRegistration,input:Exchange)=>Promise<{accessToken:string;refreshToken:string}>;
}){
  const registration=validateNativeClientRegistration(input.registration);
  if(registration.platform==="ANDROID"||!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0||
    !(input.vault instanceof NativeBusinessCredentialVault))throw Error("NATIVE_ELECTRON_LOGIN_POLICY_REQUIRED");
  const attempt=input.vault.beginAttempt();
  const redirect=new URL(registration.redirectUri);
  const verifier=randomBytes(48),state=randomBytes(32);
  let phase:"PENDING"|"EXCHANGING"|"DONE"="PENDING";
  let finish!:(status:NativeLoginResult)=>void;
  const result=new Promise<NativeLoginResult>(resolve=>{finish=resolve;});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const dispose=(status:NativeLoginResult)=>{
    if(phase==="DONE")return;phase="DONE";if(timer)clearTimeout(timer);
    verifier.fill(0);state.fill(0);server.closeAllConnections();server.close();
    if(status!=="CREDENTIALS_STORED")input.vault.clearAttempt(attempt);finish(status);
  };
  const server=createServer({maxHeaderSize:8192},(req,res)=>{
    const reply=(status:number)=>{res.writeHead(status,{"content-type":"text/plain; charset=utf-8","cache-control":"no-store",
      "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; frame-ancestors 'none'","x-content-type-options":"nosniff"});res.end(status===200?"Puede cerrar esta ventana.":"Retorno rechazado.");};
    let callback:URL;
    try{callback=new URL(req.url??"",registration.redirectUri);}catch{reply(400);return;}
    const entries=[...callback.searchParams];
    const rawHosts=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i]!.toLowerCase()==="host");
    const code=callback.searchParams.get("code"),returned=callback.searchParams.get("state");
    if(phase!=="PENDING"||req.method!=="GET"||req.socket.remoteAddress!=="127.0.0.1"||rawHosts.length!==1||
      req.headers.host!==redirect.host||callback.origin!==redirect.origin||callback.pathname!==redirect.pathname||
      callback.hash||callback.username||callback.password||req.headers["transfer-encoding"]||Number(req.headers["content-length"]??0)!==0||
      entries.length!==2||entries.some(([key])=>key!=="code"&&key!=="state")||
      !code||!/^[A-Za-z0-9._~-]{16,512}$/.test(code)||!returned||!/^[A-Za-z0-9_-]{43}$/.test(returned)){
      reply(400);return;
    }
    const actual=Buffer.from(returned,"base64url");
    if(actual.toString("base64url")!==returned||actual.length!==state.length||!timingSafeEqual(actual,state)){reply(400);return;}
    phase="EXCHANGING";reply(200);server.close();
    const exchange={code,verifier:verifier.toString("base64url"),state:state.toString("base64url")};
    void input.exchange(registration,exchange).then(credentials=>{
      if(phase==="DONE")return;
      try{dispose(input.vault.replaceForAttempt(attempt,credentials)?"CREDENTIALS_STORED":"CANCELLED");}catch{dispose("FAILED");}
    },()=>dispose("FAILED"));
  });
  server.requestTimeout=5000;server.headersTimeout=3000;
  try{
    await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen({host:"127.0.0.1",port:Number(redirect.port),exclusive:true},()=>{server.off("error",reject);resolve();});});
    timer=setTimeout(()=>dispose("CANCELLED"),input.timeoutMs);
    const authorization=new URL("/v1/commercial/login",registration.authorizationOrigin);
    authorization.search=new URLSearchParams({client_id:registration.clientId,redirect_uri:registration.redirectUri,
      code_challenge:createHash("sha256").update(verifier.toString("base64url")).digest("base64url"),
      code_challenge_method:"S256",state:state.toString("base64url")}).toString();
    // A browser launcher may never resolve. The callback deadline and cancel
    // handle must remain reachable independently of that external application.
    void input.openSystemBrowser(authorization.href).catch(() => dispose("FAILED"));
  }catch{dispose("FAILED");}
  return Object.freeze({result,cancel:()=>dispose("CANCELLED")});
}
