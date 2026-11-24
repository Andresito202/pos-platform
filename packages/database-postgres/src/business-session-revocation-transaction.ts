import type { Pool } from "pg";
import { PlatformSecurityEventCode, UtcDateTimeSchema, UuidSchema } from "@pos-platform/contracts";
import type { TrustedBusinessSessionBinding } from "./business-session-access-repository.js";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";

/** INTERNAL persistence, not an authentication boundary. The central caller
 * must obtain binding from its own non-serializable authenticated context.
 * No token codec, duration, grant, device binding or transport is introduced.
 */
export class PostgresBusinessSessionRevocationTransaction {
  constructor(private readonly pool: Pool) {}

  async revokeOwn(binding: TrustedBusinessSessionBinding, correlationId: string): Promise<"REVOKED" | "ALREADY_REVOKED" | null> {
    const sessionId = UuidSchema.parse(binding.sessionId), userId = UuidSchema.parse(binding.userId);
    const tenantId = UuidSchema.parse(binding.tenantId), membershipId = UuidSchema.parse(binding.tenantMembershipId);
    const authenticatedAt = UtcDateTimeSchema.parse(binding.authenticatedAt);
    UuidSchema.parse(correlationId);
    const client = await this.pool.connect(); let begun = false;
    try {
      await client.query("BEGIN"); begun = true;
      const scoped = await client.query<{ tenant_id: string }>("SELECT tenant_id::text FROM identity.sessions WHERE id=$1 AND tenant_id IS NOT NULL", [sessionId]);
      if (scoped.rows[0]?.tenant_id !== tenantId) { await client.query("ROLLBACK"); begun = false; return null; }
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      // Row lock serializes logout with future renewal/revocation writers.
      // Expired/deactivated identities may still close their own authenticated context.
      const session = await client.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM identity.sessions WHERE id=$1 AND user_id=$2 AND tenant_id=$3
          AND tenant_membership_id=$4 AND authenticated_at=$5::timestamptz AND device_id IS NULL FOR UPDATE`,
        [sessionId, userId, tenantId, membershipId, authenticatedAt]);
      if (!session.rows[0]) { await client.query("ROLLBACK"); begun = false; return null; }
      if (session.rows[0].revoked_at !== null) { await client.query("COMMIT"); begun = false; return "ALREADY_REVOKED"; }
      const clock = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
      const at = clock.rows[0]!.at.toISOString();
      await client.query(`UPDATE identity.sessions SET revoked_at=$2::timestamptz,revoked_by_actor_type='USER',
        revoked_by_actor_id=$3,revocation_reason='USER_LOGOUT',version=version+1 WHERE id=$1`, [sessionId, at, userId]);
      await client.query(`UPDATE identity.session_refresh_tokens SET revoked_at=$2::timestamptz,revocation_reason='USER_LOGOUT'
        WHERE session_id=$1 AND revoked_at IS NULL`, [sessionId, at]);
      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: userId, session_id: sessionId, tenant_id: tenantId, event_code: PlatformSecurityEventCode.SESSION_REVOKED,
        result: "REVOKED", reason_code: "USER_LOGOUT", correlation_id: correlationId, occurred_at: at,
      }, client);
      await client.query("COMMIT"); begun = false; return "REVOKED";
    } catch (error) { if (begun) await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
