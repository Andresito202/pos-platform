import {createHash,createPublicKey,sign,type KeyObject} from "node:crypto";
import {LicenseAllocationRequestSchema,LicenseActivationPolicySchema,LicenseCapacityClaimsSchema,canonicalSessionTrustJson,uuidV7,UuidSchema,
  type LicenseActivationPolicy,type SignedLicenseCapacity} from "@pos-platform/contracts";
import {PostgresDeviceProofReplayVerifier,type DeviceProofRequest,type Pool,type PoolClient} from "@pos-platform/database-postgres";
import {requireLicenseAdministrator} from "./license-administration.js";

export const LICENSE_ACTIVATION_PATH="/v1/licensing/activations/resolve";
class ActivationPossession extends PostgresDeviceProofReplayVerifier{
  consume(request:DeviceProofRequest){return this.verifyTargetAndConsume(request,LICENSE_ACTIVATION_PATH);}
}
const bytes=(v:unknown)=>Buffer.from(canonicalSessionTrustJson(v));
const checksum=(v:unknown)=>createHash("sha256").update(bytes(v)).digest();

/** Canonical Licensing state, not a second identity or a device-count license.
 * GLOBAL allocates paid register IDs; only the exact live DEV003 credential
 * can activate/download. Cash still resolves actual register existence/scope.
 * No historical allocation is freed while an offline artifact might survive. */
export class LicenseCapacityAuthority{
  private readonly policy:LicenseActivationPolicy;
  private readonly possession:ActivationPossession;
  constructor(private readonly pool:Pool,policy:unknown,private readonly signer:{keyId:string;privateKey:KeyObject;environment:"PREPRODUCTION"|"PRODUCTION"},
    private readonly limits:{reauthenticationMs:number;lockTimeoutMs:number;statementTimeoutMs:number}){
    this.policy=LicenseActivationPolicySchema.parse(policy);
    if(signer.privateKey.type!=="private"||signer.privateKey.asymmetricKeyType!=="ed25519"||!signer.keyId||
      !Object.values(limits).every(n=>Number.isSafeInteger(n)&&n>0)||limits.statementTimeoutMs<=limits.lockTimeoutMs)throw Error("LICENSE_ACTIVATION_EXPLICIT_POLICY_REQUIRED");
    this.possession=new ActivationPossession(pool);
  }
  private async transaction<T>(work:(c:PoolClient)=>Promise<T>){
    const c=await this.pool.connect();try{await c.query("BEGIN");
      await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`,`${this.limits.statementTimeoutMs}ms`]);
      if((await c.query("SELECT current_user='pos_platform_app' AS ok")).rows[0]?.ok!==true)throw Error("LICENSE_CENTRAL_ROLE_REQUIRED");
      const result=await work(c);await c.query("COMMIT");return result;
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  private async trustedKey(c:PoolClient){
    const row=(await c.query(`SELECT * FROM licensing.trusted_signing_keys WHERE key_id=$1 AND key_purpose='LICENSE' AND algorithm_id='Ed25519'
      AND environment=$2 AND key_status='ACTIVE' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp() FOR SHARE`,[this.signer.keyId,this.signer.environment])).rows[0];
    const pub=createPublicKey(this.signer.privateKey),pem=pub.export({type:"spki",format:"pem"});
    if(!row||!createHash("sha256").update(pub.export({type:"spki",format:"der"})).digest().equals(row.public_key_checksum)||
      !createPublicKey(row.public_key).export({type:"spki",format:"der"}).equals(pub.export({type:"spki",format:"der"})))throw Error("LICENSE_REGISTERED_SIGNING_KEY_REQUIRED");
    return {key_id:this.signer.keyId,public_key_pem:String(pem),spki_sha256:row.public_key_checksum.toString("hex"),status:"ACTIVE" as const};
  }
  private async source(c:PoolClient,licenseId:string,credentialId:string){
    // Serialize all issuers for this license before quota/version decisions.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["license-capacity:"+licenseId]);
    const row=(await c.query(`SELECT l.*,q.company_id,q.plan_version,q.included_registers,q.additional_registers,q.terms_snapshot,
      d.device_id,d.installation_id,dc.credential_id,clock_timestamp() AS server_now FROM licensing.licenses l
      JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text AND p.status='CONFIRMED'
      JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
      JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id AND q.tenant_id=l.tenant_id AND q.plan_id=l.plan_id
      JOIN identity.device_registry d ON d.tenant_id=l.tenant_id AND d.company_id=q.company_id AND d.status='ACTIVE'
      JOIN identity.device_credentials dc ON dc.device_id=d.device_id AND dc.installation_id=d.installation_id AND dc.tenant_id=d.tenant_id
        AND dc.company_id=d.company_id AND dc.device_key_id=d.device_key_id AND dc.trust_key_id=d.trust_key_id
        AND dc.status='ACTIVE' AND dc.key_purpose='DEVICE_TRUST' AND dc.issued_at<=clock_timestamp() AND dc.expires_at>clock_timestamp()
      JOIN organization.companies co ON co.id=q.company_id AND co.tenant_id=q.tenant_id AND co.status='ACTIVE'
      JOIN tenancy.tenants t ON t.id=q.tenant_id AND t.status='ACTIVE'
      WHERE l.id=$1 AND dc.credential_id=$2 AND l.contract_status IN ('ACTIVE','PAST_DUE') FOR UPDATE OF l FOR SHARE OF dc,d,p,co,t`,[licenseId,credentialId])).rows[0];
    if(!row||row.included_registers!==1||row.terms_snapshot.policy_reference!==row.policy_version||
      !this.policy.accepted_contract_policy_references.includes(row.policy_version))throw Error("LICENSE_PAID_CURRENT_BINDING_REQUIRED");
    const now=(row.server_now as Date).getTime(),nominal=row.expires_at===null?null:(row.expires_at as Date).getTime();
    if(row.deployment_mode==="LOCAL_PERPETUAL"?(nominal!==null||row.contract_status!=="ACTIVE"):(nominal===null))throw Error("LICENSE_TERM_MODE_MISMATCH");
    const end=nominal===null?null:nominal+this.policy.subscription_grace_days*86400000;
    if(end!==null&&now>=end)throw Error("LICENSE_TERM_EXPIRED");
    return {...row,effectiveExpiry:end===null?null:new Date(end).toISOString()};
  }
  private async audit(c:PoolClient,action:string,resource:string,correlation:string,payload:unknown,actor?:{user_id:string;sessionId:string}){
    // Device events use their canonical ledger; GLOBAL events remain GLOBAL.
    if(!actor)return;
    await c.query(`INSERT INTO audit.audit_events(id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
      correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
      VALUES($1,'PLATFORM_ACCOUNT',$2,$3,$4,'LICENSE_ACTIVATION','INSTANCE',$5,$6,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$7::jsonb,$8)`,
      [uuidV7(),actor.user_id,actor.sessionId,action,resource,correlation,bytes(payload).toString(),checksum(payload).toString("hex")]);
  }
  async allocate(sessionId:string,input:unknown){
    UuidSchema.parse(sessionId);const r=LicenseAllocationRequestSchema.parse(input);
    return this.transaction(async c=>{
      const actor=await requireLicenseAdministrator(c,sessionId,this.limits.reauthenticationMs);await this.trustedKey(c);
      const source=await this.source(c,r.license_id,r.credential_id);
      const payload={license_id:r.license_id,credential_id:r.credential_id,allocations:[...r.allocations].sort((a,b)=>a.register_id.localeCompare(b.register_id)),policy:this.policy};
      const old=(await c.query("SELECT * FROM licensing.license_activations WHERE tenant_id=$1 AND idempotency_key=$2",[source.tenant_id,r.idempotency_key])).rows[0];
      if(old){if(!checksum(payload).equals(old.request_checksum)||old.signing_key_id!==this.signer.keyId)throw Error("LICENSE_ALLOCATION_IDEMPOTENCY_CONFLICT");
        return {activationId:String(old.id),status:String(old.activation_status),idempotent:true};}
      for(const a of r.allocations)if((await c.query("SELECT id FROM organization.branches WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND status='ACTIVE' FOR SHARE",[a.branch_id,source.tenant_id,source.company_id])).rowCount!==1)
        throw Error("LICENSE_REGISTER_BRANCH_SCOPE_REJECTED");
      const held=(await c.query("SELECT request_payload FROM licensing.license_activations WHERE license_id=$1",[r.license_id])).rows;
      const registers=new Map<string,string>();
      for(const list of [...held.map(h=>h.request_payload.allocations),r.allocations])for(const a of list){
        if(registers.has(a.register_id)&&registers.get(a.register_id)!==a.branch_id)throw Error("LICENSE_REGISTER_REALLOCATION_REQUIRES_RELEASE_PROTOCOL");
        registers.set(a.register_id,a.branch_id);
      }
      if(registers.size>1+source.additional_registers)throw Error("LICENSE_PAID_REGISTER_CAPACITY_EXCEEDED");
      const version=Number(source.current_version)+1;if(!Number.isSafeInteger(version))throw Error("LICENSE_VERSION_EXHAUSTED");
      const activationId=uuidV7();
      await c.query(`INSERT INTO licensing.license_activations(id,license_id,tenant_id,company_id,device_id,installation_id,credential_id,
        activation_status,payload_version,license_version,request_payload,request_checksum,idempotency_key,signing_key_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',2,$8,$9::jsonb,$10,$11,$12)`,[activationId,r.license_id,source.tenant_id,source.company_id,
          source.device_id,source.installation_id,source.credential_id,version,bytes(payload).toString(),checksum(payload),r.idempotency_key,this.signer.keyId]);
      await c.query("UPDATE licensing.licenses SET current_version=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",[r.license_id,version]);
      await requireLicenseAdministrator(c,sessionId,this.limits.reauthenticationMs);
      await this.audit(c,"LICENSE_REGISTERS_ALLOCATED",activationId,r.correlation_id,payload,{user_id:actor.user_id,sessionId});
      return {activationId,status:"PENDING",idempotent:false};
    });
  }
  async activate(input:DeviceProofRequest){
    if(typeof input.body!=="string"||Buffer.byteLength(input.body)>16384)throw Error("LICENSE_ACTIVATION_REQUEST_REJECTED");
    const r=JSON.parse(input.body) as Record<string,unknown>;
    if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).length!==1||!UuidSchema.safeParse(r.activationId).success)throw Error("LICENSE_ACTIVATION_REQUEST_REJECTED");
    // Existing 012 consumes proof before issuance. Any later failure burns the
    // proof; retry requires fresh possession, never replaying an ambiguous call.
    const binding=await this.possession.consume(input);if(!binding)throw Error("LICENSE_FRESH_POSSESSION_REQUIRED");
    return this.transaction(async c=>{
      const initial=(await c.query("SELECT license_id FROM licensing.license_activations WHERE id=$1 AND credential_id=$2",[r.activationId,binding.credentialId])).rows[0];
      if(!initial)throw Error("LICENSE_ACTIVATION_CREDENTIAL_MISMATCH");
      const source=await this.source(c,initial.license_id,binding.credentialId),key=await this.trustedKey(c);
      const a=(await c.query("SELECT * FROM licensing.license_activations WHERE id=$1 FOR UPDATE",[r.activationId])).rows[0];
      if(!a||a.activation_status==='REVOKED'||a.signing_key_id!==this.signer.keyId||a.tenant_id!==binding.tenantId||a.company_id!==binding.companyId||
        a.device_id!==binding.deviceId||a.installation_id!==binding.installationId||!checksum(a.request_payload).equals(a.request_checksum)||
        canonicalSessionTrustJson(a.request_payload.policy)!==canonicalSessionTrustJson(this.policy))throw Error("LICENSE_ACTIVATION_BINDING_OR_POLICY_REJECTED");
      if(a.activation_status==='ACTIVE')return {artifact:{claims:a.canonical_payload,signature:a.signature.toString("base64url")} as SignedLicenseCapacity,key,idempotent:true};
      const entitlements=(await c.query("SELECT capability_code FROM licensing.license_entitlements WHERE license_id=$1 AND enabled=true ORDER BY capability_code FOR SHARE",[a.license_id])).rows
        .map(e=>String(e.capability_code)).filter(code=>this.policy.offline_capabilities.includes(code));
      if(!entitlements.includes("CASH_REGISTER"))throw Error("LICENSE_CASH_REGISTER_ENTITLEMENT_REQUIRED");
      const now=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
      const claims=LicenseCapacityClaimsSchema.parse({profile:"CAMACHO_LICENSE_CAPACITY_V2",license_id:a.license_id,tenant_id:a.tenant_id,company_id:a.company_id,
        installation_id:a.installation_id,device_id:a.device_id,mode:source.deployment_mode,entitlements,issued_at:now.toISOString(),
        not_before:new Date(Math.max(now.getTime(),(source.not_before as Date).getTime())).toISOString(),expires_at:source.effectiveExpiry,
        offline_grace_until:null,key_id:this.signer.keyId,license_version:Number(a.license_version),plan_id:source.plan_id,plan_version:Number(source.plan_version),
        cash_register_capacity:{included:1,paid_additional:source.additional_registers,allocations:a.request_payload.allocations}});
      const signature=sign(null,bytes(claims),this.signer.privateKey);
      await c.query("UPDATE licensing.license_activations SET activation_status='ACTIVE',canonical_payload=$2::jsonb,payload_checksum=$3,signature=$4,issued_at=$5 WHERE id=$1",
        [a.id,bytes(claims).toString(),checksum(claims),signature,now]);
      await c.query(`INSERT INTO identity.device_authentication_events(id,device_id,credential_id,tenant_id,company_id,installation_id,result,reason_code,correlation_id,occurred_at,evidence_checksum)
        VALUES($1,$2,$3,$4,$5,$6,'ACCEPTED','LICENSE_CAPACITY_ACTIVATED',$7,clock_timestamp(),$8)`,[uuidV7(),binding.deviceId,binding.credentialId,binding.tenantId,binding.companyId,binding.installationId,input.correlationId,checksum(claims).toString("hex")]);
      return {artifact:{claims,signature:signature.toString("base64url")},key,idempotent:false};
    });
  }
}
