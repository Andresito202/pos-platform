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
  constructor(pool:Pool){
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
}
