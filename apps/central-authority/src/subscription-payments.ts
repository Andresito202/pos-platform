import {createHash} from "node:crypto";
import {UuidSchema,uuidV7,canonicalSessionTrustJson} from "@pos-platform/contracts";
import {PostgresSubscriptionPaymentOutbox,type Pool,type PoolClient} from "@pos-platform/database-postgres";
import {FactusPayQuoteVerifier} from "./factus-pay-quote-verifier.js";

/** Central Payments adapter for the existing canonical aggregates. No Sale,
 * local cash movement, license or delivery is fabricated to collect a plan. */
export class SubscriptionPayments {
  private readonly outbox=new PostgresSubscriptionPaymentOutbox();
  private readonly merchantBranch:Readonly<{tenantId:string;companyId:string;branchId:string}>;
  constructor(private readonly pool:Pool,private readonly verifier:FactusPayQuoteVerifier,
    merchantBranch:{tenantId:string;companyId:string;branchId:string},
    private readonly limits:{lockTimeoutMs:number;statementTimeoutMs:number}){
    this.merchantBranch=Object.freeze({tenantId:merchantBranch.tenantId,companyId:merchantBranch.companyId,branchId:merchantBranch.branchId});
    if(!(verifier instanceof FactusPayQuoteVerifier))throw Error("SUBSCRIPTION_PAYMENT_TRUSTED_VERIFIER_REQUIRED");
    for(const id of Object.values(this.merchantBranch))UuidSchema.parse(id);
    if(![limits.lockTimeoutMs,limits.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs)
      throw Error("SUBSCRIPTION_PAYMENT_LIMITS_REQUIRED");
  }

  /** Persist intent BEFORE any provider operation. PENDING is not paid and does
   * not mean that a QR was created; provider dispatch remains a separate step. */
  async reserve(quoteId:string,correlationId:string){
    UuidSchema.parse(quoteId);UuidSchema.parse(correlationId);
    const c=await this.pool.connect();try{
      await c.query("BEGIN");await this.configure(c);
      const q=(await c.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1 AND expires_at>clock_timestamp()",[quoteId])).rows[0];
      if(!q)throw Error("SUBSCRIPTION_PAYMENT_CURRENT_QUOTE_REQUIRED");
      const b=this.merchantBranch;
      if(q.merchant_tenant_id!==b.tenantId||q.merchant_company_id!==b.companyId||q.currency_code!=="COP")throw Error("SUBSCRIPTION_PAYMENT_MERCHANT_MISMATCH");
      await this.branch(c);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`subscription-payment:${b.tenantId}:${quoteId}`]);
      const micros=BigInt(q.total_minor)*10n**BigInt(6-q.currency_exponent);
      if(micros<=0n)throw Error("SUBSCRIPTION_PAYMENT_POSITIVE_AMOUNT_REQUIRED");
      const amount=`${micros/1000000n}.${String(micros%1000000n).padStart(6,"0")}`;
      const checksum=this.checksum(q.quote_checksum,q.provider_reference);
      let group=(await c.query("SELECT * FROM payments.payment_groups WHERE tenant_id=$1 AND collection_subject_type='SUBSCRIPTION_QUOTE' AND collection_subject_id=$2",[b.tenantId,quoteId])).rows[0];
      if(group){
        if(group.request_checksum!==checksum||group.branch_id!==b.branchId)throw Error("SUBSCRIPTION_PAYMENT_IDEMPOTENCY_CONFLICT");
        const existing=(await c.query("SELECT p.id,p.status,a.id AS attempt_id FROM payments.payments p JOIN payments.payment_attempts a ON a.payment_id=p.id WHERE p.payment_group_id=$1",[group.id])).rows;
        if(existing.length!==1)throw Error("SUBSCRIPTION_PAYMENT_INCOMPLETE_INTENT");
        await c.query("COMMIT");return {paymentId:String(existing[0].id),attemptId:String(existing[0].attempt_id),state:String(existing[0].status),providerReference:String(q.provider_reference),idempotent:true};
      }
      const groupId=uuidV7(),paymentId=uuidV7(),attemptId=uuidV7(),key="subscription:"+quoteId;
      group=(await c.query(`INSERT INTO payments.payment_groups(id,tenant_id,company_id,branch_id,collection_subject_type,collection_subject_id,currency_code,
        expected_payable_amount,idempotency_key,request_checksum,correlation_id,created_at)
        VALUES($1,$2,$3,$4,'SUBSCRIPTION_QUOTE',$5,'COP',$6,$7,$8,$9,clock_timestamp()) RETURNING *`,
        [groupId,b.tenantId,b.companyId,b.branchId,quoteId,amount,key,checksum,correlationId])).rows[0];
      await c.query(`INSERT INTO payments.payments(id,tenant_id,company_id,branch_id,payment_group_id,payment_method,expected_amount,confirmed_amount,currency_code,
        status,authority_type,operator_actor_type,idempotency_key,request_checksum,correlation_id,created_at,server_recorded_at)
        VALUES($1,$2,$3,$4,$5,'QR',$6,0,'COP','CREATED','EXTERNAL_PROVIDER_AUTHORITATIVE','SYSTEM',$7,$8,$9,clock_timestamp(),clock_timestamp())`,
        [paymentId,b.tenantId,b.companyId,b.branchId,groupId,amount,key,checksum,correlationId]);
      await c.query(`INSERT INTO payments.payment_attempts(id,tenant_id,company_id,branch_id,payment_id,attempt_number,payment_method,provider_code,provider_reference_type,
        provider_reference,integration_id,amount,currency_code,status,authority_type,intent_reference,idempotency_key,request_checksum,correlation_id,initiated_at,server_recorded_at)
        VALUES($1,$2,$3,$4,$5,1,'QR','FACTUS_PAY','COLLECTION',$6,$7,$8,'COP','CREATED','EXTERNAL_PROVIDER_AUTHORITATIVE',$9,$9,$10,$11,clock_timestamp(),clock_timestamp())`,
        [attemptId,b.tenantId,b.companyId,b.branchId,paymentId,q.provider_reference,q.integration_id,amount,key,checksum,correlationId]);
      await c.query("UPDATE payments.payments SET status='PENDING',version=version+1 WHERE id=$1",[paymentId]);
      await c.query("UPDATE payments.payment_attempts SET status='PENDING',version=version+1 WHERE id=$1",[attemptId]);
      const operationId=await this.outbox.publish(c,{operation:"RESERVED",...b,paymentId,quoteId,buyerTenantId:q.tenant_id,buyerCompanyId:q.company_id,
        amount,providerReference:q.provider_reference,correlationId});
      await this.audit(c,"SUBSCRIPTION_PAYMENT_RESERVED",quoteId,paymentId,correlationId,{amount,currency_code:"COP",provider_reference:q.provider_reference,state:"PENDING"},operationId);
      await c.query("COMMIT");return {paymentId,attemptId,state:"PENDING",providerReference:String(q.provider_reference),idempotent:false};
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }

  /** Only a live receipt minted by THIS API verifier reaches the transaction.
   * The verifier rechecks quote, merchant and credential under locks. */
  confirm(receipt:unknown,correlationId:string){
    UuidSchema.parse(correlationId);
    return this.verifier.consume(receipt,async(c,e)=>{
      await this.configure(c);
      const b=this.merchantBranch;
      if(e.merchant.tenantId!==b.tenantId||e.merchant.companyId!==b.companyId)throw Error("SUBSCRIPTION_PAYMENT_MERCHANT_MISMATCH");
      await this.branch(c);
      const rows=(await c.query(`SELECT p.*,g.collection_subject_id,g.request_checksum AS group_checksum,a.id AS attempt_id,a.status AS attempt_status,
        a.provider_reference,a.integration_id
        FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id WHERE g.tenant_id=$1 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        AND g.collection_subject_id=$2 FOR UPDATE OF p,a`,[b.tenantId,e.quoteId])).rows;
      if(rows.length!==1)throw Error("SUBSCRIPTION_PAYMENT_RESERVED_ATTEMPT_REQUIRED");
      const p=rows[0];
      if(p.company_id!==b.companyId||p.branch_id!==b.branchId||p.group_checksum!==this.checksum(e.quoteChecksum,e.providerReference)||
        p.provider_reference!==e.providerReference||p.integration_id!==e.merchant.integrationId||p.expected_amount!==e.amount||p.currency_code!==e.currencyCode||
        (p.created_at as Date).getTime()>Date.parse(e.verifiedAt))throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_MISMATCH");
      if(p.status==="CONFIRMED"&&p.attempt_status==="CONFIRMED"){
        if((await c.query("SELECT 1 FROM payments.payment_allocations WHERE tenant_id=$1 AND payment_id=$2 AND collection_subject_id=$3 AND amount=$4 AND currency_code='COP'",[b.tenantId,p.id,e.quoteId,e.amount])).rowCount!==1)
          throw Error("SUBSCRIPTION_PAYMENT_ALLOCATION_INCONSISTENT");
        return {paymentId:String(p.id),quoteId:e.quoteId,state:"CONFIRMED" as const,idempotent:true,activationStatus:"NOT_ACTIVATED" as const};
      }
      if(p.status!=="PENDING"||p.attempt_status!=="PENDING")throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      const evidence=canonicalSessionTrustJson(e),hash=createHash("sha256").update(evidence).digest("hex");
      await c.query("UPDATE payments.payments SET status='CONFIRMED',confirmed_amount=expected_amount,confirmed_at=clock_timestamp(),server_recorded_at=clock_timestamp(),version=version+1 WHERE id=$1",[p.id]);
      await c.query(`UPDATE payments.payment_attempts SET status='CONFIRMED',evidence_snapshot=$2::jsonb,evidence_checksum=$3,
        confirmed_at=clock_timestamp(),server_recorded_at=clock_timestamp(),version=version+1 WHERE id=$1`,[p.attempt_id,evidence,hash]);
      await c.query(`INSERT INTO payments.payment_allocations(id,tenant_id,payment_group_id,payment_id,collection_subject_type,collection_subject_id,amount,currency_code,allocation_sequence,created_at)
        VALUES($1,$2,$3,$4,'SUBSCRIPTION_QUOTE',$5,$6,'COP',1,clock_timestamp())`,[uuidV7(),b.tenantId,p.payment_group_id,p.id,e.quoteId,e.amount]);
      const operationId=await this.outbox.publish(c,{operation:"CONFIRMED",...b,paymentId:p.id,quoteId:e.quoteId,buyerTenantId:e.buyerTenantId,
        buyerCompanyId:e.buyerCompanyId,amount:e.amount,providerReference:e.providerReference,correlationId});
      await this.audit(c,"SUBSCRIPTION_PAYMENT_CONFIRMED",e.quoteId,p.id,correlationId,{amount:e.amount,currency_code:e.currencyCode,provider_reference:e.providerReference,evidence_checksum:hash},operationId);
      return {paymentId:String(p.id),quoteId:e.quoteId,state:"CONFIRMED" as const,idempotent:false,activationStatus:"NOT_ACTIVATED" as const};
    });
  }

  /** A QR response records collection readiness only. It can never be consumed
   * as payment evidence; confirmation requires the separate GET receipt. */
  recordCollection(receipt:unknown,correlationId:string){
    UuidSchema.parse(correlationId);
    return this.verifier.consumeCollection(receipt,async(c,e)=>{
      await this.configure(c);await this.branch(c);
      const b=this.merchantBranch;
      if(e.merchant.tenantId!==b.tenantId||e.merchant.companyId!==b.companyId)throw Error("SUBSCRIPTION_PAYMENT_MERCHANT_MISMATCH");
      const rows=(await c.query(`SELECT p.id,p.status,p.company_id,p.branch_id,p.expected_amount,g.request_checksum,a.id AS attempt_id,
        a.status AS attempt_status,a.provider_reference,a.integration_id,a.evidence_snapshot
        FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id JOIN payments.payment_attempts a ON a.payment_id=p.id
        WHERE g.tenant_id=$1 AND g.collection_subject_id=$2 AND g.collection_subject_type='SUBSCRIPTION_QUOTE' FOR UPDATE OF p,a`,[b.tenantId,e.quoteId])).rows;
      const p=rows[0];
      if(rows.length!==1||!p||p.company_id!==b.companyId||p.branch_id!==b.branchId||p.expected_amount!==e.amount||
        p.request_checksum!==this.checksum(e.quoteChecksum,e.providerReference)||p.provider_reference!==e.providerReference||p.integration_id!==e.merchant.integrationId)
        throw Error("SUBSCRIPTION_PAYMENT_EVIDENCE_MISMATCH");
      if(p.status!=="PENDING"||p.attempt_status!=="PENDING")throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      const snapshot={profile:"FACTUS_COLLECTION_PREPARED_V1",provider_reference:e.providerReference,
        collection_status:e.collectionStatus,qr:e.qr,verified_at:e.verifiedAt};
      const previous=p.evidence_snapshot;
      if(previous?.profile===snapshot.profile&&previous.qr===snapshot.qr&&previous.collection_status===snapshot.collection_status)
        return {paymentId:String(p.id),state:"PENDING" as const,collectionStatus:e.collectionStatus,idempotent:true};
      const serialized=canonicalSessionTrustJson(snapshot),checksum=createHash("sha256").update(serialized).digest("hex");
      await c.query("UPDATE payments.payment_attempts SET evidence_snapshot=$2::jsonb,evidence_checksum=$3,server_recorded_at=clock_timestamp(),version=version+1 WHERE id=$1",[p.attempt_id,serialized,checksum]);
      const payload=canonicalSessionTrustJson({quote_id:e.quoteId,collection_status:e.collectionStatus,evidence_checksum:checksum});
      await c.query(`INSERT INTO audit.audit_events(id,tenant_id,company_id,branch_id,actor_type,action_code,resource_type,resource_reference_kind,
        resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,$2,$3,$4,'SYSTEM','SUBSCRIPTION_COLLECTION_PREPARED','PAYMENT','INSTANCE',$5,$6,1,clock_timestamp(),clock_timestamp(),'PENDING',$7::jsonb,$8)`,
        [uuidV7(),b.tenantId,b.companyId,b.branchId,p.id,correlationId,payload,createHash("sha256").update(payload).digest("hex")]);
      return {paymentId:String(p.id),state:"PENDING" as const,collectionStatus:e.collectionStatus,idempotent:false};
    });
  }

  /** Expired quotes cannot auto-confirm late money or activate rights. Preserve
   * the financial intent for reconciliation instead of silently abandoning it. */
  async reviewExpired(quoteId:string,correlationId:string){
    UuidSchema.parse(quoteId);UuidSchema.parse(correlationId);
    const c=await this.pool.connect();try{
      await c.query("BEGIN");await this.configure(c);await this.branch(c);const b=this.merchantBranch;
      const rows=(await c.query(`SELECT p.id,p.status,a.id AS attempt_id,a.status AS attempt_status,q.provider_reference,
        q.tenant_id,q.company_id,p.expected_amount::text FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        WHERE q.id=$1 AND p.tenant_id=$2 AND p.company_id=$3 AND p.branch_id=$4 AND q.expires_at<=clock_timestamp()
        FOR UPDATE OF p,a`,[quoteId,b.tenantId,b.companyId,b.branchId])).rows;
      const row=rows[0];if(rows.length!==1||!row)throw Error("SUBSCRIPTION_PAYMENT_EXPIRED_INTENT_REQUIRED");
      if(row.status==="REVIEW_REQUIRED"&&row.attempt_status==="REVIEW_REQUIRED"){
        await c.query("COMMIT");return {state:"REVIEW_REQUIRED" as const,idempotent:true};}
      if(row.status!=="PENDING"||row.attempt_status!=="PENDING")throw Error("SUBSCRIPTION_PAYMENT_NOT_PENDING");
      await c.query("UPDATE payments.payments SET status='REVIEW_REQUIRED',server_recorded_at=clock_timestamp(),version=version+1 WHERE id=$1",[row.id]);
      await c.query("UPDATE payments.payment_attempts SET status='REVIEW_REQUIRED',error_code='QUOTE_EXPIRED_RECONCILIATION_REQUIRED',server_recorded_at=clock_timestamp(),version=version+1 WHERE id=$1",[row.attempt_id]);
      const operationId=await this.outbox.publish(c,{operation:"REVIEW_REQUIRED",...b,paymentId:row.id,quoteId,buyerTenantId:row.tenant_id,
        buyerCompanyId:row.company_id,amount:row.expected_amount,providerReference:row.provider_reference,correlationId});
      await this.audit(c,"SUBSCRIPTION_PAYMENT_REVIEW_REQUIRED",quoteId,row.id,correlationId,{reason:"QUOTE_EXPIRED_RECONCILIATION_REQUIRED"},operationId);
      await c.query("COMMIT");return {state:"REVIEW_REQUIRED" as const,idempotent:false};
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }

  private checksum(quoteChecksum:string,providerReference:string){return createHash("sha256").update(canonicalSessionTrustJson({quoteChecksum,providerReference,merchantBranch:this.merchantBranch})).digest("hex");}
  private async configure(c:PoolClient){
    await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",[`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`]);
    if((await c.query("SELECT current_user='pos_platform_app' AS eligible")).rows[0]?.eligible!==true)throw Error("SUBSCRIPTION_PAYMENT_CENTRAL_ROLE_REQUIRED");
  }
  private async branch(c:PoolClient){
    const b=this.merchantBranch;await c.query("SELECT set_config('app.tenant_id',$1,true)",[b.tenantId]);
    if((await c.query("SELECT id FROM organization.branches WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE",[b.tenantId,b.companyId,b.branchId])).rowCount!==1)
      throw Error("SUBSCRIPTION_PAYMENT_ACTIVE_MERCHANT_BRANCH_REQUIRED");
  }
  private audit(c:PoolClient,action:string,quoteId:string,paymentId:string,correlationId:string,detail:Record<string,unknown>,operationId:string){
    const b=this.merchantBranch,payload=canonicalSessionTrustJson({quote_id:quoteId,payment_id:paymentId,...detail});
    return c.query(`INSERT INTO audit.audit_events(id,tenant_id,company_id,branch_id,actor_type,action_code,resource_type,resource_reference_kind,resource_id,operation_id,
      correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
      VALUES($1,$2,$3,$4,'SYSTEM',$5,'PAYMENT','INSTANCE',$6,$7,$8,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$9::jsonb,$10)`,
      [uuidV7(),b.tenantId,b.companyId,b.branchId,action,paymentId,operationId,correlationId,payload,createHash("sha256").update(payload).digest("hex")]);
  }
}
