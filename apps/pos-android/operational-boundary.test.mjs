import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createRequire} from 'node:module';
import {bundleRuntime} from './bundle-runtime.mjs';
import {assertAndroidOperationalInput,androidOperationalBoundary,verifyAndroidOperationalBundle} from './operational-boundary.mjs';
test('Android forbids commercial administration while preserving physical-sale payment modules',()=>{
  for(const file of ['apps/central-authority/src/subscription-payments.ts','apps/pos-desktop/renderer/src/components/PlatformOfferEditor.tsx','apps/pos-desktop/renderer/src/components/BusinessLicenseOffers.tsx','apps/pos-desktop/renderer/src/platform-client.ts','node_modules/billingclient/index.js'])assert.throws(()=>assertAndroidOperationalInput(file));
  for(const file of ['apps/pos-local-service/src/payments/register-cash-payment-use-case.ts','apps/pos-local-service/src/security/license-verifier.ts','apps/pos-local-service/src/inventory/sqlite-inventory-store.ts'])assert.doesNotThrow(()=>assertAndroidOperationalInput(file));
});
test('real Android bundles exclude GLOBAL, prices, license checkout and Play Billing; forbidden import fails build',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'camacho-android-operational-'));
  try{
    const result=await bundleRuntime(dir);assert.equal(result.profile,'ANDROID_OPERATIONAL_ONLY');
    assert.ok(result.entries['runtime-service'].some(p=>p.includes('android-service-foundation')));
    const written=JSON.parse(await readFile(join(dir,'android-operational-boundary.json'),'utf8'));assert.deepEqual(written,result);
    assert.deepEqual(verifyAndroidOperationalBundle(dir),result);
    const forbidden=join(dir,'PlatformOfferEditor.tsx');await writeFile(forbidden,'export const forbidden=true;');
    const {build}=createRequire(new URL('../pos-local-service/package.json',import.meta.url))('esbuild');
    await assert.rejects(build({entryPoints:[forbidden],bundle:true,write:false,plugins:[androidOperationalBoundary()],logLevel:'silent'}),/ANDROID_OPERATIONAL_MODULE_BOUNDARY/);
    await writeFile(join(dir,'runtime-service.mjs'),'// tampered test fixture');assert.throws(()=>verifyAndroidOperationalBundle(dir),/BUNDLE_CHANGED/);
  }finally{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('camacho-android-operational-'))throw Error('CLEANUP_REJECTED');await rm(dir,{recursive:true,force:true});}
});
test('native license information has no checkout navigation or Play Billing dependency',async()=>{
  const base=new URL('./',import.meta.url);
  const view=await readFile(new URL('src/runtime/kotlin/co/camachopos/android/OperationalLicenseStatusView.kt',base),'utf8');
  assert.doesNotMatch(view.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,''),/\b(?:WebView|Linkify|ACTION_VIEW|startActivity|loadUrl)\b/);
  const manifest=await readFile(new URL('src/runtime/AndroidManifest.xml',base),'utf8'),gradle=await readFile(new URL('build.gradle.kts',base),'utf8');
  assert.doesNotMatch(manifest+gradle,/com\.android\.vending\.BILLING|com\.android\.billingclient/);
});

test('QR-002: laboratory Android manifests must not silently enable SMS capture or networking',async()=>{
  const root=new URL('./',import.meta.url);
  for(const path of ['src/main/AndroidManifest.xml','src/runtime/AndroidManifest.xml']){
    const manifest=await readFile(new URL(path,root),'utf8');
    assert.doesNotMatch(manifest,/<uses-permission\\b[^>]*android:name\\s*=\\s*["']android\\.permission\\.(?:RECEIVE_SMS|READ_SMS|SEND_SMS|INTERNET|BIND_NOTIFICATION_LISTENER_SERVICE)["']/);
    assert.doesNotMatch(manifest,/<receiver\\b|android\\.provider\\.Telephony\\.SMS_RECEIVED|android\\.service\\.notification\\.NotificationListenerService/);
  }
});
