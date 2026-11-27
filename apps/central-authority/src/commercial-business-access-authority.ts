import {createHash,createPrivateKey,createPublicKey,sign,verify,type KeyObject} from "node:crypto";
import {uuidV7,PlatformSecurityEventCode,canonicalSessionTrustJson,CommercialAccessClaimsSchema,CommercialAccessHeaderSchema,type CommercialAccessClaims} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository,PostgresCommercialRefreshFamilies,PostgresCommercialPossessionVerifier,type Pool,type PoolClient,type DeviceProofRequest} from "@pos-platform/database-postgres";
import type {CommercialPossessionContext} from "@pos-platform/device-trust";
const b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
const strict=(s:string)=>{const decoded=Buffer.from(s,"base64url");if(decoded.toString("base64url")!==s)throw Error("ACCESS_ENCODING_INVALID");return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decoded)) as unknown;};
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
 * production policy. Only V2 device-bound tokens are accepted. The public verifier
 * requires possession and current canonical family/session/device state. */
export class CommercialBusinessAccessAuthority{
  private readonly verified=new WeakSet<object>();
  private readonly privateKey:KeyObject;private readonly publicKey:KeyObject;
  private readonly policy:Readonly<CommercialAccessPolicy>;
  private readonly proofs:PostgresCommercialPossessionVerifier;
  constructor(private readonly pool:Pool,keys:{privatePem:string;publicPem:string},policy:CommercialAccessPolicy,
    private readonly families:PostgresCommercialRefreshFamilies){
    this.privateKey=createPrivateKey(keys.privatePem);this.publicKey=createPublicKey(keys.publicPem);
    const url=new URL(policy.issuer);
    if(!(families instanceof PostgresCommercialRefreshFamilies)||!families.matchesRegistration(policy.issuer,policy.audience,policy.clientId)||
      url.protocol!=="https:"||url.origin!==policy.issuer||!policy.keyId||policy.keyId.length>128||
      ![policy.accessLifetimeMs,policy.maximumProofSkewMs].every(n=>Number.isSafeInteger(n)&&n>0)||policy.maximumProofSkewMs>120_000||policy.accessLifetimeMs>300_000||
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
    try{await c.query("BEGIN");begun=true;await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='10s'");const family=await this.families.currentFamilyInTransaction(c,claims.fid);
      const valid=family&&family.sessionId===claims.sid&&family.userId===claims.sub&&family.membershipId===claims.mid&&family.tenantId===claims.tid&&
        family.deviceId===claims.did&&family.installationId===claims.iid&&family.credentialId===claims.cid&&claims.exp*1000<=family.expiresAt.getTime()&&
        jwkThumbprint(createPublicKey(family.publicKey.toString("utf8")))===claims.cnf.jkt&&claims.exp>Math.floor(Date.now()/1000)&&this.signingCurrent();
      await c.query("COMMIT");begun=false;
      if(!valid)return null;
      const evidence=Object.freeze({...claims});this.verified.add(evidence);return evidence;
    }catch(error){if(begun)await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  /** Internal capability: serialized claims cannot cross this boundary. Recheck
   * under the caller's issuance transaction, retaining canonical family locks. */
  async currentInTransaction(c:PoolClient,claims:CommercialAccessClaims):Promise<boolean>{
    if(!this.verified.has(claims)||!this.signingCurrent()||claims.exp<=Math.floor(Date.now()/1000))return false;
    const f=await this.families.currentFamilyInTransaction(c,claims.fid);
    return !!f&&f.sessionId===claims.sid&&f.userId===claims.sub&&f.membershipId===claims.mid&&f.tenantId===claims.tid&&
      f.deviceId===claims.did&&f.installationId===claims.iid&&f.credentialId===claims.cid&&claims.exp*1000<=f.expiresAt.getTime()&&
      jwkThumbprint(createPublicKey(f.publicKey.toString("utf8")))===claims.cnf.jkt;
  }
}
