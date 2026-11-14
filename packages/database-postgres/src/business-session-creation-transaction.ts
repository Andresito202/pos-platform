import type { Pool,PoolClient } from "pg";
import { PlatformSecurityEventCode, UtcDateTimeSchema, UuidSchema, uuidV7 } from "@pos-platform/contracts";
import type { CommittedBusinessInitialMfa } from "./business-initial-webauthn-transaction.js";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";
import {assertCommercialDeployment,type PostgresCommercialDeploymentContext} from "./commercial-deployment-context.js";

/** Trusted central configuration; no production defaults or token format. */
export interface BusinessSessionValidationPolicy {
  readonly mode: "ISOLATED_VALIDATION" | "PRODUCTION";
  readonly version: string;
  readonly sessionLifetimeMs: number;
  readonly maximumMfaAgeMs: number;
  readonly maximumReauthenticationAgeMs: number;
  readonly accessProof: { readonly mode: "DISABLED_PENDING_D3"|"COMMERCIAL_POSSESSION_V2"; readonly policyReference: string };
  readonly abuse: { readonly mode: "ISOLATED_TEST_ONLY"|"DURABLE_NATIVE_REQUEST_V2"; readonly policyReference: string };
}

export interface PersistedBusinessSession {
  readonly scope: "BUSINESS";
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantMembershipId: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly deviceId: null;
  readonly accessProof: null;
}

function snapshotPolicy(policy: BusinessSessionValidationPolicy,deployment?:PostgresCommercialDeploymentContext): BusinessSessionValidationPolicy {
  // No purported approval supplied by JSON can unlock production. D3 is unresolved.
  if (policy?.mode === "PRODUCTION"&&!deployment) throw new Error("BUSINESS_SESSION_PRODUCTION_BLOCKED_PENDING_D3");
  if (!["ISOLATED_VALIDATION","PRODUCTION"].includes(policy?.mode) || typeof policy.version !== "string" || !policy.version.trim()
    || ![policy.sessionLifetimeMs, policy.maximumMfaAgeMs, policy.maximumReauthenticationAgeMs]
      .every(value => Number.isSafeInteger(value) && value > 0)
    || policy.maximumMfaAgeMs > policy.sessionLifetimeMs
    || policy.maximumReauthenticationAgeMs > policy.sessionLifetimeMs
    || policy.accessProof?.mode !== (deployment?"COMMERCIAL_POSSESSION_V2":"DISABLED_PENDING_D3") || !policy.accessProof.policyReference?.trim()
    || policy.abuse?.mode !== (deployment?"DURABLE_NATIVE_REQUEST_V2":"ISOLATED_TEST_ONLY") || !policy.abuse.policyReference?.trim()) {
    throw new Error("BUSINESS_SESSION_EXPLICIT_POLICIES_REQUIRED");
  }
  return Object.freeze({ ...policy, accessProof: Object.freeze({ ...policy.accessProof }), abuse: Object.freeze({ ...policy.abuse }) });
}

/** Persistence adapter, INTERNAL: evidence must come from the central one-use flow. */
export class PostgresBusinessSessionCreationTransaction {
  private readonly policy;
  constructor(private readonly pool: Pool, policy: BusinessSessionValidationPolicy,private readonly deployment?:PostgresCommercialDeploymentContext) {
    if(deployment){assertCommercialDeployment(pool,deployment);if(policy.mode!=="PRODUCTION")throw Error("BUSINESS_SESSION_DEPLOYMENT_POLICY_REQUIRED");}
    this.policy = snapshotPolicy(policy,deployment);
  }

  async create(evidence: CommittedBusinessInitialMfa, selection: {
    readonly tenantId: string; readonly membershipId: string;
  },completion?: (client:PoolClient,session:PersistedBusinessSession,evidence:CommittedBusinessInitialMfa)=>Promise<void>): Promise<PersistedBusinessSession | null> {
    if (evidence.purpose !== "BUSINESS_INITIAL_MFA" || evidence.sessionId !== null) return null;
    const userId = UuidSchema.parse(evidence.userId);
    const tenantId = UuidSchema.parse(selection.tenantId);
    const membershipId = UuidSchema.parse(selection.membershipId);
    const credentialId = UuidSchema.parse(evidence.passwordCredentialId);
    const factorId = UuidSchema.parse(evidence.factorId);
    const challengeId = UuidSchema.parse(evidence.challengeId);
    const correlationId = UuidSchema.parse(evidence.correlationId);
    const verifiedAt = UtcDateTimeSchema.parse(evidence.verifiedAt);
    if (!/^[1-9][0-9]*$/.test(evidence.passwordCredentialVersion)) return null;
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN"); begun = true;
      // Hard runtime gate, independent of config labels. Only our disposable DBs
      // on the dedicated local fixture are eligible while D3 is unapproved.
      if(!this.deployment){const endpoint = new URL(this.pool.options.connectionString ?? "invalid:");
      if (!["127.0.0.1", "localhost"].includes(endpoint.hostname) || endpoint.port !== "55433") {
        throw new Error("BUSINESS_SESSION_REQUIRES_LOCAL_VALIDATION_SERVER");
      }
      const isolated = await client.query<{ allowed: boolean }>(`SELECT
        current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS allowed`);
      if (isolated.rows[0]?.allowed !== true) throw new Error("BUSINESS_SESSION_REQUIRES_ISOLATED_VALIDATION_DATABASE");
      }
      // Selection is only a bounded lookup, NEVER a grant of tenant authority.
      // RLS narrows visibility; the locked membership below must also belong to
      // the server-authenticated user and the selected active tenant.
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const rows = await client.query<{ user_id: string; tenant_id: string; membership_id: string }>(
        `SELECT u.id::text AS user_id,t.id::text AS tenant_id,tm.id::text AS membership_id
           FROM identity.webauthn_challenges c
           JOIN identity.users u ON u.id=c.user_id AND u.status='ACTIVE'
           JOIN identity.user_credentials p ON p.user_id=u.id AND p.id=$3
            AND p.version::text=$4 AND p.credential_type='PASSWORD' AND p.status='ACTIVE'
            AND p.revoked_at IS NULL AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp())
           JOIN identity.mfa_factors f ON f.id=c.factor_id AND f.user_id=u.id
            AND f.id=$5 AND f.status='ACTIVE' AND f.factor_type='WEBAUTHN'
            AND f.verified_at IS NOT NULL AND f.verified_at<=$6::timestamptz AND f.revoked_at IS NULL
           JOIN identity.webauthn_credential_material m ON m.factor_id=f.id
            AND f.secret_reference='webauthn:v1:'||m.id::text
           JOIN tenancy.tenant_memberships tm ON tm.user_id=u.id AND tm.id=$7
            AND tm.tenant_id=$8 AND tm.status='ACTIVE' AND tm.activated_at IS NOT NULL
            AND tm.suspended_at IS NULL AND tm.revoked_at IS NULL
           JOIN tenancy.tenants t ON t.id=tm.tenant_id AND t.status='ACTIVE'
          WHERE c.id=$1 AND c.user_id=$2 AND c.purpose='AUTHENTICATE' AND c.session_id IS NULL
            AND c.consumed_at IS NOT NULL AND c.correlation_id=$9
            AND EXISTS (SELECT 1 FROM identity.security_events e WHERE e.user_id=u.id
              AND e.session_id IS NULL AND e.tenant_id IS NULL AND e.correlation_id=$9
              AND e.event_code=$10 AND e.result='SUCCEEDED' AND e.reason_code='BUSINESS_INITIAL_MFA'
              AND e.occurred_at=$6::timestamptz)
          FOR UPDATE OF c FOR SHARE OF u,p,f,m,tm,t`,
        [challengeId,userId,credentialId,evidence.passwordCredentialVersion,factorId,verifiedAt,
          membershipId,tenantId,correlationId,PlatformSecurityEventCode.WEBAUTHN_ASSERTION_VERIFIED],
      );
      const row = rows.rows[0];
      const reject = async () => { await client.query("ROLLBACK"); begun = false; return null; };
      if (!row) return await reject();
      const sessionId = uuidV7();
      const inserted = await client.query<{ authenticated_at: Date; expires_at: Date }>(
        `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
         INSERT INTO identity.sessions(id,user_id,tenant_id,tenant_membership_id,device_id,
           authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at)
         SELECT $1,$2,$3,$4,NULL,$5::timestamptz,
           $5::timestamptz+($6::bigint*interval '1 millisecond'),$5::timestamptz,'SATISFIED',moment.at
         FROM moment WHERE $5::timestamptz<=moment.at
           AND $5::timestamptz>=moment.at-(LEAST($7::bigint,$8::bigint)*interval '1 millisecond')
         RETURNING authenticated_at,expires_at`,
        [sessionId,row.user_id,row.tenant_id,row.membership_id,verifiedAt,this.policy.sessionLifetimeMs,
          this.policy.maximumMfaAgeMs,this.policy.maximumReauthenticationAgeMs],
      );
      const session = inserted.rows[0];
      if (!session) return await reject();
      const clock = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id:row.user_id,session_id:sessionId,tenant_id:row.tenant_id,
        event_code:PlatformSecurityEventCode.SESSION_ISSUED,result:"SUCCEEDED",reason_code:"BUSINESS_INITIAL_MFA",
        correlation_id:correlationId,occurred_at:clock.rows[0]!.at.toISOString(),
      },client);
      const persisted:PersistedBusinessSession=Object.freeze({scope:"BUSINESS",sessionId,userId:row.user_id,tenantId:row.tenant_id,
        tenantMembershipId:row.membership_id,authenticatedAt:session.authenticated_at.toISOString(),
        expiresAt:session.expires_at.toISOString(),deviceId:null,accessProof:null});
      if(completion)await completion(client,persisted,evidence);
      // Audit can itself wait for I/O/locks. Do not commit aged evidence or an
      // already expired session merely because it was fresh before INSERT.
      const fresh = await client.query<{ valid: boolean }>(`SELECT
        $1::timestamptz>=clock_timestamp()-(LEAST($2::bigint,$3::bigint)*interval '1 millisecond')
        AND $4::timestamptz>clock_timestamp() AS valid`,
      [verifiedAt,this.policy.maximumMfaAgeMs,this.policy.maximumReauthenticationAgeMs,session.expires_at]);
      if (fresh.rows[0]?.valid !== true) return await reject();
      await client.query("COMMIT"); begun = false;
      return persisted;
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
