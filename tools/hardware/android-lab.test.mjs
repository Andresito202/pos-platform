import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync,sign,verify } from "node:crypto";
import { digest,readVerifiedReport,issueJob } from "./android-lab.mjs";
const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),now=1800000000000;
const der=pair.publicKey.export({format:"der",type:"spki"});
const policy={version:"1.0.0",purpose:"HARDWARE_PHYSICAL_LAB",not_before_ms:now-1000,expires_at_ms:now+3600000,max_job_seconds:300,public_key_spki:der.toString("base64")};
const report={version:"1.0.0",purpose:"HARDWARE_PHYSICAL_LAB_REPORT",sdk:28,installation:"test-installation",key_fingerprint:digest(der),report_nonce:"test-nonce",observed_at_ms:now,
  app_authority_sha256:digest(der),devices:[{usb_name:"test-usb",vendor:123,product:456,permission:true,descriptor_sha256:"a".repeat(64),endpoints:[{interface_index:0,address:1,bulk_out:true}]}]};
const profile={printer_model:"GP-L80160",printer_firmware:"TEST_ONLY",protocol:"ESC_POS",identity_evidence:"TEST ONLY LABEL",command_evidence:"TEST ONLY MANUAL",timeout_ms:1000,drawer:null};
const options={policy,privateKey:pair.privateKey,report,usbName:"test-usb",interfaceIndex:0,endpoint:1,profile,kind:"PRINT_TEST",reason:"TEST ONLY",seconds:60,now};
test("signs a device-bound one-use print intent without raw commands",()=>{
  const envelope=issueJob(options),body=Buffer.from(envelope.body_base64,"base64");
  assert.ok(verify("sha256",body,pair.publicKey,Buffer.from(envelope.signature_base64,"base64")));
  const parsed=JSON.parse(body);assert.equal(parsed.profile.drawer,null);assert.equal(parsed.binding.report_nonce,report.report_nonce);assert.equal(parsed.expires_at_ms,now+60000);
  assert.notEqual(issueJob(options).body_base64,envelope.body_base64);
});
test("requires physical fingerprint and verifies signed device reports",()=>{
  const body=Buffer.from(JSON.stringify(report));const envelope={body_base64:body.toString("base64"),signature_base64:sign("sha256",body,pair.privateKey).toString("base64"),device_public_key_spki:der.toString("base64")};
  assert.equal(readVerifiedReport(envelope,digest(der)).installation,report.installation);
  assert.throws(()=>readVerifiedReport(envelope,"b".repeat(64)));
  assert.throws(()=>readVerifiedReport({...envelope,body_base64:Buffer.from("{}").toString("base64")},digest(der)));
});
test("rejects stale reports, missing permission and wrong endpoints",()=>{
  assert.throws(()=>issueJob({...options,now:now+400000}));
  assert.throws(()=>issueJob({...options,report:{...report,devices:[{...report.devices[0],permission:false}]}}));
  assert.throws(()=>issueJob({...options,endpoint:2}));
});
test("rejects wrong APK authority, expiration and missing explicit durations",()=>{
  assert.throws(()=>issueJob({...options,report:{...report,app_authority_sha256:"bad"}}));
  assert.throws(()=>issueJob({...options,seconds:undefined}));
  assert.throws(()=>issueJob({...options,policy:{...policy,expires_at_ms:now}}));
});
test("cannot invent missing firmware or electrical parameters",()=>{
  assert.throws(()=>issueJob({...options,profile:{...profile,printer_firmware:"unknown"}}));
  assert.throws(()=>issueJob({...options,kind:"DRAWER_OPEN"}));
  assert.throws(()=>issueJob({...options,kind:"DRAWER_OPEN",profile:{...profile,drawer:{model:"CD350",pin:0}}}));
});
