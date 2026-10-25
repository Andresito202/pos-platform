import {createHash,sign,verify,randomBytes,type KeyObject} from "node:crypto";
import {AuthorizationSnapshotClaimsSchema,SignedAuthorizationSnapshotSchema,canonicalSessionTrustJson,uuidV7,PlatformSecurityEventCode,
  type SnapshotAssignment} from "@pos-platform/contracts";
import {PostgresNativeBusinessDeviceProofVerifier,PostgresPlatformSecurityEventRepository,BUSINESS_SSA_ELIGIBILITY_SQL,
  type Pool,type DeviceProofRequest} from "@pos-platform/database-postgres";
import {IsolatedBusinessAccessTokenCodec} from "./isolated-business-access-token-codec.js";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";

export interface IsolatedAuthorizationSigning {
  mode:"ISOLATED_VALIDATION";environment:"isolated-validation";purpose:"AUTHORIZATION_SNAPSHOT";
  keyId:string;status:"ACTIVE";privateKey:KeyObject;publicKey:KeyObject;validFrom:string;validUntil:string;
}
export interface IsolatedAuthorizationPolicy {mode:"ISOLATED_VALIDATION";lifetimeMs:number;maximumReauthenticationAgeMs:number}
export interface TrustedAuthorizationDeployment {tenantId:string;companyId:string;branchId:string;installationId:string;deviceId:string}

/** Laboratory producer, not a production key/profile or migration. Reads only
 * canonical RBAC; never accepts roles, grants or scope from the renderer.
 * Unrepresentable multiple roles / grant versions fail closed, not unioned. */
export class IsolatedAuthorizationSnapshotIssuer {
  private readonly guard;
  constructor(private readonly pool:Pool,private readonly codec:IsolatedBusinessAccessTokenCodec,
    private readonly deployment:Readonly<TrustedAuthorizationDeployment>,private readonly policy:Readonly<IsolatedAuthorizationPolicy>,
    private readonly signing:Readonly<IsolatedAuthorizationSigning>,
    private readonly storage?:Readonly<{mode:"DEC011_SQL_REHEARSAL";lockTimeoutMs:number}>){
    this.guard=new IsolatedBusinessAuditSessionGuard(pool);
    if(!(codec instanceof IsolatedBusinessAccessTokenCodec)||policy?.mode!=="ISOLATED_VALIDATION"||
      ![policy.lifetimeMs,policy.maximumReauthenticationAgeMs].every(n=>Number.isSafeInteger(n)&&n>0))throw Error("SAS_ISOLATED_POLICY_REQUIRED");
    this.checkKey();
    if(storage&&(storage.mode!=="DEC011_SQL_REHEARSAL"||!Number.isSafeInteger(storage.lockTimeoutMs)||storage.lockTimeoutMs<=0))
      throw Error("SAS_SQL_REHEARSAL_POLICY_REQUIRED");
  }
  private checkKey(){
    const k=this.signing,now=Date.now();
    if(k?.mode!=="ISOLATED_VALIDATION"||k.environment!=="isolated-validation"||k.purpose!=="AUTHORIZATION_SNAPSHOT"||k.status!=="ACTIVE"||
      !/^SAS_TEST_[A-Z0-9_]+$/.test(k.keyId)||k.privateKey?.type!=="private"||k.publicKey?.type!=="public"||
      k.privateKey.asymmetricKeyType!=="ed25519"||k.publicKey.asymmetricKeyType!=="ed25519"||
      !(Date.parse(k.validFrom)<=now&&now<Date.parse(k.validUntil)))throw Error("SAS_SIGNING_AUTHORITY_REJECTED");
    const sample=randomBytes(32);if(!verify(null,sample,k.publicKey,sign(null,sample,k.privateKey)))throw Error("SAS_SIGNING_KEY_MISMATCH");
  }
  async issue(accessToken:string,proof:DeviceProofRequest){
    const db=await this.pool.query("SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS ok");
    if(db.rows[0]?.ok!==true)throw Error("SAS_TEMPORARY_DATABASE_REQUIRED");
    this.checkKey();
    const access=await this.codec.verify(accessToken);if(!access)return null;
    let body:unknown;try{body=JSON.parse(proof.body);}catch{return null;}
    if(!body||typeof body!=="object"||Object.keys(body).length!==1||!("session_id" in body)||body.session_id!==access.sid)return null;
    const device=await new PostgresNativeBusinessDeviceProofVerifier(this.pool).verifyAuthorizationAndConsume(proof);
    const d=this.deployment;
    if(!device||device.credentialId!==access.cid||device.deviceId!==access.did||device.tenantId!==access.tid||
      device.tenantId!==d.tenantId||device.companyId!==d.companyId||device.deviceId!==d.deviceId||device.installationId!==d.installationId)return null;
    return this.guard.whileActive({sessionId:access.sid,userId:access.sub,tenantId:access.tid,tenantMembershipId:access.mid},async c=>{
      const eligible=await c.query(BUSINESS_SSA_ELIGIBILITY_SQL+" FOR SHARE OF s,u,tm,t,d,company,dc",
        [access.sid,d.deviceId,d.installationId,this.policy.maximumReauthenticationAgeMs]);
      if(!eligible.rows[0]||eligible.rows[0].user_id!==access.sub||eligible.rows[0].tenant_membership_id!==access.mid)return null;
      const branch=await c.query("SELECT 1 FROM organization.branches WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND status='ACTIVE' FOR SHARE",[d.branchId,d.tenantId,d.companyId]);
      if(!branch.rowCount)return null;
      if(this.storage){
        await c.query("SELECT set_config('lock_timeout',$1,true)",[`${this.storage.lockTimeoutMs}ms`]);
        await c.query('SELECT "authorization".lock_sas_sources_for_read()');
      }
      // Locks serialize competing publications of this user's device projection.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["sas:"+access.sub+":"+d.installationId+":"+d.deviceId]);
      const assignmentSql=`SELECT a.*,r.status AS role_status,r.version AS role_version FROM "authorization".user_role_assignments a
        JOIN "authorization".roles r ON r.id=a.role_id AND r.scope_type='BUSINESS'
        WHERE a.tenant_id=$1 AND a.tenant_membership_id=$2 AND (a.company_id IS NULL OR a.company_id=$3)
          AND (a.branch_id IS NULL OR a.branch_id=$4) ORDER BY a.id${this.storage?"":" FOR SHARE OF a,r"}`;
      const grantSql=`SELECT g.*,p.code,p.status AS permission_status FROM "authorization".role_permission_grants g
          JOIN "authorization".permissions p ON p.id=g.permission_id WHERE g.role_id=$1 ORDER BY p.code,g.grant_version${this.storage?"":" FOR SHARE OF g,p"}`;
      const assignmentParams=[d.tenantId,access.mid,d.companyId,d.branchId];
      const assignments=await c.query(assignmentSql,assignmentParams);
      const now=new Date(),at=now.getTime();
      let until=Math.min(at+this.policy.lifetimeMs,access.exp*1000,Date.parse(device.credentialExpiresAt),
        eligible.rows[0].session_expires_at.getTime(),Date.parse(this.signing.validUntil));
      const boundaries=(...dates:(Date|null)[])=>{for(const date of dates)if(date&&date.getTime()>at)until=Math.min(until,date.getTime());};
      const scopes=new Set<string>(),projected:SnapshotAssignment[]=[],source:unknown[]=[];
      for(const a of assignments.rows){
        const scope=[a.tenant_id,a.company_id,a.branch_id].join("|");
        if(scopes.has(scope))throw Error("SAS_ROLE_COMPOSITION_DECISION_REQUIRED");scopes.add(scope);
        boundaries(a.valid_from,a.valid_until);
        const grants=await c.query(grantSql,[a.role_id]);
        const codes=new Set<string>(),permissions:SnapshotAssignment["permissions"]=[];
        for(const g of grants.rows){
          if(codes.has(g.code))throw Error("SAS_GRANT_VERSION_DECISION_REQUIRED");codes.add(g.code);boundaries(g.valid_from,g.valid_until);
          permissions.push({code:g.code,status:g.status==='ACTIVE'&&g.permission_status==='ACTIVE'&&g.valid_from.getTime()<=at&&
            (!g.valid_until||at<g.valid_until.getTime())?"ACTIVE":"RETIRED"});
        }
        source.push({assignment:a,grants:grants.rows});
        projected.push({tenant_id:a.tenant_id,company_id:a.company_id,branch_id:a.branch_id,status:a.status,
          valid_from:a.valid_from.toISOString(),valid_until:a.valid_until?.toISOString()??null,role_status:a.role_status,permissions});
      }
      if(until<=at)return null;
      const checksum=createHash("sha256").update(JSON.stringify(source)).digest("hex"),snapshotId=uuidV7();
      const next=this.storage?await c.query(`INSERT INTO "authorization".snapshot_sequences(user_id,installation_id,device_id,last_issued_sequence,source_checksum,snapshot_id)
        VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(user_id,installation_id,device_id) DO UPDATE
        SET last_issued_sequence="authorization".snapshot_sequences.last_issued_sequence+1,source_checksum=excluded.source_checksum,
          snapshot_id=excluded.snapshot_id,updated_at=clock_timestamp() RETURNING last_issued_sequence AS sequence`,
        [access.sub,d.installationId,d.deviceId,checksum,snapshotId]):await c.query(`INSERT INTO "authorization".snapshot_sequence_validation(user_id,installation_id,device_id,sequence,source_checksum,snapshot_id)
        VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(user_id,installation_id,device_id) DO UPDATE
        SET sequence="authorization".snapshot_sequence_validation.sequence+1,source_checksum=excluded.source_checksum,snapshot_id=excluded.snapshot_id RETURNING sequence`,
        [access.sub,d.installationId,d.deviceId,checksum,snapshotId]);
      this.checkKey();
      const claims=AuthorizationSnapshotClaimsSchema.parse({snapshot_id:snapshotId,user_id:access.sub,installation_id:d.installationId,device_id:d.deviceId,
        sequence:Number(next.rows[0].sequence),issued_at:now.toISOString(),expires_at:new Date(until).toISOString(),assignments:projected,key_id:this.signing.keyId});
      const signed=SignedAuthorizationSnapshotSchema.parse({claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),this.signing.privateKey).toString("base64url")});
      await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:access.sub,session_id:access.sid,tenant_id:access.tid,
        event_code:PlatformSecurityEventCode.AUTHORIZATION_SNAPSHOT_ISSUED,result:"SUCCEEDED",reason_code:"ISOLATED_CANONICAL_SAS",
        correlation_id:proof.correlationId,occurred_at:now.toISOString()},c);
      const finalSource:unknown[]=[];
      for(const a of (await c.query(assignmentSql,assignmentParams)).rows)
        finalSource.push({assignment:a,grants:(await c.query(grantSql,[a.role_id])).rows});
      if(createHash("sha256").update(JSON.stringify(finalSource)).digest("hex")!==checksum)throw Error("SAS_SOURCE_CHANGED_BEFORE_COMMIT");
      if(Date.now()>=until)throw Error("SAS_EXPIRED_BEFORE_COMMIT");
      return signed;
    });
  }
}
