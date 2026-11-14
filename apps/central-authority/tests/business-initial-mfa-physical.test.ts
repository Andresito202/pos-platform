import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool, PostgresPlatformWebAuthnChallengeRepository } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import { createPlatformPasswordVerifier } from "../src/platform-password-verifier.js";
import { BusinessInitialMfaFlow } from "../src/business-initial-mfa-flow.js";

// Software authenticator signs genuine P-256 assertions; verification, Argon2,
// PostgreSQL, challenge consumption, CAS and security ledger are all real.
// Only a new random DB on the existing dedicated local fixture is modified.
const serverUrl = process.env.POSTGRES_TEST_URL;
const databaseName = `pos_initial_mfa_test_${randomBytes(8).toString("hex")}`;
type DatabasePool = ReturnType<typeof createPostgresPool>;
const password = randomBytes(24).toString("base64url");
const rpId = "business.example.test";
const origin = `https://${rpId}`;
const sha = (input: string | Uint8Array) => createHash("sha256").update(input).digest();

describe.runIf(Boolean(serverUrl))("initial BUSINESS MFA — physical PostgreSQL + genuine WebAuthn", () => {
  let admin: DatabasePool, owner: DatabasePool, runtime: DatabasePool;
  let created = false;
  let verifier: string, rejectionVerifier: string;
  let context: {
    userId: string; credentialId: string; factorId: string; materialId: string;
    email: string; publicCredentialId: string; keys: ReturnType<typeof generateKeyPairSync>;
    flow: BusinessInitialMfaFlow;
  };
  const makeFlow = (lifetime = 60_000) => new BusinessInitialMfaFlow(runtime, {
    rpId, origin, rejectionVerifier, challengeLifetimeMs: lifetime,
  });

  beforeAll(async () => {
    const url = new URL(serverUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433") {
      throw new Error("INITIAL_MFA_TEST_REQUIRES_LOCALHOST_55433");
    }
    admin = createPostgresPool(serverUrl!, 2, "initial-mfa-fixture-admin");
    const roles = await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [["pos_schema_owner", "pos_platform_app"]]);
    if (roles.rows.length !== 2) throw new Error("INITIAL_MFA_CANONICAL_ROLES_REQUIRED");
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await admin.query(`GRANT CREATE ON DATABASE "${databaseName}" TO pos_schema_owner`);
    url.pathname = `/${databaseName}`; url.username = "postgres"; url.password = "";
    owner = createPostgresPool(url.toString(), 3, "initial-mfa-fixture-owner");
    const root = new URL("../../../tools/target-migrations/sql/postgres/", import.meta.url);
    await owner.query(await readFile(new URL("bootstrap.sql", root), "utf8"));
    const ddl = await owner.connect();
    try {
      await ddl.query("SET ROLE pos_schema_owner");
      for (const name of ["001_central_foundation.up.sql", "009_webauthn_challenges.up.sql", "010_webauthn_credential_material.up.sql"]) {
        await ddl.query(await readFile(new URL(name, root), "utf8"));
      }
    } finally { try { await ddl.query("RESET ROLE"); } finally { ddl.release(); } }
    url.username = "pos_platform_app";
    runtime = createPostgresPool(url.toString(), 4, "initial-mfa-central-runtime");
    // Explicit test-only candidate. Not approval of production KDF/RP/TTL.
    verifier = await createPlatformPasswordVerifier(password, "owasp-19m-t2-p1");
    rejectionVerifier = await createPlatformPasswordVerifier(randomBytes(24).toString("hex"), "owasp-19m-t2-p1");
  }, 60_000);

  beforeEach(async () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = keys.publicKey.export({ format: "jwk" });
    const cose = Buffer.concat([
      Buffer.from("a5010203262001215820", "hex"), Buffer.from(jwk.x!, "base64url"),
      Buffer.from("225820", "hex"), Buffer.from(jwk.y!, "base64url"),
    ]);
    context = {
      userId: uuidV7(), credentialId: uuidV7(), factorId: uuidV7(), materialId: uuidV7(),
      email: `initial-mfa-${randomBytes(8).toString("hex")}@example.test`,
      publicCredentialId: randomBytes(32).toString("base64url"), keys, flow: makeFlow(),
    };
    await owner.query(
      `INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
       VALUES ($1,$2,$2,'Initial MFA fixture','ACTIVE',clock_timestamp(),clock_timestamp())`, [context.userId, context.email],
    );
    await owner.query(
      `INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at)
       VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())`, [context.credentialId, context.userId, verifier],
    );
    await owner.query(
      `INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at)
       VALUES ($1,$2,'WEBAUTHN',$3,'ACTIVE',clock_timestamp(),clock_timestamp())`,
      [context.factorId, context.userId, `webauthn:v1:${context.materialId}`],
    );
    await owner.query(
      `INSERT INTO identity.webauthn_credential_material(id,factor_id,credential_id,public_key_cose_base64url)
       VALUES ($1,$2,$3,$4)`, [context.materialId, context.factorId, context.publicCredentialId, cose.toString("base64url")],
    );
  });

  afterAll(async () => {
    await runtime?.end(); await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  }, 30_000);

  async function begin(flow = context.flow) {
    const result = await flow.begin({ email: context.email, password, factorId: context.factorId, correlationId: uuidV7() });
    if (!result) throw new Error("INITIAL_MFA_FIXTURE_BEGIN_FAILED");
    return result;
  }
  function assertion(challenge: string, options: { counter?: number; flags?: number; rp?: string; clientOrigin?: string } = {}): AuthenticationResponseJSON {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: options.clientOrigin ?? origin, crossOrigin: false }));
    const auth = Buffer.alloc(37);
    sha(options.rp ?? rpId).copy(auth);
    auth[32] = options.flags ?? 0x05;
    auth.writeUInt32BE(options.counter ?? 1, 33);
    return {
      id: context.publicCredentialId, rawId: context.publicCredentialId, type: "public-key", clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString("base64url"), authenticatorData: auth.toString("base64url"),
        signature: sign("sha256", Buffer.concat([auth, sha(clientData)]), context.keys.privateKey).toString("base64url"),
      },
    };
  }
  const complete = (challenge: string, response = assertion(challenge), flow = context.flow) => flow.complete({
    email: context.email, password, challenge, response,
  });
  async function state(challengeId: string) {
    const result = await owner.query(
      `SELECT (SELECT counter::text FROM identity.webauthn_credential_material WHERE id=$1) AS counter,
              (SELECT version::text FROM identity.webauthn_credential_material WHERE id=$1) AS version,
              (SELECT consumed_at IS NOT NULL FROM identity.webauthn_challenges WHERE id=$2) AS consumed,
              (SELECT count(*)::int FROM identity.security_events WHERE user_id=$3) AS events`,
      [context.materialId, challengeId, context.userId],
    );
    return result.rows[0];
  }
  const unchanged = (id: string) => expect(state(id)).resolves.toEqual({ counter: "0", version: "1", consumed: false, events: 0 });

  it("commits real UV/signature, persisted CAS, single-use challenge and event, without creating any session", async () => {
    const role = await runtime.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({ role: "pos_platform_app", rolsuper: false, rolbypassrls: false });
    const challenge = await begin();
    expect(challenge.userVerification).toBe("required");
    const row = await owner.query("SELECT purpose,session_id FROM identity.webauthn_challenges WHERE id=$1", [challenge.challengeId]);
    expect(row.rows[0]).toEqual({ purpose: "AUTHENTICATE", session_id: null });
    const receipt = await complete(challenge.challenge);
    expect(receipt).not.toBeNull();
    expect(context.flow.takeForBusinessSession(receipt)).toMatchObject({
      purpose: "BUSINESS_INITIAL_MFA", sessionId: null, userId: context.userId,
      factorId: context.factorId, passwordCredentialId: context.credentialId,
      passwordCredentialVersion: "1", challengeId: challenge.challengeId,
    });
    expect(await state(challenge.challengeId)).toEqual({ counter: "1", version: "2", consumed: true, events: 1 });
    const event = await owner.query("SELECT event_code,reason_code,session_id,tenant_id FROM identity.security_events WHERE user_id=$1", [context.userId]);
    expect(event.rows[0]).toEqual({ event_code: "PLATFORM_WEBAUTHN_ASSERTION_VERIFIED", reason_code: "BUSINESS_INITIAL_MFA", session_id: null, tenant_id: null });
    const sessions = await owner.query("SELECT count(*)::int AS count FROM identity.sessions WHERE user_id=$1", [context.userId]);
    expect(sessions.rows[0].count).toBe(0);
  });

  it("does not issue a challenge from an incorrect password or a client-provided userId", async () => {
    expect(await context.flow.begin({ email: context.email, password: "wrong", factorId: context.factorId, correlationId: uuidV7(), userId: context.userId } as never)).toBeNull();
    const rows = await owner.query("SELECT count(*)::int AS count FROM identity.webauthn_challenges WHERE user_id=$1", [context.userId]);
    expect(rows.rows[0].count).toBe(0);
    expect(await context.flow.complete({ userId: context.userId, passwordMatch: { userId: context.userId } } as never)).toBeNull();
  });

  it("requires the password again on completion; no serialized password-verified flag is trusted", async () => {
    const challenge = await begin();
    expect(await context.flow.complete({ email: context.email, password: "wrong", challenge: challenge.challenge, response: assertion(challenge.challenge) })).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("does not substitute another password-authenticated user for the challenge or factor owner", async () => {
    const challenge = await begin(); const otherId = uuidV7();
    const email = `other-${randomBytes(8).toString("hex")}@example.test`;
    await owner.query(`INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
      VALUES ($1,$2,$2,'Other fixture','ACTIVE',clock_timestamp(),clock_timestamp())`, [otherId, email]);
    await owner.query(`INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at)
      VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())`, [uuidV7(), otherId, verifier]);
    expect(await context.flow.begin({ email, password, factorId: context.factorId, correlationId: uuidV7() })).toBeNull();
    expect(await context.flow.complete({ email, password, challenge: challenge.challenge, response: assertion(challenge.challenge) })).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects replay of the same challenge even with a freshly signed higher counter", async () => {
    const challenge = await begin();
    expect(await complete(challenge.challenge)).not.toBeNull();
    expect(await complete(challenge.challenge, assertion(challenge.challenge, { counter: 2 }))).toBeNull();
    expect(await state(challenge.challengeId)).toEqual({ counter: "1", version: "2", consumed: true, events: 1 });
  });

  it("rejects an inactive factor after challenge issuance", async () => {
    const challenge = await begin();
    await owner.query("UPDATE identity.mfa_factors SET status='PENDING',verified_at=NULL WHERE id=$1", [context.factorId]);
    expect(await complete(challenge.challenge)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a revoked factor after challenge issuance", async () => {
    const challenge = await begin();
    await owner.query("UPDATE identity.mfa_factors SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1", [context.factorId]);
    expect(await complete(challenge.challenge)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("requires material resolved through the persisted factor reference", async () => {
    const challenge = await begin();
    await owner.query("UPDATE identity.mfa_factors SET secret_reference=$2 WHERE id=$1", [context.factorId, `webauthn:v1:${uuidV7()}`]);
    expect(await complete(challenge.challenge)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects an assertion for another credential", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    response.id = randomBytes(32).toString("base64url"); response.rawId = response.id;
    expect(await complete(challenge.challenge, response)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a tampered P-256 signature", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    const bytes = Buffer.from(response.response.signature, "base64url"); bytes[bytes.length - 1]! ^= 1;
    response.response.signature = bytes.toString("base64url");
    expect(await complete(challenge.challenge, response)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a correctly signed assertion for another RP", async () => {
    const challenge = await begin();
    expect(await complete(challenge.challenge, assertion(challenge.challenge, { rp: "other.example.test" }))).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a correctly signed assertion from another origin", async () => {
    const challenge = await begin();
    expect(await complete(challenge.challenge, assertion(challenge.challenge, { clientOrigin: "https://other.example.test" }))).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("requires user verification even for a valid signature and user presence", async () => {
    const challenge = await begin();
    expect(await complete(challenge.challenge, assertion(challenge.challenge, { flags: 0x01 }))).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a signature for another challenge", async () => {
    const challenge = await begin();
    expect(await complete(challenge.challenge, assertion(randomBytes(32).toString("base64url")))).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects an expired challenge without consuming it or advancing the counter", async () => {
    const challenge = await begin(makeFlow(2_000));
    await owner.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (expires_at-clock_timestamp())))::double precision+0.1) FROM identity.webauthn_challenges WHERE id=$1", [challenge.challengeId]);
    expect(await complete(challenge.challenge)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("rejects a revoked password credential after challenge issuance", async () => {
    const challenge = await begin();
    await owner.query("UPDATE identity.user_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1", [context.credentialId]);
    expect(await complete(challenge.challenge)).toBeNull();
    await unchanged(challenge.challengeId);
  });

  it("accepts exactly one concurrent completion of the same challenge", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    const results = await Promise.all([complete(challenge.challenge, response), complete(challenge.challenge, response)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await state(challenge.challengeId)).toEqual({ counter: "1", version: "2", consumed: true, events: 1 });
  });

  it("serializes two challenges for the same credential and rejects a non-advancing counter", async () => {
    const a = await begin(), b = await begin();
    const results = await Promise.all([complete(a.challenge), complete(b.challenge)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const aState = await state(a.challengeId), bState = await state(b.challengeId);
    expect([aState.consumed, bState.consumed].filter(Boolean)).toHaveLength(1);
    expect(aState.counter).toBe("1"); expect(aState.events).toBe(1);
  });

  it("rolls back counter and challenge if appending the security event fails", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try { await expect(complete(challenge.challenge, response)).rejects.toMatchObject({ code: "42501" }); }
    finally { await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app"); }
    await unchanged(challenge.challengeId);
    expect(await complete(challenge.challenge, response)).not.toBeNull();
  });

  it("rolls back when the existing CAS returns no row", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    await owner.query(`CREATE FUNCTION identity.initial_mfa_test_drop_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER initial_mfa_test_drop_update BEFORE UPDATE ON identity.webauthn_credential_material
      FOR EACH ROW EXECUTE FUNCTION identity.initial_mfa_test_drop_update()`);
    try { expect(await complete(challenge.challenge, response)).toBeNull(); }
    finally { await owner.query("DROP TRIGGER initial_mfa_test_drop_update ON identity.webauthn_credential_material; DROP FUNCTION identity.initial_mfa_test_drop_update()"); }
    await unchanged(challenge.challengeId);
    expect(await complete(challenge.challenge, response)).not.toBeNull();
  });

  it("rolls back the advanced counter when consuming the challenge fails", async () => {
    const challenge = await begin(); const response = assertion(challenge.challenge);
    await owner.query(`CREATE FUNCTION identity.initial_mfa_test_drop_consume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER initial_mfa_test_drop_consume BEFORE UPDATE ON identity.webauthn_challenges
      FOR EACH ROW EXECUTE FUNCTION identity.initial_mfa_test_drop_consume()`);
    try { await expect(complete(challenge.challenge, response)).rejects.toThrow("BUSINESS_INITIAL_MFA_CHALLENGE_EXPIRED_OR_CONSUMED"); }
    finally { await owner.query("DROP TRIGGER initial_mfa_test_drop_consume ON identity.webauthn_challenges; DROP FUNCTION identity.initial_mfa_test_drop_consume()"); }
    await unchanged(challenge.challengeId);
    expect(await complete(challenge.challenge, response)).not.toBeNull();
  });

  it("rejects GLOBAL or session-bound challenges instead of relaxing the reauthentication boundary", async () => {
    const sessionId = uuidV7();
    await owner.query(`INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,mfa_status,created_at)
      VALUES ($1,$2,clock_timestamp(),clock_timestamp()+interval '5 minutes','NOT_REQUIRED',clock_timestamp())`, [sessionId, context.userId]);
    for (const purpose of ["AUTHENTICATE", "REAUTHENTICATE", "RECOVERY_APPROVAL"] as const) {
      const challenge = await new PostgresPlatformWebAuthnChallengeRepository(runtime).issue({
        userId: context.userId, factorId: context.factorId, sessionId, purpose,
        rpId, expectedOrigin: origin, correlationId: uuidV7(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(await complete(challenge.challenge)).toBeNull();
      await unchanged(challenge.challengeId);
    }
  });

  it("hands off only committed evidence, once, within the same trusted flow instance", async () => {
    const challenge = await begin(); const receipt = await complete(challenge.challenge);
    expect(receipt).not.toBeNull();
    expect(context.flow.takeForBusinessSession({ ...receipt })).toBeNull();
    expect(context.flow.takeForBusinessSession(JSON.stringify(receipt))).toBeNull();
    expect(makeFlow().takeForBusinessSession(receipt)).toBeNull();
    expect(context.flow.takeForBusinessSession(receipt)).toMatchObject({ purpose: "BUSINESS_INITIAL_MFA", sessionId: null });
    expect(context.flow.takeForBusinessSession(receipt)).toBeNull();
  });
});
