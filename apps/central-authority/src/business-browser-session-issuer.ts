import { createHash, randomBytes } from "node:crypto";
import { uuidV7, UuidSchema, PlatformSecurityEventCode } from "@pos-platform/contracts";
import {
  PostgresPlatformSecurityEventRepository,
  type Pool,
} from "@pos-platform/database-postgres";
import { BusinessInitialMfaFlow } from "./business-initial-mfa-flow.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const secret = () => randomBytes(32).toString("base64url");

export class BusinessBrowserSessionIssuer {
  constructor(
    private readonly pool: Pool,
    private readonly mfa: BusinessInitialMfaFlow,
    private readonly policy: {
      origin: string;
      sessionLifetimeMs: number;
      browserLifetimeMs: number;
      maximumMfaAgeMs: number;
      lockTimeoutMs: number;
      statementTimeoutMs: number;
    },
  ) {
    const p = policy;
    if (
      new URL(p.origin).protocol !== "https:" ||
      new URL(p.origin).origin !== p.origin ||
      ![
        p.sessionLifetimeMs,
        p.browserLifetimeMs,
        p.maximumMfaAgeMs,
        p.lockTimeoutMs,
        p.statementTimeoutMs,
      ].every(n => Number.isSafeInteger(n) && n > 0) ||
      p.browserLifetimeMs > p.sessionLifetimeMs ||
      p.maximumMfaAgeMs > p.sessionLifetimeMs ||
      p.statementTimeoutMs <= p.lockTimeoutMs
    ) {
      throw Error("BUSINESS_SESSION_POLICY_INVALID");
    }
    // Keep the policy that was validated; the caller does not own live policy.
    this.policy = Object.freeze({ ...p });
  }

  async issue(
    receipt: unknown,
    tenantId: string,
    membershipId: string,
    previousCookie: string | null = null,
  ): Promise<{ setCookie: string; csrfToken: string }> {
    UuidSchema.parse(tenantId);
    UuidSchema.parse(membershipId);

    const evidence = this.mfa.takeForBusinessSession(receipt);
    if (!evidence || evidence.purpose !== "BUSINESS_INITIAL_MFA") {
      throw Error("BUSINESS_MFA_REQUIRED");
    }

    const p = this.policy;
    const sessionId = uuidV7();
    const cookie = secret();
    const csrfToken = secret();
    const handoffHash = hash(secret());
    const client = await this.pool.connect();
    const COOKIE = "__Host-camacho_business";
    const extract = (raw: string | null) => {
      if (!raw || raw.length > 8192) return null;
      const values = raw.split(";").map(s => s.trim()).filter(s => s.startsWith(COOKIE + "="));
      if (values.length !== 1) return null;
      const value = values[0]!.slice(COOKIE.length + 1);
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    };

    try {
      await client.query("BEGIN");

      await client.query(
        `SELECT set_config('lock_timeout',$1,true),
                set_config('statement_timeout',$2,true),
                set_config('app.tenant_id',$3,true)`,
        [
          `${p.lockTimeoutMs}ms`,
          `${p.statementTimeoutMs}ms`,
          tenantId,
        ],
      );

      // The runtime has SELECT, not UPDATE, on the role catalog. Reuse the
      // bounded, owner-controlled SHARE protocol from migration 015 rather
      // than requesting a row lock that requires broader SQL privileges.
      await client.query('SELECT "authorization".lock_sas_sources_for_read()');

      const role = await client.query<{ user_id: string }>(
        `SELECT u.id::text AS user_id
           FROM identity.users u
           JOIN identity.user_credentials pwd
             ON pwd.user_id=u.id
            AND pwd.id=$3
            AND pwd.version::text=$4
            AND pwd.credential_type='PASSWORD'
            AND pwd.status='ACTIVE'
            AND pwd.revoked_at IS NULL
            AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
           JOIN identity.mfa_factors f
             ON f.id=$5 AND f.user_id=u.id
            AND f.status='ACTIVE'
            AND f.verified_at IS NOT NULL
            AND f.revoked_at IS NULL
           JOIN identity.webauthn_challenges w
             ON w.id=$6 AND w.user_id=u.id AND w.factor_id=f.id
            AND w.purpose='AUTHENTICATE'
            AND w.session_id IS NULL
            AND w.consumed_at IS NOT NULL
            AND w.expected_origin=$7
            AND w.correlation_id=$8
           JOIN tenancy.tenant_memberships m
             ON m.user_id=u.id
            AND m.tenant_id=$1
            AND m.id=$2
            AND m.status='ACTIVE'
           JOIN tenancy.tenants t
             ON t.id=m.tenant_id AND t.status='ACTIVE'
           JOIN "authorization".user_role_assignments a
             ON a.tenant_id=m.tenant_id
            AND a.tenant_membership_id=m.id
            AND a.status='ACTIVE'
            AND a.valid_from<=clock_timestamp()
            AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
           JOIN "authorization".roles r
             ON r.id=a.role_id
            AND r.scope_type='BUSINESS'
            AND r.status='ACTIVE'
          WHERE u.id=$9 AND u.status='ACTIVE'
            AND EXISTS (
              SELECT 1
              FROM identity.security_events se
              WHERE se.user_id=u.id
                AND se.correlation_id=w.correlation_id
                AND se.event_code=$12
                AND se.result='SUCCEEDED'
                AND se.reason_code='BUSINESS_INITIAL_MFA'
                AND se.occurred_at=$10::timestamptz
            )
            AND $10::timestamptz<=clock_timestamp()
            AND $10::timestamptz>=clock_timestamp()
                -$11::bigint*interval '1 millisecond'
          LIMIT 1
          FOR SHARE OF u,pwd,f,w,m,a,t`,
        [
          tenantId,
          membershipId,
          evidence.passwordCredentialId,
          evidence.passwordCredentialVersion,
          evidence.factorId,
          evidence.challengeId,
          p.origin,
          evidence.correlationId,
          evidence.userId,
          evidence.verifiedAt,
          p.maximumMfaAgeMs,
          PlatformSecurityEventCode.WEBAUTHN_ASSERTION_VERIFIED,
        ],
      );

      if (role.rowCount !== 1) {
        throw Error("BUSINESS_SESSION_AUTHORIZATION_REJECTED");
      }

      // Fresh ceremony replaces only this browser's previous BUSINESS cookie.
      const previous = extract(previousCookie);
      if (previous) {
        const old = (await client.query(
          `SELECT b.session_id,b.user_id FROM identity.browser_sessions b
             JOIN identity.sessions s ON s.id=b.session_id AND s.user_id=b.user_id
            WHERE b.cookie_hash=$1 AND b.origin=$2 AND b.tenant_id=$3 AND b.membership_id=$4
              AND b.revoked_at IS NULL AND s.tenant_id=$3 AND s.tenant_membership_id=$4
            FOR UPDATE OF b,s`,
          [hash(previous), p.origin, tenantId, membershipId],
        )).rows[0];
        if (old) {
          await client.query(
            "UPDATE identity.browser_sessions SET last_used_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE cookie_hash=$1",
            [hash(previous)],
          );
          await client.query(
            "UPDATE identity.sessions SET revoked_at=clock_timestamp(),revocation_reason='BUSINESS_BROWSER_REPLACED',version=version+1 WHERE id=$1 AND revoked_at IS NULL",
            [old.session_id],
          );
          await new PostgresPlatformSecurityEventRepository(this.pool).append({
            user_id: old.user_id,
            session_id: old.session_id,
            tenant_id: tenantId,
            event_code: PlatformSecurityEventCode.SESSION_REVOKED,
            result: "REVOKED",
            reason_code: "BUSINESS_BROWSER_REPLACED",
            correlation_id: evidence.correlationId,
            occurred_at: new Date().toISOString(),
          }, client);
        }
      }

      const inserted = await client.query(
        `INSERT INTO identity.sessions
          (id,user_id,tenant_id,tenant_membership_id,
           authenticated_at,expires_at,last_reauthenticated_at,
           mfa_status,created_at)
         VALUES
          ($1,$2,$3,$4,$5::timestamptz,
           $5::timestamptz+$6::bigint*interval '1 millisecond',
           $5::timestamptz,'SATISFIED',clock_timestamp())
         RETURNING id`,
        [
          sessionId,
          evidence.userId,
          tenantId,
          membershipId,
          evidence.verifiedAt,
          p.sessionLifetimeMs,
        ],
      );

      if (inserted.rowCount !== 1) {
        throw Error("BUSINESS_SESSION_INSERT_FAILED");
      }

      await client.query(
        `INSERT INTO identity.browser_session_handoffs
          (handoff_hash,session_id,user_id,tenant_id,membership_id,
           challenge_id,password_credential_id,password_credential_version,
           factor_id,origin,expires_at,consumed_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           LEAST(
             clock_timestamp()+$11::bigint*interval '1 millisecond',
             (SELECT expires_at FROM identity.sessions WHERE id=$2)
           ),
           clock_timestamp())`,
        [
          handoffHash,
          sessionId,
          evidence.userId,
          tenantId,
          membershipId,
          evidence.challengeId,
          evidence.passwordCredentialId,
          evidence.passwordCredentialVersion,
          evidence.factorId,
          p.origin,
          p.browserLifetimeMs,
        ],
      );

      await client.query(
        `INSERT INTO identity.browser_sessions
          (cookie_hash,csrf_hash,handoff_hash,session_id,user_id,
           tenant_id,membership_id,origin,expires_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,
           LEAST(
             clock_timestamp()+$9::bigint*interval '1 millisecond',
             (SELECT expires_at FROM identity.sessions WHERE id=$4)
           ))`,
        [
          hash(cookie),
          hash(csrfToken),
          handoffHash,
          sessionId,
          evidence.userId,
          tenantId,
          membershipId,
          p.origin,
          p.browserLifetimeMs,
        ],
      );

      await new PostgresPlatformSecurityEventRepository(this.pool).append(
        {
          user_id: evidence.userId,
          session_id: sessionId,
          tenant_id: tenantId,
          event_code: PlatformSecurityEventCode.LOGIN_SUCCEEDED,
          result: "SUCCEEDED",
          reason_code: "BUSINESS_BROWSER",
          correlation_id: evidence.correlationId,
          occurred_at: new Date().toISOString(),
        },
        client,
      );

      const live = await client.query<{ seconds: number }>(
        `SELECT greatest(0,floor(extract(epoch FROM b.expires_at-clock_timestamp())))::int AS seconds
           FROM identity.browser_sessions b JOIN identity.sessions s ON s.id=b.session_id
          WHERE b.cookie_hash=$1 AND b.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp()
            AND s.last_reauthenticated_at>=clock_timestamp()-$2::bigint*interval '1 millisecond'`,
        [hash(cookie),p.maximumMfaAgeMs],
      );
      if (live.rowCount !== 1 || !Number.isSafeInteger(live.rows[0]?.seconds) || live.rows[0]!.seconds <= 0) {
        throw Error("BUSINESS_SESSION_FRESH_MFA_REQUIRED");
      }
      await client.query("COMMIT");

      return {
        setCookie:
          `__Host-camacho_business=${cookie}; Path=/; Secure; ` +
          `HttpOnly; SameSite=Strict; Max-Age=${live.rows[0]!.seconds}`,
        csrfToken,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
