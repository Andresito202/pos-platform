import { Pool } from "pg";
import { MigrationInvariantError, POSTGRES_MIGRATION_LOCK_RESOURCE, RUNNER_VERSION, readArtifact, sha256, uuidV7 } from "./shared.js";
import { POSTGRES_007_DESCRIPTOR } from "./postgres-007-contract.js";
import { POSTGRES_008_DESCRIPTOR, PLATFORM_ROLE_008_COLUMNS, PLATFORM_ROLE_008_TABLES } from "./postgres-008-platform-roles-contract.js";

export interface Postgres008RunnerConfig { adminUrl: string; expectedDatabase: string; repositoryCommit: string; }
export interface Postgres008ApplyResult { executionId: string; noOp: boolean; checksumHex: string; result: "APPLIED" | "ALREADY_APPLIED"; }

function invariant(value: unknown, message: string): asserts value { if (!value) throw new MigrationInvariantError(message); }
function roleUrl(adminUrl: string, role: string): string { const value = new URL(adminUrl); value.username = role; value.password = ""; return value.toString(); }

export async function applyPostgres008(config: Postgres008RunnerConfig): Promise<Postgres008ApplyResult> {
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "008 repository commit must be exact lowercase SHA");
  const upSql = await readArtifact(POSTGRES_008_DESCRIPTOR.upArtifact);
  const checksum = sha256(upSql);
  const checksumHex = checksum.toString("hex");
  const pool = new Pool({ connectionString: roleUrl(config.adminUrl, "pos_migrator"), max: 1 });
  const client = await pool.connect();
  try {
    const target = await client.query<{database:string;version:string;session_user:string;current_user:string}>("SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user");
    const runtime = target.rows[0];
    invariant(runtime?.database === config.expectedDatabase && runtime.version === "160014", "008 target mismatch");
    invariant(runtime.session_user === "pos_migrator" && runtime.current_user === "pos_migrator", "008 connection role mismatch");
    await client.query("SET ROLE pos_schema_owner");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try {
      const history = await client.query<{execution_id:string;checksum:Buffer;status:string}>("SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at DESC",[POSTGRES_008_DESCRIPTOR.migrationId]);
      for (const row of history.rows) invariant(Buffer.from(row.checksum).equals(checksum), "008 checksum mismatch");
      const applied = history.rows.find((row) => row.status === "APPLIED");
      if (applied) return { executionId: applied.execution_id, noOp: true, checksumHex, result: "ALREADY_APPLIED" };
      invariant(!history.rows.some((row) => row.status === "STARTED"), "008 STARTED execution requires reconciliation");
      const predecessorChecksum = sha256(await readArtifact(POSTGRES_007_DESCRIPTOR.upArtifact));
      const predecessor = await client.query<{checksum:Buffer}>("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[POSTGRES_007_DESCRIPTOR.migrationId]);
      invariant(predecessor.rows[0] && Buffer.from(predecessor.rows[0].checksum).equals(predecessorChecksum), "008 predecessor checksum mismatch");
      const executionId = uuidV7();
      await client.query("INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES ($1,$2,'POSTGRESQL',$3,$4,'STARTED',clock_timestamp(),$5)",[executionId,POSTGRES_008_DESCRIPTOR.migrationId,POSTGRES_008_DESCRIPTOR.manifestVersion,checksum,RUNNER_VERSION + ";migration=008;repo=" + config.repositoryCommit]);
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE pos_schema_owner");
        await client.query(upSql);
        for (const table of PLATFORM_ROLE_008_TABLES) {
          const check = await client.query<{present:boolean}>("SELECT to_regclass($1) IS NOT NULL AS present",[table]);
          invariant(check.rows[0]?.present === true, "008 table missing: " + table);
        }
        const columns = await client.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='authorization' AND table_name='platform_role_assignments' ORDER BY ordinal_position");
        invariant(columns.rows.map((row) => row.column_name).join(",") === PLATFORM_ROLE_008_COLUMNS.join(","), "008 platform role assignment column contract mismatch");
        const rls = await client.query<{enabled:boolean;forced:boolean}>("SELECT c.relrowsecurity enabled,c.relforcerowsecurity forced FROM pg_class c WHERE c.oid='authorization.platform_role_assignments'::regclass");
        invariant(rls.rows[0]?.enabled === true && rls.rows[0]?.forced === true, "008 platform role assignment RLS not forced");
        const policy = await client.query<{present:boolean}>("SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='authorization' AND tablename='platform_role_assignments' AND policyname='platform_role_assignments_platform_only') AS present");
        invariant(policy.rows[0]?.present === true, "008 platform role assignment RLS policy missing");
        const roleScopeFk = await client.query<{present:boolean}>("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='authorization.platform_role_assignments'::regclass AND conname='platform_role_assignments_role_scope_fk' AND contype='f') AS present");
        invariant(roleScopeFk.rows[0]?.present === true, "008 platform role scope FK missing");
        const auditTrigger = await client.query<{present:boolean}>("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='authorization.platform_role_assignments'::regclass AND tgname='platform_role_assignment_audit_guard' AND NOT tgisinternal) AS present");
        invariant(auditTrigger.rows[0]?.present === true, "008 platform role assignment audit trigger missing");
        const auditFunction = await client.query<{present:boolean}>("SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='authorization' AND p.proname='audit_platform_role_assignment_change') AS present");
        invariant(auditFunction.rows[0]?.present === true, "008 platform role assignment audit function missing");
        const grants = await client.query<{appWrite:boolean;adminRead:boolean;businessDenied:boolean}>("SELECT has_table_privilege('pos_platform_app','authorization.platform_role_assignments','INSERT') AND has_table_privilege('pos_platform_app','authorization.platform_role_assignments','UPDATE') AS \"appWrite\", has_table_privilege('pos_platform_admin','authorization.platform_role_assignments','SELECT') AS \"adminRead\", NOT has_table_privilege('pos_app','authorization.platform_role_assignments','SELECT') AND NOT has_table_privilege('pos_worker','authorization.platform_role_assignments','SELECT') AS \"businessDenied\"");
        invariant(grants.rows[0]?.appWrite === true && grants.rows[0]?.adminRead === true && grants.rows[0]?.businessDenied === true, "008 role grants mismatch");
        await client.query("COMMIT");
      } catch(error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query("UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_008_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1::uuid AND status='STARTED'",[executionId]);
        throw error;
      }
      await client.query("UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp(),status='APPLIED' WHERE execution_id=$1::uuid AND status='STARTED'",[executionId]);
      return { executionId, noOp:false, checksumHex, result:"APPLIED" };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);
      await client.query("RESET ROLE");
    }
  } finally { client.release(); await pool.end(); }
}
