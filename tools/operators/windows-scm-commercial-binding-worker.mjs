/** Lab installer worker. Runs ONLY as the real SCM account or interactive
 * owner. Creates separate channel-purpose keys; never changes DeviceIdentity.
 * No arbitrary signing, network access, enrollment or session issuance. */
import {existsSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {commercialManifestPaths} from './windows-scm-manifest-pair.mjs';

export function validateCommercialChannelInput({role,lab,runtime,publication,installationId,deviceId}) {
  if (!['SERVICE','DESKTOP'].includes(role) || !/^C:\\CamachoPosScmLab\\[a-f0-9]{32}$/i.test(lab) ||
      !runtime.startsWith(lab+'\\runtimes\\') || !/^[a-f0-9]{32}$/.test(runtime.slice((lab+'\\runtimes\\').length))) throw Error('BINDING_WORKER_INPUT_REJECTED');
  return commercialManifestPaths(lab,installationId,deviceId,publication);
}
export async function prepareCommercialChannel(input, ports) {
  const {role,lab,runtime,publication,installationId,deviceId}=input;
  const paths=validateCommercialChannelInput(input);
  const id=ports.identity();
  if (role==='SERVICE' ? id.sid!=='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'||!id.service||id.interactive||id.sessionId!==0 : !id.interactive||id.service||id.sessionId<=0) throw Error('BINDING_REAL_IDENTITY_REQUIRED');
  const file=role==='SERVICE'?paths.signerPrivate:paths.receiverPrivate;
  const operation=role==='SERVICE'?(ports.exists(file)?ports.recoverSigner:ports.prepareSigner):(ports.exists(file)?ports.recoverReceiver:ports.prepareReceiver);
  const value=operation(file,installationId,deviceId);
  return {...value,installation_id:installationId,device_id:deviceId,profile:'CAMACHO_LAB_COMMERCIAL_CHANNEL_ENROLLMENT',publication,role,createdAt:new Date().toISOString(),businessSessionIssued:false};
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const [role,lab,runtime,publication,installationId,deviceId,...extra]=process.argv.slice(2);
  if(extra.length)throw Error('BINDING_ARGUMENTS_REJECTED');
  validateCommercialChannelInput({role,lab,runtime,publication,installationId,deviceId});
  // Reject aliases/reparse-backed runtime before importing privileged helpers.
  if(resolve(realpathSync(runtime)).toLowerCase()!==resolve(runtime).toLowerCase())throw Error('BINDING_RUNTIME_REPARSE_REJECTED');
  const source=join(runtime,'payload','packages','local-channel','src');
  const load=name=>import(pathToFileURL(join(source,name)).href);
  const [signer,receiver,native]=await Promise.all([load('windows-service-signer.ts'),load('windows-handoff.ts'),load('windows-handoff-native.ts')]);
  const value=await prepareCommercialChannel({role,lab,runtime,publication,installationId,deviceId},{
    identity:native.currentHandoffIdentity,exists:existsSync,
    prepareSigner:signer.prepareWindowsServiceSigner,recoverSigner:signer.recoverWindowsServiceSignerPublic,
    prepareReceiver:receiver.prepareWindowsHandoffReceiver,recoverReceiver:receiver.recoverWindowsHandoffReceiverPublic,
  });
  const output=join(lab,role==='SERVICE'?'results':'desktop',`commercial-${role.toLowerCase()}-${publication}.json`);
  writeFileSync(output,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  // Public metadata only. Never print the private DPAPI envelope.
  if(!JSON.parse(readFileSync(output,'utf8')).businessSessionIssued)console.log('LAB_CHANNEL_ENROLLMENT=PREPARED_NOT_CERTIFIED');
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
  main().catch(()=>{console.error('LAB_COMMERCIAL_CHANNEL_WORKER_REJECTED');process.exitCode=1;});
}
