import {validateNativeClientRegistration,type NativeClientRegistration} from "@pos-platform/contracts";

/** Candidate build/publication artifacts from real operator-supplied metadata.
 * Does not edit a manifest, publish DAL, approve D3 or certify OS verification. */
export function prepareAndroidNativeRegistrationArtifacts(candidate:NativeClientRegistration){
  const registration=validateNativeClientRegistration(candidate);
  if(registration.platform!=="ANDROID")throw Error("ANDROID_APP_LINK_REGISTRATION_REQUIRED");
  const origin=new URL(registration.authorizationOrigin);
  const assetLinks=JSON.stringify([{relation:["delegate_permission/common.handle_all_urls"],target:{
    namespace:"android_app",package_name:registration.androidPackageId,
    sha256_cert_fingerprints:[registration.androidSigningCertificateSha256],
  }}],null,2)+"\n";
  const intentFilter=`<intent-filter android:autoVerify="true">\n  <action android:name="android.intent.action.VIEW" />\n  <category android:name="android.intent.category.DEFAULT" />\n  <category android:name="android.intent.category.BROWSABLE" />\n  <data android:scheme="https" android:host="${origin.hostname}"${origin.port?` android:port="${origin.port}"`:""} android:path="/android/callback" />\n</intent-filter>\n`;
  return Object.freeze({assetLinksUrl:origin.origin+"/.well-known/assetlinks.json",assetLinks,intentFilter,
    activation:"BLOCKED_PENDING_D3_AND_PHYSICAL_VERIFICATION" as const});
}
