import {assertCommercialDeployment,type PostgresCommercialDeploymentContext,type Pool,type PoolClient} from "@pos-platform/database-postgres";
import { UuidSchema } from "@pos-platform/contracts";

/**
 * Isolated-only audit/revocation race guard. This does not authorize a
 * session, issue a grant, consume device proof, or define an audit event code.
 * The approved audit owner must write on the supplied transaction client.
 */
export class IsolatedBusinessAuditSessionGuard {
  constructor(private readonly pool: Pool,private readonly deployment?:PostgresCommercialDeploymentContext) {
    if(deployment){assertCommercialDeployment(pool,deployment);return;}
    const uri = new URL(pool.options.connectionString ?? "invalid:");
    if (!["localhost", "127.0.0.1"].includes(uri.hostname) || uri.port !== "55433")
      throw new Error("BUSINESS_AUDIT_LOCAL_FIXTURE_REQUIRED");
  }

  async whileActive<T>(
    binding: { sessionId: string; userId: string; tenantId: string; tenantMembershipId: string },
    audit: (client: PoolClient) => Promise<T>,
  ): Promise<T | null> {
    const sessionId = UuidSchema.parse(binding.sessionId);
    const userId = UuidSchema.parse(binding.userId);
    const tenantId = UuidSchema.parse(binding.tenantId);
    const membershipId = UuidSchema.parse(binding.tenantMembershipId);
    if (typeof audit !== "function") throw new Error("BUSINESS_AUDIT_WRITER_REQUIRED");
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN"); begun = true;
      if(!this.deployment){const scope = await client.query<{allowed:boolean}>(
        "SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS allowed");
      if (scope.rows[0]?.allowed !== true) throw new Error("BUSINESS_AUDIT_ISOLATED_DATABASE_REQUIRED");
      }
      const sessionScope = await client.query<{tenant_id:string}>(
        "SELECT tenant_id::text FROM identity.sessions WHERE id=$1 AND tenant_id IS NOT NULL", [sessionId]);
      if (sessionScope.rows[0]?.tenant_id !== tenantId) {
        await client.query("ROLLBACK"); begun = false; return null;
      }
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      // Lock the same session row as logout; do not mistake this for an
      // authorization decision after the transaction is committed.
      const active = await client.query(`SELECT 1 FROM identity.sessions
        WHERE id=$1 AND user_id=$2 AND tenant_id=$3 AND tenant_membership_id=$4
          AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND mfa_status='SATISFIED' AND device_id IS NULL FOR UPDATE`,
        [sessionId,userId,tenantId,membershipId]);
      if (active.rows.length !== 1) {
        await client.query("ROLLBACK"); begun = false; return null;
      }
      const result = await audit(client);
      await client.query("COMMIT"); begun = false;
      return result;
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    } finally { client.release(); }
  }
}
