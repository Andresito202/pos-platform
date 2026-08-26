import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTEGRATION_RLS_TABLES, INTEGRATION_TABLES } from "../src/contract.js";
import { postgresDatabase, queryRows } from "../src/database.js";
import { validatePostgres002Catalog, validatePostgresCatalog } from "../src/postgres-introspection.js";
import { applyPostgres001, applyPostgres002, downPostgres001, downPostgres002 } from "../src/postgres.js";

const SERVER_URL=process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES=["target_002_fresh","target_002_dependency","target_002_failure","target_002_started","target_002_commit","target_002_checksum","target_002_down","target_002_preexisting","target_002_concurrent","target_002_up_down_race"] as const;
const url=(name:string)=>{const value=new URL(SERVER_URL);value.pathname=`/${name}`;return value.toString();};

async function recreate():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES){await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await pool.query(`CREATE DATABASE "${name}"`);}}finally{await pool.end();}}
async function drop():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES)await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}finally{await pool.end();}}

describe("002_external_integrations_foundation",()=>{
  const facts:Record<string,unknown>={};
  beforeAll(async()=>{
    await recreate();
    const fresh=url("target_002_fresh");
    await applyPostgres001({adminUrl:fresh});
    const first=await applyPostgres002({adminUrl:fresh});
    const second=await applyPostgres002({adminUrl:fresh});
    facts.firstNoOp=first.noOp; facts.secondNoOp=second.noOp; facts.sameExecution=first.executionId===second.executionId;
    facts.extensionInstalled=first.prerequisiteState; facts.extensionRepeat=second.prerequisiteState;
    const db=postgresDatabase(fresh,1);
    try{
      await validatePostgresCatalog(db); facts.validator001=true;
      await validatePostgres002Catalog(db); facts.validator002=true;
      facts.tables=(await queryRows<{name:string}>(db,"SELECT tablename AS name FROM pg_tables WHERE schemaname='integrations' ORDER BY 1")).map(row=>row.name);
      facts.rls=await queryRows<{name:string;enabled:boolean;forced:boolean}>(db,"SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='integrations' AND c.relrowsecurity ORDER BY 1");
      facts.ledger=await queryRows<{migration_id:string;status:string}>(db,"SELECT migration_id,status FROM platform.target_migration_executions WHERE status='APPLIED' ORDER BY migration_id");
      facts.fiscalTables=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM pg_tables WHERE tablename IN ('fiscal_connections','electronic_documents','fiscal_submission_attempts','fiscal_artifacts','fiscal_incidents','fiscal_reconciliations')"))[0]!.count);
      facts.seeds=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM integrations.provider_registry"))[0]!.count);
      facts.secretColumns=(await queryRows<{name:string}>(db,"SELECT column_name AS name FROM information_schema.columns WHERE table_schema='integrations' AND column_name IN ('access_token','refresh_token','password','client_secret','access_key','api_key','cookie','private_key')" )).map(row=>row.name);
      facts.deadLetter=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM pg_indexes WHERE schemaname='integrations' AND indexname='external_webhook_receipts_dead_letter_idx'"))[0]!.count);
      facts.retryAfterIndex=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM pg_indexes WHERE schemaname='integrations' AND indexdef ILIKE '%retry_after_at%'"))[0]!.count);
      facts.currentConfigIndex=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM pg_indexes WHERE schemaname='integrations' AND indexname='provider_platform_configurations_current_idx'"))[0]!.count);
      facts.reportingGrants=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='integrations' AND grantee='pos_reporting'"))[0]!.count);
      facts.adminMutations=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='integrations' AND grantee='pos_platform_admin' AND privilege_type<>'SELECT'"))[0]!.count);
      facts.dangerousGrants=Number((await queryRows<{count:string}>(db,"SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='integrations' AND grantee IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin') AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')"))[0]!.count);
    }finally{await db.destroy();}

    const dependency=url("target_002_dependency");
    try{await applyPostgres002({adminUrl:dependency});}catch(error){facts.missingDependency=error instanceof Error&&error.message.includes("requires approved 001");}

    const failure=url("target_002_failure"); await applyPostgres001({adminUrl:failure});
    try{await applyPostgres002({adminUrl:failure,injectBodyFailure:true});}catch{facts.bodyFailure=true;}
    const failureDb=postgresDatabase(failure,1);try{facts.failureState=(await queryRows<{status:string;body:boolean;schema:boolean}>(failureDb,"SELECT e.status,e.body_committed_at IS NOT NULL AS body,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='integrations') AS schema FROM platform.target_migration_executions e WHERE migration_id='002_external_integrations_foundation'"))[0];}finally{await failureDb.destroy();}
    facts.failureRetry=!(await applyPostgres002({adminUrl:failure})).noOp;

    const started=url("target_002_started"); await applyPostgres001({adminUrl:started});
    try{await applyPostgres002({adminUrl:started,simulateCrashAfterStarted:true});}catch{facts.startedCrash=true;}
    facts.startedRecovered=(await applyPostgres002({adminUrl:started})).noOp===false;
    const startedDb=postgresDatabase(started,1);try{facts.startedStatuses=(await queryRows<{status:string}>(startedDb,"SELECT status FROM platform.target_migration_executions WHERE migration_id='002_external_integrations_foundation' ORDER BY started_at")).map(row=>row.status);}finally{await startedDb.destroy();}

    const commit=url("target_002_commit"); await applyPostgres001({adminUrl:commit});
    try{await applyPostgres002({adminUrl:commit,simulateCrashAfterBodyCommit:true});}catch{facts.commitCrash=true;}
    facts.commitRecovered=(await applyPostgres002({adminUrl:commit})).reconciled;

    const checksum=url("target_002_checksum"); await applyPostgres001({adminUrl:checksum}); await applyPostgres002({adminUrl:checksum});
    const checksumPool=new Pool({connectionString:checksum});try{await checksumPool.query("INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code) VALUES ('018f2000-0000-7000-8000-000000000001','002_external_integrations_foundation','POSTGRESQL',1,decode(repeat('00',32),'hex'),'FAILED',clock_timestamp(),clock_timestamp(),'test','MISMATCH')");}finally{await checksumPool.end();}
    try{await applyPostgres002({adminUrl:checksum});}catch(error){facts.checksumRejected=error instanceof Error&&error.message.includes("checksum mismatch");}

    const preexisting=url("target_002_preexisting"); await applyPostgres001({adminUrl:preexisting});
    const prePool=new Pool({connectionString:preexisting});try{await prePool.query("SET ROLE pos_schema_owner; CREATE EXTENSION btree_gist");}finally{await prePool.end();}
    facts.preexistingExtension=(await applyPostgres002({adminUrl:preexisting})).prerequisiteState;

    const concurrent=url("target_002_concurrent"); await applyPostgres001({adminUrl:concurrent});
    const concurrentResults=await Promise.all([applyPostgres002({adminUrl:concurrent}),applyPostgres002({adminUrl:concurrent})]);
    facts.concurrentOneApply=concurrentResults.filter(result=>!result.noOp).length; facts.concurrentOneNoOp=concurrentResults.filter(result=>result.noOp).length;

    const upDownRace=url("target_002_up_down_race"); await applyPostgres001({adminUrl:upDownRace});
    const upDownResults=await Promise.allSettled([applyPostgres002({adminUrl:upDownRace}),downPostgres001({adminUrl:upDownRace})]);
    facts.upDownRaceFulfilled=upDownResults.filter(result=>result.status==="fulfilled").length;
    facts.upDownRaceRejected=upDownResults.filter(result=>result.status==="rejected").length;

    const down=url("target_002_down"); await applyPostgres001({adminUrl:down}); await applyPostgres002({adminUrl:down});
    try{await downPostgres001({adminUrl:down});}catch(error){facts.down001Rejected=error instanceof Error&&error.message.includes("002");}
    await downPostgres002({adminUrl:down}); await downPostgres002({adminUrl:down}); facts.repeatedDown=true;
    const downDb=postgresDatabase(down,1);try{
      facts.downSchema=Number((await queryRows<{count:string}>(downDb,"SELECT count(*)::text AS count FROM pg_namespace WHERE nspname='integrations'"))[0]!.count);
      facts.downExtension=Number((await queryRows<{count:string}>(downDb,"SELECT count(*)::text AS count FROM pg_extension WHERE extname='btree_gist'"))[0]!.count);
      facts.downLedger=(await queryRows<{status:string}>(downDb,"SELECT status FROM platform.target_migration_executions WHERE migration_id='002_external_integrations_foundation'"))[0]!.status;
      await validatePostgresCatalog(downDb); facts.down001Intact=true;
    }finally{await downDb.destroy();}
  },120_000);
  afterAll(drop);

  it("fresh 001 to 002 succeeds",()=>expect(facts.firstNoOp).toBe(false));
  it("repeat up is a no-op",()=>expect(facts.secondNoOp).toBe(true));
  it("repeat up preserves execution",()=>expect(facts.sameExecution).toBe(true));
  it("validator 001 passes after 002",()=>expect(facts.validator001).toBe(true));
  it("validator 002 passes",()=>expect(facts.validator002).toBe(true));
  it("has exactly 16 integration tables",()=>expect(facts.tables).toEqual([...INTEGRATION_TABLES].sort()));
  it("has exactly 12 RLS tables",()=>expect((facts.rls as unknown[]).length).toBe(12));
  it("RLS set is exact",()=>expect((facts.rls as Array<{name:string}>).map(row=>row.name)).toEqual([...INTEGRATION_RLS_TABLES].sort()));
  it("all RLS tables are ENABLE/FORCE",()=>expect((facts.rls as Array<{enabled:boolean;forced:boolean}>).every(row=>row.enabled&&row.forced)).toBe(true));
  it("ledger orders 001 then 002 as APPLIED",()=>expect(facts.ledger).toEqual([{migration_id:"001_central_foundation",status:"APPLIED"},{migration_id:"002_external_integrations_foundation",status:"APPLIED"}]));
  it("creates no fiscal tables",()=>expect(facts.fiscalTables).toBe(0));
  it("creates zero seed rows",()=>expect(facts.seeds).toBe(0));
  it("creates no secret material columns",()=>expect(facts.secretColumns).toEqual([]));
  it("creates dead-letter index",()=>expect(facts.deadLetter).toBe(1));
  it("does not index attempt retry_after_at",()=>expect(facts.retryAfterIndex).toBe(0));
  it("does not create speculative current config index",()=>expect(facts.currentConfigIndex).toBe(0));
  it("pos_reporting has no grants",()=>expect(facts.reportingGrants).toBe(0));
  it("admin is read-only",()=>expect(facts.adminMutations).toBe(0));
  it("runtime has no destructive grants",()=>expect(facts.dangerousGrants).toBe(0));
  it("missing 001 dependency fails closed",()=>expect(facts.missingDependency).toBe(true));
  it("body failure is observed",()=>expect(facts.bodyFailure).toBe(true));
  it("body failure rolls back schema and records FAILED",()=>expect(facts.failureState).toEqual({status:"FAILED",body:false,schema:false}));
  it("body failure can retry",()=>expect(facts.failureRetry).toBe(true));
  it("STARTED interruption is observed",()=>expect(facts.startedCrash).toBe(true));
  it("STARTED recovery produces FAILED then APPLIED",()=>expect(facts.startedStatuses).toEqual(["FAILED","APPLIED"]));
  it("STARTED recovery succeeds",()=>expect(facts.startedRecovered).toBe(true));
  it("post-body interruption is observed",()=>expect(facts.commitCrash).toBe(true));
  it("committed body is reconciled",()=>expect(facts.commitRecovered).toBe(true));
  it("checksum mismatch is rejected",()=>expect(facts.checksumRejected).toBe(true));
  it("btree_gist installed path is recorded",()=>expect(facts.extensionInstalled).toBe("INSTALLED_BY_MIGRATION_PREREQUISITE"));
  it("btree_gist repeat is preexisting",()=>expect(facts.extensionRepeat).toBe("PREEXISTING"));
  it("btree_gist preexisting path is recorded",()=>expect(facts.preexistingExtension).toBe("PREEXISTING"));
  it("concurrent up serializes to one apply",()=>expect(facts.concurrentOneApply).toBe(1));
  it("concurrent up serializes to one no-op",()=>expect(facts.concurrentOneNoOp).toBe(1));
  it("concurrent 002 up and 001 down serialize one operation",()=>expect(facts.upDownRaceFulfilled).toBe(1));
  it("concurrent 002 up and 001 down reject the incompatible operation",()=>expect(facts.upDownRaceRejected).toBe(1));
  it("down 001 is rejected while 002 applied",()=>expect(facts.down001Rejected).toBe(true));
  it("repeated down is safe",()=>expect(facts.repeatedDown).toBe(true));
  it("down removes only integrations schema",()=>expect(facts.downSchema).toBe(0));
  it("down preserves btree_gist",()=>expect(facts.downExtension).toBe(1));
  it("down records ROLLED_BACK",()=>expect(facts.downLedger).toBe("ROLLED_BACK"));
  it("down leaves 001 validator passing",()=>expect(facts.down001Intact).toBe(true));
});
