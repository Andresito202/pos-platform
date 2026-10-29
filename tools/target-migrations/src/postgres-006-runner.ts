import { Pool } from "pg";
import { MigrationInvariantError, POSTGRES_MIGRATION_LOCK_RESOURCE, RUNNER_VERSION, readArtifact, sha256, uuidV7 } from "./shared.js";
import {runPostgres006Smoke} from "./postgres-006-007-smoke.js";
import { POSTGRES_005_DESCRIPTOR } from "./postgres-005-contract.js";
import { POSTGRES_006_DESCRIPTOR, LICENSING_006_TABLES } from "./postgres-006-contract.js";

export interface Postgres006RunnerConfig {
  adminUrl: string;
  expectedDatabase: string;
  repositoryCommit: string;
}
export interface Postgres006ApplyResult {
  executionId: string;
  noOp: boolean;
  checksumHex: string;
  result: "APPLIED" | "ALREADY_APPLIED";
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new MigrationInvariantError(message);
}
function roleUrl(adminUrl: string, role: string): string {
  const value = new URL(adminUrl);
  value.username = role;
  value.password = "";
  return value.toString();
}

export async function applyPostgres006(config: Postgres006RunnerConfig): Promise<Postgres006ApplyResult> {
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "006 repository commit must be exact lowercase SHA");
  const upSql = await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  const pool = new Pool({ connectionString: roleUrl(config.adminUrl, "pos_migrator"), max: 1 });
  const client = await pool.connect();
  try {
    const target = await client.query<{ database: string; version: string; session_user: string; current_user: string }>(
      "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user",
    );
    const runtime = target.rows[0];
    invariant(runtime?.database === config.expectedDatabase && runtime.version === "160014", "006 target mismatch");
    invariant(runtime.session_user === "pos_migrator" && runtime.current_user === "pos_migrator", "006 connection role mismatch");

    await client.query("SET ROLE pos_schema_owner");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try {
      const history = await client.query<{ execution_id: string; checksum: Buffer; status: string }>(
        "SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at DESC",
        [POSTGRES_006_DESCRIPTOR.migrationId],
      );
      for (const row of history.rows) invariant(Buffer.from(row.checksum).equals(checksum), "006 checksum mismatch");
      const applied = history.rows.find((row) => row.status === "APPLIED");
      if (applied) return { executionId: applied.execution_id, noOp: true, checksumHex, result: "ALREADY_APPLIED" };

      invariant(!history.rows.some((row) => row.status === "STARTED"), "006 STARTED execution requires reconciliation");

      const predecessorChecksum = sha256(await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact));
      const predecessor = await client.query<{ checksum: Buffer }>(
        "SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",
        [POSTGRES_005_DESCRIPTOR.migrationId],
      );
      invariant(predecessor.rows[0] && Buffer.from(predecessor.rows[0].checksum).equals(predecessorChecksum), "006 predecessor checksum mismatch");

      const executionId = uuidV7();
      await client.query(
        "INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES ($1,$2,'POSTGRESQL',$3,$4,'STARTED',clock_timestamp(),$5)",
        [executionId, POSTGRES_006_DESCRIPTOR.migrationId, POSTGRES_006_DESCRIPTOR.manifestVersion, checksum, `${RUNNER_VERSION};migration=006;repo=${config.repositoryCommit}`],
      );

      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE pos_schema_owner");
        await client.query(upSql);
        for (const table of LICENSING_006_TABLES) {
          const [schema, name] = table.split(".");
          const check = await client.query<{ present: boolean }>(
            "SELECT to_regclass($1) IS NOT NULL AS present",
            [`${schema}.${name}`],
          );
          invariant(check.rows[0]?.present === true, `006 table missing: ${table}`);
        }
        const rls = await client.query<{ enabled: boolean; forced: boolean }>(
          "SELECT bool_and(c.relrowsecurity) enabled,bool_and(c.relforcerowsecurity) forced FROM pg_class c WHERE c.oid IN ('licensing.plans'::regclass,'licensing.plan_entitlements'::regclass,'licensing.licenses'::regclass,'licensing.license_entitlements'::regclass)",
        );
        invariant(rls.rows[0]?.enabled === true && rls.rows[0]?.forced === true, "006 licensing RLS not forced");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query(
          "UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_006_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED'",
          [executionId],
        );
        throw error;
      }

      // The DDL is durably committed. Record body completion before testing
      // each actual login role on a separate connection. Failures leave
      // STARTED+body_committed for manual reconciliation; no false smoke stamp.
      await client.query(
        "UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() "+
        "WHERE execution_id=$1::uuid AND status='STARTED' AND body_committed_at IS NULL",
        [executionId],
      );
      const roleAssertions=await runPostgres006Smoke(config.adminUrl,config.expectedDatabase);
      invariant(roleAssertions===132,"006 physical four-role ACL smoke count mismatch");
      await client.query(
        "UPDATE platform.target_migration_executions SET smoke_verified_at=clock_timestamp(),"+
        "applied_at=clock_timestamp(),finished_at=clock_timestamp(),status='APPLIED' "+
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
