import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LAB_ADMIN_POLICY} from './windows-login-lab-business-context.mjs';
import {choosePublishedLabContext,inspectLabDeviceIdentifiers} from './windows-login-lab-commercial-readiness.mts';

const v4='00000000-0000-4000-8000-000000000001',v7='01900000-0000-7000-8000-000000000001';
const context={userId:v7,factorId:v7,materialId:v7,tenantId:v7,companyId:v7,branchId:v7,membershipId:v7,roleId:v7,assignmentId:v7};
const receipt=(outcome='CREATED')=>({profile:'CAMACHO_LAB_APPROVED_BUSINESS_CONTEXT',outcome,
  policyChecksum:createHash('sha256').update(JSON.stringify(LAB_ADMIN_POLICY)).digest('hex'),context:{...context}});

test('matching local UUID v4 metadata does not become a valid DEV-003 UUID v7',()=>{
  const r=inspectLabDeviceIdentifiers({installation_id:v4,device_id:v4},{binding:{installationId:v4,deviceId:v4},deviceRegistered:true});
  assert.equal(r.historicalReceiptBindingMatches,true);assert.equal(r.deviceUuidVersion,4);assert.equal(r.canonicalDeviceUuidV7,false);
});
test('recognizes v7 identifiers and accepts only consistent public binding metadata',()=>{
  const identity={installation_id:v7,device_id:v7};
  assert.equal(inspectLabDeviceIdentifiers(identity,{binding:{installation_id:v7,device_id:v7}}).canonicalDeviceUuidV7,true);
  assert.equal(inspectLabDeviceIdentifiers(identity,{binding:{installationId:v7,deviceId:v7,device_id:v4}}).historicalReceiptBindingMatches,false);
  assert.equal(inspectLabDeviceIdentifiers(identity,{binding:{installationId:v7,deviceId:v4}}).historicalReceiptBindingMatches,false);
});
test('rejects invalid identifiers without substituting or generating another identity',()=>{
  assert.throws(()=>inspectLabDeviceIdentifiers({installation_id:'client',device_id:v7},{binding:{}}));
  assert.equal(inspectLabDeviceIdentifiers({installation_id:v7,device_id:v7},{}).historicalReceiptBindingMatches,false);
});
test('selects published context consistently and never adopts the rolled-back candidate',()=>{
  const rolledBack={...receipt('VERIFIED_ROLLED_BACK'),context:{...context,companyId:v4}};
  assert.deepEqual(choosePublishedLabContext([rolledBack,receipt(),receipt('UNCHANGED')]),context);
  assert.throws(()=>choosePublishedLabContext([rolledBack]),/LAB_PUBLISHED_CONTEXT_NOT_FOUND/);
});
test('rejects conflicting publication receipts and a mismatched policy checksum',()=>{
  assert.throws(()=>choosePublishedLabContext([receipt(),{...receipt('UNCHANGED'),context:{...context,companyId:v4}}]),/LAB_PUBLISHED_CONTEXT_CONFLICT/);
  assert.throws(()=>choosePublishedLabContext([{...receipt(),policyChecksum:'other'}]),/LAB_PUBLISHED_CONTEXT_RECEIPT_REJECTED/);
  assert.throws(()=>choosePublishedLabContext([{...receipt(),context:{...context,userId:'client'}}]));
});
