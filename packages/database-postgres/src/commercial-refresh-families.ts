import {createHash,randomBytes} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {PlatformSecurityEventCode,UuidSchema,uuidV7,CommercialRefreshRequestSchema,CommercialRevokeRequestSchema} from "@pos-platform/contracts";
import {PostgresBusinessSessionRevocationTransaction} from "./business-session-revocation-transaction.js";
import type {CommercialPossessionContext} from "@pos-platform/device-trust";
import {PostgresCommercialPossessionVerifier,type DeviceProofRequest} from "./device-proof-replay-verifier.js";
import {BUSINESS_SSA_ELIGIBILITY_SQL} from "./business-session-ssa-eligibility-repository.js";
import {PostgresPlatformSecurityEventRepository} from "./platform-security-event-repository.js";

export interface CommercialRefreshPolicy{
  origin:string;audience:string;clientId:string;lifetimeMs:number;maximumReauthenticationAgeMs:number;
  maximumProofSkewMs:number;rotationWindowMs:number;maximumRotationsPerWindow:number;
}
type Binding={sessionId:string;tenantId:string;credentialId:string;installationId:string;deviceId:string};
type Row={id:string;session_id:string;tenant_id:string;credential_id:string;installation_id:string;device_id:string;
  client_id:string;issuer_origin:string;audience:string;token_family_id:string;expires_at:Date;family_expires_at:Date;
  consumed_at:Date|null;revoked_at:Date|null;password_credential_id:string;password_credential_version:string};
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const rawToken=()=>randomBytes(48).toString("base64url");

/** Identity storage, not an HTTP authority. Initial binding MUST be supplied by
 * the existing verified native-code transaction, never UUIDs from a client.
 * Renewal derives all identity/device context from the stored token hash, then
 * verifies fresh possession and consumes the canonical 012 ledger independently.
 * No endpoint, default lifetime, new session table or access signer is introduced. */
export class PostgresCommercialRefreshFamilies{
  private readonly policy:Readonly<CommercialRefreshPolicy>;
  private readonly proofs:PostgresCommercialPossessionVerifier;
  private readonly audit:PostgresPlatformSecurityEventRepository;
  constructor(private readonly pool:Pool,policy:CommercialRefreshPolicy){
    const origin=new URL(policy.origin);
    if(origin.protocol!=="https:"||origin.origin!==policy.origin||
      ![policy.clientId,policy.audience].every(v=>typeof v==="string"&&v.length>0&&v.length<=128)||
      ![policy.lifetimeMs,policy.maximumReauthenticationAgeMs,policy.maximumProofSkewMs,policy.rotationWindowMs,policy.maximumRotationsPerWindow].every(v=>Number.isSafeInteger(v)&&v>0)||
      policy.maximumProofSkewMs>120_000)throw Error("COMMERCIAL_REFRESH_EXPLICIT_POLICIES_REQUIRED");
    this.policy=Object.freeze({...policy});this.proofs=new PostgresCommercialPossessionVerifier(pool);this.audit=new PostgresPlatformSecurityEventRepository(pool);
  }
  acceptsClient(clientId:string){return clientId===this.policy.clientId;}
  matchesRegistration(origin:string,audience:string,clientId:string){return origin===this.policy.origin&&audience===this.policy.audience&&clientId===this.policy.clientId;}
  /** A hash is only a lookup. Fresh possession of the exact enrolled credential
   * is mandatory even for revocation. Reuse the canonical session/family writer
   * and its session-first lock order; no nested transaction or parallel owner. */
  async revoke(raw:string,input:DeviceProofRequest){
    try{const r=CommercialRevokeRequestSchema.parse(JSON.parse(input.body));if(r.refresh_token!==raw||r.client_id!==this.policy.clientId)return null;}catch{return null;}
    const row=(await this.pool.query<Row>("SELECT * FROM identity.session_refresh_tokens WHERE token_hash=$1 AND client_id=$2 AND issuer_origin=$3 AND audience=$4",[hash(raw),this.policy.clientId,this.policy.origin,this.policy.audience])).rows[0];
    if(!row)return null;
    const context:CommercialPossessionContext={operation:"REVOKE",origin:this.policy.origin,audience:this.policy.audience,clientId:this.policy.clientId,
      tenantId:row.tenant_id,installationId:row.installation_id,deviceId:row.device_id,credentialId:row.credential_id,token:raw,requestId:input.requestId,correlationId:input.correlationId,body:input.body};
    if(!await this.proofs.verifyRevokeAndConsume(input,context,this.policy.maximumProofSkewMs))return null;
    const session=(await this.pool.query<{user_id:string;tenant_membership_id:string;authenticated_at:Date;expires_at:Date}>(
      "SELECT user_id::text,tenant_membership_id::text,authenticated_at,expires_at FROM identity.sessions WHERE id=$1 AND tenant_id=$2 AND tenant_membership_id IS NOT NULL AND device_id IS NULL",[row.session_id,row.tenant_id])).rows[0];
    if(!session)return null;
    return new PostgresBusinessSessionRevocationTransaction(this.pool).revokeOwn({sessionId:row.session_id,tenantId:row.tenant_id,userId:session.user_id,
      tenantMembershipId:session.tenant_membership_id,authenticatedAt:session.authenticated_at.toISOString(),expiresAt:session.expires_at.toISOString()},input.correlationId);
  }
  /** Canonical revalidation for a signed access credential. Does not verify
   * possession or grant permissions by itself. Caller owns transaction. */
  async currentFamilyInTransaction(c:PoolClient,familyId:string){
    UuidSchema.parse(familyId);
    const query=`SELECT * FROM identity.session_refresh_tokens r WHERE token_family_id=$1 AND parent_token_id IS NULL
      AND client_id=$2 AND issuer_origin=$3 AND audience=$4 AND family_expires_at>clock_timestamp() AND revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM identity.session_refresh_tokens revoked WHERE revoked.token_family_id=r.token_family_id AND revoked.revoked_at IS NOT NULL)`;
    const parameters=[familyId,this.policy.clientId,this.policy.origin,this.policy.audience];
    const found=await c.query<Row>(query,parameters);
    const r=found.rows[0];if(!r)return null;
    const b={sessionId:r.session_id,tenantId:r.tenant_id,credentialId:r.credential_id,deviceId:r.device_id,installationId:r.installation_id},current=await this.eligible(c,b);
    if(!current||current.passwordId!==r.password_credential_id||current.passwordVersion!==r.password_credential_version)return null;
    // Same order as rotation/logout: session first, family second. Recheck
    // after acquiring the lock; a lookup snapshot cannot authorize access.
    if(!(await c.query(query+" FOR SHARE",parameters)).rowCount)return null;
    const identity=await c.query<{tenant_membership_id:string;device_public_key:Buffer}>("SELECT s.tenant_membership_id::text,d.device_public_key FROM identity.sessions s JOIN identity.device_registry d ON d.device_id=$2 WHERE s.id=$1",[b.sessionId,b.deviceId]);
    return {...b,userId:current.user_id,membershipId:identity.rows[0]!.tenant_membership_id,publicKey:identity.rows[0]!.device_public_key,
      expiresAt:new Date(Math.min(r.family_expires_at.getTime(),current.session_expires_at.getTime(),current.credential_expires_at.getTime()))};
  }
  private async transaction<T>(work:(c:PoolClient)=>Promise<T>){
    const c=await this.pool.connect();let begun=false;
    try{await c.query("BEGIN");begun=true;const result=await work(c);await c.query("COMMIT");begun=false;return result;}
    catch(error){if(begun)await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  private async eligible(c:PoolClient,b:Binding){
    for(const value of Object.values(b))UuidSchema.parse(value);
    await c.query("SELECT set_config('app.tenant_id',$1,true)",[b.tenantId]);
    const session=await c.query("SELECT 1 FROM identity.sessions WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[b.sessionId,b.tenantId]);
    if(!session.rowCount)return null;
    const query=BUSINESS_SSA_ELIGIBILITY_SQL.replace(" ORDER BY dc.generation DESC",` AND dc.credential_id=$5 AND tm.suspended_at IS NULL AND tm.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM identity.device_credentials newer WHERE newer.device_id=dc.device_id AND newer.generation>dc.generation)
      AND EXISTS(SELECT 1 FROM identity.user_credentials p WHERE p.user_id=s.user_id AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp()))
      ORDER BY dc.generation DESC`)+" FOR SHARE OF u,tm,t,d,company,dc";
    const found=await c.query<{user_id:string;session_expires_at:Date;credential_expires_at:Date}>(query,[b.sessionId,b.deviceId,b.installationId,this.policy.maximumReauthenticationAgeMs,b.credentialId]);
    const row=found.rows[0];if(!row)return null;
    if(!(await c.query("SELECT id FROM identity.mfa_factors WHERE user_id=$1 AND status='ACTIVE' AND verified_at IS NOT NULL AND revoked_at IS NULL ORDER BY id LIMIT 1 FOR SHARE",[row.user_id])).rowCount)return null;
    const password=await c.query<{id:string;version:string}>("SELECT id::text,version::text FROM identity.user_credentials WHERE user_id=$1 AND credential_type='PASSWORD' AND status='ACTIVE' AND revoked_at IS NULL AND (locked_until IS NULL OR locked_until<=clock_timestamp()) ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE",[row.user_id]);
    if(!password.rows[0])return null;
    return {...row,passwordId:password.rows[0].id,passwordVersion:password.rows[0].version};
  }
  private async event(c:PoolClient,b:Binding,userId:string,code:typeof PlatformSecurityEventCode[keyof typeof PlatformSecurityEventCode],reason:string,correlationId:string,result:"SUCCEEDED"|"DETECTED"|"REVOKED"|"THROTTLED"="SUCCEEDED"){
    const at=(await c.query<{at:Date}>("SELECT clock_timestamp() AS at")).rows[0]!.at.toISOString();
    await this.audit.append({user_id:userId,session_id:b.sessionId,tenant_id:b.tenantId,event_code:code,result,reason_code:reason,correlation_id:correlationId,occurred_at:at},c);
  }
  /** Called inside the SAME transaction that consumes PKCE and issues access. */
  async issueInTransaction(c:PoolClient,b:Binding,correlationId:string){
    UuidSchema.parse(correlationId);const current=await this.eligible(c,b);if(!current)throw Error("COMMERCIAL_REFRESH_BINDING_NOT_CURRENT");
    const token=rawToken(),familyId=uuidV7();
    await c.query(`INSERT INTO identity.session_refresh_tokens(id,session_id,token_family_id,token_hash,issued_at,expires_at,client_id,credential_id,installation_id,device_id,tenant_id,issuer_origin,audience,family_expires_at,password_credential_id,password_credential_version)
      SELECT $1,$2,$3,$4,clock_timestamp(),LEAST($5::timestamptz,$6::timestamptz,clock_timestamp()+($7::bigint*interval '1 millisecond')),$8,$9,$10,$11,$12,$13,$14,
      LEAST($5::timestamptz,$6::timestamptz,clock_timestamp()+($7::bigint*interval '1 millisecond')),$15,$16`,
      [uuidV7(),b.sessionId,familyId,hash(token),current.session_expires_at,current.credential_expires_at,this.policy.lifetimeMs,this.policy.clientId,b.credentialId,b.installationId,b.deviceId,b.tenantId,this.policy.origin,this.policy.audience,current.passwordId,current.passwordVersion]);
    await this.event(c,b,current.user_id,PlatformSecurityEventCode.REFRESH_FAMILY_ISSUED,"DEVICE_BOUND_REFRESH_V2",correlationId);
    return {refreshToken:token,familyId};
  }
  async rotate<T=never>(raw:string,input:DeviceProofRequest,issueAccess?:(c:PoolClient,familyId:string)=>Promise<T>){
    if(typeof raw!=="string"||!/^[A-Za-z0-9_-]{64}$/.test(raw))return null;
    try{const request=CommercialRefreshRequestSchema.parse(JSON.parse(input.body));if(request.refresh_token!==raw||request.client_id!==this.policy.clientId)return null;}catch{return null;}
    // Read only lookup. A stolen token without its key cannot revoke the family.
    const lookup=await this.pool.query<Row>("SELECT * FROM identity.session_refresh_tokens WHERE token_hash=$1 AND client_id=$2 AND issuer_origin=$3 AND audience=$4",[hash(raw),this.policy.clientId,this.policy.origin,this.policy.audience]);
    const row=lookup.rows[0];if(!row)return null;
    const context:CommercialPossessionContext={operation:"REFRESH",origin:this.policy.origin,audience:this.policy.audience,clientId:this.policy.clientId,
      tenantId:row.tenant_id,installationId:row.installation_id,deviceId:row.device_id,credentialId:row.credential_id,token:raw,requestId:input.requestId,correlationId:input.correlationId,body:input.body};
    const proof=await this.proofs.verifyRefreshAndConsume(input,context,this.policy.maximumProofSkewMs);if(!proof)return null;
    const b:Binding={sessionId:row.session_id,tenantId:row.tenant_id,credentialId:row.credential_id,installationId:row.installation_id,deviceId:row.device_id};
    return this.transaction(async c=>{
      const current=await this.eligible(c,b);if(!current)return null;
      const locked=await c.query<Row&{usable:boolean}>(`SELECT *,expires_at>clock_timestamp() AND family_expires_at>clock_timestamp() AS usable FROM identity.session_refresh_tokens WHERE id=$1 FOR UPDATE`,[row.id]);
      const token=locked.rows[0]!;
      if(token.password_credential_id!==current.passwordId||token.password_credential_version!==current.passwordVersion){
        await c.query("UPDATE identity.session_refresh_tokens SET revoked_at=clock_timestamp(),revocation_reason='PASSWORD_CREDENTIAL_CHANGED' WHERE token_family_id=$1 AND revoked_at IS NULL",[token.token_family_id]);
        await this.event(c,b,current.user_id,PlatformSecurityEventCode.REFRESH_FAMILY_REVOKED,"PASSWORD_CREDENTIAL_CHANGED",input.correlationId,"REVOKED");return null;
      }
      if(token.consumed_at!==null){
        await c.query("UPDATE identity.session_refresh_tokens SET revoked_at=clock_timestamp(),revocation_reason='REFRESH_REUSE_DETECTED',reuse_detected_at=CASE WHEN id=$2 THEN clock_timestamp() ELSE reuse_detected_at END WHERE token_family_id=$1 AND revoked_at IS NULL",[token.token_family_id,token.id]);
        await this.event(c,b,current.user_id,PlatformSecurityEventCode.REFRESH_REUSE_DETECTED,"COMMERCIAL_REFRESH_REUSE",input.correlationId,"DETECTED");
        return {status:"REUSE_DETECTED" as const};
      }
      if(token.revoked_at!==null||!token.usable)return null;
      const budget=await c.query<{n:number}>("SELECT count(*)::int AS n FROM identity.session_refresh_tokens WHERE token_family_id=$1 AND parent_token_id IS NOT NULL AND issued_at>=clock_timestamp()-($2::bigint*interval '1 millisecond')",[token.token_family_id,this.policy.rotationWindowMs]);
      if(budget.rows[0]!.n>=this.policy.maximumRotationsPerWindow){
        await this.event(c,b,current.user_id,PlatformSecurityEventCode.ABUSE_RATE_LIMITED,"COMMERCIAL_REFRESH_ROTATION_BUDGET",input.correlationId,"THROTTLED");return null;
      }
      const next=rawToken(),nextId=uuidV7();
      await c.query(`INSERT INTO identity.session_refresh_tokens(id,session_id,token_family_id,parent_token_id,token_hash,issued_at,expires_at,client_id,credential_id,installation_id,device_id,tenant_id,issuer_origin,audience,family_expires_at,password_credential_id,password_credential_version)
        SELECT $1,session_id,token_family_id,id,$2,clock_timestamp(),LEAST(family_expires_at,$4::timestamptz,$5::timestamptz),client_id,credential_id,installation_id,device_id,tenant_id,issuer_origin,audience,family_expires_at,password_credential_id,password_credential_version FROM identity.session_refresh_tokens WHERE id=$3`,[nextId,hash(next),token.id,current.session_expires_at,current.credential_expires_at]);
      await c.query("UPDATE identity.session_refresh_tokens SET consumed_at=clock_timestamp(),replacement_token_id=$2 WHERE id=$1 AND consumed_at IS NULL",[token.id,nextId]);
      await this.event(c,b,current.user_id,PlatformSecurityEventCode.REFRESH_ROTATED,"COMMERCIAL_REFRESH_V2",input.correlationId);
      const access=issueAccess?await issueAccess(c,token.token_family_id):undefined;
      return {status:"ROTATED" as const,refreshToken:next,...(access===undefined?{}:{access})};
    });
  }
}
