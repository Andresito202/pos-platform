import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {createPrivateKey} from "node:crypto";
import {parseCentralDeploymentConfiguration,verifyCentralTlsIdentity} from "./central-deployment-configuration.js";

export const CERTIFICATION_CONFIGURATION=Object.freeze({
  central:["CENTRAL_DEPLOYMENT_ENVIRONMENT","CENTRAL_AUTHORITY_ORIGIN","CENTRAL_AUTHORITY_PORT","CENTRAL_DATABASE_URL","CENTRAL_REQUEST_TIMEOUT_MS",
    "CENTRAL_HEADERS_TIMEOUT_MS","CENTRAL_SHUTDOWN_TIMEOUT_MS","D3_ENROLLMENT_MAX_BODY_BYTES","D3_CREDENTIAL_LIFETIME_MS"],
  managedFiles:["CENTRAL_TLS_KEY_FILE","CENTRAL_TLS_CERT_FILE","D3_ISSUER_PRIVATE_KEY_FILE","D3_ENROLLMENT_TRANSPORT_TOKEN_FILE",
    "CENTRAL_COMMERCIAL_PROVISION_FILE","CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE","CENTRAL_LICENSE_ACTIVATION_PROVISION_FILE",
    "SESSION_TRUST_ARTIFACT_FILE","SESSION_TRUST_TRANSPORT_TOKEN_FILE","AUTHORIZATION_TRUST_ARTIFACT_FILE","AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE",
    "CENTRAL_FACTUS_PAY_PROVISION_FILE","CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE"],
  fiscalSandbox:["FACTUS_SANDBOX_CLIENT_ID","FACTUS_SANDBOX_CLIENT_SECRET","FACTUS_SANDBOX_USERNAME","FACTUS_SANDBOX_PASSWORD"],
});
/** Offline/read-only. Never prints values, paths, database URLs or secret-file
 * contents. Does not authenticate FACTUS, contact a server or certify a person. */
export function inspectCentralCertification(env:NodeJS.ProcessEnv){
  const present=(name:string)=>Boolean(env[name]?.trim());
  const central=CERTIFICATION_CONFIGURATION.central.map(name=>({name,present:present(name)}));
  const files=CERTIFICATION_CONFIGURATION.managedFiles.map(name=>{
    let ready=false;try{const path=env[name];if(path&&isAbsolute(path)){const s=lstatSync(path);ready=s.isFile()&&!s.isSymbolicLink()&&s.size>0;}}catch{}
    return {name,present:present(name),regularAbsoluteFile:ready};
  });
  let configurationValid=false,tlsIdentityMatched=false;
  try{const config=parseCentralDeploymentConfiguration(env);configurationValid=true;
    if(files.filter(f=>["CENTRAL_TLS_KEY_FILE","CENTRAL_TLS_CERT_FILE"].includes(f.name)).every(f=>f.regularAbsoluteFile)){
      verifyCentralTlsIdentity(config,readFileSync(env.CENTRAL_TLS_CERT_FILE!),createPrivateKey(readFileSync(env.CENTRAL_TLS_KEY_FILE!)));tlsIdentityMatched=true;}
  }catch{}
  return {scope:"PROCESS_ENVIRONMENT_OFFLINE_READ_ONLY",central,files,fiscalSandbox:CERTIFICATION_CONFIGURATION.fiscalSandbox.map(name=>({name,present:present(name)})),
    configurationValid,tlsIdentityMatched,networkVerified:false,humanCertified:false,productionCertified:false};
}
