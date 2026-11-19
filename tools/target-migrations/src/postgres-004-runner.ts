import { sql } from "kysely";
import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";
import { POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_003_DESCRIPTOR } from "./contract.js";
import { DEVICE_TRUST_004_COLUMNS, POSTGRES_004_DESCRIPTOR } from "./postgres-004-contract.js";
import { MigrationInvariantError, POSTGRES_004_MIGRATION_ID, POSTGRES_MIGRATION_LOCK_RESOURCE, RUNNER_VERSION, readArtifact, sha256, uuidV7 } from "./shared.js";

interface ExecutionRow { execution_id:string; checksum:Buffer; status:"STARTED"|"FAILED"|"APPLIED"|"ROLLED_BACK"; body_committed_at:Date|null; }
export interface Postgres004RunnerConfig { adminUrl:string; migratorUrl?:string; expectedDatabase:string; repositoryCommit:string; }
export interface Postgres004ApplyResult { executionId:string; noOp:boolean; reconciled:boolean; checksumHex:string; result:"APPLIED"|"ALREADY_APPLIED"; }

function invariant(value:unknown,message:string):asserts value { if(!value) throw new MigrationInvariantError(message); }
function roleUrl(adminUrl:string,role:string):string { const value=new URL(adminUrl); value.username=role; value.password=""; return value.toString(); }
function sameChecksum(actual:Buffer,expected:Buffer):boolean { return Buffer.from(actual).equals(expected); }
async function acquireLock(db:SqlExecutor):Promise<void>{ await sql`SELECT pg_advisory_lock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE},0))`.execute(db); }
async function releaseLock(db:SqlExecutor):Promise<void>{ await sql`SELECT pg_advisory_unlock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE},0))`.execute(db); }
async function executionRows(db:SqlExecutor):Promise<ExecutionRow[]> { const result=await sql<ExecutionRow>`SELECT execution_id,checksum,status,body_committed_at FROM platform.target_migration_executions WHERE migration_id=${POSTGRES_004_MIGRATION_ID} ORDER BY started_at DESC`.execute(db); return result.rows; }
async function verifyRuntime(db:SqlExecutor,expectedDatabase:string):Promise<void>{ const row=(await queryRows<{database:string;version:string;session_user:string;current_user:string}>(db,"SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user"))[0]; invariant(row?.database===expectedDatabase&&row.version==="160014","004 target mismatch"); invariant(row.session_user==="pos_migrator"&&row.current_user==="pos_schema_owner","004 migrator identity mismatch"); }
async function verifyPredecessors(db:SqlExecutor):Promise<void>{
  const descriptors=[POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR];
  for(const descriptor of descriptors){
    const checksum=sha256(await readArtifact(descriptor.upArtifact));
    const row=(await queryRows<{checksum:Buffer}>(db,`SELECT checksum FROM platform.target_migration_executions WHERE migration_id='${descriptor.migrationId}' AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1`))[0];
    invariant(!!row&&sameChecksum(row.checksum,checksum),`004 requires exact APPLIED ${descriptor.migrationId}`);
  }
}
async function validateCatalog(db:SqlExecutor):Promise<void>{
  for(const [table,columns] of Object.entries(DEVICE_TRUST_004_COLUMNS)){
    const [schema,name]=table.split(".");
    const rows=await queryRows<{column_name:string}>(db,`SELECT column_name FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${name}'`);
    const actual=new Set(rows.map(row=>row.column_name));
    for(const column of columns) invariant(actual.has(column),`004 missing column ${table}.${column}`);
  }
}

export async function applyPostgres004(config:Postgres004RunnerConfig):Promise<Postgres004ApplyResult>{
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit),"004 repository commit must be exact lowercase SHA");
  const migrator=postgresDatabase(config.migratorUrl??roleUrl(config.adminUrl,"pos_migrator"),1);
  const upSql=await readArtifact(POSTGRES_004_DESCRIPTOR.upArtifact); const checksum=sha256(upSql); const checksumHex=checksum.toString("hex");
  try{return await migrator.connection().execute(async connection=>{
    await executeRaw(connection,"SET ROLE pos_schema_owner"); await acquireLock(connection);
    try{
      await verifyRuntime(connection,config.expectedDatabase);
      const rows=await executionRows(connection);
      for(const row of rows) invariant(sameChecksum(row.checksum,checksum),"004 checksum mismatch");
      const applied=rows.find(row=>row.status==="APPLIED");
      if(applied){ await validateCatalog(connection); return {executionId:applied.execution_id,noOp:true,reconciled:false,checksumHex,result:"ALREADY_APPLIED"}; }
      await verifyPredecessors(connection);
      const existing=rows.find(row=>row.status==="STARTED");
      if(existing) invariant(existing.body_committed_at===null,"004 STARTED execution requires manual reconciliation before retry");
      const executionId=uuidV7();
      await sql`INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES (${executionId}::uuid,${POSTGRES_004_MIGRATION_ID},'POSTGRESQL',${POSTGRES_004_DESCRIPTOR.manifestVersion},${checksum},'STARTED',clock_timestamp(),${`${RUNNER_VERSION};migration=004;repo=${config.repositoryCommit}`})`.execute(connection);
      try{
        await connection.transaction().execute(async transaction=>{ await executeRaw(transaction,"SET LOCAL ROLE pos_schema_owner"); await executeRaw(transaction,upSql); await validateCatalog(transaction); });
      }catch(error){ await sql`UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_004_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=${executionId}::uuid AND status='STARTED' AND body_committed_at IS NULL`.execute(connection); throw error; }
      await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp(),status='APPLIED' WHERE execution_id=${executionId}::uuid AND status='STARTED'`.execute(connection);
      return {executionId,noOp:false,reconciled:false,checksumHex,result:"APPLIED"};
    }finally{ await releaseLock(connection); await executeRaw(connection,"RESET ROLE"); }
  });}finally{ await migrator.destroy(); }
}
