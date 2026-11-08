import {canonicalSessionTrustJson,SubscriptionQuoteTermsSchema,UuidSchema,uuidV7} from "@pos-platform/contracts";
import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {normalizeFactusPayCollectionWebhook} from "./factus-pay-collection-event.js";

export interface FactusPayCredentialBinding {
  tenantId:string;companyId:string;integrationId:string;credentialReference:string;generation:number;
  environment:"SANDBOX"|"PRODUCTION";providerAccountReference:string;
}
/** Service-side custody port. Resolve only the registered company/account, not
 * an arbitrary bearer supplied by the caller. Tokens are never returned or audited. */
export interface FactusPayCredentialResolver {
  resolve(binding:Readonly<FactusPayCredentialBinding>,signal:AbortSignal):Promise<{
    /** null means provider has no time expiry; never disables generation/revocation checks. */
    binding:FactusPayCredentialBinding;accessToken:string;expiresAt:string|null;
  }>;
}
export interface CheckedFactusCollection {
  readonly quoteId:string;readonly quoteChecksum:string;readonly buyerTenantId:string;readonly buyerCompanyId:string;
  readonly merchant:Readonly<FactusPayCredentialBinding>;readonly providerReference:string;readonly amount:string;
  readonly currencyCode:"COP";readonly verifiedAt:string;
}
export interface PreparedFactusCollection extends CheckedFactusCollection {
  readonly collectionStatus:"READY"|"PAID_UNVERIFIED";
  readonly qr:string|null;
}
const origins={SANDBOX:"https://pay-api-sandbox.factus.com.co",PRODUCTION:"https://pay-api.factus.com.co"} as const;
const equal=(a:unknown,b:unknown)=>canonicalSessionTrustJson(a)===canonicalSessionTrustJson(b);

/** API verification evidence only. This does NOT mutate Payment, activate a
 * license or deliver a signed capacity. SubscriptionPayments consumes the
 * receipt and persists canonical confirmation before Licensing may issue rights. */
export class FactusPayQuoteVerifier {
  private readonly receipts=new WeakMap<object,{value:CheckedFactusCollection;expiresAt:number}>();
  private readonly collections=new WeakMap<object,{value:PreparedFactusCollection;expiresAt:number}>();
  constructor(private readonly pool:Pool,private readonly credentials:FactusPayCredentialResolver,
    private readonly limits:{requestTimeoutMs:number;maximumResponseBytes:number;evidenceLifetimeMs:number;lockTimeoutMs:number;statementTimeoutMs:number},
    private readonly transport:typeof fetch=fetch){
    if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs)
      throw Error("FACTUS_API_EXPLICIT_LIMITS_REQUIRED");
  }

  /** Creates only a previously reserved financial intent. The provider uses the
   * persisted reference as its idempotency key. Even a paid POST response must
   * undergo a separate authenticated GET before Payments can confirm it. */
  async prepareCollection(quoteId:string,expirationSeconds:number,parentSignal?:AbortSignal):Promise<object>{
    UuidSchema.parse(quoteId);
    if(!Number.isSafeInteger(expirationSeconds)||expirationSeconds<=0)throw Error("FACTUS_API_EXPIRATION_REQUIRED");
    const deadline=new AbortController(),abort=()=>deadline.abort();
    const timer=setTimeout(abort,this.limits.requestTimeoutMs);parentSignal?.addEventListener("abort",abort,{once:true});
    if(parentSignal?.aborted)abort();
    try{
      deadline.signal.throwIfAborted();
      const source=await this.transaction(async c=>{
        const current=await this.load(c,quoteId,false);
        const rows=await c.query(`SELECT 1 FROM payments.payment_attempts a JOIN payments.payments p ON p.id=a.payment_id
          JOIN payments.payment_groups g ON g.id=p.payment_group_id JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
          WHERE q.id=$1 AND a.status='PENDING' AND p.status='PENDING' AND a.provider_reference=$2 AND a.integration_id=$3
          AND a.amount=$4 AND a.currency_code='COP' AND q.expires_at>clock_timestamp()+$5*interval '1 second'`,
          [quoteId,current.reference,current.binding.integrationId,current.amount,expirationSeconds]);
        if(rows.rowCount!==1)throw Error("FACTUS_API_RESERVED_CURRENT_INTENT_REQUIRED");
        // Official collection limits: COP 1,000..12,100,000; at most 2 decimals.
        const [whole,fraction]=current.amount.split(".");
        if(BigInt(whole!)<1000n||BigInt(whole!)>12100000n||fraction!.slice(2)!=="0000"||
          BigInt(whole!)===12100000n&&fraction!=="000000")throw Error("FACTUS_API_COLLECTION_AMOUNT_UNSUPPORTED");
        return current;
      });
      const credential=await this.abortable(this.credentials.resolve(Object.freeze({...source.binding}),deadline.signal),deadline.signal);
      if(!equal(credential.binding,source.binding)||typeof credential.accessToken!=="string"||!credential.accessToken||credential.accessToken.length>8192||/[\r\n]/.test(credential.accessToken)||
        (credential.expiresAt!==null&&(!Number.isFinite(Date.parse(credential.expiresAt))||Date.parse(credential.expiresAt)<=Date.now())))throw Error("FACTUS_API_CREDENTIAL_BINDING_REJECTED");
      const url=origins[source.binding.environment]+"/v1/collections";
      const response=await this.abortable(this.transport(url,{method:"POST",redirect:"error",cache:"no-store",signal:deadline.signal,
        headers:{authorization:"Bearer "+credential.accessToken,accept:"application/json","content-type":"application/json"},
        body:JSON.stringify({reference_code:source.reference,amount:source.amount.slice(0,-4),expiration:String(expirationSeconds)})}),deadline.signal);
      if(![200,201].includes(response.status)||response.redirected||response.url&&response.url!==url||
        response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json"){
        void response.body?.cancel().catch(()=>undefined);throw Error("FACTUS_API_RESPONSE_REJECTED");}
      const body=await this.readJson(response,deadline.signal) as {status?:unknown;data?:Record<string,unknown>};
      const d=body?.data;
      if(body?.status!=="success"||!d||!["ready","paid"].includes(String(d.status)))throw Error("FACTUS_API_COLLECTION_REJECTED");
      // Reuse the canonical monetary parser without promoting POST to paid proof.
      const observed=normalizeFactusPayCollectionWebhook({data:{...d,status:"paid"}});
      if(observed.external_reference!==source.reference||observed.amount!==source.amount||d.currency_code!==undefined&&d.currency_code!=="COP")
        throw Error("FACTUS_API_COLLECTION_BINDING_MISMATCH");
      const qr=d.status==="ready"?d.qr:null;
      if(qr!==null&&(typeof qr!=="string"||qr.length>this.limits.maximumResponseBytes||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(qr)))
        throw Error("FACTUS_API_QR_REJECTED");
      const checked=await this.transaction(async c=>{
        if(!equal(source,await this.load(c,quoteId,true)))throw Error("FACTUS_API_QUOTE_OR_CREDENTIAL_CHANGED");
        const at=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
        if(credential.expiresAt!==null&&Date.parse(credential.expiresAt)<=at.getTime())throw Error("FACTUS_API_CREDENTIAL_EXPIRED");
        return Object.freeze({quoteId,quoteChecksum:source.checksum,buyerTenantId:source.buyerTenant,buyerCompanyId:source.buyerCompany,
          merchant:Object.freeze({...source.binding}),providerReference:source.reference,amount:source.amount,currencyCode:"COP" as const,
          verifiedAt:at.toISOString(),collectionStatus:d.status==="ready"?"READY" as const:"PAID_UNVERIFIED" as const,qr:qr as string|null});
      });
      deadline.signal.throwIfAborted();
      const receipt=Object.freeze({});this.collections.set(receipt,{value:checked,expiresAt:Date.parse(checked.verifiedAt)+this.limits.evidenceLifetimeMs});
      return receipt;
    }catch(error){
      if(deadline.signal.aborted)throw Error("FACTUS_API_CANCELLED_OR_TIMEOUT");
      if(error instanceof Error&&/^FACTUS_[A-Z_]+$/.test(error.message))throw error;
      throw Error("FACTUS_API_COLLECTION_FAILED");
    }finally{clearTimeout(timer);parentSignal?.removeEventListener("abort",abort);}
  }

  async consumeCollection<T>(receipt:unknown,work:(c:PoolClient,value:PreparedFactusCollection)=>Promise<T>):Promise<T>{
    if(typeof receipt!=="object"||receipt===null)throw Error("FACTUS_API_COLLECTION_RECEIPT_REQUIRED");
    const found=this.collections.get(receipt);this.collections.delete(receipt);
    if(!found||Date.now()>=found.expiresAt)throw Error("FACTUS_API_COLLECTION_RECEIPT_REQUIRED");
    return this.consumeCurrent(found.value,work);
  }

  async verifyQuote(quoteId:string,parentSignal?:AbortSignal):Promise<object>{
    UuidSchema.parse(quoteId);
    const deadline=new AbortController(),abort=()=>deadline.abort();
    const timer=setTimeout(abort,this.limits.requestTimeoutMs);parentSignal?.addEventListener("abort",abort,{once:true});
    if(parentSignal?.aborted)abort();
    try{
      deadline.signal.throwIfAborted();
      const source=await this.transaction(c=>this.load(c,quoteId,false));
      const credential=await this.abortable(this.credentials.resolve(Object.freeze({...source.binding}),deadline.signal),deadline.signal);
      if(!equal(credential.binding,source.binding)||typeof credential.accessToken!=="string"||
        !credential.accessToken||credential.accessToken.length>8192||/[\r\n]/.test(credential.accessToken)||
        (credential.expiresAt!==null&&(!Number.isFinite(Date.parse(credential.expiresAt))||Date.parse(credential.expiresAt)<=Date.now())))throw Error("FACTUS_API_CREDENTIAL_BINDING_REJECTED");
      const url=origins[source.binding.environment]+"/v1/collections/"+encodeURIComponent(source.reference);
      const response=await this.abortable(this.transport(url,{method:"GET",redirect:"error",cache:"no-store",signal:deadline.signal,
        headers:{authorization:"Bearer "+credential.accessToken,accept:"application/json"}}),deadline.signal);
      if(response.status!==200||response.redirected||response.url&&response.url!==url){
        void response.body?.cancel().catch(()=>undefined);throw Error("FACTUS_API_RESPONSE_REJECTED");}
      if(response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json"){
        void response.body?.cancel().catch(()=>undefined);throw Error("FACTUS_API_CONTENT_TYPE_REJECTED");}
      const body=await this.readJson(response,deadline.signal);
      if(typeof body!=="object"||body===null||!("status" in body)||body.status!=="success"||!("data" in body)||
        typeof body.data!=="object"||body.data===null||Array.isArray(body.data))throw Error("FACTUS_API_COLLECTION_REJECTED");
      const data=body.data as Record<string,unknown>;
      if(data.currency_code!==undefined&&data.currency_code!=="COP")throw Error("FACTUS_API_CURRENCY_MISMATCH");
      const observed=normalizeFactusPayCollectionWebhook({data});
      if(observed.external_reference!==source.reference)throw Error("FACTUS_API_REFERENCE_MISMATCH");
      if(observed.amount!==source.amount||observed.currency_code!=="COP")throw Error("FACTUS_API_AMOUNT_MISMATCH");
      deadline.signal.throwIfAborted();
      const checked=await this.transaction(async c=>{
        const current=await this.load(c,quoteId,true);
        if(!equal(source,current))throw Error("FACTUS_API_QUOTE_OR_CREDENTIAL_CHANGED");
        deadline.signal.throwIfAborted();
        const at=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
        if(credential.expiresAt!==null&&Date.parse(credential.expiresAt)<=at.getTime())throw Error("FACTUS_API_CREDENTIAL_EXPIRED");
        const result:CheckedFactusCollection={quoteId,quoteChecksum:current.checksum,buyerTenantId:current.buyerTenant,
          buyerCompanyId:current.buyerCompany,merchant:Object.freeze({...current.binding}),providerReference:current.reference,
          amount:current.amount,currencyCode:"COP",verifiedAt:at.toISOString()};
        const evidence=canonicalSessionTrustJson(result);
        await c.query(`INSERT INTO audit.audit_events(id,tenant_id,company_id,actor_type,action_code,resource_type,resource_reference_kind,
          resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
          VALUES($1,$2,$3,'SYSTEM','FACTUS_PAY_QUOTE_API_VERIFIED','SUBSCRIPTION_QUOTE','INSTANCE',$4,$5,1,$6,$6,'API_VERIFIED_NOT_PAYMENT_CONFIRMED',$7::jsonb,$8)`,
          [uuidV7(),current.binding.tenantId,current.binding.companyId,quoteId,uuidV7(),at,evidence,createHash("sha256").update(evidence).digest("hex")]);
        return Object.freeze(result);
      });
      deadline.signal.throwIfAborted();
      const receipt=Object.freeze({});this.receipts.set(receipt,{value:checked,expiresAt:Date.parse(checked.verifiedAt)+this.limits.evidenceLifetimeMs});
      return receipt;
    }catch(error){
      if(deadline.signal.aborted)throw Error("FACTUS_API_CANCELLED_OR_TIMEOUT");
      if(error instanceof Error&&/^FACTUS_[A-Z_]+$/.test(error.message))throw error;
      // Transport/body errors may contain URLs, headers or provider content.
      throw Error("FACTUS_API_VERIFICATION_FAILED");
    }finally{clearTimeout(timer);parentSignal?.removeEventListener("abort",abort);}
  }

  /** Process-local, single-use evidence. JSON, UUIDs and booleans cannot mint it.
   * Evidence is not a persisted canonical Payment confirmation. */
  take(receipt:unknown):CheckedFactusCollection|null{
    if(typeof receipt!=="object"||receipt===null)return null;
    const found=this.receipts.get(receipt);this.receipts.delete(receipt);
    if(!found||Date.now()>=found.expiresAt)return null;return found.value;
  }

  /** Canonical Payments consumes evidence inside this same revalidation/lock
   * transaction. A later revocation/expiration cannot use a cached API result.
   * A rollback still consumes the receipt; recovery must perform a fresh GET. */
  async consume<T>(receipt:unknown,work:(c:PoolClient,value:CheckedFactusCollection)=>Promise<T>):Promise<T>{
    const value=this.take(receipt);if(!value)throw Error("FACTUS_API_FRESH_RECEIPT_REQUIRED");
    return this.consumeCurrent(value,work);
  }

  private consumeCurrent<V extends CheckedFactusCollection,T>(value:V,work:(c:PoolClient,value:V)=>Promise<T>){
    return this.transaction(async c=>{
      const current=await this.load(c,value.quoteId,true);
      if(current.checksum!==value.quoteChecksum||current.reference!==value.providerReference||current.amount!==value.amount||
        current.buyerTenant!==value.buyerTenantId||current.buyerCompany!==value.buyerCompanyId||!equal(current.binding,value.merchant))
        throw Error("FACTUS_API_QUOTE_OR_CREDENTIAL_CHANGED");
      const result=await work(c,value);
      const now=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
      if(now.getTime()>=Date.parse(value.verifiedAt)+this.limits.evidenceLifetimeMs||
        (await c.query("SELECT 1 FROM subscriptions.license_quotes WHERE id=$1 AND expires_at>clock_timestamp()",[value.quoteId])).rowCount!==1)
        throw Error("FACTUS_API_FRESH_RECEIPT_REQUIRED");
      return result;
    });
  }

  private async transaction<T>(work:(c:PoolClient)=>Promise<T>){
    const c=await this.pool.connect();try{
      await c.query("BEGIN");await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
        [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`]);
      const role=(await c.query("SELECT current_user='pos_platform_app' AS eligible")).rows[0];
      if(role?.eligible!==true)throw Error("FACTUS_API_CENTRAL_ROLE_REQUIRED");
      const result=await work(c);await c.query("COMMIT");return result;
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  private async load(c:PoolClient,quoteId:string,lock:boolean){
    // Quotes are append-only, including for the schema owner. Row locks would
    // need UPDATE privilege; do not grant it just to read immutable evidence.
    const q=(await c.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1 AND expires_at>clock_timestamp()",[quoteId])).rows[0];
    if(!q)throw Error("FACTUS_API_CURRENT_QUOTE_REQUIRED");
    if(q.currency_code!=="COP")throw Error("FACTUS_API_CURRENCY_MISMATCH");
    const terms=SubscriptionQuoteTermsSchema.parse(q.terms_snapshot);
    if(terms.currency_exponent!==q.currency_exponent)throw Error("FACTUS_API_QUOTE_SCALE_MISMATCH");
    await c.query("SELECT set_config('app.tenant_id',$1,true)",[q.tenant_id]);
    const buyer=await c.query(`SELECT co.id FROM organization.companies co JOIN tenancy.tenants t ON t.id=co.tenant_id
      WHERE co.tenant_id=$1 AND co.id=$2 AND co.status='ACTIVE' AND t.status='ACTIVE' ${lock?"FOR SHARE OF co,t":""}`,[q.tenant_id,q.company_id]);
    if(buyer.rowCount!==1)throw Error("FACTUS_API_BUYER_INACTIVE");
    await c.query("SELECT set_config('app.tenant_id',$1,true)",[q.merchant_tenant_id]);
    const i=(await c.query(`SELECT i.* FROM integrations.external_integrations i JOIN organization.companies co ON co.tenant_id=i.tenant_id AND co.id=i.company_id
      JOIN tenancy.tenants t ON t.id=i.tenant_id WHERE i.tenant_id=$1 AND i.company_id=$2 AND i.id=$3 AND i.provider_code_snapshot='FACTUS_PAY'
      AND i.status='ACTIVE' AND co.status='ACTIVE' AND t.status='ACTIVE' ${lock?"FOR SHARE OF i,co,t":""}`,[q.merchant_tenant_id,q.merchant_company_id,q.integration_id])).rows[0];
    if(!i||!["SANDBOX","PRODUCTION"].includes(i.environment)||!i.provider_account_reference)throw Error("FACTUS_API_MERCHANT_BINDING_REQUIRED");
    const bindings=(await c.query(`SELECT credential_reference,generation FROM integrations.integration_credential_bindings
      WHERE tenant_id=$1 AND company_id=$2 AND integration_id=$3 AND status='ACTIVE' ${lock?"FOR SHARE":""}`,[q.merchant_tenant_id,q.merchant_company_id,q.integration_id])).rows;
    if(bindings.length!==1)throw Error("FACTUS_API_ACTIVE_CREDENTIAL_REQUIRED");
    const binding:FactusPayCredentialBinding={tenantId:q.merchant_tenant_id,companyId:q.merchant_company_id,integrationId:q.integration_id,
      credentialReference:bindings[0].credential_reference,generation:bindings[0].generation,environment:i.environment,providerAccountReference:i.provider_account_reference};
    const micros=BigInt(q.total_minor)*10n**BigInt(6-q.currency_exponent);
    return {binding,reference:String(q.provider_reference),checksum:String(q.quote_checksum),buyerTenant:String(q.tenant_id),buyerCompany:String(q.company_id),
      amount:`${micros/1000000n}.${String(micros%1000000n).padStart(6,"0")}`};
  }
  private async readJson(response:Response,signal:AbortSignal):Promise<unknown>{
    const reader=response.body?.getReader();if(!reader)throw Error("FACTUS_API_EMPTY_RESPONSE");
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const r=await this.abortable(reader.read(),signal);if(r.done)break;size+=r.value.byteLength;
      if(size>this.limits.maximumResponseBytes)throw Error("FACTUS_API_RESPONSE_TOO_LARGE");chunks.push(r.value);}
      return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
    }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
  }
  private abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
    return new Promise((resolve,reject)=>{const abort=()=>reject(Error("FACTUS_API_CANCELLED_OR_TIMEOUT"));
      signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
      pending.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
    });
  }
}
