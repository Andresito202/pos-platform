import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPlatformPasswordRecoveryRepository, PostgresPlatformWebAuthnChallengeRepository, PostgresPlatformWebAuthnMaterialRepository, PostgresPlatformWebAuthnAssertionTransaction, PostgresPlatformWebAuthnEnrollmentTransaction, uuidV7 } from "../src/index.js";

/**
 * Opt-in physical verification. POSTGRES_TEST_URL must point to an isolated
 * development PostgreSQL cluster with pre-existing POS roles and CREATE DATABASE
 * privilege. This test creates and drops ONLY its own randomly named database.
 * It never drops an existing database or modifies its cluster's roles.
 */
const SERVER_URL = process.env.POSTGRES_TEST_URL;
const TEST_DB = `pos_recovery_test_${randomBytes(8).toString("hex")}`;
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "target-migrations", "sql", "postgres");

function databaseUrl(): string {
  const url = new URL(SERVER_URL!);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

describe.runIf(Boolean(SERVER_URL))("platform password recovery physical PostgreSQL", () => {
  let admin: Pool | undefined;
  let owner: Pool | undefined;
  let runtime: Pool | undefined;
  let createdDatabase = false;
  let repository: PostgresPlatformPasswordRecoveryRepository;
  let webauthn: PostgresPlatformWebAuthnChallengeRepository;
  let materialStore: PostgresPlatformWebAuthnMaterialRepository;
  let assertionTx: PostgresPlatformWebAuthnAssertionTransaction;
  let platformPool: Pool;

  async function createUser(): Promise<string> {
    const id = uuidV7();
    const email = `recovery-${id.replace(/-/g, "")}@example.test`;
    await owner!.query(
      `INSERT INTO identity.users
       (id, email, email_normalized, full_name, status, created_at, updated_at, version)
       VALUES ($1, $2, $2, 'Recovery fixture', 'ACTIVE', clock_timestamp(), clock_timestamp(), 1)`,
      [id, email],
    );
    return id;
  }

  async function createPlatformRoleFor(userId: string): Promise<void> {
    // Test-only trusted SYSTEM provisioning inside the throwaway fixture DB.
    const id = uuidV7();
    const connection = await owner!.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "SELECT set_config('app.audit_id', $1, true), set_config('app.correlation_id', $2, true)",
        [uuidV7(), uuidV7()],
      );
      await connection.query(
        `INSERT INTO "authorization".roles
           (id, code, name, scope_type, version, status, created_at)
         VALUES ($1, $2, 'Fixture WebAuthn Platform', 'PLATFORM', 1, 'ACTIVE', clock_timestamp())`,
        [id, "WEBAUTHN_FIXTURE_" + id.replace(/-/g, "")],
      );
      await connection.query(
        `INSERT INTO "authorization".platform_role_assignments
           (id, user_id, role_id, status, valid_from, created_at,
            created_by_actor_type, version)
         VALUES ($1, $2, $3, 'ACTIVE', clock_timestamp(),
                 clock_timestamp(), 'SYSTEM', 1)`,
        [uuidV7(), userId, id],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async function createRequest(userId: string, maxAttempts = 5): Promise<{ requestId: string; digest: string }> {
    const digest = randomBytes(32).toString("hex");
    const { requestId } = await repository.createRequest({
      userId, tokenHash: digest, correlationId: uuidV7(),
      expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      maxAttempts,
    });
    return { requestId, digest };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: SERVER_URL!, max: 2 });
    // Missing roles are a preflight failure, not permission to change the cluster.
    const required = ["pos_schema_owner", "pos_migrator", "pos_platform_app", "pos_app", "pos_worker", "pos_platform_admin"];
    const found = await admin.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [required]);
    for (const name of required) {
      if (!found.rows.some((row) => row.rolname === name)) throw new Error(`RECOVERY_PHYSICAL_ROLE_MISSING_${name}`);
    }
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    createdDatabase = true;
    await admin.query(`GRANT CREATE ON DATABASE "${TEST_DB}" TO pos_schema_owner`);
    owner = new Pool({ connectionString: databaseUrl(), max: 2 });
    await owner.query(await readFile(join(SQL_DIR, "bootstrap.sql"), "utf8"));
    const ddl = await owner.connect();
    try {
      await ddl.query("SET ROLE pos_schema_owner");
      await ddl.query(await readFile(join(SQL_DIR, "001_central_foundation.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "007_password_recovery.up.sql"), "utf8"));
      // Existing platform-role schema (008) is needed by the new R5 approval gate.
      await ddl.query(await readFile(join(SQL_DIR, "008_platform_role_assignments.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "009_webauthn_challenges.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "010_webauthn_credential_material.up.sql"), "utf8"));
    } finally {
      // SET ROLE is session-scoped: reset it before returning this connection
      // to the inspector pool, or FORCE RLS will silently hide persisted rows.
      try {
        await ddl.query("RESET ROLE");
      } finally {
        ddl.release();
      }
    }

    // Inspector queries must bypass RLS, unlike the runtime queries below.
    // This guard prevents a false PASS on rollback when rows are merely hidden.
    const inspector = await owner.query<{
      effective_role: string;
      login_role: string;
      bypasses_rls: boolean;
    }>(`SELECT current_user AS effective_role, session_user AS login_role,
                (rolsuper OR rolbypassrls) AS bypasses_rls
           FROM pg_roles WHERE rolname = current_user`);
    const inspectorRole = inspector.rows[0];
    if (!inspectorRole || inspectorRole.effective_role !== inspectorRole.login_role
      || !inspectorRole.bypasses_rls) {
      throw new Error("RECOVERY_PHYSICAL_INSPECTOR_RLS_UNTRUSTED");
    }

    runtime = new Pool({ connectionString: databaseUrl(), max: 4 });
    // Connect as the server's privileged test fixture, then SET ROLE to the
    // actual non-BYPASSRLS application role on every borrowed connection.
    const scopedPool = {
      query: async (statement: string, params?: unknown[]) => {
        const client = await runtime!.connect();
        try {
          await client.query("SET ROLE pos_platform_app");
          return await client.query(statement, params);
        } finally {
          await client.query("RESET ROLE").catch(() => undefined);
          client.release();
        }
      },
      connect: async (): Promise<PoolClient> => {
        const client = await runtime!.connect();
        try {
          await client.query("SET ROLE pos_platform_app");
          return client;
        } catch (error) {
          client.release();
          throw error;
        }
      },
    } as unknown as Pool;
    repository = new PostgresPlatformPasswordRecoveryRepository(scopedPool);
    webauthn = new PostgresPlatformWebAuthnChallengeRepository(scopedPool);
    materialStore = new PostgresPlatformWebAuthnMaterialRepository(scopedPool);
    assertionTx = new PostgresPlatformWebAuthnAssertionTransaction(scopedPool);
    platformPool = scopedPool;
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    if (createdDatabase) await admin?.query(`DROP DATABASE "${TEST_DB}"`);
    await admin?.end();
  }, 120_000);

  it("physically inserts the request and its security event under pos_platform_app RLS", async () => {
    const userId = await createUser();
    const { requestId, digest } = await createRequest(userId);
    const stored = await owner!.query(
      "SELECT user_id::text, token_hash, status, attempt_count FROM identity.password_recovery_requests WHERE id=$1",
      [requestId],
    );
    expect(stored.rows).toEqual([{
      user_id: userId, token_hash: digest, status: "REQUESTED", attempt_count: 0,
    }]);
    const events = await owner!.query(
      "SELECT event_code, result FROM identity.security_events WHERE user_id=$1",
      [userId],
    );
    expect(events.rows).toEqual([{ event_code: "PLATFORM_RECOVERY_REQUESTED", result: "SUCCEEDED" }]);
    const rls = await owner!.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='identity.password_recovery_requests'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it("serializes two simultaneous valid token verifications and rejects replay", async () => {
    const userId = await createUser();
    const { requestId, digest } = await createRequest(userId);
    const [first, second] = await Promise.all([
      repository.verifyRequestToken({ requestId, tokenHash: digest }),
      repository.verifyRequestToken({ requestId, tokenHash: digest }),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
    const stored = await owner!.query(
      "SELECT status, attempt_count, verified_at IS NOT NULL AS verified FROM identity.password_recovery_requests WHERE id=$1",
      [requestId],
    );
    expect(stored.rows).toEqual([{ status: "VERIFIED", attempt_count: 0, verified: true }]);
  });

  it("enforces attempt lockout and records the rejection in the real ledger", async () => {
    const userId = await createUser();
    const { requestId, digest } = await createRequest(userId, 1);
    expect(await repository.verifyRequestToken({ requestId, tokenHash: "f".repeat(64) })).toBe(false);
    expect(await repository.verifyRequestToken({ requestId, tokenHash: digest })).toBe(false);
    const stored = await owner!.query(
      "SELECT status, attempt_count FROM identity.password_recovery_requests WHERE id=$1",
      [requestId],
    );
    expect(stored.rows).toEqual([{ status: "LOCKED", attempt_count: 1 }]);
    const audit = await owner!.query(
      "SELECT event_code, reason_code FROM identity.security_events WHERE user_id=$1 AND event_code='PLATFORM_RECOVERY_REJECTED'",
      [userId],
    );
    expect(audit.rows).toEqual([{ event_code: "PLATFORM_RECOVERY_REJECTED", reason_code: "TOKEN_INVALID" }]);
  });

  it("rolls back request creation when the actual security ledger denies INSERT", async () => {
    const userId = await createUser();
    await owner!.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(createRequest(userId)).rejects.toThrow();
      const existing = await owner!.query(
        "SELECT count(*)::int AS count FROM identity.password_recovery_requests WHERE user_id=$1",
        [userId],
      );
      expect(existing.rows[0]?.count).toBe(0);
    } finally {
      await owner!.query("GRANT INSERT ON identity.security_events TO pos_platform_app");
    }
  });

  it("physically completes approved assisted recovery and revokes identity sessions atomically", async () => {
    const userId = await createUser();
    const oldCredentialId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.user_credentials
       (id, user_id, credential_type, verifier, status, created_at, version)
       VALUES ($1, $2, 'PASSWORD', 'legacy-verifier-test-only', 'ACTIVE', clock_timestamp(), 1)`,
      [oldCredentialId, userId],
    );
    const sessionId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.sessions
       (id, user_id, authenticated_at, expires_at, mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               'PENDING', clock_timestamp(), 1)`, [sessionId, userId],
    );
    await owner!.query(
      `INSERT INTO identity.session_refresh_tokens
       (id, session_id, token_family_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + interval '1 hour')`,
      [uuidV7(), sessionId, uuidV7(), randomBytes(32).toString("hex")],
    );

    const { requestId, digest } = await createRequest(userId);
    expect(await repository.verifyRequestToken({ requestId, tokenHash: digest })).toBe(true);
    const phcFixture = "$argon2id$v=19$m=19456,t=2,p=1$MTIzNDU2Nzg5MGFiY2RlZg$" + "Y".repeat(43);
    await expect(repository.completeAssistedRecovery({
      requestId, tokenHash: digest, newVerifier: phcFixture,
    })).rejects.toThrow("PLATFORM_RECOVERY_COMPLETION_NOT_AUTHORIZED");
    // Isolated test-only fixture: the real reinforced identity proof workflow
    // does not exist yet, so the production API must remain unavailable.
    await owner!.query(
      "UPDATE identity.password_recovery_requests SET support_verified = true WHERE id = $1",
      [requestId],
    );
    const completion = await repository.completeAssistedRecovery({
      requestId, tokenHash: digest, newVerifier: phcFixture,
    });
    expect(completion.credentialId).toMatch(/^[a-f0-9-]{36}$/);

    const credentials = await owner!.query(
      "SELECT id::text, status FROM identity.user_credentials WHERE user_id = $1 ORDER BY status",
      [userId],
    );
    expect(credentials.rows).toEqual([
      { id: completion.credentialId, status: "ACTIVE" },
      { id: oldCredentialId, status: "RETIRED" },
    ]);
    const request = await owner!.query(
      "SELECT status, consumed_at IS NOT NULL AS consumed FROM identity.password_recovery_requests WHERE id=$1",
      [requestId],
    );
    expect(request.rows).toEqual([{ status: "CONSUMED", consumed: true }]);
    const sessions = await owner!.query(
      "SELECT revoked_at IS NOT NULL AS revoked, revocation_reason FROM identity.sessions WHERE id=$1",
      [sessionId],
    );
    expect(sessions.rows).toEqual([{ revoked: true, revocation_reason: "PASSWORD_RECOVERY" }]);
    const refresh = await owner!.query(
      "SELECT revoked_at IS NOT NULL AS revoked, revocation_reason FROM identity.session_refresh_tokens WHERE session_id=$1",
      [sessionId],
    );
    expect(refresh.rows).toEqual([{ revoked: true, revocation_reason: "PASSWORD_RECOVERY" }]);
    const events = await owner!.query(
      "SELECT event_code FROM identity.security_events WHERE user_id=$1 AND event_code='PLATFORM_RECOVERY_COMPLETED'",
      [userId],
    );
    expect(events.rows).toEqual([{ event_code: "PLATFORM_RECOVERY_COMPLETED" }]);
    await expect(repository.completeAssistedRecovery({
      requestId, tokenHash: digest, newVerifier: phcFixture,
    })).rejects.toThrow("PLATFORM_RECOVERY_COMPLETION_NOT_AUTHORIZED");
  });

  it("physically denies recovery approval without an explicit platform role or permission", async () => {
    const subjectUserId = await createUser();
    const approverUserId = await createUser();
    const approverSessionId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.sessions
         (id, user_id, authenticated_at, expires_at, last_reauthenticated_at,
          mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               clock_timestamp(), 'SATISFIED', clock_timestamp(), 1)`,
      [approverSessionId, approverUserId],
    );
    // Test-only MFA fixture: no WebAuthn challenge or real authenticator is
    // asserted here. This deliberately isolates the platform-grant rejection.
    await owner!.query(
      `INSERT INTO identity.mfa_factors
         (id, user_id, factor_type, secret_reference, status, enrolled_at, verified_at, version)
       VALUES ($1, $2, 'WEBAUTHN_TEST_FIXTURE', NULL, 'ACTIVE',
               clock_timestamp(), clock_timestamp(), 1)`,
      [uuidV7(), approverUserId],
    );
    const { requestId, digest } = await createRequest(subjectUserId);
    expect(await repository.verifyRequestToken({ requestId, tokenHash: digest })).toBe(true);

    await expect(repository.approveAssistedRecovery({
      requestId, approverSessionId, maxReauthenticationAgeMs: 300000,
    })).rejects.toThrow("PLATFORM_RECOVERY_APPROVER_NOT_AUTHORIZED");

    const request = await owner!.query(
      "SELECT status, support_verified FROM identity.password_recovery_requests WHERE id = $1",
      [requestId],
    );
    expect(request.rows).toEqual([{ status: "VERIFIED", support_verified: false }]);
    const event = await owner!.query(
      `SELECT count(*)::int AS total FROM identity.security_events
        WHERE user_id = $1 AND event_code = 'PLATFORM_RECOVERY_APPROVED'`,
      [subjectUserId],
    );
    expect(event.rows).toEqual([{ total: 0 }]);
    const grants = await owner!.query(
      `SELECT count(*)::int AS total FROM "authorization".platform_role_assignments
       WHERE user_id = $1`, [approverUserId],
    );
    expect(grants.rows).toEqual([{ total: 0 }]);
  });

  it("physically consumes WebAuthn challenge once under concurrent attempts", async () => {
    const userId = await createUser();
    const issued = await webauthn.issue({
      userId, factorId: null, sessionId: null,
      purpose: "AUTHENTICATE",
      rpId: "pos.example.test", expectedOrigin: "https://pos.example.test",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      correlationId: uuidV7(),
    });
    const consume = () => webauthn.consumeAfterVerifiedProof({
      userId, purpose: "AUTHENTICATE", sessionId: null, challenge: issued.challenge,
    }, async challenge => {
      expect(challenge.rpId).toBe("pos.example.test");
      expect(challenge.expectedOrigin).toBe("https://pos.example.test");
      // A test-only success callback, NOT real WebAuthn cryptographic evidence.
      return true;
    });
    const outcomes = await Promise.all([consume(), consume()]);
    expect(outcomes.sort()).toEqual([false, true]);
    const stored = await owner!.query(
      `SELECT consumed_at IS NOT NULL AS consumed, version,
              challenge_hash
         FROM identity.webauthn_challenges WHERE id = $1`, [issued.challengeId],
    );
    expect(stored.rows).toEqual([{
      consumed: true, version: "2",
      challenge_hash: createHash("sha256").update(issued.challenge).digest("hex"),
    }]);
    await expect(owner!.query(
      "UPDATE identity.webauthn_challenges SET consumed_at = NULL WHERE id = $1",
      [issued.challengeId],
    )).rejects.toThrow();
  });

  it("physically rejects expired WebAuthn challenges without invoking proof validation", async () => {
    const userId = await createUser();
    const challenge = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(challenge).digest("hex");
    const id = uuidV7();
    await owner!.query(
      `INSERT INTO identity.webauthn_challenges
         (id, user_id, purpose, challenge_hash, rp_id, expected_origin,
          issued_at, expires_at, correlation_id)
       VALUES ($1, $2, 'AUTHENTICATE', $3, 'pos.example.test', 'https://pos.example.test',
               clock_timestamp() - interval '5 minutes',
               clock_timestamp() - interval '3 minutes', $4)`,
      [id, userId, digest, uuidV7()],
    );
    let invoked = false;
    expect(await webauthn.consumeAfterVerifiedProof({
      userId, purpose: "AUTHENTICATE", sessionId: null, challenge,
    }, async () => { invoked = true; return true; })).toBe(false);
    expect(invoked).toBe(false);
    const status = await owner!.query(
      "SELECT consumed_at FROM identity.webauthn_challenges WHERE id=$1", [id],
    );
    expect(status.rows).toEqual([{ consumed_at: null }]);
  });

  it("physically advances WebAuthn material counter once and rejects stale CAS and key mutation", async () => {
    const userId = await createUser();
    const factorId = uuidV7();
    const materialId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.mfa_factors
         (id, user_id, factor_type, secret_reference, status, enrolled_at, verified_at, version)
       VALUES ($1, $2, 'WEBAUTHN', $3, 'ACTIVE', clock_timestamp(), clock_timestamp(), 1)`,
      [factorId, userId, "webauthn:v1:" + materialId],
    );
    const id = randomBytes(32).toString("base64url");
    const publicKeyFixture = randomBytes(65).toString("base64url");
    await owner!.query(
      `INSERT INTO identity.webauthn_credential_material
         (id, factor_id, credential_id, public_key_cose_base64url,
          counter, backup_eligible, backed_up, version)
       VALUES ($1, $2, $3, $4, 0, false, false, 1)`,
      [materialId, factorId, id, publicKeyFixture],
    );
    const found = await materialStore.findVerifiedMaterial(userId, factorId);
    expect(found).toMatchObject({
      materialId, factorId, userId, credentialId: id, counter: 0, version: 1,
    });
    const client = await runtime!.connect();
    try {
      await client.query("SET ROLE pos_platform_app");
      const args = {
        userId, factorId, materialId,
        expectedCounter: 0, newCounter: 1, expectedVersion: 1, backedUp: false,
      };
      await client.query("BEGIN");
      expect(await materialStore.advanceCounterCas(client, args)).toBe(true);
      await client.query("COMMIT");
      await client.query("BEGIN");
      expect(await materialStore.advanceCounterCas(client, args)).toBe(false);
      await client.query("ROLLBACK");
      await client.query("RESET ROLE");
    } finally {
      // An assertion/SQL failure must not leak SET ROLE into the pooled connection.
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
    const rows = await owner!.query(
      `SELECT counter::text, version::text, last_used_at IS NOT NULL AS used
         FROM identity.webauthn_credential_material WHERE id = $1`, [materialId],
    );
    expect(rows.rows).toEqual([{ counter: "1", version: "2", used: true }]);
    await expect(owner!.query(
      `UPDATE identity.webauthn_credential_material
          SET public_key_cose_base64url = $1, version = version + 1,
              last_used_at = clock_timestamp()
        WHERE id = $2`,
      [randomBytes(65).toString("base64url"), materialId],
    )).rejects.toThrow();
  });

  it("physically refuses WebAuthn public material lookup across user accounts", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const factorId = uuidV7();
    const materialId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.mfa_factors
         (id, user_id, factor_type, secret_reference, status, enrolled_at, verified_at, version)
       VALUES ($1, $2, 'WEBAUTHN', $3, 'ACTIVE', clock_timestamp(), clock_timestamp(), 1)`,
      [factorId, firstUser, "webauthn:v1:" + materialId],
    );
    await owner!.query(
      `INSERT INTO identity.webauthn_credential_material
         (id, factor_id, credential_id, public_key_cose_base64url)
       VALUES ($1, $2, $3, $4)`,
      [materialId, factorId, randomBytes(32).toString("base64url"),
       randomBytes(65).toString("base64url")],
    );
    expect(await materialStore.findVerifiedMaterial(secondUser, factorId)).toBeNull();
    expect(await materialStore.findVerifiedMaterial(firstUser, factorId)).not.toBeNull();
  });
  it("physically commits a WebAuthn proof receipt with counter, challenge and audit together", async () => {
    const userId = await createUser();
    const factorId = uuidV7(), materialId = uuidV7(), sessionId = uuidV7();
    await owner!.query(
      `INSERT INTO identity.mfa_factors
         (id, user_id, factor_type, secret_reference, status, enrolled_at, verified_at, version)
       VALUES ($1, $2, 'WEBAUTHN', $3, 'ACTIVE', clock_timestamp(), clock_timestamp(), 1)`,
      [factorId, userId, "webauthn:v1:" + materialId],
    );
    await owner!.query(
      `INSERT INTO identity.webauthn_credential_material
         (id, factor_id, credential_id, public_key_cose_base64url)
       VALUES ($1, $2, $3, $4)`,
      [materialId, factorId, randomBytes(32).toString("base64url"),
       randomBytes(65).toString("base64url")],
    );
    await owner!.query(
      `INSERT INTO identity.sessions
         (id, user_id, authenticated_at, expires_at, last_reauthenticated_at,
          mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               clock_timestamp(), 'SATISFIED', clock_timestamp(), 1)`,
      [sessionId, userId],
    );
    const issued = await webauthn.issue({
      userId, factorId, sessionId, purpose: "REAUTHENTICATE",
      rpId: "admin.example.test", expectedOrigin: "https://admin.example.test",
      expiresAt: new Date(Date.now() + 300000).toISOString(), correlationId: uuidV7(),
    });
    const inputs = { userId, factorId, sessionId, challenge: issued.challenge,
      purpose: "REAUTHENTICATE" as const, rpId: "admin.example.test",
      expectedOrigin: "https://admin.example.test" };
    // Fixture-only proof: this test certifies transaction atomicity, NOT a real
    // hardware authenticator or the Central Authority cryptographic callback.
    let attempts = 0;
    const proof = async () => { attempts++; return {
      userVerified: true as const, newCounter: 1, credentialBackedUp: false,
    }; };
    expect(await assertionTx.verifyAndCommit(inputs, proof)).toBe(true);
    expect(await assertionTx.verifyAndCommit(inputs, proof)).toBe(false);
    expect(attempts).toBe(1);
    const rows = await owner!.query(
      `SELECT m.counter::text AS counter, m.version::text AS material_version,
              c.consumed_at IS NOT NULL AS consumed, c.version::text AS challenge_version
         FROM identity.webauthn_credential_material AS m
         CROSS JOIN identity.webauthn_challenges AS c
        WHERE m.id = $1 AND c.id = $2`,
      [materialId, issued.challengeId],
    );
    expect(rows.rows).toEqual([{
      counter: "1", material_version: "2", consumed: true, challenge_version: "2",
    }]);
    const audits = await owner!.query(
      `SELECT count(*)::int AS total FROM identity.security_events
        WHERE user_id = $1 AND session_id = $2
          AND event_code = 'PLATFORM_WEBAUTHN_ASSERTION_VERIFIED'`,
      [userId, sessionId],
    );
    expect(audits.rows).toEqual([{ total: 1 }]);
  });
  it("physically persists verified WebAuthn enrollment, consumes ENROLL once and appends audit atomically", async () => {
    const userId = await createUser(), sessionId = uuidV7();
    await createPlatformRoleFor(userId);
    await owner!.query(
      `INSERT INTO identity.sessions
         (id, user_id, authenticated_at, expires_at, last_reauthenticated_at,
          mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               clock_timestamp(), 'PENDING', clock_timestamp(), 1)`,
      [sessionId, userId],
    );
    const issued = await webauthn.issue({
      userId, sessionId, factorId: null, purpose: "ENROLL",
      rpId: "admin.example.test", expectedOrigin: "https://admin.example.test",
      expiresAt: new Date(Date.now() + 300000).toISOString(), correlationId: uuidV7(),
    });
    // The resolver is intentionally a fixture, NOT a production authentication
    // provider. This test certifies atomic SQL only, not session legitimacy.
    const enrollment = new PostgresPlatformWebAuthnEnrollmentTransaction(
      platformPool,
      async (proof) => proof === "fixture-session-proof" ? { userId, sessionId } : null,
      300000,
    );
    const input = { authorizationProof: "fixture-session-proof",
      challenge: issued.challenge, rpId: "admin.example.test",
      expectedOrigin: "https://admin.example.test" };
    const proof = async () => ({
      credentialId: randomBytes(32).toString("base64url"),
      publicKeyCoseBase64url: randomBytes(65).toString("base64url"),
      counter: 0, backupEligible: false, backedUp: false, userVerified: true as const,
    });
    const result = await enrollment.verifyAndEnroll(input, proof);
    expect(result).toMatchObject({ userId });
    expect(result).not.toBeNull();
    expect(await enrollment.verifyAndEnroll(input, proof)).toBeNull();
    const rows = await owner!.query(
      `SELECT f.status, f.verified_at IS NOT NULL AS verified,
              f.secret_reference, m.id::text AS material_id,
              c.consumed_at IS NOT NULL AS consumed,
              (SELECT count(*)::int FROM identity.security_events AS e
                 WHERE e.user_id = $1 AND e.event_code = 'PLATFORM_MFA_ENROLLED') AS events
         FROM identity.mfa_factors AS f
         JOIN identity.webauthn_credential_material AS m ON m.factor_id = f.id
         JOIN identity.webauthn_challenges AS c ON c.id = $2
        WHERE f.id = $3`,
      [userId, issued.challengeId, result!.factorId],
    );
    expect(rows.rows).toEqual([{
      status: "ACTIVE", verified: true,
      secret_reference: "webauthn:v1:" + result!.materialId,
      material_id: result!.materialId, consumed: true, events: 1,
    }]);
  });

  it("physically rolls back factor and material when MFA enrollment audit INSERT is denied", async () => {
    const userId = await createUser(), sessionId = uuidV7();
    await createPlatformRoleFor(userId);
    await owner!.query(
      `INSERT INTO identity.sessions
         (id, user_id, authenticated_at, expires_at, last_reauthenticated_at,
          mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               clock_timestamp(), 'PENDING', clock_timestamp(), 1)`,
      [sessionId, userId],
    );
    const issued = await webauthn.issue({
      userId, sessionId, factorId: null, purpose: "ENROLL",
      rpId: "admin.example.test", expectedOrigin: "https://admin.example.test",
      expiresAt: new Date(Date.now() + 300000).toISOString(), correlationId: uuidV7(),
    });
    const enrollment = new PostgresPlatformWebAuthnEnrollmentTransaction(
      platformPool, async () => ({ userId, sessionId }), 300000,
    );
    await owner!.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(enrollment.verifyAndEnroll({
        authorizationProof: "fixture",
        challenge: issued.challenge,
        rpId: "admin.example.test",
        expectedOrigin: "https://admin.example.test",
      }, async () => ({
        credentialId: randomBytes(32).toString("base64url"),
        publicKeyCoseBase64url: randomBytes(65).toString("base64url"),
        counter: 0, backupEligible: false, backedUp: false, userVerified: true as const,
      }))).rejects.toThrow();
      const rows = await owner!.query(
        `SELECT
           (SELECT count(*)::int FROM identity.mfa_factors WHERE user_id=$1) AS factors,
           (SELECT count(*)::int FROM identity.webauthn_credential_material AS m
              JOIN identity.mfa_factors AS f ON f.id = m.factor_id
             WHERE f.user_id = $1) AS materials,
           (SELECT consumed_at IS NULL FROM identity.webauthn_challenges WHERE id = $2) AS pending`,
        [userId, issued.challengeId],
      );
      expect(rows.rows).toEqual([{ factors: 0, materials: 0, pending: true }]);
    } finally {
      await owner!.query("GRANT INSERT ON identity.security_events TO pos_platform_app");
    }
  });

  it("physically permits one winner for simultaneous attempts against one ENROLL challenge", async () => {
    const userId = await createUser(), sessionId = uuidV7();
    await createPlatformRoleFor(userId);
    await owner!.query(
      `INSERT INTO identity.sessions
         (id, user_id, authenticated_at, expires_at, last_reauthenticated_at,
          mfa_status, created_at, version)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + interval '1 hour',
               clock_timestamp(), 'PENDING', clock_timestamp(), 1)`,
      [sessionId, userId],
    );
    const issued = await webauthn.issue({
      userId, sessionId, factorId: null, purpose: "ENROLL",
      rpId: "admin.example.test", expectedOrigin: "https://admin.example.test",
      expiresAt: new Date(Date.now() + 300000).toISOString(), correlationId: uuidV7(),
    });
    const enrollment = new PostgresPlatformWebAuthnEnrollmentTransaction(
      platformPool, async () => ({ userId, sessionId }), 300000,
    );
    const input = { authorizationProof: "fixture", challenge: issued.challenge,
      rpId: "admin.example.test", expectedOrigin: "https://admin.example.test" };
    const proof = async () => ({
      credentialId: randomBytes(32).toString("base64url"),
      publicKeyCoseBase64url: randomBytes(65).toString("base64url"),
      counter: 0, backupEligible: false, backedUp: false, userVerified: true as const,
    });
    const results = await Promise.all([
      enrollment.verifyAndEnroll(input, proof),
      enrollment.verifyAndEnroll(input, proof),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    const stored = await owner!.query(
      `SELECT count(*)::int AS total FROM identity.mfa_factors WHERE user_id=$1`,
      [userId],
    );
    expect(stored.rows).toEqual([{ total: 1 }]);
  });

});
