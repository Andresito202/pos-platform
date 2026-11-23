import {createHash} from "node:crypto";
import {
  canonicalSessionTrustJson,
  isSubscriptionFulfillmentRetryableError,
  subscriptionFulfillmentBackoffMs,
  uuidV7,
  UuidSchema,
  type SubscriptionFulfillmentConfirmationSource,
  type SubscriptionFulfillmentProvision,
} from "@pos-platform/contracts";
import {
  PostgresSubscriptionLicenseFulfillmentQueue,
  type Pool,
} from "@pos-platform/database-postgres";
import {subscriptionAmountToScale6} from "./subscription-quote-contracts.js";
import {SubscriptionLicenseContracts,type FulfillmentPolicyReferences} from "./subscription-license-contracts.js";
import type {SubscriptionFactusPayGateway} from "./subscription-factus-pay-gateway.js";
import {SubscriptionFactusPayGatewayError} from "./subscription-factus-pay-gateway.js";

function sha256(value:string):string{
  return createHash("sha256").update(value).digest("hex");
}

function normalizeNumericText(value:string):string{
  if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(value))throw Error("SUBSCRIPTION_AMOUNT_FORMAT_INVALID");
  const [whole,frac=""]=value.split(".");
  return `${whole}.${frac.padEnd(6,"0").slice(0,6)}`;
}

function errorCodeOf(error:unknown):string{
  if(error instanceof SubscriptionFactusPayGatewayError)return error.code;
  if(error instanceof Error&&error.message)return error.message.slice(0,128);
  return "FULFILLMENT_UNKNOWN_ERROR";
}

/**
 * Autonomous recoverable fulfillment after authoritative payment confirmation.
 * SERVICE actor only — never synthesizes GLOBAL sessions or MFA.
 */
export class SubscriptionLicenseFulfillment{
  readonly queue:PostgresSubscriptionLicenseFulfillmentQueue;
  private readonly licenses:SubscriptionLicenseContracts;

  constructor(
    private readonly pool:Pool,
    private readonly provision:SubscriptionFulfillmentProvision,
    approvedPolicies:readonly FulfillmentPolicyReferences[],
    private readonly factusPay:SubscriptionFactusPayGateway|null=null,
  ){
    this.queue=new PostgresSubscriptionLicenseFulfillmentQueue(pool,{
      lockTimeoutMs:provision.lock_timeout_ms,
      statementTimeoutMs:provision.statement_timeout_ms,
      claimTtlMs:provision.claim_ttl_ms,
    });
    this.licenses=new SubscriptionLicenseContracts(
      pool,
      approvedPolicies,
      {
        reauthenticationMs:provision.claim_ttl_ms,
        lockTimeoutMs:provision.lock_timeout_ms,
        statementTimeoutMs:provision.statement_timeout_ms,
      },
      provision.policy_reference,
    );
  }

  /** Durable enqueue after an authoritative confirmation (Factus or bank-manual). */
  async enqueueConfirmedPayment(input:{
    paymentId:string;
    source:Exclude<SubscriptionFulfillmentConfirmationSource,"PENDING_WEBHOOK">;
    correlationId:string;
  }):Promise<"INSERTED"|"EXISTING">{
    UuidSchema.parse(input.paymentId);
    const meta=await this.loadPaymentMeta(input.paymentId);
    return this.queue.enqueue({
      paymentId:input.paymentId,
      quoteId:meta.quoteId,
      tenantId:meta.tenantId,
      companyId:meta.companyId,
      confirmationSource:input.source,
      correlationId:input.correlationId,
      status:"CONFIRMED",
      confirmedAt:new Date(),
    });
  }

  /**
   * Enqueue a pending subscription payment for authoritative provider GET polling.
   * Does not invent paid status — processDue/confirmPendingAsService must observe
   * FACTUS Pay status "paid" (or a durable webhook inbox row) before issuing.
   */
  async enqueuePendingProviderPoll(input:{
    paymentId:string;
    correlationId:string;
  }):Promise<"INSERTED"|"EXISTING">{
    UuidSchema.parse(input.paymentId);
    UuidSchema.parse(input.correlationId);
    const preview=await this.loadPendingPayment(input.paymentId);
    if(!preview.providerReference)throw Error("SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED");
    const meta=await this.loadPaymentMeta(input.paymentId);
    return this.queue.enqueue({
      paymentId:input.paymentId,
      quoteId:meta.quoteId,
      tenantId:meta.tenantId,
      companyId:meta.companyId,
      confirmationSource:"PENDING_WEBHOOK",
      correlationId:input.correlationId,
      status:"PENDING",
      confirmedAt:null,
    });
  }

  /** Immediate SERVICE issue attempt after confirm; failures leave the durable job. */
  async tryIssueAsService(paymentId:string,correlationId:string){
    UuidSchema.parse(paymentId);UuidSchema.parse(correlationId);
    try{
      const issued=await this.licenses.issueAsService(paymentId,correlationId);
      await this.queue.markIssuedPipeline(paymentId,issued.licenseId,null);
      return {issued,issueError:null as string|null};
    }catch(error){
      return {issued:null,issueError:errorCodeOf(error)};
    }
  }

  async recordIssued(paymentId:string,licenseId:string){
    await this.queue.markIssuedPipeline(paymentId,licenseId,null);
  }

  /**
   * Link a durable Factus webhook observation to a SUBSCRIPTION_QUOTE payment only.
   * POS / non-subscription inbox rows are ignored.
   */
  async enqueueFromWebhookObservation(input:{
    tenantId:string;
    companyId:string;
    integrationId:string;
    externalTransactionId:string;
    amountScale6:string;
    currencyCode:string;
    correlationId?:string;
  }):Promise<"ENQUEUED"|"IGNORED"|"DUPLICATE">{
    if(input.currencyCode!=="COP")return "IGNORED";
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id',$3,true)",
        [`${this.provision.lock_timeout_ms}ms`,`${this.provision.statement_timeout_ms}ms`,input.tenantId],
      );
      const row=(await c.query(
        `SELECT p.id::text AS payment_id,q.id::text AS quote_id,q.tenant_id::text AS tenant_id,q.company_id::text AS company_id,
                q.total_minor,q.currency_exponent,p.status AS payment_status,a.status AS attempt_status,
                i.id::text AS inbox_id
         FROM payments.payment_attempts a
         JOIN payments.payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id
         JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
         JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
         LEFT JOIN integrations.factus_pay_webhook_inbox i
           ON i.tenant_id=a.tenant_id AND i.company_id=a.company_id AND i.integration_id=a.integration_id
          AND i.external_transaction_id=a.provider_reference
         WHERE a.tenant_id=$1 AND a.company_id=$2 AND a.integration_id=$3
           AND a.provider_code='FACTUS_PAY' AND a.provider_reference=$4
           AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
         FOR SHARE OF p,a`,
        [input.tenantId,input.companyId,input.integrationId,input.externalTransactionId],
      )).rows[0] as {
        payment_id:string;quote_id:string;tenant_id:string;company_id:string;
        total_minor:string|number;currency_exponent:number;payment_status:string;attempt_status:string;
        inbox_id:string|null;
      }|undefined;
      if(!row){
        await c.query("COMMIT");
        return "IGNORED";
      }
      const expected=subscriptionAmountToScale6(Number(row.total_minor),Number(row.currency_exponent));
      if(normalizeNumericText(input.amountScale6)!==expected){
        await c.query("COMMIT");
        return "IGNORED";
      }
      const status=row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"?"CONFIRMED":"PENDING";
      const result=await this.queue.enqueueOnClient(c,{
        paymentId:row.payment_id,
        quoteId:row.quote_id,
        tenantId:row.tenant_id,
        companyId:row.company_id,
        confirmationSource:status==="CONFIRMED"?"FACTUS_PAY_WEBHOOK_INBOX":"PENDING_WEBHOOK",
        correlationId:input.correlationId??uuidV7(),
        status,
        confirmedAt:status==="CONFIRMED"?new Date():null,
        inboxObservationId:row.inbox_id,
      });
      await c.query("COMMIT");
      return result==="INSERTED"?"ENQUEUED":"DUPLICATE";
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }

  /**
   * Recover paid subscription webhooks already acknowledged by the durable inbox
   * but not enqueued due to a crash or a transient database error. The provider
   * does not need to retransmit a webhook after receiving HTTP 204.
   *
   * This scanner never turns a webhook into a confirmed payment: the existing
   * payment verifier performs the authoritative evidence checks under locks.
   */
  async recoverUnqueuedSubscriptionWebhooks(limit=32):Promise<{recovered:number;errors:string[]}>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error("FULFILLMENT_RECOVERY_LIMIT_INVALID");
    const rows=(await this.pool.query(`
      SELECT i.tenant_id::text AS tenant_id,i.company_id::text AS company_id,
             i.integration_id::text AS integration_id,
             i.external_transaction_id,i.amount::text AS amount_scale6,i.currency_code
      FROM integrations.factus_pay_webhook_inbox i
      JOIN payments.payment_attempts a
        ON a.tenant_id=i.tenant_id AND a.company_id=i.company_id
       AND a.integration_id=i.integration_id
       AND a.provider_code='FACTUS_PAY'
       AND a.provider_reference=i.external_transaction_id
      JOIN payments.payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id
      JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
      JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
      LEFT JOIN subscriptions.license_fulfillment_jobs j ON j.payment_id=p.id
      WHERE g.collection_subject_type='SUBSCRIPTION_QUOTE'
        AND j.payment_id IS NULL
        AND i.provider_status='paid' AND i.currency_code='COP'
        AND i.processing_status IN ('PENDING','RETRY_SCHEDULED','PROCESSING')
        AND p.status IN ('PENDING','CONFIRMED')
        AND a.status IN ('PENDING','CONFIRMED')
        AND q.merchant_tenant_id=i.tenant_id AND q.merchant_company_id=i.company_id
        AND q.integration_id=i.integration_id
        AND i.amount=q.total_minor::numeric/power(10::numeric,q.currency_exponent)
      ORDER BY i.received_at,i.id LIMIT $1
    `,[limit])).rows as Array<{
      tenant_id:string;company_id:string;integration_id:string;
      external_transaction_id:string;amount_scale6:string;currency_code:string;
    }>;
    let recovered=0;
    const errors:string[]=[];
    for(const row of rows){
      try{
        const result=await this.enqueueFromWebhookObservation({
          tenantId:row.tenant_id,companyId:row.company_id,integrationId:row.integration_id,
          externalTransactionId:row.external_transaction_id,
          amountScale6:row.amount_scale6,currencyCode:row.currency_code,
        });
        if(result==="ENQUEUED"||result==="DUPLICATE")recovered+=1;
      }catch(error){
        errors.push(errorCodeOf(error));
      }
    }
    return {recovered,errors};
  }

  /** One claim/process cycle — safe under multi-instance SKIP LOCKED claims. */
  async processDue(limit=1):Promise<{processed:number;issued:number;retried:number;errors:string[]}>{
    const claimed=await this.queue.claimDue(limit);
    let issued=0,retried=0;
    const errors:string[]=[];
    for(const job of claimed){
      try{
        if(job.attemptCount>this.provision.max_attempts){
          await this.queue.markRetry(job.id,job.claimToken,"FULFILLMENT_MAX_ATTEMPTS",
            new Date(Date.now()+this.provision.max_backoff_ms));
          retried+=1;
          errors.push("FULFILLMENT_MAX_ATTEMPTS");
          continue;
        }
        if(job.status==="PENDING"){
          const confirmed=await this.confirmPendingAsService(job.paymentId,job.correlationId);
          await this.queue.markConfirmed(job.id,job.claimToken,confirmed.source,confirmed.inboxId);
          // Re-queue immediately as CONFIRMED for issue (claim released by markConfirmed).
          continue;
        }
        const result=await this.licenses.issueAsService(job.paymentId,job.correlationId);
        await this.queue.markIssuedPipeline(job.paymentId,result.licenseId,job.claimToken);
        issued+=1;
      }catch(error){
        const code=errorCodeOf(error);
        errors.push(code);
        const retryable=isSubscriptionFulfillmentRetryableError(code)
          ||code.includes("timeout")
          ||code.includes("TIMEOUT")
          ||code.includes("ECONN")
          ||code.includes("network");
        const backoff=subscriptionFulfillmentBackoffMs(
          job.attemptCount,
          this.provision.base_backoff_ms,
          this.provision.max_backoff_ms,
          retryable?0.2:0,
        );
        try{
          await this.queue.markRetry(job.id,job.claimToken,code,new Date(Date.now()+backoff));
          retried+=1;
        }catch(markError){
          errors.push(errorCodeOf(markError));
        }
      }
    }
    return {processed:claimed.length,issued,retried,errors};
  }

  startBackgroundWorker(signal?:AbortSignal):()=>void{
    let stopped=false;
    const tick=async()=>{
      if(stopped||signal?.aborted)return;
      try{await this.recoverUnqueuedSubscriptionWebhooks();}catch{/* next poll retries */}
      try{await this.processDue(4);}catch{/* next poll retries */}
    };
    const handle=setInterval(()=>{void tick();},this.provision.poll_interval_ms);
    void tick();
    const stop=()=>{stopped=true;clearInterval(handle);};
    signal?.addEventListener("abort",stop,{once:true});
    return stop;
  }

  /**
   * Confirm a pending subscription payment using GET and/or durable webhook inbox.
   * SYSTEM audit — no GLOBAL session.
   */
  private async confirmPendingAsService(
    paymentId:string,
    correlationId:string,
  ):Promise<{source:Exclude<SubscriptionFulfillmentConfirmationSource,"PENDING_WEBHOOK">;inboxId:string|null}>{
    UuidSchema.parse(paymentId);UuidSchema.parse(correlationId);

    const preview=await this.loadPendingPayment(paymentId);
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
        // Network/provider down → retryable; fall through to inbox if present.
      }
    }

    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.provision.lock_timeout_ms}ms`,`${this.provision.statement_timeout_ms}ms`],
      );
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["subscription-payment:"+paymentId]);

      const row=(await c.query(`SELECT p.id AS payment_id,p.status AS payment_status,p.expected_amount::text AS expected_amount,
          p.currency_code,p.tenant_id,p.company_id,a.id AS attempt_id,a.status AS attempt_status,
          a.provider_reference,a.integration_id,a.evidence_snapshot,q.id AS quote_id,q.quote_checksum,
          q.provider_reference AS quote_provider_reference,q.expires_at,q.total_minor,q.currency_exponent
        FROM payments.payments p
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id AND a.tenant_id=p.tenant_id
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        FOR UPDATE OF p,a`,[paymentId])).rows[0] as {
        payment_id:string;payment_status:string;expected_amount:string;currency_code:string;
        tenant_id:string;company_id:string;attempt_id:string;attempt_status:string;
        provider_reference:string;integration_id:string;evidence_snapshot:unknown;
        quote_id:string;quote_checksum:string;quote_provider_reference:string;expires_at:Date;
        total_minor:string|number;currency_exponent:number;
      }|undefined;
      if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
      if(row.provider_reference!==row.quote_provider_reference)throw Error("SUBSCRIPTION_PAYMENT_REFERENCE_MISMATCH");
      if(row.currency_code!=="COP")throw Error("SUBSCRIPTION_PAYMENT_CURRENCY_MISMATCH");

      if(row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"){
        const source=(row.evidence_snapshot as {source?:string}|null)?.source;
        if(source==="FACTUS_PAY_GET"||source==="FACTUS_PAY_WEBHOOK_INBOX"||source==="BANK_MANUAL_VERIFIED"){
          await c.query("COMMIT");
          return {
            source,
            inboxId:(row.evidence_snapshot as {inboxId?:string}|null)?.inboxId??null,
          };
        }
        throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_CONFLICT");
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
        if(inbox.currency_code!=="COP"||inbox.provider_status!=="paid"){
          throw Error("SUBSCRIPTION_PAYMENT_NOT_PAID");
        }
        if(normalizeNumericText(inbox.amount)!==expectedScale6){
          throw Error("SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH");
        }
        if(inbox.processing_status==="PROCESSED"){
          // Already consumed — if payment still pending, evidence conflict.
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
        confirmedBy:"SUBSCRIPTION_LICENSE_FULFILLMENT_SERVICE",
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
        actor:"SERVICE",
      });
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'SYSTEM',NULL,NULL,'SUBSCRIPTION_PAYMENT_CONFIRMED_BY_SERVICE','PAYMENT','INSTANCE',$2,$3,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$4::jsonb,$5)`,
        [uuidV7(),row.payment_id,correlationId,payload,sha256(payload)]);
      await c.query("COMMIT");
      return {source,inboxId};
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }

  private async loadPaymentMeta(paymentId:string){
    const row=(await this.pool.query(
      `SELECT q.id::text AS quote_id,q.tenant_id::text AS tenant_id,q.company_id::text AS company_id
       FROM payments.payments p
       JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
       JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
       WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'`,
      [paymentId],
    )).rows[0] as {quote_id:string;tenant_id:string;company_id:string}|undefined;
    if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
    return {quoteId:row.quote_id,tenantId:row.tenant_id,companyId:row.company_id};
  }

  private async loadPendingPayment(paymentId:string){
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.provision.lock_timeout_ms}ms`,`${this.provision.statement_timeout_ms}ms`],
      );
      const row=(await c.query(`SELECT p.status AS payment_status,a.status AS attempt_status,a.provider_reference,
          q.total_minor,q.currency_exponent,q.expires_at
        FROM payments.payments p
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id AND a.tenant_id=p.tenant_id
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE p.id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        FOR SHARE OF p,a`,[paymentId])).rows[0] as {
        payment_status:string;attempt_status:string;provider_reference:string;
        total_minor:string|number;currency_exponent:number;expires_at:Date;
      }|undefined;
      if(!row)throw Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");
      if(row.payment_status==="CONFIRMED"&&row.attempt_status==="CONFIRMED"){
        await c.query("COMMIT");
        return {
          providerReference:row.provider_reference,
          expectedScale6:subscriptionAmountToScale6(Number(row.total_minor),Number(row.currency_exponent)),
        };
      }
      if(row.payment_status!=="PENDING"||row.attempt_status!=="PENDING"){
        throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      }
      if(row.expires_at.getTime()<=Date.now())throw Error("SUBSCRIPTION_QUOTE_EXPIRED");
      await c.query("COMMIT");
      return {
        providerReference:row.provider_reference,
        expectedScale6:subscriptionAmountToScale6(Number(row.total_minor),Number(row.currency_exponent)),
      };
    }catch(error){
      await c.query("ROLLBACK");
      throw error;
    }finally{
      c.release();
    }
  }
}
