import {createHash} from "node:crypto";
import {LicenseOfferDraftSchema,previewLicenseOffer,CanonicalPermission,uuidV7,UuidSchema,canonicalSessionTrustJson,type LicenseOfferDraft} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,type Pool,type PoolClient} from "@pos-platform/database-postgres";

/** Internal administration persistence only. No HTTP endpoint or session issuer.
 * sessionId MUST come from an authenticated GLOBAL transport; a UUID submitted
 * by a browser is not authentication. Rechecks actual MFA and explicit grant;
 * a BUSINESS cashier/owner is never platform authority. No grants are seeded. */
export class LicenseOfferDrafts{
  constructor(private readonly pool:Pool,private readonly maximumReauthenticationAgeMs:number){
    if(!Number.isSafeInteger(maximumReauthenticationAgeMs)||maximumReauthenticationAgeMs<=0)throw Error("LICENSE_ADMIN_REAUTHENTICATION_POLICY_REQUIRED");
  }
  private async transaction<T>(sessionId:string,work:(c:PoolClient,userId:string)=>Promise<T>){
    UuidSchema.parse(sessionId);const c=await this.pool.connect();let begun=false;
    try{await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");begun=true;
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
      const checked=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,CanonicalPermission.LICENSE_PLAN_MANAGE,this.maximumReauthenticationAgeMs);
      if(!checked)throw Error("LICENSE_PLAN_MANAGE_REQUIRED");
      const result=await work(c,checked.user_id);await c.query("COMMIT");begun=false;return result;
    }catch(error){if(begun)await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  /** Edit by new immutable version; exact expected version prevents lost edits.
   * Idempotency is the new plan UUID + identical full payload/version. */
  save(sessionId:string,input:unknown,expectedVersion:number,correlationId:string){
    const p=LicenseOfferDraftSchema.parse(input);UuidSchema.parse(correlationId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw Error("LICENSE_PLAN_EXPECTED_VERSION_REQUIRED");
    return this.transaction(sessionId,async(c,userId)=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["license-offer:"+p.code]);
      const all=(await c.query("SELECT * FROM licensing.plans WHERE code=$1 ORDER BY version DESC",[p.code])).rows;
      const same=all.find(row=>row.id===p.id),version=expectedVersion+1;
      if(same){if(Number(same.version)!==version||canonicalSessionTrustJson(this.offer(same))!==canonicalSessionTrustJson(p))throw Error("LICENSE_OFFER_IDEMPOTENCY_CONFLICT");return {planId:p.id,version,idempotent:true};}
      if(Number(all[0]?.version??0)!==expectedVersion)throw Error("LICENSE_OFFER_VERSION_CONFLICT");
      await c.query(`INSERT INTO licensing.plans(id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,version,created_at,updated_at,
        offer_profile,included_registers,additional_register_price_minor,support_price_minor,support_charge,offer_policy_reference)
        VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,clock_timestamp(),clock_timestamp(),'CAMACHO_LICENSE_OFFER_V1',1,$9,$10,$11,$12)`,
        [p.id,p.code,p.name,p.billing_model,p.deployment_mode,p.currency_code,p.price_minor,version,p.additional_register_price_minor,p.support_price_minor,p.support_charge,p.policy_reference]);
      // A price-only edit must not silently erase the existing feature catalog.
      // Copy canonical plan metadata, never fabricate license/user entitlements.
      if(all[0]){
        const features=(await c.query("SELECT id FROM licensing.plan_entitlements WHERE plan_id=$1",[all[0].id])).rows;
        for(const feature of features)await c.query(`INSERT INTO licensing.plan_entitlements(id,plan_id,capability_code,enabled,limit_type,limit_value,created_at)
          SELECT $1,$2,capability_code,enabled,limit_type,limit_value,clock_timestamp() FROM licensing.plan_entitlements WHERE id=$3`,[uuidV7(),p.id,feature.id]);
      }
      const payload=canonicalSessionTrustJson({...p,version,status:"DRAFT"});
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'LICENSE_OFFER_DRAFT_VERSIONED','LICENSE_PLAN','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
        [uuidV7(),userId,sessionId,p.id,correlationId,payload,createHash("sha256").update(payload).digest("hex")]);
      return {planId:p.id,version,idempotent:false};
    });
  }
  preview(sessionId:string,planId:string,selection:unknown){
    UuidSchema.parse(planId);return this.transaction(sessionId,async c=>{
      const row=(await c.query("SELECT * FROM licensing.plans WHERE id=$1 AND offer_profile='CAMACHO_LICENSE_OFFER_V1' AND status IN ('DRAFT','ACTIVE')",[planId])).rows[0];
      if(!row)throw Error("LICENSE_OFFER_NOT_AVAILABLE");return previewLicenseOffer(this.offer(row),selection,Number(row.version));
    });
  }
  /** Publishes an offer only, never a license. Replaces the active price version
   * atomically; a stale draft cannot roll the catalog back to an older version. */
  publish(sessionId:string,planId:string,expectedVersion:number,correlationId:string){
    UuidSchema.parse(planId);UuidSchema.parse(correlationId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw Error("LICENSE_PLAN_EXPECTED_VERSION_REQUIRED");
    return this.transaction(sessionId,async(c,userId)=>{
      const row=(await c.query("SELECT * FROM licensing.plans WHERE id=$1 AND offer_profile='CAMACHO_LICENSE_OFFER_V1'",[planId])).rows[0];
      if(!row||Number(row.version)!==expectedVersion)throw Error("LICENSE_OFFER_VERSION_CONFLICT");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["license-offer:"+row.code]);
      this.offer(row);
      if(row.status==="ACTIVE")return {planId,version:expectedVersion,idempotent:true};
      const latest=(await c.query("SELECT max(version)::text AS version FROM licensing.plans WHERE code=$1",[row.code])).rows[0];
      if(row.status!=="DRAFT"||Number(latest.version)!==expectedVersion)throw Error("LICENSE_OFFER_STALE_PUBLICATION_REJECTED");
      await c.query("UPDATE licensing.plans SET status='RETIRED',updated_at=clock_timestamp() WHERE code=$1 AND status='ACTIVE'",[row.code]);
      const changed=await c.query("UPDATE licensing.plans SET status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1 AND status='DRAFT' RETURNING id",[planId]);
      if(changed.rowCount!==1)throw Error("LICENSE_OFFER_PUBLICATION_CONFLICT");
      const payload=canonicalSessionTrustJson({planId,version:expectedVersion,status:"ACTIVE"});
      await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
        correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,'PLATFORM_ACCOUNT',$2,$3,'LICENSE_OFFER_PUBLISHED','LICENSE_PLAN','INSTANCE',$4,$5,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$6::jsonb,$7)`,
        [uuidV7(),userId,sessionId,planId,correlationId,payload,createHash("sha256").update(payload).digest("hex")]);
      return {planId,version:expectedVersion,idempotent:false};
    });
  }
  /** Read model for future plan cards. Backend status/price/features only; no
   * customer input, tenant authorization, token or activation is synthesized. */
  async published(){
    const c=await this.pool.connect();let begun=false;
    try{await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");begun=true;
      const rows=(await c.query("SELECT * FROM licensing.plans WHERE status='ACTIVE' AND offer_profile='CAMACHO_LICENSE_OFFER_V1' ORDER BY billing_model,code")).rows;
      const result=[];
      for(const row of rows){const features=(await c.query("SELECT capability_code,enabled,limit_type,limit_value::text FROM licensing.plan_entitlements WHERE plan_id=$1 ORDER BY capability_code",[row.id])).rows;
        result.push({...this.offer(row),version:Number(row.version),status:"ACTIVE" as const,features});}
      await c.query("COMMIT");begun=false;return result;
    }catch(e){if(begun)await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  private offer(row:Record<string,unknown>):LicenseOfferDraft{
    return LicenseOfferDraftSchema.parse({id:row.id,code:row.code,name:row.name,billing_model:row.billing_model,deployment_mode:row.deployment_mode,currency_code:row.currency_code,
      price_minor:Number(row.price_minor),included_registers:row.included_registers,additional_register_price_minor:Number(row.additional_register_price_minor),
      support_price_minor:Number(row.support_price_minor),support_charge:row.support_charge,policy_reference:row.offer_policy_reference});
  }
}
