import { Pool } from "pg";
import { MigrationInvariantError, POSTGRES_MIGRATION_LOCK_RESOURCE, RUNNER_VERSION, readArtifact, sha256, uuidV7 } from "./shared.js";
import { POSTGRES_002_DESCRIPTOR } from "./contract.js";
import { POSTGRES_007_DESCRIPTOR } from "./postgres-007-contract.js";
import { POSTGRES_009_DESCRIPTOR, FACTUS_PAY_009_TABLES } from "./postgres-009-contract.js";

export interface Postgres009RunnerConfig { adminUrl: string; expectedDatabase: string; repositoryCommit: string; }
export interface Postgres009ApplyResult { executionId: string; noOp: boolean; checksumHex: string; result: "APPLIED" | "ALREADY_APPLIED"; }

function invariant(value: unknown, message: string): asserts value { if (!value) throw new MigrationInvariantError(message); }
function roleUrl(adminUrl: string, role: string): string { const value = new URL(adminUrl); value.username = role; value.password = ""; return value.toString(); }

export async function applyPostgres009(config: Postgres009RunnerConfig): Promise<Postgres009ApplyResult> {
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "009 repository commit must be exact lowercase SHA");
  const upSql = await readArtifact(POSTGRES_009_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  const pool = new Pool({ connectionString: roleUrl(config.adminUrl, "pos_migrator"), max: 1 });
  const client = await pool.connect();
  try {
    const target = await client.query<{database:string;version:string;session_user:string;current_user:string}>(
      "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user");
    const runtime = target.rows[0];
    invariant(runtime?.database === config.expectedDatabase && runtime.version === "160014", "009 target mismatch");
    invariant(runtime.session_user === "pos_migrator" && runtime.current_user === "pos_migrator", "009 connection role mismatch");
    await client.query("SET ROLE pos_schema_owner");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try {
      const history = await client.query<{execution_id:string;checksum:Buffer;status:string}>(
        "SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at DESC",
        [POSTGRES_009_DESCRIPTOR.migrationId]);
      for (const row of history.rows) invariant(Buffer.from(row.checksum).equals(checksum), "009 checksum mismatch");
      const applied = history.rows.find((row) => row.status === "APPLIED");
      if (applied) return { executionId: applied.execution_id, noOp: true, checksumHex, result: "ALREADY_APPLIED" };
      invariant(!history.rows.some((row) => row.status === "STARTED"), "009 STARTED execution requires reconciliation");

      for (const predecessor of [
        { descriptor: POSTGRES_002_DESCRIPTOR, path: POSTGRES_002_DESCRIPTOR.upArtifact },
        { descriptor: POSTGRES_007_DESCRIPTOR, path: POSTGRES_007_DESCRIPTOR.upArtifact },
      ]) {
        const expected = sha256(await readArtifact(predecessor.path));
        const found = await client.query<{checksum:Buffer}>(
          "SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",
          [predecessor.descriptor.migrationId]);
        invariant(found.rows[0] && Buffer.from(found.rows[0].checksum).equals(expected),
          "009 predecessor checksum mismatch: " + predecessor.descriptor.migrationId);
      }

      const executionId = uuidV7();
      await client.query(
        "INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES ($1,$2,'POSTGRESQL',$3,$4,'STARTED',clock_timestamp(),$5)",
        [executionId, POSTGRES_009_DESCRIPTOR.migrationId, POSTGRES_009_DESCRIPTOR.manifestVersion, checksum, RUNNER_VERSION + ";migration=009;repo=" + config.repositoryCommit]);
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE pos_schema_owner");
        await client.query(upSql);
        for (const table of FACTUS_PAY_009_TABLES) {
          const check = await client.query<{present:boolean}>("SELECT to_regclass($1) IS NOT NULL AS present", [table]);
          invariant(check.rows[0]?.present === true, "009 table missing: " + table);
        }
        const rls = await client.query<{table_name:string;enabled:boolean;forced:boolean}>(
          "SELECT c.relname table_name,c.relrowsecurity enabled,c.relforcerowsecurity forced FROM pg_class c WHERE c.oid IN ('integrations.factus_pay_webhook_keys'::regclass,'integrations.factus_pay_webhook_inbox'::regclass) ORDER BY c.relname");
        invariant(rls.rows.length === 2 && rls.rows.every((row) => row.enabled && row.forced), "009 RLS not forced");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query("UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_009_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED'", [executionId]);
        throw error;
      }
      await client.query("UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp(),status='APPLIED' WHERE execution_id=$1::uuid AND status='STARTED'", [executionId]);
      return { executionId, noOp: false, checksumHex, result: "APPLIED" };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
      await client.query("RESET ROLE");
    }
  } finally { client.release(); await pool.end(); }
}
