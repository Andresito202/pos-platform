import type { Pool } from "pg";

/** Internal credential match, NOT a session, bearer token, MFA proof or role. */
export interface PasswordCredentialMatch {
  readonly userId: string;
  readonly credentialId: string;
  /** Concurrency version of the credential, never an SSA sequence. */
  readonly credentialVersion: string;
}

/** Schema columns failed_attempt_count / locked_until — previously unread on write. */
const LOCKOUT_AFTER_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Central Identity adapter for the existing PASSWORD verifier. The verifier is
 * exposed only to an in-process crypto callback. A match alone grants no
 * authority; callers still owe MFA, session issuance and audit.
 */
export class PostgresPasswordCredentialVerificationRepository {
  constructor(private readonly pool: Pool) {}

  async verifyActivePassword(
    emailNormalized: string,
    verify: (storedVerifier: string | null) => Promise<boolean>,
  ): Promise<PasswordCredentialMatch | null> {
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN");
      begun = true;
      const found = await client.query<{
        user_id: string; credential_id: string; credential_version: string; verifier: string;
      }>(
        `SELECT u.id::text AS user_id, c.id::text AS credential_id,
                c.version::text AS credential_version, c.verifier
           FROM identity.users AS u
           JOIN identity.user_credentials AS c ON c.user_id = u.id
          WHERE u.email_normalized = $1 AND u.status = 'ACTIVE'
            AND c.credential_type = 'PASSWORD' AND c.status = 'ACTIVE'
            AND c.revoked_at IS NULL
            AND (c.locked_until IS NULL OR c.locked_until <= clock_timestamp())
          FOR UPDATE OF c FOR SHARE OF u`,
        [emailNormalized],
      );
      // Unknown identities still invoke the callback (dummy verify) without inventing a row.
      const row = found.rows[0];
      const valid = await verify(row?.verifier ?? null);
      if (!row || valid !== true) {
        if (row) {
          // Lockout counters only — never bump credential version here.
          // Session proofs bind pwd.version; bumping would let a wrong password kill live sessions.
          await client.query(
            `UPDATE identity.user_credentials SET
               failed_attempt_count = failed_attempt_count + 1,
               locked_until = CASE
                 WHEN failed_attempt_count + 1 >= $2
                 THEN clock_timestamp() + ($3::bigint * interval '1 millisecond')
                 ELSE locked_until END
             WHERE id = $1::uuid AND status = 'ACTIVE' AND revoked_at IS NULL`,
            [row.credential_id, LOCKOUT_AFTER_FAILURES, LOCKOUT_MS],
          );
          await client.query("COMMIT");
          begun = false;
        } else {
          await client.query("ROLLBACK");
          begun = false;
        }
        return null;
      }
      // Success bookkeeping must not rotate version; password change/revoke owns that.
      await client.query(
        `UPDATE identity.user_credentials SET
           failed_attempt_count = 0,
           locked_until = NULL,
           last_used_at = clock_timestamp()
         WHERE id = $1::uuid AND status = 'ACTIVE' AND revoked_at IS NULL`,
        [row.credential_id],
      );
      await client.query("COMMIT");
      begun = false;
      return {
        userId: row.user_id,
        credentialId: row.credential_id,
        credentialVersion: row.credential_version,
      };
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
