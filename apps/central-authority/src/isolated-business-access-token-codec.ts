import {createPrivateKey,createPublicKey,sign,verify,randomBytes,type KeyObject} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {uuidV7,PlatformSecurityEventCode} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";

type Identity={sessionId:string;userId:string;tenantId:string;tenantMembershipId:string};
type Device={deviceId:string;credentialId:string};
type Claims={iss:string;aud:string;sub:string;sid:string;tid:string;mid:string;did:string;cid:string;exp:number;iat:number;jti:string};
const b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
const strict=(s:string)=>{const decoded=Buffer.from(s,"base64url");if(decoded.toString("base64url")!==s)throw Error("ACCESS_ENCODING_INVALID");return JSON.parse(decoded.toString("utf8")) as unknown;};
/** ISOLATED VALIDATION: no production JWT authority and no online access endpoint. */
export class IsolatedBusinessAccessTokenCodec {
  private readonly privateKey:KeyObject;
  private readonly publicKey:KeyObject;
  private readonly guard:IsolatedBusinessAuditSessionGuard;
  constructor(private readonly pool:Pool,keys:{privatePem:string;publicPem:string},
    private readonly policy:{issuer:string;audience:string;keyId:string}){
    this.guard=new IsolatedBusinessAuditSessionGuard(pool);
    if(!/^https:\/\/[^\s/]+$/.test(policy.issuer)||!policy.audience||!/^ACCESS_SIGNING_TEST_[A-Za-z0-9_-]+$/.test(policy.keyId))
      throw Error("ACCESS_ISOLATED_POLICY_REQUIRED");
    this.privateKey=createPrivateKey(keys.privatePem);this.publicKey=createPublicKey(keys.publicPem);
    if(this.privateKey.asymmetricKeyType!=="ed25519"||this.publicKey.asymmetricKeyType!=="ed25519")
      throw Error("ACCESS_ED25519_REQUIRED");
    const sample=randomBytes(32);
    if(!verify(null,sample,this.publicKey,sign(null,sample,this.privateKey)))
      throw Error("ACCESS_SIGNING_KEY_MISMATCH");
  }
  async issue(identity:Identity,device:Device,correlationId:string):Promise<string|null>{
    return this.guard.whileActive(identity,client=>this.issueInTransaction(client,identity,device,correlationId));
  }
  /** Only call under the same verified IsolatedBusinessAuditSessionGuard transaction. */
  async issueInTransaction(client:PoolClient,identity:Identity,device:Device,correlationId:string):Promise<string>{
    const clock=Math.floor(Date.now()/1000),auditor=new PostgresPlatformSecurityEventRepository(this.pool);
      const checked=await client.query<{expires_at:Date}>(`SELECT s.expires_at FROM identity.sessions s
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN tenancy.tenants t ON t.id=s.tenant_id AND t.status='ACTIVE'
        JOIN tenancy.tenant_memberships m ON m.id=s.tenant_membership_id
          AND m.user_id=s.user_id AND m.tenant_id=s.tenant_id AND m.status='ACTIVE'
          AND m.suspended_at IS NULL AND m.revoked_at IS NULL
        JOIN identity.device_registry d ON d.device_id=$2 AND d.tenant_id=s.tenant_id AND d.status='ACTIVE'
        JOIN identity.device_credentials dc ON dc.credential_id=$3 AND dc.device_id=d.device_id
          AND dc.tenant_id=d.tenant_id AND dc.status='ACTIVE' AND dc.key_purpose='DEVICE_TRUST'
          AND dc.expires_at>clock_timestamp()
        WHERE s.id=$1 AND s.user_id=$4 AND s.tenant_id=$5
        AND s.tenant_membership_id=$6 AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp()+interval '1 second'
        FOR SHARE OF u,t,m,d,dc`,[identity.sessionId,device.deviceId,device.credentialId,
          identity.userId,identity.tenantId,identity.tenantMembershipId]);
      const row=checked.rows[0];if(!row)throw Error("ACCESS_BINDING_NOT_CURRENT");
      const exp=Math.min(clock+300,Math.floor(row.expires_at.getTime()/1000));
      if(exp<=clock)throw Error("ACCESS_SESSION_TOO_SHORT");
      const claims:Claims={iss:this.policy.issuer,aud:this.policy.audience,sub:identity.userId,
        sid:identity.sessionId,tid:identity.tenantId,mid:identity.tenantMembershipId,did:device.deviceId,cid:device.credentialId,
        iat:clock,exp,jti:uuidV7()};
      const header=b64({alg:"EdDSA",typ:"at+jwt",kid:this.policy.keyId});
      const payload=b64(claims);
      const unsigned=header+"."+payload;
      const token=unsigned+"."+sign(null,Buffer.from(unsigned),this.privateKey).toString("base64url");
      await auditor.append({user_id:identity.userId,session_id:identity.sessionId,tenant_id:identity.tenantId,
        event_code:PlatformSecurityEventCode.ACCESS_ISSUED,result:"SUCCEEDED",
        reason_code:"ISOLATED_ACCESS_SIGNING",correlation_id:correlationId,
        occurred_at:new Date(Date.now()-1000).toISOString()},client);
      return token;
  }
  async verify(token:string):Promise<Claims|null>{
    if(typeof token!=="string"||token.length>8192)return null;
    const parts=token.split(".");if(parts.length!==3)return null;
    let header:unknown,claims:unknown;
    try{header=strict(parts[0]!);claims=strict(parts[1]!);}catch{return null;}
    if(!header||typeof header!=="object"||Array.isArray(header)||
       (header as {alg?:string}).alg!=="EdDSA"||
       (header as {typ?:string}).typ!=="at+jwt"||
       (header as {kid?:string}).kid!==this.policy.keyId)return null;
    if(!claims||typeof claims!=="object"||Array.isArray(claims))return null;
    const c=claims as Claims;
    const now=Math.floor(Date.now()/1000);
    if(c.iss!==this.policy.issuer||c.aud!==this.policy.audience||
      !Number.isSafeInteger(c.exp)||!Number.isSafeInteger(c.iat)||c.exp<=now||
      c.iat>now+5||c.exp>c.iat+300||!c.sid||!c.sub||!c.tid||!c.mid||!c.did||!c.cid||!c.jti)return null;
    try{
      const signature=Buffer.from(parts[2]!,"base64url");
      if(signature.toString("base64url")!==parts[2]||
         !verify(null,Buffer.from(parts[0]+"."+parts[1]),this.publicKey,signature))return null;
    }catch{return null;}
    const result=await this.guard.whileActive({
      sessionId:c.sid,userId:c.sub,tenantId:c.tid,tenantMembershipId:c.mid,
    },async client=>{
      const rows=await client.query(`SELECT 1 FROM identity.sessions s
        JOIN identity.device_registry d ON d.device_id=$2 AND d.tenant_id=s.tenant_id AND d.status='ACTIVE'
        JOIN identity.device_credentials dc ON dc.credential_id=$3 AND dc.device_id=d.device_id
          AND dc.tenant_id=d.tenant_id AND dc.status='ACTIVE' AND dc.expires_at>clock_timestamp()
          AND dc.key_purpose='DEVICE_TRUST'
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN tenancy.tenants t ON t.id=s.tenant_id AND t.status='ACTIVE'
        JOIN tenancy.tenant_memberships m ON m.id=s.tenant_membership_id
          AND m.status='ACTIVE' AND m.revoked_at IS NULL AND m.suspended_at IS NULL
        WHERE s.id=$1 AND s.tenant_id=$4`,[c.sid,c.did,c.cid,c.tid]);
      return rows.rowCount===1;
    }).catch(()=>null);
    return result===true?c:null;
  }
}
