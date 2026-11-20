import type { Pool } from "pg";

/** Internal credential match, NOT a session, bearer token, MFA proof or role. */
export interface PasswordCredentialMatch {
  readonly userId: string;
  readonly credentialId: string;
  /** Concurrency version of the credential, never an SSA sequence. */
  readonly credentialVersion: string;
}

/**
 * Central Identity adapter for the existing PASSWORD verifier. No credentials
 * are created or changed. The verifier is exposed only to an in-process crypto
 * callback; it never appears in the returned match. Callers must implement the
 * remaining login policy (abuse accounting, MFA, session issuance and audit)
 * before exposing authentication. A match alone grants no authority.
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
          FOR SHARE OF u, c`,
        [emailNormalized],
      );
      // An inactive/unknown identity still invokes the callback so that the
      // trusted crypto adapter can perform a dummy verification without
      // disclosing account existence. Even a true callback cannot invent a row.
      const row = found.rows[0];
      const valid = await verify(row?.verifier ?? null);
      if (!row || valid !== true) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }
      await client.query("COMMIT");
      begun = false;
      return { userId: row.user_id, credentialId: row.credential_id, credentialVersion: row.credential_version };
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
