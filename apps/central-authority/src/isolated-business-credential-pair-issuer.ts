import {createHash,randomBytes} from "node:crypto";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {UuidSchema,uuidV7} from "@pos-platform/contracts";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";
import {IsolatedBusinessAccessTokenCodec} from "./isolated-business-access-token-codec.js";
import type {ValidatedCommercialBinding} from "./commercial-binding-prerequisite.js";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");

/**
 * Isolated only: issue both credentials in ONE database transaction.
 * A caller must provide an already authenticated, verified binding; the
 * protected session is locked again and device status checked by the codec.
 * Tokens are returned only after the guard commits; never exposed over HTTP.
 */
export class IsolatedBusinessCredentialPairIssuer {
  private readonly guard:IsolatedBusinessAuditSessionGuard;
  constructor(private readonly pool:Pool,private readonly access:IsolatedBusinessAccessTokenCodec){
    this.guard=new IsolatedBusinessAuditSessionGuard(pool);
    if(!(access instanceof IsolatedBusinessAccessTokenCodec))
      throw new Error("CREDENTIAL_PAIR_TRUSTED_ACCESS_CODEC_REQUIRED");
  }
  async issue(binding:ValidatedCommercialBinding,correlationId:string):Promise<
    {accessToken:string;refreshToken:string}|null
  >{
    UuidSchema.parse(correlationId);
    if(!binding?.identity||!binding?.device||binding.identity.tenantId!==binding.device.tenantId)return null;
    const refreshToken=randomBytes(48).toString("base64url");
    const result=await this.guard.whileActive(binding.identity,async client=>{
      return this.issueInTransaction(client,binding,correlationId,refreshToken);
    });
    return result;
  }
  /** Caller must hold a verified and locked BUSINESS session in this transaction. */
  async issueInTransaction(client:PoolClient,binding:ValidatedCommercialBinding,
    correlationId:string,providedToken?:string):Promise<{accessToken:string;refreshToken:string}>{
      UuidSchema.parse(correlationId);
      if(!binding?.identity||!binding?.device||binding.identity.tenantId!==binding.device.tenantId)
        throw Error("CREDENTIAL_PAIR_BINDING_REQUIRED");
      const refreshToken=providedToken??randomBytes(48).toString("base64url");
      // The access codec revalidates the full BUSINESS membership and device
      // before signing, using this exact transaction and canonical audit.
      const accessToken=await this.access.issueInTransaction(client,binding.identity,{
        deviceId:binding.device.deviceId,credentialId:binding.device.credentialId,
      },correlationId);
      const insert=await client.query(`INSERT INTO identity.session_refresh_tokens
        (id,session_id,token_family_id,parent_token_id,token_hash,issued_at,expires_at)
        SELECT $1,s.id,$2,NULL,$3,clock_timestamp(),
          LEAST(s.expires_at,clock_timestamp()+interval '8 hours')
        FROM identity.sessions s
        WHERE s.id=$4 AND s.user_id=$5 AND s.tenant_id=$6
          AND s.tenant_membership_id=$7 AND s.revoked_at IS NULL
          AND s.expires_at>clock_timestamp()+interval '1 second'
        RETURNING id`,[uuidV7(),uuidV7(),hash(refreshToken),binding.identity.sessionId,
          binding.identity.userId,binding.identity.tenantId,binding.identity.tenantMembershipId]);
      if(insert.rowCount!==1)throw new Error("CREDENTIAL_PAIR_REFRESH_PERSIST_FAILED");
      return {accessToken,refreshToken};
  }
}
