import {createHash} from "node:crypto";
import {LicenseOfferDraftSchema,previewLicenseOffer,CanonicalPermission,uuidV7,UuidSchema,canonicalSessionTrustJson,type LicenseOfferDraft} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,type Pool,type PoolClient} from "@pos-platform/database-postgres";
import {licenseOfferFromRow} from "./license-offer-reader.js";

/** Internal administration persistence only. No HTTP endpoint or session issuer.
 * sessionId MUST come from an authenticated GLOBAL transport; a UUID submitted
 * by a browser is not authentication. Rechecks actual MFA and explicit grant;
 * a BUSINESS cashier/owner is never platform authority. No grants are seeded. */
export class LicenseOfferDrafts{
  constructor(private readonly pool:Pool,private readonly maximumReauthenticationAgeMs:number,
    private readonly httpPolicy?:{origin:string;lockTimeoutMs:number;statementTimeoutMs:number}){
    if(!Number.isSafeInteger(maximumReauthenticationAgeMs)||maximumReauthenticationAgeMs<=0)throw Error("LICENSE_ADMIN_REAUTHENTICATION_POLICY_REQUIRED");
    if(httpPolicy&&(![httpPolicy.lockTimeoutMs,httpPolicy.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)||httpPolicy.statementTimeoutMs<=httpPolicy.lockTimeoutMs))
      throw Error("LICENSE_ADMIN_HTTP_POLICY_REQUIRED");
  }
  private async transaction<T>(sessionId:string,work:(c:PoolClient,userId:string)=>Promise<T>){
    UuidSchema.parse(sessionId);const c=await this.pool.connect();let begun=false;
    try{await c.query(this.httpPolicy?"BEGIN":"BEGIN ISOLATION LEVEL SERIALIZABLE");begun=true;
      if(this.httpPolicy){
        await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
          [`${this.httpPolicy.lockTimeoutMs}ms`,`${this.httpPolicy.statementTimeoutMs}ms`]);
        await c.query('SELECT "authorization".lock_platform_sources_for_read()');
        if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.users u ON u.id=h.user_id AND u.status='ACTIVE'
          JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
            AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
            AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
          JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
          WHERE h.session_id=$1 AND h.origin=$2 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId,this.httpPolicy.origin])).rowCount!==1)
          throw Error("LICENSE_ADMIN_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
      }
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
      const checked=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,CanonicalPermission.LICENSE_PLAN_MANAGE,this.maximumReauthenticationAgeMs);
      if(!checked)throw Error("LICENSE_PLAN_MANAGE_REQUIRED");
      const result=await work(c,checked.user_id);
      if(this.httpPolicy&&!await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,CanonicalPermission.LICENSE_PLAN_MANAGE,this.maximumReauthenticationAgeMs))
        throw Error("LICENSE_PLAN_MANAGE_REQUIRED");
      await c.query("COMMIT");begun=false;return result;
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
      const modern="profile" in p;
      await c.query(`INSERT INTO licensing.plans(id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,version,created_at,updated_at,
        offer_profile,included_registers,additional_register_price_minor,support_price_minor,support_charge,offer_policy_reference${modern?",currency_exponent,support_term_months,publication_scope":""})
        VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,clock_timestamp(),clock_timestamp(),$13,1,$9,$10,$11,$12${modern?",$14,$15,$16":""})`,
        [p.id,p.code,p.name,p.billing_model,p.deployment_mode,p.currency_code,p.price_minor,version,p.additional_register_price_minor,p.support_price_minor,p.support_charge,p.policy_reference,
          modern?p.profile:"CAMACHO_LICENSE_OFFER_V1",...(modern?[p.currency_exponent,p.support_term_months,p.publication_scope]:[])]);
      // A price-only edit must not silently erase the existing feature catalog.
      // Copy canonical plan metadata, never fabricate license/user entitlements.
      if(all[0]){
        const features=(await c.query("SELECT id FROM licensing.plan_entitlements WHERE plan_id=$1",[all[0].id])).rows;
        for(const feature of features)await c.query(`INSERT INTO licensing.plan_entitlements(id,plan_id,capability_code,enabled,limit_type,limit_value,created_at)
          SELECT $1,$2,capability_code,enabled,limit_type,limit_value,clock_timestamp() FROM licensing.plan_entitlements WHERE id=$3`,[uuidV7(),p.id,feature.id]);
      }
      else if(modern)await c.query(`INSERT INTO licensing.plan_entitlements(id,plan_id,capability_code,enabled,limit_type,limit_value,created_at)
        VALUES($1,$2,'CASH_REGISTER',true,'NOT_APPLICABLE',NULL,clock_timestamp())`,[uuidV7(),p.id]);
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
      const row=(await c.query("SELECT * FROM licensing.plans WHERE id=$1 AND offer_profile IN ('CAMACHO_LICENSE_OFFER_V1','CAMACHO_LICENSE_OFFER_V2') AND status IN ('DRAFT','ACTIVE')",[planId])).rows[0];
      if(!row)throw Error("LICENSE_OFFER_NOT_AVAILABLE");return previewLicenseOffer(this.offer(row),selection,Number(row.version));
    });
  }
  /** Publishes an offer only, never a license. Replaces the active price version
   * atomically; a stale draft cannot roll the catalog back to an older version. */
  publish(sessionId:string,planId:string,expectedVersion:number,correlationId:string){
    UuidSchema.parse(planId);UuidSchema.parse(correlationId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw Error("LICENSE_PLAN_EXPECTED_VERSION_REQUIRED");
    return this.transaction(sessionId,async(c,userId)=>{
      const row=(await c.query("SELECT * FROM licensing.plans WHERE id=$1 AND offer_profile IN ('CAMACHO_LICENSE_OFFER_V1','CAMACHO_LICENSE_OFFER_V2')",[planId])).rows[0];
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
  published(){return LicenseOfferDrafts.readPublished(this.pool);}
  static async readPublished(pool:Pool){
    const c=await pool.connect();let begun=false;
    try{await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");begun=true;
      const rows=(await c.query("SELECT * FROM licensing.plans WHERE status='ACTIVE' AND offer_profile IN ('CAMACHO_LICENSE_OFFER_V1','CAMACHO_LICENSE_OFFER_V2') ORDER BY billing_model,code")).rows;
      const result=[];
      for(const row of rows){const features=(await c.query("SELECT capability_code,enabled,limit_type,limit_value::text FROM licensing.plan_entitlements WHERE plan_id=$1 ORDER BY capability_code",[row.id])).rows;
        result.push({...licenseOfferFromRow(row),version:Number(row.version),status:"ACTIVE" as const,published_at:(row.updated_at as Date).toISOString(),features});}
      await c.query("COMMIT");begun=false;return result;
    }catch(e){if(begun)await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  /** Administrative recovery includes the latest DRAFT and current ACTIVE price;
   * a lost save response must not hide an already committed price version. */
  administrativeCatalog(sessionId:string){
    return this.transaction(sessionId,async c=>{
      const rows=(await c.query(`SELECT DISTINCT ON(code,status) * FROM licensing.plans WHERE offer_profile IN ('CAMACHO_LICENSE_OFFER_V1','CAMACHO_LICENSE_OFFER_V2')
        AND status IN ('DRAFT','ACTIVE') ORDER BY code,status,version DESC`)).rows;
      return rows.map(row=>({...this.offer(row),version:Number(row.version),status:String(row.status),published_at:row.status==='ACTIVE'?(row.updated_at as Date).toISOString():null}));
    });
  }
  private offer(row:Record<string,unknown>):LicenseOfferDraft{
    return licenseOfferFromRow(row);
  }
  /** Owner-approved initial data only; never a fallback for reads or a payment.
   * Each missing code becomes DRAFT. Existing prices/versions are untouched. */
  async initializePreproduction(sessionId:string){
    const existing=await this.administrativeCatalog(sessionId),created=[];
    for(const [model,base,extra,support] of [["MONTHLY",49900,19900,14900],["ANNUAL",499000,199000,149000],["PERPETUAL",1490000,490000,249000]] as const){
      const code="CAMACHO_"+model;if(existing.some(p=>p.code===code))continue;
      created.push(await this.save(sessionId,{id:uuidV7(),code,name:model==='MONTHLY'?"Mensual":model==='ANNUAL'?"Anual":"Perpetuo",billing_model:model,
        deployment_mode:model==='PERPETUAL'?"LOCAL_PERPETUAL":"HYBRID",currency_code:"COP",currency_exponent:2,price_minor:base*100,
        included_registers:1,additional_register_price_minor:extra*100,support_price_minor:support*100,support_charge:model==='PERPETUAL'?"OPTIONAL_12_MONTHS":"OPTIONAL_SAME_TERM",
        support_term_months:model==='MONTHLY'?1:12,policy_reference:"OWNER_PREPRODUCTION_2026_10_28",profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION"},0,uuidV7()));
    }
    return {created,scope:"PREPRODUCTION",status:"DRAFTS_ONLY"};
  }
}
