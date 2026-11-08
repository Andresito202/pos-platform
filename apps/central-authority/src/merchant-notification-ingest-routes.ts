import {
  PostgresMerchantNotificationDeviceProofVerifier,
  type DeviceProofRequest,type Pool,type PoolClient,
} from "@pos-platform/database-postgres";
import {MerchantPaymentNoticeObservationSchema,type VerifiedMerchantNotificationBridgeScope} from "@pos-platform/domain";
import {PostgresUnverifiedMerchantNotificationInbox} from "./merchant-notification-inbox.js";

/**
 * This boundary is deliberately narrower than a bank payment API.
 * It consumes a one-time Ed25519 DEVICE_TRUST proof and checks a separately
 * granted merchant/installation consent in the SAME transaction as insert.
 * Device registry ACTIVE alone is NEVER notification-ingest authorization.
 */
export class MerchantNotificationIngestRoutes {
  private readonly verifier:PostgresMerchantNotificationDeviceProofVerifier;
  private readonly inbox:PostgresUnverifiedMerchantNotificationInbox;
  constructor(private readonly pool:Pool){
    this.verifier=new PostgresMerchantNotificationDeviceProofVerifier(pool);
    this.inbox=new PostgresUnverifiedMerchantNotificationInbox(pool,
      (client,scope)=>this.assertConsentUnderLock(client,scope));
  }
  private async assertConsentUnderLock(client:PoolClient,scope:VerifiedMerchantNotificationBridgeScope){
    const r=await client.query(`SELECT 1 FROM payments.merchant_notification_bridge_consents c
      JOIN identity.device_registry d ON d.installation_id=c.installation_id
        AND d.tenant_id=c.tenant_id AND d.company_id=c.company_id
      WHERE c.tenant_id=$1 AND c.company_id=$2 AND c.installation_id=$3
        AND c.revoked_at IS NULL AND d.status='ACTIVE'
      FOR SHARE OF c`,[scope.tenantId,scope.companyId,scope.installationId]);
    if(r.rowCount!==1)throw Error("QR002_BRIDGE_NOT_AUTHORIZED_OR_CONSENT_REVOKED");
  }
  async handle(input:DeviceProofRequest):Promise<{accepted:true;inserted:boolean}|null>{
    if(typeof input.body!=="string"||Buffer.byteLength(input.body,"utf8")>2048)return null;
    let payload:unknown;
    try{payload=JSON.parse(input.body);}catch{return null;}
    const parsed=MerchantPaymentNoticeObservationSchema.safeParse(payload);
    if(!parsed.success||parsed.data.text_preview!==undefined)return null;
    const verified=await this.verifier.verifyIngestAndConsume(input);
    if(!verified)return null;
    const {inserted}=await this.inbox.appendFromAuthenticatedBridge({
      tenantId:verified.tenantId,companyId:verified.companyId,
      installationId:verified.installationId,
    },parsed.data);
    return {accepted:true,inserted};
  }
  /**
   * Device-only read projection for four authorized tills of the SAME company.
   * No bank settlement, SMS text, phone number or external-supplied sale ID.
   * Caller may not filter by tenant, company or claimed sale.
   */
  async recent(input:DeviceProofRequest):Promise<{notices:Array<{
    id:string;received_at:string;reported_amount_cop:number|null;
    payer_display:string|null;status:"UNVERIFIED";bank_confirmed:false;
    sale_confirmed:false;
  }> }|null>{
    let payload:unknown;
    try{payload=JSON.parse(input.body);}catch{return null;}
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||Object.keys(payload).length!==0)
      return null;
    const binding=await this.verifier.verifyRecentAndConsume(input);
    if(!binding)return null;
    const client=await this.pool.connect();let started=false;
    try{
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      started=true;
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[binding.tenantId]);
      await client.query("SELECT set_config('app.company_id',$1,true)",[binding.companyId]);
      await client.query("SET LOCAL statement_timeout='5s'");
      const result=await client.query(`SELECT n.id::text,n.received_at,
          n.reported_amount_cop::text AS reported_amount_cop,n.payer_display,
          n.status,n.bank_confirmed,n.sale_confirmed
        FROM payments.merchant_payment_notification_inbox n
        WHERE n.tenant_id=$1 AND n.company_id=$2
          AND EXISTS(
            SELECT 1 FROM payments.merchant_notification_bridge_consents c
            JOIN identity.device_registry d
              ON d.installation_id=c.installation_id AND d.tenant_id=c.tenant_id
                AND d.company_id=c.company_id AND d.status='ACTIVE'
            WHERE c.tenant_id=n.tenant_id AND c.company_id=n.company_id
              AND c.revoked_at IS NULL
          )
        ORDER BY n.received_at DESC,n.id DESC LIMIT 25`,[
          binding.tenantId,binding.companyId,
        ]);
      const notices=result.rows.map(row=>{
        const amount=row.reported_amount_cop===null?null:Number(row.reported_amount_cop);
        if(row.status!=="UNVERIFIED"||row.bank_confirmed!==false||
           row.sale_confirmed!==false||
           (amount!==null&&(!Number.isSafeInteger(amount)||amount<1||amount>100_000_000))||
           (row.payer_display!==null&&(typeof row.payer_display!=="string"||row.payer_display.length>80)))
          throw Error("QR002_INVALID_STORED_NOTIFICATION");
        return {
          id:String(row.id),received_at:new Date(row.received_at).toISOString(),
          reported_amount_cop:amount,payer_display:row.payer_display as string|null,
          status:"UNVERIFIED" as const,bank_confirmed:false as const,
          sale_confirmed:false as const,
        };
      });
      await client.query("COMMIT");started=false;
      return {notices};
    }catch(error){if(started)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
  }

}
