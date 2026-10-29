import {inspectCentralCertification} from "./central-certification-preflight.js";

/** Focused, offline BUSINESS/GLOBAL login deployment preflight.
 * Never reads private key contents into the output, contacts Central,
 * authenticates a user or asserts that RBAC/SSA/SAS have been certified.
 * Payment, license and fiscal prerequisites are outside the P0 login scope.
 */
export function inspectCentralLoginPreflight(env:NodeJS.ProcessEnv) {
  const report=inspectCentralCertification(env);
  const managed=new Set([
    "CENTRAL_TLS_KEY_FILE","CENTRAL_TLS_CERT_FILE",
    "D3_ISSUER_PRIVATE_KEY_FILE","D3_ENROLLMENT_TRANSPORT_TOKEN_FILE",
    "CENTRAL_COMMERCIAL_PROVISION_FILE","CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE",
    "SESSION_TRUST_ARTIFACT_FILE","SESSION_TRUST_TRANSPORT_TOKEN_FILE",
    "AUTHORIZATION_TRUST_ARTIFACT_FILE","AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE",
  ]);
  const files=report.files.filter(x=>managed.has(x.name));
  const missingConfiguration=report.central.filter(x=>!x.present).map(x=>x.name);
  const missingFiles=files.filter(x=>!x.regularAbsoluteFile).map(x=>x.name);
  const configurationReady=missingConfiguration.length===0 && missingFiles.length===0 &&
    report.configurationValid && report.tlsIdentityMatched;
  return Object.freeze({
    scope:"BUSINESS_GLOBAL_LOGIN_OFFLINE_READ_ONLY" as const,
    environmentNames:report.central,
    managedFiles:files,
    missingConfiguration,
    missingFiles,
    configurationValid:report.configurationValid,
    tlsIdentityMatched:report.tlsIdentityMatched,
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
