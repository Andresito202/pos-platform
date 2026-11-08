import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {uuidV7,PlatformSecurityEventCode,validateCommercialHttpsOrigin} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,PostgresPlatformSecurityEventRepository,type Pool,type PoolClient,type BrowserSessionRequest} from "@pos-platform/database-postgres";
import {BusinessInitialMfaFlow} from "./business-initial-mfa-flow.js";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
const COOKIE="__Host-camacho_platform";
export interface GlobalAdministrationPolicy{
  mode:"ISOLATED_VALIDATION"|"DEPLOYMENT";
  origin:string;rpId:string;policyReference:string;rejectionVerifier:string;challengeLifetimeMs:number;
  sessionLifetimeMs:number;maximumMfaAgeMs:number;maximumReauthenticationAgeMs:number;browserLifetimeMs:number;idleTimeoutMs:number;
  lockTimeoutMs:number;statementTimeoutMs:number;
}

/** Separate GLOBAL authority on existing identity/password/MFA/session custody.
 * No tenant selection, bearer UUID, permission synthesis or BUSINESS promotion. */
export class GlobalAdministrationSessions{
  private readonly mfa:BusinessInitialMfaFlow;
  private readonly policy:Readonly<GlobalAdministrationPolicy>;
  constructor(private readonly pool:Pool,policy:GlobalAdministrationPolicy){
    if(policy.mode==="DEPLOYMENT")validateCommercialHttpsOrigin(policy.origin);
    else if(policy.mode==="ISOLATED_VALIDATION"){
      const db=new URL(pool.options.connectionString??"invalid:"),origin=new URL(policy.origin);
      if(!["127.0.0.1","localhost"].includes(db.hostname)||db.port!=="55433"||!/^\/pos_subscription_quotes_test_[a-f0-9]{16}$/.test(db.pathname)||
        origin.protocol!=="https:"||origin.origin!==policy.origin)throw Error("GLOBAL_ADMIN_ISOLATED_DATABASE_REQUIRED");
    }else throw Error("GLOBAL_ADMIN_EXPLICIT_POLICY_REQUIRED");
    if(new URL(policy.origin).hostname!==policy.rpId||!policy.policyReference?.trim()||
      ![policy.challengeLifetimeMs,policy.sessionLifetimeMs,policy.maximumMfaAgeMs,policy.maximumReauthenticationAgeMs,policy.browserLifetimeMs,
        policy.idleTimeoutMs,policy.lockTimeoutMs,policy.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)||
      policy.maximumMfaAgeMs>policy.sessionLifetimeMs||policy.browserLifetimeMs>policy.sessionLifetimeMs||policy.statementTimeoutMs<=policy.lockTimeoutMs)
      throw Error("GLOBAL_ADMIN_EXPLICIT_POLICY_REQUIRED");
    this.policy=Object.freeze({...policy});
    this.mfa=new BusinessInitialMfaFlow(pool,{rpId:policy.rpId,origin:policy.origin,challengeLifetimeMs:policy.challengeLifetimeMs,
      rejectionVerifier:policy.rejectionVerifier,sessionScope:"GLOBAL"});
  }
  begin(input:Parameters<BusinessInitialMfaFlow["begin"]>[0]){return this.mfa.begin(input);}
  private async transaction<T>(work:(c:PoolClient)=>Promise<T>){
    const c=await this.pool.connect();try{await c.query("BEGIN");
      await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
        [`${this.policy.lockTimeoutMs}ms`,`${this.policy.statementTimeoutMs}ms`]);
      await c.query("SELECT set_config('app.tenant_id','',true)");
      if((await c.query("SELECT current_user='pos_platform_app' AS ok")).rows[0]?.ok!==true)throw Error("GLOBAL_ADMIN_CENTRAL_ROLE_REQUIRED");
      if(this.policy.mode==="ISOLATED_VALIDATION"&&(await c.query("SELECT current_database() ~ '^pos_subscription_quotes_test_[a-f0-9]{16}$' AS ok")).rows[0]?.ok!==true)
        throw Error("GLOBAL_ADMIN_ISOLATED_DATABASE_REQUIRED");
      const value=await work(c);await c.query("COMMIT");return value;
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  private cookie(token:string,seconds:number){return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;}
  clearCookie(){return this.cookie("",0);}
  async complete(input:Parameters<BusinessInitialMfaFlow["complete"]>[0],previousCookie:string|null=null){
    const receipt=await this.mfa.complete(input),e=this.mfa.takeForGlobalSession(receipt);if(!e)return null;
    const cookie=random(),csrf=random(),session=uuidV7(),handoff=hash(random()),p=this.policy;
    return this.transaction(async c=>{
      await c.query('SELECT "authorization".lock_platform_sources_for_read()');
      const rows=await c.query(`SELECT 1 FROM identity.webauthn_challenges w JOIN identity.users u ON u.id=w.user_id AND u.status='ACTIVE'
        JOIN identity.user_credentials pwd ON pwd.id=$3 AND pwd.user_id=u.id AND pwd.status='ACTIVE' AND pwd.credential_type='PASSWORD'
          AND pwd.version::text=$4 AND pwd.revoked_at IS NULL AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=w.factor_id AND f.user_id=u.id AND f.id=$5 AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        JOIN "authorization".platform_role_assignments a ON a.user_id=u.id AND a.status='ACTIVE' AND a.valid_from<=clock_timestamp()
          AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
        JOIN "authorization".roles r ON r.id=a.role_id AND r.scope_type='PLATFORM' AND r.status='ACTIVE'
        WHERE w.id=$1 AND w.user_id=$2 AND w.purpose='GLOBAL_AUTHENTICATE' AND w.session_id IS NULL AND w.consumed_at IS NOT NULL
          AND w.rp_id=$6 AND w.expected_origin=$7 AND w.correlation_id=$8
          AND EXISTS(SELECT 1 FROM identity.security_events s WHERE s.user_id=u.id AND s.correlation_id=w.correlation_id
            AND s.reason_code='GLOBAL_INITIAL_MFA' AND s.event_code=$9 AND s.result='SUCCEEDED' AND s.occurred_at=$10::timestamptz)
        FOR UPDATE OF w FOR SHARE OF u,pwd,f,a`,[e.challengeId,e.userId,e.passwordCredentialId,e.passwordCredentialVersion,e.factorId,p.rpId,p.origin,
          e.correlationId,PlatformSecurityEventCode.WEBAUTHN_ASSERTION_VERIFIED,e.verifiedAt]);
      if(!rows.rowCount)throw Error("GLOBAL_ADMIN_ACTIVE_IDENTITY_AND_ROLE_REQUIRED");
      const inserted=await c.query(`INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at)
        SELECT $1,$2,$3::timestamptz,$3::timestamptz+$4*interval '1 millisecond',$3::timestamptz,'SATISFIED',clock_timestamp()
        WHERE $3::timestamptz<=clock_timestamp() AND $3::timestamptz>=clock_timestamp()-$5*interval '1 millisecond' RETURNING id`,
        [session,e.userId,e.verifiedAt,p.sessionLifetimeMs,Math.min(p.maximumMfaAgeMs,p.maximumReauthenticationAgeMs)]);
      if(inserted.rowCount!==1)throw Error("GLOBAL_ADMIN_FRESH_MFA_REQUIRED");
      // A fresh successful ceremony replaces only this browser's previous
      // GLOBAL cookie. Reload/user change must not leave its old principal live.
      const previous=this.extract(previousCookie);
      if(previous){
        const old=(await c.query(`SELECT b.session_id,b.user_id FROM identity.browser_sessions b JOIN identity.sessions s ON s.id=b.session_id AND s.user_id=b.user_id
          WHERE b.cookie_hash=$1 AND b.origin=$2 AND b.tenant_id IS NULL AND b.membership_id IS NULL AND b.revoked_at IS NULL
          AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL FOR UPDATE OF b,s`,[hash(previous),p.origin])).rows[0];
        if(old){
          await c.query("UPDATE identity.browser_sessions SET last_used_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE cookie_hash=$1",[hash(previous)]);
          await c.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revocation_reason='GLOBAL_BROWSER_REPLACED',version=version+1 WHERE id=$1 AND revoked_at IS NULL",[old.session_id]);
          await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:old.user_id,session_id:old.session_id,tenant_id:null,
            event_code:PlatformSecurityEventCode.SESSION_REVOKED,result:"REVOKED",reason_code:"GLOBAL_BROWSER_REPLACED",correlation_id:e.correlationId,occurred_at:new Date().toISOString()},c);
        }
      }
      await c.query(`INSERT INTO identity.browser_session_handoffs(handoff_hash,session_id,user_id,tenant_id,membership_id,challenge_id,
        password_credential_id,password_credential_version,factor_id,origin,expires_at,consumed_at)
        VALUES($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,clock_timestamp()+$9*interval '1 millisecond',clock_timestamp())`,
        [handoff,session,e.userId,e.challengeId,e.passwordCredentialId,e.passwordCredentialVersion,e.factorId,p.origin,p.browserLifetimeMs]);
      const persisted=await c.query(`INSERT INTO identity.browser_sessions(cookie_hash,csrf_hash,handoff_hash,session_id,user_id,tenant_id,membership_id,origin,expires_at)
        SELECT $1,$2,$3,id,user_id,NULL,NULL,$4,LEAST(expires_at,clock_timestamp()+$5*interval '1 millisecond') FROM identity.sessions WHERE id=$6
        RETURNING greatest(0,floor(extract(epoch FROM expires_at-clock_timestamp())))::int AS seconds`,[hash(cookie),hash(csrf),handoff,p.origin,p.browserLifetimeMs,session]);
      await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:e.userId,session_id:session,tenant_id:null,
        event_code:PlatformSecurityEventCode.LOGIN_SUCCEEDED,result:"SUCCEEDED",reason_code:"GLOBAL_BROWSER",correlation_id:e.correlationId,occurred_at:new Date().toISOString()},c);
      if((await c.query(`SELECT 1 FROM identity.browser_sessions b JOIN identity.sessions s ON s.id=b.session_id WHERE b.cookie_hash=$1
        AND b.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp() AND s.authenticated_at>=clock_timestamp()-$2*interval '1 millisecond'`,
        [hash(cookie),Math.min(p.maximumMfaAgeMs,p.maximumReauthenticationAgeMs)])).rowCount!==1)throw Error("GLOBAL_ADMIN_FRESH_MFA_REQUIRED");
      return {setCookie:this.cookie(cookie,persisted.rows[0].seconds),csrfToken:csrf};
    });
  }
  private extract(cookie:string|null){
    if(!cookie||cookie.length>8192)return null;
    const values=cookie.split(";").map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+"="));
    if(values.length!==1)return null;const value=values[0]!.slice(COOKIE.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
  }
  /** Permission resolved anew for every operation; the returned UUID is internal
   * context only and is never accepted as HTTP authentication. */
  async authorize(request:BrowserSessionRequest,permission:string):Promise<string|null>{
    if(request.method!=="POST"||request.origin!==this.policy.origin||request.fetchSite!=="same-origin"||
      !request.csrfToken||!/^[A-Za-z0-9_-]{43}$/.test(request.csrfToken))return null;
    const cookie=this.extract(request.cookie);if(!cookie)return null;
    return this.transaction(async c=>{
      await c.query('SELECT "authorization".lock_platform_sources_for_read()');
      const found=(await c.query(`SELECT b.*,h.password_credential_id,h.password_credential_version,h.factor_id FROM identity.browser_sessions b
        JOIN identity.browser_session_handoffs h ON h.handoff_hash=b.handoff_hash AND h.session_id=b.session_id AND h.user_id=b.user_id
        JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=b.user_id AND pwd.status='ACTIVE'
          AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
        JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=b.user_id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        WHERE b.cookie_hash=$1 AND b.origin=$2 AND b.tenant_id IS NULL AND b.membership_id IS NULL AND h.tenant_id IS NULL AND h.membership_id IS NULL
          AND b.revoked_at IS NULL AND b.expires_at>clock_timestamp() AND b.last_used_at>clock_timestamp()-$3*interval '1 millisecond'
        FOR UPDATE OF b FOR SHARE OF pwd,f`,[hash(cookie),this.policy.origin,this.policy.idleTimeoutMs])).rows[0];
      if(!found||!timingSafeEqual(Buffer.from(hash(request.csrfToken!)),Buffer.from(found.csrf_hash)))return null;
      await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[found.session_id]);
      const authority=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(found.session_id,permission,this.policy.maximumReauthenticationAgeMs);
      if(!authority)return null;
      await c.query("UPDATE identity.browser_sessions SET last_used_at=clock_timestamp() WHERE cookie_hash=$1",[hash(cookie)]);
      return String(found.session_id);
    });
  }

  /** Closing one's own opaque session never requires a still-active grant. */
  async close(request:BrowserSessionRequest):Promise<string|null>{
    if(request.method!=="POST"||request.origin!==this.policy.origin||request.fetchSite!=="same-origin"||
      !request.csrfToken||!/^[A-Za-z0-9_-]{43}$/.test(request.csrfToken))return null;
    const cookie=this.extract(request.cookie);if(!cookie)return null;
    return this.transaction(async c=>{
      const b=(await c.query(`SELECT b.session_id,b.user_id,b.csrf_hash FROM identity.browser_sessions b JOIN identity.sessions s ON s.id=b.session_id
        AND s.user_id=b.user_id AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL
        WHERE b.cookie_hash=$1 AND b.origin=$2 AND b.tenant_id IS NULL AND b.membership_id IS NULL AND b.revoked_at IS NULL
        FOR UPDATE OF b,s`,[hash(cookie),this.policy.origin])).rows[0];
      if(!b||!timingSafeEqual(Buffer.from(hash(request.csrfToken!)),Buffer.from(b.csrf_hash)))return null;
      await c.query("UPDATE identity.browser_sessions SET last_used_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE cookie_hash=$1",[hash(cookie)]);
      await c.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='USER',revoked_by_actor_id=$2,revocation_reason='USER_LOGOUT',version=version+1 WHERE id=$1 AND revoked_at IS NULL",[b.session_id,b.user_id]);
      await new PostgresPlatformSecurityEventRepository(this.pool).append({user_id:b.user_id,session_id:b.session_id,tenant_id:null,
        event_code:PlatformSecurityEventCode.SESSION_REVOKED,result:"REVOKED",reason_code:"GLOBAL_BROWSER_LOGOUT",correlation_id:uuidV7(),occurred_at:new Date().toISOString()},c);
      return String(b.session_id);
    });
  }

  /** Durable fixed-window spending on the existing append-only security ledger.
   * Both attempted successes and failures consume address/account budgets. */
  spendLoginBudget(address:string,email:string,policy:{windowMs:number;maximumPerAddress:number;maximumPerAccount:number}){
    if(![policy.windowMs,policy.maximumPerAddress,policy.maximumPerAccount].every(n=>Number.isSafeInteger(n)&&n>0)||
      typeof address!=="string"||address.length>256||typeof email!=="string"||email.length>320)throw Error("GLOBAL_ADMIN_ABUSE_POLICY_REQUIRED");
    return this.transaction(async c=>{
      const keys=[{reason:"GLOBAL_LOGIN_ACCOUNT",digest:hash(email.trim().toLowerCase()),max:policy.maximumPerAccount},
        {reason:"GLOBAL_LOGIN_ADDRESS",digest:hash(address),max:policy.maximumPerAddress}];
      for(const k of keys)await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[k.reason+":"+k.digest]);
      for(const k of keys){const n=(await c.query(`SELECT count(*)::int AS n FROM identity.security_events WHERE event_code=$1 AND reason_code=$2
        AND evidence_checksum=$3 AND server_recorded_at>clock_timestamp()-$4*interval '1 millisecond'`,
        [PlatformSecurityEventCode.MFA_REQUIRED,k.reason,k.digest,policy.windowMs])).rows[0].n;if(n>=k.max)return false;}
      for(const k of keys)await c.query(`INSERT INTO identity.security_events(id,event_code,result,reason_code,evidence_checksum,correlation_id,occurred_at,server_recorded_at)
        VALUES($1,$2,'CHALLENGE_REQUIRED',$3,$4,$5,clock_timestamp(),clock_timestamp())`,[uuidV7(),PlatformSecurityEventCode.MFA_REQUIRED,k.reason,k.digest,uuidV7()]);
      return true;
    });
  }
}
