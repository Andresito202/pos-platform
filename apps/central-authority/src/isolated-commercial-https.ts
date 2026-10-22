import {createServer, type ServerOptions} from "node:https";
import type {IncomingMessage, ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {uuidV7, UuidSchema, PlatformSecurityEventCode} from "@pos-platform/contracts";
import {PostgresBrowserSessionHandoffWriter, PostgresPlatformSecurityEventRepository, type Pool, type BrowserSessionRequest} from "@pos-platform/database-postgres";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import {BusinessInitialMfaFlow} from "./business-initial-mfa-flow.js";
import {BusinessSessionAuthority} from "./business-session-authority.js";
import {DurableBrowserSessionStore} from "./durable-browser-session-store.js";
import {CommercialNativeClientCatalog} from "./commercial-native-client-catalog.js";
import {IsolatedBusinessAuthCoordinator} from "./isolated-business-auth-coordinator.js";
import {IsolatedBusinessCredentialPairIssuer} from "./isolated-business-credential-pair-issuer.js";
import {inspectCommercialTokenRequest} from "./commercial-token-http-contract.js";

type ObjectBody=Record<string,unknown>;
const exact=(o:ObjectBody,keys:readonly string[])=>Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length>0&&v.length<=max;
const opaque=(v:unknown,min:number,max:number):v is string=>typeof v==="string"&&new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(v);
const uuid=(v:unknown):v is string=>UuidSchema.safeParse(v).success;
class Rejection extends Error {constructor(readonly status:number){super("COMMERCIAL_REQUEST_REJECTED");}}
function send(res:ServerResponse,status:number,body:unknown,cookie?:string){
  const payload=JSON.stringify(body);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(payload),
    "cache-control":"no-store","pragma":"no-cache","x-content-type-options":"nosniff","referrer-policy":"no-referrer",
    "content-security-policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'","cross-origin-resource-policy":"same-origin",
    ...(cookie?{"set-cookie":cookie}:{}),...(status===429?{"retry-after":"60"}:{})});res.end(payload);
}
function strictHeaders(req:IncomingMessage){
  const seen=new Set<string>();
  for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i]!.toLowerCase();
    if(seen.has(name)||name.startsWith("x-forwarded-")||name==="forwarded")throw new Rejection(400);seen.add(name);
  }
  if(req.headers["transfer-encoding"]||req.headers["content-encoding"])throw new Rejection(400);
}
async function body(req:IncomingMessage,maxBytes:number):Promise<{object:ObjectBody;raw:string}>{
  if(req.headers["content-type"]!=="application/json")throw new Rejection(415);
  const length=req.headers["content-length"];
  if(typeof length!=="string"||!/^\d+$/.test(length))throw new Rejection(400);
  if(Number(length)>maxBytes)throw new Rejection(413);
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of req){const b=Buffer.from(chunk);bytes+=b.length;if(bytes>maxBytes)throw new Rejection(413);chunks.push(b);}
  let value:unknown;const raw=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
  try{value=JSON.parse(raw);}catch{throw new Rejection(400);}
  // JSON.parse otherwise accepts duplicate names, including escaped aliases.
  const stack:(Set<string>|null)[]=[];
  for(let i=0;i<raw.length;i++){
    if(raw[i]==="{"||raw[i]==="["){stack.push(raw[i]==="{"?new Set():null);if(stack.length>32)throw new Rejection(400);}
    else if(raw[i]==="}"||raw[i]==="]")stack.pop();
    else if(raw[i]==='"'){
      const start=i++;for(;i<raw.length;i++){if(raw[i]==="\\")i++;else if(raw[i]==='"')break;}
      let next=i+1;while(/\s/.test(raw[next]??"x"))next++;
      const frame=stack.at(-1);
      if(raw[next]===":"&&frame){const key=JSON.parse(raw.slice(start,i+1)) as string;if(frame.has(key))throw new Rejection(400);frame.add(key);}
    }
  }
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Rejection(400);
  return {object:value as ObjectBody,raw};
}
function assertion(value:unknown):value is AuthenticationResponseJSON{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as ObjectBody;
  if(!(exact(v,["id","rawId","type","clientExtensionResults","response"])||
      exact(v,["id","rawId","type","clientExtensionResults","response","authenticatorAttachment"])&&
      ["platform","cross-platform"].includes(v.authenticatorAttachment as string))||v.type!=="public-key"||
    !text(v.id,2048)||v.rawId!==v.id||!v.clientExtensionResults||typeof v.clientExtensionResults!=="object"||
    Array.isArray(v.clientExtensionResults)||Object.keys(v.clientExtensionResults).length!==0||
    !v.response||typeof v.response!=="object"||Array.isArray(v.response))return false;
  const r=v.response as ObjectBody;
  return (exact(r,["clientDataJSON","authenticatorData","signature"])||exact(r,["clientDataJSON","authenticatorData","signature","userHandle"]))&&
    [r.clientDataJSON,r.authenticatorData,r.signature].every(s=>text(s,8192))&&
    (r.userHandle===undefined||r.userHandle===null||text(r.userHandle,2048));
}

/** Real HTTPS laboratory transport. There is intentionally no production flag,
 * public bind, forwarded-header trust, or route mounting in main.ts. Existing
 * isolated code/JWT issuers remain restricted to the temporary database. */
export async function createIsolatedCommercialHttpsServer(input:{
  pool:Pool; tls:Pick<ServerOptions,"key"|"cert">; origin:string;
  mfa:BusinessInitialMfaFlow; authority:BusinessSessionAuthority; handoffs:PostgresBrowserSessionHandoffWriter;
  browser:DurableBrowserSessionStore; clients:CommercialNativeClientCatalog;
  coordinator:IsolatedBusinessAuthCoordinator; pair:IsolatedBusinessCredentialPairIssuer;
  policy:{mode:"ISOLATED_VALIDATION";maximumBodyBytes:number;requestsPerMinute:number};
}){
  const {pool,mfa,authority,handoffs,browser,clients,coordinator,pair,policy}=input;
  const url=new URL(pool.options.connectionString??"invalid:");
  if(!policy||policy.mode!=="ISOLATED_VALIDATION"||![policy.maximumBodyBytes,policy.requestsPerMinute].every(n=>Number.isSafeInteger(n)&&n>0)||
    !["localhost","127.0.0.1"].includes(url.hostname)||url.port!=="55433"||
    !(mfa instanceof BusinessInitialMfaFlow)||!(authority instanceof BusinessSessionAuthority)||!(handoffs instanceof PostgresBrowserSessionHandoffWriter)||
    !(browser instanceof DurableBrowserSessionStore)||!(clients instanceof CommercialNativeClientCatalog)||
    !(coordinator instanceof IsolatedBusinessAuthCoordinator)||!(pair instanceof IsolatedBusinessCredentialPairIssuer)||!browser.acceptsOrigin(input.origin))throw Error("COMMERCIAL_HTTPS_ISOLATED_COMPOSITION_REQUIRED");
  const database=await pool.query<{ok:boolean}>("SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS ok");
  if(database.rows[0]?.ok!==true)throw Error("COMMERCIAL_HTTPS_TEMPORARY_DATABASE_REQUIRED");
  const origin=new URL(input.origin);
  const audit=new PostgresPlatformSecurityEventRepository(pool);
  const buckets=new Map<string,{start:number;count:number}>();
  async function rejectionAudit(limited:boolean){
    const at=await pool.query<{at:Date}>("SELECT clock_timestamp() AS at");
    await audit.append({user_id:null,session_id:null,tenant_id:null,
      event_code:limited?PlatformSecurityEventCode.ABUSE_RATE_LIMITED:PlatformSecurityEventCode.CREDENTIAL_REJECTED,
      result:limited?"THROTTLED":"REJECTED",reason_code:"ISOLATED_HTTPS_REJECTED",correlation_id:uuidV7(),occurred_at:at.rows[0]!.at.toISOString()});
  }
  const server=createServer({...input.tls,minVersion:"TLSv1.2",maxHeaderSize:16*1024},(req,res)=>{
    void (async()=>{
      try{
        if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted)throw new Rejection(400);
        // Address and single server-wide budget cannot be replaced by a bearer,
        // account name, path, spoofed proxy header or supplied correlation ID.
        const address=req.socket.remoteAddress??"unknown",now=Date.now();
        let bucket=buckets.get(address);
        if(!bucket||now-bucket.start>=60_000){bucket={start:now,count:0};buckets.set(address,bucket);}
        if(++bucket.count>policy.requestsPerMinute)throw new Rejection(429);
        strictHeaders(req);
        if(req.headers.host!==origin.host||req.method!=="POST"||!req.url||!/^\/v1\/commercial\/(login|authorize|token|browser\/(session|rotate|logout))$/.test(req.url))throw new Rejection(400);
        const tokenRoute=req.url==="/v1/commercial/token";
        if(tokenRoute){
          // Native back-channel: browser origins and ambient cookies are forbidden.
          if(req.headers.origin||req.headers.cookie||req.headers["sec-fetch-site"])throw new Rejection(403);
        }else if(req.headers.origin!==input.origin||req.headers["sec-fetch-site"]!=="same-origin")throw new Rejection(403);
        const {object:o,raw}=await body(req,policy.maximumBodyBytes);
        const sessionRequest:BrowserSessionRequest={method:"POST",origin:req.headers.origin??null,
          fetchSite:typeof req.headers["sec-fetch-site"]==="string"?req.headers["sec-fetch-site"]:null,
          cookie:req.headers.cookie??null,csrfToken:typeof req.headers["x-csrf-token"]==="string"?req.headers["x-csrf-token"]:null};
        if(req.url==="/v1/commercial/login"){
          // Login CSRF is prevented by exact Origin + same-origin Fetch Metadata
          // and strict non-simple JSON; existing cookies cannot fix a new login.
          if(req.headers.cookie)throw new Rejection(403);
          if(o.phase==="begin"&&exact(o,["phase","email","password","factorId"])&&text(o.email,320)&&text(o.password,1024)&&uuid(o.factorId)){
            const challenge=await mfa.begin({email:o.email,password:o.password,factorId:o.factorId,correlationId:uuidV7()});
            if(!challenge)throw new Rejection(401);send(res,200,challenge);return;
          }
          if(o.phase!=="complete"||!exact(o,["phase","email","password","challenge","response","tenantId","membershipId"])||
            !text(o.email,320)||!text(o.password,1024)||!text(o.challenge,1024)||!assertion(o.response)||!uuid(o.tenantId)||!uuid(o.membershipId))throw new Rejection(400);
          const receipt=await mfa.complete({email:o.email,password:o.password,challenge:o.challenge,response:o.response});
          if(!receipt)throw new Rejection(401);
          const handoff=await authority.createBrowserHandoff({mfaReceipt:receipt,selection:{tenantId:o.tenantId,membershipId:o.membershipId}},handoffs);
          if(!handoff)throw new Rejection(403);
          const issued=await browser.establishFromHandoff(handoff);
          if(!issued)throw new Rejection(401);
          send(res,200,{csrfToken:issued.csrfToken},issued.setCookie);return;
        }
        if(tokenRoute){
          const registration=clients.requireExact(o.client_id,o.redirect_uri);
          if(!registration)throw new Rejection(403);
          const checked=inspectCommercialTokenRequest({method:"POST",contentType:"application/json",body:raw,registration});
          if(checked.status!==200)throw new Rejection(checked.status);
          const r=checked.request,credentials=await coordinator.exchangeCredentials(registration,{code:r.code,verifier:r.code_verifier,state:r.state},pair);
          if(!credentials)throw new Rejection(401);send(res,200,credentials);return;
        }
        if(req.url==="/v1/commercial/authorize"){
          if(!exact(o,["clientId","redirectUri","codeChallenge","state","deviceProof"])||!opaque(o.codeChallenge,43,43)||!opaque(o.state,32,256))throw new Rejection(400);
          const registration=clients.requireExact(o.clientId,o.redirectUri);
          if(!registration||registration.authorizationOrigin!==input.origin)throw new Rejection(403);
          if(!o.deviceProof||typeof o.deviceProof!=="object"||Array.isArray(o.deviceProof))throw new Rejection(400);
          const p=o.deviceProof as ObjectBody;
          if(!exact(p,["authorization","requestId","correlationId","body"])||!text(p.authorization,8192)||!uuid(p.requestId)||!uuid(p.correlationId)||!text(p.body,16384))throw new Rejection(400);
          // Delegated proof retains the canonical SSA proof path/signature. It
          // does NOT purport to sign this outer /authorize HTTP envelope.
          const code=await coordinator.authorizeBrowser(browser,sessionRequest,{authorization:p.authorization,requestId:p.requestId,correlationId:p.correlationId,body:p.body},registration,{codeChallenge:o.codeChallenge,state:o.state});
          if(!code)throw new Rejection(401);send(res,200,{code,state:o.state,redirectUri:registration.redirectUri});return;
        }
        if(!exact(o,[]))throw new Rejection(400);
        if(req.url.endsWith("/rotate")){
          const issued=await browser.rotate(sessionRequest);if(!issued)throw new Rejection(401);
          send(res,200,{csrfToken:issued.csrfToken},issued.setCookie);return;
        }
        if(req.url.endsWith("/logout")){
          if(!await browser.logout(sessionRequest))throw new Rejection(401);
          send(res,200,{status:"SIGNED_OUT"},browser.clearCookie());return;
        }
        const current=await browser.inspect(sessionRequest);
        if(!current)throw new Rejection(401);send(res,200,current);
      }catch(error){
        const status=error instanceof Rejection?error.status:503;
        try{await rejectionAudit(status===429);send(res,status,{error:status===503?"temporarily_unavailable":"request_rejected"});}
        catch{send(res,503,{error:"temporarily_unavailable"});}
      }
    })();
  });
  server.requestTimeout=10_000;server.headersTimeout=5_000;server.keepAliveTimeout=1_000;
  // No caller-provided host or port; production activation requires a separate,
  // approved composition. Tests connect using a trusted lab certificate and SNI.
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
  return server;
}
