import {createHash,randomBytes} from "node:crypto";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode,uuidV7,UuidSchema} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";

type SessionBinding={sessionId:string;userId:string;tenantId:string;tenantMembershipId:string};
const tokenHash=(raw:string)=>createHash("sha256").update(raw,"utf8").digest("hex");
const newToken=()=>randomBytes(48).toString("base64url");

/** Lab-only opaque refresh rotation. NOT an access token or production endpoint. */
export class IsolatedBusinessRefreshRotation {
  private readonly guard:IsolatedBusinessAuditSessionGuard;
  private readonly audit:PostgresPlatformSecurityEventRepository;
  constructor(private readonly pool:Pool){
    this.guard=new IsolatedBusinessAuditSessionGuard(pool);
    this.audit=new PostgresPlatformSecurityEventRepository(pool);
  }
  async issue(binding:SessionBinding,correlationId:string):Promise<string|null>{
    UuidSchema.parse(correlationId);
    const token=newToken(),id=uuidV7(),family=uuidV7();
    return this.guard.whileActive(binding,async client=>{
      const result=await client.query(`INSERT INTO identity.session_refresh_tokens
        (id,session_id,token_family_id,parent_token_id,token_hash,issued_at,expires_at)
        SELECT $1,s.id,$2,NULL,$3,clock_timestamp(),
          LEAST(s.expires_at,clock_timestamp()+interval '8 hours')
        FROM identity.sessions s
        WHERE s.id=$4 AND s.tenant_id=$5 AND s.user_id=$6
          AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()+interval '1 second'
        RETURNING id`,[id,family,tokenHash(token),binding.sessionId,binding.tenantId,binding.userId]);
      if(result.rowCount!==1) throw new Error("REFRESH_SESSION_NOT_ELIGIBLE");
      return token;
    });
  }
  async rotate(binding:SessionBinding,raw:string,correlationId:string):Promise<
    {status:"ROTATED";refreshToken:string}|{status:"REUSE_DETECTED"}|null
  >{
    UuidSchema.parse(correlationId);
    if(typeof raw!=="string"||!/^[A-Za-z0-9_-]{64}$/.test(raw))return null;
    return this.guard.whileActive(binding,async client=>{
      const current=await client.query<{
        id:string;token_family_id:string;consumed_at:Date|null;expires_at:Date;
        revoked_at:Date|null;
      }>(`SELECT id::text,token_family_id::text,consumed_at,expires_at,revoked_at
          FROM identity.session_refresh_tokens WHERE session_id=$1 AND token_hash=$2
          FOR UPDATE`,[binding.sessionId,tokenHash(raw)]);
      const row=current.rows[0];
      if(!row)return null;
      // Family revocation is durable, even though no replacement credential is returned.
      if(row.consumed_at!==null){
        await client.query(`UPDATE identity.session_refresh_tokens
           SET revoked_at=clock_timestamp(),revocation_reason='REFRESH_REUSE_DETECTED',
               reuse_detected_at=CASE WHEN id=$2 THEN clock_timestamp() ELSE reuse_detected_at END
           WHERE token_family_id=$1 AND revoked_at IS NULL`,[row.token_family_id,row.id]);
        const at=(await client.query<{at:Date}>("SELECT clock_timestamp() AS at")).rows[0]!.at.toISOString();
        await this.audit.append({user_id:binding.userId,session_id:binding.sessionId,
          tenant_id:binding.tenantId,event_code:PlatformSecurityEventCode.REFRESH_REUSE_DETECTED,
          result:"DETECTED",reason_code:"REFRESH_REPLAY",correlation_id:correlationId,occurred_at:at},client);
        return {status:"REUSE_DETECTED" as const};
      }
      if(row.revoked_at!==null || row.expires_at.getTime()<=Date.now())return null;
      const next=newToken(),nextId=uuidV7();
      const inserted=await client.query(`INSERT INTO identity.session_refresh_tokens
        (id,session_id,token_family_id,parent_token_id,token_hash,issued_at,expires_at)
        SELECT $1,$2,$3,$4,$5,clock_timestamp(),
          LEAST(s.expires_at,clock_timestamp()+interval '8 hours')
        FROM identity.sessions s WHERE s.id=$2 AND s.revoked_at IS NULL
          AND s.expires_at>clock_timestamp()+interval '1 second'
        RETURNING id`,[nextId,binding.sessionId,row.token_family_id,row.id,tokenHash(next)]);
      if(inserted.rowCount!==1)throw new Error("REFRESH_SESSION_NOT_ELIGIBLE");
      await client.query(`UPDATE identity.session_refresh_tokens
        SET consumed_at=clock_timestamp(),replacement_token_id=$2
        WHERE id=$1 AND consumed_at IS NULL`,[row.id,nextId]);
      const at=(await client.query<{at:Date}>("SELECT clock_timestamp() AS at")).rows[0]!.at.toISOString();
      await this.audit.append({user_id:binding.userId,session_id:binding.sessionId,
        tenant_id:binding.tenantId,event_code:PlatformSecurityEventCode.REFRESH_ROTATED,
        result:"SUCCEEDED",reason_code:"ISOLATED_REFRESH_ROTATION",
        correlation_id:correlationId,occurred_at:at},client);
      return {status:"ROTATED" as const,refreshToken:next};
    });
  }
}
