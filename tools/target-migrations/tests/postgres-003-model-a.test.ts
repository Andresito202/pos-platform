import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPostgres001, applyPostgres002, postgresRoleUrls } from "../src/postgres.js";
import { applyRoleReadiness, type RoleReadinessConfig } from "../src/postgres-003-role-readiness.js";
import { applyPostgres003 } from "../src/postgres-003-runner.js";

const SERVER_URL=process.env.POSTGRES_TEST_URL??"postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE="target_003_model_a";
const TEST_COMMIT="062d5664db94159cc4830410fef04f618d67aef3";
let tempDirectory="";
let ADMIN_URL="";

type Scenario={
  n:number;
  user:string;tenant:string;company:string;branch:string;source:string;
  provider:string;adapter:string;declaration:string;integration:string;capability:string;binding:string;
  connection:string;configuration:string;version1:string;version2:string;
  document:string;preparation1:string;preparation2:string;dispatch:string;operation:string;correlation:string;
  attempt1:string;attempt2:string;receipt:string;reconciliation:string;
};

function uuid(n:number,slot:number):string{
  const first=(0x018f3000+n).toString(16).padStart(8,"0");
  return `${first}-0000-7000-8000-${slot.toString(16).padStart(12,"0")}`;
}
function scenario(n:number):Scenario{
  return {
    n,
    user:uuid(n,1),tenant:uuid(n,2),company:uuid(n,3),branch:uuid(n,4),source:uuid(n,5),
    provider:uuid(n,10),adapter:uuid(n,11),declaration:uuid(n,12),integration:uuid(n,13),capability:uuid(n,14),binding:uuid(n,15),
    connection:uuid(n,20),configuration:uuid(n,21),version1:uuid(n,22),version2:uuid(n,23),
    document:uuid(n,30),preparation1:uuid(n,31),preparation2:uuid(n,32),dispatch:uuid(n,33),operation:uuid(n,34),correlation:uuid(n,35),
    attempt1:uuid(n,40),attempt2:uuid(n,41),receipt:uuid(n,42),reconciliation:uuid(n,43),
  };
}
function databaseUrl():string{const value=new URL(SERVER_URL);value.pathname=`/${DATABASE}`;return value.toString();}
function roleUrl(role:string):string{const value=new URL(ADMIN_URL);value.username=role;value.password="";return value.toString();}
function receiptPath(label:string):string{return join(tempDirectory,`${label}.json`);}
function readiness():RoleReadinessConfig{
  const roles=postgresRoleUrls(ADMIN_URL);
  return {
    provisioningUrl:roles.pos_migrator!,verificationUrl:roles.pos_platform_admin!,environmentId:`test-${DATABASE}`,
    expectedDatabase:DATABASE,repositoryCommit:TEST_COMMIT,operatorOrJobId:"vitest",receiptOutputPath:receiptPath("role-readiness"),
  };
}
function root(s:Scenario,generation=1):string{
  return `FISCAL_SUBMIT_DISPATCH_V1:${s.tenant}:${s.integration}:${s.document}:${generation}:SUBMIT_DOCUMENT`;
}
async function recreate():Promise<void>{
  const pool=new Pool({connectionString:SERVER_URL});
  try{await pool.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);await pool.query(`CREATE DATABASE "${DATABASE}"`);}finally{await pool.end();}
}
async function drop():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{await pool.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);}finally{await pool.end();}}

async function tx<T>(role:string,tenant:string|null,work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const pool=new Pool({connectionString:roleUrl(role),max:1});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    if(tenant!==null) await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    const result=await work(client);
    await client.query("COMMIT");
    return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();await pool.end();}
}

async function seedIntegration(s:Scenario):Promise<void>{
  const pool=new Pool({connectionString:ADMIN_URL,max:1});const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(`INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES ($1,$2,$2,$3,'ACTIVE',clock_timestamp(),clock_timestamp())`,[s.user,`model-a-${s.n}@example.test`,`Model A ${s.n}`]);
    await client.query(`INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES ($1,$2,'ACTIVE',clock_timestamp(),clock_timestamp())`,[s.tenant,`Model A Tenant ${s.n}`]);
    await client.query(`INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,$3,'America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())`,[s.company,s.tenant,`Model A Company ${s.n}`]);
    await client.query(`INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())`,[s.branch,s.tenant,s.company,`Branch ${s.n}`]);
    await client.query(`INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at) VALUES ($1,$2,$3,'ELECTRONIC_DOCUMENT_PROVIDER','ACTIVE',clock_timestamp(),clock_timestamp())`,[s.provider,`MODEL_A_${s.n}`,`Model A Provider ${s.n}`]);
    await client.query(`INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at) VALUES ($1,$2,$3,'1.0.0',1,'IMPLEMENTED','NOT_EVALUATED',clock_timestamp())`,[s.adapter,s.provider,`model-a-${s.n}`]);
    await client.query(`INSERT INTO integrations.provider_capability_declarations(id,provider_id,provider_adapter_version_id,capability_code,support_status,created_at) VALUES ($1,$2,$3,'ELECTRONIC_INVOICING','SUPPORTED',clock_timestamp())`,[s.declaration,s.provider,s.adapter]);
    await client.query(`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'TEST','CREATED',1,clock_timestamp(),clock_timestamp())`,[s.integration,s.tenant,s.company,s.provider,`MODEL_A_${s.n}`,s.adapter]);
    await client.query(`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at) VALUES ($1,$2,$3,$4,$5,'API_CREDENTIAL',1,'PENDING',clock_timestamp())`,[s.binding,s.tenant,s.company,s.integration,`secret://model-a/${s.n}`]);
    await client.query(`INSERT INTO integrations.integration_capabilities(id,tenant_id,company_id,integration_id,capability_code,support_status,configuration_version,effective_from,created_at) VALUES ($1,$2,$3,$4,'ELECTRONIC_INVOICING','SUPPORTED',1,clock_timestamp()-interval '1 minute',clock_timestamp())`,[s.capability,s.tenant,s.company,s.integration]);
    await client.query(`UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=clock_timestamp(),version=version+1 WHERE id=$1`,[s.binding]);
    for(const status of ["CREDENTIALS_CONFIGURED","AUTHENTICATED","DISCOVERING","DISCOVERY_COMPLETE","READY_FOR_REVIEW"]){
      await client.query(`UPDATE integrations.external_integrations SET status=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`,[s.integration,status]);
    }
    await client.query(`UPDATE integrations.external_integrations SET status='ACTIVE',activated_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1`,[s.integration]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();await pool.end();}
}

async function createFiscalFoundation(s:Scenario,secondDraft=false):Promise<void>{
  await tx("pos_app",s.tenant,async client=>{
    await client.query(`INSERT INTO fiscal.fiscal_connections(id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,created_at,updated_at,version) VALUES ($1,$2,$3,$4,$5,'ELECTRONIC_INVOICING',clock_timestamp()-interval '1 minute',clock_timestamp(),clock_timestamp(),1)`,[s.connection,s.tenant,s.company,s.integration,s.capability]);
    await client.query(`INSERT INTO fiscal.fiscal_emission_configurations(id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) VALUES ($1,$2,$3,NULL,'COMPANY',$4,$5,'ELECTRONIC_SALES_INVOICE',clock_timestamp())`,[s.configuration,s.tenant,s.company,s.connection,s.integration]);
    const insertVersion=async(id:string,versionNumber:number)=>client.query(`INSERT INTO fiscal.fiscal_emission_configuration_versions(id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,numbering_policy_code,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,created_by_actor_id,created_at,updated_at,row_version) VALUES ($1,$2,$3,NULL,'COMPANY',$4,$5,$6,'ELECTRONIC_SALES_INVOICE',$7,'DRAFT','900123456','Model A Issuer','PROVIDER_ASSIGNED',$8,repeat('a',64),1,repeat('b',64),clock_timestamp()-interval '1 minute',$9,clock_timestamp(),clock_timestamp(),1)`,[id,s.tenant,s.company,s.connection,s.integration,s.configuration,versionNumber,`snapshot://model-a/${s.n}/${versionNumber}`,s.user]);
    await insertVersion(s.version1,1);
    if(secondDraft) await insertVersion(s.version2,2);
    if(!secondDraft){
      const published=await client.query(`UPDATE fiscal.fiscal_emission_configuration_versions SET status='PUBLISHED',published_at=clock_timestamp(),published_by_actor_id=$2,updated_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1 AND status='DRAFT'`,[s.version1,s.user]);
      expect(published.rowCount).toBe(1);
    }
  });
}

async function createQueuedDocument(s:Scenario):Promise<void>{
  await tx("pos_app",s.tenant,async client=>{
    await client.query(`INSERT INTO fiscal.electronic_documents(id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,created_at,updated_at,version) VALUES ($1,$2,$3,$4,'SALE',$5,'ELECTRONIC_SALES_INVOICE',$6,'DRAFT',$7,1,clock_timestamp(),clock_timestamp(),1)`,[s.document,s.tenant,s.company,s.branch,s.source,`model-a:${s.n}`,`INV-${s.n}`]);
    await client.query(`INSERT INTO fiscal.fiscal_document_preparations(id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,created_by_actor_id,created_at,updated_at,version) VALUES ($1,$2,$3,$4,$5,'ELECTRONIC_SALES_INVOICE',1,NULL,'DRAFT',$6,$7,$8,$9,1,'COP',100000,0,19000,119000,$10,repeat('c',64),$11,repeat('d',64),1,repeat('e',64),'PROVIDER_ASSIGNED','PENDING_EXTERNAL',$12,clock_timestamp(),clock_timestamp(),1)`,[s.preparation1,s.tenant,s.company,s.branch,s.document,s.integration,s.connection,s.configuration,s.version1,`tax://model-a/${s.n}`,`fiscal://model-a/${s.n}`,s.user]);
  });
  await tx("pos_app",s.tenant,async client=>{
    const prep=await client.query(`UPDATE fiscal.fiscal_document_preparations SET preparation_state='FROZEN',frozen_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND preparation_state='DRAFT'`,[s.preparation1]);
    const doc=await client.query(`UPDATE fiscal.electronic_documents SET status='READY',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='DRAFT'`,[s.document]);
    expect(prep.rowCount).toBe(1);expect(doc.rowCount).toBe(1);
  });
  await tx("pos_app",s.tenant,async client=>{
    await client.query(`INSERT INTO integrations.integration_dispatches(id,tenant_id,company_id,integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,created_at,updated_at,version,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) VALUES ($1,$2,$3,$4,'ELECTRONIC_INVOICING','FISCAL','ELECTRONIC_DOCUMENT',$5,'ElectronicDocument',$6,$7,1,repeat('e',64),'QUEUED',$8,clock_timestamp(),clock_timestamp(),1,$9,1,1,repeat('e',64))`,[s.dispatch,s.tenant,s.company,s.integration,s.operation,s.document,root(s),s.correlation,s.preparation1]);
    const doc=await client.query(`UPDATE fiscal.electronic_documents SET status='QUEUED',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='READY'`,[s.document]);
    expect(doc.rowCount).toBe(1);
  });
}

async function prepareQueued(s:Scenario):Promise<void>{await seedIntegration(s);await createFiscalFoundation(s);await createQueuedDocument(s);}

async function insertAttemptCreated(client:PoolClient,s:Scenario,id:string,number:number):Promise<void>{
  await client.query(`INSERT INTO fiscal.fiscal_submission_attempts(id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,request_id,idempotency_key,request_checksum,correlation_id,created_at,version) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,1,'FISCAL','SUBMIT_DOCUMENT',$10,'CREATED',$11,$12,repeat('e',64),$13,clock_timestamp(),1)`,[id,s.tenant,s.company,s.integration,s.connection,s.document,s.preparation1,s.dispatch,s.binding,number,`request-${s.n}-${number}`,root(s),s.correlation]);
}
async function enterAttemptInProgress(client:PoolClient,id:string):Promise<void>{
  const result=await client.query(`UPDATE fiscal.fiscal_submission_attempts SET status='IN_PROGRESS',transport_status='NOT_SENT',started_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='CREATED'`,[id]);
  if(result.rowCount!==1) throw new Error("attempt claim CAS lost");
}

async function firstClaim(s:Scenario,attemptId:string):Promise<boolean>{
  return tx("pos_worker",s.tenant,async client=>{
    const doc=await client.query(`UPDATE fiscal.electronic_documents SET status='SUBMITTING',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND preparation_generation=1 AND status='QUEUED' RETURNING id`,[s.document]);
    if(doc.rowCount!==1) return false;
    const dispatch=await client.query(`UPDATE integrations.integration_dispatches SET status='DISPATCHING',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='QUEUED' RETURNING id`,[s.dispatch]);
    if(dispatch.rowCount!==1) throw new Error("dispatch claim CAS lost after document claim");
    await insertAttemptCreated(client,s,attemptId,1);
    await enterAttemptInProgress(client,attemptId);
    return true;
  });
}

async function makeRetryScheduled(s:Scenario):Promise<void>{
  await tx("pos_worker",s.tenant,async client=>{
    const attempt=await client.query(`UPDATE fiscal.fiscal_submission_attempts SET status='FAILED',transport_status='NOT_SENT',retry_classification='SAFE_RETRY',error_code='MODEL_A_SAFE_RETRY',completed_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='IN_PROGRESS'`,[s.attempt1]);
    const dispatch=await client.query(`UPDATE integrations.integration_dispatches SET status='RETRY_SCHEDULED',retry_classification='SAFE_RETRY',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='DISPATCHING'`,[s.dispatch]);
    expect(attempt.rowCount).toBe(1);expect(dispatch.rowCount).toBe(1);
  });
}
async function retryClaim(s:Scenario,attemptId:string):Promise<boolean>{
  return tx("pos_worker",s.tenant,async client=>{
    const locked=await client.query(`SELECT id FROM fiscal.electronic_documents WHERE id=$1 AND preparation_generation=1 AND status='SUBMITTING' FOR UPDATE`,[s.document]);
    if(locked.rowCount!==1) return false;
    const dispatch=await client.query(`UPDATE integrations.integration_dispatches SET status='DISPATCHING',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='RETRY_SCHEDULED' RETURNING id`,[s.dispatch]);
    if(dispatch.rowCount!==1) return false;
    await insertAttemptCreated(client,s,attemptId,2);
    await enterAttemptInProgress(client,attemptId);
    return true;
  });
}

async function reprepareQueued(s:Scenario):Promise<void>{
  await tx("pos_app",s.tenant,async client=>{
    const doc=await client.query(`UPDATE fiscal.electronic_documents SET status='DRAFT',preparation_generation=2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='QUEUED' AND preparation_generation=1`,[s.document]);
    if(doc.rowCount!==1) throw new Error("reprepare document CAS lost");
    const dispatch=await client.query(`UPDATE integrations.integration_dispatches SET status='CANCELLED',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='QUEUED'`,[s.dispatch]);
    if(dispatch.rowCount!==1) throw new Error("reprepare dispatch cancellation lost");
    const prior=await client.query(`UPDATE fiscal.fiscal_document_preparations SET preparation_state='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by_actor_id=$2,cancellation_reason='REPREPARE_BEFORE_SUBMISSION',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND preparation_state='FROZEN'`,[s.preparation1,s.user]);
    if(prior.rowCount!==1) throw new Error("reprepare preparation cancellation lost");
    await client.query(`INSERT INTO fiscal.fiscal_document_preparations(id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,created_by_actor_id,created_at,updated_at,version) VALUES ($1,$2,$3,$4,$5,'ELECTRONIC_SALES_INVOICE',2,$6,'DRAFT',$7,$8,$9,$10,2,'COP',100000,0,19000,119000,$11,repeat('c',64),$12,repeat('d',64),1,repeat('f',64),'PROVIDER_ASSIGNED','PENDING_EXTERNAL',$13,clock_timestamp(),clock_timestamp(),1)`,[s.preparation2,s.tenant,s.company,s.branch,s.document,s.preparation1,s.integration,s.connection,s.configuration,s.version1,`tax://model-a/${s.n}/2`,`fiscal://model-a/${s.n}/2`,s.user]);
  });
}

async function insertGeneralReceipt(s:Scenario):Promise<void>{
  await tx("pos_platform_app",s.tenant,async client=>{
    await client.query(`INSERT INTO integrations.external_webhook_receipts(id,tenant_id,company_id,integration_id,deduplication_key,received_at,payload_schema_version,payload_checksum,authentication_verification_result,replay_verification_result,processing_status,attempt_count,correlation_id,provider_event_id,created_at,version) VALUES ($1,$2,$3,$4,$5,clock_timestamp(),1,repeat('9',64),'VERIFIED','VERIFIED','RECEIVED',0,$6,$7,clock_timestamp(),1)`,[s.receipt,s.tenant,s.company,s.integration,`receipt-${s.n}`,s.correlation,`event-${s.n}`]);
  });
}
async function correlateReceipt(s:Scenario,generation:number,preparationId:string):Promise<void>{
  await tx("pos_worker",s.tenant,async client=>{
    await client.query(`SELECT id FROM fiscal.electronic_documents WHERE id=$1 FOR UPDATE`,[s.document]);
    await client.query(`SELECT id FROM fiscal.fiscal_document_preparations WHERE id=$1 FOR UPDATE`,[preparationId]);
    await client.query(`SELECT id FROM integrations.integration_dispatches WHERE id=$1 FOR UPDATE`,[s.dispatch]);
    const receipt=await client.query(`SELECT id FROM integrations.external_webhook_receipts WHERE id=$1 FOR UPDATE`,[s.receipt]);
    if(receipt.rowCount!==1) throw new Error("webhook receipt missing");
    await client.query(`UPDATE integrations.external_webhook_receipts SET fiscal_electronic_document_id=$2,fiscal_document_preparation_id=$3,fiscal_preparation_generation=$4,fiscal_integration_dispatch_id=$5,fiscal_correlated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND fiscal_electronic_document_id IS NULL`,[s.receipt,s.document,preparationId,generation,s.dispatch]);
  });
}

async function startReconciliation(s:Scenario):Promise<void>{
  await tx("pos_worker",s.tenant,async client=>{
    await client.query(`SELECT id FROM fiscal.electronic_documents WHERE id=$1 AND preparation_generation=1 FOR UPDATE`,[s.document]);
    await client.query(`SELECT id FROM fiscal.fiscal_document_preparations WHERE id=$1 FOR UPDATE`,[s.preparation1]);
    await client.query(`SELECT id FROM integrations.integration_dispatches WHERE id=$1 FOR UPDATE`,[s.dispatch]);
    await client.query(`INSERT INTO fiscal.fiscal_reconciliations(id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,created_at,updated_at,version) VALUES ($1,$2,$3,$4,$5,$6,'DOCUMENT',$7,1,$8,repeat('8',64),'CREATED',$9,$10,$11,clock_timestamp(),clock_timestamp(),1)`,[s.reconciliation,s.tenant,s.company,s.branch,s.integration,s.connection,s.document,`scope://model-a/${s.n}`,`expected://model-a/${s.n}`,s.user,s.correlation]);
    const run=await client.query(`UPDATE fiscal.fiscal_reconciliations SET status='RUNNING',started_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='CREATED'`,[s.reconciliation]);
    if(run.rowCount!==1) throw new Error("reconciliation start CAS lost");
  });
}

async function state(s:Scenario):Promise<{documentStatus:string;generation:number;dispatchStatus:string;preparations:number;attempts:number;inProgress:number}>{
  const pool=new Pool({connectionString:ADMIN_URL,max:1});
  try{
    const result=await pool.query<{document_status:string;generation:string;dispatch_status:string;preparations:string;attempts:string;in_progress:string}>(`SELECT d.status AS document_status,d.preparation_generation::text AS generation,x.status AS dispatch_status,(SELECT count(*)::text FROM fiscal.fiscal_document_preparations p WHERE p.tenant_id=d.tenant_id AND p.electronic_document_id=d.id) AS preparations,(SELECT count(*)::text FROM fiscal.fiscal_submission_attempts a WHERE a.tenant_id=d.tenant_id AND a.electronic_document_id=d.id) AS attempts,(SELECT count(*)::text FROM fiscal.fiscal_submission_attempts a WHERE a.tenant_id=d.tenant_id AND a.electronic_document_id=d.id AND a.status='IN_PROGRESS') AS in_progress FROM fiscal.electronic_documents d JOIN integrations.integration_dispatches x ON x.tenant_id=d.tenant_id AND x.internal_entity_id=d.id WHERE d.id=$1`,[s.document]);
    const row=result.rows[0];if(row===undefined) throw new Error("scenario state missing");
    return {documentStatus:row.document_status,generation:Number(row.generation),dispatchStatus:row.dispatch_status,preparations:Number(row.preparations),attempts:Number(row.attempts),inProgress:Number(row.in_progress)};
  }finally{await pool.end();}
}

async function publishVersion(s:Scenario,id:string):Promise<boolean>{
  try{
    await tx("pos_app",s.tenant,async client=>{
      const result=await client.query(`UPDATE fiscal.fiscal_emission_configuration_versions SET status='PUBLISHED',published_at=clock_timestamp(),published_by_actor_id=$2,updated_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1 AND status='DRAFT'`,[id,s.user]);
      if(result.rowCount!==1) throw new Error("publication CAS lost");
    });
    return true;
  }catch{return false;}
}

describe("003 Modelo A functional and concurrency gate",()=>{
  beforeAll(async()=>{
    tempDirectory=await mkdtemp(join(tmpdir(),"pos-003-model-a-"));
    await recreate();ADMIN_URL=databaseUrl();
    await applyPostgres001({adminUrl:ADMIN_URL,skipSmoke:true});
    await applyPostgres002({adminUrl:ADMIN_URL,skipSmoke:true});
    const ready=await applyRoleReadiness(readiness());expect(["READY_WITH_RECEIPT","READY_NO_OP"]).toContain(ready.result);
    const applied=await applyPostgres003({adminUrl:ADMIN_URL,expectedDatabase:DATABASE,environmentId:`test-${DATABASE}`,repositoryCommit:TEST_COMMIT,receiptOutputPath:receiptPath("apply-003")});
    expect(applied.noOp).toBe(false);
  },180_000);
  afterAll(async()=>{await drop();await rm(tempDirectory,{recursive:true,force:true});},120_000);

  it("materializes the functional Model A path through frozen preparation and durable claim",async()=>{
    const s=scenario(1);await prepareQueued(s);
    expect(await firstClaim(s,s.attempt1)).toBe(true);
    expect(await state(s)).toEqual({documentStatus:"SUBMITTING",generation:1,dispatchStatus:"DISPATCHING",preparations:1,attempts:1,inProgress:1});
    await expect(reprepareQueued(s)).rejects.toThrow();
  });

  it("serializes concurrent first claim to exactly one durable IN_PROGRESS attempt",async()=>{
    const s=scenario(2);await prepareQueued(s);
    const results=await Promise.all([firstClaim(s,s.attempt1),firstClaim(s,s.attempt2)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await state(s)).toEqual({documentStatus:"SUBMITTING",generation:1,dispatchStatus:"DISPATCHING",preparations:1,attempts:1,inProgress:1});
  });

  it("serializes SAFE_RETRY claims and preserves dispatch root/internal operation identity",async()=>{
    const s=scenario(3);await prepareQueued(s);expect(await firstClaim(s,s.attempt1)).toBe(true);await makeRetryScheduled(s);
    const results=await Promise.all([retryClaim(s,s.attempt2),retryClaim(s,uuid(s.n,44))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const pool=new Pool({connectionString:ADMIN_URL,max:1});
    try{
      const rows=await pool.query<{attempt_number:number;idempotency_key:string;internal_operation_id:string}>(`SELECT a.attempt_number,a.idempotency_key,d.internal_operation_id::text FROM fiscal.fiscal_submission_attempts a JOIN integrations.integration_dispatches d ON d.tenant_id=a.tenant_id AND d.id=a.integration_dispatch_id WHERE a.electronic_document_id=$1 ORDER BY a.attempt_number`,[s.document]);
      expect(rows.rows.map(row=>row.attempt_number)).toEqual([1,2]);
      expect(new Set(rows.rows.map(row=>row.idempotency_key))).toEqual(new Set([root(s)]));
      expect(new Set(rows.rows.map(row=>row.internal_operation_id))).toEqual(new Set([s.operation]));
    }finally{await pool.end();}
    expect((await state(s)).inProgress).toBe(1);
  });

  it("reprepares a QUEUED generation atomically with cancelled historical dispatch and preparation",async()=>{
    const s=scenario(4);await prepareQueued(s);await reprepareQueued(s);
    expect(await state(s)).toEqual({documentStatus:"DRAFT",generation:2,dispatchStatus:"CANCELLED",preparations:2,attempts:0,inProgress:0});
    const pool=new Pool({connectionString:ADMIN_URL,max:1});
    try{
      const row=(await pool.query<{old_state:string;new_state:string;supersedes:string}>(`SELECT p1.preparation_state AS old_state,p2.preparation_state AS new_state,p2.supersedes_preparation_id::text AS supersedes FROM fiscal.fiscal_document_preparations p1 JOIN fiscal.fiscal_document_preparations p2 ON p2.tenant_id=p1.tenant_id AND p2.electronic_document_id=p1.electronic_document_id AND p2.preparation_generation=2 WHERE p1.id=$1`,[s.preparation1])).rows[0];
      expect(row).toEqual({old_state:"CANCELLED",new_state:"DRAFT",supersedes:s.preparation1});
    }finally{await pool.end();}
  });

  it("serializes webhook late evidence against reprepare and quarantines the current generation",async()=>{
    const s=scenario(5);await prepareQueued(s);await insertGeneralReceipt(s);await reprepareQueued(s);await correlateReceipt(s,1,s.preparation1);
    const current=await state(s);expect(current.documentStatus).toBe("UNKNOWN_OUTCOME");expect(current.generation).toBe(2);expect(current.dispatchStatus).toBe("CANCELLED");
    const pool=new Pool({connectionString:ADMIN_URL,max:1});
    try{
      const receipt=(await pool.query<{generation:string;preparation:string}>(`SELECT fiscal_preparation_generation::text AS generation,fiscal_document_preparation_id::text AS preparation FROM integrations.external_webhook_receipts WHERE id=$1`,[s.receipt])).rows[0];
      expect(receipt).toEqual({generation:"1",preparation:s.preparation1});
    }finally{await pool.end();}
  });

  it("lets an in-flight DOCUMENT reconciliation win the fence and block reprepare",async()=>{
    const s=scenario(6);await prepareQueued(s);await startReconciliation(s);
    await expect(reprepareQueued(s)).rejects.toThrow(/blocks reprepare/);
    expect(await state(s)).toEqual({documentStatus:"QUEUED",generation:1,dispatchStatus:"QUEUED",preparations:1,attempts:0,inProgress:0});
  });

  it("serializes concurrent publication through FiscalConnection and leaves one published version",async()=>{
    const s=scenario(7);await seedIntegration(s);await createFiscalFoundation(s,true);
    const results=await Promise.all([publishVersion(s,s.version1),publishVersion(s,s.version2)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const pool=new Pool({connectionString:ADMIN_URL,max:1});
    try{
      const published=await pool.query<{count:string}>(`SELECT count(*)::text AS count FROM fiscal.fiscal_emission_configuration_versions WHERE fiscal_emission_configuration_id=$1 AND status='PUBLISHED'`,[s.configuration]);
      expect(published.rows[0]?.count).toBe("1");
    }finally{await pool.end();}
  });
});
