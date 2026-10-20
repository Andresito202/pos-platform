import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBusinessSessionSsaEligibilityRepository, uuidV7 } from "../src/index.js";

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
});
