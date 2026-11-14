import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommercialChannel,validateCommercialChannelInput} from './windows-scm-commercial-binding-worker.mjs';
import {commercialManifestPaths} from './windows-scm-manifest-pair.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const lab='C:\\CamachoPosScmLab\\608ba7092afe4a5b93ac14a7df23a046';
const input={role:'SERVICE',lab,runtime:lab+'\\runtimes\\09bf705703664e1ab2706d732ec45110',publication:'0123456789abcdef0123456789abcdef',installationId:'01a1a2f7-856e-7ade-8b72-5a91ce35a8c7',deviceId:'01a1a2f7-856e-7a38-bb4c-20394a27411d'};
const service={sid:'S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569',service:true,interactive:false,sessionId:0};
function ports(existing=false,id=service){
 const calls=[];const op=name=>(...args)=>{calls.push({name,args});return {public_key_pem:'UNIT_PORT_NOT_REAL_KEY'};};
 return {calls,identity:()=>id,exists:()=>existing,prepareSigner:op('prepareSigner'),recoverSigner:op('recoverSigner'),prepareReceiver:op('prepareReceiver'),recoverReceiver:op('recoverReceiver')};
}
test('existing v7 service channel key is recovered without rotation or DeviceIdentity creation',async()=>{
 const p=ports(true);const result=await prepareCommercialChannel(input,p);
 assert.deepEqual(p.calls.map(c=>c.name),['recoverSigner']);
 assert.ok(p.calls[0].args[0].endsWith('signer-commercial-'+input.deviceId+'.dpapi.json'));
 assert.equal(result.businessSessionIssued,false);assert.equal(result.installation_id,input.installationId);
});
test('new channel key uses a distinct private path, preserving the original harness',async()=>{
 const p=ports();await prepareCommercialChannel(input,p);
 assert.equal(p.calls[0].name,'prepareSigner');assert.ok(!p.calls[0].args[0].endsWith('\\signer.dpapi.json'));
 const paths=commercialManifestPaths(lab,input.installationId,input.deviceId,input.publication);
 assert.ok(!paths.serviceOutput.endsWith('\\service-provision.json'));assert.ok(!paths.capsule.endsWith('\\capsule.json'));
});
test('desktop requires an actual interactive identity and recovers its own receiver',async()=>{
 const p=ports(true,{sid:'S-1-5-21-1-2-3-1001',interactive:true,service:false,sessionId:1});
 await prepareCommercialChannel({...input,role:'DESKTOP'},p);assert.equal(p.calls[0].name,'recoverReceiver');
});
test('wrong service SID, desktop impersonation and session zero are denied before custody',async()=>{
 for(const [role,id] of [['SERVICE',{...service,sid:'S-1-5-18'}],['SERVICE',{...service,interactive:true}],['SERVICE',{...service,sessionId:1}],['DESKTOP',service],['DESKTOP',{interactive:true,service:false,sessionId:0}]]){
  const p=ports(false,id);await assert.rejects(prepareCommercialChannel({...input,role},p),/REAL_IDENTITY_REQUIRED/);assert.equal(p.calls.length,0);
 }
});
test('legacy identifiers, arbitrary runtime paths, traversal and operation names are denied',()=>{
 for(const patch of [{installationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{role:'SIGN'},{runtime:'C:\\arbitrary'},{runtime:lab+'\\runtimes\\..\\outside'},{lab:'C:\\production'},{publication:'../manifest'}]){
  assert.throws(()=>validateCommercialChannelInput({...input,...patch}));
 }
});
test('custody failure is propagated without fallback generation',async()=>{
 const p=ports(true);p.recoverSigner=()=>{throw Error('DPAPI_DENIED');};
 await assert.rejects(prepareCommercialChannel(input,p),/DPAPI_DENIED/);assert.equal(p.calls.length,0);
});
test('real CLI rejects an arbitrary runtime before loading custody or exposing diagnostics',()=>{
 const worker=fileURLToPath(new URL('./windows-scm-commercial-binding-worker.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[worker,'SERVICE','C:\\production','C:\\untrusted','invalid'],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/^LAB_COMMERCIAL_CHANNEL_WORKER_REJECTED\r?\n$/);
});
