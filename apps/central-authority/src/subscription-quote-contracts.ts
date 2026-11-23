import {createHash} from "node:crypto";
import {
  CentralAdministrationOperation,
  SubscriptionPaymentConfirmRequestSchema,
  SubscriptionQuoteRequestSchema,
  SubscriptionQuoteTermsSchema,
  addLicenseCalendarMonths,
  canonicalSessionTrustJson,
  previewLicenseOffer,
  uuidV7,
  UuidSchema,
  type SubscriptionCollectionBinding,
} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,type Pool} from "@pos-platform/database-postgres";
import {readPublishedLicenseOffer} from "./license-offer-reader.js";
import type {FulfillmentPolicyReferences} from "./subscription-license-contracts.js";

type Policy=FulfillmentPolicyReferences;
type PricingPreview=ReturnType<typeof previewLicenseOffer>;

function sha256(value:string):string{
  return createHash("sha256").update(value).digest("hex");
}

function payableAmount(totalMinor:number,exponent:number):string{
  if(!Number.isSafeInteger(totalMinor)||totalMinor<=0||!Number.isSafeInteger(exponent)||exponent<0||exponent>6){
    throw Error("SUBSCRIPTION_QUOTE_AMOUNT_INVALID");
  }
  const scale=10**exponent;
  const whole=Math.trunc(totalMinor/scale);
  const fraction=String(totalMinor%scale).padStart(exponent,"0");
  return exponent===0?String(whole):`${whole}.${fraction}`;
}

function buildTerms(input:{
  offer:PricingPreview;
  planPolicy:string;
  policies:readonly Policy[];
  selectionSupport:boolean;
  companyId:string;
  now:Date;
}):ReturnType<typeof SubscriptionQuoteTermsSchema.parse>{
  const policy=input.policies.find(p=>p.policy_reference===input.planPolicy)??input.policies[0];
  if(!policy)throw Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");
  const serviceFrom=input.now.toISOString();
  const termMonths="term_months" in input.offer?input.offer.term_months??null:null;
  const supportMonths="support_term_months" in input.offer?input.offer.support_term_months??null:null;
  const serviceUntil=termMonths===null||termMonths===undefined?null:addLicenseCalendarMonths(serviceFrom,termMonths);
  const supportUntil=input.selectionSupport&&supportMonths
    ?addLicenseCalendarMonths(serviceFrom,supportMonths)
    :null;
  const expiresAt=new Date(input.now.getTime()+72*60*60*1000).toISOString();
  return SubscriptionQuoteTermsSchema.parse({
    policy_reference:policy.policy_reference,
    tax_policy_reference:policy.tax_policy_reference,
    support_policy_reference:policy.support_policy_reference,
    customer_verification_reference:`COMPANY:${input.companyId}`,
    // Catalog COP prices are treated as payable totals; no invented VAT rate.
    tax_mode:"INCLUDED",
    tax_minor:0,
    currency_exponent:"currency_exponent" in input.offer?Number(input.offer.currency_exponent):2,
    service_from:serviceFrom,
    service_until:serviceUntil,
    support_until:supportUntil,
    expires_at:expiresAt,
  });
}

/**
 * Creates immutable subscription quotes from published catalog prices and opens
 * the matching QR payment group/attempt. Confirmation records provider evidence
 * without inventing amounts. LICENSE_ISSUE remains the only issuer of contracts.
 */
export class SubscriptionQuoteContracts{
  constructor(
    private readonly pool:Pool,
    private readonly approvedPolicies:readonly Policy[]|null,
    private readonly collection:SubscriptionCollectionBinding|null,
    private readonly limits:{reauthenticationMs:number;lockTimeoutMs:number;statementTimeoutMs:number},
  ){
    if(!Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs){
      throw Error("SUBSCRIPTION_QUOTE_EXPLICIT_LIMITS_REQUIRED");
    }
  }

  async create(sessionId:string,raw:unknown){
    const request=SubscriptionQuoteRequestSchema.parse(raw);
    UuidSchema.parse(sessionId);
    if(!this.approvedPolicies?.length)throw Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");
    if(!this.collection)throw Error("SUBSCRIPTION_COLLECTION_NOT_PROVISIONED");
    const collection=this.collection;
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`],
      );
      await c.query('SELECT "authorization".lock_platform_sources_for_read()');
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
      const permissions=new PostgresPlatformAdministrationSessionRepository(c);
      const actor=await permissions.findActivePlatformPermissionForSession(
        sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs,
      );
      if(!actor)throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
      if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.sessions s ON s.id=h.session_id AND s.user_id=h.user_id
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
          AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        WHERE s.id=$1 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId])).rowCount!==1){
        throw Error("LICENSING_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
      }

      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`subscription-quote:${request.tenant_id}:${request.company_id}:${request.idempotency_key}`]);

      const prior=(await c.query(
        `SELECT q.id,q.request_checksum,q.quote_checksum,q.total_minor,q.currency_code,q.expires_at,p.id AS payment_id
         FROM subscriptions.license_quotes q
         JOIN payments.payment_groups g ON g.collection_subject_id=q.id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
         JOIN payments.payments p ON p.payment_group_id=g.id AND p.tenant_id=g.tenant_id
         WHERE q.tenant_id=$1 AND q.company_id=$2 AND q.idempotency_key=$3
         FOR SHARE OF q`,
        [request.tenant_id,request.company_id,request.idempotency_key],
      )).rows[0] as {
        id:string;request_checksum:string;quote_checksum:string;total_minor:string|number;
        currency_code:string;expires_at:Date;payment_id:string;
      }|undefined;

      const requestChecksum=sha256(canonicalSessionTrustJson({
        id:request.id,tenant_id:request.tenant_id,company_id:request.company_id,
        plan_id:request.plan_id,plan_version:request.plan_version,selection:request.selection,
      }));

      if(prior){
        if(prior.request_checksum!==requestChecksum)throw Error("SUBSCRIPTION_QUOTE_IDEMPOTENCY_CONFLICT");
        await c.query("COMMIT");
        return {
          quoteId:String(prior.id),
          paymentId:String(prior.payment_id),
          totalMinor:Number(prior.total_minor),
          currencyCode:String(prior.currency_code),
          expiresAt:prior.expires_at.toISOString(),
          quoteChecksum:String(prior.quote_checksum),
          idempotent:true as const,
        };
      }

      if((await c.query(
        `SELECT 1 FROM organization.companies co JOIN tenancy.tenants t ON t.id=co.tenant_id
         WHERE co.id=$1 AND co.tenant_id=$2 AND co.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF co,t`,
        [request.company_id,request.tenant_id],
      )).rowCount!==1)throw Error("SUBSCRIPTION_ACTIVE_BUYER_REQUIRED");

      if((await c.query(
        `SELECT 1 FROM integrations.external_integrations i
         WHERE i.id=$1 AND i.tenant_id=$2 AND i.company_id=$3 AND i.provider_code_snapshot='FACTUS_PAY'
           AND i.status='ACTIVE' FOR SHARE`,
        [collection.integration_id,collection.tenant_id,collection.company_id],
      )).rowCount!==1)throw Error("SUBSCRIPTION_COLLECTION_INTEGRATION_REQUIRED");

      if((await c.query(
        `SELECT 1 FROM organization.branches b
         WHERE b.id=$1 AND b.tenant_id=$2 AND b.company_id=$3 AND b.status='ACTIVE' FOR SHARE`,
        [collection.branch_id,collection.tenant_id,collection.company_id],
      )).rowCount!==1)throw Error("SUBSCRIPTION_COLLECTION_BRANCH_REQUIRED");

      const published=await readPublishedLicenseOffer(c,request.plan_id,request.plan_version);
      const preview=previewLicenseOffer(published.offer,request.selection,request.plan_version);
      if(preview.currency_code!=="COP")throw Error("SUBSCRIPTION_QUOTE_CURRENCY_REJECTED");
      const now=new Date();
      const terms=buildTerms({
        offer:preview,
        planPolicy:published.offer.policy_reference,
        policies:this.approvedPolicies,
        selectionSupport:request.selection.support,
        companyId:request.company_id,
        now,
      });
      if(preview.subtotal_minor<=0)throw Error("SUBSCRIPTION_QUOTE_AMOUNT_INVALID");

      const entitlements=published.features.map((feature:{
        capability_code:string;enabled:boolean;limit_type:string;limit_value:string|null;
      })=>({
        capability_code:feature.capability_code,
        enabled:feature.enabled===true,
        limit_type:feature.limit_type,
        limit_value:feature.limit_value,
      }));
      if(entitlements.length===0)throw Error("SUBSCRIPTION_QUOTE_FEATURES_REQUIRED");

      const pricingSnapshot={
        offer:published.offer,
        pricing:preview,
        selection:request.selection,
        deployment_mode:published.offer.deployment_mode,
      };
      const providerReference=uuidV7();
      const quoteChecksum=sha256(canonicalSessionTrustJson({
        id:request.id,
        tenant_id:request.tenant_id,
        company_id:request.company_id,
        merchant_tenant_id:collection.tenant_id,
        merchant_company_id:collection.company_id,
        integration_id:collection.integration_id,
        provider_reference:providerReference,
        plan_id:request.plan_id,
        plan_version:request.plan_version,
        currency_code:preview.currency_code,
        total_minor:preview.subtotal_minor,
        currency_exponent:terms.currency_exponent,
        included_registers:1,
        additional_registers:request.selection.additional_registers,
        pricing_snapshot:pricingSnapshot,
        terms_snapshot:terms,
        entitlements_snapshot:entitlements,
      }));

      await c.query(`INSERT INTO subscriptions.license_quotes(
        id,tenant_id,company_id,merchant_tenant_id,merchant_company_id,integration_id,provider_reference,
        plan_id,plan_version,currency_code,total_minor,currency_exponent,included_registers,additional_registers,
        pricing_snapshot,terms_snapshot,entitlements_snapshot,idempotency_key,request_checksum,quote_checksum,
        created_by_user_id,created_by_session_id,created_at,expires_at
      ) VALUES(
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,1,$13,
        $14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,
        $20,$21,clock_timestamp(),$22::timestamptz
      )`,[
        request.id,request.tenant_id,request.company_id,collection.tenant_id,collection.company_id,
        collection.integration_id,providerReference,request.plan_id,request.plan_version,preview.currency_code,
        preview.subtotal_minor,terms.currency_exponent,request.selection.additional_registers,
        JSON.stringify(pricingSnapshot),JSON.stringify(terms),JSON.stringify(entitlements),
        request.idempotency_key,requestChecksum,quoteChecksum,actor.user_id,sessionId,terms.expires_at,
      ]);

      const amount=payableAmount(preview.subtotal_minor,terms.currency_exponent);
      const groupId=uuidV7();
      const paymentId=uuidV7();
      const attemptId=uuidV7();
      const groupChecksum=sha256(canonicalSessionTrustJson({
        group_id:groupId,quote_id:request.id,amount,currency_code:"COP",
      }));
      const paymentChecksum=sha256(canonicalSessionTrustJson({
        payment_id:paymentId,group_id:groupId,amount,currency_code:"COP",
      }));
      const attemptChecksum=sha256(canonicalSessionTrustJson({
        attempt_id:attemptId,payment_id:paymentId,provider_reference:providerReference,amount,
      }));

      await c.query(`INSERT INTO payments.payment_groups(
        id,tenant_id,company_id,branch_id,collection_subject_type,collection_subject_id,currency_code,
        expected_payable_amount,idempotency_key,request_checksum,correlation_id,created_at
      ) VALUES($1,$2,$3,$4,'SUBSCRIPTION_QUOTE',$5,'COP',$6::numeric,$7,$8,$9,clock_timestamp())`,[
        groupId,collection.tenant_id,collection.company_id,collection.branch_id,request.id,amount,
        groupId,groupChecksum,request.correlation_id,
      ]);
      await c.query(`INSERT INTO payments.payments(
        id,tenant_id,company_id,branch_id,payment_group_id,payment_method,expected_amount,currency_code,status,
        authority_type,operator_actor_type,idempotency_key,request_checksum,correlation_id,created_at,server_recorded_at
      ) VALUES($1,$2,$3,$4,$5,'QR',$6::numeric,'COP','CREATED','EXTERNAL_PROVIDER_AUTHORITATIVE','SYSTEM',$7,$8,$9,clock_timestamp(),clock_timestamp())`,[
        paymentId,collection.tenant_id,collection.company_id,collection.branch_id,groupId,amount,
        paymentId,paymentChecksum,request.correlation_id,
      ]);
      await c.query(`INSERT INTO payments.payment_attempts(
        id,tenant_id,company_id,branch_id,payment_id,attempt_number,payment_method,provider_code,
        provider_reference_type,provider_reference,integration_id,amount,currency_code,status,authority_type,
        intent_reference,idempotency_key,request_checksum,correlation_id,initiated_at,server_recorded_at
      ) VALUES(
        $1,$2,$3,$4,$5,1,'QR','FACTUS_PAY','COLLECTION',$6,$7,$8::numeric,'COP','CREATED',
        'EXTERNAL_PROVIDER_AUTHORITATIVE',$9,$10,$11,$12,clock_timestamp(),clock_timestamp()
      )`,[
        attemptId,collection.tenant_id,collection.company_id,collection.branch_id,paymentId,
        providerReference,collection.integration_id,amount,`SUBSCRIPTION_QUOTE:${request.id}`,
        attemptId,attemptChecksum,request.correlation_id,
      ]);
      await c.query("UPDATE payments.payments SET status='PENDING',version=version+1,server_recorded_at=clock_timestamp() WHERE id=$1 AND status='CREATED'",[paymentId]);
      await c.query("UPDATE payments.payment_attempts SET status='PENDING',version=version+1,server_recorded_at=clock_timestamp() WHERE id=$1 AND status='CREATED'",[attemptId]);

      const payload=canonicalSessionTrustJson({
        quote_id:request.id,payment_id:paymentId,quote_checksum:quoteChecksum,
        total_minor:preview.subtotal_minor,plan_id:request.plan_id,plan_version:request.plan_version,
      });
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'SUBSCRIPTION_QUOTE_OPENED','SUBSCRIPTION_QUOTE','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
        [uuidV7(),actor.user_id,sessionId,request.id,request.correlation_id,payload,sha256(payload)]);

      if(!await permissions.findActivePlatformPermissionForSession(
        sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs,
      ))throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");

      await c.query("COMMIT");
      return {
        quoteId:request.id,
        paymentId,
        totalMinor:preview.subtotal_minor,
        currencyCode:preview.currency_code,
        expiresAt:terms.expires_at,
        quoteChecksum,
        idempotent:false as const,
      };
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }

  async confirmPayment(sessionId:string,raw:unknown){
    const request=SubscriptionPaymentConfirmRequestSchema.parse(raw);
    UuidSchema.parse(sessionId);
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`],
      );
      await c.query('SELECT "authorization".lock_platform_sources_for_read()');
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
      const permissions=new PostgresPlatformAdministrationSessionRepository(c);
      const actor=await permissions.findActivePlatformPermissionForSession(
        sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs,
      );
      if(!actor)throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
      if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.sessions s ON s.id=h.session_id AND s.user_id=h.user_id
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
          AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        WHERE s.id=$1 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId])).rowCount!==1){
        throw Error("LICENSING_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
      }

      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["subscription-payment:"+request.payment_id]);

      const row=(await c.query(`SELECT p.id AS payment_id,p.status AS payment_status,p.expected_amount::text AS expected_amount,
          p.confirmed_amount::text AS confirmed_amount,p.currency_code,a.id AS attempt_id,a.status AS attempt_status,
          a.provider_reference,a.evidence_snapshot,q.id AS quote_id,q.quote_checksum,q.provider_reference AS quote_provider_reference,
          q.expires_at,g.id AS group_id
        FROM payments.payments p
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id AND a.tenant_id=p.tenant_id
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        FOR UPDATE OF p,a`,[request.payment_id])).rows[0] as {
        payment_id:string;payment_status:string;expected_amount:string;confirmed_amount:string;currency_code:string;
        attempt_id:string;attempt_status:string;provider_reference:string;evidence_snapshot:unknown;
        quote_id:string;quote_checksum:string;quote_provider_reference:string;expires_at:Date;group_id:string;
      }|undefined;
      if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
      if(row.provider_reference!==row.quote_provider_reference)throw Error("SUBSCRIPTION_PAYMENT_REFERENCE_MISMATCH");

      if(row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"){
        const evidence=row.evidence_snapshot as {quoteChecksum?:string;quoteId?:string;providerReference?:string}|null;
        if(evidence?.quoteChecksum!==row.quote_checksum||evidence?.quoteId!==row.quote_id
          ||evidence?.providerReference!==row.quote_provider_reference){
          throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_CONFLICT");
        }
        await c.query("COMMIT");
        return {paymentId:row.payment_id,quoteId:row.quote_id,status:"CONFIRMED" as const,idempotent:true as const};
      }

      if(row.payment_status!=="PENDING"||row.attempt_status!=="PENDING"){
        throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      }
      if(row.expires_at.getTime()<=Date.now())throw Error("SUBSCRIPTION_QUOTE_EXPIRED");

      const evidence={
        quoteId:row.quote_id,
        quoteChecksum:row.quote_checksum,
        providerReference:row.quote_provider_reference,
        observationReference:request.observation_reference,
      };
      const evidenceJson=canonicalSessionTrustJson(evidence);
      const evidenceChecksum=sha256(evidenceJson);

      await c.query(`UPDATE payments.payment_attempts
        SET status='CONFIRMED',evidence_snapshot=$2::jsonb,evidence_checksum=$3,provider_reported_at=clock_timestamp(),
            confirmed_at=clock_timestamp(),server_recorded_at=clock_timestamp(),version=version+1
        WHERE id=$1 AND status='PENDING'`,[row.attempt_id,evidence,evidenceChecksum]);
      await c.query(`UPDATE payments.payments
        SET status='CONFIRMED',confirmed_amount=expected_amount,confirmed_at=clock_timestamp(),
            server_recorded_at=clock_timestamp(),version=version+1
        WHERE id=$1 AND status='PENDING'`,[row.payment_id]);
      await c.query(`INSERT INTO payments.payment_allocations(
        id,tenant_id,payment_group_id,payment_id,collection_subject_type,collection_subject_id,amount,currency_code,
        allocation_sequence,created_at
      ) SELECT $1,p.tenant_id,p.payment_group_id,p.id,'SUBSCRIPTION_QUOTE',$2,p.confirmed_amount,p.currency_code,1,clock_timestamp()
        FROM payments.payments p WHERE p.id=$3`,[uuidV7(),row.quote_id,row.payment_id]);

      const payload=canonicalSessionTrustJson({
        payment_id:row.payment_id,quote_id:row.quote_id,observation_reference:request.observation_reference,
      });
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'SUBSCRIPTION_PAYMENT_CONFIRMED','PAYMENT','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
        [uuidV7(),actor.user_id,sessionId,row.payment_id,request.correlation_id,payload,sha256(payload)]);

      if(!await permissions.findActivePlatformPermissionForSession(
        sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs,
      ))throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");

      await c.query("COMMIT");
      return {paymentId:row.payment_id,quoteId:row.quote_id,status:"CONFIRMED" as const,idempotent:false as const};
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }
}
