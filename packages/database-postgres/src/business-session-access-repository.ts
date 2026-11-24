import type { Pool } from "pg";
import { UtcDateTimeSchema, UuidSchema } from "@pos-platform/contracts";

/** Server-derived binding, never authentication by UUID or client JSON. */
export interface TrustedBusinessSessionBinding {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantMembershipId: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

export interface BusinessAccessValidationPolicy {
  readonly maximumContextAgeMs: number;
  readonly maximumReauthenticationAgeMs: number;
}

/** Read-only current-state gate. This repository does NOT verify an access token. */
export class PostgresBusinessSessionAccessRepository {
  private readonly policy;
  constructor(private readonly pool: Pool, policy: BusinessAccessValidationPolicy) {
    if (![policy?.maximumContextAgeMs,policy?.maximumReauthenticationAgeMs]
      .every(value=>Number.isSafeInteger(value) && value!>0)) {
      throw new Error("BUSINESS_ACCESS_TIME_POLICIES_REQUIRED");
    }
    this.policy=Object.freeze({...policy});
  }

  /** Internal adapter AFTER access-signature and possession validation.
   * IDs are cross-checks only; authoritative dates come from canonical storage.
   * This method by itself does not authenticate a caller. */
  async findCurrentForVerifiedIdentity(binding: Pick<TrustedBusinessSessionBinding,
    "sessionId" | "userId" | "tenantId" | "tenantMembershipId">): Promise<TrustedBusinessSessionBinding | null> {
    const values = [binding.sessionId, binding.userId, binding.tenantId, binding.tenantMembershipId].map(value => UuidSchema.parse(value));
    const found = await this.pool.query<{ authenticated_at: Date; expires_at: Date }>(
      `SELECT authenticated_at, expires_at FROM identity.sessions
       WHERE id=$1 AND user_id=$2 AND tenant_id=$3 AND tenant_membership_id=$4`, values);
    const row = found.rows[0];
    return row ? this.findCurrent({ ...binding, authenticatedAt: row.authenticated_at.toISOString(), expiresAt: row.expires_at.toISOString() }) : null;
  }

  async findCurrent(binding: TrustedBusinessSessionBinding): Promise<TrustedBusinessSessionBinding | null> {
    const sessionId=UuidSchema.parse(binding.sessionId);
    const userId=UuidSchema.parse(binding.userId);
    const tenantId=UuidSchema.parse(binding.tenantId);
    const membershipId=UuidSchema.parse(binding.tenantMembershipId);
    const authenticatedAt=UtcDateTimeSchema.parse(binding.authenticatedAt);
    const expiresAt=UtcDateTimeSchema.parse(binding.expiresAt);
    const client=await this.pool.connect(); let begun=false;
    try {
      await client.query("BEGIN READ ONLY"); begun=true;
      // Derive RLS scope from durable session; the expected tenant is only a
      // cross-check against the authenticated server binding.
      const scoped=await client.query<{ tenant_id:string }>(
        "SELECT tenant_id::text FROM identity.sessions WHERE id=$1 AND tenant_id IS NOT NULL",[sessionId]);
      const scope=scoped.rows[0]?.tenant_id;
      if (!scope || scope!==tenantId) { await client.query("ROLLBACK"); begun=false; return null; }
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[scope]);
      const current=await client.query<{ expires_at:Date }>(
        `SELECT s.expires_at FROM identity.sessions s
         JOIN identity.users u ON u.id=s.user_id AND u.status='ACTIVE'
         JOIN tenancy.tenant_memberships tm ON tm.id=s.tenant_membership_id
          AND tm.user_id=u.id AND tm.tenant_id=s.tenant_id AND tm.status='ACTIVE'
          AND tm.activated_at IS NOT NULL AND tm.suspended_at IS NULL AND tm.revoked_at IS NULL
         JOIN tenancy.tenants t ON t.id=tm.tenant_id AND t.status='ACTIVE'
         WHERE s.id=$1 AND s.user_id=$2 AND s.tenant_id=$3 AND s.tenant_membership_id=$4
          AND s.device_id IS NULL AND s.revoked_at IS NULL AND s.mfa_status='SATISFIED'
          AND s.authenticated_at=$5::timestamptz AND s.authenticated_at<=clock_timestamp()
          AND s.authenticated_at>=clock_timestamp()-($7::bigint*interval '1 millisecond')
          AND s.created_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
          AND $6::timestamptz>clock_timestamp()
          AND s.last_reauthenticated_at<=clock_timestamp()
          AND s.last_reauthenticated_at>=clock_timestamp()-($8::bigint*interval '1 millisecond')
          AND EXISTS (SELECT 1 FROM identity.mfa_factors f WHERE f.user_id=u.id
            AND f.factor_type='WEBAUTHN' AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL)
          AND EXISTS (SELECT 1 FROM identity.user_credentials p WHERE p.user_id=u.id
            AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL
            AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp()))`,
        [sessionId,userId,scope,membershipId,authenticatedAt,expiresAt,
          this.policy.maximumContextAgeMs,this.policy.maximumReauthenticationAgeMs]);
      const row=current.rows[0];
      if (!row) { await client.query("ROLLBACK"); begun=false; return null; }
      const result=Object.freeze({sessionId,userId,tenantId:scope,tenantMembershipId:membershipId,
        authenticatedAt,expiresAt:new Date(Math.min(row.expires_at.getTime(),Date.parse(expiresAt))).toISOString()});
      await client.query("COMMIT"); begun=false; return result;
    } catch(error) {
      if (begun) await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    } finally { client.release(); }
  }
}
