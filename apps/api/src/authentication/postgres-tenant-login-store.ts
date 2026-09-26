import type { Pool, PoolClient } from "pg";
import { uuidV7 } from "@pos-platform/contracts";
import type { ThrottleState } from "./login-throttle.js";
import type { MfaEnrollmentPort } from "./mfa-enrollment-service.js";
import type { ActiveTotpFactor, LoginCandidate, NewSession, SecurityEvent, TenantLoginStore, TenantLoginTransaction } from "./tenant-login-store.js";

/**
 * Almacén PostgreSQL del login por comercio, sobre las tablas de la 001 y la
 * 005. Debe conectarse como `pos_platform_app`: es el único rol con acceso a
 * credenciales, y sin `BYPASSRLS`, así que el comercio se fija por conexión
 * (`app.tenant_id`) y el RLS de membresías y asignaciones se aplica de verdad.
 */
export class PostgresTenantLoginStore implements TenantLoginStore {
  constructor(private readonly pool: Pool) {}

  async inTenant<T>(tenantId: string, work: (transaction: TenantLoginTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(new PostgresTenantLoginTransaction(client, tenantId));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface CandidateRow {
  user_id: string; user_status: string; membership_id: string; membership_status: string;
}
interface CredentialRow {
  id: string; verifier: string; failed_attempt_count: number; last_failed_at: Date | null;
  locked_until: Date | null; must_change_at_next_login: boolean;
}

class PostgresTenantLoginTransaction implements TenantLoginTransaction, MfaEnrollmentPort {
  constructor(private readonly client: PoolClient, private readonly tenantId: string) {}

  async findForUpdate(normalizedLoginName: string): Promise<LoginCandidate | null> {
    const found = await this.client.query<CandidateRow>(
      `SELECT l.user_id, u.status AS user_status, m.id AS membership_id, m.status AS membership_status
         FROM identity.user_login_names l
         JOIN tenancy.tenant_memberships m ON m.id = l.tenant_membership_id AND m.tenant_id = l.tenant_id
         JOIN identity.users u ON u.id = l.user_id
        WHERE l.tenant_id = $1 AND l.login_name_normalized = $2 AND l.status = 'ACTIVE'`,
      [this.tenantId, normalizedLoginName],
    );
    const row = found.rows[0];
    if (row === undefined) return null;

    // Consulta aparte: `FOR UPDATE` no admite el lado nulable de un LEFT JOIN.
    const credential = (await this.client.query<CredentialRow>(
      `SELECT id, verifier, failed_attempt_count, last_failed_at, locked_until, must_change_at_next_login
         FROM identity.user_credentials
        WHERE user_id = $1 AND credential_type = 'PASSWORD' AND status = 'ACTIVE'
        FOR UPDATE`,
      [row.user_id],
    )).rows[0];

    return {
      userId: row.user_id,
      userActive: row.user_status === "ACTIVE",
      membershipId: row.membership_id,
      membershipActive: row.membership_status === "ACTIVE",
      credential: credential === undefined ? null : {
        id: credential.id,
        verifier: credential.verifier,
        throttle: {
          failedAttemptCount: credential.failed_attempt_count,
          lastFailedAt: credential.last_failed_at,
          lockedUntil: credential.locked_until,
        },
        mustChangeAtNextLogin: credential.must_change_at_next_login,
      },
    };
  }

  async activeRoleCodes(membershipId: string, at: Date): Promise<readonly string[]> {
    const result = await this.client.query<{ code: string }>(
      `SELECT DISTINCT r.code
         FROM "authorization".user_role_assignments a
         JOIN "authorization".roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1 AND a.tenant_membership_id = $2 AND a.status = 'ACTIVE'
          AND a.valid_from <= $3 AND (a.valid_until IS NULL OR a.valid_until > $3)
          AND r.status = 'ACTIVE'`,
      [this.tenantId, membershipId, at],
    );
    return result.rows.map((row) => row.code);
  }

  async saveThrottle(credentialId: string, state: ThrottleState): Promise<void> {
    await this.client.query(
      `UPDATE identity.user_credentials
          SET failed_attempt_count = $2, last_failed_at = $3, locked_until = $4, version = version + 1
        WHERE id = $1`,
      [credentialId, state.failedAttemptCount, state.lastFailedAt, state.lockedUntil],
    );
  }

  async findActiveTotpFactorForUpdate(userId: string): Promise<ActiveTotpFactor | null> {
    const result = await this.client.query<{ id: string; secret_reference: string; last_used_at: Date | null }>(
      `SELECT id, secret_reference, last_used_at
         FROM identity.mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND status = 'ACTIVE' AND secret_reference IS NOT NULL
        FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      encryptedSecret: row.secret_reference,
      // Sin columna propia de «paso»: se deriva de `last_used_at`, que es
      // determinista un-a-uno con el paso de 30 s que lo produjo.
      lastAcceptedStep: row.last_used_at === null ? null : Math.floor(row.last_used_at.getTime() / 30_000),
    };
  }

  async recordTotpAcceptedStep(factorId: string, step: number): Promise<void> {
    await this.client.query(
      `UPDATE identity.mfa_factors SET last_used_at = to_timestamp($2), version = version + 1 WHERE id = $1`,
      [factorId, step * 30],
    );
  }

  async openSession(session: NewSession): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.sessions (id, user_id, tenant_id, tenant_membership_id, authenticated_at, expires_at, mfa_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $5)`,
      [session.sessionId, session.userId, this.tenantId, session.membershipId, session.authenticatedAt, session.expiresAt, session.mfaStatus],
    );
    await this.client.query(
      `INSERT INTO identity.session_refresh_tokens (id, session_id, token_family_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.refreshTokenId, session.sessionId, session.refreshTokenFamilyId, session.refreshTokenHash, session.authenticatedAt, session.refreshTokenExpiresAt],
    );
  }

  async appendSecurityEvent(event: SecurityEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.security_events
         (id, user_id, session_id, tenant_id, event_code, result, reason_code, ip_address, correlation_id, occurred_at, server_recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, GREATEST(clock_timestamp(), $10))`,
      [
        uuidV7(event.occurredAt.getTime()), event.userId, event.session?.sessionId ?? null, event.session?.tenantId ?? null,
        event.eventCode, event.result, event.reasonCode, event.ipAddress, event.correlationId, event.occurredAt,
      ],
    );
  }

  // `MfaEnrollmentPort` — enrolamiento del segundo factor (`A-4`). Vive en la
  // misma clase que el resto del login porque comparte la misma conexión y
  // el mismo `app.tenant_id` de sesión, no porque el login lo necesite.

  async insertPendingTotpFactor(input: { factorId: string; userId: string; encryptedSecret: string; enrolledAt: Date }): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.mfa_factors (id, user_id, factor_type, secret_reference, status, enrolled_at)
       VALUES ($1, $2, 'TOTP', $3, 'PENDING', $4)`,
      [input.factorId, input.userId, input.encryptedSecret, input.enrolledAt],
    );
  }

  async findPendingTotpFactorForUpdate(userId: string, factorId: string): Promise<{ id: string; encryptedSecret: string } | null> {
    const result = await this.client.query<{ id: string; secret_reference: string }>(
      `SELECT id, secret_reference FROM identity.mfa_factors
        WHERE id = $1 AND user_id = $2 AND factor_type = 'TOTP' AND status = 'PENDING' AND secret_reference IS NOT NULL
        FOR UPDATE`,
      [factorId, userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, encryptedSecret: row.secret_reference };
  }

  async activateTotpFactor(factorId: string, acceptedStep: number, verifiedAt: Date): Promise<void> {
    await this.client.query(
      `UPDATE identity.mfa_factors
          SET status = 'ACTIVE', verified_at = $2, last_used_at = to_timestamp($3), version = version + 1
        WHERE id = $1 AND status = 'PENDING'`,
      [factorId, verifiedAt, acceptedStep * 30],
    );
  }
}
