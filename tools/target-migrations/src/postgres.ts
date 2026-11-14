import { sql } from "kysely";
import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";
import { INTEGRATION_TABLES, POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_001_TABLE_COLUMNS } from "./contract.js";
import { bootstrapPresence, integrationsCatalogState, targetCatalogState, validateBootstrap, validateBtreeGist, validatePostgres002Catalog, validatePostgresCatalog } from "./postgres-introspection.js";
import {
  MANIFEST_VERSION,
  MigrationInvariantError,
  POSTGRES_MIGRATION_ID,
  POSTGRES_002_MIGRATION_ID,
  POSTGRES_MIGRATION_LOCK_RESOURCE,
  RUNNER_VERSION,
  SimulatedCrashError,
  readArtifact,
  sha256,
  uuidV7,
} from "./shared.js";
import { runPostgres002Smoke, runPostgresSmoke } from "./postgres-smoke.js";

interface RoleDefinition {
  login: boolean;
  bypassRls: boolean;
  inherit: boolean;
}

const ROLES: Record<string, RoleDefinition> = {
  pos_schema_owner: { login: false, bypassRls: false, inherit: true },
  pos_migrator: { login: true, bypassRls: false, inherit: false },
  pos_app: { login: true, bypassRls: false, inherit: false },
  pos_worker: { login: true, bypassRls: false, inherit: false },
  pos_platform_app: { login: true, bypassRls: false, inherit: false },
  pos_platform_admin: { login: true, bypassRls: true, inherit: false },
  pos_reporting: { login: false, bypassRls: false, inherit: false },
};

interface RoleRow {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
}

interface ExecutionRow {
  execution_id: string;
  migration_id: string;
  checksum: Buffer;
  status: "STARTED" | "FAILED" | "APPLIED" | "ROLLED_BACK";
  body_committed_at: Date | null;
  applied_at: Date | null;
}

export interface PostgresRunnerConfig {
  adminUrl: string;
  migratorUrl?: string;
  simulateCrashAfterStarted?: boolean;
  simulateCrashAfterBodyCommit?: boolean;
  injectBodyFailure?: boolean;
  skipSmoke?: boolean;
}

export interface PostgresApplyResult {
  executionId: string;
  noOp: boolean;
  reconciled: boolean;
  checksumHex: string;
  prerequisiteState?: "PREEXISTING" | "INSTALLED_BY_MIGRATION_PREREQUISITE";
}

function roleConnectionUrl(adminUrl: string, roleName: string): string {
  const value = new URL(adminUrl);
  value.username = roleName;
  value.password = "";
  return value.toString();
}

export function postgresRoleUrls(adminUrl: string): Record<string, string> {
  return Object.fromEntries(Object.keys(ROLES).map((role) => [role, roleConnectionUrl(adminUrl, role)]));
}

async function ensureRoles(admin: SqlExecutor): Promise<void> {
  const rows = await queryRows<RoleRow>(admin, `
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit
    FROM pg_roles WHERE rolname IN (${Object.keys(ROLES).map((role) => `'${role}'`).join(",")})
  `);
  const existing = new Map(rows.map((row) => [row.rolname, row]));
  const created = new Set<string>();

  for (const [roleName, expected] of Object.entries(ROLES)) {
    const role = existing.get(roleName);
    if (role) {
      if (role.rolcanlogin !== expected.login || role.rolsuper || role.rolbypassrls !== expected.bypassRls || role.rolinherit !== expected.inherit) {
        throw new MigrationInvariantError(`role ${roleName} attributes diverge`);
      }
      continue;
    }
    const attributes = [
      expected.login ? "LOGIN" : "NOLOGIN",
      "NOSUPERUSER",
      "NOCREATEDB",
      "NOCREATEROLE",
      "NOREPLICATION",
      expected.inherit ? "INHERIT" : "NOINHERIT",
      expected.bypassRls ? "BYPASSRLS" : "NOBYPASSRLS",
    ].join(" ");
    await executeRaw(admin, `CREATE ROLE ${roleName} ${attributes}`);
    created.add(roleName);
  }

  const membership = await queryRows<{ exists: boolean }>(admin, `
    SELECT EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles parent ON parent.oid = m.roleid
      JOIN pg_roles member ON member.oid = m.member
      WHERE parent.rolname = 'pos_schema_owner' AND member.rolname = 'pos_migrator'
    ) AS exists
  `);
  if (!membership[0]!.exists) {
    if (!created.has("pos_schema_owner") && !created.has("pos_migrator")) {
      throw new MigrationInvariantError("pos_migrator membership in pos_schema_owner diverges");
    }
    await executeRaw(admin, "GRANT pos_schema_owner TO pos_migrator");
  }

  const database = await queryRows<{ name: string }>(admin, "SELECT current_database() AS name");
  const databaseName = database[0]!.name;
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new MigrationInvariantError("unsafe database identifier");
  const ownerCanCreate = await queryRows<{ allowed: boolean }>(admin, "SELECT has_database_privilege('pos_schema_owner',current_database(),'CREATE') AS allowed");
  if (!ownerCanCreate[0]!.allowed) await executeRaw(admin, `GRANT CREATE ON DATABASE "${databaseName}" TO pos_schema_owner`);
}

async function bootstrapPostgres(admin: SqlExecutor, migrator: SqlExecutor): Promise<void> {
  await ensureRoles(admin);
  await migrator.connection().execute(async (connection) => {
    await executeRaw(connection, "SET ROLE pos_schema_owner");
    const presence = await bootstrapPresence(connection);
    if (presence === "partial") throw new MigrationInvariantError("partial PostgreSQL bootstrap detected");
    if (presence === "absent") {
      const bootstrapSql = await readArtifact("postgres/bootstrap.sql");
      await connection.transaction().execute(async (transaction) => {
        await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
        await executeRaw(transaction, bootstrapSql);
      });
    }
    await validateBootstrap(connection);
    await executeRaw(connection, "RESET ROLE");
  });
}

async function executionRows(db: SqlExecutor, migrationId = POSTGRES_MIGRATION_ID): Promise<ExecutionRow[]> {
  const result = await sql<ExecutionRow>`
    SELECT execution_id, migration_id, checksum, status, body_committed_at, applied_at
    FROM platform.target_migration_executions
    WHERE migration_id = ${migrationId}
    ORDER BY started_at DESC
  `.execute(db);
  return result.rows;
}

async function acquireMigrationLock(db: SqlExecutor): Promise<void> {
  await sql`SELECT pg_advisory_lock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE}, 0))`.execute(db);
}

async function releaseMigrationLock(db: SqlExecutor): Promise<void> {
  await sql`SELECT pg_advisory_unlock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE}, 0))`.execute(db);
}

async function ensureBtreeGist(db: SqlExecutor): Promise<"PREEXISTING" | "INSTALLED_BY_MIGRATION_PREREQUISITE"> {
  const present = await queryRows<{ present: boolean }>(db, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS present");
  let state: "PREEXISTING" | "INSTALLED_BY_MIGRATION_PREREQUISITE" = "PREEXISTING";
  if (!present[0]!.present) {
    try {
      await db.transaction().execute(async (transaction) => {
        await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
        await executeRaw(transaction, "CREATE EXTENSION btree_gist");
      });
      state = "INSTALLED_BY_MIGRATION_PREREQUISITE";
    } catch (error) {
      throw new MigrationInvariantError(`btree_gist prerequisite unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  await validateBtreeGist(db);
  return state;
}

function sameChecksum(actual: Buffer, expected: Buffer): boolean {
  return Buffer.from(actual).equals(expected);
}

function assertExecutionChecksums(rows: ExecutionRow[], expected: Buffer, migrationId: string): void {
  for (const row of rows) {
    if (!sameChecksum(row.checksum, expected)) throw new MigrationInvariantError(`checksum mismatch for ${migrationId}`);
  }
}

async function markFailed(db: SqlExecutor, executionId: string, errorCode: string): Promise<void> {
  await sql`
    UPDATE platform.target_migration_executions
    SET status = 'FAILED', error_code = ${errorCode}, finished_at = clock_timestamp()
    WHERE execution_id = ${executionId}::uuid AND status = 'STARTED' AND body_committed_at IS NULL
  `.execute(db);
}

async function finishApplied(db: SqlExecutor, executionId: string): Promise<void> {
  await sql`
    UPDATE platform.target_migration_executions
    SET status = 'APPLIED', smoke_verified_at = clock_timestamp(), applied_at = clock_timestamp(), finished_at = clock_timestamp()
    WHERE execution_id = ${executionId}::uuid AND status = 'STARTED' AND body_committed_at IS NOT NULL
  `.execute(db);
}

async function finishFromCommittedBody(
  db: SqlExecutor,
  config: PostgresRunnerConfig,
  executionId: string,
  adminUrl: string,
): Promise<void> {
  await validatePostgresCatalog(db);
  if (!config.skipSmoke) await runPostgresSmoke(adminUrl);
  await finishApplied(db, executionId);
}

export async function applyPostgres001(config: PostgresRunnerConfig): Promise<PostgresApplyResult> {
  const admin = postgresDatabase(config.adminUrl, 2);
  const migratorUrl = config.migratorUrl ?? roleConnectionUrl(config.adminUrl, "pos_migrator");
  const migrator = postgresDatabase(migratorUrl, 1);
  const upSql = await readArtifact("postgres/001_central_foundation.up.sql");
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");

  try {
    await bootstrapPostgres(admin, migrator);
    return await migrator.connection().execute(async (connection) => {
      await executeRaw(connection, "SET ROLE pos_schema_owner");
      await acquireMigrationLock(connection);
      try {
        const rows = await executionRows(connection);
        assertExecutionChecksums(rows, checksum, POSTGRES_MIGRATION_ID);

        const applied = rows.find((row) => row.status === "APPLIED");
        if (applied) {
          await validatePostgresCatalog(connection);
          return { executionId: applied.execution_id, noOp: true, reconciled: false, checksumHex };
        }

        const started = rows.find((row) => row.status === "STARTED");
        if (started) {
          const state = await targetCatalogState(connection);
          if (state === "partial") throw new MigrationInvariantError("STARTED execution has divergent catalog");
          if (state === "target-001") {
            if (started.body_committed_at === null) {
              await sql`UPDATE platform.target_migration_executions SET body_committed_at = clock_timestamp() WHERE execution_id = ${started.execution_id}::uuid`.execute(connection);
            }
            await finishFromCommittedBody(connection, config, started.execution_id, config.adminUrl);
            return { executionId: started.execution_id, noOp: false, reconciled: true, checksumHex };
          }
          await markFailed(connection, started.execution_id, "RECONCILED_PRE_001");
        }

        const executionId = uuidV7();
        await sql`
          INSERT INTO platform.target_migration_executions (
            execution_id, migration_id, dialect, manifest_version, checksum, status, started_at, runner_version
          ) VALUES (
            ${executionId}::uuid, ${POSTGRES_MIGRATION_ID}, 'POSTGRESQL', ${MANIFEST_VERSION}, ${checksum}, 'STARTED', clock_timestamp(), ${RUNNER_VERSION}
          )
        `.execute(connection);

        if (config.simulateCrashAfterStarted) throw new SimulatedCrashError("simulated crash after STARTED");

        try {
          await connection.transaction().execute(async (transaction) => {
            await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
            await executeRaw(transaction, upSql);
            if (config.injectBodyFailure) await executeRaw(transaction, "SELECT missing_injected_body_function()");
            await validatePostgresCatalog(transaction);
          });
        } catch (error) {
          await markFailed(connection, executionId, "BODY_ROLLED_BACK");
          throw error;
        }

        if (config.simulateCrashAfterBodyCommit) throw new SimulatedCrashError("simulated crash after body COMMIT");

        await sql`
          UPDATE platform.target_migration_executions SET body_committed_at = clock_timestamp()
          WHERE execution_id = ${executionId}::uuid AND status = 'STARTED'
        `.execute(connection);
        await finishFromCommittedBody(connection, config, executionId, config.adminUrl);
        return { executionId, noOp: false, reconciled: false, checksumHex };
      } finally {
        await releaseMigrationLock(connection);
        await executeRaw(connection, "RESET ROLE");
      }
    });
  } finally {
    await migrator.destroy();
    await admin.destroy();
  }
}

export async function downPostgres001(config: Pick<PostgresRunnerConfig, "adminUrl" | "migratorUrl">): Promise<void> {
  const migratorUrl = config.migratorUrl ?? roleConnectionUrl(config.adminUrl, "pos_migrator");
  const migrator = postgresDatabase(migratorUrl, 1);
  const downSql = await readArtifact("postgres/001_central_foundation.down.sql");
  const upSql = await readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  try {
    await migrator.connection().execute(async (connection) => {
      await executeRaw(connection, "SET ROLE pos_schema_owner");
      await acquireMigrationLock(connection);
      try {
        const dependents = await queryRows<{ migration_id: string }>(connection, `
          SELECT migration_id FROM platform.target_migration_executions
          WHERE migration_id='002_external_integrations_foundation'
            AND status IN ('APPLIED','STARTED')
        `);
        if (dependents.length > 0) throw new MigrationInvariantError("down 001 rejected because 002 is applied or committed STARTED");
        await validatePostgresCatalog(connection);
        const rows = await executionRows(connection);
        assertExecutionChecksums(rows, checksum, POSTGRES_MIGRATION_ID);
        const execution = rows.find((row) => row.status === "APPLIED" || (row.status === "STARTED" && row.body_committed_at !== null));
        if (!execution) throw new MigrationInvariantError("no committed execution is eligible for down");

        const domainTables = Object.keys(POSTGRES_001_TABLE_COLUMNS).filter((name) => !name.startsWith("platform."));
        const quoteQualifiedName = (name: string): string => name
          .split(".")
          .map((part) => `"${part.replaceAll('"', '""')}"`)
          .join(".");
        const counts = await queryRows<{ row_count: string }>(connection, `
          SELECT (${domainTables.map((name) => `(SELECT count(*) FROM ${quoteQualifiedName(name)})`).join(" + ")})::text AS row_count
        `);
        if (Number(counts[0]!.row_count) !== 0) throw new MigrationInvariantError("down refused because domain data exists");

        await connection.transaction().execute(async (transaction) => {
          await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
          await executeRaw(transaction, downSql);
          const state = await targetCatalogState(transaction);
          if (state !== "pre-001") throw new MigrationInvariantError("down did not restore pre-001 catalog");
        });
        await sql`
          UPDATE platform.target_migration_executions
          SET status = 'ROLLED_BACK', rolled_back_at = clock_timestamp(), finished_at = clock_timestamp()
          WHERE execution_id = ${execution.execution_id}::uuid
        `.execute(connection);
      } finally {
        await releaseMigrationLock(connection);
        await executeRaw(connection, "RESET ROLE");
      }
    });
  } finally {
    await migrator.destroy();
  }
}

export async function applyPostgres002(config: PostgresRunnerConfig): Promise<PostgresApplyResult> {
  const admin = postgresDatabase(config.adminUrl, 2);
  const migratorUrl = config.migratorUrl ?? roleConnectionUrl(config.adminUrl, "pos_migrator");
  const migrator = postgresDatabase(migratorUrl, 1);
  const upSql = await readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  try {
    await bootstrapPostgres(admin, migrator);
    return await migrator.connection().execute(async (connection) => {
      await executeRaw(connection, "SET ROLE pos_schema_owner");
      await acquireMigrationLock(connection);
      try {
        const dependencySql = await readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact);
        const dependencyChecksum = sha256(dependencySql);
        const dependency = await queryRows<ExecutionRow>(connection, `
          SELECT execution_id,migration_id,checksum,status,body_committed_at,applied_at
          FROM platform.target_migration_executions
          WHERE migration_id='001_central_foundation' AND status='APPLIED'
        `);
        if (dependency.length !== 1 || !sameChecksum(dependency[0]!.checksum, dependencyChecksum)) {
          throw new MigrationInvariantError("002 requires approved 001 APPLIED dependency");
        }
        await validatePostgresCatalog(connection);
        const prerequisiteState = await ensureBtreeGist(connection);
        const rows = await executionRows(connection, POSTGRES_002_MIGRATION_ID);
        assertExecutionChecksums(rows, checksum, POSTGRES_002_MIGRATION_ID);
        const applied = rows.find((row) => row.status === "APPLIED");
        if (applied) {
          await validatePostgres002Catalog(connection);
          return { executionId: applied.execution_id, noOp: true, reconciled: false, checksumHex, prerequisiteState };
        }
        const started = rows.find((row) => row.status === "STARTED");
        if (started) {
          const state = await integrationsCatalogState(connection);
          if (state === "partial") throw new MigrationInvariantError("STARTED 002 execution has divergent catalog");
          if (state === "target-002") {
            if (started.body_committed_at === null) await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() WHERE execution_id=${started.execution_id}::uuid`.execute(connection);
            await validatePostgres002Catalog(connection);
            if (!config.skipSmoke) await runPostgres002Smoke(config.adminUrl);
            await finishApplied(connection, started.execution_id);
            return { executionId: started.execution_id, noOp: false, reconciled: true, checksumHex, prerequisiteState };
          }
          await markFailed(connection, started.execution_id, "RECONCILED_PRE_002");
        }
        const executionId = uuidV7();
        await sql`INSERT INTO platform.target_migration_executions
          (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version)
          VALUES (${executionId}::uuid,${POSTGRES_002_MIGRATION_ID},'POSTGRESQL',${POSTGRES_002_DESCRIPTOR.manifestVersion},${checksum},'STARTED',clock_timestamp(),${RUNNER_VERSION})`.execute(connection);
        if (config.simulateCrashAfterStarted) throw new SimulatedCrashError("simulated 002 crash after STARTED");
        try {
          await connection.transaction().execute(async (transaction) => {
            await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
            await executeRaw(transaction, upSql);
            if (config.injectBodyFailure) await executeRaw(transaction, "SELECT missing_injected_002_body_function()");
            await validatePostgres002Catalog(transaction);
          });
        } catch (error) {
          await markFailed(connection, executionId, "BODY_002_ROLLED_BACK");
          throw error;
        }
        if (config.simulateCrashAfterBodyCommit) throw new SimulatedCrashError("simulated 002 crash after body COMMIT");
        await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() WHERE execution_id=${executionId}::uuid AND status='STARTED'`.execute(connection);
        await validatePostgres002Catalog(connection);
        if (!config.skipSmoke) await runPostgres002Smoke(config.adminUrl);
        await finishApplied(connection, executionId);
        return { executionId, noOp: false, reconciled: false, checksumHex, prerequisiteState };
      } finally {
        await releaseMigrationLock(connection);
        await executeRaw(connection, "RESET ROLE");
      }
    });
  } finally {
    await migrator.destroy();
    await admin.destroy();
  }
}

export async function downPostgres002(config: Pick<PostgresRunnerConfig,"adminUrl"|"migratorUrl">): Promise<void> {
  const migratorUrl = config.migratorUrl ?? roleConnectionUrl(config.adminUrl, "pos_migrator");
  const migrator = postgresDatabase(migratorUrl, 1);
  const downSql = await readArtifact(POSTGRES_002_DESCRIPTOR.downArtifact);
  const upSql = await readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  try {
    await migrator.connection().execute(async (connection) => {
      await executeRaw(connection, "SET ROLE pos_schema_owner");
      await acquireMigrationLock(connection);
      try {
        const rows = await executionRows(connection, POSTGRES_002_MIGRATION_ID);
        assertExecutionChecksums(rows, checksum, POSTGRES_002_MIGRATION_ID);
        const initialState = await integrationsCatalogState(connection);
        if (initialState === "pre-002") {
          const latest = rows[0];
          const activeStarted = rows.some((row) => row.status === "STARTED");
          if (latest?.status === "ROLLED_BACK" && !activeStarted) return;
          if (latest?.status === "STARTED") throw new MigrationInvariantError("down 002 rejected because latest execution is active STARTED");
          throw new MigrationInvariantError("pre-002 catalog is not backed by latest ROLLED_BACK execution");
        }
        await validatePostgres002Catalog(connection);
        const execution = rows.find((row) => row.status==="APPLIED" || (row.status==="STARTED" && row.body_committed_at!==null));
        if (!execution) {
          throw new MigrationInvariantError("no committed 002 execution is eligible for down");
        }
        const counts = await queryRows<{ row_count: string }>(connection, `SELECT (${INTEGRATION_TABLES.map((table) => `(SELECT count(*) FROM integrations.${table})`).join(" + ")})::text AS row_count`);
        if (Number(counts[0]!.row_count)!==0) throw new MigrationInvariantError("down 002 refused because integration data exists");
        await connection.transaction().execute(async (transaction) => {
          await executeRaw(transaction, "SET LOCAL ROLE pos_schema_owner");
          await executeRaw(transaction, downSql);
          if (await integrationsCatalogState(transaction) !== "pre-002") throw new MigrationInvariantError("down 002 did not restore pre-002 catalog");
          await validatePostgresCatalog(transaction);
          await validateBtreeGist(transaction);
        });
        await sql`UPDATE platform.target_migration_executions SET status='ROLLED_BACK',rolled_back_at=clock_timestamp(),finished_at=clock_timestamp() WHERE execution_id=${execution.execution_id}::uuid`.execute(connection);
      } finally {
        await releaseMigrationLock(connection);
        await executeRaw(connection, "RESET ROLE");
      }
    });
  } finally {
    await migrator.destroy();
  }
}
