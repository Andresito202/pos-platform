import {createHash,createPrivateKey,createPublicKey,sign,verify,randomBytes,type KeyObject} from "node:crypto";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {uuidV7,PlatformSecurityEventCode} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";
import {PostgresCommercialRefreshFamilies,PostgresCommercialPossessionVerifier,type DeviceProofRequest} from "@pos-platform/database-postgres";
import type {CommercialPossessionContext} from "@pos-platform/device-trust";
import {canonicalSessionTrustJson,CommercialAccessClaimsSchema,CommercialAccessHeaderSchema,type CommercialAccessClaims} from "@pos-platform/contracts";

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

function jwkThumbprint(key:KeyObject){
  const jwk=key.export({format:"jwk"});
  if(jwk.kty!=="OKP"||jwk.crv!=="Ed25519"||typeof jwk.x!=="string")throw Error("ACCESS_DEVICE_KEY_REQUIRED");
  return createHash("sha256").update(canonicalSessionTrustJson({crv:jwk.crv,kty:jwk.kty,x:jwk.x})).digest("base64url");
}
export interface CommercialAccessPolicy{
  issuer:string;audience:string;clientId:string;keyId:string;accessLifetimeMs:number;maximumProofSkewMs:number;
  signingValidFrom:string;signingValidUntil:string;
}
/** Deployment V2 profile in the existing access owner. No HTTP route or default
 * production policy. V1 laboratory tokens are rejected. The public verifier
 * requires possession and current canonical family/session/device state. */
export class CommercialBusinessAccessAuthority{
  private readonly privateKey:KeyObject;private readonly publicKey:KeyObject;
  private readonly policy:Readonly<CommercialAccessPolicy>;
  private readonly proofs:PostgresCommercialPossessionVerifier;
  constructor(private readonly pool:Pool,keys:{privatePem:string;publicPem:string},policy:CommercialAccessPolicy,
    private readonly families:PostgresCommercialRefreshFamilies){
    this.privateKey=createPrivateKey(keys.privatePem);this.publicKey=createPublicKey(keys.publicPem);
    const url=new URL(policy.issuer);
    if(!(families instanceof PostgresCommercialRefreshFamilies)||!families.matchesRegistration(policy.issuer,policy.audience,policy.clientId)||
      url.protocol!=="https:"||url.origin!==policy.issuer||!policy.keyId||policy.keyId.length>128||
      ![policy.accessLifetimeMs,policy.maximumProofSkewMs].every(n=>Number.isSafeInteger(n)&&n>0)||policy.maximumProofSkewMs>120_000||
      !Number.isFinite(Date.parse(policy.signingValidFrom))||!Number.isFinite(Date.parse(policy.signingValidUntil))||Date.parse(policy.signingValidUntil)<=Date.parse(policy.signingValidFrom)||
      this.privateKey.type!=="private"||this.privateKey.asymmetricKeyType!=="ed25519"||this.publicKey.type!=="public"||this.publicKey.asymmetricKeyType!=="ed25519"||
      !createPublicKey(this.privateKey).export({type:"spki",format:"der"}).equals(this.publicKey.export({type:"spki",format:"der"})))throw Error("ACCESS_EXPLICIT_DEPLOYMENT_POLICY_REQUIRED");
    this.policy=Object.freeze({...policy});this.proofs=new PostgresCommercialPossessionVerifier(pool);
  }
  private signingCurrent(){const now=Date.now();return now>=Date.parse(this.policy.signingValidFrom)&&now<Date.parse(this.policy.signingValidUntil);}
  async issueInTransaction(c:PoolClient,familyId:string,correlationId:string){
    const family=await this.families.currentFamilyInTransaction(c,familyId);if(!family||!this.signingCurrent())throw Error("ACCESS_FAMILY_OR_SIGNING_WINDOW_REJECTED");
    const now=Math.floor(Date.now()/1000),exp=Math.floor(Math.min(Date.now()+this.policy.accessLifetimeMs,family.expiresAt.getTime(),Date.parse(this.policy.signingValidUntil))/1000);
    if(exp<=now)throw Error("ACCESS_VALIDITY_TOO_SHORT");
    const claims=CommercialAccessClaimsSchema.parse({ver:2,iss:this.policy.issuer,aud:this.policy.audience,sub:family.userId,sid:family.sessionId,tid:family.tenantId,mid:family.membershipId,
      did:family.deviceId,iid:family.installationId,cid:family.credentialId,client_id:this.policy.clientId,fid:familyId,iat:now,exp,jti:uuidV7(),cnf:{jkt:jwkThumbprint(createPublicKey(family.publicKey.toString("utf8")))}});
    const unsigned=b64({alg:"EdDSA",typ:"at+jwt",kid:this.policy.keyId})+"."+b64(claims);
    const token=unsigned+"."+sign(null,Buffer.from(unsigned),this.privateKey).toString("base64url");
    const at=(await c.query<{at:Date}>("SELECT clock_timestamp() AS at")).rows[0]!.at.toISOString();
    await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:family.userId,session_id:family.sessionId,tenant_id:family.tenantId,event_code:PlatformSecurityEventCode.ACCESS_ISSUED,result:"SUCCEEDED",reason_code:"DEVICE_BOUND_ACCESS_V2",correlation_id:correlationId,occurred_at:at},c);
    return token;
  }
  async refresh(raw:string,input:DeviceProofRequest){
    return this.families.rotate(raw,input,(c,familyId)=>this.issueInTransaction(c,familyId,input.correlationId));
  }
  async verifyAndConsume(token:string,input:DeviceProofRequest,operation:"SESSION_ASSERTION"|"AUTHORIZATION_SNAPSHOT"){
    let claims:CommercialAccessClaims;
    try{
      if(typeof token!=="string"||token.length>8192||!this.signingCurrent())return null;
      const parts=token.split(".");if(parts.length!==3)return null;
      const header=CommercialAccessHeaderSchema.parse(strict(parts[0]!));
      if(header.kid!==this.policy.keyId||!verify(null,Buffer.from(parts[0]+"."+parts[1]),this.publicKey,Buffer.from(parts[2]!,"base64url")))return null;
      if(Buffer.from(parts[2]!,"base64url").toString("base64url")!==parts[2])return null;
      claims=CommercialAccessClaimsSchema.parse(strict(parts[1]!));
      const now=Math.floor(Date.now()/1000);
      if(claims.iss!==this.policy.issuer||claims.aud!==this.policy.audience||claims.client_id!==this.policy.clientId||claims.iat>now||claims.exp<=now||claims.exp<=claims.iat||
        claims.exp-claims.iat>Math.ceil(this.policy.accessLifetimeMs/1000)||claims.exp*1000>Date.parse(this.policy.signingValidUntil))return null;
    }catch{return null;}
    const context:CommercialPossessionContext={operation,origin:this.policy.issuer,audience:this.policy.audience,clientId:this.policy.clientId,
      tenantId:claims.tid,installationId:claims.iid,deviceId:claims.did,credentialId:claims.cid,token,requestId:input.requestId,correlationId:input.correlationId,body:input.body};
    const proof=operation==="SESSION_ASSERTION"?await this.proofs.verifyAssertionAndConsume(input,context,this.policy.maximumProofSkewMs):
      operation==="AUTHORIZATION_SNAPSHOT"?await this.proofs.verifyAuthorizationAndConsume(input,context,this.policy.maximumProofSkewMs):null;
    if(!proof)return null;
    const c=await this.pool.connect();let begun=false;
    try{await c.query("BEGIN");begun=true;const family=await this.families.currentFamilyInTransaction(c,claims.fid);
      const valid=family&&family.sessionId===claims.sid&&family.userId===claims.sub&&family.membershipId===claims.mid&&family.tenantId===claims.tid&&
        family.deviceId===claims.did&&family.installationId===claims.iid&&family.credentialId===claims.cid&&claims.exp*1000<=family.expiresAt.getTime()&&
        jwkThumbprint(createPublicKey(family.publicKey.toString("utf8")))===claims.cnf.jkt&&claims.exp>Math.floor(Date.now()/1000)&&this.signingCurrent();
      await c.query("COMMIT");begun=false;return valid?Object.freeze({...claims}):null;
    }catch(error){if(begun)await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
}
