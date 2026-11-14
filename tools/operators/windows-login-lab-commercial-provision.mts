/** Install an explicit lab provision only after the canonical runtime validates it.
 * No listener, identities, enrollment, sessions, signing or trust rotation here.
 */
import {execFileSync} from "node:child_process";
import {createPrivateKey} from "node:crypto";
import {linkSync,lstatSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from "node:fs";
import {join,resolve,win32} from "node:path";
import {pathToFileURL} from "node:url";
import {CentralCommercialProvisionSchema,uuidV7,validateWindowsCommercialRegistration} from "../../packages/contracts/src/index.js";
import {createPostgresPool} from "../../packages/database-postgres/src/index.js";
import {parseCentralDeploymentConfiguration,verifyCentralTlsIdentity} from "../../apps/central-authority/src/central-deployment-configuration.js";
import {prepareCentralCommercialRuntime} from "../../apps/central-authority/src/central-commercial-runtime.js";

export const LAB_COMMERCIAL_ORIGIN="https://auth.camacho-pos.local:8443";
function fail(code:string):never{throw Error(code);}
export function parseLabCommercialArguments(args:readonly string[]){
  if(args.length!==5||!['--validate','--publish'].includes(args[0]??'')||args[1]!=='--lab-root'||args[3]!=='--candidate')fail('LAB_COMMERCIAL_ARGUMENTS_REQUIRED');
  const root=args[2]!,candidate=args[4]!;
  if(!/^C:\\CamachoPosScmLab\\[a-f0-9]{32}$/.test(root)||win32.normalize(root)!==root)fail('LAB_COMMERCIAL_ROOT_REJECTED');
  const parent=win32.join(root,'central-lab','authority');
  const relative=win32.relative(parent,candidate);
  if(!win32.isAbsolute(candidate)||!relative||relative.startsWith('..')||win32.isAbsolute(relative)||win32.dirname(candidate).toLowerCase()!==parent.toLowerCase())fail('LAB_COMMERCIAL_CANDIDATE_PATH_REJECTED');
  return {root,candidate,publish:args[0]==='--publish'};
}
export function validateLabCommercialCandidate(value:unknown,root:string){
  const p=CentralCommercialProvisionSchema.parse(value);
  if(p.environment!=='PREPRODUCTION'||p.expected_database!=='camacho_windows_login_lab'||p.registration.authorizationOrigin!==LAB_COMMERCIAL_ORIGIN||p.rp_id!=='auth.camacho-pos.local')fail('LAB_COMMERCIAL_SCOPE_REJECTED');
  validateWindowsCommercialRegistration(p.registration,p.rp_id,LAB_COMMERCIAL_ORIGIN);
  const authority=win32.join(root,'central-lab','authority');
  const paths=[p.rejection_verifier_file,p.access.private_key_file,p.access.public_key_file,p.ssa.private_key_file,p.ssa.root_public_key_file,p.ssa.operational_key_file,
    p.sas.private_key_file,p.sas.root_public_key_file,p.sas.trust_bundle_file];
  for(const path of paths){const rel=win32.relative(authority,path);
    if(!win32.isAbsolute(path)||!rel||rel.startsWith('..')||win32.isAbsolute(rel)||win32.dirname(path).toLowerCase()!==authority.toLowerCase())fail('LAB_COMMERCIAL_AUTHORITY_PATH_REJECTED');}
  if(new Set([p.access.private_key_file,p.ssa.private_key_file,p.sas.private_key_file].map(x=>x.toLowerCase())).size!==3)fail('LAB_COMMERCIAL_SEPARATE_KEY_FILES_REQUIRED');
  return p;
}
export function safeLabCommercialError(error:unknown){
  const message=error instanceof Error?error.message:'';
  const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
  if(/^(?:LAB|COMMERCIAL|CENTRAL|SAS|SESSION|NATIVE)_[A-Z0-9_]{1,100}$/.test(message))return message;
  if(['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ENOENT','EACCES','EEXIST'].includes(code))return code;
  if(/^[0-9A-Z]{5}$/.test(code))return 'POSTGRES_'+code;
  return 'CONFIGURATION_OR_RUNTIME_REJECTED';
}
function managed(path:string){
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576||resolve(realpathSync(path)).toLowerCase()!==resolve(path).toLowerCase())fail('LAB_COMMERCIAL_MANAGED_FILE_REJECTED');
  return readFileSync(path);
}
const json=(path:string):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(managed(path)));
/** File-transaction utility, not an authentication/approval API. Production CLI
 * supplies only the canonical validator. A private exclusive snapshot avoids
 * validating one version of an operator-edited candidate and publishing another.
 */
export async function stageLabCommercialSnapshot(directory:string,bytes:Buffer,publish:boolean,validate:(path:string)=>Promise<void>){
  const snapshot=join(directory,'commercial-validation-'+uuidV7()+'.json'),stable=Buffer.from(bytes);
  writeFileSync(snapshot,stable,{flag:'wx',mode:0o600,flush:true});
  try{
    await validate(snapshot);
    if(!managed(snapshot).equals(stable))fail('LAB_COMMERCIAL_VALIDATION_SNAPSHOT_CHANGED');
    if(!publish)return null;
    const output=join(directory,'commercial-provision-'+uuidV7()+'.json');
    // NTFS hard-link creation publishes the complete validated inode atomically
    // and refuses an existing destination. No replace/overwrite fallback.
    linkSync(snapshot,output);
    return output;
  }finally{unlinkSync(snapshot);}
}
export function assertLabCommercialOperator(root:string){
  if(process.platform!=='win32')fail('LAB_COMMERCIAL_WINDOWS_REQUIRED');
  // Read only the current OS identity and authority-directory ACL; never widen it.
  const authority=join(root,'central-lab','authority');
  const previous=process.env.CAMACHO_LAB_AUTHORITY_INSPECTION_PATH;
  try{
    process.env.CAMACHO_LAB_AUTHORITY_INSPECTION_PATH=authority;
    const checked=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      "$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Security.Principal.WindowsPrincipal]::new($i);if($i.IsSystem -or -not $i.IsAuthenticated -or [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0 -or -not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1};$os=Get-CimInstance Win32_OperatingSystem;if($os.ProductType -eq 1 -or $os.BuildNumber -ne '20348'){exit 1};$a=Get-Acl -LiteralPath $env:CAMACHO_LAB_AUTHORITY_INSPECTION_PATH;$ok=@('S-1-5-18','S-1-5-32-544',$i.User.Value);if(-not $a.AreAccessRulesProtected -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $ok){exit 1};foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Value -notin $ok){exit 1}};Write-Output LAB_COMMERCIAL_OPERATOR_AND_CUSTODY_VERIFIED"],
      {encoding:'utf8',windowsHide:true,timeout:15000}).trim();
    if(checked!=='LAB_COMMERCIAL_OPERATOR_AND_CUSTODY_VERIFIED')fail('LAB_COMMERCIAL_OPERATOR_OR_CUSTODY_REJECTED');
  }catch{fail('LAB_COMMERCIAL_OPERATOR_OR_CUSTODY_REJECTED');}
  finally{if(previous===undefined)delete process.env.CAMACHO_LAB_AUTHORITY_INSPECTION_PATH;else process.env.CAMACHO_LAB_AUTHORITY_INSPECTION_PATH=previous;}
}
async function main(){
  const input=parseLabCommercialArguments(process.argv.slice(2));
  assertLabCommercialOperator(input.root);
  const authority=join(input.root,'central-lab','authority');
  // This file is explicit configuration, never evidence of MFA or device possession.
  const candidateBytes=managed(input.candidate);
  validateLabCommercialCandidate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(candidateBytes)),input.root);
  const saved=json(join(authority,'central-runtime-environment.json')) as {profile?:unknown;env?:NodeJS.ProcessEnv};
  if(saved.profile!=='CAMACHO_WINDOWS_LOCAL_LAB_ONLY'||!saved.env||typeof saved.env!=='object'||Array.isArray(saved.env)||Object.values(saved.env).some(x=>typeof x!=='string'))fail('LAB_COMMERCIAL_SAVED_ENVIRONMENT_REJECTED');
  const env=saved.env,configuration=parseCentralDeploymentConfiguration(env);
  if(configuration.environment!=='PREPRODUCTION'||configuration.origin!==LAB_COMMERCIAL_ORIGIN||configuration.port!==8443||configuration.bindAddress!=='127.0.0.1')fail('LAB_COMMERCIAL_EXACT_LOOPBACK_DEPLOYMENT_REQUIRED');
  const db=new URL(env.CENTRAL_DATABASE_URL!);
  if(db.username!=='pos_platform_app'||db.hostname!=='postgres.camacho-pos.local'||db.port!=='55433'||db.pathname!=='/camacho_windows_login_lab'||db.searchParams.get('sslmode')!=='verify-full')fail('LAB_COMMERCIAL_EXACT_DATABASE_REQUIRED');
  const tls={key:managed(env.CENTRAL_TLS_KEY_FILE!),cert:managed(env.CENTRAL_TLS_CERT_FILE!)};
  verifyCentralTlsIdentity(configuration,tls.cert,createPrivateKey(tls.key));
  const previousPgpass=process.env.PGPASSFILE;
  if(env.PGPASSFILE!==undefined){
    if(resolve(env.PGPASSFILE).toLowerCase()!==resolve(join(input.root,'central-lab','pgpass-tls.conf')).toLowerCase())fail('LAB_COMMERCIAL_PGPASS_PATH_REJECTED');
    managed(env.PGPASSFILE); // Existing custody only; no contents or passwords printed.
    process.env.PGPASSFILE=env.PGPASSFILE;
  }
  // The private snapshot is staging only, never a published/activated provision.
  const pool=createPostgresPool(db.href,1,'windows-lab-commercial-provision-validation');
  try{
    const output=await stageLabCommercialSnapshot(authority,candidateBytes,input.publish,async provisionFile=>{
      await prepareCentralCommercialRuntime({pool,provisionFile,origin:configuration.origin,environment:'PREPRODUCTION',tls,
        publishedSsaFile:env.SESSION_TRUST_ARTIFACT_FILE!,publishedSasFile:env.AUTHORIZATION_TRUST_ARTIFACT_FILE!});
    });
    console.log(JSON.stringify({outcome:output?'VALIDATED_AND_PUBLISHED':'CANONICAL_RUNTIME_VALIDATED',provisionFile:output,
      listenerStarted:false,deviceEnrolled:false,businessSessionIssued:false,productionCertified:false}));
  }finally{
    try{await pool.end();}finally{if(previousPgpass===undefined)delete process.env.PGPASSFILE;else process.env.PGPASSFILE=previousPgpass;}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch((error:unknown)=>{console.error('LAB_COMMERCIAL_PROVISION_REJECTED: '+safeLabCommercialError(error));process.exitCode=1;});
}
