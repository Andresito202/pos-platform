import {createHash} from "node:crypto";
import {CentralAdministrationOperation,SubscriptionQuoteTermsSchema,canonicalSessionTrustJson,uuidV7,UuidSchema} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,PostgresSubscriptionLicenseOutbox,type Pool} from "@pos-platform/database-postgres";

export interface FulfillmentPolicyReferences{policy_reference:string;tax_policy_reference:string;support_policy_reference:string}

/** Licensing writes its existing contractual aggregate only AFTER Payments
 * confirmation and an explicit D-1 GLOBAL LICENSE_ISSUE grant. This does not
 * issue user grants, device activation or a signed register-capacity artifact. */
export class SubscriptionLicenseContracts{
  constructor(private readonly pool:Pool,private readonly approvedPolicies:readonly FulfillmentPolicyReferences[]|null,
    private readonly limits:{reauthenticationMs:number;lockTimeoutMs:number;statementTimeoutMs:number}){
    if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs)throw Error("LICENSING_EXPLICIT_LIMITS_REQUIRED");
  }
  async issue(sessionId:string,paymentId:string,correlationId:string){
    UuidSchema.parse(sessionId);UuidSchema.parse(paymentId);UuidSchema.parse(correlationId);
    if(!this.approvedPolicies?.length)throw Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");
    const c=await this.pool.connect();try{
      await c.query("BEGIN");await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`]);
      await c.query('SELECT "authorization".lock_platform_sources_for_read()');
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
      const permissions=new PostgresPlatformAdministrationSessionRepository(c);
      const actor=await permissions.findActivePlatformPermissionForSession(sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs);
      if(!actor)throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
      if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.sessions s ON s.id=h.session_id AND s.user_id=h.user_id
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
          AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        WHERE s.id=$1 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId])).rowCount!==1)
        throw Error("LICENSING_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
      const rows=(await c.query(`SELECT q.*,p.id AS payment_id,p.confirmed_at,p.confirmed_amount::text,a.provider_reference AS paid_reference,a.evidence_snapshot,
        a.integration_id AS paid_integration FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        JOIN payments.payment_allocations pa ON pa.payment_id=p.id AND pa.payment_group_id=g.id AND pa.collection_subject_id=q.id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE' AND p.status='CONFIRMED' AND a.status='CONFIRMED'
          AND p.tenant_id=q.merchant_tenant_id AND p.company_id=q.merchant_company_id AND pa.tenant_id=p.tenant_id
          AND p.confirmed_amount=p.expected_amount AND pa.amount=p.confirmed_amount AND a.amount=p.confirmed_amount
          AND p.currency_code=q.currency_code AND pa.currency_code=q.currency_code AND a.currency_code=q.currency_code
          AND p.confirmed_at<=q.expires_at AND p.confirmed_amount=q.total_minor::numeric/power(10::numeric,q.currency_exponent)
        FOR SHARE OF p,a`,[paymentId])).rows;
      const q=rows[0];if(rows.length!==1||!q||q.paid_reference!==q.provider_reference||q.paid_integration!==q.integration_id||
        q.evidence_snapshot?.quoteChecksum!==q.quote_checksum||q.evidence_snapshot?.quoteId!==q.id||q.evidence_snapshot?.providerReference!==q.provider_reference)
        throw Error("LICENSING_CONFIRMED_QUOTE_PAYMENT_REQUIRED");
      const terms=SubscriptionQuoteTermsSchema.parse(q.terms_snapshot);
      if(!this.approvedPolicies.some(p=>p.policy_reference===terms.policy_reference&&p.tax_policy_reference===terms.tax_policy_reference&&p.support_policy_reference===terms.support_policy_reference))
        throw Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["paid-license:"+paymentId]);
      const reference="SUBSCRIPTION_PAYMENT:"+paymentId;
      const old=(await c.query("SELECT id,tenant_id,plan_id,contract_status FROM licensing.licenses WHERE commercial_reference=$1",[reference])).rows[0];
      if(old){if(old.tenant_id!==q.tenant_id||old.plan_id!==q.plan_id)throw Error("LICENSING_PAYMENT_CONTRACT_CONFLICT");
        if(!await permissions.findActivePlatformPermissionForSession(sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs))throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
        await c.query("COMMIT");return {licenseId:String(old.id),contractStatus:String(old.contract_status),activationStatus:"NOT_ACTIVATED" as const,idempotent:true};}
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[q.tenant_id]);
      if((await c.query(`SELECT 1 FROM organization.companies co JOIN tenancy.tenants t ON t.id=co.tenant_id
        WHERE co.id=$1 AND co.tenant_id=$2 AND co.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF co,t`,[q.company_id,q.tenant_id])).rowCount!==1)
        throw Error("LICENSING_ACTIVE_BUYER_REQUIRED");
      if(terms.service_until!==null&&(await c.query("SELECT $1::timestamptz>clock_timestamp() AS current",[terms.service_until])).rows[0].current!==true)
        throw Error("LICENSING_SERVICE_TERM_EXPIRED");
      const mode=q.pricing_snapshot?.pricing?.deployment_mode??q.pricing_snapshot?.offer?.deployment_mode;
      if(!["HYBRID","LOCAL_PERPETUAL"].includes(mode)||mode==="LOCAL_PERPETUAL"&&terms.service_until!==null||mode==="HYBRID"&&terms.service_until===null)
        throw Error("LICENSING_QUOTE_MODE_MISMATCH");
      const licenseId=uuidV7();
      await c.query(`INSERT INTO licensing.licenses(id,tenant_id,plan_id,deployment_mode,contract_status,not_before,expires_at,policy_version,commercial_reference,created_at,updated_at)
        VALUES($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,clock_timestamp(),clock_timestamp())`,[licenseId,q.tenant_id,q.plan_id,mode,terms.service_from,terms.service_until,terms.policy_reference,reference]);
      if(!Array.isArray(q.entitlements_snapshot)||q.entitlements_snapshot.length>256)throw Error("LICENSING_QUOTE_FEATURES_INVALID");
      for(const f of q.entitlements_snapshot){
        if(typeof f.capability_code!=="string"||typeof f.enabled!=="boolean"||!["FINITE","UNLIMITED","NOT_APPLICABLE"].includes(f.limit_type)||
          (f.limit_type==="FINITE"?typeof f.limit_value!=="string"||!/^\d+$/.test(f.limit_value):f.limit_value!==null))throw Error("LICENSING_QUOTE_FEATURES_INVALID");
        await c.query(`INSERT INTO licensing.license_entitlements(id,license_id,capability_code,enabled,limit_type,limit_value,source_plan_version,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,[uuidV7(),licenseId,f.capability_code,f.enabled,f.limit_type,f.limit_value,q.plan_version]);
      }
      // GLOBAL audit remains global; the buyer and financial source are payload,
      // not an invented tenant membership for the platform administrator.
      const operationId=await new PostgresSubscriptionLicenseOutbox().publish(c,{licenseId,tenantId:q.tenant_id,companyId:q.company_id,paymentId,quoteId:q.id,correlationId});
      const payload=canonicalSessionTrustJson({license_id:licenseId,payment_id:paymentId,quote_id:q.id,quote_checksum:q.quote_checksum,operation_id:operationId,
        tenant_id:q.tenant_id,company_id:q.company_id,plan_version:String(q.plan_version),activation_status:"NOT_ACTIVATED"});
      if(!await permissions.findActivePlatformPermissionForSession(sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs))
        throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'PAID_SUBSCRIPTION_LICENSE_ISSUED','LICENSE','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
        [uuidV7(),actor.user_id,sessionId,licenseId,correlationId,payload,createHash("sha256").update(payload).digest("hex")]);
      await c.query("COMMIT");return {licenseId,contractStatus:"ACTIVE",activationStatus:"NOT_ACTIVATED" as const,idempotent:false};
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
}
