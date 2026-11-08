import {isSupportedMigrationPostgresVersion} from "./postgres-compatibility.js";
import { Pool } from "pg";
import { readArtifact, sha256, uuidV7, MigrationInvariantError, POSTGRES_MIGRATION_LOCK_RESOURCE, RUNNER_VERSION } from "./shared.js";
import { POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_003_DESCRIPTOR } from "./contract.js";
import { POSTGRES_004_DESCRIPTOR } from "./postgres-004-contract.js";
import { POSTGRES_005_DESCRIPTOR } from "./postgres-005-contract.js";
import { runPostgres005Smoke } from "./postgres-005-smoke.js";

export interface Postgres005RunnerConfig { adminUrl: string; expectedDatabase: string; repositoryCommit: string; }
export interface Postgres005ApplyResult { executionId: string; noOp: boolean; checksumHex: string; result: "APPLIED" | "ALREADY_APPLIED"; }

function invariant(value: unknown, message: string): asserts value { if (!value) throw new MigrationInvariantError(message); }
function roleUrl(adminUrl: string, role: string): string { const value = new URL(adminUrl); value.username = role; value.password = ""; return value.toString(); }

export async function applyPostgres005(config: Postgres005RunnerConfig): Promise<Postgres005ApplyResult> {
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "005 repository commit must be exact lowercase SHA");
  const upSql = await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  const pool = new Pool({ connectionString: roleUrl(config.adminUrl, "pos_migrator"), max: 1 });
  const client = await pool.connect();
  try {
    const target = await client.query<{ database: string; version: string; session_user: string; current_user: string }>(
      "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user",
    );
    const runtime = target.rows[0];
    invariant(runtime?.database === config.expectedDatabase && isSupportedMigrationPostgresVersion(runtime.version), "005 target mismatch");
    invariant(runtime.session_user === "pos_migrator" && runtime.current_user === "pos_migrator", "005 connection role mismatch");

    await client.query("SET ROLE pos_schema_owner");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try {
      const history = await client.query<{ execution_id: string; checksum: Buffer; status: string; body_committed_at: Date | null }>(
        "SELECT execution_id,checksum,status,body_committed_at FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at DESC",
        [POSTGRES_005_DESCRIPTOR.migrationId],
      );
      for (const row of history.rows) invariant(Buffer.from(row.checksum).equals(checksum), "005 checksum mismatch");
      const applied = history.rows.find((row) => row.status === "APPLIED");
      if (applied) return { executionId: applied.execution_id, noOp: true, checksumHex, result: "ALREADY_APPLIED" };

      const predecessors = [POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_003_DESCRIPTOR, POSTGRES_004_DESCRIPTOR];
      for (const descriptor of predecessors) {
        const expected = sha256(await readArtifact(descriptor.upArtifact));
        const row = await client.query<{ checksum: Buffer }>(
          "SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",
          [descriptor.migrationId],
        );
        invariant(row.rows[0] && Buffer.from(row.rows[0].checksum).equals(expected), "005 predecessor checksum mismatch: " + descriptor.migrationId);
      }

      invariant(!history.rows.some((row) => row.status === "STARTED"), "005 STARTED execution requires reconciliation");

      const executionId = uuidV7();
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES ($1,$2,'POSTGRESQL',$3,$4,'STARTED',clock_timestamp(),$5)",
        [executionId, POSTGRES_005_DESCRIPTOR.migrationId, POSTGRES_005_DESCRIPTOR.manifestVersion, checksum, `${RUNNER_VERSION};migration=005;repo=${config.repositoryCommit}`],
      );
      await client.query("COMMIT");

      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE pos_schema_owner");
        await client.query(upSql);
        const catalog = await client.query<{ present: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='tenancy' AND table_name='onboarding_operations' AND column_name='commercial_reference') present",
        );
        invariant(catalog.rows[0]?.present === true, "005 commercial_reference not materialized");
        const rls = await client.query<{ enabled: boolean; forced: boolean }>(
          "SELECT relrowsecurity enabled,relforcerowsecurity forced FROM pg_class WHERE oid='tenancy.onboarding_operations'::regclass",
        );
        invariant(rls.rows[0]?.enabled === true && rls.rows[0]?.forced === true, "005 onboarding RLS not forced");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query(
          "UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_005_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED' AND body_committed_at IS NULL",
          [executionId],
        );
        throw error;
      }

      // Record irreversible body commit before starting a separate live
      // platform-app RLS smoke. No smoke_verified_at without actual checks.
      // A smoke failure leaves STARTED + body_committed_at for explicit
      // reconciliation, never a blind rerun.
      await client.query(
        "UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED' AND body_committed_at IS NULL",
        [executionId],
      );
      const assertions=await runPostgres005Smoke(config.adminUrl,config.expectedDatabase);
      invariant(assertions===17,"005 physical actor RLS smoke count mismatch");
      await client.query(
        "UPDATE platform.target_migration_executions "+
        "SET smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),"+
        "finished_at=clock_timestamp(),status='APPLIED' "+
        "WHERE execution_id=$1::uuid AND status='STARTED' AND body_committed_at IS NOT NULL",
        [executionId],
      );
      return { executionId, noOp: false, checksumHex, result: "APPLIED" };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
      await client.query("RESET ROLE");
    }
  } finally {
    client.release();
    await pool.end();
  }
}
