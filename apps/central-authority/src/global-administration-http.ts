import type {IncomingMessage,ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {createHash,randomBytes} from "node:crypto";
import {CanonicalPermission,CentralAdministrationOperation,UuidSchema,uuidV7} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {GlobalAdministrationSessions,type GlobalAdministrationPolicy} from "./global-administration-sessions.js";
import {LicenseOfferDrafts} from "./license-offer-drafts.js";
import {SubscriptionQuotes,type SubscriptionQuotePolicy} from "./subscription-quotes.js";
import {FixedWindowRateLimiter} from "./fixed-window-rate-limiter.js";
import {SubscriptionLicenseContracts,type FulfillmentPolicyReferences} from "./subscription-license-contracts.js";
import {readCommercialJsonBody,inspectCommercialHeaders,validateCommercialAssertion,sendCommercialJson} from "./isolated-commercial-https.js";
import type {LicenseCapacityAuthority} from "./license-capacity-authority.js";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const exact=(o:Record<string,unknown>,keys:string[])=>Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length>0&&v.length<=max;
const FLOW="__Host-camacho_platform_flow";
export interface GlobalAdministrationHttpLimits{
  maximumBodyBytes:number;maximumPendingFlows:number;requestsPerWindow:number;maximumBuckets:number;requestWindowMs:number;
  loginWindowMs:number;maximumLoginPerAddress:number;maximumLoginPerAccount:number;
}

/** The same Central HTTPS listener mounts this closed control-plane handler.
 * GLOBAL cookies cannot authorize BUSINESS, and request IDs never authenticate. */
export function createGlobalAdministrationHandler(input:{pool:Pool;policy:GlobalAdministrationPolicy;limits:GlobalAdministrationHttpLimits;
  quotePolicy?:SubscriptionQuotePolicy;fulfillmentPolicies?:readonly FulfillmentPolicyReferences[];licenseAuthority?:LicenseCapacityAuthority;preproductionCatalogEnabled?:boolean}){
  const {policy,limits}=input;
  if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0))throw Error("GLOBAL_HTTP_EXPLICIT_LIMITS_REQUIRED");
  const sessions=new GlobalAdministrationSessions(input.pool,policy),offers=new LicenseOfferDrafts(input.pool,policy.maximumReauthenticationAgeMs,
    {origin:policy.origin,lockTimeoutMs:policy.lockTimeoutMs,statementTimeoutMs:policy.statementTimeoutMs});
  const quotes=new SubscriptionQuotes(input.pool,input.quotePolicy??null,{reauthenticationMs:policy.maximumReauthenticationAgeMs,
    lockTimeoutMs:policy.lockTimeoutMs,statementTimeoutMs:policy.statementTimeoutMs});
  const limiter=new FixedWindowRateLimiter(limits.requestsPerWindow,limits.maximumBuckets,limits.requestWindowMs);
  const licenses=new SubscriptionLicenseContracts(input.pool,input.fulfillmentPolicies??null,{reauthenticationMs:policy.maximumReauthenticationAgeMs,
    lockTimeoutMs:policy.lockTimeoutMs,statementTimeoutMs:policy.statementTimeoutMs});
  const pending=new Map<string,{email:string;challenge:string;csrf:string;expiresAt:number}>();
  let starting=0;
  const flowCookie=(value:string,age:number)=>`${FLOW}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
  return async(req:IncomingMessage,res:ServerResponse)=>{
    try{
      if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(policy.origin).host||
        req.method!=="POST"||req.headers.origin!==policy.origin||req.headers["sec-fetch-site"]!=="same-origin"){
        sendCommercialJson(res,403,{code:"GLOBAL_REQUEST_REJECTED"});return;}
      inspectCommercialHeaders(req);
      if(!limiter.allow(req.socket.remoteAddress??"unknown")){sendCommercialJson(res,429,{code:"GLOBAL_RATE_LIMITED"});return;}
      for(const [key,value] of pending)if(value.expiresAt<=Date.now())pending.delete(key);
      const {object:b}=await readCommercialJsonBody(req,limits.maximumBodyBytes);
      const path=req.url;
      if(path==="/v1/platform/login/begin"||path==="/v1/platform/login/complete"){
        const begin=path.endsWith("/begin");
        if(!(begin?(exact(b,["email","password"])||exact(b,["email","password","factorId"])):exact(b,["email","password","challenge","response"]))||!text(b.email,320)||!text(b.password,1024)||
          (begin?b.factorId!==undefined&&!UuidSchema.safeParse(b.factorId).success:!text(b.challenge,128)||!validateCommercialAssertion(b.response))){sendCommercialJson(res,400,{code:"GLOBAL_REQUEST_REJECTED"});return;}
        if(!await sessions.spendLoginBudget(req.socket.remoteAddress??"unknown",b.email,{windowMs:limits.loginWindowMs,
          maximumPerAddress:limits.maximumLoginPerAddress,maximumPerAccount:limits.maximumLoginPerAccount})){
          sendCommercialJson(res,429,{code:"GLOBAL_RATE_LIMITED"});return;}
        if(begin){
          if(pending.size+starting>=limits.maximumPendingFlows){sendCommercialJson(res,429,{code:"GLOBAL_RATE_LIMITED"});return;}
          starting++;
          let challenge;try{challenge=await sessions.begin({email:b.email,password:b.password,...(b.factorId===undefined?{}:{factorId:String(b.factorId)}),correlationId:uuidV7()});}
          finally{starting--;}
          if(!challenge){sendCommercialJson(res,401,{code:"GLOBAL_AUTHENTICATION_REJECTED"});return;}
          const flow=randomBytes(32).toString("base64url"),csrf=randomBytes(32).toString("base64url");
          pending.set(hash(flow),{email:b.email.trim().toLowerCase(),challenge:challenge.challenge,csrf:hash(csrf),expiresAt:Date.now()+policy.challengeLifetimeMs});
          sendCommercialJson(res,200,{...challenge,csrfToken:csrf},flowCookie(flow,Math.floor(policy.challengeLifetimeMs/1000)));return;
        }
        const values=(req.headers.cookie??"").split(";").map(s=>s.trim()).filter(s=>s.startsWith(FLOW+"="));
        const token=values.length===1?values[0]!.slice(FLOW.length+1):"",key=hash(token),flow=pending.get(key);pending.delete(key);
        const csrf=req.headers["x-csrf-token"];
        if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!flow||flow.expiresAt<=Date.now()||flow.email!==b.email.trim().toLowerCase()||flow.challenge!==b.challenge||
          typeof csrf!=="string"||hash(csrf)!==flow.csrf){sendCommercialJson(res,401,{code:"GLOBAL_AUTHENTICATION_REJECTED"},flowCookie("",0));return;}
        const result=await sessions.complete({email:b.email,password:b.password,challenge:String(b.challenge),response:b.response as Parameters<GlobalAdministrationSessions["complete"]>[0]["response"]},req.headers.cookie??null);
        if(!result){sendCommercialJson(res,401,{code:"GLOBAL_AUTHENTICATION_REJECTED"},flowCookie("",0));return;}
        res.setHeader("set-cookie",[result.setCookie,flowCookie("",0)]);
        sendCommercialJson(res,200,{authenticated:true,scope:"GLOBAL",csrfToken:result.csrfToken});return;
      }
      const request={method:"POST",origin:policy.origin,fetchSite:"same-origin",cookie:req.headers.cookie??null,
        csrfToken:typeof req.headers["x-csrf-token"]==="string"?req.headers["x-csrf-token"]:null};
      if(path==="/v1/platform/logout"){
        if(!exact(b,[])){sendCommercialJson(res,400,{code:"GLOBAL_REQUEST_REJECTED"});return;}
        const closed=await sessions.close(request);sendCommercialJson(res,closed?200:401,{closed:closed!==null},sessions.clearCookie());return;
      }
      const allowed=["/v1/platform/session","/v1/platform/license-offers/list","/v1/platform/license-offers/catalog","/v1/platform/license-offers/initialize-preproduction","/v1/platform/license-offers/save","/v1/platform/license-offers/publish","/v1/platform/quotes/issue","/v1/platform/licenses/issue","/v1/platform/licenses/allocate","/v1/platform/licenses/revoke-activation"];
      if(!allowed.includes(path??"")){sendCommercialJson(res,404,{code:"GLOBAL_NOT_FOUND"});return;}
      const session=await sessions.authorize(request,path==="/v1/platform/licenses/revoke-activation"?CentralAdministrationOperation.LICENSE_REVOKE:
        path?.startsWith("/v1/platform/licenses/")?CentralAdministrationOperation.LICENSE_ISSUE:CanonicalPermission.LICENSE_PLAN_MANAGE);
      if(!session){sendCommercialJson(res,401,{code:"GLOBAL_AUTHORIZATION_REJECTED"});return;}
      if(path==="/v1/platform/session"&&exact(b,[])){sendCommercialJson(res,200,{authenticated:true,scope:"GLOBAL",permissions:[CanonicalPermission.LICENSE_PLAN_MANAGE]});return;}
      if(path==="/v1/platform/license-offers/list"&&exact(b,[])){sendCommercialJson(res,200,{offers:await offers.published()});return;}
      if(path==="/v1/platform/license-offers/catalog"&&exact(b,[])){sendCommercialJson(res,200,{offers:await offers.administrativeCatalog(session)});return;}
      if(path==="/v1/platform/license-offers/initialize-preproduction"&&exact(b,[])){
        if(input.preproductionCatalogEnabled!==true){sendCommercialJson(res,403,{code:"PREPRODUCTION_CATALOG_NOT_AUTHORIZED"});return;}
        sendCommercialJson(res,200,await offers.initializePreproduction(session));return;
      }
      if(path==="/v1/platform/license-offers/save"&&exact(b,["offer","expectedVersion","correlationId"])){
        sendCommercialJson(res,200,await offers.save(session,b.offer,Number(b.expectedVersion),String(b.correlationId)));return;}
      if(path==="/v1/platform/license-offers/publish"&&exact(b,["planId","expectedVersion","correlationId"])){
        sendCommercialJson(res,200,await offers.publish(session,String(b.planId),Number(b.expectedVersion),String(b.correlationId)));return;}
      if(path==="/v1/platform/quotes/issue"){sendCommercialJson(res,200,await quotes.issue(session,b));return;}
      if(path==="/v1/platform/licenses/allocate"){
        if(!input.licenseAuthority){sendCommercialJson(res,409,{code:"LICENSE_ACTIVATION_NOT_PROVISIONED"});return;}
        sendCommercialJson(res,200,await input.licenseAuthority.allocate(session,b));return;
      }
      if(path==="/v1/platform/licenses/revoke-activation"&&exact(b,["activationId","correlationId"])){
        if(!input.licenseAuthority){sendCommercialJson(res,409,{code:"LICENSE_ACTIVATION_NOT_PROVISIONED"});return;}
        sendCommercialJson(res,200,await input.licenseAuthority.revoke(session,String(b.activationId),String(b.correlationId)));return;
      }
      if(path==="/v1/platform/licenses/issue"&&exact(b,["paymentId","correlationId"])){
        sendCommercialJson(res,200,await licenses.issue(session,String(b.paymentId),String(b.correlationId)));return;}
      sendCommercialJson(res,400,{code:"GLOBAL_REQUEST_REJECTED"});
    }catch(e){
      if(e instanceof Error&&/LICENSE_OFFER_(VERSION_CONFLICT|STALE_PUBLICATION_REJECTED|IDEMPOTENCY_CONFLICT)/.test(e.message)){
        sendCommercialJson(res,409,{code:"LICENSE_OFFER_VERSION_CONFLICT"});return;
      }
      const status=e instanceof Error&&"status" in e&&[400,413,415].includes(Number(e.status))?Number(e.status):
        e instanceof Error&&["SUBSCRIPTION_FISCAL_SUPPORT_POLICY_REQUIRED","LICENSING_FULFILLMENT_POLICY_REQUIRED"].includes(e.message)?409:400;
      sendCommercialJson(res,status,{code:status===409?"FISCAL_SUPPORT_POLICY_REQUIRED":"GLOBAL_REQUEST_REJECTED"});
    }
  };
}
