import { open, readFile } from "node:fs/promises";
import { sql } from "kysely";
import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";
import { POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_003_DESCRIPTOR, FISCAL_TABLES } from "./contract.js";
import { validatePostgres002Catalog } from "./postgres-introspection.js";
import { fiscal003CatalogState, validatePostgres003Catalog } from "./postgres-003-introspection.js";
import { assertMat003BlockersAbsent, lockMat003BlockerTables, runMat003Preflight } from "./postgres-003-preflight.js";
import { canonicalJson } from "./postgres-003-role-readiness.js";
import { runPostgres003Smoke } from "./postgres-003-smoke.js";
import {
  MigrationInvariantError,
  POSTGRES_003_MIGRATION_ID,
  POSTGRES_MIGRATION_LOCK_RESOURCE,
  RUNNER_VERSION,
  readArtifact,
  sha256,
  uuidV7,
  isoNow,
} from "./shared.js";

interface ExecutionRow{
  execution_id:string;checksum:Buffer;status:"STARTED"|"FAILED"|"APPLIED"|"ROLLED_BACK";
  body_committed_at:Date|null;runner_version:string;
}
export interface Postgres003RunnerConfig{
  adminUrl:string;
  migratorUrl?:string;
  expectedDatabase:string;
  environmentId:string;
  repositoryCommit:string;
  receiptOutputPath:string;
  skipSmoke?:boolean;
}
export interface Postgres003ApplyResult{
  executionId:string;
  noOp:boolean;
  reconciled:boolean;
  checksumHex:string;
  result:"APPLIED_WITH_RECEIPT"|"APPLIED_WITHOUT_DURABLE_RECEIPT"|"ALREADY_APPLIED";
  receiptPath:string|null;
  receiptSha256:string|null;
}
export interface Postgres003DownConfig extends Postgres003RunnerConfig{
  applyReceiptPath:string;
  confirmFreshTestDown:true;
}
interface ApplyReceiptPayload{
  receipt_version:1;
  migration_id:typeof POSTGRES_003_MIGRATION_ID;
  execution_id:string;
  repository_commit:string;
  artifact_sha256:string;
  target:{environment_id:string;database_name:string;postgres_version_num:"160014"};
  runner_version:string;
  applied_at:string;
}
interface ApplyReceipt{receipt_payload:ApplyReceiptPayload;receipt_sha256:string}

function invariant(value:unknown,message:string):asserts value{
  if(!value) throw new MigrationInvariantError(message);
}
function roleUrl(adminUrl:string,role:string):string{
  const value=new URL(adminUrl);value.username=role;value.password="";return value.toString();
}
function validateConfig(config:Postgres003RunnerConfig):void{
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit),"003 repository commit must be exact lowercase SHA");
  invariant(/^[A-Za-z0-9_.-]+$/.test(config.environmentId),"003 environment id invalid");
  invariant(/^[A-Za-z0-9_-]+$/.test(config.expectedDatabase),"003 expected database invalid");
  invariant(config.receiptOutputPath.length>0,"003 receipt path required");
}
async function executionRows(db:SqlExecutor):Promise<ExecutionRow[]>{
  const result=await sql<ExecutionRow>`
    SELECT execution_id,checksum,status,body_committed_at,runner_version
    FROM platform.target_migration_executions
    WHERE migration_id=${POSTGRES_003_MIGRATION_ID}
    ORDER BY started_at DESC
  `.execute(db);
  return result.rows;
}
async function acquireLock(db:SqlExecutor):Promise<void>{
  await sql`SELECT pg_advisory_lock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE},0))`.execute(db);
}
async function releaseLock(db:SqlExecutor):Promise<void>{
  await sql`SELECT pg_advisory_unlock(hashtextextended(${POSTGRES_MIGRATION_LOCK_RESOURCE},0))`.execute(db);
}
function sameChecksum(actual:Buffer,expected:Buffer):boolean{return Buffer.from(actual).equals(expected);}
async function verifyRuntime(db:SqlExecutor,expectedDatabase:string):Promise<void>{
  const row=(await queryRows<{database:string;version:string;session_user:string;current_user:string}>(db,
    "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user"))[0];
  invariant(row?.database===expectedDatabase&&row.version==="160014","003 target mismatch");
  invariant(
    row.session_user==="pos_migrator"&&row.current_user==="pos_schema_owner",
    `003 migrator identity mismatch: session_user=${row?.session_user??"missing"} current_user=${row?.current_user??"missing"}`,
  );
}
async function verifyPredecessors(db:SqlExecutor):Promise<void>{
  const one=sha256(await readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact));
  const two=sha256(await readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact));
  const rows=await queryRows<{migration_id:string;status:string;checksum:Buffer}>(db,`
    SELECT migration_id,status,checksum FROM platform.target_migration_executions
    WHERE migration_id IN ('001_central_foundation','002_external_integrations_foundation')
      AND status='APPLIED' ORDER BY migration_id
  `);
  invariant(rows.length===2&&rows[0]?.migration_id==="001_central_foundation"&&sameChecksum(rows[0].checksum,one)
    &&rows[1]?.migration_id==="002_external_integrations_foundation"&&sameChecksum(rows[1].checksum,two),
    "003 requires exact APPLIED 001/002");
  await validatePostgres002Catalog(db);
  const extension=(await queryRows<{present:boolean}>(db,"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') present"))[0];
  invariant(extension?.present,"003 requires btree_gist");
}
async function publishReceipt(path:string,payload:ApplyReceiptPayload):Promise<{sha:string}>{
  const sha=sha256(canonicalJson(payload)).toString("hex");
  const receipt:ApplyReceipt={receipt_payload:payload,receipt_sha256:sha};
  const handle=await open(path,"wx");
  try{await handle.writeFile(`${JSON.stringify(receipt,null,2)}\n`,"utf8");await handle.sync();}
  finally{await handle.close();}
  return {sha};
}
async function readReceipt(path:string):Promise<ApplyReceipt>{
  const parsed=JSON.parse(await readFile(path,"utf8")) as ApplyReceipt;
  invariant(parsed?.receipt_payload?.receipt_version===1&&typeof parsed.receipt_sha256==="string","003 invalid apply receipt");
  invariant(sha256(canonicalJson(parsed.receipt_payload)).toString("hex")===parsed.receipt_sha256,"003 apply receipt integrity failure");
  return parsed;
}
async function markFailed(db:SqlExecutor,id:string):Promise<void>{
  await sql`UPDATE platform.target_migration_executions SET status='FAILED',error_code='BODY_003_ROLLED_BACK',finished_at=clock_timestamp()
    WHERE execution_id=${id}::uuid AND status='STARTED' AND body_committed_at IS NULL`.execute(db);
}
async function finishApplied(db:SqlExecutor,id:string):Promise<void>{
  await sql`UPDATE platform.target_migration_executions
    SET status='APPLIED',smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp()
    WHERE execution_id=${id}::uuid AND status='STARTED' AND body_committed_at IS NOT NULL`.execute(db);
}
async function finishAndReceipt(
  connection:SqlExecutor,config:Postgres003RunnerConfig,executionId:string,checksumHex:string,reconciled:boolean
):Promise<Postgres003ApplyResult>{
  await validatePostgres003Catalog(connection);
  if(!config.skipSmoke) await runPostgres003Smoke(config.adminUrl);
  await executeRaw(connection,"SET ROLE pos_schema_owner");
  await verifyRuntime(connection,config.expectedDatabase);
  await finishApplied(connection,executionId);
  const payload:ApplyReceiptPayload={
    receipt_version:1,migration_id:POSTGRES_003_MIGRATION_ID,execution_id:executionId,
    repository_commit:config.repositoryCommit,artifact_sha256:checksumHex,
    target:{environment_id:config.environmentId,database_name:config.expectedDatabase,postgres_version_num:"160014"},
    runner_version:`${RUNNER_VERSION};migration=003;repo=${config.repositoryCommit}`,applied_at:isoNow(),
  };
  try{
    const receipt=await publishReceipt(config.receiptOutputPath,payload);
    return {executionId,noOp:false,reconciled,checksumHex,result:"APPLIED_WITH_RECEIPT",receiptPath:config.receiptOutputPath,receiptSha256:receipt.sha};
  }catch{
    return {executionId,noOp:false,reconciled,checksumHex,result:"APPLIED_WITHOUT_DURABLE_RECEIPT",receiptPath:null,receiptSha256:null};
  }
}

export async function applyPostgres003(config:Postgres003RunnerConfig):Promise<Postgres003ApplyResult>{
  validateConfig(config);
  const migratorUrl=config.migratorUrl??roleUrl(config.adminUrl,"pos_migrator");
  const migrator=postgresDatabase(migratorUrl,1);
  const upSql=await readArtifact(POSTGRES_003_DESCRIPTOR.upArtifact);
  const checksum=sha256(upSql);const checksumHex=checksum.toString("hex");
  try{
    const existing=await migrator.connection().execute(async connection=>{
      await executeRaw(connection,"SET ROLE pos_schema_owner");await acquireLock(connection);
      try{
        await verifyRuntime(connection,config.expectedDatabase);
        const rows=await executionRows(connection);
        for(const row of rows) invariant(sameChecksum(row.checksum,checksum),"003 checksum mismatch");
        const applied=rows.find(row=>row.status==="APPLIED");
        if(applied){
          await validatePostgres003Catalog(connection);
          return {executionId:applied.execution_id,noOp:true,reconciled:false,checksumHex,result:"ALREADY_APPLIED",receiptPath:null,receiptSha256:null} satisfies Postgres003ApplyResult;
        }
        const started=rows.find(row=>row.status==="STARTED");
        if(started){
          const state=await fiscal003CatalogState(connection);
          if(state==="target-003"){
            if(started.body_committed_at===null) await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() WHERE execution_id=${started.execution_id}::uuid`.execute(connection);
            return await finishAndReceipt(connection,config,started.execution_id,checksumHex,true);
          }
          invariant(state==="pre-003","003 STARTED execution has divergent catalog");
          await markFailed(connection,started.execution_id);
        }
        return null;
      }finally{await releaseLock(connection);await executeRaw(connection,"RESET ROLE");}
    });
    if(existing)return existing;

    const preflight=await runMat003Preflight(roleUrl(config.adminUrl,"pos_platform_admin"),{allowClosed003History:true});
    invariant(preflight.result==="PASS",`003 MAT-003 preflight did not pass: ${preflight.failure_code??preflight.result}`);

    return await migrator.connection().execute(async connection=>{
      await executeRaw(connection,"SET ROLE pos_schema_owner");await acquireLock(connection);
      try{
        await verifyRuntime(connection,config.expectedDatabase);
        const rows=await executionRows(connection);
        for(const row of rows) invariant(sameChecksum(row.checksum,checksum),"003 checksum mismatch");
        const applied=rows.find(row=>row.status==="APPLIED");
        if(applied){
          await validatePostgres003Catalog(connection);
          return {executionId:applied.execution_id,noOp:true,reconciled:false,checksumHex,result:"ALREADY_APPLIED",receiptPath:null,receiptSha256:null};
        }
        const started=rows.find(row=>row.status==="STARTED");
        if(started){
          const state=await fiscal003CatalogState(connection);
          if(state==="target-003"){
            if(started.body_committed_at===null) await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp() WHERE execution_id=${started.execution_id}::uuid`.execute(connection);
            return finishAndReceipt(connection,config,started.execution_id,checksumHex,true);
          }
          invariant(state==="pre-003","003 STARTED execution has divergent catalog");
          await markFailed(connection,started.execution_id);
        }

        await verifyPredecessors(connection);
        const state=await fiscal003CatalogState(connection);
        invariant(state==="pre-003","003 requires pre-003 catalog");
        const executionId=uuidV7();
        const runnerVersion=`${RUNNER_VERSION};migration=003;repo=${config.repositoryCommit}`;
        await sql`INSERT INTO platform.target_migration_executions
          (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version)
          VALUES (${executionId}::uuid,${POSTGRES_003_MIGRATION_ID},'POSTGRESQL',${POSTGRES_003_DESCRIPTOR.manifestVersion},${checksum},'STARTED',clock_timestamp(),${runnerVersion})`.execute(connection);
        try{
          await connection.transaction().execute(async transaction=>{
            await executeRaw(transaction,"SET LOCAL ROLE pos_schema_owner");
            await lockMat003BlockerTables(transaction);
            await assertMat003BlockersAbsent(transaction);
            await executeRaw(transaction,upSql);
            await validatePostgres003Catalog(transaction);
          });
        }catch(error){await markFailed(connection,executionId);throw error;}
        await sql`UPDATE platform.target_migration_executions SET body_committed_at=clock_timestamp()
          WHERE execution_id=${executionId}::uuid AND status='STARTED'`.execute(connection);
        return finishAndReceipt(connection,config,executionId,checksumHex,false);
      }finally{await releaseLock(connection);await executeRaw(connection,"RESET ROLE");}
    });
  }finally{await migrator.destroy();}
}

export async function lockPostgres003DownHistoryTables(db:SqlExecutor):Promise<void>{
  const fiscal=FISCAL_TABLES.map(name=>`fiscal.${name}`);
  const dependent=["integrations.integration_dispatches","integrations.external_webhook_receipts","integrations.integration_capabilities","integrations.provider_capability_declarations"];
  await executeRaw(db,`LOCK TABLE ${[...fiscal,...dependent].join(",")} IN SHARE MODE`);
}
async function destructiveDataCount(db:SqlExecutor):Promise<number>{
  const fiscalSum=FISCAL_TABLES.map(name=>`(SELECT count(*) FROM fiscal.${name})`).join("+");
  const row=(await queryRows<{count:string}>(db,`
    SELECT (
      ${fiscalSum}
      +(SELECT count(*) FROM integrations.integration_dispatches WHERE dispatch_class='FISCAL'
          OR fiscal_document_preparation_id IS NOT NULL OR fiscal_preparation_generation IS NOT NULL
          OR fiscal_request_semantic_version IS NOT NULL OR fiscal_request_semantic_checksum IS NOT NULL)
      +(SELECT count(*) FROM integrations.external_webhook_receipts WHERE fiscal_electronic_document_id IS NOT NULL
          OR fiscal_document_preparation_id IS NOT NULL OR fiscal_preparation_generation IS NOT NULL
          OR fiscal_integration_dispatch_id IS NOT NULL OR fiscal_correlated_at IS NOT NULL)
      +(SELECT count(*) FROM integrations.integration_capabilities WHERE capability_code='DEBIT_NOTES')
      +(SELECT count(*) FROM integrations.provider_capability_declarations WHERE capability_code='DEBIT_NOTES')
    )::text count
  `))[0];
  return Number(row?.count??"NaN");
}

export async function downPostgres003(config:Postgres003DownConfig):Promise<void>{
  validateConfig(config);invariant(config.confirmFreshTestDown===true,"003 down requires explicit fresh/test confirmation");
  const receipt=await readReceipt(config.applyReceiptPath);
  const upSql=await readArtifact(POSTGRES_003_DESCRIPTOR.upArtifact);const checksum=sha256(upSql);
  invariant(receipt.receipt_payload.repository_commit===config.repositoryCommit
    &&receipt.receipt_payload.artifact_sha256===checksum.toString("hex")
    &&receipt.receipt_payload.target.environment_id===config.environmentId
    &&receipt.receipt_payload.target.database_name===config.expectedDatabase,
    "003 down receipt does not match target/artifact");
  const migrator=postgresDatabase(config.migratorUrl??roleUrl(config.adminUrl,"pos_migrator"),1);
  const downSql=await readArtifact(POSTGRES_003_DESCRIPTOR.downArtifact);
  try{
    await migrator.connection().execute(async connection=>{
      await executeRaw(connection,"SET ROLE pos_schema_owner");await acquireLock(connection);
      try{
        await verifyRuntime(connection,config.expectedDatabase);
        const rows=await executionRows(connection);
        for(const row of rows) invariant(sameChecksum(row.checksum,checksum),"003 checksum mismatch");
        const state=await fiscal003CatalogState(connection);
        if(state==="pre-003"){
          await validatePostgres002Catalog(connection);
          const receiptExecution=rows.find(row=>row.execution_id===receipt.receipt_payload.execution_id);
          if(receiptExecution?.status==="APPLIED"){
            await sql`UPDATE platform.target_migration_executions
              SET status='ROLLED_BACK',rolled_back_at=clock_timestamp(),finished_at=clock_timestamp()
              WHERE execution_id=${receiptExecution.execution_id}::uuid AND status='APPLIED'`.execute(connection);
            return;
          }
          invariant(receiptExecution?.status==="ROLLED_BACK","003 pre-003 catalog lacks receipt-bound ROLLED_BACK ledger");
          return;
        }
        invariant(state==="target-003","003 down requires exact target-003 catalog");
        const applied=rows.find(row=>row.status==="APPLIED");
        invariant(applied&&applied.execution_id===receipt.receipt_payload.execution_id,"003 down requires matching APPLIED receipt");
        await connection.transaction().execute(async transaction=>{
          await executeRaw(transaction,"SET LOCAL ROLE pos_schema_owner");
          await lockPostgres003DownHistoryTables(transaction);
          const count=await destructiveDataCount(transaction);
          invariant(Number.isSafeInteger(count)&&count===0,"003 down refused because fiscal/dependent history exists");
          await executeRaw(transaction,downSql);
          await validatePostgres002Catalog(transaction);
          const schema=(await queryRows<{present:boolean}>(transaction,"SELECT to_regnamespace('fiscal') IS NOT NULL present"))[0];
          invariant(schema?.present===false,"003 down did not remove fiscal schema");
        });
        await sql`UPDATE platform.target_migration_executions SET status='ROLLED_BACK',rolled_back_at=clock_timestamp(),finished_at=clock_timestamp()
          WHERE execution_id=${applied.execution_id}::uuid AND status='APPLIED'`.execute(connection);
      }finally{await releaseLock(connection);await executeRaw(connection,"RESET ROLE");}
    });
  }finally{await migrator.destroy();}
}
