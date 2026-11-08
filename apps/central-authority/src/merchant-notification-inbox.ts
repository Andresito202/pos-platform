import {uuidV7} from "@pos-platform/contracts";
import {MerchantPaymentNoticeObservationSchema,projectUnverifiedMerchantNotice,
  type VerifiedMerchantNotificationBridgeScope} from "@pos-platform/domain";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";

/**
 * QR-002: no HTTP interface. An authenticated, consented phone MUST be verified
 * by a trusted Central component before this repository can be constructed.
 * This does not claim that an SMS proves a credit, or modify any sale/payment.
 */
export class PostgresUnverifiedMerchantNotificationInbox{
 constructor(private readonly pool:Pool,
  private readonly authorizeEnrolledBridge:(client:PoolClient,scope:VerifiedMerchantNotificationBridgeScope)=>Promise<void>){}
 async appendFromAuthenticatedBridge(scope:VerifiedMerchantNotificationBridgeScope,observation:unknown):
  Promise<{inserted:boolean;notice:ReturnType<typeof projectUnverifiedMerchantNotice>}>{
  const incoming=MerchantPaymentNoticeObservationSchema.parse(observation);
  // Do not persist SMS previews, phone numbers or free-form transaction text.
  if(incoming.text_preview!==undefined)throw Error("QR002_SMS_BODY_STORAGE_FORBIDDEN");
  const notice=projectUnverifiedMerchantNotice(scope,incoming);
  const arrival=Date.parse(notice.received_at);
  if(arrival>Date.now()+5*60_000||arrival<Date.now()-48*60*60_000)
    throw Error("QR002_STALE_OR_FUTURE_OBSERVATION");
  const client=await this.pool.connect();let started=false;
  try{
   await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
   started=true;
   await client.query("SELECT set_config('app.tenant_id',$1,true)",[notice.tenant_id]);
   await client.query("SELECT set_config('app.company_id',$1,true)",[notice.company_id]);
   await client.query("SET LOCAL lock_timeout='5s'");
   await client.query("SET LOCAL statement_timeout='10s'");
   // This gate must authenticate the device credential and check merchant
   // consent before any persistent state can change.
   await this.authorizeEnrolledBridge(client,scope);
   const args=[uuidV7(),notice.tenant_id,notice.company_id,
    notice.source_installation_id,notice.message_sha256,
    notice.observed_at,notice.received_at,notice.sender_label,
    notice.reported_amount_cop,notice.payer_display];
   const inserted=await client.query(`INSERT INTO payments.merchant_payment_notification_inbox
     (id,tenant_id,company_id,source_installation_id,message_sha256,
      observed_at,received_at,sender_label,reported_amount_cop,payer_display)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(tenant_id,company_id,source_installation_id,message_sha256) DO NOTHING
     RETURNING id`,args);
   if(inserted.rowCount!==0&&inserted.rowCount!==1)
     throw Error("QR002_UNEXPECTED_INSERT_RESULT");
   if(inserted.rowCount===0){
    const existing=await client.query(`SELECT source,observed_at,received_at,sender_label,reported_amount_cop,payer_display
      FROM payments.merchant_payment_notification_inbox
      WHERE tenant_id=$1 AND company_id=$2 AND source_installation_id=$3
        AND message_sha256=$4`,[notice.tenant_id,notice.company_id,
          notice.source_installation_id,notice.message_sha256]);
    if(existing.rowCount!==1||!existing.rows[0]||
       existing.rows[0].source!==notice.source||
       new Date(existing.rows[0].observed_at).toISOString()!==new Date(notice.observed_at).toISOString()||
       new Date(existing.rows[0].received_at).toISOString()!==new Date(notice.received_at).toISOString()||
       existing.rows[0].sender_label!==notice.sender_label||
       (existing.rows[0].reported_amount_cop===null?null:Number(existing.rows[0].reported_amount_cop))!==notice.reported_amount_cop||
       existing.rows[0].payer_display!==notice.payer_display)
      throw Error("QR002_NOTIFICATION_IDEMPOTENCY_CONFLICT");
   }
   await client.query("COMMIT");started=false;
   return {inserted:inserted.rowCount===1,notice};
  }catch(error){
   if(started)await client.query("ROLLBACK").catch(()=>undefined);
   throw error;
  }finally{client.release();}
 }
}
