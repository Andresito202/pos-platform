import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";

type FiscalTestTransaction = <T>(role: string, tenant: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;

export type Scenario={
  n:number;
  user:string;tenant:string;company:string;branch:string;source:string;
  provider:string;adapter:string;declaration:string;integration:string;capability:string;binding:string;
  connection:string;configuration:string;version1:string;version2:string;
  document:string;preparation1:string;preparation2:string;dispatch:string;operation:string;correlation:string;
  attempt1:string;attempt2:string;receipt:string;reconciliation:string;
};

export function uuid(n:number,slot:number):string{
  const first=(0x018f3000+n).toString(16).padStart(8,"0");
  return `${first}-0000-7000-8000-${slot.toString(16).padStart(12,"0")}`;
}
export function scenario(n:number):Scenario{
  return {
    n,
    user:uuid(n,1),tenant:uuid(n,2),company:uuid(n,3),branch:uuid(n,4),source:uuid(n,5),
    provider:uuid(n,10),adapter:uuid(n,11),declaration:uuid(n,12),integration:uuid(n,13),capability:uuid(n,14),binding:uuid(n,15),
    connection:uuid(n,20),configuration:uuid(n,21),version1:uuid(n,22),version2:uuid(n,23),
    document:uuid(n,30),preparation1:uuid(n,31),preparation2:uuid(n,32),dispatch:uuid(n,33),operation:uuid(n,34),correlation:uuid(n,35),
    attempt1:uuid(n,40),attempt2:uuid(n,41),receipt:uuid(n,42),reconciliation:uuid(n,43),
  };
}
export async function seedFiscalIntegration(s:Scenario,adminUrl:string):Promise<void>{
  const pool=new Pool({connectionString:adminUrl,max:1});const client=await pool.connect();
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

export async function insertFiscalFoundation(s:Scenario,tx: FiscalTestTransaction,secondDraft=false):Promise<void>{
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

export async function insertFiscalDraft(client: PoolClient, s: Scenario): Promise<void> {
    await client.query(`INSERT INTO fiscal.electronic_documents(id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,created_at,updated_at,version) VALUES ($1,$2,$3,$4,'SALE',$5,'ELECTRONIC_SALES_INVOICE',$6,'DRAFT',$7,1,clock_timestamp(),clock_timestamp(),1)`,[s.document,s.tenant,s.company,s.branch,s.source,`model-a:${s.n}`,`INV-${s.n}`]);
    await client.query(`INSERT INTO fiscal.fiscal_document_preparations(id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,created_by_actor_id,created_at,updated_at,version) VALUES ($1,$2,$3,$4,$5,'ELECTRONIC_SALES_INVOICE',1,NULL,'DRAFT',$6,$7,$8,$9,1,'COP',100000,0,19000,119000,$10,repeat('c',64),$11,repeat('d',64),1,repeat('e',64),'PROVIDER_ASSIGNED','PENDING_EXTERNAL',$12,clock_timestamp(),clock_timestamp(),1)`,[s.preparation1,s.tenant,s.company,s.branch,s.document,s.integration,s.connection,s.configuration,s.version1,`tax://model-a/${s.n}`,`fiscal://model-a/${s.n}`,s.user]);
}
