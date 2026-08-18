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

const IDS002 = {
  providerA: "018f1000-0000-7000-8000-000000000001",
  providerB: "018f1000-0000-7000-8000-000000000002",
  adapterA: "018f1000-0000-7000-8000-000000000003",
  declaration: "018f1000-0000-7000-8000-000000000004",
  integrationA: "018f1000-0000-7000-8000-000000000005",
  capability: "018f1000-0000-7000-8000-000000000006",
  bindingA: "018f1000-0000-7000-8000-000000000007",
  dispatchA: "018f1000-0000-7000-8000-000000000008",
  attemptA: "018f1000-0000-7000-8000-000000000009",
  webhookA: "018f1000-0000-7000-8000-00000000000a",
  rateA: "018f1000-0000-7000-8000-00000000000b",
  evidenceA: "018f1000-0000-7000-8000-00000000000c",
  operation: "018f1000-0000-7000-8000-00000000000d",
  entity: "018f1000-0000-7000-8000-00000000000e",
  correlation: "018f1000-0000-7000-8000-00000000000f",
  mappingA: "018f1000-0000-7000-8000-000000000010",
  mappingB: "018f1000-0000-7000-8000-000000000011",
  bindingB: "018f1000-0000-7000-8000-000000000012",
  configA: "018f1000-0000-7000-8000-000000000013",
} as const;

async function removeFixtures002(admin: SqlExecutor): Promise<void> {
  await executeRaw(admin, `
    DELETE FROM integrations.provider_verification_evidence;
    DELETE FROM integrations.provider_rate_limit_policies;
    DELETE FROM integrations.external_webhook_receipts;
    DELETE FROM integrations.integration_dispatch_attempts;
    DELETE FROM integrations.integration_dispatches;
    DELETE FROM integrations.external_reference_mappings;
    DELETE FROM integrations.integration_discovery_items;
    DELETE FROM integrations.integration_discovery_runs;
    DELETE FROM integrations.integration_capabilities;
    DELETE FROM integrations.resource_ownership_policies;
    DELETE FROM integrations.integration_credential_bindings;
    DELETE FROM integrations.external_integrations;
    DELETE FROM integrations.provider_platform_configurations;
    DELETE FROM integrations.provider_capability_declarations;
    DELETE FROM integrations.provider_adapter_versions;
    DELETE FROM integrations.provider_registry;
    DELETE FROM organization.branches WHERE id IN ('${IDS.branchA}','${IDS.branchB}');
    DELETE FROM organization.companies WHERE id IN ('${IDS.companyA}','${IDS.companyB}');
    DELETE FROM tenancy.tenants WHERE id IN ('${IDS.tenantA}','${IDS.tenantB}');
    DELETE FROM identity.users WHERE id IN ('${IDS.userA}','${IDS.userB}');
  `);
}

async function createFixtures002(admin: SqlExecutor): Promise<void> {
  await executeRaw(admin, `
    INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES
      ('${IDS.userA}','002-a@example.test','002-a@example.test','002 A','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.userB}','002-b@example.test','002-b@example.test','002 B','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES
      ('${IDS.tenantA}','002 Tenant A','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.tenantB}','002 Tenant B','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES
      ('${IDS.companyA}','${IDS.tenantA}','002 Company A','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.companyB}','${IDS.tenantB}','002 Company B','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES
      ('${IDS.branchA}','${IDS.tenantA}','${IDS.companyA}','002 Branch A','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS.branchB}','${IDS.tenantB}','${IDS.companyB}','002 Branch B','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at) VALUES
      ('${IDS002.providerA}','TEST_A','Test A','ERP_ACCOUNTING','ACTIVE',clock_timestamp(),clock_timestamp()),
      ('${IDS002.providerB}','TEST_B','Test B','ERP_ACCOUNTING','ACTIVE',clock_timestamp(),clock_timestamp());
    INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at)
      VALUES ('${IDS002.adapterA}','${IDS002.providerA}','test-adapter','1.0.0',1,'IMPLEMENTED','NOT_EVALUATED',clock_timestamp());
    INSERT INTO integrations.provider_capability_declarations(id,provider_id,provider_adapter_version_id,capability_code,support_status,created_at)
      VALUES ('${IDS002.declaration}','${IDS002.providerA}','${IDS002.adapterA}','ACCOUNTING','SUPPORTED',clock_timestamp());
    INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at)
      VALUES ('${IDS002.integrationA}','${IDS.tenantA}','${IDS.companyA}','${IDS002.providerA}','TEST_A','${IDS002.adapterA}','TEST','CREATED',1,clock_timestamp(),clock_timestamp());
    INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at)
      VALUES ('${IDS002.bindingA}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','secret://opaque/test','API_CREDENTIAL',1,'PENDING',clock_timestamp());
    INSERT INTO integrations.integration_capabilities(id,tenant_id,company_id,integration_id,capability_code,support_status,configuration_version,effective_from,created_at)
      VALUES ('${IDS002.capability}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','ACCOUNTING','SUPPORTED',1,clock_timestamp()-interval '1 minute',clock_timestamp());
  `);
}

export async function runPostgres002Smoke(adminUrl: string): Promise<number> {
  const admin = postgresDatabase(adminUrl, 1);
  let assertions = 0;
  try {
    await removeFixtures002(admin);
    await createFixtures002(admin);
    await withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db) => {
      const rows=await queryRows<{id:string}>(db,"SELECT id::text FROM integrations.external_integrations");
      assert.deepEqual(rows.map((row)=>row.id),[IDS002.integrationA]); assertions+=1;
    });
    await withRoleTransaction(adminUrl,"pos_app",null,async(db) => {
      const rows=await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM integrations.external_integrations");
      assert.equal(rows[0]!.count,"0"); assertions+=1;
    });
    const dispatchInsert=(id:string,dispatchClass:string,capability:string,entityType:string)=>`INSERT INTO integrations.integration_dispatches
      (id,tenant_id,company_id,integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,created_at,updated_at)
      VALUES ('${id}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','${capability}','${dispatchClass}','JOURNAL','${IDS002.operation}','${entityType}','${IDS002.entity}','dispatch-${id}',1,repeat('a',64),'QUEUED','${IDS002.correlation}',clock_timestamp(),clock_timestamp())`;
    await withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,dispatchInsert(IDS002.dispatchA,"NON_FISCAL","ACCOUNTING","JournalEntry")); assertions+=1; });
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,dispatchInsert(IDS002.dispatchA,"FISCAL","ACCOUNTING","JournalEntry")); }),"FISCAL dispatch accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,dispatchInsert(IDS002.dispatchA,"NON_FISCAL","ELECTRONIC_INVOICING","ElectronicDocument")); }),"fiscal capability bypass accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantB,async(db)=>{ await executeRaw(db,`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at) VALUES ('${IDS002.dispatchA}','${IDS.tenantA}','${IDS.companyA}','${IDS002.providerA}','TEST_A','${IDS002.adapterA}','TEST','CREATED',1,clock_timestamp(),clock_timestamp())`); }),"cross-tenant integration insert accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,branch_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at) VALUES ('${IDS002.dispatchA}','${IDS.tenantA}','${IDS.companyA}','${IDS.branchB}','${IDS002.providerA}','TEST_A','${IDS002.adapterA}','TEST','CREATED',1,clock_timestamp(),clock_timestamp())`); }),"branch mismatch accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_worker",IDS.tenantA,async(db)=>{ await executeRaw(db,`UPDATE integrations.integration_dispatches SET capability_code='PRODUCTS' WHERE id='${IDS002.dispatchA}'`); }),"worker changed business column"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,`UPDATE integrations.integration_dispatches SET next_attempt_at=clock_timestamp() WHERE id='${IDS002.dispatchA}'`); }),"app changed technical column"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_admin",null,async(db)=>{ await executeRaw(db,"UPDATE integrations.provider_registry SET display_name='mutated'"); }),"admin mutated 002"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,"DELETE FROM integrations.integration_dispatches"); }),"runtime deleted 002"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,"TRUNCATE integrations.integration_dispatches"); }),"runtime truncated 002"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",IDS.tenantA,async(db)=>{
      const insert=`INSERT INTO integrations.external_webhook_receipts(id,tenant_id,company_id,integration_id,deduplication_key,received_at,payload_schema_version,payload_checksum,authentication_verification_result,replay_verification_result,processing_status,correlation_id,created_at) VALUES ('${IDS002.webhookA}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','dedup-1',clock_timestamp(),1,repeat('b',64),'VERIFIED','VERIFIED','RECEIVED','${IDS002.correlation}',clock_timestamp())`;
      await executeRaw(db,insert); await executeRaw(db,insert.replace(IDS002.webhookA,IDS002.attemptA));
    }),"webhook duplicate accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{ await executeRaw(db,`INSERT INTO integrations.provider_rate_limit_policies(id,provider_id,scope_type,tenant_id,company_id,integration_id,endpoint_class,retry_after_mode,backoff_policy_code,status,valid_from,version) VALUES ('${IDS002.rateA}','${IDS002.providerB}','INTEGRATION','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','TEST','UNVERIFIED','NONE','DRAFT',clock_timestamp(),1)`); }),"cross-provider rate policy accepted"); assertions+=1;
    await withRoleTransaction(adminUrl,"pos_platform_app",null,async(db)=>{ await executeRaw(db,`INSERT INTO integrations.provider_platform_configurations(id,provider_id,environment,configuration_type,configuration_schema_version,configuration_payload,status,valid_from,created_at,updated_at,version) VALUES ('${IDS002.configA}','${IDS002.providerA}','TEST','VALID',1,'{}','DRAFT',clock_timestamp(),clock_timestamp(),clock_timestamp(),1)`); assertions+=1; });
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",IDS.tenantA,async(db)=>{ await executeRaw(db,`INSERT INTO integrations.provider_platform_configurations(id,provider_id,environment,configuration_type,configuration_schema_version,configuration_payload,status,valid_from,created_at,updated_at,version) VALUES ('${IDS002.rateA}','${IDS002.providerA}','TEST','LARGE',1,jsonb_build_object('v',repeat('x',17000)),'DRAFT',clock_timestamp(),clock_timestamp(),clock_timestamp(),1)`); }),"oversized JSON accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",null,async(db)=>{
      await executeRaw(db,`INSERT INTO integrations.provider_verification_evidence(id,provider_id,provider_adapter_version_id,scope_type,environment,evidence_level,test_suite_version,source_commit,executed_at,result,evidence_reference,evidence_checksum,registered_by_actor_id,created_at) VALUES ('${IDS002.evidenceA}','${IDS002.providerA}','${IDS002.adapterA}','GLOBAL','TEST','MOCK_TESTED','1','abc',clock_timestamp(),'PASS','evidence://test',repeat('c',64),'${IDS.userA}',clock_timestamp())`);
      await executeRaw(db,`UPDATE integrations.provider_verification_evidence SET reviewed_by_actor_id='${IDS.userA}',reviewed_at=clock_timestamp() WHERE id='${IDS002.evidenceA}'`);
    }),"evidence self-review accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",null,async(db)=>{
      await executeRaw(db,`INSERT INTO integrations.provider_verification_evidence(id,provider_id,provider_adapter_version_id,scope_type,environment,evidence_level,test_suite_version,source_commit,executed_at,result,evidence_reference,evidence_checksum,registered_by_actor_id,created_at) VALUES ('${IDS002.evidenceA}','${IDS002.providerA}','${IDS002.adapterA}','GLOBAL','TEST','MOCK_TESTED','1','abc',clock_timestamp(),'PASS','evidence://test',repeat('c',64),'${IDS.userA}',clock_timestamp())`);
      await executeRaw(db,`UPDATE integrations.provider_verification_evidence SET reviewed_by_actor_id='${IDS.userB}',reviewed_at=clock_timestamp() WHERE id='${IDS002.evidenceA}'`);
      await sql`SELECT set_config('app.actor_id',${IDS.userA},true),set_config('app.evidence_id',${IDS002.evidenceA},true),set_config('app.audit_id',${IDS002.mappingA},true),set_config('app.correlation_id',${IDS002.correlation},true)`.execute(db);
      await executeRaw(db,`UPDATE integrations.provider_adapter_versions SET verification_status='MOCK_TESTED' WHERE provider_adapter_version_id='${IDS002.adapterA}'`);
    }),"evidence self-promotion accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",null,async(db)=>{
      await executeRaw(db,`UPDATE integrations.provider_adapter_versions SET verification_status='SANDBOX_VERIFIED' WHERE provider_adapter_version_id='${IDS002.adapterA}'`);
    }),"verification level skipping accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_platform_app",IDS.tenantA,async(db)=>{
      await executeRaw(db,`UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=clock_timestamp() WHERE id='${IDS002.bindingA}'`);
      await executeRaw(db,`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at) VALUES ('${IDS002.bindingB}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','secret://opaque/test-2','API_CREDENTIAL',2,'PENDING',clock_timestamp())`);
      await executeRaw(db,`UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=clock_timestamp() WHERE id='${IDS002.bindingB}'`);
    }),"two ACTIVE credential bindings accepted"); assertions+=1;
    const mappingInsert=(id:string,internalId:string,externalId:string)=>`INSERT INTO integrations.external_reference_mappings(id,tenant_id,company_id,integration_id,resource_type,internal_entity_type,internal_entity_id,external_id,mapping_status,provider_metadata_schema_version,provider_metadata,created_at,updated_at) VALUES ('${id}','${IDS.tenantA}','${IDS.companyA}','${IDS002.integrationA}','CUSTOMER','Customer','${internalId}','${externalId}','PROPOSED',1,'{}',clock_timestamp(),clock_timestamp())`;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{await executeRaw(db,mappingInsert(IDS002.mappingA,IDS002.entity,'ext-a'));await executeRaw(db,mappingInsert(IDS002.mappingB,IDS002.entity,'ext-b'));}),"internal mapping duplicate accepted"); assertions+=1;
    await expectRejected(()=>withRoleTransaction(adminUrl,"pos_app",IDS.tenantA,async(db)=>{await executeRaw(db,mappingInsert(IDS002.mappingA,IDS002.entity,'ext-a'));await executeRaw(db,mappingInsert(IDS002.mappingB,IDS002.operation,'ext-a'));}),"external mapping duplicate accepted"); assertions+=1;
    return assertions;
  } finally {
    await removeFixtures002(admin).catch(()=>undefined);
    await admin.destroy();
  }
}
