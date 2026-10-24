import {validateWindowsCommercialRegistration} from "@pos-platform/contracts";
/**
 * Deployment-owned D3 configuration gate. It deliberately has no defaults,
 * secret material, issuer or production activation switch.
 *
 * Approval is an operational decision, not an environment boolean. This
 * module validates evidence needed before wiring OAuth endpoints to the
 * existing central authority, and cannot make them live.
 */
export interface D3DeploymentEvidence {
  readonly issuerOrigin: string;
  readonly webauthnRpId: string;
  readonly webauthnOrigin: string;
  readonly electronClientId: string;
  readonly electronRedirectUri: string;
  readonly androidClientId: string;
  readonly androidRedirectUri: string;
  readonly androidPackageId: string;
  readonly androidSigningCertificateSha256: string;
  readonly androidAssetLinksVerified: boolean;
  readonly centralDeviceTrustVerified: boolean;
  readonly signingKeyCustodianConfirmed: boolean;
  readonly securityPolicyApprovalReference: string;
}

export type D3Readiness = Readonly<{ready: boolean; blockers: readonly string[]}>;

export function resolveWindowsCommercialRegistration(input:Partial<D3DeploymentEvidence>){
  if(!inspectD3DeploymentEvidence(input,"WINDOWS").ready)throw Error("D3_WINDOWS_DEPLOYMENT_INCOMPLETE");
  return validateWindowsCommercialRegistration({clientId:input.electronClientId!,redirectUri:input.electronRedirectUri!,
    authorizationOrigin:input.issuerOrigin!,platform:"ELECTRON"},input.webauthnRpId!,input.webauthnOrigin!);
}

export function inspectD3DeploymentEvidence(input: Partial<D3DeploymentEvidence> | null,
  target:"ALL"|"WINDOWS"="ALL"): D3Readiness {
  const blockers: string[]=[];
  if(target!=="ALL"&&target!=="WINDOWS")return Object.freeze({ready:false,blockers:Object.freeze(["D3_DEPLOYMENT_TARGET_INVALID"])});
  if (!input) return Object.freeze({ready:false,blockers:Object.freeze(["D3_DEPLOYMENT_EVIDENCE_REQUIRED"])});
  let issuer: URL | null=null;
  try {
    const url = new URL(input.issuerOrigin ?? "");
    if (url.protocol === "https:" && url.origin === input.issuerOrigin &&
        url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password &&
        url.hostname.includes(".") && url.hostname !== "localhost") issuer=url;
  } catch { /* fail closed */ }
  if (!issuer) blockers.push("D3_ISSUER_HTTPS_ORIGIN_REQUIRED");
  if (!input.webauthnRpId || !issuer ||
      (issuer.hostname !== input.webauthnRpId && !issuer.hostname.endsWith("."+input.webauthnRpId)))
    blockers.push("D3_RP_ID_MISMATCH");
  if (!issuer || input.webauthnOrigin !== issuer.origin) blockers.push("D3_WEBAUTHN_ORIGIN_MISMATCH");
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(input.electronClientId ?? "") ||
      (target==="ALL"&&(!/^[A-Za-z0-9._~-]{1,128}$/.test(input.androidClientId ?? "") ||
      input.electronClientId === input.androidClientId)))
    blockers.push("D3_DISTINCT_NATIVE_CLIENT_REGISTRATIONS_REQUIRED");
  try {
    const redirect=new URL(input.electronRedirectUri ?? "");
    if (redirect.protocol!=="http:" || redirect.hostname!=="127.0.0.1" ||
        !redirect.port || redirect.pathname!=="/callback" ||
        redirect.search || redirect.hash || redirect.username || redirect.password)
      blockers.push("D3_ELECTRON_LOOPBACK_INVALID");
  } catch {blockers.push("D3_ELECTRON_LOOPBACK_INVALID");}
  if(target==="ALL"){
  try {
    const redirect=new URL(input.androidRedirectUri ?? "");
    if (!issuer || redirect.protocol!=="https:" || redirect.origin!==issuer.origin ||
        redirect.pathname!=="/android/callback" || redirect.search || redirect.hash ||
        redirect.username || redirect.password)
      blockers.push("D3_ANDROID_HTTPS_APP_LINK_INVALID");
  } catch {blockers.push("D3_ANDROID_HTTPS_APP_LINK_INVALID");}
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(input.androidPackageId ?? "") ||
      !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(input.androidSigningCertificateSha256 ?? ""))
    blockers.push("D3_ANDROID_SIGNING_IDENTITY_REQUIRED");
  if (input.androidAssetLinksVerified!==true) blockers.push("D3_ANDROID_ASSET_LINKS_UNVERIFIED");
  }
  if (input.centralDeviceTrustVerified!==true) blockers.push("D3_CENTRAL_DEVICE_TRUST_UNVERIFIED");
  if (input.signingKeyCustodianConfirmed!==true) blockers.push("D3_SIGNING_KEY_CUSTODY_UNCONFIRMED");
  if (!/^D3-APPROVAL-[A-Za-z0-9._~-]{8,128}$/.test(input.securityPolicyApprovalReference ?? ""))
    blockers.push("D3_SECURITY_POLICY_APPROVAL_REQUIRED");
  return Object.freeze({ready:blockers.length===0,blockers:Object.freeze(blockers)});
}
