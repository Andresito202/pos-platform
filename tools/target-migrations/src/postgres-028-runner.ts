/**
 * Isolated lab apply for 028_sync_domain_projections.
 * Predecessor: 001_central_foundation (sync schema). Commercial full-chain
 * apply remains via applyCommercialMigrations(MERCHANT_NOTIFICATIONS) after 027.
 */
import { isSupportedMigrationPostgresVersion } from "./postgres-compatibility.js";
import { Pool } from "pg";
import { POSTGRES_001_DESCRIPTOR } from "./contract.js";
import { POSTGRES_028_DESCRIPTOR } from "./postgres-028-domain-projections-contract.js";
import {
  MigrationInvariantError,
  POSTGRES_MIGRATION_LOCK_RESOURCE,
  RUNNER_VERSION,
  readArtifact,
  sha256,
  uuidV7,
} from "./shared.js";

export interface Postgres028RunnerConfig {
  adminUrl: string;
  expectedDatabase: string;
  repositoryCommit: string;
}

export interface Postgres028ApplyResult {
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

export async function applyPostgres028(config: Postgres028RunnerConfig): Promise<Postgres028ApplyResult> {
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "028 repository commit must be exact lowercase SHA");
  const upSql = await readArtifact(POSTGRES_028_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  const pool = new Pool({ connectionString: roleUrl(config.adminUrl, "pos_migrator"), max: 1 });
  const client = await pool.connect();
  try {
    const target = await client.query<{ database: string; version: string; session_user: string; current_user: string }>(
      "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user",
    );
    const runtime = target.rows[0];
    invariant(runtime?.database === config.expectedDatabase && isSupportedMigrationPostgresVersion(runtime.version), "028 target mismatch");
    invariant(runtime.session_user === "pos_migrator" && runtime.current_user === "pos_migrator", "028 connection role mismatch");

    await client.query("SET ROLE pos_schema_owner");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try {
      const history = await client.query<{ execution_id: string; checksum: Buffer; status: string }>(
        "SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at DESC",
        [POSTGRES_028_DESCRIPTOR.migrationId],
      );
      for (const row of history.rows) invariant(Buffer.from(row.checksum).equals(checksum), "028 checksum mismatch");
      const applied = history.rows.find((row) => row.status === "APPLIED");
      if (applied) {
        return { executionId: applied.execution_id, noOp: true, checksumHex, result: "ALREADY_APPLIED" };
      }

      const foundation = await client.query<{ checksum: Buffer }>(
        "SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",
        [POSTGRES_001_DESCRIPTOR.migrationId],
      );
      const expected001 = sha256(await readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact));
      invariant(
        foundation.rows[0] && Buffer.from(foundation.rows[0].checksum).equals(expected001),
        "028 requires applied 001_central_foundation",
      );
      invariant(!history.rows.some((row) => row.status === "STARTED"), "028 STARTED execution requires reconciliation");

      const executionId = uuidV7();
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES ($1,$2,'POSTGRESQL',$3,$4,'STARTED',clock_timestamp(),$5)",
        [executionId, POSTGRES_028_DESCRIPTOR.migrationId, POSTGRES_028_DESCRIPTOR.manifestVersion, checksum, `${RUNNER_VERSION};migration=028;repo=${config.repositoryCommit}`],
      );
      await client.query("COMMIT");

      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE pos_schema_owner");
        await client.query(upSql);
        const catalog = await client.query<{ present: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sync' AND table_name='domain_projections') present",
        );
        invariant(catalog.rows[0]?.present === true, "028 domain_projections not materialized");
        const rls = await client.query<{ enabled: boolean; forced: boolean }>(
          "SELECT relrowsecurity enabled,relforcerowsecurity forced FROM pg_class WHERE oid='sync.domain_projections'::regclass",
        );
        invariant(rls.rows[0]?.enabled === true && rls.rows[0]?.forced === true, "028 domain_projections RLS not forced");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query(
          "UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_028_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED' AND body_committed_at IS NULL",
          [executionId],
        );
        throw error;
      }

      await client.query(
        "UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp(),status='APPLIED' WHERE execution_id=$1::uuid AND status='STARTED'",
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
