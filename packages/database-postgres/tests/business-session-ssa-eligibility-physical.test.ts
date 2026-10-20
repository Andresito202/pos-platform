import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import {
  BUSINESS_SSA_DEVICE_PROOF_PATH, PostgresDeviceProofReplayVerifier,
  PostgresBusinessSessionSsaEligibilityRepository, PostgresBusinessSsaSequenceAllocator, uuidV7,
} from "../src/index.js";

/**
 * Opt-in physical RLS proof. ONLY a throwaway, RANDOM database is created on
 * the dedicated localhost PostgreSQL 16.14 fixture cluster (127.0.0.1:55433).
 * Does not alter cluster roles, existing databases or the production schema.
 * The role and RLS checks MUST operate as pos_platform_app, not superuser.
 *
 * These tests validate persisted eligibility, NOT user/device authentication,
 * device proof possession, SSA issuance or a live login.
 */
const SERVER_URL = process.env.POSTGRES_TEST_URL;
const TEST_DB = "pos_ssa_scope_test_" + randomBytes(8).toString("hex");
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "target-migrations", "sql", "postgres");
const ids = {
  user: uuidV7(), tenant: uuidV7(), company: uuidV7(), member: uuidV7(),
  session: uuidV7(), factor: uuidV7(), device: uuidV7(), installation: uuidV7(),
  credential: uuidV7(),
};
function dbUrl(role = "postgres"): string {
  const url = new URL(SERVER_URL!);
  url.pathname = "/" + TEST_DB;
  url.username = role;
  url.password = "";
  return url.toString();
}
function fixtureUrl(): void {
  const url = new URL(SERVER_URL!);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("SSA_PHYSICAL_PROTOCOL_INVALID");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433") {
    throw new Error("SSA_PHYSICAL_ONLY_LOCALHOST_55433");
  }
}

describe.runIf(Boolean(SERVER_URL))("business SSA session eligibility — physical PostgreSQL RLS", () => {
  let admin: Pool | undefined;
  let owner: Pool | undefined;
  let runtime: Pool | undefined;
  let created = false;
  let repository: PostgresBusinessSessionSsaEligibilityRepository;
  let allocator: PostgresBusinessSsaSequenceAllocator;
  let replayVerifier: PostgresDeviceProofReplayVerifier;
  let devicePrivateKey: KeyObject;

  beforeAll(async () => {
    fixtureUrl();
    admin = new Pool({ connectionString: SERVER_URL!, max: 2 });
    const role = await admin.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
      [["pos_schema_owner", "pos_platform_app"]],
    );
    for (const name of ["pos_schema_owner", "pos_platform_app"]) {
      if (!role.rows.some((r) => r.rolname === name)) throw new Error("SSA_PHYSICAL_ROLE_MISSING_" + name);
    }

    await admin.query('CREATE DATABASE "' + TEST_DB + '"');
    created = true;
    await admin.query('GRANT CREATE ON DATABASE "' + TEST_DB + '" TO pos_schema_owner');
    owner = new Pool({ connectionString: dbUrl(), max: 2 });
    await owner.query(await readFile(join(SQL_DIR, "bootstrap.sql"), "utf8"));
    const ddl = await owner.connect();
    try {
      await ddl.query("SET ROLE pos_schema_owner");
      await ddl.query(await readFile(join(SQL_DIR, "001_central_foundation.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "004_device_trust.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "009_webauthn_challenges.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "010_webauthn_credential_material.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "011_session_assertion_sequences.up.sql"), "utf8"));
      await ddl.query(await readFile(join(SQL_DIR, "012_device_request_proof_replays.up.sql"), "utf8"));
    } finally {
      try { await ddl.query("RESET ROLE"); } finally { ddl.release(); }
    }

    // Inspections must see physical rows even if the restricted runtime cannot.
    const inspector = await owner.query<{ effective_role: string; bypasses_rls: boolean }>(
      "SELECT current_user AS effective_role, (rolsuper OR rolbypassrls) AS bypasses_rls FROM pg_roles WHERE rolname=current_user",
    );
    if (inspector.rows[0]?.effective_role !== "postgres" || inspector.rows[0]?.bypasses_rls !== true) {
      throw new Error("SSA_PHYSICAL_INSPECTOR_INVALID");
    }

    await owner.query(
      "INSERT INTO identity.users (id,email,email_normalized,full_name,status,created_at,updated_at) VALUES ($1,$2,$2,'SSA fixture','ACTIVE',clock_timestamp(),clock_timestamp())",
      [ids.user, "ssa-" + TEST_DB + "@example.test"],
    );
    await owner.query(
      "INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES ($1,'SSA fixture tenant','ACTIVE',clock_timestamp(),clock_timestamp())",
      [ids.tenant],
    );
    await owner.query(
      "INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,'SSA fixture company','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())",
      [ids.company, ids.tenant],
    );
    await owner.query(
      "INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,'MEMBER','ACTIVE',false,'SYSTEM',clock_timestamp(),clock_timestamp())",
      [ids.member, ids.tenant, ids.user],
    );
    await owner.query(
      "INSERT INTO identity.mfa_factors (id,user_id,factor_type,status,enrolled_at,verified_at) VALUES ($1,$2,'WEBAUTHN','ACTIVE',clock_timestamp(),clock_timestamp())",
      [ids.factor, ids.user],
    );
    await owner.query(
      "INSERT INTO identity.sessions (id,user_id,tenant_id,tenant_membership_id,device_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES ($1,$2,$3,$4,NULL,clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '30 minutes',clock_timestamp()-interval '1 minute','SATISFIED',clock_timestamp()-interval '2 minutes')",
      [ids.session, ids.user, ids.tenant, ids.member],
    );
    const keys = generateKeyPairSync("ed25519");
    devicePrivateKey = keys.privateKey;
    await owner.query(
      "INSERT INTO identity.device_registry (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES ($1,$2,$3,$4,'ssa-fixture-device',$5,'Ed25519','ACTIVE','ssa-fixture-trust','DEVICE_TRUST',clock_timestamp(),clock_timestamp())",
      [ids.device, ids.installation, ids.tenant, ids.company, keys.publicKey.export({ format: "pem", type: "spki" })],
    );
    await owner.query(
      "INSERT INTO identity.device_credentials (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at) VALUES ($1,$2,$3,$4,$5,'ssa-fixture-device','ssa-fixture-trust','DEVICE_TRUST','ACTIVE',1,clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '30 minutes',$6,$7,clock_timestamp())",
      [ids.credential, ids.device, ids.installation, ids.tenant, ids.company, randomBytes(32).toString("hex"), randomBytes(64)],
    );

    // Trust-bound role, no superuser and no BYPASSRLS.
    runtime = new Pool({ connectionString: dbUrl("pos_platform_app"), max: 2 });
    const asRole = await runtime.query<{ role: string; bypasses_rls: boolean }>(
      "SELECT current_user AS role, (rolsuper OR rolbypassrls) AS bypasses_rls FROM pg_roles WHERE rolname=current_user",
    );
    if (asRole.rows[0]?.role !== "pos_platform_app" || asRole.rows[0]?.bypasses_rls !== false) {
      throw new Error("SSA_PHYSICAL_RUNTIME_ROLE_INVALID");
    }
    repository = new PostgresBusinessSessionSsaEligibilityRepository(runtime, 5 * 60 * 1000);
    allocator = new PostgresBusinessSsaSequenceAllocator(runtime, 5 * 60 * 1000);
    replayVerifier = new PostgresDeviceProofReplayVerifier(runtime);
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    if (created) await admin?.query('DROP DATABASE "' + TEST_DB + '" WITH (FORCE)');
    await admin?.end();
  }, 120_000);

  function request() {
    return { sessionId: ids.session, deviceId: ids.device, installationId: ids.installation };
  }

  it("physically enforces FORCE RLS but resolves server-derived tenant in a read-only transaction", async () => {
    const policies = await owner!.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ANY(ARRAY['tenancy.tenants'::regclass,'tenancy.tenant_memberships'::regclass,'organization.companies'::regclass]) ORDER BY relname",
    );
    expect(policies.rows).toHaveLength(3);
    expect(policies.rows.every((x: { relrowsecurity: boolean; relforcerowsecurity: boolean }) => x.relrowsecurity && x.relforcerowsecurity)).toBe(true);

    const before = await runtime!.query<{ count: string }>("SELECT count(*)::text AS count FROM tenancy.tenants WHERE id=$1", [ids.tenant]);
    expect(before.rows[0]?.count).toBe("0");

    const result = await repository.findCandidate(request());
    expect(result).toMatchObject({
      sessionId: ids.session, userId: ids.user, tenantId: ids.tenant,
      tenantMembershipId: ids.member, companyId: ids.company,
      deviceId: ids.device, installationId: ids.installation,
    });
    const after = await runtime!.query<{ count: string }>("SELECT count(*)::text AS count FROM tenancy.tenants WHERE id=$1", [ids.tenant]);
    expect(after.rows[0]?.count).toBe("0");
  });

  it("physically rejects a mismatched device or installation", async () => {
    expect(await repository.findCandidate({ ...request(), deviceId: uuidV7() })).toBeNull();
    expect(await repository.findCandidate({ ...request(), installationId: uuidV7() })).toBeNull();
  });

  it("physically rejects a revoked or expired device credential", async () => {
    await owner!.query("UPDATE identity.device_credentials SET status='REVOKED', revoked_at=clock_timestamp() WHERE credential_id=$1", [ids.credential]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.device_credentials SET status='ACTIVE', revoked_at=NULL WHERE credential_id=$1", [ids.credential]);
    }
    await owner!.query("UPDATE identity.device_credentials SET expires_at=clock_timestamp()-interval '1 second' WHERE credential_id=$1", [ids.credential]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.device_credentials SET expires_at=clock_timestamp()+interval '30 minutes' WHERE credential_id=$1", [ids.credential]);
    }
  });

  it("physically rejects a suspended membership or tenant", async () => {
    await owner!.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED', suspended_at=clock_timestamp() WHERE id=$1", [ids.member]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE tenancy.tenant_memberships SET status='ACTIVE', suspended_at=NULL WHERE id=$1", [ids.member]);
    }
    await owner!.query("UPDATE tenancy.tenants SET status='SUSPENDED' WHERE id=$1", [ids.tenant]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE tenancy.tenants SET status='ACTIVE' WHERE id=$1", [ids.tenant]);
    }
  });

  it("physically rejects revoked sessions and unverified MFA", async () => {
    await owner!.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='SSA fixture test',version=version+1 WHERE id=$1", [ids.session]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.sessions SET revoked_at=NULL,revoked_by_actor_type=NULL,revocation_reason=NULL,version=version+1 WHERE id=$1", [ids.session]);
    }
    await owner!.query("UPDATE identity.sessions SET mfa_status='PENDING',version=version+1 WHERE id=$1", [ids.session]);
    try {
      expect(await repository.findCandidate(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.sessions SET mfa_status='SATISFIED',version=version+1 WHERE id=$1", [ids.session]);
    }
  });

  it("physically reserves monotonic concurrent SSA sequences under pos_platform_app and FORCE RLS", async () => {
    const policy = await owner!.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='identity.session_assertion_sequences'::regclass",
    );
    expect(policy.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const first = await allocator.reserveForVerifiedProof(request());
    expect(first?.sequence).toBe(1);
    expect(first?.eligibleScope).toMatchObject({ sessionId: ids.session, userId: ids.user, tenantId: ids.tenant });

    const results = await Promise.all(Array.from({ length: 6 }, () => allocator.reserveForVerifiedProof(request())));
    expect(results.map((v) => v?.sequence).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 3, 4, 5, 6, 7]);
    const persisted = await owner!.query<{ last_issued_sequence: string }>(
      "SELECT last_issued_sequence::text FROM identity.session_assertion_sequences WHERE user_id=$1 AND installation_id=$2 AND device_id=$3",
      [ids.user, ids.installation, ids.device],
    );
    expect(persisted.rows).toEqual([{ last_issued_sequence: "7" }]);
    // A checked-out connection cannot inherit the tenant context from reserve.
    const scoped = await runtime!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM tenancy.tenants WHERE id=$1", [ids.tenant],
    );
    expect(scoped.rows[0]?.count).toBe("0");
  });

  it("persists SSA watermark across a newly created session for the same binding", async () => {
    const newSession = uuidV7();
    await owner!.query(
      "INSERT INTO identity.sessions (id,user_id,tenant_id,tenant_membership_id,device_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES ($1,$2,$3,$4,NULL,clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '30 minutes',clock_timestamp()-interval '30 seconds','SATISFIED',clock_timestamp()-interval '30 seconds')",
      [newSession, ids.user, ids.tenant, ids.member],
    );
    const res = await allocator.reserveForVerifiedProof({ ...request(), sessionId: newSession });
    expect(res?.sequence).toBe(8);
    expect(res?.eligibleScope.sessionId).toBe(newSession);
  });

  it("physically refuses reservation on revoked session or MFA and preserves watermark", async () => {
    await owner!.query("UPDATE identity.sessions SET mfa_status='PENDING',version=version+1 WHERE id=$1", [ids.session]);
    try {
      expect(await allocator.reserveForVerifiedProof(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.sessions SET mfa_status='SATISFIED',version=version+1 WHERE id=$1", [ids.session]);
    }
    await owner!.query("UPDATE identity.mfa_factors SET status='REVOKED',revoked_at=clock_timestamp(),version=version+1 WHERE id=$1", [ids.factor]);
    try {
      expect(await allocator.reserveForVerifiedProof(request())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.mfa_factors SET status='ACTIVE',revoked_at=NULL,version=version+1 WHERE id=$1", [ids.factor]);
    }
    const persisted = await owner!.query<{ seq: string }>(
      "SELECT last_issued_sequence::text AS seq FROM identity.session_assertion_sequences WHERE user_id=$1 AND installation_id=$2 AND device_id=$3",
      [ids.user, ids.installation, ids.device],
    );
    expect(persisted.rows).toEqual([{ seq: "8" }]);
  });

  it("forbids watermark rewinds or deletes and rejects destructive rollback", async () => {
    await expect(owner!.query(
      "UPDATE identity.session_assertion_sequences SET last_issued_sequence=1 WHERE user_id=$1 AND installation_id=$2 AND device_id=$3",
      [ids.user, ids.installation, ids.device],
    )).rejects.toThrow();
    await expect(owner!.query(
      "DELETE FROM identity.session_assertion_sequences WHERE user_id=$1 AND installation_id=$2 AND device_id=$3",
      [ids.user, ids.installation, ids.device],
    )).rejects.toThrow();
    await expect(owner!.query(await readFile(join(SQL_DIR, "011_session_assertion_sequences.down.sql"), "utf8"))).rejects.toThrow("011 rollback refused");
    const persisted = await owner!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM identity.session_assertion_sequences WHERE user_id=$1",
      [ids.user],
    );
    expect(persisted.rows).toEqual([{ count: "1" }]);
  });

  function signedDeviceRequest(requestId = uuidV7(), body = '{"request":"ssa"}') {
    const correlationId = uuidV7();
    const authorization = createDeviceRequestAuthorization({
      method: "POST",
      path: BUSINESS_SSA_DEVICE_PROOF_PATH,
      requestId, correlationId, credentialId: ids.credential, body,
    }, devicePrivateKey);
    return { authorization, requestId, correlationId, body };
  }

  it("physically verifies an Ed25519 device proof under central role then rejects its replay", async () => {
    const policy = await owner!.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='identity.device_request_proof_replays'::regclass",
    );
    expect(policy.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const input = signedDeviceRequest();
    const first = await replayVerifier.verifyAndConsume(input);
    expect(first).toMatchObject({
      credentialId: ids.credential,
      deviceId: ids.device,
      installationId: ids.installation,
      tenantId: ids.tenant,
      companyId: ids.company,
    });
    expect(await replayVerifier.verifyAndConsume(input)).toBeNull();
    const count = await owner!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM identity.device_request_proof_replays WHERE credential_id=$1", [ids.credential],
    );
    expect(count.rows).toEqual([{ n: "1" }]);
  });

  it("physically consumes the same proof exactly once across concurrent workers", async () => {
    const input = signedDeviceRequest();
    const results = await Promise.all(Array.from({ length: 5 }, () => replayVerifier.verifyAndConsume(input)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(x => x === null)).toHaveLength(4);
    const rows = await owner!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM identity.device_request_proof_replays WHERE credential_id=$1", [ids.credential],
    );
    expect(rows.rows).toEqual([{ n: "2" }]);
    // A separately signed nonce may not reuse the same signed request ID.
    expect(await replayVerifier.verifyAndConsume(signedDeviceRequest(input.requestId))).toBeNull();
    const after = await owner!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM identity.device_request_proof_replays WHERE credential_id=$1", [ids.credential],
    );
    expect(after.rows).toEqual([{ n: "2" }]);
  });

  it("physically rejects tampered body, forged device key and revoked credential before storing proof", async () => {
    const input = signedDeviceRequest();
    expect(await replayVerifier.verifyAndConsume({ ...input, body: '{"request":"revoke"}' })).toBeNull();
    const forged = createDeviceRequestAuthorization({
      method: "POST", path: BUSINESS_SSA_DEVICE_PROOF_PATH,
      requestId: input.requestId, correlationId: input.correlationId, credentialId: ids.credential,
      body: input.body,
    }, generateKeyPairSync("ed25519").privateKey);
    expect(await replayVerifier.verifyAndConsume({
      authorization: forged, requestId: input.requestId, correlationId: input.correlationId, body: input.body,
    })).toBeNull();
    await owner!.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE credential_id=$1", [ids.credential]);
    try {
      expect(await replayVerifier.verifyAndConsume(signedDeviceRequest())).toBeNull();
    } finally {
      await owner!.query("UPDATE identity.device_credentials SET status='ACTIVE',revoked_at=NULL WHERE credential_id=$1", [ids.credential]);
    }
    const count = await owner!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM identity.device_request_proof_replays WHERE credential_id=$1", [ids.credential],
    );
    expect(count.rows).toEqual([{ n: "2" }]);
  });

  it("physically prevents deleting proof history or destructive migration 012 rollback", async () => {
    await expect(owner!.query(
      "DELETE FROM identity.device_request_proof_replays WHERE credential_id=$1", [ids.credential],
    )).rejects.toThrow();
    await expect(owner!.query(
      "UPDATE identity.device_request_proof_replays SET consumed_at=clock_timestamp() WHERE credential_id=$1", [ids.credential],
    )).rejects.toThrow();
    await expect(owner!.query(await readFile(join(SQL_DIR, "012_device_request_proof_replays.down.sql"), "utf8")))
      .rejects.toThrow("012 rollback refused");
  });

});
