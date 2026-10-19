import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPlatformPasswordRecoveryRepository, uuidV7 } from "../src/index.js";

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
    } finally {
      ddl.release();
    }

    runtime = new Pool({ connectionString: databaseUrl(), max: 4 });
    // Connect as the server's privileged test fixture, then SET ROLE to the
    // actual non-BYPASSRLS application role on every borrowed connection.
    const scopedPool = {
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
});
