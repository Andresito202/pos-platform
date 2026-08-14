import assert from "node:assert/strict";
import { sql } from "kysely";
import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";

const IDS = {
  userA: "018f0000-0000-7000-8000-000000000001",
  userB: "018f0000-0000-7000-8000-000000000002",
  userC: "018f0000-0000-7000-8000-000000000003",
  tenantA: "018f0000-0000-7000-8000-000000000011",
  tenantB: "018f0000-0000-7000-8000-000000000012",
  companyA: "018f0000-0000-7000-8000-000000000021",
  companyB: "018f0000-0000-7000-8000-000000000022",
  branchA: "018f0000-0000-7000-8000-000000000031",
  branchB: "018f0000-0000-7000-8000-000000000032",
  membershipA: "018f0000-0000-7000-8000-000000000041",
  membershipB: "018f0000-0000-7000-8000-000000000042",
  membershipAdmin: "018f0000-0000-7000-8000-000000000043",
  sessionA: "018f0000-0000-7000-8000-000000000051",
  sessionB: "018f0000-0000-7000-8000-000000000052",
  sessionPre: "018f0000-0000-7000-8000-000000000053",
  operationA: "018f0000-0000-7000-8000-000000000061",
  aggregateA: "018f0000-0000-7000-8000-000000000062",
  correlation: "018f0000-0000-7000-8000-000000000071",
  audit: "018f0000-0000-7000-8000-000000000081",
  audit2: "018f0000-0000-7000-8000-000000000082",
  audit3: "018f0000-0000-7000-8000-000000000083",
  onboarding: "018f0000-0000-7000-8000-000000000091",
  onboarding2: "018f0000-0000-7000-8000-000000000092",
  onboarding3: "018f0000-0000-7000-8000-000000000093",
  tenantAttempt: "018f0000-0000-7000-8000-000000000099",
} as const;

function roleUrl(adminUrl: string, role: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

async function expectRejected(action: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, message);
}

async function withRoleTransaction(
  adminUrl: string,
  role: string,
  tenantId: string | null,
  action: (db: SqlExecutor) => Promise<void>,
): Promise<void> {
  const database = postgresDatabase(roleUrl(adminUrl, role), 1);
  try {
    await database.transaction().execute(async (transaction) => {
      if (tenantId !== null) await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`.execute(transaction);
      await action(transaction);
      throw new Error("ROLLBACK_SMOKE_TRANSACTION");
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "ROLLBACK_SMOKE_TRANSACTION") throw error;
    });
  } finally {
    await database.destroy();
  }
}

async function createFixtures(admin: SqlExecutor): Promise<void> {
  await executeRaw(admin, `
    INSERT INTO identity.users (id,email,email_normalized,full_name,status,created_at,updated_at)
    VALUES
      ('${IDS.userA}','a@example.test','a@example.test','Tenant A','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.userB}','b@example.test','b@example.test','Tenant B','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.userC}','c@example.test','c@example.test','Tenant A Admin','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at)
    VALUES
      ('${IDS.tenantA}','Tenant A','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.tenantB}','Tenant B','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)
    VALUES
      ('${IDS.companyA}','${IDS.tenantA}','Company A','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.companyB}','${IDS.tenantB}','Company B','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO organization.branches (id,tenant_id,company_id,name,timezone,status,created_at,updated_at)
    VALUES
      ('${IDS.branchA}','${IDS.tenantA}','${IDS.companyA}','Branch A','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.branchB}','${IDS.tenantB}','${IDS.companyB}','Branch B','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_at,activated_at)
    VALUES
      ('${IDS.membershipA}','${IDS.tenantA}','${IDS.userA}','OWNER','ACTIVE',true,'SYSTEM',clock_timestamp(),clock_timestamp()),
      ('${IDS.membershipB}','${IDS.tenantB}','${IDS.userB}','OWNER','ACTIVE',true,'SYSTEM',clock_timestamp(),clock_timestamp()),
      ('${IDS.membershipAdmin}','${IDS.tenantA}','${IDS.userC}','ADMIN','ACTIVE',false,'SYSTEM',clock_timestamp(),clock_timestamp());
    INSERT INTO identity.sessions (id,user_id,tenant_id,tenant_membership_id,authenticated_at,expires_at,mfa_status,created_at)
    VALUES
      ('${IDS.sessionA}','${IDS.userA}','${IDS.tenantA}','${IDS.membershipA}',clock_timestamp(),clock_timestamp()+interval '1 hour','SATISFIED',clock_timestamp()),
      ('${IDS.sessionB}','${IDS.userB}','${IDS.tenantB}','${IDS.membershipB}',clock_timestamp(),clock_timestamp()+interval '1 hour','SATISFIED',clock_timestamp()),
      ('${IDS.sessionPre}','${IDS.userA}',NULL,NULL,clock_timestamp(),clock_timestamp()+interval '1 hour','PENDING',clock_timestamp());
    INSERT INTO sync.sync_operations (
      id,tenant_id,source_kind,actor_type,aggregate_type,aggregate_id,operation_type,idempotency_key,
      authority_policy,correlation_id,schema_version,payload,payload_checksum,sync_status,received_at_server,committed_at_server
    ) VALUES (
      '${IDS.operationA}','${IDS.tenantA}','CENTRAL_SERVICE','SYSTEM','SMOKE','${IDS.aggregateA}','SMOKE_CREATED','smoke-operation',
      'SERVER_AUTHORITATIVE','${IDS.correlation}',1,'{}',decode(repeat('01',32),'hex'),'SERVER_ACCEPTED',clock_timestamp(),clock_timestamp()
    );
  `);
}

async function removeFixtures(admin: SqlExecutor): Promise<void> {
  await executeRaw(admin, `
    DELETE FROM sync.outbox_entries WHERE operation_id = '${IDS.operationA}';
    DELETE FROM sync.sync_operations WHERE id = '${IDS.operationA}';
    DELETE FROM tenancy.onboarding_operations WHERE id IN ('${IDS.onboarding}','${IDS.onboarding2}','${IDS.onboarding3}');
    DELETE FROM identity.sessions WHERE id IN ('${IDS.sessionA}','${IDS.sessionB}','${IDS.sessionPre}');
    DELETE FROM tenancy.tenant_memberships WHERE id IN ('${IDS.membershipA}','${IDS.membershipB}','${IDS.membershipAdmin}');
    DELETE FROM organization.branches WHERE id IN ('${IDS.branchA}','${IDS.branchB}');
    DELETE FROM organization.companies WHERE id IN ('${IDS.companyA}','${IDS.companyB}');
    DELETE FROM tenancy.tenants WHERE id IN ('${IDS.tenantA}','${IDS.tenantB}','${IDS.tenantAttempt}');
    DELETE FROM identity.users WHERE id IN ('${IDS.userA}','${IDS.userB}','${IDS.userC}');
  `);
}

export async function runPostgresSmoke(adminUrl: string): Promise<number> {
  const admin = postgresDatabase(adminUrl, 1);
  let assertions = 0;
  try {
    await removeFixtures(admin);
    await createFixtures(admin);

    await withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => {
      const tenants = await queryRows<{ id: string }>(db, "SELECT id::text FROM tenancy.tenants ORDER BY id");
      assert.deepEqual(tenants.map((row) => row.id), [IDS.tenantA]); assertions += 1;
      const sessions = await queryRows<{ id: string }>(db, "SELECT id::text FROM identity.sessions ORDER BY id");
      assert.deepEqual(sessions.map((row) => row.id), [IDS.sessionA]); assertions += 1;
    });

    await withRoleTransaction(adminUrl, "pos_app", null, async (db) => {
      const rows = await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM tenancy.tenants");
      assert.equal(rows[0]!.count, "0"); assertions += 1;
    });

    await withRoleTransaction(adminUrl, "pos_app", "invalid-tenant", async (db) => {
      const rows = await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM tenancy.tenants");
      assert.equal(rows[0]!.count, "0"); assertions += 1;
    });

    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_platform_app", IDS.tenantA, async (db) => {
        await sql`INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES (${IDS.tenantAttempt}::uuid,'Wrong tenant','ACTIVE',clock_timestamp(),clock_timestamp())`.execute(db);
      }),
      "tenant A inserted tenant B",
    ); assertions += 1;

    await withRoleTransaction(adminUrl, "pos_platform_app", IDS.tenantA, async (db) => {
      const result = await sql`UPDATE tenancy.tenants SET name = 'cross' WHERE id = ${IDS.tenantB}::uuid`.execute(db);
      assert.equal(Number(result.numAffectedRows), 0); assertions += 1;
    });

    await withRoleTransaction(adminUrl, "pos_platform_app", null, async (db) => {
      const rows = await queryRows<{ id: string }>(db, "SELECT id::text FROM identity.sessions ORDER BY id");
      assert.equal(rows.length, 3); assertions += 1;
    });

    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_worker", IDS.tenantA, async (db) => { await queryRows(db, "SELECT id FROM identity.sessions"); }),
      "worker read Session",
    ); assertions += 1;

    await withRoleTransaction(adminUrl, "pos_platform_admin", null, async (db) => {
      const rows = await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM identity.sessions");
      assert.equal(rows[0]!.count, "3"); assertions += 1;
    });
    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_platform_admin", null, async (db) => { await executeRaw(db, `UPDATE identity.sessions SET version = version + 1 WHERE id = '${IDS.sessionA}'`); }),
      "admin updated Session",
    ); assertions += 1;

    await withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => {
      await executeRaw(db, `INSERT INTO audit.audit_events (id,tenant_id,actor_type,action_code,resource_type,resource_reference_kind,resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,payload_checksum) VALUES ('${IDS.audit}','${IDS.tenantA}','SYSTEM','SMOKE','User','INSTANCE','${IDS.userA}','${IDS.correlation}',1,clock_timestamp(),clock_timestamp(),'SUCCESS',repeat('a',64))`);
      assertions += 1;
    });
    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => { await executeRaw(db, `INSERT INTO audit.audit_events (id,tenant_id,actor_type,action_code,resource_type,resource_reference_kind,correlation_id,schema_version,reported_at,server_recorded_at,result,payload_checksum) VALUES ('${IDS.audit}','${IDS.tenantA}','SYSTEM','SMOKE','User','INSTANCE','${IDS.correlation}',1,clock_timestamp(),clock_timestamp(),'SUCCESS',repeat('a',64))`); }),
      "Audit INSTANCE without resource_id",
    ); assertions += 1;
    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => { await executeRaw(db, `INSERT INTO audit.audit_events (id,tenant_id,actor_type,action_code,resource_type,resource_reference_kind,resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,payload_checksum) VALUES ('${IDS.audit2}','${IDS.tenantA}','SYSTEM','SMOKE','System','SYSTEM','${IDS.userA}','${IDS.correlation}',1,clock_timestamp(),clock_timestamp(),'SUCCESS',repeat('a',64))`); }),
      "Audit SYSTEM with resource_id",
    ); assertions += 1;
    await expectRejected(
      () => withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => { await executeRaw(db, `INSERT INTO audit.audit_events (id,tenant_id,actor_type,action_code,resource_type,resource_reference_kind,correlation_id,schema_version,reported_at,server_recorded_at,result,payload_checksum) VALUES ('${IDS.audit3}','${IDS.tenantA}','SYSTEM','SMOKE','Batch','BATCH','${IDS.correlation}',1,clock_timestamp(),clock_timestamp(),'SUCCESS',repeat('a',64))`); }),
      "Audit BATCH without operation_id",
    ); assertions += 1;

    for (const statement of [
      "UPDATE audit.audit_events SET result = 'CHANGED'",
      "DELETE FROM audit.audit_events",
      "TRUNCATE audit.audit_events",
    ]) {
      await expectRejected(
        () => withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => { await executeRaw(db, statement); }),
        `Audit mutation allowed: ${statement}`,
      ); assertions += 1;
    }

    const onboardingBase = (id: string, tenant: string, company: string, branch: string, user: string, membership: string) => `
      INSERT INTO tenancy.onboarding_operations (
        id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,tenant_id,company_id,branch_id,
        owner_user_id,tenant_membership_id,status,created_at,updated_at
      ) VALUES ('${id}','USER','${IDS.userA}','${id}',repeat('a',64),'${IDS.correlation}','${tenant}','${company}','${branch}','${user}','${membership}','READY_FOR_LICENSE',clock_timestamp(),clock_timestamp())`;
    await expectRejected(() => withRoleTransaction(adminUrl, "pos_platform_app", IDS.tenantB, async (db) => {
      await executeRaw(db, onboardingBase(IDS.onboarding, IDS.tenantB, IDS.companyB, IDS.branchB, IDS.userA, IDS.membershipA));
    }), "onboarding accepted wrong tenant membership"); assertions += 1;
    await expectRejected(() => withRoleTransaction(adminUrl, "pos_platform_app", IDS.tenantA, async (db) => {
      await executeRaw(db, onboardingBase(IDS.onboarding2, IDS.tenantA, IDS.companyA, IDS.branchA, IDS.userB, IDS.membershipA));
    }), "onboarding accepted wrong owner user"); assertions += 1;
    await expectRejected(() => withRoleTransaction(adminUrl, "pos_platform_app", IDS.tenantA, async (db) => {
      await executeRaw(db, onboardingBase(IDS.onboarding3, IDS.tenantA, IDS.companyA, IDS.branchA, IDS.userC, IDS.membershipAdmin));
    }), "onboarding accepted non-OWNER membership"); assertions += 1;

    await withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => {
      await executeRaw(db, `INSERT INTO sync.outbox_entries (id,tenant_id,operation_id,operation_type,schema_version,payload_checksum,correlation_id,sync_status,created_at,available_at,updated_at) VALUES ('${IDS.audit}','${IDS.tenantA}','${IDS.operationA}','SMOKE_CREATED',1,decode(repeat('01',32),'hex'),'${IDS.correlation}','SERVER_ACCEPTED',clock_timestamp(),clock_timestamp(),clock_timestamp())`);
      assertions += 1;
    });
    await expectRejected(() => withRoleTransaction(adminUrl, "pos_app", IDS.tenantA, async (db) => {
      await executeRaw(db, `INSERT INTO sync.outbox_entries (id,tenant_id,operation_id,operation_type,schema_version,payload_checksum,correlation_id,sync_status,created_at,available_at,updated_at) VALUES ('${IDS.audit2}','${IDS.tenantA}','${IDS.operationA}','WRONG',1,decode(repeat('01',32),'hex'),'${IDS.correlation}','SERVER_ACCEPTED',clock_timestamp(),clock_timestamp(),clock_timestamp())`);
    }), "Outbox metadata mismatch accepted"); assertions += 1;

    return assertions;
  } finally {
    await removeFixtures(admin).catch(() => undefined);
    await admin.destroy();
  }
}
