import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PlatformSecurityEventCode, UuidV7Schema, type NativeClientRegistration } from "@pos-platform/contracts";
import { PostgresNativeBusinessDeviceProofVerifier, PostgresPlatformSecurityEventRepository, type DeviceProofRequest, type Pool, type PoolClient } from "@pos-platform/database-postgres";
import { BusinessBrowserSessionAuthority, type BusinessBrowserRequest } from "./business-browser-session-authority.js";
import { matchesPkceS256Challenge, validateNativeClientRegistration } from "./native-authorization-constraints.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const opaque = (s: unknown, length: number): s is string => typeof s === "string" && s.length === length && /^[A-Za-z0-9_-]+$/.test(s) && Buffer.from(s,"base64url").toString("base64url") === s;
const equal = (a: string, b: string) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
type Binding = Readonly<{sessionId:string;userId:string;tenantId:string;membershipId:string;deviceId:string;installationId:string;companyId:string;credentialId:string}>;
type Grant = {session_id:string;user_id:string;tenant_id:string;membership_id:string;device_id:string;installation_id:string;company_id:string;credential_id:string;client_id:string;redirect_uri:string;code_challenge:string;state:string};
const deviceJoin = `JOIN identity.device_registry d ON d.device_id=n.device_id AND d.tenant_id=n.tenant_id AND d.status='ACTIVE'
 JOIN identity.device_credentials dc ON dc.credential_id=n.credential_id AND dc.device_id=d.device_id AND dc.installation_id=d.installation_id
 AND dc.tenant_id=d.tenant_id AND dc.company_id=d.company_id AND dc.device_key_id=d.device_key_id AND dc.trust_key_id=d.trust_key_id
 AND dc.key_purpose='DEVICE_TRUST' AND dc.status='ACTIVE' AND dc.issued_at<=clock_timestamp() AND dc.expires_at>clock_timestamp()`;
const membershipGate = `EXISTS (SELECT 1 FROM "authorization".user_role_assignments a JOIN "authorization".roles r ON r.id=a.role_id
 WHERE a.tenant_id=s.tenant_id AND a.tenant_membership_id=s.tenant_membership_id AND a.status='ACTIVE'
 AND a.valid_from<=clock_timestamp() AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
 AND r.status='ACTIVE' AND r.scope_type='BUSINESS' AND (a.company_id IS NULL OR a.company_id=d.company_id)
 AND a.branch_id IS NULL)`;
// Branch-scoped users require the canonical device-to-branch recipient resolver.
// Until that resolver is composed, this gate intentionally denies branch-only grants.
export class NativeBusinessCodeAuthority {
  private readonly browser: BusinessBrowserSessionAuthority;
  private readonly proof: PostgresNativeBusinessDeviceProofVerifier;
  private readonly audit: PostgresPlatformSecurityEventRepository;
  private readonly registration: NativeClientRegistration;
  constructor(private readonly pool: Pool, registration: NativeClientRegistration,
    private readonly policy: Readonly<{codeMs:number;reauthMs:number;idleMs:number}>) {
    this.registration=Object.freeze({...validateNativeClientRegistration(registration)});
    if(this.registration.platform!=="ANDROID" || ![policy.codeMs,policy.reauthMs,policy.idleMs].every(v=>Number.isSafeInteger(v)&&v>0&&v<=300000)||policy.codeMs>60000)
      throw Error("NATIVE_CODE_POLICY_REJECTED");
    this.policy=Object.freeze({...policy});
    this.browser=new BusinessBrowserSessionAuthority(registration.authorizationOrigin,policy.reauthMs,policy.idleMs);
    this.proof=new PostgresNativeBusinessDeviceProofVerifier(pool);
    this.audit=new PostgresPlatformSecurityEventRepository(pool);
  }
  private async tx<T>(work:(c:PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      const result=await work(c); await c.query("COMMIT"); return result;
    } catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;} finally {c.release();}
  }
  private async event(c:PoolClient,b:Binding,correlation:string,redeemed:boolean){
    await this.audit.append({user_id:b.userId,session_id:b.sessionId,tenant_id:b.tenantId,
      event_code:redeemed?PlatformSecurityEventCode.AUTHORIZATION_CODE_REDEEMED:PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED,
      result:"SUCCEEDED",reason_code:"BUSINESS_NATIVE_PKCE",correlation_id:correlation,occurred_at:new Date().toISOString()},c);
  }
  private binding(r:Grant):Binding{
    return Object.freeze({sessionId:r.session_id,userId:r.user_id,tenantId:r.tenant_id,membershipId:r.membership_id,
      deviceId:r.device_id,installationId:r.installation_id,companyId:r.company_id,credentialId:r.credential_id});
  }
  // Browser request must carry the real BUSINESS cookie, same-origin metadata and CSRF.
  // No caller-supplied session ID, tenant or membership is accepted.
  async issue(selector:string, browserRequest:BusinessBrowserRequest, correlationId:string){
    if(!opaque(selector,43)||!UuidV7Schema.safeParse(correlationId).success)return null;
    return this.tx(async c=>{
      const session=await this.browser.require(c,browserRequest);
      if(!session)return null;
      await c.query('SELECT "authorization".lock_sas_sources_for_read()');
      const result=await c.query<Grant>(`SELECT s.id::text AS session_id,s.user_id::text,s.tenant_id::text,s.tenant_membership_id::text AS membership_id,
       d.device_id::text,d.installation_id::text,d.company_id::text,dc.credential_id::text,n.client_id,n.redirect_uri,n.code_challenge,n.state
       FROM identity.native_authorization_requests n
       ${deviceJoin}
       JOIN identity.sessions s ON s.id=$2 AND s.tenant_id=n.tenant_id
       JOIN organization.companies co ON co.id=d.company_id AND co.tenant_id=d.tenant_id AND co.status='ACTIVE'
       WHERE n.request_hash=$1 AND n.tenant_id=$3 AND n.company_id=d.company_id AND n.installation_id=d.installation_id
       AND n.client_id=$4 AND n.redirect_uri=$5 AND n.consumed_at IS NULL AND n.expires_at>clock_timestamp()
       AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.mfa_status='SATISFIED'
       AND ${membershipGate} FOR UPDATE OF n FOR SHARE OF d,dc`,
       [hash(selector),session.sessionId,session.tenantId,this.registration.clientId,this.registration.redirectUri]);
      const row=result.rows[0];if(result.rowCount!==1||!row)return null;
      const code=randomBytes(48).toString("base64url");
      const inserted=await c.query(`INSERT INTO identity.native_authorization_codes
       (code_hash,client_id,redirect_uri,code_challenge,state,trusted_binding_id,session_id,device_id,tenant_id,issued_at,expires_at)
       SELECT $1,n.client_id,n.redirect_uri,n.code_challenge,n.state,n.credential_id,s.id,n.device_id,n.tenant_id,clock_timestamp(),
       LEAST(clock_timestamp()+($3::bigint*interval '1 millisecond'),n.expires_at,s.expires_at,dc.expires_at)
       FROM identity.native_authorization_requests n JOIN identity.sessions s ON s.id=$4
       JOIN identity.device_credentials dc ON dc.credential_id=n.credential_id
       WHERE n.request_hash=$2 AND n.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp() AND dc.expires_at>clock_timestamp()
       RETURNING code_hash`,[hash(code),hash(selector),this.policy.codeMs,session.sessionId]);
      if(inserted.rowCount!==1)throw Error("NATIVE_CODE_ISSUE_REJECTED");
      const consumed=await c.query("UPDATE identity.native_authorization_requests SET consumed_at=clock_timestamp(),session_id=$2 WHERE request_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id",[hash(selector),session.sessionId]);
      if(consumed.rowCount!==1)throw Error("NATIVE_REQUEST_CONSUME_REJECTED");
      await this.event(c,this.binding(row),correlationId,false);
      const callback=new URL(this.registration.redirectUri);
      callback.searchParams.set("code",code);callback.searchParams.set("state",row.state);
      return {callback:callback.toString()};
    });
  }
  // Internal boundary only: returns a verified binding after commit, not a token.
  // Exact signed raw body is parsed here, so caller cannot substitute PKCE values.
  async redeem(proof:DeviceProofRequest):Promise<Binding|null>{
    if(!UuidV7Schema.safeParse(proof.correlationId).success)return null;
    let p:Record<string,unknown>;
    try{p=JSON.parse(proof.body);}catch{return null;}
    if(!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).sort().join(",")!=="client_id,code,code_verifier,grant_type,redirect_uri,state"||
      p.grant_type!=="authorization_code"||p.client_id!==this.registration.clientId||p.redirect_uri!==this.registration.redirectUri||
      !opaque(p.code,64)||typeof p.code_verifier!=="string"||typeof p.state!=="string")return null;
    const codeHash=hash(p.code),verifier=p.code_verifier,state=p.state;
    const device=await this.proof.verifyTokenAndConsume(proof);if(!device)return null;
    return this.tx(async c=>{
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[device.tenantId]);
      await c.query('SELECT "authorization".lock_sas_sources_for_read()');
      const result=await c.query<Grant>(`SELECT s.id::text AS session_id,s.user_id::text,s.tenant_id::text,s.tenant_membership_id::text AS membership_id,
       d.device_id::text,d.installation_id::text,d.company_id::text,dc.credential_id::text,n.client_id,n.redirect_uri,n.code_challenge,n.state
       FROM identity.native_authorization_codes n JOIN identity.sessions s ON s.id=n.session_id AND s.tenant_id=n.tenant_id
       JOIN identity.device_registry d ON d.device_id=n.device_id AND d.tenant_id=n.tenant_id AND d.status='ACTIVE'
       JOIN identity.device_credentials dc ON dc.credential_id=n.trusted_binding_id AND dc.device_id=d.device_id
       AND dc.installation_id=d.installation_id AND dc.tenant_id=d.tenant_id AND dc.company_id=d.company_id
       AND dc.device_key_id=d.device_key_id AND dc.trust_key_id=d.trust_key_id AND dc.key_purpose='DEVICE_TRUST'
       AND dc.status='ACTIVE' AND dc.issued_at<=clock_timestamp() AND dc.expires_at>clock_timestamp()
       JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
       JOIN tenancy.tenant_memberships m ON m.id=s.tenant_membership_id AND m.tenant_id=s.tenant_id AND m.user_id=s.user_id AND m.status='ACTIVE'
       JOIN tenancy.tenants t ON t.id=s.tenant_id AND t.status='ACTIVE'
       JOIN organization.companies co ON co.id=d.company_id AND co.tenant_id=d.tenant_id AND co.status='ACTIVE'
       WHERE n.code_hash=$1 AND n.tenant_id=$2 AND n.device_id=$3 AND n.trusted_binding_id=$4
       AND d.installation_id=$5 AND d.company_id=$6 AND n.consumed_at IS NULL AND n.expires_at>clock_timestamp()
       AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.mfa_status='SATISFIED'
       AND s.last_reauthenticated_at BETWEEN clock_timestamp()-($7::bigint*interval '1 millisecond') AND clock_timestamp()
       AND ${membershipGate}
       AND EXISTS(SELECT 1 FROM identity.user_credentials pwd WHERE pwd.user_id=u.id AND pwd.credential_type='PASSWORD' AND pwd.status='ACTIVE' AND pwd.revoked_at IS NULL AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp()))
       AND EXISTS(SELECT 1 FROM identity.mfa_factors f WHERE f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL)
       FOR UPDATE OF n FOR SHARE OF s,d,dc,u,m,t`,[codeHash,device.tenantId,device.deviceId,device.credentialId,device.installationId,device.companyId,this.policy.reauthMs]);
      const row=result.rows[0];if(result.rowCount!==1||!row)return null;
      const consumed=await c.query("UPDATE identity.native_authorization_codes SET consumed_at=clock_timestamp() WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING code_hash",[codeHash]);
      if(consumed.rowCount!==1)return null;
      const binding=this.binding(row);
      if(row.client_id!==this.registration.clientId||row.redirect_uri!==this.registration.redirectUri||!equal(state,row.state)||!matchesPkceS256Challenge(verifier,row.code_challenge)){
        await this.audit.append({user_id:binding.userId,session_id:binding.sessionId,tenant_id:binding.tenantId,event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED,result:"REJECTED",reason_code:"BUSINESS_NATIVE_PKCE",correlation_id:proof.correlationId,occurred_at:new Date().toISOString()},c);
        return null;
      }
      await this.event(c,binding,proof.correlationId,true);return binding;
    });
  }
}
