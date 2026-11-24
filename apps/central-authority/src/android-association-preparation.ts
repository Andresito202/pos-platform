import {X509Certificate} from "node:crypto";
import {CamachoCommercialDomains,validateNativeClientRegistration,type NativeClientRegistration} from "@pos-platform/contracts";
/** Public metadata producer only. Does not publish DAL, register a client,
 * approve SEC-004 or turn a laboratory APK into the commercial application. */
export function prepareAndroidAssociation(registration:NativeClientRegistration,signingCertificate:Buffer|string){
  const r=validateNativeClientRegistration(registration),d=CamachoCommercialDomains;
  if(r.platform!=="ANDROID"||r.authorizationOrigin!==d.centralOrigin||r.redirectUri!==d.centralOrigin+d.androidCallbackPath||
    /(?:^|\.)(?:runtimeprobe|probe|lab|debug)$/.test(r.androidPackageId!))throw Error("ANDROID_COMMERCIAL_ASSOCIATION_REQUIRED");
  const actual=new X509Certificate(signingCertificate).fingerprint256.toUpperCase();
  if(actual!==r.androidSigningCertificateSha256)throw Error("ANDROID_RELEASE_CERTIFICATE_MISMATCH");
  return Object.freeze({origin:d.centralOrigin,callback:r.redirectUri,associationPath:d.androidAssociationPath,publicationStatus:"NOT_PUBLISHED" as const,
    statements:[{relation:["delegate_permission/common.handle_all_urls"],target:{namespace:"android_app",package_name:r.androidPackageId!,sha256_cert_fingerprints:[actual]}}]});
}
