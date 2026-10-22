import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import type {Pool} from "pg";
import {UuidSchema} from "@pos-platform/contracts";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
const COOKIE="__Host-camacho_business";
const TTL=300;
type Request={cookie:string|null;origin:string|null;csrfToken:string|null;fetchSite:string|null;method:string};
type Bound={sessionId:string;userId:string;tenantId:string;tenantMembershipId:string};
type Issued={setCookie:string;csrfToken:string};

/**
 * Disposable PostgreSQL fixture only. Every lookup revalidates the canonical
 * BUSINESS session under the same transaction; a session UUID or copied
 * in-process reference is never sufficient to establish a browser cookie.
 * Caller must have the MFA-originated, trusted in-process binding.
 */
export class IsolatedDurableBrowserSessionStore {
  constructor(private readonly pool:Pool,private readonly origin:string){
    const db=new URL(pool.options.connectionString??"invalid:");
    if(!["localhost","127.0.0.1"].includes(db.hostname)||db.port!=="55433")
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
      const ok=await c.query<{allowed:boolean}>(
        "SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS allowed");
      if(ok.rows[0]?.allowed!==true)throw Error("DURABLE_BROWSER_ISOLATED_DATABASE_REQUIRED");
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
        AND s.expires_at>clock_timestamp() FOR SHARE OF s,u,t,m`,
      [b.sessionId,b.userId,b.tenantId,b.tenantMembershipId]);
    return row.rowCount===1;
  }
  private cookie(token:string,maxAge:number){
    return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  }
  async establish(binding:Bound,authenticatedProvenance:object):Promise<Issued|null>{
    // Non-serializable provenance is required by caller; never exposed in HTTP.
    if(!authenticatedProvenance||typeof authenticatedProvenance!=="object"||
      !Object.isFrozen(authenticatedProvenance))return null;
    const token=random(),csrf=random();
    return this.transaction(async c=>{
      if(!await this.active(c,binding))return null;
      await c.query(`INSERT INTO identity.browser_session_validation
        (cookie_hash,csrf_hash,session_id,user_id,tenant_id,membership_id,origin,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),
          LEAST(clock_timestamp()+interval '5 minutes',
            (SELECT expires_at FROM identity.sessions WHERE id=$3)))`,
        [hash(token),hash(csrf),binding.sessionId,binding.userId,binding.tenantId,
          binding.tenantMembershipId,this.origin]);
      return {setCookie:this.cookie(token,TTL),csrfToken:csrf};
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
    return this.transaction(async c=>{
      const found=await c.query<{session_id:string;user_id:string;tenant_id:string;membership_id:string;csrf_hash:string}>(`
        SELECT session_id::text,user_id::text,tenant_id::text,
          membership_id::text,csrf_hash
        FROM identity.browser_session_validation
        WHERE cookie_hash=$1 AND revoked_at IS NULL
          AND expires_at>clock_timestamp() FOR UPDATE`,[hash(token)]);
      const row=found.rows[0];if(!row)return null;
      const a=Buffer.from(row.csrf_hash,"hex"),b=Buffer.from(hash(input.csrfToken),"hex");
      if(a.length!==b.length||!timingSafeEqual(a,b))return null;
      const bound={sessionId:row.session_id,userId:row.user_id,tenantId:row.tenant_id,
        tenantMembershipId:row.membership_id};
      if(!await this.active(c,bound))return null;
      if(consume)await c.query(`UPDATE identity.browser_session_validation
        SET revoked_at=clock_timestamp() WHERE cookie_hash=$1 AND revoked_at IS NULL`,[hash(token)]);
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
    const fresh=random(),csrf=random();
    return this.transaction(async c=>{
      const found=await c.query<{session_id:string;user_id:string;tenant_id:string;membership_id:string;csrf_hash:string}>(`
        SELECT session_id::text,user_id::text,tenant_id::text,
          membership_id::text,csrf_hash FROM identity.browser_session_validation
        WHERE cookie_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
        FOR UPDATE`,[hash(old)]);
      const row=found.rows[0];if(!row)return null;
      const a=Buffer.from(row.csrf_hash,"hex"),b=Buffer.from(hash(input.csrfToken),"hex");
      if(a.length!==b.length||!timingSafeEqual(a,b))return null;
      if(!await this.active(c,{sessionId:row.session_id,userId:row.user_id,
        tenantId:row.tenant_id,tenantMembershipId:row.membership_id}))return null;
      await c.query("UPDATE identity.browser_session_validation SET revoked_at=clock_timestamp() WHERE cookie_hash=$1",[hash(old)]);
      await c.query(`INSERT INTO identity.browser_session_validation
        (cookie_hash,csrf_hash,session_id,user_id,tenant_id,membership_id,origin,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),
        LEAST(clock_timestamp()+interval '5 minutes',
          (SELECT expires_at FROM identity.sessions WHERE id=$3)))`,
        [hash(fresh),hash(csrf),row.session_id,row.user_id,row.tenant_id,row.membership_id,this.origin]);
      return {setCookie:this.cookie(fresh,TTL),csrfToken:csrf};
    });
  }
}
