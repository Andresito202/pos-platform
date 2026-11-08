import {createServer, type ServerOptions} from "node:https";
import type {IncomingMessage, ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {uuidV7, UuidSchema, UuidV7Schema, PlatformSecurityEventCode,CommercialHttpV2,validateCommercialHttpsOrigin, SignedAuthorizationTrustCandidateSchema, type SignedAuthorizationTrustCandidate} from "@pos-platform/contracts";
import {PostgresBrowserSessionHandoffWriter, PostgresPlatformSecurityEventRepository, type Pool, type BrowserSessionRequest} from "@pos-platform/database-postgres";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import {BusinessInitialMfaFlow} from "./business-initial-mfa-flow.js";
import {BusinessSessionAuthority} from "./business-session-authority.js";
import {DurableBrowserSessionStore} from "./durable-browser-session-store.js";
import {CommercialNativeClientCatalog} from "./commercial-native-client-catalog.js";
import {IsolatedBusinessAuthCoordinator} from "./isolated-business-auth-coordinator.js";
import {IsolatedBusinessCredentialPairIssuer} from "./isolated-business-credential-pair-issuer.js";
import {inspectCommercialTokenRequest} from "./commercial-token-http-contract.js";
import {sendCommercialBrowserEntry, type CommercialBrowserEntryConfiguration} from "./commercial-browser-entry.js";
import {IsolatedNativeBusinessRequests,type NativeRequestParameters} from "./isolated-native-business-requests.js";
import {IsolatedBusinessAccessTokenCodec,CommercialBusinessAccessAuthority} from "./isolated-business-access-token-codec.js";
import {IsolatedAuthorizationSnapshotIssuer} from "./isolated-authorization-snapshot-issuer.js";
import {assertCommercialDeployment,type PostgresCommercialDeploymentContext} from "@pos-platform/database-postgres";
import {FixedWindowRateLimiter} from "./fixed-window-rate-limiter.js";
import {MerchantBusinessDestinationOperations} from "./merchant-destination-business-operations.js";

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
  let value:unknown,raw:string;
  try{raw=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));value=JSON.parse(raw);}catch{throw new Rejection(400);}
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
// One strict parser/header/assertion boundary for both approved browser scopes.
export {body as readCommercialJsonBody,strictHeaders as inspectCommercialHeaders,assertion as validateCommercialAssertion,send as sendCommercialJson};

/** Shared closed HTTPS routes. Deployment requires the verified database
 * capability; the isolated factory below retains its temporary-only boundary. */
export async function prepareCommercialHttpHandler(input:{
  pool:Pool; tls:Pick<ServerOptions,"key"|"cert">; origin:string;
  mfa:BusinessInitialMfaFlow; authority:BusinessSessionAuthority; handoffs:PostgresBrowserSessionHandoffWriter;
  browser:DurableBrowserSessionStore; clients:CommercialNativeClientCatalog;
  coordinator:IsolatedBusinessAuthCoordinator; pair:IsolatedBusinessCredentialPairIssuer;
  policy:{mode:"ISOLATED_VALIDATION"|"DEPLOYMENT";maximumBodyBytes:number;requestsPerMinute:number;maximumLoginAttempts?:number;maximumBuckets?:number};
  deploymentContext?:PostgresCommercialDeploymentContext;
  browserEntry?:CommercialBrowserEntryConfiguration;
  nativeValidation?:{requests:IsolatedNativeBusinessRequests;codec:IsolatedBusinessAccessTokenCodec|CommercialBusinessAccessAuthority;
    signing:Parameters<IsolatedBusinessAuthCoordinator["issueSessionAssertion"]>[3]};
  authorizationIssuer?:IsolatedAuthorizationSnapshotIssuer;
  authorizationTrustCandidate?:SignedAuthorizationTrustCandidate;
  merchantDestinations?:MerchantBusinessDestinationOperations;
}){
  const {pool,mfa,authority,handoffs,browser,clients,coordinator,pair,policy}=input;
  if(input.deploymentContext){
    assertCommercialDeployment(pool,input.deploymentContext);validateCommercialHttpsOrigin(input.origin);
    if(!input.nativeValidation||!(input.nativeValidation.codec instanceof CommercialBusinessAccessAuthority)||!input.authorizationIssuer||!input.browserEntry||
      input.authorizationTrustCandidate||!Number.isSafeInteger(policy.maximumLoginAttempts)||policy.maximumLoginAttempts!<=0||
      !Number.isSafeInteger(policy.maximumBuckets)||policy.maximumBuckets!<=0)throw Error("COMMERCIAL_DEPLOYMENT_COMPOSITION_REQUIRED");
  }
  const url=new URL(pool.options.connectionString??"invalid:");
  if(!policy||policy.mode!==(input.deploymentContext?"DEPLOYMENT":"ISOLATED_VALIDATION")||![policy.maximumBodyBytes,policy.requestsPerMinute].every(n=>Number.isSafeInteger(n)&&n>0)||
    (!input.deploymentContext&&(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!=="55433"))||
    !(mfa instanceof BusinessInitialMfaFlow)||!(authority instanceof BusinessSessionAuthority)||!(handoffs instanceof PostgresBrowserSessionHandoffWriter)||
    !(browser instanceof DurableBrowserSessionStore)||!(clients instanceof CommercialNativeClientCatalog)||
    !(coordinator instanceof IsolatedBusinessAuthCoordinator)||!(pair instanceof IsolatedBusinessCredentialPairIssuer)||!browser.acceptsOrigin(input.origin))throw Error("COMMERCIAL_HTTPS_ISOLATED_COMPOSITION_REQUIRED");
  if(!input.deploymentContext){const database=await pool.query<{ok:boolean}>("SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS ok");
  if(database.rows[0]?.ok!==true)throw Error("COMMERCIAL_HTTPS_TEMPORARY_DATABASE_REQUIRED");
  }
  if(input.merchantDestinations && (!input.deploymentContext || !(input.merchantDestinations instanceof MerchantBusinessDestinationOperations)))
    throw Error("QR001_PRODUCTION_ADMIN_COMPOSITION_REQUIRED");
  const origin=new URL(input.origin);
  // Public, root-signed artifact only. Restricted to this existing temporary-DB
  // server; neither production main nor the SSA distribution route mounts it.
  const authorizationTrust=input.authorizationTrustCandidate
    ? SignedAuthorizationTrustCandidateSchema.parse(input.authorizationTrustCandidate) : undefined;
  if(authorizationTrust && authorizationTrust.claims.issuer!==input.origin)throw Error("SAS_TRUST_ISSUER_MISMATCH");
  const native=input.nativeValidation;
  if(native&&(!(native.requests instanceof IsolatedNativeBusinessRequests)||!(native.codec instanceof IsolatedBusinessAccessTokenCodec)&&!(native.codec instanceof CommercialBusinessAccessAuthority)))throw Error("NATIVE_HTTPS_VALIDATION_OWNER_REQUIRED");
  if(input.browserEntry && (input.browserEntry.rpId!==origin.hostname ||
    ![input.browserEntry.factorId,input.browserEntry.tenantId,input.browserEntry.membershipId].every(uuid) ||
    !Buffer.isBuffer(input.browserEntry.logoPng) || input.browserEntry.logoPng.length>1024*1024 ||
    input.browserEntry.logoPng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"))throw Error("COMMERCIAL_BROWSER_CONFIGURATION_REQUIRED");
  const audit=new PostgresPlatformSecurityEventRepository(pool);
  const limiter=new FixedWindowRateLimiter(policy.requestsPerMinute,policy.maximumBuckets??10000);
  async function rejectionAudit(limited:boolean){
    const at=await pool.query<{at:Date}>("SELECT clock_timestamp() AS at");
    await audit.append({user_id:null,session_id:null,tenant_id:null,
      event_code:limited?PlatformSecurityEventCode.ABUSE_RATE_LIMITED:PlatformSecurityEventCode.CREDENTIAL_REJECTED,
      result:limited?"THROTTLED":"REJECTED",reason_code:"ISOLATED_HTTPS_REJECTED",correlation_id:uuidV7(),occurred_at:at.rows[0]!.at.toISOString()});
  }
  const accessHeader=input.deploymentContext?CommercialHttpV2.accessHeader:"x-isolated-business-access";
  const handler=(req:IncomingMessage,res:ServerResponse)=>{
    void (async()=>{
      try{
        if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted)throw new Rejection(400);
        // Address and single server-wide budget cannot be replaced by a bearer,
        // account name, path, spoofed proxy header or supplied correlation ID.
        const address=req.socket.remoteAddress??"unknown";
        if(!limiter.allow(address))throw new Rejection(429);
        strictHeaders(req);
        if(req.method==="GET" && req.url==="/v1/isolated/authorization-trust" && authorizationTrust){
          if(req.headers.host!==origin.host || Number(req.headers["content-length"]??0)!==0 ||
            (req.headers.origin && req.headers.origin!==input.origin))throw new Rejection(400);
          send(res,200,authorizationTrust);return;
        }
        if(req.method==="GET" && input.browserEntry && req.url){
          const entry=new URL(req.url,input.origin),params=entry.searchParams;
          if(native){
            if(req.headers.host!==origin.host||entry.origin!==input.origin||entry.pathname!=="/v1/commercial/login"||entry.hash||
              [...params.keys()].length!==1||params.getAll("request").length!==1||
              (req.headers.origin&&req.headers.origin!==input.origin)||Number(req.headers["content-length"]??0)!==0)throw new Rejection(400);
            const token=params.get("request")!,destination=await native.requests.inspect(token);
            const registration=destination?clients.requireExact(destination.client_id,destination.redirect_uri):null;
            if(!destination||!registration||registration.authorizationOrigin!==input.origin)throw new Rejection(401);
            sendCommercialBrowserEntry(res,input.browserEntry,{request:token,tenantName:destination.tenant_name,companyName:destination.company_name,
              deviceId:destination.device_id,installationId:destination.installation_id},Boolean(input.merchantDestinations));return;
          }
          if(input.deploymentContext)throw new Rejection(400);
          const names=["client_id","redirect_uri","code_challenge","code_challenge_method","state"];
          const registration=clients.requireExact(params.get("client_id"),params.get("redirect_uri"));
          if(req.headers.host!==origin.host || entry.origin!==input.origin || entry.pathname!=="/v1/commercial/login" ||
            entry.hash || [...params.keys()].length!==names.length || names.some(name=>params.getAll(name).length!==1) ||
            !registration || registration.authorizationOrigin!==input.origin || params.get("code_challenge_method")!=="S256" ||
            !opaque(params.get("code_challenge"),43,43) || !opaque(params.get("state"),32,256) ||
            (req.headers.origin && req.headers.origin!==input.origin) || Number(req.headers["content-length"]??0)!==0)throw new Rejection(400);
          sendCommercialBrowserEntry(res,input.browserEntry);return;
        }
        const qrAction=req.url?.match(/^\/v1\/commercial\/merchant-destinations\/(list|upload|asset|create|publish|revoke)$/)?.[1] as
          "list"|"upload"|"asset"|"create"|"publish"|"revoke"|undefined;
        if(req.headers.host!==origin.host||req.method!=="POST"||!req.url||
          (!qrAction && !/^\/v1\/commercial\/(login|authorize|token|browser\/(session|rotate|logout))$/.test(req.url)&&
            !(native&&["/v1/commercial/native-request-challenges","/v1/commercial/native-requests","/v1/business-session/assertions",
              ...(native.codec instanceof CommercialBusinessAccessAuthority?["/v1/commercial/refresh","/v1/commercial/revoke"]:[]),
              ...(input.authorizationIssuer?["/v1/business-session/authorization"]:[])].includes(req.url))))throw new Rejection(400);
        const tokenRoute=req.url==="/v1/commercial/token";
        const nativeRoute=tokenRoute||req.url==="/v1/commercial/refresh"||req.url==="/v1/commercial/revoke"||req.url.includes("/native-request")||req.url.startsWith("/v1/business-session/");
        if(nativeRoute){
          // Native back-channel: browser origins and ambient cookies are forbidden.
          if(req.headers.origin||req.headers.cookie||req.headers["sec-fetch-site"])throw new Rejection(403);
        }else if(req.headers.origin!==input.origin||req.headers["sec-fetch-site"]!=="same-origin")throw new Rejection(403);
        const {object:o,raw}=await body(req,qrAction==="upload"?Math.max(policy.maximumBodyBytes,1_420_000):policy.maximumBodyBytes);
        if(qrAction){
          if(!input.merchantDestinations)throw new Rejection(404);
          const session=await browser.inspect({method:"POST",origin:req.headers.origin??null,
            fetchSite:typeof req.headers["sec-fetch-site"]==="string"?req.headers["sec-fetch-site"]:null,
            cookie:req.headers.cookie??null,csrfToken:typeof req.headers["x-csrf-token"]==="string"?req.headers["x-csrf-token"]:null});
          if(!session)throw new Rejection(401);
          try{
            const result=await input.merchantDestinations.dispatch({session,action:qrAction,payload:o});
            send(res,200,{result});return;
          }catch(error){
            if(error instanceof Error&&error.message==="QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY")throw new Rejection(403);
            if(error instanceof Error&&(/INVALID_REQUEST|INVALID_QR_BASE64|INVALID_OFFICIAL_QR_PNG|INVALID_AUTHENTICATED_SCOPE/.test(error.message)))throw new Rejection(400);
            throw error;
          }
        }
        const proof=()=>{
          if(!text(req.headers.authorization,8192)||!uuid(req.headers["x-request-id"])||!UuidV7Schema.safeParse(req.headers["x-correlation-id"]).success)throw new Rejection(400);
          const correlationId=req.headers["x-correlation-id"] as string;
          return {authorization:req.headers.authorization,requestId:req.headers["x-request-id"],correlationId,body:raw};
        };
        if(native&&req.url==="/v1/commercial/native-request-challenges"){
          const registration=clients.requireExact(o.client_id,o.redirect_uri);
          if(!registration||registration.authorizationOrigin!==input.origin)throw new Rejection(403);
          const challenge=await native.requests.challenge(o as unknown as NativeRequestParameters,registration);
          if(!challenge)throw new Rejection(429);send(res,200,challenge);return;
        }
        if(native&&req.url==="/v1/commercial/native-requests"){
          const registration=clients.requireExact(o.client_id,o.redirect_uri);
          if(!registration||registration.authorizationOrigin!==input.origin)throw new Rejection(403);
          const registered=await native.requests.register(proof(),registration);
          if(!registered)throw new Rejection(401);send(res,200,registered);return;
        }
        if(native&&req.url==="/v1/business-session/assertions"){
          const access=req.headers[accessHeader];
          if(!exact(o,["session_id"])||!uuid(o.session_id)||!text(access,8192))throw new Rejection(400);
          const assertion=await coordinator.issueSessionAssertion(access,proof(),native.codec,native.signing);
          if(!assertion)throw new Rejection(401);send(res,200,assertion);return;
        }
        if(native?.codec instanceof CommercialBusinessAccessAuthority&&req.url==="/v1/commercial/refresh"){
          const rotated=await native.codec.refresh(o.refresh_token as string,proof());
          if(!rotated||rotated.status!=="ROTATED")throw new Rejection(401);send(res,200,rotated);return;
        }
        if(native?.codec instanceof CommercialBusinessAccessAuthority&&req.url==="/v1/commercial/revoke"){
          if(!await native.codec.revoke(o.refresh_token as string,proof()))throw new Rejection(401);
          send(res,200,{status:"SIGNED_OUT"});return;
        }
        if(native&&input.authorizationIssuer&&req.url==="/v1/business-session/authorization"){
          const access=req.headers[accessHeader];
          if(!exact(o,["session_id"])||!uuid(o.session_id)||!text(access,8192))throw new Rejection(400);
          const signed=await input.authorizationIssuer.issue(access,proof());
          if(!signed)throw new Rejection(401);send(res,200,signed);return;
        }
        const sessionRequest:BrowserSessionRequest={method:"POST",origin:req.headers.origin??null,
          fetchSite:typeof req.headers["sec-fetch-site"]==="string"?req.headers["sec-fetch-site"]:null,
          cookie:req.headers.cookie??null,csrfToken:typeof req.headers["x-csrf-token"]==="string"?req.headers["x-csrf-token"]:null};
        if(req.url==="/v1/commercial/login"){
          if(input.deploymentContext){const selector=req.headers["x-commercial-native-request"];
            if(!text(selector,43)||!await native!.requests.consumeLoginBudget(selector,policy.maximumLoginAttempts!))throw new Rejection(429);}
          // Login CSRF is prevented by exact Origin + same-origin Fetch Metadata
          // and strict non-simple JSON. An ambient/expired cookie is NEVER
          // authentication evidence: a fresh password and assertion are required.
          // Clear it on begin so lost CSRF state cannot strand a browser after
          // restart. Successful completion always creates a new random cookie.
          if(o.phase==="begin"&&exact(o,["phase","email","password","factorId"])&&text(o.email,320)&&text(o.password,1024)&&uuid(o.factorId)){
            const challenge=await mfa.begin({email:o.email,password:o.password,factorId:o.factorId,correlationId:uuidV7()});
            if(!challenge)throw new Rejection(401);send(res,200,challenge,req.headers.cookie?browser.clearCookie():undefined);return;
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
          const r=checked.request,request={code:r.code,verifier:r.code_verifier,state:r.state};
          const credentials=native?await coordinator.exchangeNativeCredentials(registration,request,pair,proof(),native.requests.policy.maximumReauthenticationAgeMs):await coordinator.exchangeCredentials(registration,request,pair);
          if(!credentials)throw new Rejection(401);send(res,200,credentials);return;
        }
        if(req.url==="/v1/commercial/authorize"){
          if(native){
            if(!exact(o,["request","confirmed"])||!opaque(o.request,43,43)||o.confirmed!==true)throw new Rejection(400);
            const selected=await native.requests.inspect(o.request),registration=selected?clients.requireExact(selected.client_id,selected.redirect_uri):null;
            if(!registration)throw new Rejection(401);
            const grant=await coordinator.authorizeNativeBrowser(browser,sessionRequest,native.requests,o.request,true,registration);
            if(!grant)throw new Rejection(401);send(res,200,grant);return;
          }
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
  };
  return handler;
}
export type CommercialHttpHandlerInput=Parameters<typeof prepareCommercialHttpHandler>[0];
/** Original isolated entry remains explicitly isolated; production main uses
 * the shared handler on its own already-verified HTTPS listener. */
export async function createIsolatedCommercialHttpsServer(input:Omit<CommercialHttpHandlerInput,"deploymentContext">){
  if(input.policy.mode!=="ISOLATED_VALIDATION")throw Error("COMMERCIAL_HTTPS_ISOLATED_POLICY_REQUIRED");
  const server=createServer({...input.tls,minVersion:"TLSv1.2",maxHeaderSize:16*1024},await prepareCommercialHttpHandler(input));
  server.requestTimeout=10_000;server.headersTimeout=5_000;server.keepAliveTimeout=1_000;
  // No caller-provided host or port; production activation requires a separate,
  // approved composition. Tests connect using a trusted lab certificate and SNI.
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
  return server;
}
