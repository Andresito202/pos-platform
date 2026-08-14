import type { SqlExecutor } from "./database.js";
import { queryRows } from "./database.js";
import {
  POSTGRES_TABLE_COLUMNS,
  PROHIBITED_TABLE_NAMES,
  REQUIRED_POLICIES,
  RLS_TABLES,
  TARGET_SCHEMAS,
} from "./contract.js";
import { MigrationInvariantError, readArtifact } from "./shared.js";

interface CountRow { count: string }
interface NameRow { name: string }
interface ColumnRow { schema_name: string; table_name: string; column_name: string; ordinal_position: number }
interface RlsRow { qualified_name: string; row_security: boolean; force_row_security: boolean; owner_name: string }

function assertInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MigrationInvariantError(message);
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function capturedNames(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)].map((match) => match[1]!).sort();
}

export async function bootstrapPresence(db: SqlExecutor): Promise<"absent" | "complete" | "partial"> {
  const rows = await queryRows<{ schema_exists: boolean; helper_exists: boolean; ledger_exists: boolean }>(db, `
    SELECT
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'platform') AS schema_exists,
      to_regprocedure('platform.is_uuid_v7(uuid)') IS NOT NULL AS helper_exists,
      to_regclass('platform.target_migration_executions') IS NOT NULL AS ledger_exists
  `);
  const row = rows[0]!;
  const count = [row.schema_exists, row.helper_exists, row.ledger_exists].filter(Boolean).length;
  return count === 0 ? "absent" : count === 3 ? "complete" : "partial";
}

export async function validateBootstrap(db: SqlExecutor): Promise<void> {
  const presence = await bootstrapPresence(db);
  assertInvariant(presence === "complete", `bootstrap is ${presence}`);

  const forbiddenMigrationMetadata = await queryRows<NameRow>(db, `
    SELECT schemaname || '.' || tablename AS name
    FROM pg_tables
    WHERE lower(tablename) IN ('kysely_migration','kysely_migration_lock')
       OR lower(tablename) LIKE 'kysely\\_migration\\_%' ESCAPE '\\'
    ORDER BY 1
  `);
  assertInvariant(
    forbiddenMigrationMetadata.length === 0,
    `parallel Kysely migration metadata found: ${forbiddenMigrationMetadata.map((row) => row.name).join(",")}`,
  );

  const columns = await queryRows<{ column_name: string }>(db, `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name = 'target_migration_executions'
    ORDER BY ordinal_position
  `);
  assertInvariant(
    sameValues(columns.map((row) => row.column_name), POSTGRES_TABLE_COLUMNS["platform.target_migration_executions"]),
    "bootstrap ledger columns diverge",
  );

  const bootstrapSql = await readArtifact("postgres/bootstrap.sql");
  const constraints = await queryRows<NameRow>(db, `
    SELECT conname AS name
    FROM pg_constraint
    WHERE conrelid = 'platform.target_migration_executions'::regclass
    ORDER BY conname
  `);
  const expectedConstraints = [
    ...capturedNames(bootstrapSql, /CONSTRAINT\s+([a-z][a-z0-9_]*)/gi),
    "target_migration_executions_pkey",
  ].sort();
  assertInvariant(sameValues(constraints.map((row) => row.name), expectedConstraints), "bootstrap ledger constraints diverge");

  const indexes = await queryRows<NameRow>(db, `
    SELECT indexname AS name FROM pg_indexes
    WHERE schemaname = 'platform' AND tablename = 'target_migration_executions'
    ORDER BY indexname
  `);
  const indexNames = indexes.map((row) => row.name).sort();
  const expectedIndexes = [
    "target_migration_executions_pkey",
    "target_migration_executions_identity_uq",
    ...capturedNames(bootstrapSql, /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z][a-z0-9_]*)/gi),
  ].sort();
  assertInvariant(sameValues(indexNames, expectedIndexes), "bootstrap ledger indexes diverge");

  const triggers = await queryRows<NameRow>(db, `
    SELECT tgname AS name FROM pg_trigger
    WHERE tgrelid = 'platform.target_migration_executions'::regclass AND NOT tgisinternal
  `);
  assertInvariant(
    sameValues(triggers.map((row) => row.name).sort(), capturedNames(bootstrapSql, /CREATE\s+TRIGGER\s+([a-z][a-z0-9_]*)/gi)),
    "ledger trigger set diverges",
  );

  const helper = await queryRows<{ definition: string; owner_name: string }>(db, `
    SELECT pg_get_functiondef('platform.is_uuid_v7(uuid)'::regprocedure) AS definition,
           pg_get_userbyid(p.proowner) AS owner_name
    FROM pg_proc p WHERE p.oid = 'platform.is_uuid_v7(uuid)'::regprocedure
  `);
  assertInvariant(helper[0]?.owner_name === "pos_schema_owner", "UUID helper owner diverges");
  assertInvariant(helper[0]!.definition.includes("substring") && helper[0]!.definition.includes("'7'"), "UUID helper definition diverges");

  const owner = await queryRows<{ owner_name: string }>(db, `
    SELECT tableowner AS owner_name FROM pg_tables
    WHERE schemaname = 'platform' AND tablename = 'target_migration_executions'
  `);
  assertInvariant(owner[0]?.owner_name === "pos_schema_owner", "ledger owner diverges");
}

export async function targetCatalogState(db: SqlExecutor): Promise<"pre-001" | "target-001" | "partial"> {
  const rows = await queryRows<NameRow>(db, `
    SELECT nspname AS name FROM pg_namespace
    WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit')
    ORDER BY nspname
  `);
  if (rows.length === 0) return "pre-001";
  if (rows.length !== TARGET_SCHEMAS.length) return "partial";
  try {
    await validatePostgresCatalog(db);
    return "target-001";
  } catch {
    return "partial";
  }
}

export async function validatePostgresCatalog(db: SqlExecutor): Promise<void> {
  await validateBootstrap(db);

  const schemas = await queryRows<NameRow>(db, `
    SELECT nspname AS name FROM pg_namespace
    WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit')
    ORDER BY nspname
  `);
  assertInvariant(sameValues(schemas.map((row) => row.name), [...TARGET_SCHEMAS].sort()), "target schemas diverge");

  const tables = await queryRows<{ qualified_name: string }>(db, `
    SELECT schemaname || '.' || tablename AS qualified_name
    FROM pg_tables
    WHERE schemaname IN ('platform','identity','tenancy','organization','authorization','sync','audit')
    ORDER BY qualified_name
  `);
  const actualTables = tables.map((row) => row.qualified_name).sort();
  const expectedTables = Object.keys(POSTGRES_TABLE_COLUMNS).sort();
  assertInvariant(sameValues(actualTables, expectedTables), `target tables diverge: ${actualTables.join(",")}`);

  const columns = await queryRows<ColumnRow>(db, `
    SELECT table_schema AS schema_name, table_name, column_name, ordinal_position
    FROM information_schema.columns
    WHERE table_schema IN ('platform','identity','tenancy','organization','authorization','sync','audit')
    ORDER BY table_schema, table_name, ordinal_position
  `);
  for (const [qualifiedName, expectedColumns] of Object.entries(POSTGRES_TABLE_COLUMNS)) {
    const [schemaName, tableName] = qualifiedName.split(".") as [string, string];
    const actual = columns
      .filter((row) => row.schema_name === schemaName && row.table_name === tableName)
      .sort((left, right) => left.ordinal_position - right.ordinal_position)
      .map((row) => row.column_name);
    assertInvariant(sameValues(actual, expectedColumns), `${qualifiedName} columns diverge`);
  }

  const primaryKeys = await queryRows<{ qualified_name: string }>(db, `
    SELECT n.nspname || '.' || c.relname AS qualified_name
    FROM pg_constraint x
    JOIN pg_class c ON c.oid = x.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE x.contype = 'p' AND n.nspname IN ('platform','identity','tenancy','organization','authorization','sync','audit')
  `);
  assertInvariant(primaryKeys.length === expectedTables.length, "every target table must have exactly one primary key");

  const bodySql = await readArtifact("postgres/001_central_foundation.up.sql");
  const bodyTableNames = Object.keys(POSTGRES_TABLE_COLUMNS)
    .filter((name) => !name.startsWith("platform."))
    // PostgreSQL reuses the explicit redundant tenants(id) unique name for the
    // primary-key index/constraint; the resulting PK is tenants_id_uq.
    .filter((name) => name !== "tenancy.tenants")
    .map((name) => `${name.split(".")[1]}_pkey`);
  const expectedConstraintNames = [
    ...capturedNames(bodySql, /CONSTRAINT\s+([a-z][a-z0-9_]*)/gi),
    ...bodyTableNames,
  ].sort();
  const constraintNames = await queryRows<NameRow>(db, `
    SELECT x.conname AS name
    FROM pg_constraint x
    JOIN pg_namespace n ON n.oid = x.connamespace
    WHERE n.nspname IN ('identity','tenancy','organization','authorization','sync','audit')
    ORDER BY x.conname
  `);
  assertInvariant(sameValues(constraintNames.map((row) => row.name), expectedConstraintNames), "body constraint set diverges");

  const expectedIndexNames = [
    ...capturedNames(bodySql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z][a-z0-9_]*)/gi),
    ...expectedConstraintNames.filter((name) => name.endsWith("_pkey") || name.endsWith("_uq")),
  ].sort();
  const bodyIndexes = await queryRows<NameRow>(db, `
    SELECT indexname AS name FROM pg_indexes
    WHERE schemaname IN ('identity','tenancy','organization','authorization','sync','audit')
    ORDER BY indexname
  `);
  assertInvariant(sameValues(bodyIndexes.map((row) => row.name), expectedIndexNames), "body index set diverges");

  const bodyTriggers = await queryRows<NameRow>(db, `
    SELECT t.tgname AS name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('identity','tenancy','organization','authorization','sync','audit')
    ORDER BY t.tgname
  `);
  assertInvariant(
    sameValues(bodyTriggers.map((row) => row.name), capturedNames(bodySql, /CREATE\s+TRIGGER\s+([a-z][a-z0-9_]*)/gi)),
    "body trigger set diverges",
  );

  const rls = await queryRows<RlsRow>(db, `
    SELECT n.nspname || '.' || c.relname AS qualified_name,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           pg_get_userbyid(c.relowner) AS owner_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('platform','identity','tenancy','organization','authorization','sync','audit')
  `);
  for (const row of rls) {
    assertInvariant(row.owner_name === "pos_schema_owner", `${row.qualified_name} owner diverges`);
    const protectedTable = RLS_TABLES.includes(row.qualified_name as (typeof RLS_TABLES)[number]);
    assertInvariant(row.row_security === protectedTable, `${row.qualified_name} ENABLE RLS diverges`);
    assertInvariant(row.force_row_security === protectedTable, `${row.qualified_name} FORCE RLS diverges`);
  }

  const policies = await queryRows<NameRow>(db, `SELECT policyname AS name FROM pg_policies ORDER BY policyname`);
  const policyNames = policies.map((row) => row.name);
  assertInvariant(sameValues(policyNames, [...REQUIRED_POLICIES].sort()), "policy set diverges");

  const prohibited = await queryRows<NameRow>(db, `
    SELECT tablename AS name FROM pg_tables
    WHERE tablename IN (${PROHIBITED_TABLE_NAMES.map((name) => `'${name}'`).join(",")})
  `);
  assertInvariant(prohibited.length === 0, `prohibited tables found: ${prohibited.map((row) => row.name).join(",")}`);

  const requiredForeignKeys = [
    "companies_tenant_fk","branches_company_fk","tenant_memberships_tenant_fk","tenant_memberships_user_fk",
    "user_role_assignments_membership_fk","sessions_user_membership_fk","sessions_tenant_membership_fk",
    "security_events_tenant_session_fk","onboarding_operations_owner_membership_fk",
    "sync_operations_company_fk","sync_operations_branch_fk","sync_operations_session_fk",
    "outbox_entries_operation_fk","audit_events_tenant_session_fk","audit_events_company_fk",
    "audit_events_branch_fk","audit_events_operation_fk",
  ];
  const foreignKeys = await queryRows<NameRow>(db, `
    SELECT conname AS name FROM pg_constraint
    WHERE contype = 'f' AND connamespace IN (
      SELECT oid FROM pg_namespace WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit')
    )
  `);
  const foreignKeyNames = new Set(foreignKeys.map((row) => row.name));
  for (const name of requiredForeignKeys) assertInvariant(foreignKeyNames.has(name), `foreign key ${name} missing`);

  const roleProblems = await queryRows<NameRow>(db, `
    SELECT rolname AS name FROM pg_roles
    WHERE rolname IN ('pos_app','pos_worker','pos_platform_app')
      AND (rolsuper OR rolbypassrls)
  `);
  assertInvariant(roleProblems.length === 0, "runtime role is superuser or BYPASSRLS");

  const ownerProblems = await queryRows<NameRow>(db, `
    SELECT DISTINCT tableowner AS name FROM pg_tables
    WHERE schemaname IN ('identity','tenancy','organization','authorization','sync','audit')
      AND tableowner IN ('pos_app','pos_worker','pos_platform_app')
  `);
  assertInvariant(ownerProblems.length === 0, "runtime owns target tables");

  const workerSessionGrant = await queryRows<CountRow>(db, `
    SELECT count(*)::text AS count FROM information_schema.role_table_grants
    WHERE grantee = 'pos_worker' AND table_schema = 'identity' AND table_name = 'sessions'
  `);
  assertInvariant(Number(workerSessionGrant[0]!.count) === 0, "worker has Session grants");

  const dangerousAuditGrants = await queryRows<CountRow>(db, `
    SELECT count(*)::text AS count FROM information_schema.role_table_grants
    WHERE grantee IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin')
      AND table_schema = 'audit' AND table_name = 'audit_events'
      AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
  `);
  assertInvariant(Number(dangerousAuditGrants[0]!.count) === 0, "runtime can mutate AuditEvent");
}
