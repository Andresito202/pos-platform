import { createHash } from "node:crypto";
import { CanonicalPermission, SubscriptionQuoteRequestSchema, SubscriptionQuoteTermsSchema, canonicalSessionTrustJson,
  previewLicenseOffer, uuidV7, UuidSchema, type SubscriptionQuoteTerms } from "@pos-platform/contracts";
import { PostgresPlatformAdministrationSessionRepository, type Pool, type PoolClient } from "@pos-platform/database-postgres";
import { readPublishedLicenseOffer } from "./license-offer-reader.js";

type Preview=ReturnType<typeof previewLicenseOffer>;
export interface SubscriptionQuotePolicy {
  readonly merchant:{readonly tenantId:string;readonly companyId:string;readonly integrationId:string};
  /** Trusted synchronous Tax/contract-policy composition, never a request field.
   * null explicitly blocks quotes if fiscal/support/customer terms are missing. */
  readonly resolveTerms:(input:{readonly pricing:Preview;readonly supportSelected:boolean;readonly buyer:Readonly<Record<string,unknown>>;
    readonly now:Date})=>SubscriptionQuoteTerms|null;
}
const digest=(v:unknown)=>createHash("sha256").update(canonicalSessionTrustJson(v)).digest("hex");

/** Internal GLOBAL administration only; no HTTP credential format is invented.
 * LICENSE_PLAN_MANAGE authorizes quoting a published offer, not paying/issuing
 * a license. Every call rechecks canonical GLOBAL/MFA and the actual grant. */
export class SubscriptionQuotes {
  constructor(private readonly pool:Pool,private readonly policy:SubscriptionQuotePolicy|null,
    private readonly limits:{reauthenticationMs:number;lockTimeoutMs:number;statementTimeoutMs:number}){
    if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs)
      throw Error("SUBSCRIPTION_EXPLICIT_POLICY_LIMITS_REQUIRED");
    if(policy)for(const id of Object.values(policy.merchant))UuidSchema.parse(id);
  }

  async issue(sessionId:string,input:unknown){
    UuidSchema.parse(sessionId);const r=SubscriptionQuoteRequestSchema.parse(input);
    const policy=this.policy;if(!policy)throw Error("SUBSCRIPTION_FISCAL_SUPPORT_POLICY_REQUIRED");
    // Retry only database serialization/deadlock aborts, not policy/audit failures.
    for(let attempt=0;;attempt++){
      const c=await this.pool.connect();let begun=false;
      try{
        // Read committed rechecks after waits. The existing approved SHARE
        // protocol plus row locks below serialize all mutable authorization
        // sources; a stale pre-lock MVCC snapshot must not authorize a quote.
        await c.query("BEGIN");begun=true;
        await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
          [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`]);
        await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
        let actor=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,
          CanonicalPermission.LICENSE_PLAN_MANAGE,this.limits.reauthenticationMs);
        if(!actor)throw Error("SUBSCRIPTION_GLOBAL_MFA_PERMISSION_REQUIRED");
        const requestChecksum=digest({id:r.id,tenant_id:r.tenant_id,company_id:r.company_id,plan_id:r.plan_id,
          plan_version:r.plan_version,selection:r.selection,idempotency_key:r.idempotency_key,merchant:policy.merchant});
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`subscription-quote:${r.tenant_id}:${r.company_id}:${r.idempotency_key}`]);
        await c.query("SELECT set_config('app.tenant_id',$1,true)",[r.tenant_id]);
        // Reuse 015 without changing its function or granting UPDATE on RBAC.
        await c.query('SELECT "authorization".lock_sas_sources_for_read()');
        await c.query("SELECT id FROM identity.users WHERE id=$1 FOR SHARE",[actor.user_id]);
        await c.query("SELECT id FROM identity.mfa_factors WHERE user_id=$1 AND status='ACTIVE' FOR SHARE",[actor.user_id]);
        await c.query('SELECT id FROM "authorization".platform_role_assignments WHERE user_id=$1 AND status=\'ACTIVE\' FOR SHARE',[actor.user_id]);
        actor=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,
          CanonicalPermission.LICENSE_PLAN_MANAGE,this.limits.reauthenticationMs);
        if(!actor)throw Error("SUBSCRIPTION_GLOBAL_MFA_PERMISSION_REQUIRED");
        const old=(await c.query("SELECT *,clock_timestamp() AS evaluated_at FROM subscriptions.license_quotes WHERE id=$1 OR (tenant_id=$2 AND company_id=$3 AND idempotency_key=$4)",
          [r.id,r.tenant_id,r.company_id,r.idempotency_key])).rows;
        if(old.length){
          if(old.length!==1||old[0].request_checksum!==requestChecksum)throw Error("SUBSCRIPTION_QUOTE_IDEMPOTENCY_CONFLICT");
          await c.query("COMMIT");begun=false;return this.result(old[0],true);
        }
        await c.query("SELECT set_config('app.tenant_id',$1,true)",[r.tenant_id]);
        const buyer=(await c.query(`SELECT co.*,t.status AS tenant_status FROM organization.companies co
          JOIN tenancy.tenants t ON t.id=co.tenant_id WHERE co.id=$1 AND co.tenant_id=$2 AND co.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF co,t`,
          [r.company_id,r.tenant_id])).rows[0];
        if(!buyer)throw Error("SUBSCRIPTION_BUYER_NOT_ACTIVE");
        const {offer,features}=await readPublishedLicenseOffer(c,r.plan_id,r.plan_version);
        const pricing=previewLicenseOffer(offer,r.selection,r.plan_version);
        if(pricing.currency_code!=="COP")throw Error("SUBSCRIPTION_FACTUS_COP_REQUIRED");
        const now=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
        const supplied=policy.resolveTerms({pricing,supportSelected:r.selection.support,buyer:Object.freeze({...buyer}),now});
        if(!supplied)throw Error("SUBSCRIPTION_FISCAL_SUPPORT_POLICY_REQUIRED");
        const terms=SubscriptionQuoteTermsSchema.parse(supplied);
        const from=Date.parse(terms.service_from),until=terms.service_until===null?null:Date.parse(terms.service_until);
        if(Date.parse(terms.expires_at)<=now.getTime()||from<now.getTime()||(until!==null&&until<=from)||
          (pricing.billing_model==="PERPETUAL"?until!==null:until===null)||
          (r.selection.support?(terms.support_until===null||Date.parse(terms.support_until)<=from):terms.support_until!==null))
          throw Error("SUBSCRIPTION_TERMS_WINDOW_REJECTED");
        const subtotal=BigInt(pricing.subtotal_minor),tax=BigInt(terms.tax_minor);
        if(terms.tax_mode==="INCLUDED"&&tax>subtotal)throw Error("SUBSCRIPTION_TAX_RESULT_REJECTED");
        const total=terms.tax_mode==="EXCLUDED"?subtotal+tax:subtotal;
        if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error("SUBSCRIPTION_AMOUNT_OVERFLOW");
        await this.checkMerchant(c,policy.merchant);
        const providerReference=uuidV7();
        const snapshot={offer,pricing,terms,features,merchant:policy.merchant,buyer:{tenant_id:r.tenant_id,company_id:r.company_id},total_minor:Number(total),provider_reference:providerReference};
        const stored=(await c.query(`INSERT INTO subscriptions.license_quotes(id,tenant_id,company_id,merchant_tenant_id,merchant_company_id,integration_id,
          plan_id,plan_version,currency_code,total_minor,currency_exponent,included_registers,additional_registers,pricing_snapshot,terms_snapshot,
          entitlements_snapshot,idempotency_key,request_checksum,quote_checksum,created_by_user_id,created_by_session_id,created_at,expires_at,provider_reference)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *,clock_timestamp() AS evaluated_at`,
          [r.id,r.tenant_id,r.company_id,policy.merchant.tenantId,policy.merchant.companyId,policy.merchant.integrationId,r.plan_id,r.plan_version,
            pricing.currency_code,total.toString(),terms.currency_exponent,r.selection.additional_registers,JSON.stringify({offer,pricing}),JSON.stringify(terms),
            JSON.stringify(features),r.idempotency_key,requestChecksum,digest(snapshot),actor.user_id,sessionId,now,terms.expires_at,providerReference])).rows[0];
        await c.query("SELECT set_config('app.tenant_id',$1,true)",[r.tenant_id]);
        if(!await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,
          CanonicalPermission.LICENSE_PLAN_MANAGE,this.limits.reauthenticationMs))throw Error("SUBSCRIPTION_GLOBAL_MFA_PERMISSION_REQUIRED");
        const payload=canonicalSessionTrustJson({quote_id:r.id,quote_checksum:stored.quote_checksum,tenant_id:r.tenant_id,company_id:r.company_id,
          merchant:policy.merchant,plan_id:r.plan_id,plan_version:r.plan_version,total_minor:total.toString()});
        // GLOBAL session audit remains GLOBAL. Target tenant/company are evidence,
        // not a fabricated tenant session (001 enforces that distinction by FK).
        await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,
          resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
          VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'SUBSCRIPTION_QUOTE_ISSUED','SUBSCRIPTION_QUOTE','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
          [uuidV7(),actor.user_id,sessionId,r.id,r.correlation_id,payload,createHash("sha256").update(payload).digest("hex")]);
        await c.query("COMMIT");begun=false;return this.result(stored,false);
      }catch(error){
        if(begun)await c.query("ROLLBACK");
        if(attempt<2&&typeof error==="object"&&error!==null&&"code" in error&&["40001","40P01"].includes(String(error.code)))continue;
        throw error;
      }finally{c.release();}
    }
  }
  private async checkMerchant(c:PoolClient,m:SubscriptionQuotePolicy["merchant"]){
    await c.query("SELECT set_config('app.tenant_id',$1,true)",[m.tenantId]);
    const active=await c.query(`SELECT i.id FROM integrations.external_integrations i JOIN organization.companies co ON co.tenant_id=i.tenant_id AND co.id=i.company_id
      JOIN tenancy.tenants t ON t.id=i.tenant_id WHERE i.tenant_id=$1 AND i.company_id=$2 AND i.id=$3 AND i.provider_code_snapshot='FACTUS_PAY'
      AND i.status='ACTIVE' AND co.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF i,co,t`,[m.tenantId,m.companyId,m.integrationId]);
    if(active.rowCount!==1)throw Error("SUBSCRIPTION_MERCHANT_NOT_ACTIVE");
    if((await c.query("SELECT id FROM integrations.integration_credential_bindings WHERE tenant_id=$1 AND company_id=$2 AND integration_id=$3 AND status='ACTIVE' FOR SHARE",[m.tenantId,m.companyId,m.integrationId])).rowCount!==1)
      throw Error("SUBSCRIPTION_MERCHANT_CREDENTIAL_REQUIRED");
  }
  private result(row:Record<string,any>,idempotent:boolean){
    return {state:(row.evaluated_at as Date).getTime()>=(row.expires_at as Date).getTime()?"EXPIRED" as const:"QUOTED" as const,quoteId:row.id as string,quoteChecksum:row.quote_checksum as string,totalMinor:String(row.total_minor),
      currencyCode:row.currency_code as string,currencyExponent:row.currency_exponent as number,includedRegisters:1 as const,
      additionalRegisters:row.additional_registers as number,expiresAt:(row.expires_at as Date).toISOString(),idempotent,
      paymentStatus:"NOT_REQUESTED" as const,activationStatus:"NOT_ACTIVATED" as const};
  }
}
