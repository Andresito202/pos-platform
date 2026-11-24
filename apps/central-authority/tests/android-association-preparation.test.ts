import {it,expect} from "vitest";
import {X509Certificate} from "node:crypto";
import {CamachoCommercialDomains as d} from "@pos-platform/contracts";
import {prepareAndroidAssociation} from "../src/android-association-preparation.js";
import {labTls} from "./helpers/lab-https.js";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
it("Android candidate uses actual certificate digest, exact callback, rejects lab package and never publishes",()=>{
  const tls=labTls();try{
    const registration={platform:'ANDROID' as const,clientId:'TEST_ONLY',authorizationOrigin:d.centralOrigin,redirectUri:d.centralOrigin+d.androidCallbackPath,
      androidPackageId:'co.fixture.commercial',androidSigningCertificateSha256:new X509Certificate(tls.cert).fingerprint256};
    const result=prepareAndroidAssociation(registration,tls.cert);expect(result.publicationStatus).toBe('NOT_PUBLISHED');
    expect(result.statements[0]!.target.sha256_cert_fingerprints).toEqual([registration.androidSigningCertificateSha256]);
    expect(()=>prepareAndroidAssociation({...registration,androidSigningCertificateSha256:Array(32).fill('00').join(':')},tls.cert)).toThrow('CERTIFICATE_MISMATCH');
    expect(()=>prepareAndroidAssociation({...registration,androidPackageId:'co.camachopos.android.runtimeprobe'},tls.cert)).toThrow('COMMERCIAL_ASSOCIATION');
    expect(()=>prepareAndroidAssociation({...registration,redirectUri:d.centralOrigin+'/other'},tls.cert)).toThrow();
  }finally{tls.key.fill(0);}
});
it("Android association CLI writes a candidate once, without activating or overwriting",async()=>{
  const tls=labTls(),dir=await mkdtemp(join(tmpdir(),'camacho-association-candidate-'));
  try{
    const certificate=join(dir,'release-fixture.crt'),file=join(dir,'input.json'),out=join(dir,'assetlinks.json');
    await writeFile(certificate,tls.cert);
    await writeFile(file,JSON.stringify({signing_certificate_file:certificate,registration:{platform:'ANDROID',clientId:'TEST_ONLY',authorizationOrigin:d.centralOrigin,
      redirectUri:d.centralOrigin+d.androidCallbackPath,androidPackageId:'co.fixture.commercial',androidSigningCertificateSha256:new X509Certificate(tls.cert).fingerprint256}}));
    const args=['--import','tsx','src/prepare-android-app-links-cli.ts','--provision',file,'--output',out];
    const observed=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8',windowsHide:true}));
    expect(observed.status).toBe('NOT_PUBLISHED');expect(JSON.parse(await readFile(out,'utf8'))[0].target.package_name).toBe('co.fixture.commercial');
    expect(()=>execFileSync(process.execPath,args,{stdio:'pipe',windowsHide:true})).toThrow();
  }finally{tls.key.fill(0);if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('camacho-association-candidate-'))throw Error('CLEANUP_REJECTED');await rm(dir,{recursive:true,force:true});}
});
