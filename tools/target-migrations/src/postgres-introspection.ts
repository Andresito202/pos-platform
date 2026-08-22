import type { SqlExecutor } from "./database.js";
import { queryRows } from "./database.js";
import {
  POSTGRES_TABLE_COLUMNS,
  INTEGRATION_RLS_TABLES,
  INTEGRATION_TABLES,
  PROHIBITED_TABLE_NAMES,
  REQUIRED_POLICIES,
  RLS_TABLES,
  TARGET_SCHEMAS,
} from "./contract.js";
import { MigrationInvariantError, readArtifact, sha256 } from "./shared.js";

interface CountRow { count: string }
interface NameRow { name: string }
interface ColumnRow { schema_name: string; table_name: string; column_name: string; ordinal_position: number }
interface RlsRow { qualified_name: string; row_security: boolean; force_row_security: boolean; owner_name: string }
interface SemanticRow { kind: string; qualified_name: string; definition: string }

// PostgreSQL 16.14 fingerprints of the normalized semantic catalog produced by
// the committed 001/002 artifacts. Set checks below keep failures diagnosable;
// these additionally reject same-name definition drift.
const SEMANTIC_DIGEST_001 = "2b59ec82b83c97a3506558fea8da6aea822d93734853007423c0789551bc5e06";
const SEMANTIC_DIGEST_002 = "236ef5c3812e9ffa760fa9c52a27c6e4f6952461734907d958561e377a270b73";

function assertInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MigrationInvariantError(message);
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function capturedNames(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)].map((match) => match[1]!).sort();
}

async function catalogSemanticDigest(db: SqlExecutor, schemas: readonly string[]): Promise<string> {
  const schemaSql=schemas.map((name)=>`'${name.replaceAll("'","''")}'`).join(",");
  const rows=await queryRows<SemanticRow>(db, `
    SELECT 'constraint' kind,n.nspname||'.'||c.relname||'.'||x.conname qualified_name,
           x.contype::text||':'||pg_get_constraintdef(x.oid,true) definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN (${schemaSql})
    UNION ALL
    SELECT 'index',n.nspname||'.'||c.relname||'.'||i.relname,pg_get_indexdef(i.oid,0,true)
    FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class i ON i.oid=x.indexrelid
    WHERE n.nspname IN (${schemaSql})
    UNION ALL
    SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN (${schemaSql}) AND NOT t.tgisinternal
    UNION ALL
    SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
           concat_ws(':',p.polcmd::text,p.polpermissive,
             (SELECT string_agg(pg_get_userbyid(role_oid),',' ORDER BY pg_get_userbyid(role_oid)) FROM unnest(p.polroles) role_oid),
             coalesce(pg_get_expr(p.polqual,p.polrelid,true),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),''))
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN (${schemaSql})
    UNION ALL
    SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemaSql})
    ORDER BY 1,2
  `);
  return sha256(JSON.stringify(rows)).toString("hex");
}

async function validateCatalogSemantics(db:SqlExecutor,schemas:readonly string[],expected:string,label:string):Promise<void>{
  const actual=await catalogSemanticDigest(db,schemas);
  assertInvariant(actual===expected,`${label} semantic catalog diverges (${actual})`);
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
    SELECT a.attname column_name FROM pg_attribute a
    WHERE a.attrelid='platform.target_migration_executions'::regclass AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attnum
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
    SELECT n.nspname schema_name,c.relname table_name,a.attname column_name,a.attnum ordinal_position
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind='r'
      AND n.nspname IN ('platform','identity','tenancy','organization','authorization','sync','audit')
    ORDER BY n.nspname,c.relname,a.attnum
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

  const policies = await queryRows<NameRow>(db, `SELECT policyname AS name FROM pg_policies WHERE schemaname IN ('identity','tenancy','organization','authorization','sync','audit') ORDER BY policyname`);
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
    SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE r.rolname='pos_worker' AND n.nspname='identity' AND c.relname='sessions'
  `);
  assertInvariant(Number(workerSessionGrant[0]!.count) === 0, "worker has Session grants");

  const dangerousAuditGrants = await queryRows<CountRow>(db, `
    SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE r.rolname IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin')
      AND n.nspname='audit' AND c.relname='audit_events' AND a.privilege_type IN ('UPDATE','DELETE','TRUNCATE')
  `);
  assertInvariant(Number(dangerousAuditGrants[0]!.count) === 0, "runtime can mutate AuditEvent");
  await validateCatalogSemantics(db,["platform","identity","tenancy","organization","authorization","sync","audit"],SEMANTIC_DIGEST_001,"001");
}

function tableColumnsFromSql(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const match of source.matchAll(/CREATE TABLE integrations\.([a-z][a-z0-9_]*) \(([\s\S]*?)\n\);/g)) {
    const columns = match[2]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("CONSTRAINT"))
      .map((line) => line.match(/^([a-z][a-z0-9_]*)\s/)?.[1])
      .filter((name): name is string => name !== undefined);
    result.set(match[1]!, columns);
  }
  return result;
}

function splitTopLevel(value: string): string[] {
  const parts: string[]=[]; let depth=0; let start=0;
  for(let index=0;index<value.length;index+=1){
    if(value[index]==="(")depth+=1;
    else if(value[index]===")")depth-=1;
    else if(value[index]===","&&depth===0){parts.push(value.slice(start,index).trim());start=index+1;}
  }
  parts.push(value.slice(start).trim()); return parts.filter(Boolean);
}

function columnGrantsFromSql(source:string,columns:Map<string,string[]>):string[]{
  const grants=new Set<string>();
  for(const line of source.split(/\r?\n/).map(value=>value.trim()).filter(value=>value.startsWith("GRANT "))){
    const match=line.match(/^GRANT (.+) ON (.+) TO (.+);$/); if(!match||match[2]!.startsWith("SCHEMA "))continue;
    const objects=splitTopLevel(match[2]!).map(value=>value.replace(/^integrations\./,""));
    const roles=splitTopLevel(match[3]!);
    for(const privilege of splitTopLevel(match[1]!)){
      const parsed=privilege.match(/^(SELECT|INSERT|UPDATE)(?: \((.+)\))?$/); if(!parsed)continue;
      for(const object of objects){
        const grantedColumns=parsed[2] ? splitTopLevel(parsed[2]!) : columns.get(object) ?? [];
        for(const role of roles)for(const column of grantedColumns)grants.add(`${role}|${object}|${parsed[1]}|${column}`);
      }
    }
  }
  return [...grants].sort();
}

export async function integrationsCatalogState(db: SqlExecutor): Promise<"pre-002" | "target-002" | "partial"> {
  const schemas = await queryRows<CountRow>(db, "SELECT count(*)::text AS count FROM pg_namespace WHERE nspname='integrations'");
  if (Number(schemas[0]!.count) === 0) return "pre-002";
  try {
    await validatePostgres002Catalog(db);
    return "target-002";
  } catch {
    return "partial";
  }
}

export async function validateBtreeGist(db: SqlExecutor): Promise<void> {
  const extension = await queryRows<CountRow>(db, "SELECT count(*)::text AS count FROM pg_extension WHERE extname='btree_gist'");
  assertInvariant(Number(extension[0]!.count) === 1, "btree_gist is missing");
  const operatorTypes = await queryRows<NameRow>(db, `
    SELECT DISTINCT t.typname AS name
    FROM pg_opclass o
    JOIN pg_am a ON a.oid=o.opcmethod
    JOIN pg_type t ON t.oid=o.opcintype
    WHERE a.amname='gist' AND t.typname IN ('uuid','text','anyrange')
    ORDER BY 1
  `);
  assertInvariant(sameValues(operatorTypes.map((row) => row.name), ["anyrange","text","uuid"]), "required GiST operator classes are missing");
}

export async function validatePostgres002Catalog(db: SqlExecutor): Promise<void> {
  await validatePostgresCatalog(db);
  await validateBtreeGist(db);
  const bodySql = await readArtifact("postgres/002_external_integrations_foundation.up.sql");
  const expectedColumns = tableColumnsFromSql(bodySql);
  assertInvariant(sameValues([...expectedColumns.keys()].sort(), [...INTEGRATION_TABLES].sort()), "002 artifact table set diverges");

  const schema = await queryRows<{ owner_name: string; public_create: boolean }>(db, `
    SELECT pg_get_userbyid(n.nspowner) AS owner_name,
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type='CREATE') AS public_create
    FROM pg_namespace n WHERE n.nspname='integrations'
  `);
  assertInvariant(schema[0]?.owner_name === "pos_schema_owner" && !schema[0].public_create, "integrations schema ownership/grants diverge");

  const tables = await queryRows<{ name: string; owner_name: string; rls: boolean; forced: boolean }>(db, `
    SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner_name,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations' AND c.relkind='r' ORDER BY c.relname
  `);
  assertInvariant(sameValues(tables.map((row) => row.name), [...INTEGRATION_TABLES].sort()), "integration table set diverges");
  for (const table of tables) {
    assertInvariant(table.owner_name === "pos_schema_owner", `${table.name} owner diverges`);
    const protectedTable = INTEGRATION_RLS_TABLES.includes(table.name);
    assertInvariant(table.rls === protectedTable && table.forced === protectedTable, `${table.name} RLS diverges`);
  }

  const columns = await queryRows<ColumnRow>(db, `
    SELECT n.nspname schema_name,c.relname table_name,a.attname column_name,a.attnum ordinal_position
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind='r' AND n.nspname='integrations'
    ORDER BY c.relname,a.attnum
  `);
  for (const [table, expected] of expectedColumns) {
    const actual = columns.filter((row) => row.table_name===table).map((row) => row.column_name);
    assertInvariant(sameValues(actual, expected), `integrations.${table} columns diverge`);
  }

  const constraints = await queryRows<NameRow>(db, `
    SELECT x.conname AS name FROM pg_constraint x
    JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname='integrations' ORDER BY 1
  `);
  const expectedConstraints = [
    ...capturedNames(bodySql, /(?:^\s*CONSTRAINT|ADD CONSTRAINT)\s+([a-z][a-z0-9_]*)/gim),
    ...capturedNames(bodySql, /CREATE\s+CONSTRAINT\s+TRIGGER\s+([a-z][a-z0-9_]*)/gi),
    ...INTEGRATION_TABLES.map((table) => `${table}_pkey`),
  ].sort();
  assertInvariant(sameValues(constraints.map((row) => row.name), expectedConstraints), "002 constraint set diverges");

  const constraintIndexes = await queryRows<NameRow>(db, `
    SELECT x.conname AS name FROM pg_constraint x
    JOIN pg_namespace n ON n.oid=x.connamespace
    WHERE n.nspname='integrations' AND x.contype IN ('p','u','x') ORDER BY 1
  `);
  const indexes = await queryRows<NameRow>(db, "SELECT indexname AS name FROM pg_indexes WHERE schemaname='integrations' ORDER BY 1");
  const expectedIndexes = [
    ...capturedNames(bodySql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z][a-z0-9_]*)/gi),
    ...constraintIndexes.map((row) => row.name),
  ].sort();
  assertInvariant(sameValues(indexes.map((row) => row.name), expectedIndexes), "002 index set diverges");
  assertInvariant(!indexes.some((row) => row.name === "provider_platform_configurations_current_idx"), "prohibited speculative index exists");

  const triggers = await queryRows<NameRow>(db, `
    SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations' AND NOT t.tgisinternal ORDER BY 1
  `);
  assertInvariant(sameValues(triggers.map((row) => row.name), capturedNames(bodySql, /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z][a-z0-9_]*)/gi)), "002 trigger set diverges");

  const policies = await queryRows<NameRow>(db, "SELECT policyname AS name FROM pg_policies WHERE schemaname='integrations' ORDER BY 1");
  assertInvariant(sameValues(policies.map((row) => row.name), capturedNames(bodySql, /CREATE\s+POLICY\s+([a-z][a-z0-9_]*)/gi)), "002 policy set diverges");

  const unsafeFunctions=await queryRows<NameRow>(db, `
    SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='integrations'
      AND NOT (COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=pg_catalog, integrations%')
  `);
  assertInvariant(unsafeFunctions.length===0,"002 function has unsafe search_path");

  const dangerous = await queryRows<CountRow>(db, `
    SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND r.rolname IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin','pos_reporting')
      AND a.privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')
  `);
  assertInvariant(Number(dangerous[0]!.count)===0, "runtime has dangerous 002 table grants");
  const reporting = await queryRows<CountRow>(db, "SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='integrations' AND r.rolname='pos_reporting'");
  assertInvariant(Number(reporting[0]!.count)===0, "pos_reporting has 002 grants");
  const adminMutation = await queryRows<CountRow>(db, "SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='integrations' AND r.rolname='pos_platform_admin' AND a.privilege_type<>'SELECT'");
  assertInvariant(Number(adminMutation[0]!.count)===0, "platform admin can mutate 002");

  const actualColumnGrants=await queryRows<{grantee:string;table_name:string;privilege_type:string;column_name:string}>(db, `
    SELECT DISTINCT r.rolname grantee,c.relname table_name,a.privilege_type,att.attname column_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND r.rolname IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin','pos_reporting') AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    UNION
    SELECT r.rolname,c.relname,a.privilege_type,att.attname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND r.rolname IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin','pos_reporting') AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    ORDER BY grantee,table_name,privilege_type,column_name
  `);
  const actualGrantKeys=actualColumnGrants.map(row=>`${row.grantee}|${row.table_name}|${row.privilege_type}|${row.column_name}`).sort();
  const expectedGrantKeys=columnGrantsFromSql(bodySql,expectedColumns);
  assertInvariant(sameValues(actualGrantKeys,expectedGrantKeys), "002 role/operation/column grant matrix diverges");
  await validateCatalogSemantics(db,["integrations"],SEMANTIC_DIGEST_002,"002");
}
