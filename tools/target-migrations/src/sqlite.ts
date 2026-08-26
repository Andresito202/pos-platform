import { sql } from "kysely";
import { executeRaw, queryRows, sqliteDatabase } from "./database.js";
import {
  MANIFEST_VERSION,
  MigrationInvariantError,
  RUNNER_VERSION,
  SQLITE_MIGRATION_ID,
  SimulatedCrashError,
  isoNow,
  readArtifact,
  sha256,
  uuidV7,
} from "./shared.js";

const SQLITE_LEDGER_COLUMNS = [
  "execution_id","migration_id","dialect","manifest_version","checksum","status","started_at",
  "body_committed_at","smoke_verified_at","applied_at","rolled_back_at","finished_at","runner_version","error_code",
] as const;

interface SqliteExecutionRow {
  execution_id: string;
  checksum: Buffer;
  status: "STARTED" | "FAILED" | "APPLIED" | "ROLLED_BACK";
  body_committed_at: string | null;
}

export interface SqliteRunnerConfig {
  path: string;
  simulateCrashAfterStarted?: boolean;
}

export interface SqliteApplyResult {
  executionId: string;
  noOp: boolean;
  reconciled: boolean;
  checksumHex: string;
  sqliteVersion: string;
}

async function configureSqlite(path: string) {
  const handle = sqliteDatabase(path);
  await executeRaw(handle.db, "PRAGMA foreign_keys = ON");
  await executeRaw(handle.db, "PRAGMA journal_mode = WAL");
  return handle;
}

async function validateSqlite(handle: ReturnType<typeof sqliteDatabase>): Promise<string> {
  const version = await queryRows<{ version: string }>(handle.db, "SELECT sqlite_version() AS version");
  const foreignKeys = await queryRows<{ foreign_keys: number }>(handle.db, "PRAGMA foreign_keys");
  const journal = await queryRows<{ journal_mode: string }>(handle.db, "PRAGMA journal_mode");
  if (foreignKeys[0]?.foreign_keys !== 1) throw new MigrationInvariantError("SQLite foreign_keys is not ON");
  if (journal[0]?.journal_mode.toLowerCase() !== "wal") throw new MigrationInvariantError("SQLite journal mode is not WAL");

  const columns = await queryRows<{ name: string }>(handle.db, "PRAGMA table_info(target_migration_executions)");
  if (columns.map((row) => row.name).join(",") !== SQLITE_LEDGER_COLUMNS.join(",")) {
    throw new MigrationInvariantError("SQLite ledger columns diverge");
  }
  const indexes = await queryRows<{ name: string }>(handle.db, "PRAGMA index_list(target_migration_executions)");
  const indexNames = indexes.map((row) => row.name);
  if (!indexNames.includes("target_migration_executions_started_uq") || !indexNames.includes("target_migration_executions_applied_uq")) {
    throw new MigrationInvariantError("SQLite ledger indexes diverge");
  }
  const trigger = await queryRows<{ count: number }>(handle.db, "SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='target_migration_executions_transition_guard'");
  if (trigger[0]?.count !== 1) throw new MigrationInvariantError("SQLite transition trigger missing");
  const extraTables = await queryRows<{ name: string }>(handle.db, "SELECT name FROM sqlite_schema WHERE type='table' AND name <> 'target_migration_executions' AND name NOT LIKE 'sqlite_%'");
  if (extraTables.length !== 0) throw new MigrationInvariantError(`SQLite scope expanded: ${extraTables.map((row) => row.name).join(",")}`);
  return version[0]!.version;
}

async function bootstrapSqlite(path: string, bootstrapSql: string): Promise<string> {
  let handle = await configureSqlite(path);
  try {
    await executeRaw(handle.db, "BEGIN IMMEDIATE");
    try {
      const table = await queryRows<{ count: number }>(handle.db, "SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name='target_migration_executions'");
      if (table[0]!.count === 0) {
        for (const statement of bootstrapSql.split("-- statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
          await executeRaw(handle.db, statement);
        }
      }
      await validateSqlite(handle);
      await executeRaw(handle.db, "COMMIT");
    } catch (error) {
      await executeRaw(handle.db, "ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await handle.db.destroy();
  }

  handle = await configureSqlite(path);
  try {
    return await validateSqlite(handle);
  } finally {
    await handle.db.destroy();
  }
}

export async function applySqlite001(config: SqliteRunnerConfig): Promise<SqliteApplyResult> {
  const bootstrapSql = await readArtifact("sqlite/bootstrap.sql");
  const checksum = sha256(bootstrapSql);
  const checksumHex = checksum.toString("hex");
  let sqliteVersion = await bootstrapSqlite(config.path, bootstrapSql);
  const handle = await configureSqlite(config.path);
  try {
    await executeRaw(handle.db, "BEGIN IMMEDIATE");
    try {
      const executions = await sql<SqliteExecutionRow>`
        SELECT execution_id, checksum, status, body_committed_at
        FROM target_migration_executions WHERE migration_id = ${SQLITE_MIGRATION_ID}
        ORDER BY started_at DESC
      `.execute(handle.db);
      for (const row of executions.rows) {
        if (!Buffer.from(row.checksum).equals(checksum)) throw new MigrationInvariantError("checksum mismatch for 001_local_migration_control");
      }

      const applied = executions.rows.find((row) => row.status === "APPLIED");
      if (applied) {
        sqliteVersion = await validateSqlite(handle);
        await executeRaw(handle.db, "COMMIT");
        return { executionId: applied.execution_id, noOp: true, reconciled: false, checksumHex, sqliteVersion };
      }

      const started = executions.rows.find((row) => row.status === "STARTED");
      if (started) {
        sqliteVersion = await validateSqlite(handle);
        if (started.body_committed_at === null) {
          await sql`UPDATE target_migration_executions SET body_committed_at = ${isoNow()} WHERE execution_id = ${started.execution_id}`.execute(handle.db);
        }
        const now = isoNow();
        await sql`UPDATE target_migration_executions SET status='APPLIED', smoke_verified_at=${now}, applied_at=${now}, finished_at=${now} WHERE execution_id=${started.execution_id}`.execute(handle.db);
        await executeRaw(handle.db, "COMMIT");
        return { executionId: started.execution_id, noOp: false, reconciled: true, checksumHex, sqliteVersion };
      }

      const executionId = uuidV7();
      await sql`
        INSERT INTO target_migration_executions (
          execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version
        ) VALUES (
          ${executionId},${SQLITE_MIGRATION_ID},'SQLITE',${MANIFEST_VERSION},${checksum},'STARTED',${isoNow()},${RUNNER_VERSION}
        )
      `.execute(handle.db);

      if (config.simulateCrashAfterStarted) {
        await executeRaw(handle.db, "COMMIT");
        throw new SimulatedCrashError("simulated SQLite crash after STARTED");
      }

      sqliteVersion = await validateSqlite(handle);
      await sql`UPDATE target_migration_executions SET body_committed_at=${isoNow()} WHERE execution_id=${executionId}`.execute(handle.db);
      const now = isoNow();
      await sql`UPDATE target_migration_executions SET status='APPLIED', smoke_verified_at=${now}, applied_at=${now}, finished_at=${now} WHERE execution_id=${executionId}`.execute(handle.db);
      await executeRaw(handle.db, "COMMIT");
      return { executionId, noOp: false, reconciled: false, checksumHex, sqliteVersion };
    } catch (error) {
      await executeRaw(handle.db, "ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await handle.db.destroy();
  }
}

export async function inspectSqlite001(path: string): Promise<{ sqliteVersion: string; foreignKeys: number; journalMode: string; tableCount: number }> {
  const handle = await configureSqlite(path);
  try {
    const sqliteVersion = await validateSqlite(handle);
    const foreignKeys = await queryRows<{ foreign_keys: number }>(handle.db, "PRAGMA foreign_keys");
    const journal = await queryRows<{ journal_mode: string }>(handle.db, "PRAGMA journal_mode");
    const tables = await queryRows<{ count: number }>(handle.db, "SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    return { sqliteVersion, foreignKeys: foreignKeys[0]!.foreign_keys, journalMode: journal[0]!.journal_mode, tableCount: tables[0]!.count };
  } finally {
    await handle.db.destroy();
  }
}
