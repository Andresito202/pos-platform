import {createHash} from "node:crypto";
import {
  CentralAdministrationOperation,
  SubscriptionPaymentVerifyRequestSchema,
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
import {
  SubscriptionFactusPayGatewayError,
  type SubscriptionFactusPayGateway,
} from "./subscription-factus-pay-gateway.js";

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

/** Catalog minor units → Factus Pay scale-6 expected by the existing client. */
export function subscriptionAmountToScale6(totalMinor:number,exponent:number):string{
  const payable=payableAmount(totalMinor,exponent);
  const [whole,frac=""]=payable.split(".");
  return `${whole}.${frac.padEnd(6,"0").slice(0,6)}`;
}

function normalizeNumericText(value:string):string{
  if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(value))throw Error("SUBSCRIPTION_AMOUNT_FORMAT_INVALID");
  const [whole,frac=""]=value.split(".");
  return `${whole}.${frac.padEnd(6,"0").slice(0,6)}`;
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
 * a Factus Pay collection when the gateway is provisioned. Confirmation requires
 * provider GET paid status and/or a durable webhook inbox observation — never a
 * free-text UI reference. LICENSE_ISSUE remains the only issuer of contracts.
 */
export class SubscriptionQuoteContracts{
  constructor(
    private readonly pool:Pool,
    private readonly approvedPolicies:readonly Policy[]|null,
    private readonly collection:SubscriptionCollectionBinding|null,
    private readonly limits:{reauthenticationMs:number;lockTimeoutMs:number;statementTimeoutMs:number},
    private readonly factusPay:SubscriptionFactusPayGateway|null=null,
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
          providerReference:null,
          providerOpenStatus:"IDEMPOTENT_EXISTING" as const,
          qr:null,
          paymentStatus:"PENDING" as const,
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

      // Provider I/O is outside the SQL transaction so locks are not held on network waits.
      let providerOpenStatus:"OPENED"|"NOT_CONFIGURED"|"PROVIDER_UNAVAILABLE"="NOT_CONFIGURED";
      let qr:string|null=null;
      const amountScale6=subscriptionAmountToScale6(preview.subtotal_minor,terms.currency_exponent);
      if(this.factusPay===null){
        return {
          quoteId:request.id,paymentId,totalMinor:preview.subtotal_minor,currencyCode:preview.currency_code,
          expiresAt:terms.expires_at,quoteChecksum,providerReference,providerOpenStatus,qr,
          paymentStatus:"PENDING" as const,idempotent:false as const,
        };
      }
      try{
        const opened=await this.factusPay.recoverOrCreateCollection({
          referenceCode:providerReference,
          amountScale6,
          expirationSeconds:Math.max(60,Math.floor((Date.parse(terms.expires_at)-Date.now())/1000)),
        });
        if(opened.referenceCode!==providerReference||opened.amountScale6!==amountScale6||opened.currencyCode!=="COP"){
          throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_COLLECTION_MISMATCH");
        }
        qr=opened.qr;
        providerOpenStatus="OPENED";
        const follow=await this.pool.connect();
        try{
          await follow.query("BEGIN");
          await follow.query(
            "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
            [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`],
          );
          await follow.query(
            `UPDATE payments.payment_attempts
             SET intent_reference=$2,version=version+1,server_recorded_at=clock_timestamp()
             WHERE id=$1 AND status='PENDING'`,
            [attemptId,`FACTUS_PAY_OPEN:${opened.status}:${opened.referenceCode}`],
          );
          await follow.query("COMMIT");
        }catch{
          await follow.query("ROLLBACK").catch(()=>undefined);
        }finally{follow.release();}
      }catch{
        providerOpenStatus="PROVIDER_UNAVAILABLE";
      }

      return {
        quoteId:request.id,
        paymentId,
        totalMinor:preview.subtotal_minor,
        currencyCode:preview.currency_code,
        expiresAt:terms.expires_at,
        quoteChecksum,
        providerReference,
        providerOpenStatus,
        qr,
        paymentStatus:"PENDING" as const,
        idempotent:false as const,
      };
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }

  /**
   * Authoritative verify only. Free-text references are rejected by schema.
   * Provider GET runs outside the SQL transaction; confirmation then consumes
   * that paid observation or a durable webhook inbox row under locks.
   */
  async verifyPayment(sessionId:string,raw:unknown){
    const request=SubscriptionPaymentVerifyRequestSchema.parse(raw);
    UuidSchema.parse(sessionId);

    const preview=await this.loadPaymentForVerify(sessionId,request.payment_id);
    if(preview.kind==="CONFIRMED"){
      return {paymentId:preview.paymentId,quoteId:preview.quoteId,status:"CONFIRMED" as const,idempotent:true as const};
    }

    let paidFromGet:{amountScale6:string}|null=null;
    if(this.factusPay!==null){
      try{
        const detail=await this.factusPay.getCollection({
          referenceCode:preview.providerReference,
          expectedAmountScale6:preview.expectedScale6,
        });
        if(detail.status==="paid"&&detail.referenceCode===preview.providerReference
          &&detail.amountScale6===preview.expectedScale6&&detail.currencyCode==="COP"){
          paidFromGet={amountScale6:detail.amountScale6};
        }
      }catch(error){
        if(error instanceof SubscriptionFactusPayGatewayError&&error.code==="FACTUS_PAY_AMOUNT_MISMATCH"){
          throw Error("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH");
        }
      }
    }

    return this.confirmPendingPayment(sessionId,request,paidFromGet);
  }

  private async loadPaymentForVerify(sessionId:string,paymentId:string){
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
      if(!await permissions.findActivePlatformPermissionForSession(
        sessionId,CentralAdministrationOperation.LICENSE_ISSUE,this.limits.reauthenticationMs,
      ))throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
      if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.sessions s ON s.id=h.session_id AND s.user_id=h.user_id
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
          AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        WHERE s.id=$1 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId])).rowCount!==1){
        throw Error("LICENSING_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
      }

      const row=(await c.query(`SELECT p.id AS payment_id,p.status AS payment_status,p.expected_amount::text AS expected_amount,
          p.currency_code,a.status AS attempt_status,a.provider_reference,a.evidence_snapshot,
          q.id AS quote_id,q.quote_checksum,q.provider_reference AS quote_provider_reference,
          q.expires_at,q.total_minor,q.currency_exponent
        FROM payments.payments p
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id AND a.tenant_id=p.tenant_id
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        FOR SHARE OF p,a`,[paymentId])).rows[0] as {
        payment_id:string;payment_status:string;expected_amount:string;currency_code:string;
        attempt_status:string;provider_reference:string;evidence_snapshot:unknown;
        quote_id:string;quote_checksum:string;quote_provider_reference:string;expires_at:Date;
        total_minor:string|number;currency_exponent:number;
      }|undefined;
      if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
      if(row.provider_reference!==row.quote_provider_reference)throw Error("SUBSCRIPTION_PAYMENT_REFERENCE_MISMATCH");
      if(row.currency_code!=="COP")throw Error("SUBSCRIPTION_PAYMENT_CURRENCY_MISMATCH");

      if(row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"){
        const evidence=row.evidence_snapshot as {quoteChecksum?:string;quoteId?:string;providerReference?:string;source?:string}|null;
        if(evidence?.quoteChecksum!==row.quote_checksum||evidence?.quoteId!==row.quote_id
          ||evidence?.providerReference!==row.quote_provider_reference
          ||(evidence?.source!=="FACTUS_PAY_GET"&&evidence?.source!=="FACTUS_PAY_WEBHOOK_INBOX")){
          throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_CONFLICT");
        }
        await c.query("COMMIT");
        return {kind:"CONFIRMED" as const,paymentId:row.payment_id,quoteId:row.quote_id};
      }
      if(row.payment_status!=="PENDING"||row.attempt_status!=="PENDING"){
        throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      }
      if(row.expires_at.getTime()<=Date.now())throw Error("SUBSCRIPTION_QUOTE_EXPIRED");
      const expectedScale6=subscriptionAmountToScale6(Number(row.total_minor),Number(row.currency_exponent));
      if(normalizeNumericText(row.expected_amount)!==expectedScale6){
        throw Error("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH");
      }
      await c.query("COMMIT");
      return {
        kind:"PENDING" as const,
        paymentId:row.payment_id,
        quoteId:row.quote_id,
        providerReference:row.provider_reference,
        expectedScale6,
      };
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }

  private async confirmPendingPayment(
    sessionId:string,
    request:{payment_id:string;correlation_id:string},
    paidFromGet:{amountScale6:string}|null,
  ){
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
          p.currency_code,p.tenant_id,p.company_id,a.id AS attempt_id,a.status AS attempt_status,
          a.provider_reference,a.integration_id,a.evidence_snapshot,q.id AS quote_id,q.quote_checksum,
          q.provider_reference AS quote_provider_reference,q.expires_at,q.total_minor,q.currency_exponent,g.id AS group_id
        FROM payments.payments p
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id AND a.tenant_id=p.tenant_id
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        FOR UPDATE OF p,a`,[request.payment_id])).rows[0] as {
        payment_id:string;payment_status:string;expected_amount:string;currency_code:string;
        tenant_id:string;company_id:string;attempt_id:string;attempt_status:string;
        provider_reference:string;integration_id:string;evidence_snapshot:unknown;
        quote_id:string;quote_checksum:string;quote_provider_reference:string;expires_at:Date;
        total_minor:string|number;currency_exponent:number;group_id:string;
      }|undefined;
      if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
      if(row.provider_reference!==row.quote_provider_reference)throw Error("SUBSCRIPTION_PAYMENT_REFERENCE_MISMATCH");
      if(row.currency_code!=="COP")throw Error("SUBSCRIPTION_PAYMENT_CURRENCY_MISMATCH");

      if(row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"){
        const evidence=row.evidence_snapshot as {quoteChecksum?:string;quoteId?:string;providerReference?:string;source?:string}|null;
        if(evidence?.quoteChecksum!==row.quote_checksum||evidence?.quoteId!==row.quote_id
          ||evidence?.providerReference!==row.quote_provider_reference
          ||(evidence?.source!=="FACTUS_PAY_GET"&&evidence?.source!=="FACTUS_PAY_WEBHOOK_INBOX")){
          throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_CONFLICT");
        }
        await c.query("COMMIT");
        return {paymentId:row.payment_id,quoteId:row.quote_id,status:"CONFIRMED" as const,idempotent:true as const};
      }

      if(row.payment_status!=="PENDING"||row.attempt_status!=="PENDING"){
        throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      }
      if(row.expires_at.getTime()<=Date.now())throw Error("SUBSCRIPTION_QUOTE_EXPIRED");

      const expectedScale6=subscriptionAmountToScale6(Number(row.total_minor),Number(row.currency_exponent));
      if(normalizeNumericText(row.expected_amount)!==expectedScale6){
        throw Error("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH");
      }

      let source:"FACTUS_PAY_GET"|"FACTUS_PAY_WEBHOOK_INBOX"|null=null;
      let inboxId:string|null=null;
      let providerAmount=expectedScale6;

      if(paidFromGet!==null&&paidFromGet.amountScale6===expectedScale6){
        source="FACTUS_PAY_GET";
        providerAmount=paidFromGet.amountScale6;
      }

      if(source===null){
        const inbox=(await c.query(
          `SELECT id::text AS id,amount::text AS amount,currency_code,provider_status,processing_status,integration_id::text AS integration_id
           FROM integrations.factus_pay_webhook_inbox
           WHERE tenant_id=$1 AND company_id=$2 AND integration_id=$3
             AND external_transaction_id=$4
           FOR UPDATE`,
          [row.tenant_id,row.company_id,row.integration_id,row.provider_reference],
        )).rows[0] as {
          id:string;amount:string;currency_code:string;provider_status:string;
          processing_status:string;integration_id:string;
        }|undefined;
        if(!inbox){
          throw Error(this.factusPay===null
            ?"SUBSCRIPTION_PAYMENT_NOT_VERIFIED"
            :"SUBSCRIPTION_PAYMENT_NOT_PAID");
        }
        if(inbox.integration_id!==row.integration_id)throw Error("SUBSCRIPTION_PAYMENT_INTEGRATION_MISMATCH");
        if(inbox.currency_code!=="COP"||inbox.provider_status!=="paid"){
          throw Error("SUBSCRIPTION_PAYMENT_NOT_PAID");
        }
        if(normalizeNumericText(inbox.amount)!==expectedScale6){
          throw Error("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH");
        }
        if(inbox.processing_status==="PROCESSED"){
          throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_REUSED");
        }
        if(!["PENDING","RETRY_SCHEDULED","PROCESSING"].includes(inbox.processing_status)){
          throw Error("SUBSCRIPTION_PAYMENT_NOT_VERIFIED");
        }
        if(inbox.processing_status==="PENDING"||inbox.processing_status==="RETRY_SCHEDULED"){
          await c.query(
            `UPDATE integrations.factus_pay_webhook_inbox
             SET processing_status='PROCESSING',attempt_count=attempt_count+1,version=version+1
             WHERE id=$1 AND processing_status IN ('PENDING','RETRY_SCHEDULED')`,
            [inbox.id],
          );
        }
        const consumed=await c.query(
          `UPDATE integrations.factus_pay_webhook_inbox
           SET processing_status='PROCESSED',processed_at=clock_timestamp(),version=version+1
           WHERE id=$1 AND processing_status='PROCESSING'
           RETURNING id`,
          [inbox.id],
        );
        if(consumed.rowCount!==1)throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_REUSED");
        source="FACTUS_PAY_WEBHOOK_INBOX";
        inboxId=inbox.id;
        providerAmount=normalizeNumericText(inbox.amount);
      }

      const evidence={
        quoteId:row.quote_id,
        quoteChecksum:row.quote_checksum,
        providerReference:row.quote_provider_reference,
        source,
        amountScale6:providerAmount,
        ...(inboxId?{inboxId}:{}),
      };
      const evidenceChecksum=sha256(canonicalSessionTrustJson(evidence));

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
        payment_id:row.payment_id,quote_id:row.quote_id,source,amount_scale6:providerAmount,
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
