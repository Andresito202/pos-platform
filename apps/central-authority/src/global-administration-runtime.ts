import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {GlobalAdministrationProvisionSchema,isSupportedPlatformPasswordVerifier} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {createGlobalAdministrationHandler} from "./global-administration-http.js";
import {createGlobalAdministrationAssets} from "./global-administration-assets.js";
import type {LicenseCapacityAuthority} from "./license-capacity-authority.js";
function managed(path:string,max:number){
  if(!isAbsolute(path))throw Error("GLOBAL_ADMIN_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max||process.platform!=="win32"&&(s.mode&0o077)!==0)throw Error("GLOBAL_ADMIN_MANAGED_FILE_REJECTED");
  return new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path));
}
export async function prepareGlobalAdministrationRuntime(input:{pool:Pool;provisionFile:string;origin:string;licenseAuthority?:LicenseCapacityAuthority}){
  const p=GlobalAdministrationProvisionSchema.parse(JSON.parse(managed(input.provisionFile,32768))),l=p.limits;
  const found=(await input.pool.query(`SELECT current_database() AS db,current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(found?.db!==p.expected_database||found?.eligible!==true)throw Error("GLOBAL_ADMIN_REGISTERED_DATABASE_REQUIRED");
  const ledger=(await input.pool.query(`SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions
    WHERE migration_id='021_global_browser_administration' AND status='APPLIED'`)).rows;
  if(ledger.length!==1||ledger[0].checksum!==p.migration_checksum)throw Error("GLOBAL_ADMIN_REGISTERED_SCHEMA_REQUIRED");
  const rejection=managed(p.rejection_verifier_file,8192).trim();if(!isSupportedPlatformPasswordVerifier(rejection))throw Error("GLOBAL_ADMIN_REJECTION_VERIFIER_REQUIRED");
  const api=createGlobalAdministrationHandler({pool:input.pool,policy:{mode:"DEPLOYMENT",origin:input.origin,rpId:p.rp_id,policyReference:p.policy_reference,
    rejectionVerifier:rejection,challengeLifetimeMs:l.challenge_ms,sessionLifetimeMs:l.session_ms,maximumMfaAgeMs:l.mfa_age_ms,
    maximumReauthenticationAgeMs:l.reauthentication_ms,browserLifetimeMs:l.browser_ms,idleTimeoutMs:l.idle_ms,lockTimeoutMs:l.sql_lock_ms,statementTimeoutMs:l.sql_statement_ms},
    limits:{maximumBodyBytes:l.maximum_body_bytes,maximumPendingFlows:l.maximum_pending_flows,requestsPerWindow:l.requests_per_window,
      maximumBuckets:l.maximum_buckets,requestWindowMs:l.request_window_ms,loginWindowMs:l.login_window_ms,
      maximumLoginPerAddress:l.maximum_login_per_address,maximumLoginPerAccount:l.maximum_login_per_account},
    ...(p.fulfillment_policies?{fulfillmentPolicies:p.fulfillment_policies}:{}),...(input.licenseAuthority?{licenseAuthority:input.licenseAuthority}:{})});
  const assets=p.renderer?createGlobalAdministrationAssets({directory:p.renderer.directory,maximumAssetBytes:p.renderer.maximum_asset_bytes,origin:input.origin}):null;
  return async(req:Parameters<typeof api>[0],res:Parameters<typeof api>[1])=>{
    if(req.url==="/platform"||req.url?.startsWith("/platform/")){
      if(assets)await assets(req,res);else{res.writeHead(503,{"cache-control":"no-store","content-length":"0"});res.end();}return;
    }
    await api(req,res);
  };
}
