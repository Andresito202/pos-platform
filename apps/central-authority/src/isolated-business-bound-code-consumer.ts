import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode,uuidV7} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
import type { AtomicNativeCodeConsumer, StoredNativeAuthorizationGrant } from "./native-authorization-code-exchange.js";

/**
 * ISOLATED BUSINESS fixture only: an exchange consumes the code atomically and
 * returns a non-credential binding only if the durable session and device are
 * still active. This is NOT an OAuth token endpoint or production grant store.
 */
export class IsolatedBusinessBoundCodeConsumer implements AtomicNativeCodeConsumer<{
  sessionId: string; deviceId: string; tenantId: string; credentialId: string;
}> {
  readonly durabilityPolicyReference = "ISOLATED_BUSINESS_BOUND_CODE_V1";
  constructor(private readonly pool: Pool) {
    const url = new URL(pool.options.connectionString ?? "invalid:");
    if (!["localhost","127.0.0.1"].includes(url.hostname) || url.port !== "55433")
      throw new Error("BUSINESS_BOUND_CODE_LOCAL_FIXTURE_REQUIRED");
  }

  async consume(code: string, verify: (grant: StoredNativeAuthorizationGrant) => boolean) {
    return this.consumeWith(code,verify,async (_client,binding)=>Object.freeze({
      sessionId:binding.sessionId,deviceId:binding.deviceId,
      tenantId:binding.tenantId,credentialId:binding.credentialId,
    }));
  }

  /** Execute credential persistence BEFORE committing PKCE consumption. */
  async consumeWith<T>(
    code:string, verify:(grant:StoredNativeAuthorizationGrant)=>boolean,
    issue:(client:PoolClient,binding:{
      sessionId:string;userId:string;tenantId:string;tenantMembershipId:string;
      deviceId:string;credentialId:string;installationId:string;companyId:string;
    })=>Promise<T>,
  ):Promise<T|null> {
    if (!/^[A-Za-z0-9._~-]{16,512}$/.test(code) || typeof verify !== "function") return null;
    const client = await this.pool.connect();
    let begun = false;
    const audit=new PostgresPlatformSecurityEventRepository(this.pool);
    try {
      await client.query("BEGIN"); begun = true;
      const approved = await client.query<{approved:boolean}>(
        "SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS approved");
      if (approved.rows[0]?.approved !== true) throw new Error("BUSINESS_BOUND_CODE_DATABASE_REQUIRED");
      const digest=createHash("sha256").update(code).digest("hex");
      const found = await client.query<{
        client_id:string;redirect_uri:string;code_challenge:string;state:string;
        session_id:string;device_id:string;tenant_id:string;trusted_binding_id:string;
        usable:boolean;
      }>(`SELECT client_id,redirect_uri,code_challenge,state,session_id::text,
        device_id::text,tenant_id::text,trusted_binding_id,
        (consumed_at IS NULL AND expires_at>clock_timestamp()) AS usable
        FROM identity.native_authorization_code_validation
        WHERE code_hash=$1 FOR UPDATE`,[digest]);
      const grant=found.rows[0];
      if (!grant?.usable) {
        await client.query("COMMIT");begun=false;return null;
      }
      // Invalid PKCE/client/state attempts burn the code permanently.
      await client.query(`UPDATE identity.native_authorization_code_validation
        SET consumed_at=clock_timestamp() WHERE code_hash=$1 AND consumed_at IS NULL`,[digest]);
      if (!verify({clientId:grant.client_id,redirectUri:grant.redirect_uri,
        codeChallenge:grant.code_challenge,state:grant.state})) {
        await client.query("SELECT set_config('app.tenant_id',$1,true)",[grant.tenant_id]);
        const identity=await client.query<{user_id:string}>(
          "SELECT user_id::text FROM identity.sessions WHERE id=$1 AND tenant_id=$2",
          [grant.session_id,grant.tenant_id]);
        if(identity.rows[0]) await audit.append({
          user_id:identity.rows[0].user_id,session_id:grant.session_id,tenant_id:grant.tenant_id,
          event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED,result:"REJECTED",
          reason_code:"ISOLATED_PKCE_MISMATCH",correlation_id:uuidV7(),
          occurred_at:new Date(Date.now()-1000).toISOString()},client);
        await client.query("COMMIT");begun=false;return null;
      }
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[grant.tenant_id]);
      const eligible=await client.query<{user_id:string;tenant_membership_id:string;installation_id:string;company_id:string}>(`SELECT s.user_id::text, s.tenant_membership_id::text, d.installation_id::text, d.company_id::text FROM identity.sessions s
        JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN tenancy.tenant_memberships m ON m.id=s.tenant_membership_id
          AND m.user_id=s.user_id AND m.tenant_id=s.tenant_id
          AND m.status='ACTIVE' AND m.suspended_at IS NULL AND m.revoked_at IS NULL
        JOIN tenancy.tenants t ON t.id=s.tenant_id AND t.status='ACTIVE'
        JOIN identity.device_registry d ON d.device_id=$2 AND d.tenant_id=s.tenant_id
          AND d.status='ACTIVE'
        JOIN identity.device_credentials dc ON dc.credential_id=$3
          AND dc.device_id=d.device_id AND dc.installation_id=d.installation_id
          AND dc.tenant_id=d.tenant_id AND dc.company_id=d.company_id
          AND dc.status='ACTIVE' AND dc.key_purpose='DEVICE_TRUST'
          AND dc.expires_at>clock_timestamp()
        WHERE s.id=$1 AND s.tenant_id=$4 AND s.revoked_at IS NULL
          AND s.device_id IS NULL AND s.mfa_status='SATISFIED'
          AND s.expires_at>clock_timestamp()
        FOR SHARE OF s,u,m,t,d,dc`,[
        grant.session_id,grant.device_id,grant.trusted_binding_id,grant.tenant_id]);
      const identity=await client.query<{user_id:string}>(
        "SELECT user_id::text FROM identity.sessions WHERE id=$1 AND tenant_id=$2",
        [grant.session_id,grant.tenant_id]);
      if(!identity.rows[0])throw new Error("NATIVE_CODE_AUDIT_IDENTITY_MISSING");
      await audit.append({
        user_id:identity.rows[0].user_id,session_id:grant.session_id,tenant_id:grant.tenant_id,
        event_code:eligible.rows.length===1?PlatformSecurityEventCode.AUTHORIZATION_CODE_REDEEMED:
          PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED,
        result:eligible.rows.length===1?"SUCCEEDED":"REJECTED",
        reason_code:eligible.rows.length===1?"ISOLATED_PKCE_REDEEMED":"ISOLATED_BINDING_INACTIVE",
        correlation_id:uuidV7(),occurred_at:new Date(Date.now()-1000).toISOString()},client);
      const row=eligible.rows[0];
      const output=row ? await issue(client,Object.freeze({
        sessionId:grant.session_id,userId:row.user_id,tenantId:grant.tenant_id,
        tenantMembershipId:row.tenant_membership_id,deviceId:grant.device_id,
        credentialId:grant.trusted_binding_id,installationId:row.installation_id,
        companyId:row.company_id,
      })) : null;
      await client.query("COMMIT");begun=false;
      return output;
    } catch(error) {
      if(begun) await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    } finally {client.release();}
  }
}
