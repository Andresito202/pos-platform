import {X509Certificate,createPublicKey,type KeyObject} from "node:crypto";
import {isAbsolute} from "node:path";
import type {Pool} from "@pos-platform/database-postgres";
import {validateCommercialHttpsOrigin} from "@pos-platform/contracts";

export interface CentralDeploymentConfiguration {
  environment:"LOCAL"|"PREPRODUCTION"|"PRODUCTION";origin:string;port:number;bindAddress?:"127.0.0.1"|"0.0.0.0";
  maxBodyBytes:number;credentialLifetimeMs:number;shutdownTimeoutMs:number;
  requestTimeoutMs:number;headersTimeoutMs:number;enrollmentTokenFile:string;
}
export function resolveCentralDeploymentConfiguration(env:NodeJS.ProcessEnv):CentralDeploymentConfiguration|null{
  return ["CENTRAL_DEPLOYMENT_ENVIRONMENT","CENTRAL_AUTHORITY_ORIGIN","CENTRAL_BIND_ADDRESS","CENTRAL_REQUEST_TIMEOUT_MS","CENTRAL_HEADERS_TIMEOUT_MS",
    "CENTRAL_SHUTDOWN_TIMEOUT_MS","D3_ENROLLMENT_TRANSPORT_TOKEN_FILE"].some(name=>env[name]!==undefined)?parseCentralDeploymentConfiguration(env):null;
}
/** Opt-in deployment validation; never activates BUSINESS/SAS endpoints.
 * Existing legacy enrollment startup remains compatible until migrated by its operator. */
export function parseCentralDeploymentConfiguration(env:NodeJS.ProcessEnv):CentralDeploymentConfiguration{
  const environment=env.CENTRAL_DEPLOYMENT_ENVIRONMENT;
  if(!["LOCAL","PREPRODUCTION","PRODUCTION"].includes(environment??""))throw Error("CENTRAL_DEPLOYMENT_ENVIRONMENT_REQUIRED");
  const bindAddress=env.CENTRAL_BIND_ADDRESS;
  if(bindAddress!==undefined&&!["127.0.0.1","0.0.0.0"].includes(bindAddress))throw Error("CENTRAL_BIND_ADDRESS_REJECTED");
  const integer=(name:string,max=Number.MAX_SAFE_INTEGER)=>{const value=env[name];
    if(!value||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<=0||Number(value)>max)throw Error("CENTRAL_DEPLOYMENT_INTEGER_REQUIRED");return Number(value);};
  let origin:URL;try{origin=new URL(env.CENTRAL_AUTHORITY_ORIGIN??"");}catch{throw Error("CENTRAL_DEPLOYMENT_ORIGIN_INVALID");}
  if(origin.protocol!=="https:"||origin.origin!==env.CENTRAL_AUTHORITY_ORIGIN||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)
    throw Error("CENTRAL_DEPLOYMENT_ORIGIN_INVALID");
  if(environment!=="LOCAL"){try{validateCommercialHttpsOrigin(origin.origin);}catch{throw Error("CENTRAL_COMMERCIAL_ORIGIN_REQUIRED");}}
  if(!env.D3_ENROLLMENT_TRANSPORT_TOKEN_FILE||!isAbsolute(env.D3_ENROLLMENT_TRANSPORT_TOKEN_FILE)||env.D3_ENROLLMENT_TRANSPORT_TOKEN)
    throw Error("CENTRAL_MANAGED_TOKEN_FILE_REQUIRED");
  for(const name of ["CENTRAL_TLS_KEY_FILE","CENTRAL_TLS_CERT_FILE","D3_ISSUER_PRIVATE_KEY_FILE"])
    if(!env[name]||!isAbsolute(env[name]!))throw Error("CENTRAL_MANAGED_KEY_FILES_REQUIRED");
  let database:URL;try{database=new URL(env.CENTRAL_DATABASE_URL??"");}catch{throw Error("CENTRAL_DATABASE_CONFIGURATION_INVALID");}
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==="0"||[...database.searchParams.keys()].some(k=>database.searchParams.getAll(k).length!==1)||
    database.searchParams.has("ssl")||database.searchParams.has("uselibpqcompat"))throw Error("CENTRAL_DATABASE_TLS_CONFIGURATION_AMBIGUOUS");
  if(!["postgres:","postgresql:"].includes(database.protocol)||decodeURIComponent(database.username)!=="pos_platform_app")throw Error("CENTRAL_RUNTIME_ROLE_REQUIRED");
  if(environment!=="LOCAL"&&database.searchParams.get("sslmode")!=="verify-full")throw Error("CENTRAL_DATABASE_TLS_VERIFICATION_REQUIRED");
  if(environment==="LOCAL"&&!["127.0.0.1","localhost","[::1]"].includes(database.hostname))throw Error("CENTRAL_LOCAL_DATABASE_LOOPBACK_REQUIRED");
  const requestTimeoutMs=integer("CENTRAL_REQUEST_TIMEOUT_MS",2147483647),headersTimeoutMs=integer("CENTRAL_HEADERS_TIMEOUT_MS",2147483647);
  if(headersTimeoutMs>requestTimeoutMs)throw Error("CENTRAL_TIMEOUT_ORDER_INVALID");
  return Object.freeze({environment:environment as CentralDeploymentConfiguration["environment"],origin:origin.origin,
    ...(bindAddress===undefined?{}:{bindAddress:bindAddress as "127.0.0.1"|"0.0.0.0"}),
    port:integer("CENTRAL_AUTHORITY_PORT",65535),maxBodyBytes:integer("D3_ENROLLMENT_MAX_BODY_BYTES"),credentialLifetimeMs:integer("D3_CREDENTIAL_LIFETIME_MS"),
    shutdownTimeoutMs:integer("CENTRAL_SHUTDOWN_TIMEOUT_MS",2147483647),requestTimeoutMs,headersTimeoutMs,enrollmentTokenFile:env.D3_ENROLLMENT_TRANSPORT_TOKEN_FILE});
}

export function verifyCentralTlsIdentity(configuration:CentralDeploymentConfiguration,certificate:Buffer,key:KeyObject,at=new Date()){
  const cert=new X509Certificate(certificate),now=at.getTime();
  if(!Number.isFinite(now)||now<Date.parse(cert.validFrom)||now>=Date.parse(cert.validTo)||!cert.checkPrivateKey(key)||
    !cert.checkHost(new URL(configuration.origin).hostname))throw Error("CENTRAL_TLS_IDENTITY_REJECTED");
  // Leaf matching is a server preflight, not proof that clients trust its CA.
  return cert.fingerprint256;
}
export function verifyEnrollmentIssuerKey(key:KeyObject){
  if(key.type!=="private"||createPublicKey(key).asymmetricKeyType!=="ed25519")throw Error("CENTRAL_ENROLLMENT_ISSUER_KEY_REJECTED");
}
export async function verifyCentralRuntimeDatabase(pool:Pick<Pool,"query">){
  const result=await pool.query(`SELECT current_user='pos_platform_app' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible,
    to_regclass('identity.device_registry') IS NOT NULL AND to_regclass('identity.device_credentials') IS NOT NULL
    AND to_regclass('identity.device_enrollment_activations') IS NOT NULL AND to_regclass('identity.device_authentication_events') IS NOT NULL AS schema_ready
    FROM pg_roles WHERE rolname=current_user`);
  if(result.rows.length!==1||result.rows[0]?.eligible!==true||result.rows[0]?.schema_ready!==true)throw Error("CENTRAL_RUNTIME_DATABASE_REJECTED");
}

/** Concurrent probes share one read-only operation, including while a timed-out
 * query is still pending; health traffic cannot create an unbounded DB queue. */
export function createCentralReadinessProbe(pool:Pick<Pool,"query">,timeoutMs:number){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error("CENTRAL_READINESS_TIMEOUT_REQUIRED");
  let pending:Promise<boolean>|undefined;
  return async()=>{
    if(!pending){const work=verifyCentralRuntimeDatabase(pool).then(()=>true,()=>false);pending=work;void work.then(()=>{if(pending===work)pending=undefined;});}
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([pending,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
    finally{if(timer)clearTimeout(timer);}
  };
}
