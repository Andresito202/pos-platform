import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";
import { validatePostgres002Catalog } from "./postgres-introspection.js";
import { MigrationInvariantError, POSTGRES_MIGRATION_LOCK_RESOURCE, readArtifact, sha256 } from "./shared.js";

export type Mat003PreflightStatus = "PASS" | "BLOCKED" | "FAIL";
export interface Mat003PreflightEvidence { id:string; tenant_id:string|null; company_id:string|null; integration_id:string|null; provider_id:string|null; related_id:string|null }
export interface Mat003PreflightCheck { check_id:string; description:string; count:number; status:"PASS"|"BLOCKED"|"FAIL"; evidence:Mat003PreflightEvidence[]; evidence_truncated:boolean }
export interface Mat003DatabaseState {
  database:string; server_version:string; transaction_read_only:true; transaction_isolation:"repeatable read";
  execution_role:string; execution_role_nonsuperuser:true; execution_role_bypassrls:true; required_read_privileges:"VALID";
  global_lock_resource:typeof POSTGRES_MIGRATION_LOCK_RESOURCE; global_lock_acquired:true;
  predecessor_001:"APPLIED"; predecessor_002:"APPLIED"; catalogs_001_002:"VALID"; fiscal_schema:"ABSENT"; migration_003_ledger_entries:number;
}
export interface Mat003PreflightResult {
  preflight_id:"MAT-003-PREFLIGHT"; version:1; result:Mat003PreflightStatus; database_state:Mat003DatabaseState|null;
  checks:Mat003PreflightCheck[]; failure_code:string|null; failure_cause_code:string|null;
}
export interface Mat003PreflightOptions { allowClosed003History?:boolean }
interface CheckDefinition { checkId:string; description:string; affectedSql:string; trustCondition?:boolean }
interface RuntimeState { database:string; server_version:string; server_version_num:string; transaction_read_only:string; transaction_isolation:string; execution_role:string; rolcanlogin:boolean; rolsuper:boolean; rolbypassrls:boolean }
class PreflightError extends Error { constructor(readonly code:string){super(code);} }

export const MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE=POSTGRES_MIGRATION_LOCK_RESOURCE;
export const MAT003_PREFLIGHT_REQUIRED_SCHEMAS=["platform","integrations"] as const;
export const MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS={
  "platform.target_migration_executions":["migration_id","status","checksum"],
  "integrations.external_integrations":["id","tenant_id","company_id","provider_id"],
  "integrations.integration_capabilities":["id","tenant_id","company_id","integration_id","capability_code","ownership_policy_id"],
  "integrations.integration_dispatches":["id","tenant_id","company_id","integration_id","capability_code","dispatch_class","resource_type","internal_entity_type","internal_entity_id"],
  "integrations.integration_dispatch_attempts":["id","tenant_id","company_id","integration_dispatch_id","dispatch_class"],
  "integrations.external_reference_mappings":["id","tenant_id","company_id","integration_id","resource_type","internal_entity_type","internal_entity_id"],
  "integrations.resource_ownership_policies":["id","tenant_id","company_id","integration_id"],
} as const;
export const MAT003_PREFLIGHT_REQUIRED_TABLES=Object.keys(MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS);
const EVIDENCE_LIMIT=100;

const BLOCKERS:readonly CheckDefinition[]=[
  {checkId:"MAT003_INTEGRATION_CAPABILITY_DEBIT_NOTES",description:"Tenant/company integration capabilities that already use DEBIT_NOTES.",affectedSql:`
    SELECT c.id::text id,c.tenant_id::text tenant_id,c.company_id::text company_id,c.integration_id::text integration_id,i.provider_id::text provider_id,c.ownership_policy_id::text related_id
    FROM integrations.integration_capabilities c LEFT JOIN integrations.external_integrations i ON i.tenant_id=c.tenant_id AND i.company_id=c.company_id AND i.id=c.integration_id
    WHERE c.capability_code='DEBIT_NOTES'`},
  {checkId:"MAT003_NON_FISCAL_DEBIT_NOTES_DISPATCH",description:"Historical NON_FISCAL dispatches whose capability is DEBIT_NOTES.",affectedSql:`
    SELECT d.id::text id,d.tenant_id::text tenant_id,d.company_id::text company_id,d.integration_id::text integration_id,i.provider_id::text provider_id,d.internal_entity_id::text related_id
    FROM integrations.integration_dispatches d LEFT JOIN integrations.external_integrations i ON i.tenant_id=d.tenant_id AND i.company_id=d.company_id AND i.id=d.integration_id
    WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES'`},
  {checkId:"MAT003_NON_FISCAL_DEBIT_NOTES_ATTEMPT",description:"Attempts related by the exact discriminated FK to an affected dispatch.",affectedSql:`
    SELECT a.id::text id,a.tenant_id::text tenant_id,a.company_id::text company_id,d.integration_id::text integration_id,i.provider_id::text provider_id,a.integration_dispatch_id::text related_id
    FROM integrations.integration_dispatch_attempts a JOIN integrations.integration_dispatches d ON d.tenant_id=a.tenant_id AND d.company_id=a.company_id AND d.id=a.integration_dispatch_id AND d.dispatch_class=a.dispatch_class
    LEFT JOIN integrations.external_integrations i ON i.tenant_id=d.tenant_id AND i.company_id=d.company_id AND i.id=d.integration_id
    WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES'`},
  {checkId:"MAT003_DEBIT_NOTES_MAPPING",description:"Mappings related by the complete scoped typed internal identity.",affectedSql:`
    SELECT m.id::text id,m.tenant_id::text tenant_id,m.company_id::text company_id,m.integration_id::text integration_id,i.provider_id::text provider_id,m.internal_entity_id::text related_id
    FROM integrations.external_reference_mappings m LEFT JOIN integrations.external_integrations i ON i.tenant_id=m.tenant_id AND i.company_id=m.company_id AND i.id=m.integration_id
    WHERE EXISTS(SELECT 1 FROM integrations.integration_dispatches d WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES'
      AND d.tenant_id=m.tenant_id AND d.company_id=m.company_id AND d.integration_id=m.integration_id AND d.resource_type=m.resource_type
      AND d.internal_entity_type=m.internal_entity_type AND d.internal_entity_id=m.internal_entity_id)`},
  {checkId:"MAT003_DEBIT_NOTES_OWNERSHIP",description:"Ownership policies explicitly referenced by an affected capability in the same scope.",affectedSql:`
    SELECT p.id::text id,p.tenant_id::text tenant_id,p.company_id::text company_id,p.integration_id::text integration_id,i.provider_id::text provider_id,c.id::text related_id
    FROM integrations.resource_ownership_policies p JOIN integrations.integration_capabilities c ON c.tenant_id=p.tenant_id AND c.company_id=p.company_id
      AND c.integration_id=p.integration_id AND c.ownership_policy_id=p.id AND c.capability_code='DEBIT_NOTES'
    LEFT JOIN integrations.external_integrations i ON i.tenant_id=p.tenant_id AND i.company_id=p.company_id AND i.id=p.integration_id`},
];

const SCOPE_INTEGRITY:CheckDefinition={checkId:"MAT003_AFFECTED_SCOPE_INTEGRITY",description:"Affected rows whose integration scope cannot be resolved exactly.",trustCondition:true,affectedSql:`
  SELECT affected.id,affected.tenant_id::text tenant_id,affected.company_id::text company_id,affected.integration_id::text integration_id,NULL::text provider_id,affected.related_id
  FROM (
    SELECT c.id::text id,c.tenant_id,c.company_id,c.integration_id,c.ownership_policy_id::text related_id FROM integrations.integration_capabilities c WHERE c.capability_code='DEBIT_NOTES'
    UNION ALL SELECT d.id::text,d.tenant_id,d.company_id,d.integration_id,d.internal_entity_id::text FROM integrations.integration_dispatches d WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES'
    UNION ALL SELECT a.id::text,a.tenant_id,a.company_id,d.integration_id,a.integration_dispatch_id::text FROM integrations.integration_dispatch_attempts a JOIN integrations.integration_dispatches d ON d.tenant_id=a.tenant_id AND d.company_id=a.company_id AND d.id=a.integration_dispatch_id AND d.dispatch_class=a.dispatch_class WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES'
    UNION ALL SELECT m.id::text,m.tenant_id,m.company_id,m.integration_id,m.internal_entity_id::text FROM integrations.external_reference_mappings m WHERE EXISTS(SELECT 1 FROM integrations.integration_dispatches d WHERE d.dispatch_class='NON_FISCAL' AND d.capability_code='DEBIT_NOTES' AND d.tenant_id=m.tenant_id AND d.company_id=m.company_id AND d.integration_id=m.integration_id AND d.resource_type=m.resource_type AND d.internal_entity_type=m.internal_entity_type AND d.internal_entity_id=m.internal_entity_id)
    UNION ALL SELECT p.id::text,p.tenant_id,p.company_id,p.integration_id,c.id::text FROM integrations.resource_ownership_policies p JOIN integrations.integration_capabilities c ON c.tenant_id=p.tenant_id AND c.company_id=p.company_id AND c.integration_id=p.integration_id AND c.ownership_policy_id=p.id AND c.capability_code='DEBIT_NOTES'
  ) affected WHERE NOT EXISTS(SELECT 1 FROM integrations.external_integrations i WHERE i.tenant_id=affected.tenant_id AND i.company_id=affected.company_id AND i.id=affected.integration_id)`};

function fail(code:string,checks:Mat003PreflightCheck[]=[],cause:string|null=null):Mat003PreflightResult{return{preflight_id:"MAT-003-PREFLIGHT",version:1,result:"FAIL",database_state:null,checks,failure_code:code,failure_cause_code:cause};}
function invariant(value:unknown,message:string):asserts value{if(!value)throw new MigrationInvariantError(message);}
function preflightInvariant(value:unknown,code:string):asserts value{if(!value)throw new PreflightError(code);}
function valuesSql(values:readonly string[]):string{return values.map(value=>`('${value.replaceAll("'","''")}')`).join(",");}

export function mat003PreflightUrlFailureCode(url:string|undefined):string|null{
  if(url===undefined||url.trim()==="")return "PREFLIGHT_URL_REQUIRED";
  try{const parsed=new URL(url);if(!["postgres:","postgresql:"].includes(parsed.protocol)||!parsed.hostname||!parsed.username||parsed.pathname.length<=1)return "PREFLIGHT_URL_INVALID";}
  catch{return "PREFLIGHT_URL_INVALID";} return null;
}

async function verifyRuntime(db:SqlExecutor):Promise<RuntimeState>{
  const row=(await queryRows<RuntimeState>(db,`SELECT current_database() database,current_setting('server_version') server_version,current_setting('server_version_num') server_version_num,current_setting('transaction_read_only') transaction_read_only,current_setting('transaction_isolation') transaction_isolation,current_user execution_role,r.rolcanlogin,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`))[0];
  preflightInvariant(row,"PREFLIGHT_EXECUTION_ROLE_UNAVAILABLE");
  preflightInvariant(row.transaction_read_only==="on"&&row.transaction_isolation==="repeatable read","PREFLIGHT_TRANSACTION_MODE_INVALID");
  preflightInvariant(row.rolcanlogin,"PREFLIGHT_EXECUTION_ROLE_LOGIN_REQUIRED");
  preflightInvariant(!row.rolsuper,"PREFLIGHT_EXECUTION_ROLE_SUPERUSER");
  preflightInvariant(row.rolbypassrls,"PREFLIGHT_EXECUTION_ROLE_BYPASSRLS_REQUIRED"); return row;
}

async function verifyPrivileges(db:SqlExecutor):Promise<void>{
  const schemas=await queryRows<{name:string}>(db,`SELECT r.name FROM (VALUES ${valuesSql(MAT003_PREFLIGHT_REQUIRED_SCHEMAS)}) r(name) LEFT JOIN pg_namespace n ON n.nspname=r.name WHERE n.oid IS NULL OR NOT has_schema_privilege(current_user,n.oid,'USAGE')`);
  const requiredColumns=Object.entries(MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS).flatMap(([qualifiedName,columns])=>{const [schema,table]=qualifiedName.split(".");return columns.map(column=>`('${schema}','${table}','${column}')`);}).join(",");
  const columns=await queryRows<{schema_name:string;table_name:string;column_name:string}>(db,`SELECT r.schema_name,r.table_name,r.column_name FROM (VALUES ${requiredColumns}) r(schema_name,table_name,column_name) LEFT JOIN pg_namespace n ON n.nspname=r.schema_name LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.table_name WHERE c.oid IS NULL OR NOT has_column_privilege(current_user,c.oid,r.column_name,'SELECT')`);
  preflightInvariant(schemas.length===0&&columns.length===0,"PREFLIGHT_READ_PRIVILEGE_MISSING");
}

async function acquireLock(db:SqlExecutor):Promise<void>{
  const row=(await queryRows<{acquired:boolean}>(db,`SELECT pg_try_advisory_xact_lock(hashtextextended('${POSTGRES_MIGRATION_LOCK_RESOURCE}',0)) acquired`))[0];
  preflightInvariant(row?.acquired,"PREFLIGHT_GLOBAL_LOCK_UNAVAILABLE");
}

async function inspectPredecessor(db:SqlExecutor,runtime:RuntimeState,options:Mat003PreflightOptions):Promise<Mat003DatabaseState>{
  invariant(runtime.server_version_num==="160014","PostgreSQL 16.14 required");
  const sql001=await readArtifact("postgres/001_central_foundation.up.sql");const sql002=await readArtifact("postgres/002_external_integrations_foundation.up.sql");
  const expected001=sha256(sql001).toString("hex");const expected002=sha256(sql002).toString("hex");
  const ledger=await queryRows<{migration_id:string;status:string;checksum_hex:string}>(db,`SELECT migration_id,status,encode(checksum,'hex') checksum_hex FROM platform.target_migration_executions WHERE migration_id IN ('001_central_foundation','002_external_integrations_foundation') ORDER BY migration_id`);
  invariant(ledger.length===2,"approved predecessor ledger entries required");
  invariant(ledger[0]?.migration_id==="001_central_foundation"&&ledger[0].status==="APPLIED"&&ledger[0].checksum_hex===expected001,"approved 001 predecessor required");
  invariant(ledger[1]?.migration_id==="002_external_integrations_foundation"&&ledger[1].status==="APPLIED"&&ledger[1].checksum_hex===expected002,"approved 002 predecessor required");
  await validatePostgres002Catalog(db);
  const fiscal=(await queryRows<{present:boolean}>(db,"SELECT to_regnamespace('fiscal') IS NOT NULL present"))[0];
  invariant(fiscal&&!fiscal.present,"fiscal schema must be absent");
  const history=await queryRows<{migration_id:string;status:string}>(db,`
    SELECT migration_id,status FROM platform.target_migration_executions
    WHERE migration_id LIKE '003\\_%' ESCAPE '\\' ORDER BY migration_id,status
  `);
  if(options.allowClosed003History){
    invariant(
      history.every(row=>row.migration_id==="003_fiscal_electronic_invoicing_foundation"&&row.status==="ROLLED_BACK"),
      "migration 003 history must contain only the exact ROLLED_BACK migration",
    );
  }else{
    invariant(history.length===0,"migration 003 ledger entry must be absent");
  }
  return{database:runtime.database,server_version:runtime.server_version,transaction_read_only:true,transaction_isolation:"repeatable read",execution_role:runtime.execution_role,execution_role_nonsuperuser:true,execution_role_bypassrls:true,required_read_privileges:"VALID",global_lock_resource:POSTGRES_MIGRATION_LOCK_RESOURCE,global_lock_acquired:true,predecessor_001:"APPLIED",predecessor_002:"APPLIED",catalogs_001_002:"VALID",fiscal_schema:"ABSENT",migration_003_ledger_entries:history.length};
}

async function executeCheck(db:SqlExecutor,definition:CheckDefinition):Promise<Mat003PreflightCheck>{
  const countRow=(await queryRows<{count:string}>(db,`WITH affected AS (${definition.affectedSql}) SELECT count(*)::text count FROM affected`))[0]; invariant(countRow,`count unavailable for ${definition.checkId}`);
  const count=Number(countRow.count); invariant(Number.isSafeInteger(count)&&count>=0,`invalid count for ${definition.checkId}`);
  const evidence=await queryRows<Mat003PreflightEvidence>(db,`WITH affected AS (${definition.affectedSql}) SELECT id,tenant_id,company_id,integration_id,provider_id,related_id FROM affected ORDER BY tenant_id NULLS FIRST,company_id NULLS FIRST,integration_id NULLS FIRST,provider_id NULLS FIRST,id LIMIT ${EVIDENCE_LIMIT}`);
  return{check_id:definition.checkId,description:definition.description,count,status:count===0?"PASS":definition.trustCondition?"FAIL":"BLOCKED",evidence,evidence_truncated:count>evidence.length};
}

export function mat003PreflightExitCode(result:Mat003PreflightResult):0|1|2{return result.result==="PASS"?0:result.result==="BLOCKED"?2:1;}
export async function runMat003Preflight(url:string|undefined,options:Mat003PreflightOptions={}):Promise<Mat003PreflightResult>{
  const urlFailure=mat003PreflightUrlFailureCode(url); if(urlFailure)return fail(urlFailure);
  const database=postgresDatabase(url!,1);
  try{return await database.connection().execute(async connection=>{
    let started=false; let result:Mat003PreflightResult;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); started=true;
      await acquireLock(connection); const runtime=await verifyRuntime(connection); await verifyPrivileges(connection); const state=await inspectPredecessor(connection,runtime,options);
      const checks:Mat003PreflightCheck[]=[]; for(const definition of BLOCKERS)checks.push(await executeCheck(connection,definition));
      const scope=await executeCheck(connection,SCOPE_INTEGRITY); checks.push(scope);
      result=scope.count>0?fail("PREFLIGHT_AFFECTED_SCOPE_INTEGRITY_FAILED",checks):{preflight_id:"MAT-003-PREFLIGHT",version:1,result:checks.some(check=>check.status==="BLOCKED")?"BLOCKED":"PASS",database_state:state,checks,failure_code:null,failure_cause_code:null};
    }catch(error){result=fail(error instanceof PreflightError?error.code:error instanceof MigrationInvariantError?"PREDECESSOR_OR_CONTRACT_INVALID":"PREFLIGHT_EXECUTION_FAILED");}
    if(started){try{await executeRaw(connection,"ROLLBACK");}catch{return fail("PREFLIGHT_ROLLBACK_FAILED",result.checks,result.failure_code??`ROLLBACK_AFTER_${result.result}`);}}
    return result;
  });}catch{return fail("PREFLIGHT_CONNECTION_FAILED");}finally{await database.destroy().catch(()=>undefined);}
}
