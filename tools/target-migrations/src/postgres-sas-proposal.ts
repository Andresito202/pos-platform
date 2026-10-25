import {readArtifact,sha256,MigrationInvariantError} from "./shared.js";
import {queryRows,type SqlExecutor} from "./database.js";

/** Runner preparation only. Deliberately NOT a registered MigrationDescriptor,
 * migration number, CLI, apply function or production deployment permission. */
export async function prepareSasMigrationProposal(){
  const paths=["postgres/proposals/sas_sequences.up.sql","postgres/proposals/sas_sources_read_lock.up.sql",
    "postgres/proposals/sas_sources_read_lock.down.sql","postgres/proposals/sas_sequences.down.sql"] as const;
  const artifacts=await Promise.all(paths.map(async path=>({path,checksum:sha256(await readArtifact(path)).toString("hex")})));
  return {registered:false as const,migrationId:null,approvedPredecessors:null,
    schemaInputs:["001_central_foundation","004_device_trust"],artifacts,
    runnerProtocol:"existing global migration lock, checksum ledger, transactional body, catalog/smoke, APPLIED; no auto-registration"};
}

/** Read-only catalog gate reusable by the existing runner after approval. */
export async function verifySasProposalCatalog(db:SqlExecutor):Promise<void>{
  const invariant=(value:unknown,message:string)=>{if(!value)throw new MigrationInvariantError(message);};
  const table=(await queryRows<{rls:boolean;forced:boolean;owner:string}>(db,`SELECT c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,r.rolname AS owner
    FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=to_regclass('authorization.snapshot_sequences')`))[0];
  invariant(table?.rls&&table.forced&&table.owner==="pos_schema_owner","SAS counter ownership/RLS mismatch");
  const columns=await queryRows<{column_name:string}>(db,"SELECT column_name FROM information_schema.columns WHERE table_schema='authorization' AND table_name='snapshot_sequences'");
  invariant(["user_id","installation_id","device_id","last_issued_sequence","snapshot_id","source_checksum","created_at","updated_at"].every(n=>columns.some(c=>c.column_name===n)),"SAS counter catalog incomplete");
  const fn=(await queryRows<{prosecdef:boolean;proconfig:string[];owner:string;prosrc:string}>(db,`SELECT p.prosecdef,p.proconfig,p.prosrc,r.rolname AS owner FROM pg_proc p
    JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('authorization.lock_sas_sources_for_read()')`))[0];
  invariant(fn?.prosecdef&&fn.owner==="pos_schema_owner"&&fn.proconfig?.length===1&&fn.proconfig[0]==="search_path=pg_catalog","SAS read lock definer mismatch");
  const artifact=await readArtifact("postgres/proposals/sas_sources_read_lock.up.sql");
  invariant(fn?.prosrc.trim()===artifact.split("$function$")[1]?.trim(),"SAS read lock body drift");
  const central=(await queryRows<{execute:boolean;read:boolean;insert:boolean;remove:boolean}>(db,`SELECT
    has_function_privilege('pos_platform_app','authorization.lock_sas_sources_for_read()','EXECUTE') AS execute,
    has_table_privilege('pos_platform_app','authorization.snapshot_sequences','SELECT') AS read,
    has_table_privilege('pos_platform_app','authorization.snapshot_sequences','INSERT') AS insert,
    has_table_privilege('pos_platform_app','authorization.snapshot_sequences','DELETE') AS remove`))[0];
  invariant(central?.execute&&central.read&&central.insert&&!central.remove,"SAS counter/lock runtime grants mismatch");
  for(const source of ["roles","permissions","role_permission_grants"]){
    const row=(await queryRows<{allowed:boolean}>(db,`SELECT has_any_column_privilege('pos_platform_app','authorization.${source}','UPDATE') AS allowed`))[0];
    invariant(row?.allowed===false,"SAS runtime must not gain UPDATE over RBAC");
  }
  for(const role of ["pos_app","pos_worker","pos_platform_admin"]){
    const row=(await queryRows<{allowed:boolean}>(db,`SELECT has_function_privilege('${role}','authorization.lock_sas_sources_for_read()','EXECUTE') AS allowed`))[0];
    invariant(row?.allowed===false,"SAS lock function exposed outside Central");
  }
}
