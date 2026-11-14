import {test} from 'node:test';
import assert from 'node:assert/strict';
import {win32} from 'node:path';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {lstatSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {LAB_COMMERCIAL_ORIGIN,parseLabCommercialArguments,safeLabCommercialError,stageLabCommercialSnapshot,validateLabCommercialCandidate} from './windows-login-lab-commercial-provision.mts';

const root='C:\\CamachoPosScmLab\\'+'a'.repeat(32),dir=win32.join(root,'central-lab','authority');
function cleanup(directory:string){
  const target=resolve(directory);
  if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('camacho-provision-')||lstatSync(target).isSymbolicLink()||resolve(realpathSync(target))!==target)throw Error('TEST_CLEANUP_TARGET_REJECTED');
  rmSync(target,{recursive:true,force:true});
}
// Metadata-only fixtures. They are not signed credentials or evidence of login.
function fixture(){
  const from='2026-11-04T00:00:00.000Z',until='2026-11-04T01:00:00.000Z';
  const path=(s:string)=>win32.join(dir,s),uuid='00000000-0000-4000-8000-000000000001';
  return {profile:'CAMACHO_CENTRAL_COMMERCIAL_V2',environment:'PREPRODUCTION',expected_database:'camacho_windows_login_lab',schema_checksums:{test:'a'.repeat(64)},policy_reference:'UNIT_TEST_EXPLICIT_NOT_APPROVED',
    registration:{clientId:'unit-test',redirectUri:'http://127.0.0.1:43210/callback',authorizationOrigin:LAB_COMMERCIAL_ORIGIN,platform:'ELECTRON'},rp_id:'auth.camacho-pos.local',
    recipient:{tenant_id:uuid,company_id:uuid,branch_id:uuid,installation_id:uuid,device_id:uuid},factor_id:uuid,membership_id:uuid,rejection_verifier_file:path('rejection'),
    access:{private_key_file:path('access.key'),public_key_file:path('access.pub'),key_id:'UNIT_ACCESS',audience:'UNIT',valid_from:from,valid_until:until},
    ssa:{private_key_file:path('ssa.key'),root_public_key_file:path('ssa-root.pub'),root_spki_sha256:'a'.repeat(64),operational_key_file:path('ssa-operational.json')},
    sas:{private_key_file:path('sas.key'),root_public_key_file:path('sas-root.pub'),root_spki_sha256:'b'.repeat(64),trust_bundle_file:path('sas-bundle.json'),authority_id:'UNIT_AUTHORITY',key_id:'UNIT_SAS'},
    limits:{session_ms:300000,mfa_age_ms:120000,reauthentication_ms:300000,context_age_ms:30000,mfa_challenge_ms:60000,handoff_ms:30000,browser_ms:300000,browser_idle_ms:120000,
      refresh_family_ms:240000,access_ms:60000,proof_skew_ms:30000,rotation_window_ms:60000,maximum_rotations:10,native_challenge_ms:60000,native_request_ms:120000,native_code_ms:60000,
      maximum_challenges_per_minute:10,maximum_login_attempts:5,http_maximum_body_bytes:16384,http_requests_per_minute:30,http_maximum_buckets:100,sas_ms:60000,ssa_claim_age_ms:30000,ssa_offline_ms:60000,sql_lock_timeout_ms:5000}};
}
test('requires an explicit action and an authority-local candidate, not production or traversal',()=>{
  const args=['--validate','--lab-root',root,'--candidate',win32.join(dir,'candidate.json')];
  assert.equal(parseLabCommercialArguments(args).publish,false);
  assert.equal(parseLabCommercialArguments(['--publish',...args.slice(1)]).publish,true);
  for(const bad of [[],['--run',...args.slice(1)],[...args,'--force'],['--validate','--lab-root','C:\\Production','--candidate',args[4]!],
    ['--validate','--lab-root',root,'--candidate',win32.join(root,'service','private','signer.dpapi.json')]])assert.throws(()=>parseLabCommercialArguments(bad));
});
test('rejects the historical key inventory as a commercial provision',()=>{
  assert.throws(()=>validateLabCommercialCandidate({profile:'CAMACHO_WINDOWS_LOCAL_LAB_ONLY',environment:'PREPRODUCTION',origin:LAB_COMMERCIAL_ORIGIN,publicKeys:{}},root));
});
test('complete explicit metadata passes schema/scope only; it does not authenticate',()=>{
  const p=validateLabCommercialCandidate(fixture(),root);assert.equal(p.policy_reference,'UNIT_TEST_EXPLICIT_NOT_APPROVED');
  assert.equal('businessSessionIssued' in p,false);
});
test('never fills missing policy, timing, recipient or native registration values',()=>{
  for(const key of ['policy_reference','limits','recipient','registration']){
    const p:Record<string,unknown>=fixture();delete p[key];assert.throws(()=>validateLabCommercialCandidate(p,root));
  }
  const p=fixture();p.limits.native_code_ms=0;assert.throws(()=>validateLabCommercialCandidate(p,root));
});
test('production, another database, origin drift and an arbitrary callback are rejected',()=>{
  const edits:((p:ReturnType<typeof fixture>)=>void)[]=[p=>{p.environment='PRODUCTION';},p=>{p.expected_database='business';},p=>{p.registration.authorizationOrigin='https://auth.camacho-pos.local:8444';},
    p=>{p.rp_id='other.local';},p=>{p.registration.redirectUri='http://127.0.0.1:43210/callback?next=admin';}];
  for(const edit of edits){
    const p=fixture();edit(p);assert.throws(()=>validateLabCommercialCandidate(p,root));
  }
});
test('cannot read service private custody or alias signing purposes to the same key file',()=>{
  const p=fixture();p.access.private_key_file=win32.join(root,'service','private','device.key');assert.throws(()=>validateLabCommercialCandidate(p,root));
  const q=fixture();q.sas.private_key_file=q.ssa.private_key_file.toUpperCase();assert.throws(()=>validateLabCommercialCandidate(q,root));
});
test('serialized authentication flags and extra fields cannot bypass the canonical schema',()=>{
  assert.throws(()=>validateLabCommercialCandidate({...fixture(),authenticated:true,mfaSatisfied:true,deviceRegistered:true},root));
});
test('diagnostics preserve safe runtime/network codes without leaking a URL or key',()=>{
  assert.equal(safeLabCommercialError(Error('COMMERCIAL_AUTHENTIC_SCOPE_NOT_PROVISIONED')),'COMMERCIAL_AUTHENTIC_SCOPE_NOT_PROVISIONED');
  assert.equal(safeLabCommercialError(Object.assign(Error('postgresql://user:SECRET@host/db'),{code:'ECONNREFUSED'})),'ECONNREFUSED');
  assert.equal(safeLabCommercialError(Error('PRIVATE KEY SECRET')),'CONFIGURATION_OR_RUNTIME_REJECTED');
  assert.equal(safeLabCommercialError(Error('SECRET_TOKEN_VALUE')),'CONFIGURATION_OR_RUNTIME_REJECTED');
  assert.equal(safeLabCommercialError({code:'42501',message:'secret'}),'POSTGRES_42501');
});
test('validation-only uses a stable snapshot and leaves no provision or staging files',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'camacho-provision-stage-'));
  try{
    const bytes=Buffer.from('{"explicit":"metadata"}');let called=0;
    const output=await stageLabCommercialSnapshot(directory,bytes,false,async path=>{
      called++;assert.deepEqual(readFileSync(path),bytes);
    });assert.equal(called,1);assert.equal(output,null);assert.deepEqual(readdirSync(directory),[]);
  }finally{cleanup(directory);}
});
test('only a successfully validated complete snapshot is published; retries never overwrite',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'camacho-provision-publish-'));
  try{
    const bytes=Buffer.from('{"explicit":"metadata"}');
    const first=await stageLabCommercialSnapshot(directory,bytes,true,async path=>{assert.deepEqual(readFileSync(path),bytes);});
    const second=await stageLabCommercialSnapshot(directory,Buffer.from('other metadata'),true,async()=>{});
    assert.notEqual(first,second);assert.deepEqual(readFileSync(first!),bytes);
    assert.equal(readFileSync(second!,'utf8'),'other metadata');assert.equal(readdirSync(directory).length,2);
  }finally{cleanup(directory);}
});
test('validator failure cleans only its staging file and preserves existing artifacts',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'camacho-provision-fail-'));
  try{
    writeFileSync(join(directory,'existing.json'),'existing');
    await assert.rejects(stageLabCommercialSnapshot(directory,Buffer.from('candidate'),true,async()=>{throw Error('DEVICE_NOT_ENROLLED');}),/DEVICE_NOT_ENROLLED/);
    assert.deepEqual(readdirSync(directory),['existing.json']);assert.equal(readFileSync(join(directory,'existing.json'),'utf8'),'existing');
  }finally{cleanup(directory);}
});
test('changing the snapshot during validation cannot publish a different configuration',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'camacho-provision-change-'));
  try{
    await assert.rejects(stageLabCommercialSnapshot(directory,Buffer.from('original'),true,async path=>{writeFileSync(path,'changed');}),/LAB_COMMERCIAL_VALIDATION_SNAPSHOT_CHANGED/);
    assert.deepEqual(readdirSync(directory),[]);
  }finally{cleanup(directory);}
});
