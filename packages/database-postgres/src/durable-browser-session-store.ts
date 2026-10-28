import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import type {Pool} from "pg";
import {PlatformSecurityEventCode,UuidSchema,uuidV7} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "./platform-security-event-repository.js";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
const COOKIE="__Host-camacho_business";
export type BrowserSessionRequest={cookie:string|null;origin:string|null;csrfToken:string|null;fetchSite:string|null;method:string};
type Request=BrowserSessionRequest;
export type BrowserSessionBinding={sessionId:string;userId:string;tenantId:string;tenantMembershipId:string};
type Bound=BrowserSessionBinding;
type Issued={setCookie:string;csrfToken:string};
export interface BrowserSessionPolicy{
  readonly mode:"CANONICAL"|"ISOLATED_VALIDATION";
  readonly lifetimeMs:number;readonly idleTimeoutMs:number;readonly maximumReauthenticationAgeMs:number;
}

/**
 * Canonical PostgreSQL custody, plus a compatibility profile for old fixtures.
 * Production mounting remains a separate D3 deployment decision. Every lookup
 * revalidates BUSINESS; identifiers alone cannot establish a canonical cookie.
 */
export class DurableBrowserSessionStore {
  private readonly policy:BrowserSessionPolicy;
  private readonly table:"identity.browser_sessions"|"identity.browser_session_validation";
  constructor(private readonly pool:Pool,private readonly origin:string,policy:BrowserSessionPolicy){
    if(!policy||!["CANONICAL","ISOLATED_VALIDATION"].includes(policy.mode)||
      ![policy.lifetimeMs,policy.idleTimeoutMs,policy.maximumReauthenticationAgeMs].every(n=>Number.isSafeInteger(n)&&n>0))throw Error("BROWSER_SESSION_EXPLICIT_POLICY_REQUIRED");
    this.policy=Object.freeze({...policy});
    this.table=policy.mode==="CANONICAL"?"identity.browser_sessions":"identity.browser_session_validation";
    const db=new URL(pool.options.connectionString??"invalid:");
    if(policy.mode==="ISOLATED_VALIDATION"&&(!["localhost","127.0.0.1"].includes(db.hostname)||db.port!=="55433"))
      throw Error("DURABLE_BROWSER_LOCAL_FIXTURE_REQUIRED");
    const url=new URL(origin);
    if(url.protocol!=="https:"||url.origin!==origin||url.hostname==="localhost"||
      url.hostname==="127.0.0.1")throw Error("DURABLE_BROWSER_ORIGIN_REQUIRED");
  }
  private extract(raw:string|null):string|null{
    if(typeof raw!=="string"||raw.length>8192)return null;
    const values=raw.split(";").map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+"="));
    if(values.length!==1)return null;
    const token=values[0]!.slice(COOKIE.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
  }
  private async transaction<T>(fn:(c:import("pg").PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();let begun=false;
    try{
      await c.query("BEGIN");begun=true;
      if(this.policy.mode==="ISOLATED_VALIDATION"){
        const ok=await c.query<{allowed:boolean}>("SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS allowed");
        if(ok.rows[0]?.allowed!==true)throw Error("DURABLE_BROWSER_ISOLATED_DATABASE_REQUIRED");
      }
      const value=await fn(c);
      await c.query("COMMIT");begun=false;return value;
    }catch(error){if(begun)await c.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{c.release();}
  }
  private async active(c:import("pg").PoolClient,b:Bound):Promise<boolean>{
    UuidSchema.parse(b.sessionId);UuidSchema.parse(b.userId);
    UuidSchema.parse(b.tenantId);UuidSchema.parse(b.tenantMembershipId);
    await c.query("SELECT set_config('app.tenant_id',$1,true)",[b.tenantId]);
    const row=await c.query(`SELECT 1 FROM identity.sessions s
      JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
      JOIN tenancy.tenants t ON t.id=s.tenant_id AND t.status='ACTIVE'
      JOIN tenancy.tenant_memberships m ON m.id=s.tenant_membership_id
       AND m.tenant_id=s.tenant_id AND m.user_id=s.user_id AND m.status='ACTIVE'
       AND m.revoked_at IS NULL AND m.suspended_at IS NULL
      WHERE s.id=$1 AND s.user_id=$2 AND s.tenant_id=$3
        AND s.tenant_membership_id=$4 AND s.mfa_status='SATISFIED'
        AND s.device_id IS NULL AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() ${this.policy.mode==="CANONICAL"?`
        AND s.authenticated_at<=clock_timestamp() AND s.created_at<=clock_timestamp()
        AND s.last_reauthenticated_at<=clock_timestamp()
        AND s.last_reauthenticated_at>=clock_timestamp()-($5::bigint*interval '1 millisecond')
        AND m.activated_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM identity.browser_session_handoffs h
          JOIN identity.user_credentials p ON p.id=h.password_credential_id AND p.user_id=s.user_id
            AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL
            AND p.version=h.password_credential_version AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp())
          JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=s.user_id
            AND f.factor_type='WEBAUTHN' AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
          JOIN identity.webauthn_challenges w ON w.id=h.challenge_id AND w.user_id=s.user_id AND w.factor_id=f.id
            AND w.purpose='AUTHENTICATE' AND w.session_id IS NULL AND w.consumed_at IS NOT NULL
          WHERE h.session_id=s.id AND h.user_id=s.user_id AND h.tenant_id=s.tenant_id
            AND h.membership_id=s.tenant_membership_id AND h.origin=$6 FOR SHARE OF p,f,w)` : ""}
        FOR SHARE OF s,u,t,m`,
      [b.sessionId,b.userId,b.tenantId,b.tenantMembershipId,...(this.policy.mode==="CANONICAL"?[this.policy.maximumReauthenticationAgeMs,this.origin]:[])]);
    return row.rowCount===1;
  }
  private cookie(token:string,maxAge:number){
    return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  }
  acceptsOrigin(origin:unknown):boolean{return origin===this.origin;}
  clearCookie():string{return this.cookie("",0);}
  private async audit(c:import("pg").PoolClient,b:Bound,event:typeof PlatformSecurityEventCode[keyof typeof PlatformSecurityEventCode]):Promise<void>{
    if(this.policy.mode!=="CANONICAL")return;
    const clock=await c.query<{at:Date}>("SELECT clock_timestamp() AS at");
    await new PostgresPlatformSecurityEventRepository(this.pool).append({
      user_id:b.userId,session_id:b.sessionId,tenant_id:b.tenantId,event_code:event,
      result:"SUCCEEDED",reason_code:"BUSINESS_BROWSER",correlation_id:uuidV7(),occurred_at:clock.rows[0]!.at.toISOString(),
    },c);
  }
  /** Consumes the PostgreSQL transition produced in the verified MFA/BUSINESS
   * transaction. It does not accept a session UUID or a reconstructed binding. */
  async establishFromHandoff(handoff:unknown):Promise<Issued|null>{
    if(this.policy.mode!=="CANONICAL")throw Error("BROWSER_CANONICAL_STORAGE_REQUIRED");
    if(typeof handoff!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(handoff))return null;
    const token=random(),csrf=random();
    return this.transaction(async c=>{
      const found=await c.query<{session_id:string;user_id:string;tenant_id:string;membership_id:string}>(`
        SELECT session_id::text,user_id::text,tenant_id::text,membership_id::text
        FROM identity.browser_session_handoffs WHERE handoff_hash=$1 AND origin=$2 AND tenant_id IS NOT NULL AND membership_id IS NOT NULL
          AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[hash(handoff),this.origin]);
      const row=found.rows[0];if(!row)return null;
      const binding={sessionId:row.session_id,userId:row.user_id,tenantId:row.tenant_id,tenantMembershipId:row.membership_id};
      if(!await this.active(c,binding))return null;
      await c.query("UPDATE identity.browser_session_handoffs SET consumed_at=clock_timestamp() WHERE handoff_hash=$1",[hash(handoff)]);
      const issued=await c.query<{remaining:number}>(`INSERT INTO identity.browser_sessions
        (cookie_hash,csrf_hash,handoff_hash,session_id,user_id,tenant_id,membership_id,origin,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST(clock_timestamp()+($9::bigint*interval '1 millisecond'),
          (SELECT expires_at FROM identity.sessions WHERE id=$4)))
        RETURNING greatest(0,floor(extract(epoch FROM expires_at-clock_timestamp())))::int AS remaining`,
        [hash(token),hash(csrf),hash(handoff),row.session_id,row.user_id,row.tenant_id,row.membership_id,this.origin,this.policy.lifetimeMs]);
      await this.audit(c,binding,PlatformSecurityEventCode.BROWSER_SESSION_ISSUED);
      const stillFresh=await c.query<{fresh:boolean}>(`SELECT h.expires_at>clock_timestamp() AND b.expires_at>clock_timestamp() AS fresh
        FROM identity.browser_session_handoffs h JOIN identity.browser_sessions b ON b.handoff_hash=h.handoff_hash
        WHERE h.handoff_hash=$1 AND b.cookie_hash=$2`,[hash(handoff),hash(token)]);
      if(stillFresh.rows[0]?.fresh!==true||!await this.active(c,binding))throw Error("BROWSER_SESSION_EXPIRED_DURING_COMMIT");
      return {setCookie:this.cookie(token,issued.rows[0]!.remaining),csrfToken:csrf};
    });
  }
  protected async establishValidation(binding:Bound):Promise<Issued|null>{
    if(this.policy.mode!=="ISOLATED_VALIDATION")throw Error("BROWSER_AUTHENTICATED_HANDOFF_REQUIRED");
    const token=random(),csrf=random();
    return this.transaction(async c=>{
      if(!await this.active(c,binding))return null;
      await c.query(`INSERT INTO ${this.table}
        (cookie_hash,csrf_hash,session_id,user_id,tenant_id,membership_id,origin,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),
          LEAST(clock_timestamp()+interval '5 minutes',
            (SELECT expires_at FROM identity.sessions WHERE id=$3)))`,
        [hash(token),hash(csrf),binding.sessionId,binding.userId,binding.tenantId,
          binding.tenantMembershipId,this.origin]);
      return {setCookie:this.cookie(token,300),csrfToken:csrf};
    });
  }
  async inspect(input:Request):Promise<Bound|null>{
    return this.use(input,false);
  }
  private async use(input:Request,consume:boolean):Promise<Bound|null>{
    if(input.origin!==this.origin||input.fetchSite!=="same-origin"||
      !["POST","DELETE"].includes(input.method)||!input.csrfToken||
      !/^[A-Za-z0-9_-]{43}$/.test(input.csrfToken))return null;
    const token=this.extract(input.cookie);if(!token)return null;
    const csrfToken=input.csrfToken;
    if(typeof csrfToken!=="string")return null;
    return this.transaction(async c=>{
      const found=await c.query<{session_id:string;user_id:string;tenant_id:string;membership_id:string;csrf_hash:string}>(`
        SELECT session_id::text,user_id::text,tenant_id::text,
          membership_id::text,csrf_hash
        FROM ${this.table}
        WHERE cookie_hash=$1 AND origin=$2 AND revoked_at IS NULL AND tenant_id IS NOT NULL AND membership_id IS NOT NULL
          AND expires_at>clock_timestamp() ${this.policy.mode==="CANONICAL"?"AND last_used_at>clock_timestamp()-($3::bigint*interval '1 millisecond')":""}
        FOR UPDATE`,[hash(token),this.origin,...(this.policy.mode==="CANONICAL"?[this.policy.idleTimeoutMs]:[])]);
      const row=found.rows[0];if(!row)return null;
      const a=Buffer.from(row.csrf_hash,"hex"),b=Buffer.from(hash(csrfToken),"hex");
      if(a.length!==b.length||!timingSafeEqual(a,b))return null;
      const bound={sessionId:row.session_id,userId:row.user_id,tenantId:row.tenant_id,
        tenantMembershipId:row.membership_id};
      if(!await this.active(c,bound))return null;
      if(consume)await c.query(`UPDATE ${this.table}
        SET revoked_at=clock_timestamp() WHERE cookie_hash=$1 AND revoked_at IS NULL`,[hash(token)]);
      if(this.policy.mode==="CANONICAL"){
        if(consume){
          // Lock the already verified BUSINESS row for revocation in this same
          // transaction; refresh credentials cannot survive a successful logout.
          await c.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='USER',
            revoked_by_actor_id=$2,revocation_reason='USER_LOGOUT',version=version+1 WHERE id=$1 AND revoked_at IS NULL`,[bound.sessionId,bound.userId]);
          await c.query("UPDATE identity.session_refresh_tokens SET revoked_at=clock_timestamp(),revocation_reason='USER_LOGOUT' WHERE session_id=$1 AND revoked_at IS NULL",[bound.sessionId]);
          await c.query("UPDATE identity.browser_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1 AND revoked_at IS NULL",[bound.sessionId]);
          await this.audit(c,bound,PlatformSecurityEventCode.SESSION_REVOKED);
        }else await c.query("UPDATE identity.browser_sessions SET last_used_at=clock_timestamp() WHERE cookie_hash=$1",[hash(token)]);
      }
      return bound;
    });
  }
  async logout(input:Request):Promise<boolean>{
    return (await this.use(input,true))!==null;
  }
  async rotate(input:Request):Promise<Issued|null>{
    if(input.origin!==this.origin||input.fetchSite!=="same-origin"||
      !["POST","DELETE"].includes(input.method)||!input.csrfToken||
      !/^[A-Za-z0-9_-]{43}$/.test(input.csrfToken))return null;
    const old=this.extract(input.cookie);if(!old)return null;
    const csrfToken=input.csrfToken;
    if(typeof csrfToken!=="string")return null;
    const fresh=random(),csrf=random();
    return this.transaction(async c=>{
      const found=await c.query<{session_id:string;user_id:string;tenant_id:string;membership_id:string;csrf_hash:string;expires_at:string;handoff_hash?:string}>(`
        SELECT session_id::text,user_id::text,tenant_id::text,
          membership_id::text,csrf_hash,expires_at::text ${this.policy.mode==="CANONICAL"?",handoff_hash":""} FROM ${this.table}
        WHERE cookie_hash=$1 AND origin=$2 AND revoked_at IS NULL AND tenant_id IS NOT NULL AND membership_id IS NOT NULL AND expires_at>clock_timestamp()
          ${this.policy.mode==="CANONICAL"?"AND last_used_at>clock_timestamp()-($3::bigint*interval '1 millisecond')":""}
        FOR UPDATE`,[hash(old),this.origin,...(this.policy.mode==="CANONICAL"?[this.policy.idleTimeoutMs]:[])]);
      const row=found.rows[0];if(!row)return null;
      const a=Buffer.from(row.csrf_hash,"hex"),b=Buffer.from(hash(csrfToken),"hex");
      if(a.length!==b.length||!timingSafeEqual(a,b))return null;
      if(!await this.active(c,{sessionId:row.session_id,userId:row.user_id,
        tenantId:row.tenant_id,tenantMembershipId:row.membership_id}))return null;
      await c.query(`UPDATE ${this.table} SET revoked_at=clock_timestamp() WHERE cookie_hash=$1`,[hash(old)]);
      if(this.policy.mode==="CANONICAL"){
        const inserted=await c.query<{remaining:number}>(`INSERT INTO identity.browser_sessions
          (cookie_hash,csrf_hash,handoff_hash,session_id,user_id,tenant_id,membership_id,origin,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING greatest(0,floor(extract(epoch FROM expires_at-clock_timestamp())))::int AS remaining`,
          [hash(fresh),hash(csrf),row.handoff_hash,row.session_id,row.user_id,row.tenant_id,row.membership_id,this.origin,row.expires_at]);
        await this.audit(c,{sessionId:row.session_id,userId:row.user_id,tenantId:row.tenant_id,tenantMembershipId:row.membership_id},PlatformSecurityEventCode.BROWSER_SESSION_ROTATED);
        const freshCheck=await c.query<{ok:boolean}>("SELECT expires_at>clock_timestamp() AS ok FROM identity.browser_sessions WHERE cookie_hash=$1",[hash(fresh)]);
        if(freshCheck.rows[0]?.ok!==true)throw Error("BROWSER_SESSION_EXPIRED_DURING_COMMIT");
        return {setCookie:this.cookie(fresh,inserted.rows[0]!.remaining),csrfToken:csrf};
      }
      await c.query(`INSERT INTO ${this.table}
        (cookie_hash,csrf_hash,session_id,user_id,tenant_id,membership_id,origin,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),
        LEAST(clock_timestamp()+interval '5 minutes',
          (SELECT expires_at FROM identity.sessions WHERE id=$3)))`,
        [hash(fresh),hash(csrf),row.session_id,row.user_id,row.tenant_id,row.membership_id,this.origin]);
      return {setCookie:this.cookie(fresh,300),csrfToken:csrf};
    });
  }
}
