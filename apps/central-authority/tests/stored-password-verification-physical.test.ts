import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresPool, PostgresPasswordCredentialVerificationRepository,
} from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import {
  createPlatformPasswordVerifier, verifyPlatformPasswordVerifier, verifyStoredPlatformPassword,
} from "../src/platform-password-verifier.js";

// New DB + synthetic credentials only. No persistent user/schema/role changes.
// Verifies the credential seam with actual PostgreSQL ACLs + native Argon2id.
// Does NOT exercise MFA, authenticate a human or emit a session/SSA.
const serverUrl = process.env.POSTGRES_TEST_URL;
const databaseName = `pos_password_binding_test_${randomBytes(8).toString("hex")}`;
const userId = uuidV7();
const credentialId = uuidV7();
const email = `binding-${randomBytes(8).toString("hex")}@example.test`;
const password = randomBytes(24).toString("base64url");
const replacementPassword = randomBytes(24).toString("base64url");
type DatabasePool = ReturnType<typeof createPostgresPool>;

describe.runIf(Boolean(serverUrl))("stored password binding — real PostgreSQL and Argon2id", () => {
  let admin: DatabasePool;
  let owner: DatabasePool;
  let runtime: DatabasePool;
  let repository: PostgresPasswordCredentialVerificationRepository;
  let verifier: string;
  let rejectionVerifier: string;
  let replacementVerifier: string;
  let created = false;

  beforeAll(async () => {
    const url = new URL(serverUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433") {
      throw new Error("PASSWORD_BINDING_REQUIRES_ISOLATED_LOCALHOST_55433");
    }
    admin = createPostgresPool(serverUrl!, 2, "password-binding-fixture-admin");
    const roles = await admin.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [["pos_schema_owner", "pos_platform_app"]],
    );
    if (roles.rows.length !== 2) throw new Error("PASSWORD_BINDING_CANONICAL_ROLES_REQUIRED");
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await admin.query(`GRANT CREATE ON DATABASE "${databaseName}" TO pos_schema_owner`);
    url.pathname = `/${databaseName}`;
    url.username = "postgres";
    url.password = "";
    owner = createPostgresPool(url.toString(), 2, "password-binding-fixture-owner");
    const sqlRoot = new URL("../../../tools/target-migrations/sql/postgres/", import.meta.url);
    await owner.query(await readFile(new URL("bootstrap.sql", sqlRoot), "utf8"));
    const ddl = await owner.connect();
    try {
      await ddl.query("SET ROLE pos_schema_owner");
      await ddl.query(await readFile(new URL("001_central_foundation.up.sql", sqlRoot), "utf8"));
    } finally {
      try { await ddl.query("RESET ROLE"); } finally { ddl.release(); }
    }
    // Explicit test candidate only; no production KDF policy is selected.
    verifier = await createPlatformPasswordVerifier(password, "owasp-19m-t2-p1");
    rejectionVerifier = await createPlatformPasswordVerifier(password, "owasp-19m-t2-p1");
    replacementVerifier = await createPlatformPasswordVerifier(replacementPassword, "owasp-19m-t2-p1");
    await owner.query(
      `INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
       VALUES ($1,$2,$2,'Credential fixture','ACTIVE',clock_timestamp(),clock_timestamp())`, [userId, email],
    );
    await owner.query(
      `INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at)
       VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())`, [credentialId, userId, verifier],
    );
    url.username = "pos_platform_app";
    runtime = createPostgresPool(url.toString(), 2, "password-binding-central-runtime");
    repository = new PostgresPasswordCredentialVerificationRepository(runtime);
  }, 60_000);

  beforeEach(async () => {
    await owner.query("UPDATE identity.users SET status='ACTIVE' WHERE id=$1", [userId]);
    await owner.query(
      "UPDATE identity.user_credentials SET status='ACTIVE',revoked_at=NULL,locked_until=NULL,verifier=$2 WHERE id=$1",
      [credentialId, verifier],
    );
  });

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    // Strict teardown: no FORCE and no termination of unrelated connections.
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  }, 30_000);

  const check = (supplied = password, identifier = email) => verifyStoredPlatformPassword(
    repository, { email: identifier, password: supplied }, { rejectionVerifier },
  );

  it("uses the restricted central role and existing credential ACLs; matches without leaking its verifier", async () => {
    const role = await runtime.query("SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({ role: "pos_platform_app", rolsuper: false, rolbypassrls: false });
    const access = await owner.query(
      `SELECT has_column_privilege('pos_platform_app','identity.user_credentials','verifier','SELECT') AS central,
              has_column_privilege('pos_app','identity.user_credentials','verifier','SELECT') AS local,
              has_column_privilege('pos_platform_admin','identity.user_credentials','verifier','SELECT') AS admin`,
    );
    expect(access.rows[0]).toEqual({ central: true, local: false, admin: false });
    expect(await check(password, `  ${email.toUpperCase()}  `))
      .toEqual({ userId, credentialId, credentialVersion: "1" });
    const state = await owner.query(
      "SELECT (SELECT count(*)::int FROM identity.sessions) AS sessions, (SELECT count(*)::int FROM identity.security_events) AS events",
    );
    expect(state.rows[0]).toEqual({ sessions: 0, events: 0 });
  });

  it("rejects an incorrect password against the persisted Argon2id verifier", async () => {
    expect(await check("incorrect fixture password")).toBeNull();
  });

  it("rejects an unknown identity even when its supplied password matches the dummy verifier", async () => {
    expect(await check(password, "unknown@example.test")).toBeNull();
  });

  it("rejects an inactive user with the correct password", async () => {
    await owner.query("UPDATE identity.users SET status='INACTIVE' WHERE id=$1", [userId]);
    expect(await check()).toBeNull();
  });

  it("rejects a revoked credential with the correct password", async () => {
    await owner.query("UPDATE identity.user_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1", [credentialId]);
    expect(await check()).toBeNull();
  });

  it("preserves the schema guard rejecting an inconsistent active credential with a revocation timestamp", async () => {
    await expect(owner.query("UPDATE identity.user_credentials SET revoked_at=clock_timestamp() WHERE id=$1", [credentialId]))
      .rejects.toMatchObject({ code: "23514", constraint: "user_credentials_state_ck" });
    expect(await check()).toEqual({ userId, credentialId, credentialVersion: "1" });
  });

  it("honors the persisted lock even with the correct password", async () => {
    await owner.query("UPDATE identity.user_credentials SET locked_until=clock_timestamp()+interval '5 minutes' WHERE id=$1", [credentialId]);
    expect(await check()).toBeNull();
  });

  it("observes persisted credential content/version changes and rejects the old password", async () => {
    await owner.query("UPDATE identity.user_credentials SET verifier=$2,version=version+1 WHERE id=$1", [credentialId, replacementVerifier]);
    expect(await check(password)).toBeNull();
    expect(await check(replacementPassword)).toEqual({ userId, credentialId, credentialVersion: "2" });
    await owner.query("UPDATE identity.user_credentials SET version=1 WHERE id=$1", [credentialId]);
  });

  it("rejects unsupported PHC instead of using the dummy verifier to authenticate a real row", async () => {
    await owner.query("UPDATE identity.user_credentials SET verifier='unsupported-format' WHERE id=$1", [credentialId]);
    expect(await check()).toBeNull();
  });

  it("requires an explicitly supplied supported rejection verifier", async () => {
    await expect(verifyStoredPlatformPassword(repository, { email, password }, { rejectionVerifier: "invalid" }))
      .rejects.toThrow("PLATFORM_PASSWORD_REJECTION_VERIFIER_INVALID");
  });

  it("rolls back and releases its connection when crypto fails", async () => {
    await expect(repository.verifyActivePassword(email, async () => { throw new Error("fixture verifier failed"); }))
      .rejects.toThrow("fixture verifier failed");
    expect(await check()).toEqual({ userId, credentialId, credentialVersion: "1" });
  });

  it("locks the credential during verification and observes revocation on the next attempt", async () => {
    let entered!: () => void;
    let resume!: () => void;
    const verifying = new Promise<void>(resolve => { entered = resolve; });
    const resumeVerification = new Promise<void>(resolve => { resume = resolve; });
    const pending = repository.verifyActivePassword(email, async stored => {
      entered();
      await resumeVerification;
      return verifyPlatformPasswordVerifier(password, stored ?? "");
    });
    await verifying;
    try {
      await expect(owner.query("SELECT id FROM identity.user_credentials WHERE id=$1 FOR UPDATE NOWAIT", [credentialId]))
        .rejects.toMatchObject({ code: "55P03" });
    } finally { resume(); }
    expect(await pending).toEqual({ userId, credentialId, credentialVersion: "1" });
    await owner.query("UPDATE identity.user_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1", [credentialId]);
    expect(await check()).toBeNull();
  });
});
