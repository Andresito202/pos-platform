import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LAB_ADMIN_POLICY} from './windows-login-lab-business-context.mjs';
import {choosePublishedLabContext,getLabServiceDeviceBinding,inspectLabDeviceIdentifiers,matchesLabScmDeviceBinding,labScmProvisionFiles,LAB_CURRENT_HUMAN_SCOPE_SQL} from './windows-login-lab-commercial-readiness.mts';

const v4='00000000-0000-4000-8000-000000000001',v7='01900000-0000-7000-8000-000000000001';
const context={userId:v7,factorId:v7,materialId:v7,tenantId:v7,companyId:v7,branchId:v7,membershipId:v7,roleId:v7,assignmentId:v7};
const receipt=(outcome='CREATED')=>({profile:'CAMACHO_LAB_APPROVED_BUSINESS_CONTEXT',outcome,
  policyChecksum:createHash('sha256').update(JSON.stringify(LAB_ADMIN_POLICY)).digest('hex'),context:{...context}});

test('explicit commercial publication selects both versioned manifests without adopting paths from a receipt',()=>{
  const root='C:\\CamachoPosScmLab\\608ba7092afe4a5b93ac14a7df23a046',publication='0123456789abcdef0123456789abcdef';
  const paths=labScmProvisionFiles(root,publication);
  assert.ok(paths.service.endsWith(`commercial-provision-${publication}.json`));
  assert.ok(paths.desktop.endsWith(`commercial-provision-${publication}.json`));
  assert.ok(labScmProvisionFiles(root).service.endsWith('service-provision.json'));
  for(const bad of ['../service-provision.json','',publication+'\\other'])assert.throws(()=>labScmProvisionFiles(root,bad),/PUBLICATION_REJECTED/);
});

test('matching local UUID v4 metadata does not become a valid DEV-003 UUID v7',()=>{
  const r=inspectLabDeviceIdentifiers({installation_id:v4,device_id:v4},{binding:{installationId:v4,deviceId:v4},deviceRegistered:true});
  assert.equal(r.historicalReceiptBindingMatches,true);assert.equal(r.deviceUuidVersion,4);assert.equal(r.canonicalDeviceUuidV7,false);
});
test('recognizes v7 identifiers and accepts only consistent public binding metadata',()=>{
  const identity={installation_id:v7,device_id:v7};
  assert.equal(inspectLabDeviceIdentifiers(identity,{binding:{installation_id:v7,device_id:v7}}).canonicalDeviceUuidV7,true);
  assert.throws(()=>inspectLabDeviceIdentifiers(identity,{binding:{installationId:v7,deviceId:v7,device_id:v4}}),/LAB_SERVICE_DEVICE_BINDING_AMBIGUOUS/);
  assert.equal(inspectLabDeviceIdentifiers(identity,{binding:{installationId:v7,deviceId:v4}}).historicalReceiptBindingMatches,false);
});
test('rejects invalid identifiers without substituting or generating another identity',()=>{
  assert.throws(()=>inspectLabDeviceIdentifiers({installation_id:'client',device_id:v7},{binding:{}}));
  assert.throws(()=>inspectLabDeviceIdentifiers({installation_id:v7,device_id:v7},{}),/LAB_SERVICE_DEVICE_BINDING_REQUIRED/);
});
test('legacy SCM v4 identifiers do not replace an existing Service v7 key binding',()=>{
  const scm={installation_id:v4,device_id:v4};
  const publicDevice={binding:{profile:'CAMACHO_WINDOWS_LOCAL_LAB_ONLY',installation_id:v7,device_id:v7,deviceRegistered:false},businessSessionIssued:false};
  const before=structuredClone({scm,publicDevice});
  assert.deepEqual(getLabServiceDeviceBinding(publicDevice),{installationId:v7,deviceId:v7});
  const report=inspectLabDeviceIdentifiers(scm,publicDevice);
  assert.equal(report.deviceUuidVersion,7);assert.equal(report.canonicalDeviceUuidV7,true);
  assert.equal(report.legacyScmDeviceUuidVersion,4);assert.equal(report.historicalReceiptBindingMatches,false);
  assert.equal(report.lookupSource,'SERVICE_DEVICE_PUBLIC_BINDING_SELECTOR_ONLY');
  assert.deepEqual({scm,publicDevice},before);
});
test('SCM configuration is checked from both loaded manifests, not a legacy lab identity file',()=>{
  const device={installationId:v7,deviceId:v7},actual={installation_id:v7,device_id:v7},legacy={installation_id:v4,device_id:v4};
  assert.equal(matchesLabScmDeviceBinding([actual,actual],device),true);
  assert.equal(matchesLabScmDeviceBinding([legacy,legacy],device),false);
  assert.equal(matchesLabScmDeviceBinding([actual,legacy],device),false);
  assert.equal(matchesLabScmDeviceBinding([],device),false);
  assert.equal(matchesLabScmDeviceBinding([actual],device),false);
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
test('scope SQL references columns declared by canonical migrations; reproduces co.name regression',()=>{
  const sqlRoot=new URL('../target-migrations/sql/postgres/',import.meta.url);
  const ddl=['001_central_foundation.up.sql','010_webauthn_credential_material.up.sql'].map(n=>readFileSync(new URL(n,sqlRoot),'utf8')).join('\n');
  // Deliberately scoped to static qualified references in this SELECT, not a
  // PostgreSQL parser or an execution/RLS certificate.
  function unknownReferences(query:string){
    const aliases=new Map<string,Set<string>>();
    for(const m of query.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)\s+([a-z_]+)\b/g)){
      const table=m[1]!,alias=m[2]!;
      const block=new RegExp('CREATE TABLE '+table.replace('.','\\.')+' \\(([\\s\\S]*?)^\\);','m').exec(ddl);
      assert.ok(block,'Missing canonical table '+table);
      aliases.set(alias,new Set([...block[1]!.matchAll(/^\s+([a-z_][a-z0-9_]*)\s+(?:uuid|text|timestamptz|bigint|integer|int|boolean|bytea|char|varchar|jsonb|smallint|numeric|date)\b/gm)].map(c=>c[1]!)));
    }
    assert.equal(aliases.size,7);
    const refs=[...query.matchAll(/\b([a-z_]+)\.([a-z_][a-z0-9_]*)\b/g)].filter(m=>aliases.has(m[1]!));
    assert.ok(refs.length>20);
    return refs.filter(m=>!aliases.get(m[1]!)!.has(m[2]!)).map(m=>m[0]);
  }
  assert.deepEqual(unknownReferences(LAB_CURRENT_HUMAN_SCOPE_SQL),[]);
  assert.deepEqual(unknownReferences(LAB_CURRENT_HUMAN_SCOPE_SQL.replace('co.trade_name','co.name')),['co.name']);
});
