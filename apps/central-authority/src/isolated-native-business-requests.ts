import {createHash,randomBytes} from "node:crypto";
import {uuidV7,PlatformSecurityEventCode} from "@pos-platform/contracts";
import {PostgresNativeBusinessDeviceProofVerifier,PostgresPlatformSecurityEventRepository,BUSINESS_SSA_ELIGIBILITY_SQL,
  type Pool,type PoolClient,type DeviceProofRequest} from "@pos-platform/database-postgres";
import {assertCommercialDeployment,type PostgresCommercialDeploymentContext} from "@pos-platform/database-postgres";
import type {NativeClientRegistration} from "./native-authorization-constraints.js";
import type {TrustedCommercialIdentity,TrustedCommercialDevice} from "./commercial-binding-prerequisite.js";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const opaque=(s:unknown):s is string=>typeof s==="string"&&/^[A-Za-z0-9_-]{43}$/.test(s)&&Buffer.from(s,"base64url").length===32;
export interface IsolatedNativeRequestPolicy {
  mode:"ISOLATED_VALIDATION"|"DEPLOYMENT";challengeLifetimeMs:number;requestLifetimeMs:number;codeLifetimeMs:number;
  maximumChallengesPerMinute:number;maximumReauthenticationAgeMs:number;
}
export interface NativeRequestParameters {client_id:string;redirect_uri:string;code_challenge:string;code_challenge_method:"S256";state:string}
interface RequestRow {
  client_id:string;redirect_uri:string;code_challenge:string;state:string;
  credential_id:string;device_id:string;installation_id:string;tenant_id:string;company_id:string;
  company_name:string;tenant_name:string;expires_at:Date;
}

/** Identity-owned laboratory transaction, not another session system. DDL is
 * supplied only by temporary fixtures; no migration or production route exists.
 * Selector/challenge hashes are durable; selectors never authenticate a person. */
export class IsolatedNativeBusinessRequests {
  readonly policy:Readonly<IsolatedNativeRequestPolicy>;
  private readonly proofs;
  private readonly audit;
  private get table(){return this.deployment?"identity.native_authorization_requests":"identity.native_request_validation";}
  constructor(private readonly pool:Pool,policy:IsolatedNativeRequestPolicy,private readonly deployment?:PostgresCommercialDeploymentContext){
    if(deployment)assertCommercialDeployment(pool,deployment);
    const u=new URL(pool.options.connectionString??"invalid:");
    if((!deployment&&(!["localhost","127.0.0.1"].includes(u.hostname)||u.port!=="55433"))||policy?.mode!==(deployment?"DEPLOYMENT":"ISOLATED_VALIDATION")||
      ![policy.challengeLifetimeMs,policy.requestLifetimeMs,policy.codeLifetimeMs,policy.maximumChallengesPerMinute,policy.maximumReauthenticationAgeMs]
        .every(v=>Number.isSafeInteger(v)&&v>0))throw Error("NATIVE_REQUEST_ISOLATED_POLICY_REQUIRED");
    this.policy=Object.freeze({...policy});this.proofs=new PostgresNativeBusinessDeviceProofVerifier(pool);
    this.audit=new PostgresPlatformSecurityEventRepository(pool);
  }
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();let begun=false;
    try{await c.query("BEGIN");begun=true;
      if(!this.deployment){const checked=await c.query("SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS ok");
      if(checked.rows[0]?.ok!==true)throw Error("NATIVE_REQUEST_TEMPORARY_DATABASE_REQUIRED");
      }
      const result=await work(c);await c.query("COMMIT");begun=false;return result;
    }catch(e){if(begun)await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  private matches(p:NativeRequestParameters,r:NativeClientRegistration){
    return p&&Object.keys(p).length===5&&p.client_id===r.clientId&&p.redirect_uri===r.redirectUri&&
      p.code_challenge_method==="S256"&&opaque(p.code_challenge)&&typeof p.state==="string"&&/^[A-Za-z0-9_-]{32,256}$/.test(p.state);
  }
  async challenge(p:NativeRequestParameters,r:NativeClientRegistration){
    if(!this.matches(p,r))return null;
    return this.transaction(async c=>{
      // Serialize the durable laboratory budget across workers/restarts. It is
      // intentionally not a production anti-abuse policy or per-user budget.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["native-challenge:"+r.clientId]);
      const n=await c.query(`SELECT count(*)::int AS n FROM ${this.table} WHERE client_id=$1 AND created_at>clock_timestamp()-interval '1 minute'`,[r.clientId]);
      if(n.rows[0].n>=this.policy.maximumChallengesPerMinute)return null;
      const challenge=randomBytes(32).toString("base64url"),id=uuidV7();
      const inserted=await c.query(`INSERT INTO ${this.table}
        (id,challenge_hash,client_id,redirect_uri,code_challenge,state,created_at,challenge_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp()+($7::bigint*interval '1 millisecond'))
        RETURNING challenge_expires_at`,[id,hash(challenge),p.client_id,p.redirect_uri,p.code_challenge,p.state,this.policy.challengeLifetimeMs]);
      await this.event(c,"ISOLATED_NATIVE_CHALLENGE",uuidV7());
      return {challenge_id:id,challenge,expires_at:inserted.rows[0].challenge_expires_at.toISOString()};
    });
  }
  async register(proof:DeviceProofRequest,r:NativeClientRegistration){
    let p:NativeRequestParameters & {purpose:string;challenge_id:string;challenge:string};
    try{p=JSON.parse(proof.body);}catch{return null;}
    if(!p||Object.keys(p).length!==8||p.purpose!=="BUSINESS_NATIVE_AUTHORIZATION_V1"||!opaque(p.challenge)||
      !this.matches({client_id:p.client_id,redirect_uri:p.redirect_uri,code_challenge:p.code_challenge,code_challenge_method:p.code_challenge_method,state:p.state},r))return null;
    // Canonical nonce transaction commits independently. Audit failure burns
    // that proof, while challenge + request registration roll back together.
    const device=await this.proofs.verifyRegistrationAndConsume(proof);if(!device)return null;
    return this.transaction(async c=>{
      const token=randomBytes(32).toString("base64url");
      const row=await c.query(`UPDATE ${this.table} SET
        request_hash=$1,credential_id=$2,device_id=$3,installation_id=$4,tenant_id=$5,company_id=$6,
        challenge_consumed_at=clock_timestamp(),expires_at=LEAST(clock_timestamp()+($7::bigint*interval '1 millisecond'),$8::timestamptz)
        WHERE id=$9 AND challenge_hash=$10 AND challenge_consumed_at IS NULL AND challenge_expires_at>clock_timestamp()
          AND client_id=$11 AND redirect_uri=$12 AND code_challenge=$13 AND state=$14
          AND EXISTS (SELECT 1 FROM identity.device_credentials dc JOIN identity.device_registry d ON d.device_id=dc.device_id
            WHERE dc.credential_id=$2 AND dc.status='ACTIVE' AND dc.expires_at>clock_timestamp() AND d.status='ACTIVE')
        RETURNING expires_at`,[hash(token),device.credentialId,device.deviceId,device.installationId,device.tenantId,device.companyId,
          this.policy.requestLifetimeMs,device.credentialExpiresAt,p.challenge_id,hash(p.challenge),r.clientId,r.redirectUri,p.code_challenge,p.state]);
      if(!row.rowCount)return null;
      await this.event(c,"ISOLATED_NATIVE_REQUEST_BOUND",proof.correlationId);
      return {request:token,expires_at:row.rows[0].expires_at.toISOString(),authorization_url:r.authorizationOrigin+"/v1/commercial/login?request="+token};
    });
  }
  async inspect(token:string){
    if(!opaque(token))return null;
    return this.transaction(async c=>{
      const scope=await c.query(`SELECT tenant_id::text FROM ${this.table} WHERE request_hash=$1`,[hash(token)]);
      if(!scope.rows[0]?.tenant_id)return null;
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[scope.rows[0].tenant_id]);
      const q=await c.query<RequestRow>(`SELECT n.client_id,n.redirect_uri,n.code_challenge,n.state,n.credential_id::text,n.device_id::text,
        n.installation_id::text,n.tenant_id::text,n.company_id::text,n.expires_at,company.trade_name AS company_name,t.name AS tenant_name
        FROM ${this.table} n
        JOIN identity.device_registry d ON d.device_id=n.device_id AND d.installation_id=n.installation_id AND d.tenant_id=n.tenant_id AND d.company_id=n.company_id AND d.status='ACTIVE'
        JOIN identity.device_credentials dc ON dc.credential_id=n.credential_id AND dc.device_id=d.device_id AND dc.status='ACTIVE' AND dc.expires_at>clock_timestamp()
        JOIN organization.companies company ON company.id=n.company_id AND company.tenant_id=n.tenant_id AND company.status='ACTIVE'
        JOIN tenancy.tenants t ON t.id=n.tenant_id AND t.status='ACTIVE'
        WHERE n.request_hash=$1 AND n.consumed_at IS NULL AND n.expires_at>clock_timestamp()`,[hash(token)]);
      return q.rows[0]??null;
    });
  }
  async consume(client:PoolClient,token:string,identity:TrustedCommercialIdentity,device:TrustedCommercialDevice){
    // Runs inside the code issuer transaction, after its session lock. Prevents
    // cross-tenant, stale MFA, revoked identity/device and concurrent approvals.
    const eligible=await client.query(BUSINESS_SSA_ELIGIBILITY_SQL+" FOR SHARE OF s,u,tm,t,d,company,dc",
      [identity.sessionId,device.deviceId,device.installationId,this.policy.maximumReauthenticationAgeMs]);
    const row=eligible.rows[0];
    if(!row||row.user_id!==identity.userId||row.tenant_membership_id!==identity.tenantMembershipId)throw Error("NATIVE_REQUEST_IDENTITY_INACTIVE");
    const used=await client.query(`UPDATE ${this.table} SET consumed_at=clock_timestamp(),session_id=$2
      WHERE request_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()
        AND tenant_id=$3 AND device_id=$4 AND credential_id=$5 RETURNING id`,
      [hash(token),identity.sessionId,identity.tenantId,device.deviceId,device.credentialId]);
    if(used.rowCount!==1)throw Error("NATIVE_REQUEST_CONSUMED_OR_INVALID");
  }
  async consumeLoginBudget(token:string,maximumAttempts:number){
    if(!this.deployment||!opaque(token)||!Number.isSafeInteger(maximumAttempts)||maximumAttempts<=0||maximumAttempts>2147483647)return false;
    return this.transaction(async c=>{
      const used=await c.query(`UPDATE ${this.table} SET login_attempt_count=login_attempt_count+1 WHERE request_hash=$1
        AND consumed_at IS NULL AND expires_at>clock_timestamp() AND credential_id IS NOT NULL AND login_attempt_count<$2 RETURNING id`,[hash(token),maximumAttempts]);
      return used.rowCount===1;
    });
  }
  private async event(c:PoolClient,reason:string,correlation:string){
    const clock=await c.query("SELECT clock_timestamp() AS at");
    await this.audit.append({user_id:null,session_id:null,tenant_id:null,event_code:PlatformSecurityEventCode.MFA_REQUIRED,
      result:"CHALLENGE_REQUIRED",reason_code:reason,correlation_id:correlation,occurred_at:clock.rows[0].at.toISOString()},c);
  }
}
