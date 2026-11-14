import {inspectCentralCertification} from "./central-certification-preflight.js";

/** P0 BUSINESS + GLOBAL only. All output is names/booleans; no secrets or paths.
 * Read-only: never starts a listener, reads personal credentials or alters DB.
 * Optional publication tokens are not mandatory when the deployment does not
 * distribute that trust bundle over HTTP (Central main.ts semantics).
 */
export function inspectCentralLoginPreflight(env:NodeJS.ProcessEnv) {
  const report=inspectCentralCertification(env);
  const requiredFiles=new Set([
    "CENTRAL_TLS_KEY_FILE","CENTRAL_TLS_CERT_FILE",
    "D3_ISSUER_PRIVATE_KEY_FILE","D3_ENROLLMENT_TRANSPORT_TOKEN_FILE",
    "CENTRAL_COMMERCIAL_PROVISION_FILE","CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE",
    "SESSION_TRUST_ARTIFACT_FILE",
    "AUTHORIZATION_TRUST_ARTIFACT_FILE","AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE",
  ]);
  const optionalFiles=new Set(["SESSION_TRUST_TRANSPORT_TOKEN_FILE"]);
  const files=report.files.filter(x=>requiredFiles.has(x.name)||optionalFiles.has(x.name));
  const missingConfiguration=report.central.filter(x=>!x.present).map(x=>x.name);
  const missingFiles=files.filter(x=>requiredFiles.has(x.name)&&!x.regularAbsoluteFile
    ||optionalFiles.has(x.name)&&x.present&&!x.regularAbsoluteFile).map(x=>x.name);
  const environmentAllowed=env.CENTRAL_DEPLOYMENT_ENVIRONMENT==="PREPRODUCTION"
    ||env.CENTRAL_DEPLOYMENT_ENVIRONMENT==="PRODUCTION";
  const configurationReady=missingConfiguration.length===0&&missingFiles.length===0&&
    environmentAllowed&&report.configurationValid&&report.tlsIdentityMatched;
  return Object.freeze({
    scope:"BUSINESS_GLOBAL_LOGIN_OFFLINE_READ_ONLY" as const,
    environmentNames:report.central,
    managedFiles:files,
    missingConfiguration,
    missingFiles,
    configurationValid:report.configurationValid,
    tlsIdentityMatched:report.tlsIdentityMatched,
    environmentAllowed,
    configuredLocally:configurationReady,
    centralDatabaseVerified:false,
    windowsServiceVerified:false,
    businessSessionVerified:false,
    globalSessionVerified:false,
    physicalMfaVerified:false,
    sasSsaVerified:false,
    humanCertified:false,
    status:configurationReady?"CONFIGURATION_PRESENT_UNVERIFIED" as const:"BLOCKED_BY_CONFIGURATION" as const,
  });
}
