import { createHash,createPublicKey,sign,verify,type KeyObject } from "node:crypto";
import { AuthorizationSnapshotClaimsSchema,SignedAuthorizationSnapshotSchema,SessionAssertionClaimsSchema,SignedSessionAssertionSchema,
 SignedSessionAssertionOperationalKeySchema,SignedAuthorizationTrustSchema,unsignedSessionAssertionOperationalKeyBytes,unsignedAuthorizationTrustBytes,
 canonicalSessionTrustJson,PlatformSecurityEventCode,uuidV7,type SnapshotAssignment,type SignedAuthorizationTrust,type SignedSessionAssertionOperationalKey } from "@pos-platform/contracts";
import {resolveCommercialDeviceBranch,PostgresPlatformSecurityEventRepository,type Pool,type DeviceProofRequest} from "@pos-platform/database-postgres";
import {CommercialNativeCredentialAuthority} from "./commercial-native-credential-authority.js";

type Scope={tenantId:string;companyId:string;branchId:string;deviceId:string;installationId:string};
type Signing={environment:"PREPRODUCTION"|"PRODUCTION";issuer:string;ssaPrivate:KeyObject;ssaRoot:KeyObject;ssaOperational:SignedSessionAssertionOperationalKey;
 sasPrivate:KeyObject;sasRoot:KeyObject;resolveTrust:(scope:Scope)=>Promise<SignedAuthorizationTrust|null>;lifetimeMs:number};
const sameKey=(privateKey:KeyObject,pem:string)=>createPublicKey(privateKey).export({type:"spki",format:"der"}).equals(createPublicKey(pem).export({type:"spki",format:"der"}));
const current=(from:string,until:string|null,at:number)=>Date.parse(from)<=at&&(until===null||at<Date.parse(until));
export class CommercialSessionArtifacts {
  constructor(private readonly pool:Pool,private readonly credentials:CommercialNativeCredentialAuthority,private readonly policy:Readonly<Signing>){
    if(!Number.isSafeInteger(policy.lifetimeMs)||policy.lifetimeMs<=0||policy.lifetimeMs>300000||
      [policy.ssaPrivate,policy.sasPrivate].some(k=>k.type!=="private"||k.asymmetricKeyType!=="ed25519")||
      [policy.ssaRoot,policy.sasRoot].some(k=>k.type!=="public"||k.asymmetricKeyType!=="ed25519")||
      createPublicKey(policy.ssaPrivate).export({type:"spki",format:"der"}).equals(createPublicKey(policy.sasPrivate).export({type:"spki",format:"der"})))
      throw Error("ARTIFACT_SIGNING_POLICY_REJECTED");
    this.policy=Object.freeze({...policy});
  }
  async issue(token:string,proof:DeviceProofRequest,kind:"SESSION_ASSERTION"|"AUTHORIZATION_SNAPSHOT"){
    const access=await this.credentials.verifyAndConsume(token,proof,kind);if(!access)return null;
    let body:unknown;try{body=JSON.parse(proof.body);}catch{return null;}
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||!("session_id" in body)||body.session_id!==access.sid)return null;
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='10s'");
      if(!await this.credentials.currentInTransaction(c,access)){await c.query("ROLLBACK");return null;}
      const device=(await c.query<{company_id:string}>(`SELECT company_id::text FROM identity.device_registry WHERE device_id=$1 AND installation_id=$2 AND tenant_id=$3 AND status='ACTIVE' FOR SHARE`,[access.did,access.iid,access.tid])).rows[0];
      if(!device)throw Error("ARTIFACT_DEVICE_REJECTED");
      const base={tenantId:access.tid,companyId:device.company_id,deviceId:access.did,installationId:access.iid,credentialId:access.cid};
      const branchId=await resolveCommercialDeviceBranch(c,base);if(!branchId)throw Error("ARTIFACT_BRANCH_UNRESOLVED");
      const scope={...base,branchId};
      const now=new Date(),at=now.getTime();let until=Math.min(at+this.policy.lifetimeMs,access.exp*1000);
      let result:unknown;
      if(kind==="SESSION_ASSERTION"){
        const artifact=SignedSessionAssertionOperationalKeySchema.parse(this.policy.ssaOperational),key=artifact.claims;
        if(key.environment!==this.policy.environment||key.status!=="ACTIVE"||!current(key.valid_from,key.valid_until,at)||
          !sameKey(this.policy.ssaPrivate,key.public_key_pem)||!verify(null,unsignedSessionAssertionOperationalKeyBytes(key),this.policy.ssaRoot,Buffer.from(artifact.signature,"base64url")))throw Error("SSA_TRUST_REJECTED");
        if(key.valid_until)until=Math.min(until,Date.parse(key.valid_until));
        const n=await c.query<{sequence:string}>(`INSERT INTO identity.session_assertion_sequences(user_id,installation_id,device_id,last_issued_sequence)
          VALUES($1,$2,$3,1) ON CONFLICT ON CONSTRAINT session_assertion_sequences_pk DO UPDATE SET
          last_issued_sequence=identity.session_assertion_sequences.last_issued_sequence+1,updated_at=clock_timestamp()
          WHERE identity.session_assertion_sequences.last_issued_sequence<9007199254740991 RETURNING last_issued_sequence::text AS sequence`,[access.sub,access.iid,access.did]);
        const claims=SessionAssertionClaimsSchema.parse({session_id:access.sid,user_id:access.sub,tenant_membership_id:access.mid,
          installation_id:access.iid,device_id:access.did,issued_at:now.toISOString(),offline_valid_until:new Date(until).toISOString(),sequence:Number(n.rows[0]?.sequence),key_id:key.key_id});
        result={session_assertion:SignedSessionAssertionSchema.parse({claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),this.policy.ssaPrivate).toString("base64url")})};
      }else{
        const bundle=SignedAuthorizationTrustSchema.parse(await this.policy.resolveTrust(scope)),b=bundle.claims,r=b.recipient;
        if(b.environment!==this.policy.environment||b.issuer!==this.policy.issuer||r.tenant_id!==scope.tenantId||r.company_id!==scope.companyId||
          r.branch_id!==branchId||r.installation_id!==access.iid||r.device_id!==access.did||!current(b.valid_from,b.valid_until,at)||
          !verify(null,unsignedAuthorizationTrustBytes(b),this.policy.sasRoot,Buffer.from(bundle.signature,"base64url")))throw Error("SAS_TRUST_REJECTED");
        const keys=b.keys.filter(k=>k.status==="ACTIVE"&&current(k.valid_from,k.valid_until,at)&&sameKey(this.policy.sasPrivate,k.public_key_pem));
        if(keys.length!==1)throw Error("SAS_ACTIVE_KEY_REJECTED");const key=keys[0]!;
        until=Math.min(until,Date.parse(b.valid_until),Date.parse(key.valid_until));
        const rows=await c.query(`SELECT a.*,r.status AS role_status FROM "authorization".user_role_assignments a
          JOIN "authorization".roles r ON r.id=a.role_id AND r.scope_type='BUSINESS'
          WHERE a.tenant_id=$1 AND a.tenant_membership_id=$2 AND (a.company_id IS NULL OR a.company_id=$3)
          AND (a.branch_id IS NULL OR a.branch_id=$4) ORDER BY a.id LIMIT 65`,[access.tid,access.mid,scope.companyId,branchId]);
        const projected:SnapshotAssignment[]=[],source:unknown[]=[],scopes=new Set<string>();
        const bound=(d:Date|null)=>{if(d&&d.getTime()>at)until=Math.min(until,d.getTime());};
        for(const a of rows.rows){
          const id=[a.tenant_id,a.company_id,a.branch_id].join("|");if(scopes.has(id))throw Error("SAS_ROLE_COMPOSITION_REQUIRED");scopes.add(id);
          bound(a.valid_from);bound(a.valid_until);
          const grants=await c.query(`SELECT g.*,p.code,p.status AS permission_status FROM "authorization".role_permission_grants g
            JOIN "authorization".permissions p ON p.id=g.permission_id WHERE g.role_id=$1 ORDER BY p.code,g.grant_version LIMIT 257`,[a.role_id]);
          const permissions:SnapshotAssignment["permissions"]=[],codes=new Set<string>();
          for(const g of grants.rows){if(codes.has(g.code))throw Error("SAS_GRANT_COMPOSITION_REQUIRED");codes.add(g.code);bound(g.valid_from);bound(g.valid_until);
            permissions.push({code:g.code,status:g.status==="ACTIVE"&&g.permission_status==="ACTIVE"&&g.valid_from.getTime()<=at&&(!g.valid_until||g.valid_until.getTime()>at)?"ACTIVE":"RETIRED"});}
          source.push({assignment:a,grants:grants.rows});
          projected.push({tenant_id:a.tenant_id,company_id:a.company_id,branch_id:a.branch_id,status:a.status,role_status:a.role_status,
            valid_from:a.valid_from.toISOString(),valid_until:a.valid_until?.toISOString()??null,permissions});
        }
        const snapshotId=uuidV7(),checksum=createHash("sha256").update(JSON.stringify(source)).digest("hex");
        const n=await c.query<{sequence:string}>(`INSERT INTO "authorization".snapshot_sequences(user_id,installation_id,device_id,last_issued_sequence,source_checksum,snapshot_id)
          VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(user_id,installation_id,device_id) DO UPDATE SET
          last_issued_sequence="authorization".snapshot_sequences.last_issued_sequence+1,source_checksum=excluded.source_checksum,snapshot_id=excluded.snapshot_id,updated_at=clock_timestamp()
          WHERE "authorization".snapshot_sequences.last_issued_sequence<9007199254740991 RETURNING last_issued_sequence::text AS sequence`,[access.sub,access.iid,access.did,checksum,snapshotId]);
        const claims=AuthorizationSnapshotClaimsSchema.parse({snapshot_id:snapshotId,user_id:access.sub,installation_id:access.iid,device_id:access.did,
          sequence:Number(n.rows[0]?.sequence),issued_at:now.toISOString(),expires_at:new Date(until).toISOString(),assignments:projected,key_id:key.key_id});
        result={authorization_snapshot:SignedAuthorizationSnapshotSchema.parse({claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),this.policy.sasPrivate).toString("base64url")})};
      }
      if(Date.now()>=until||await resolveCommercialDeviceBranch(c,base)!==branchId||!await this.credentials.currentInTransaction(c,access))throw Error("ARTIFACT_SCOPE_CHANGED");
      await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:access.sub,session_id:access.sid,tenant_id:access.tid,
        event_code:kind==="SESSION_ASSERTION"?PlatformSecurityEventCode.SESSION_ISSUED:PlatformSecurityEventCode.AUTHORIZATION_SNAPSHOT_ISSUED,result:"SUCCEEDED",reason_code:"COMMERCIAL_NATIVE_ARTIFACT",correlation_id:proof.correlationId,occurred_at:now.toISOString()},c);
      await c.query("COMMIT");return result;
    }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}finally{c.release();}
  }
}
