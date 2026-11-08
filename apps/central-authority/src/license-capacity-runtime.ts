import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {createPrivateKey} from "node:crypto";
import type {IncomingMessage,ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {LicenseActivationProvisionSchema,validateCommercialHttpsOrigin} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {LicenseCapacityAuthority,LICENSE_ACTIVATION_PATH} from "./license-capacity-authority.js";
import {inspectCommercialHeaders,readCommercialJsonBody,sendCommercialJson} from "./isolated-commercial-https.js";
import {FixedWindowRateLimiter} from "./fixed-window-rate-limiter.js";
function managed(path:string,max:number){
  if(!isAbsolute(path))throw Error("LICENSE_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max||process.platform!=="win32"&&(stat.mode&0o077)!==0)throw Error("LICENSE_MANAGED_FILE_REJECTED");
  return readFileSync(path);
}
export function createLicenseCapacityHandler(authority:LicenseCapacityAuthority,origin:string,limits:{requests:number;buckets:number;windowMs:number}){
  const limiter=new FixedWindowRateLimiter(limits.requests,limits.buckets,limits.windowMs);
  return async(req:IncomingMessage,res:ServerResponse)=>{
    try{
      if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(origin).host||req.headers.origin!==undefined||
        req.method!=="POST"||req.url!==LICENSE_ACTIVATION_PATH){sendCommercialJson(res,403,{code:"LICENSE_NATIVE_REQUEST_REJECTED"});return;}
      inspectCommercialHeaders(req);
      if(!limiter.allow(req.socket.remoteAddress??"unknown")){sendCommercialJson(res,429,{code:"LICENSE_RATE_LIMITED"});return;}
      const {raw}=await readCommercialJsonBody(req,16384);
      const authorization=req.headers.authorization,requestId=req.headers["x-request-id"],correlationId=req.headers["x-correlation-id"];
      if(typeof authorization!=="string"||typeof requestId!=="string"||typeof correlationId!=="string")throw Error("LICENSE_PROOF_REQUIRED");
      sendCommercialJson(res,200,await authority.activate({body:raw,authorization,requestId,correlationId}));
    }catch{sendCommercialJson(res,403,{code:"LICENSE_ACTIVATION_REJECTED"});}
  };
}
export async function prepareLicenseCapacityRuntime(input:{pool:Pool;provisionFile:string;origin:string;environment:"PREPRODUCTION"|"PRODUCTION"}){
  validateCommercialHttpsOrigin(input.origin);
  const p=LicenseActivationProvisionSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(managed(input.provisionFile,32768))));
  if(p.environment!==input.environment)throw Error("LICENSE_DEPLOYMENT_ENVIRONMENT_MISMATCH");
  const db=(await input.pool.query(`SELECT current_database() AS db,current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS ok FROM pg_roles WHERE rolname=current_user`)).rows[0];
  const ledger=(await input.pool.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id='022_license_activations' AND status='APPLIED'")).rows;
  if(db?.db!==p.expected_database||db.ok!==true||ledger.length!==1||ledger[0].checksum!==p.migration_checksum)throw Error("LICENSE_REGISTERED_DATABASE_REQUIRED");
  const authority=new LicenseCapacityAuthority(input.pool,p.policy,{keyId:p.key_id,privateKey:createPrivateKey(managed(p.private_key_file,8192)),environment:p.environment},
    {reauthenticationMs:p.reauthentication_ms,lockTimeoutMs:p.sql_lock_ms,statementTimeoutMs:p.sql_statement_ms});
  return {authority,handler:createLicenseCapacityHandler(authority,input.origin,{requests:p.requests_per_window,buckets:p.maximum_buckets,windowMs:p.request_window_ms})};
}
