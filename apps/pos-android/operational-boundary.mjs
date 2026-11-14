/** Platform composition boundary. This does not grant business permissions;
 * signed SSA/SAS and existing use cases remain the authorization authority. */
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function assertAndroidOperationalInput(input){
  const path=input.replaceAll('\\','/');
  if(/(?:^|\/)apps\/central-authority\//.test(path)||
    /(?:^|\/)(?:PlatformOfferEditor|AdministrativeControlPanel|PublicLicenseOffers|BusinessLicenseOffers|platform-client|public-license-client|platform-entry|pricing-entry)\.[cm]?[jt]sx?$/.test(path)||
    /(?:^|\/)(?:billingclient|play-billing|react-native-iap)(?:\/|$)/i.test(path))
    throw Error('ANDROID_OPERATIONAL_MODULE_BOUNDARY: '+path);
}
export function androidOperationalBoundary(){return {name:'camacho-android-operational-only',setup(build){
  build.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{assertAndroidOperationalInput(args.path);return undefined;});
}};}
export function verifyAndroidOperationalBundle(root){
  const path=join(root,'android-operational-boundary.json'),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('ANDROID_OPERATIONAL_EVIDENCE_REQUIRED');
  const report=JSON.parse(readFileSync(path,'utf8'));
  if(report.profile!=='ANDROID_OPERATIONAL_ONLY')throw Error('ANDROID_OPERATIONAL_PROFILE_REQUIRED');
  for(const entry of ['runtime-probe','runtime-service']){
    if(!Array.isArray(report.entries?.[entry])||report.entries[entry].length>10000)throw Error('ANDROID_OPERATIONAL_INPUTS_REQUIRED');
    report.entries[entry].forEach(assertAndroidOperationalInput);
    const file=join(root,entry+'.mjs'),s=lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||createHash('sha256').update(readFileSync(file)).digest('hex')!==report.sha256?.[entry])throw Error('ANDROID_OPERATIONAL_BUNDLE_CHANGED');
  }
  return report;
}
