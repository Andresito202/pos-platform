import { InitializeTenant } from "@pos-platform/application";
import { PostgresOnboardingRepository, type PoolClient } from "@pos-platform/database-postgres";
import { requireLicenseAdministrator } from "./license-administration.js";

import type {IncomingMessage,ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {createHash,randomBytes} from "node:crypto";
import {CanonicalPermission,CentralAdministrationOperation,UuidSchema,uuidV7} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {GlobalAdministrationSessions,type GlobalAdministrationPolicy} from "./global-administration-sessions.js";
import {LicenseOfferDrafts} from "./license-offer-drafts.js";
import {FixedWindowRateLimiter} from "./fixed-window-rate-limiter.js";
import {SubscriptionLicenseContracts,type FulfillmentPolicyReferences} from "./subscription-license-contracts.js";
import {SubscriptionQuoteContracts} from "./subscription-quote-contracts.js";
import {readCommercialJsonBody,inspectCommercialHeaders,validateCommercialAssertion,sendCommercialJson} from "./commercial-https-request-boundary.js";
import type {LicenseCapacityAuthority} from "./license-capacity-authority.js";
import type {SubscriptionCollectionBinding} from "@pos-platform/contracts";

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
  fulfillmentPolicies?:readonly FulfillmentPolicyReferences[];subscriptionCollection?:SubscriptionCollectionBinding;
  licenseAuthority?:LicenseCapacityAuthority}){
  const {policy,limits}=input;
  if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0))throw Error("GLOBAL_HTTP_EXPLICIT_LIMITS_REQUIRED");
  const sessions=new GlobalAdministrationSessions(input.pool,policy),offers=new LicenseOfferDrafts(input.pool,policy.maximumReauthenticationAgeMs,
    {origin:policy.origin,lockTimeoutMs:policy.lockTimeoutMs,statementTimeoutMs:policy.statementTimeoutMs});
  const limiter=new FixedWindowRateLimiter(limits.requestsPerWindow,limits.maximumBuckets,limits.requestWindowMs);
  const licenseLimits={reauthenticationMs:policy.maximumReauthenticationAgeMs,
    lockTimeoutMs:policy.lockTimeoutMs,statementTimeoutMs:policy.statementTimeoutMs};
  const licenses=new SubscriptionLicenseContracts(input.pool,input.fulfillmentPolicies??null,licenseLimits);
  const quotes=new SubscriptionQuoteContracts(input.pool,input.fulfillmentPolicies??null,input.subscriptionCollection??null,licenseLimits);
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
      if(path==="/v1/platform/tenants/initialize"){
        const sessionId=await sessions.authorize(
          request,CentralAdministrationOperation.TENANT_INITIALIZE
        );

        if(!sessionId){
          sendCommercialJson(res,403,{code:"TENANT_AUTHORIZATION_REJECTED"});
          return;
        }

        const keys=[
          "tenantName","companyName","branchName",
          "ownerEmail","ownerFullName","idempotencyKey","correlationId"
        ];

        if(!exact(b,keys) ||
          !keys.every(k=>text(b[k],320)) ||
          !UuidSchema.safeParse(b.correlationId).success ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.ownerEmail))){
          sendCommercialJson(res,400,{code:"TENANT_REQUEST_INVALID"});
          return;
        }

        const actor=await input.pool.query(
          "SELECT user_id FROM identity.sessions WHERE id=$1 AND revoked_at IS NULL",
          [sessionId]
        );

        const actorId=actor.rows[0]?.user_id;

        if(!UuidSchema.safeParse(actorId).success){
          sendCommercialJson(res,403,{code:"TENANT_AUTHORIZATION_REJECTED"});
          return;
        }

        const repository=new PostgresOnboardingRepository(
          input.pool,
          async native=>{
            const c=native as PoolClient;

            await c.query(
              "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
              [`${policy.lockTimeoutMs}ms`,`${policy.statementTimeoutMs}ms`]
            );

            const authorized=await requireLicenseAdministrator(
              c,sessionId,policy.maximumReauthenticationAgeMs,
              CentralAdministrationOperation.TENANT_INITIALIZE
            );

            if(authorized.user_id!==actorId)
              throw Error("TENANT_ACTOR_MISMATCH");
          }
        );

        const onboarding=new InitializeTenant(repository,{
          authorize:async requested=>{
            if(requested.type!=="PLATFORM_ACCOUNT" ||
               requested.id!==actorId)
              throw Error("TENANT_ACTOR_REJECTED");
          }
        });

        const result=await onboarding.execute({
          actor:{type:"PLATFORM_ACCOUNT",id:actorId},
          tenantName:String(b.tenantName),
          companyName:String(b.companyName),
          branchName:String(b.branchName),
          ownerEmail:String(b.ownerEmail),
          ownerFullName:String(b.ownerFullName),
          initialLocale:"es-CO",
          initialTimezone:"America/Bogota",
          initialCurrency:"COP",
          initialConfiguration:{},
          idempotencyKey:String(b.idempotencyKey),
          correlationId:String(b.correlationId)
        });

        sendCommercialJson(res,200,result);
        return;
      }
      const allowed=["/v1/platform/session","/v1/platform/license-offers/list","/v1/platform/license-offers/catalog","/v1/platform/license-offers/save","/v1/platform/license-offers/set-entitlements","/v1/platform/license-offers/publish","/v1/platform/subscription-quotes/create","/v1/platform/subscription-quotes/confirm-payment","/v1/platform/licenses/issue","/v1/platform/licenses/allocate","/v1/platform/licenses/revoke-activation","/v1/platform/licenses/activations","/v1/platform/licenses/assignment-context"];
      if(!allowed.includes(path??"")){sendCommercialJson(res,404,{code:"GLOBAL_NOT_FOUND"});return;}
      const session=await sessions.authorize(request,(path==="/v1/platform/licenses/revoke-activation"||path==="/v1/platform/licenses/activations")?CentralAdministrationOperation.LICENSE_REVOKE:
        path?.startsWith("/v1/platform/licenses/")||path?.startsWith("/v1/platform/subscription-quotes/")?CentralAdministrationOperation.LICENSE_ISSUE:CanonicalPermission.LICENSE_PLAN_MANAGE);
      if(!session){sendCommercialJson(res,401,{code:"GLOBAL_AUTHORIZATION_REJECTED"});return;}
      if(path==="/v1/platform/session"&&exact(b,[])){sendCommercialJson(res,200,{authenticated:true,scope:"GLOBAL",permissions:[CanonicalPermission.LICENSE_PLAN_MANAGE]});return;}
      if(path==="/v1/platform/license-offers/list"&&exact(b,[])){sendCommercialJson(res,200,{offers:await offers.published()});return;}
      if(path==="/v1/platform/license-offers/catalog"&&exact(b,[])){sendCommercialJson(res,200,{offers:await offers.administrativeCatalog(session)});return;}
      if(path==="/v1/platform/license-offers/save"&&exact(b,["offer","expectedVersion","correlationId"])){
        sendCommercialJson(res,200,await offers.save(session,b.offer,Number(b.expectedVersion),String(b.correlationId)));return;}
      if(path==="/v1/platform/license-offers/set-entitlements"&&exact(b,["planId","expectedVersion","entitlements","correlationId"])){
        sendCommercialJson(res,200,await offers.setEntitlements(session,String(b.planId),Number(b.expectedVersion),b.entitlements,String(b.correlationId)));return;}
      if(path==="/v1/platform/license-offers/publish"&&exact(b,["planId","expectedVersion","correlationId"])){
        sendCommercialJson(res,200,await offers.publish(session,String(b.planId),Number(b.expectedVersion),String(b.correlationId)));return;}
      if(path==="/v1/platform/subscription-quotes/create"){
        sendCommercialJson(res,200,await quotes.create(session,b));return;
      }
      if(path==="/v1/platform/subscription-quotes/confirm-payment"){
        sendCommercialJson(res,200,await quotes.confirmPayment(session,b));return;
      }
      if(path==="/v1/platform/licenses/assignment-context"){
        if(!input.licenseAuthority){sendCommercialJson(res,409,{code:"LICENSE_ACTIVATION_NOT_PROVISIONED"});return;}
        sendCommercialJson(res,200,await input.licenseAuthority.assignmentContext(session,b));return;
      }
      if(path==="/v1/platform/licenses/activations"){
        if(!input.licenseAuthority){sendCommercialJson(res,409,{code:"LICENSE_ACTIVATION_NOT_PROVISIONED"});return;}
        sendCommercialJson(res,200,await input.licenseAuthority.listActivations(session,b));return;
      }
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
      if(e instanceof Error&&/SUBSCRIPTION_QUOTE_IDEMPOTENCY_CONFLICT|SUBSCRIPTION_PAYMENT_EVIDENCE_CONFLICT/.test(e.message)){
        sendCommercialJson(res,409,{code:"SUBSCRIPTION_QUOTE_CONFLICT"});return;
      }
      const status=e instanceof Error&&"status" in e&&[400,413,415].includes(Number(e.status))?Number(e.status):
        e instanceof Error&&["SUBSCRIPTION_FISCAL_SUPPORT_POLICY_REQUIRED","LICENSING_FULFILLMENT_POLICY_REQUIRED","SUBSCRIPTION_COLLECTION_NOT_PROVISIONED"].includes(e.message)?409:400;
      sendCommercialJson(res,status,{code:status===409?(e instanceof Error&&e.message==="SUBSCRIPTION_COLLECTION_NOT_PROVISIONED"?"SUBSCRIPTION_COLLECTION_NOT_PROVISIONED":"FISCAL_SUPPORT_POLICY_REQUIRED"):"GLOBAL_REQUEST_REJECTED"});
    }
  };
}
