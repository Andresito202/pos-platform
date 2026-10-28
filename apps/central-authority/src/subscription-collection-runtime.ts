import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {FactusPayCollectionsProvisionSchema,SubscriptionQuoteTermsSchema,canonicalSessionTrustJson,uuidV7} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {FactusPayQuoteVerifier,type FactusPayCredentialResolver,type FactusPayCredentialBinding} from "./factus-pay-quote-verifier.js";
import {SubscriptionPayments} from "./subscription-payments.js";
import {readWindowsFactusPayCredential} from "./factus-pay-windows-custody.js";

function managedJson(path:string,maximum:number):unknown{
  if(!isAbsolute(path))throw Error("COLLECTIONS_ABSOLUTE_MANAGED_FILE_REQUIRED");
  const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>maximum||process.platform!=="win32"&&(s.mode&0o077)!==0)
    throw Error("COLLECTIONS_MANAGED_FILE_REJECTED");
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path)));
}

/** Managed service-only access tokens, never supplied by a browser. Operators
 * provision the real provider account and refresh this custody file atomically.
 * Each resolve rereads it so rotation/revocation is not hidden by a token cache. */
export class ManagedFactusPayCredentials implements FactusPayCredentialResolver{
  constructor(private readonly path:string){if(!isAbsolute(path))throw Error("COLLECTIONS_ABSOLUTE_MANAGED_FILE_REQUIRED");}
  async resolve(binding:Readonly<FactusPayCredentialBinding>,signal:AbortSignal){
    signal.throwIfAborted();
    try{
      const file=managedJson(this.path,65536) as {profile?:unknown;credentials?:unknown};
      if(file?.profile!=="CAMACHO_FACTUS_PAY_API_CUSTODY_V1"||!Array.isArray(file.credentials)||file.credentials.length>32)
        throw Error();
      const rows=file.credentials.filter((r:unknown)=>typeof r==="object"&&r!==null&&
        canonicalSessionTrustJson((r as {binding:unknown}).binding)===canonicalSessionTrustJson(binding));
      if(rows.length!==1)throw Error();
      let row=rows[0] as {binding:FactusPayCredentialBinding;accessToken:string;expiresAt:string|null;protectedCredential?:{provider?:unknown;data?:unknown}};
      if(row.protectedCredential){
        if(row.protectedCredential.provider!=="WINDOWS_DPAPI_CURRENT_USER"||typeof row.protectedCredential.data!=="string"||row.protectedCredential.data.length>65536)throw Error();
        row=readWindowsFactusPayCredential(this.path,row.protectedCredential.data) as typeof row;
        if(canonicalSessionTrustJson(row.binding)!==canonicalSessionTrustJson(binding))throw Error();
      }
      if(typeof row.accessToken!=="string"||row.accessToken.length<1||row.accessToken.length>8192||/[\r\n]/.test(row.accessToken)||
        row.expiresAt!==null&&(typeof row.expiresAt!=="string"||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=Date.now()))throw Error();
      return {binding:{...binding},accessToken:row.accessToken,expiresAt:row.expiresAt};
    }catch{throw Error("COLLECTIONS_MANAGED_CREDENTIAL_REJECTED");}
  }
}

/** Existing pending Payments are the durable work source. Quotes alone do not
 * cause a collection. No second queue, financial status or activation authority. */
export async function prepareSubscriptionCollectionRuntime(input:{pool:Pool;provisionFile:string;
  transport?:typeof fetch;onError?:(code:string)=>void}){
  const p=FactusPayCollectionsProvisionSchema.parse(managedJson(input.provisionFile,32768));
  const {pool}=input;
  const role=(await pool.query(`SELECT current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS ok FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(role?.ok!==true)throw Error("COLLECTIONS_CENTRAL_ROLE_REQUIRED");
  for(const [id,checksum] of Object.entries(p.migrations)){
    const rows=(await pool.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED'",[id])).rows;
    if(rows.length!==1||rows[0].checksum!==checksum)throw Error("COLLECTIONS_REGISTERED_SCHEMA_REQUIRED");
  }
  const limits={requestTimeoutMs:p.request_timeout_ms,maximumResponseBytes:p.maximum_response_bytes,evidenceLifetimeMs:p.evidence_lifetime_ms,
    lockTimeoutMs:p.lock_timeout_ms,statementTimeoutMs:p.statement_timeout_ms};
  const verifier=new FactusPayQuoteVerifier(pool,new ManagedFactusPayCredentials(p.credentials_file),limits,input.transport);
  const payments=new SubscriptionPayments(pool,verifier,p.merchant,limits);
  let running:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopped=false,cursor:string|null=null;
  const abort=new AbortController();
  async function cycle(){
    const c=await pool.connect();let rows;
    try{await c.query("BEGIN READ ONLY");await c.query("SELECT set_config('statement_timeout',$1,true),set_config('app.tenant_id',$2,true)",[`${p.statement_timeout_ms}ms`,p.merchant.tenantId]);
      rows=(await c.query(`SELECT q.id AS quote_id,p.id AS payment_id,q.terms_snapshot,a.evidence_snapshot,
        extract(epoch FROM(q.expires_at-clock_timestamp())) AS remaining,i.environment
        FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
        JOIN payments.payment_attempts a ON a.payment_id=p.id JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
        JOIN integrations.external_integrations i ON i.id=q.integration_id AND i.tenant_id=q.merchant_tenant_id
        WHERE p.tenant_id=$1 AND p.company_id=$2 AND p.branch_id=$3 AND q.integration_id=$4
        AND p.status='PENDING' AND a.status='PENDING' AND ($5::uuid IS NULL OR p.id>$5)
        ORDER BY p.id LIMIT $6`,[p.merchant.tenantId,p.merchant.companyId,p.merchant.branchId,p.merchant.integrationId,cursor,p.batch_size])).rows;
      await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
    if(!rows.length){cursor=null;return;}
    for(const row of rows){
      if(abort.signal.aborted)return;cursor=String(row.payment_id);
      try{
        const terms=SubscriptionQuoteTermsSchema.parse(row.terms_snapshot);
        if(row.environment!==p.environment||!p.approved_quote_policies.some(approved=>approved.policy_reference===terms.policy_reference&&
          approved.tax_policy_reference===terms.tax_policy_reference&&approved.support_policy_reference===terms.support_policy_reference))
          throw Error("COLLECTIONS_APPROVED_QUOTE_POLICY_REQUIRED");
        if(Number(row.remaining)<=0){await payments.reviewExpired(row.quote_id,uuidV7());continue;}
        if(row.evidence_snapshot?.profile!=="FACTUS_COLLECTION_PREPARED_V1"){
          if(Number(row.remaining)<=p.collection_expiration_seconds)throw Error("COLLECTIONS_QUOTE_WINDOW_INSUFFICIENT");
          await payments.recordCollection(await verifier.prepareCollection(row.quote_id,p.collection_expiration_seconds,abort.signal),uuidV7());
        }
        try{await payments.confirm(await verifier.verifyQuote(row.quote_id,abort.signal),uuidV7());}
        catch(e){if(!(e instanceof Error)||e.message!=="FACTUS_PAY_COLLECTION_NOT_PAID")throw e;}
      }catch(e){input.onError?.(e instanceof Error&&/^(?:FACTUS|SUBSCRIPTION|COLLECTIONS)_[A-Z_]+$/.test(e.message)?e.message:"COLLECTIONS_PROCESSING_FAILED");}
    }
  }
  function tick(){if(stopped)throw Error("COLLECTIONS_RUNTIME_STOPPED");return running??=cycle().finally(()=>{running=undefined;});}
  function schedule(){if(stopped)return;timer=setTimeout(()=>{
    void tick().catch(()=>input.onError?.("COLLECTIONS_CYCLE_FAILED")).finally(schedule);
  },p.poll_interval_ms);timer.unref();}
  return {tick,start(){if(stopped||timer)throw Error("COLLECTIONS_RUNTIME_ALREADY_STARTED_OR_STOPPED");schedule();},
    async stop(){stopped=true;clearTimeout(timer);abort.abort();await running;}};
}
