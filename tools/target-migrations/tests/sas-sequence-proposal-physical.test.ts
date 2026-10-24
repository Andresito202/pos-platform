import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POSTGRES_MIGRATION_LOCK_RESOURCE, uuidV7 } from "../src/shared.js";

const serverUrl = process.env.POSTGRES_TEST_URL;
const databaseName = `pos_business_session_test_${randomBytes(8).toString("hex")}`;
const root = new URL("../sql/postgres/", import.meta.url);
const migrationId = "sas_sequence_proposal_rehearsal";
const table = '"authorization".snapshot_sequences';

describe.runIf(Boolean(serverUrl))("SAS proposal — disposable PostgreSQL", () => {
  let admin: Pool, owner: Pool, runtime: Pool;
  let created = false, up: string, down: string;
  let userId: string, deviceId: string, installationId: string;

  // Rehearse the existing checksum/advisory-lock/ledger convention, not a new
  // deployer. No CLI, production descriptor or automatic startup migration.
  async function applyProposal(body = up, fail = false): Promise<boolean> {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE pos_schema_owner");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
      const checksum = createHash("sha256").update(body).digest();
      const prior = await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED'", [migrationId]);
      if (prior.rows[0]) {
        if (!Buffer.from(prior.rows[0].checksum).equals(checksum)) throw Error("PROPOSAL_CHECKSUM_MISMATCH");
        await c.query("COMMIT");
        return false;
      }
      await c.query(body);
      if (fail) throw Error("INJECTED_AUDIT_FAILURE");
      await c.query(`INSERT INTO platform.target_migration_executions
        (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,
         body_committed_at,smoke_verified_at,applied_at,finished_at,runner_version)
        VALUES($1,$2,'POSTGRESQL',1,$3,'APPLIED',clock_timestamp(),clock_timestamp(),
          clock_timestamp(),clock_timestamp(),clock_timestamp(),'proposal-rehearsal-only')`, [uuidV7(), migrationId, checksum]);
      await c.query("COMMIT");
      return true;
    } catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }

  beforeAll(async () => {
    const url = new URL(serverUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "55433") {
      throw Error("PROPOSAL_REQUIRES_LOCALHOST_55433");
    }
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    await admin.query(`GRANT CREATE ON DATABASE "${databaseName}" TO pos_schema_owner`);
    url.pathname = `/${databaseName}`;
    owner = new Pool({ connectionString: url.toString(), max: 3 });
    await owner.query(await readFile(new URL("bootstrap.sql", root), "utf8"));
    const c = await owner.connect();
    try {
      await c.query("SET ROLE pos_schema_owner");
      for (const file of ["001_central_foundation.up.sql", "004_device_trust.up.sql"]) {
        await c.query(await readFile(new URL(file, root), "utf8"));
      }
    } finally { await c.query("RESET ROLE"); c.release(); }
    up = await readFile(new URL("proposals/sas_sequences.up.sql", root), "utf8");
    down = await readFile(new URL("proposals/sas_sequences.down.sql", root), "utf8");
    url.username = "pos_platform_app"; url.password = "";
    runtime = new Pool({ connectionString: url.toString(), max: 6 });
    userId = uuidV7(); deviceId = uuidV7(); installationId = uuidV7();
    const tenant = uuidV7(), company = uuidV7();
    await owner.query(`INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
      VALUES($1,'sas@example.test','sas@example.test','Proposal fixture','ACTIVE',clock_timestamp(),clock_timestamp())`, [userId]);
    await owner.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Proposal','ACTIVE',clock_timestamp(),clock_timestamp())", [tenant]);
    await owner.query(`INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)
      VALUES($1,$2,'Proposal','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())`, [company, tenant]);
    // Registry metadata only; not enrollment, a credential, a key or a session.
    await owner.query(`INSERT INTO identity.device_registry(device_id,installation_id,tenant_id,company_id,
      device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
      VALUES($1,$2,$3,$4,'proposal-device','fixture-not-used-for-verification','Ed25519','ACTIVE',
        'proposal-root','DEVICE_TRUST',clock_timestamp(),clock_timestamp())`, [deviceId, installationId, tenant, company]);
  });

  afterAll(async () => {
    await runtime?.end(); await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  });

  async function reserve() {
    const result = await runtime.query(`INSERT INTO ${table}
      (user_id,installation_id,device_id,last_issued_sequence,snapshot_id,source_checksum)
      VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(user_id,installation_id,device_id)
      DO UPDATE SET last_issued_sequence=${table}.last_issued_sequence+1,
        snapshot_id=excluded.snapshot_id,source_checksum=excluded.source_checksum,updated_at=clock_timestamp()
      RETURNING last_issued_sequence`, [userId, installationId, deviceId, uuidV7(), "a".repeat(64)]);
    return Number(result.rows[0].last_issued_sequence);
  }

  it("rolls back DDL and ledger together on failure; retries and repeated apply are safe", async () => {
    await expect(applyProposal(up, true)).rejects.toThrow("INJECTED_AUDIT_FAILURE");
    expect((await owner.query(`SELECT to_regclass('${table}') AS relation`)).rows[0].relation).toBeNull();
    expect(await applyProposal()).toBe(true);
    expect(await applyProposal()).toBe(false);
    await expect(applyProposal(up + "\n-- drift")).rejects.toThrow("PROPOSAL_CHECKSUM_MISMATCH");
  });

  it("empty down is reversible and a subsequent up reconstructs the same schema", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL ROLE pos_schema_owner");
      await c.query(down); await c.query(up); await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
    expect((await owner.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
  });

  it("serializes concurrent reservations without duplicate sequence values", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve()));
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("counter advance rolls back with an audit failure", async () => {
    await owner.query(`CREATE FUNCTION identity.reject_sas_proposal_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_AUDIT_FAILURE'; END; $$;
      CREATE TRIGGER reject_sas_proposal_audit BEFORE INSERT ON identity.security_events
        FOR EACH ROW EXECUTE FUNCTION identity.reject_sas_proposal_audit()`);
    const c = await runtime.connect();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE ${table} SET last_issued_sequence=last_issued_sequence+1,snapshot_id=$1,updated_at=clock_timestamp()`, [uuidV7()]);
      await expect(c.query(`INSERT INTO identity.security_events
        (id,user_id,session_id,tenant_id,event_code,result,reason_code,correlation_id,occurred_at,server_recorded_at)
        VALUES($1,$2,NULL,NULL,'AUTHORIZATION_SNAPSHOT_ISSUED','SUCCEEDED','PROPOSAL_ONLY',$3,clock_timestamp(),clock_timestamp())`,
      [uuidV7(), userId, uuidV7()])).rejects.toThrow("INJECTED_AUDIT_FAILURE");
      await c.query("ROLLBACK");
    } finally {
      await c.query("ROLLBACK"); c.release();
      await owner.query("DROP TRIGGER reject_sas_proposal_audit ON identity.security_events; DROP FUNCTION identity.reject_sas_proposal_audit()");
    }
    expect((await owner.query("SELECT count(*) FROM identity.security_events")).rows[0].count).toBe("0");
    expect(await reserve()).toBe(13);
  });

  it("rejects replay, jumps, mutable binding, deletion and destructive rollback", async () => {
    for (const sql of [
      `UPDATE ${table} SET last_issued_sequence=last_issued_sequence`,
      `UPDATE ${table} SET last_issued_sequence=last_issued_sequence+2,snapshot_id='${uuidV7()}'`,
      `UPDATE ${table} SET installation_id='${uuidV7()}'`,
      `DELETE FROM ${table}`,
    ]) await expect(runtime.query(sql)).rejects.toThrow();
    await expect(owner.query(`UPDATE ${table} SET installation_id='${uuidV7()}'`))
      .rejects.toThrow("SAS requires exact +1 and immutable binding");
    await expect(owner.query(`DELETE FROM ${table}`)).rejects.toThrow("SAS watermark cannot be deleted");
    await expect(owner.query(down)).rejects.toThrow("SAS rollback refused: watermarks exist");
    expect((await runtime.query(`SELECT last_issued_sequence FROM ${table}`)).rows[0].last_issued_sequence).toBe("13");
  });

  it("rejects an installation not linked to the device and invalid source checksums", async () => {
    const insert = `INSERT INTO ${table}(user_id,installation_id,device_id,last_issued_sequence,snapshot_id,source_checksum) VALUES($1,$2,$3,1,$4,$5)`;
    await expect(runtime.query(insert, [userId, uuidV7(), deviceId, uuidV7(), "b".repeat(64)]))
      .rejects.toThrow("SAS installation/device mismatch");
    await expect(runtime.query(insert, [userId, installationId, deviceId, uuidV7(), "x".repeat(64)]))
      .rejects.toThrow();
  });

  it("forces RLS, excludes local roles and adds no write authority over RBAC sources", async () => {
    const rls = (await owner.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='${table}'::regclass`)).rows[0];
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ["pos_app", "pos_worker", "pos_platform_admin"]) {
      expect((await owner.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed", [role, table])).rows[0].allowed).toBe(false);
    }
    for (const source of ["roles", "permissions", "role_permission_grants"]) {
      const relation = `"authorization".${source}`;
      expect((await runtime.query("SELECT has_any_column_privilege(current_user,$1,'UPDATE') AS allowed", [relation])).rows[0].allowed).toBe(false);
      await expect(runtime.query(`SELECT id FROM ${relation} FOR SHARE`)).rejects.toThrow(/permission denied/);
    }
  });

  it("retains the watermark across connection restart and cannot reset it by reapplying", async () => {
    const c = await runtime.connect(); await c.query("DISCARD ALL"); c.release(true);
    expect(await applyProposal()).toBe(false);
    expect(await reserve()).toBe(14);
  });

  it("SQL refuses a disposable database outside the guarded rehearsal namespace before DDL", async () => {
    const rejectedName = `pos_sas_proposal_rejection_${randomBytes(8).toString("hex")}`;
    const url = new URL(serverUrl!); url.pathname = `/${rejectedName}`;
    await admin.query(`CREATE DATABASE "${rejectedName}"`);
    const rejected = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      await expect(rejected.query(up)).rejects.toThrow("SAS proposal requires disposable database");
      expect((await rejected.query("SELECT to_regnamespace('authorization') AS schema")).rows[0].schema).toBeNull();
    } finally { await rejected.end(); await admin.query(`DROP DATABASE "${rejectedName}"`); }
  });
});
