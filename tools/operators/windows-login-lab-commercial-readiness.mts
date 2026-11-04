/** Focused live VM prerequisite check. No enrollment, credentials, DDL or login.
 * Historical receipts select artifacts; they are never authentication evidence.
 */
import {createHash,createPublicKey} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {UuidSchema,UuidV7Schema,uuidV7} from '../../packages/contracts/src/index.js';
import {createPostgresPool,PostgresCommercialDeploymentContext} from '../../packages/database-postgres/src/index.js';
import {inspectCentralLoginPreflight} from '../../apps/central-authority/src/central-login-preflight.js';
import {LAB_ADMIN_POLICY} from './windows-login-lab-business-context.mjs';
import {assertLabCommercialOperator,parseLabCommercialArguments,safeLabCommercialError} from './windows-login-lab-commercial-provision.mjs';

export const LAB_CURRENT_HUMAN_SCOPE_SQL=`SELECT 1 FROM identity.users u
  JOIN identity.user_credentials p ON p.user_id=u.id AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp())
  JOIN identity.mfa_factors f ON f.user_id=u.id AND f.id=$2 AND f.status='ACTIVE' AND f.factor_type='WEBAUTHN' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
  JOIN identity.webauthn_credential_material w ON w.id=$3 AND w.factor_id=f.id AND f.secret_reference='webauthn:v1:'||w.id::text
  JOIN tenancy.tenant_memberships m ON m.id=$4 AND m.user_id=u.id AND m.tenant_id=$5 AND m.status='ACTIVE' AND m.suspended_at IS NULL AND m.revoked_at IS NULL
  JOIN organization.companies co ON co.id=$6 AND co.tenant_id=m.tenant_id AND co.status='ACTIVE' AND co.trade_name=$8
  JOIN organization.branches b ON b.id=$7 AND b.company_id=co.id AND b.tenant_id=m.tenant_id AND b.status='ACTIVE' AND b.name=$9
  WHERE u.id=$1 AND u.status='ACTIVE'`;

function fail(code:string):never{throw Error(code);}
export function inspectLabDeviceIdentifiers(identity:unknown,receipt:unknown){
  const a=identity as Record<string,unknown>|null,r=receipt as {binding?:Record<string,unknown>}|null;
  const installation=UuidSchema.parse(a?.installation_id),device=UuidSchema.parse(a?.device_id);
  const binding=r?.binding;
  const same=(camel:string,snake:string,expected:string)=>Boolean(binding&&
    (binding[camel]!==undefined||binding[snake]!==undefined)&&
    [binding[camel],binding[snake]].filter(x=>x!==undefined).every(x=>x===expected));
  return {installationUuidVersion:Number(installation[14]),deviceUuidVersion:Number(device[14]),
    canonicalDeviceUuidV7:UuidV7Schema.safeParse(device).success,
    historicalReceiptBindingMatches:same('installationId','installation_id',installation)&&same('deviceId','device_id',device)};
}
export function choosePublishedLabContext(receipts:readonly unknown[]){
  const checksum=createHash('sha256').update(JSON.stringify(LAB_ADMIN_POLICY)).digest('hex');
  const contexts=receipts.flatMap(value=>{
    const r=value as {profile?:unknown;outcome?:unknown;policyChecksum?:unknown;context?:Record<string,unknown>}|null;
    if(!r||!['CREATED','UNCHANGED'].includes(String(r.outcome)))return [];
    if(r.profile!=='CAMACHO_LAB_APPROVED_BUSINESS_CONTEXT'||r.policyChecksum!==checksum||!r.context)fail('LAB_PUBLISHED_CONTEXT_RECEIPT_REJECTED');
    for(const name of ['userId','factorId','materialId','tenantId','companyId','branchId','membershipId','roleId','assignmentId'])UuidSchema.parse(r.context[name]);
    return [r.context as Record<string,string>];
  });
  if(!contexts.length)fail('LAB_PUBLISHED_CONTEXT_NOT_FOUND');
  const first=contexts[0]!;
  if(contexts.some(c=>Object.keys(first).some(k=>c[k]!==first[k])))fail('LAB_PUBLISHED_CONTEXT_CONFLICT');
  return first;
}
function managed(file:string){
  const s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size>1048576||resolve(realpathSync(file)).toLowerCase()!==resolve(file).toLowerCase())fail('LAB_READINESS_MANAGED_FILE_REJECTED');
  return readFileSync(file);
}
const json=(file:string):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(managed(file)));
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=='--inspect'||args[1]!=='--lab-root')fail('LAB_READINESS_EXPLICIT_ARGUMENTS_REQUIRED');
  const root=args[2]!,directory=join(root,'central-lab'),authority=join(directory,'authority');
  parseLabCommercialArguments(['--validate','--lab-root',root,'--candidate',join(authority,'candidate.json')]);
  assertLabCommercialOperator(root);
  const identity=json(join(root,'scm-lab-identity.json')) as Record<string,string>;
  const device=json(join(root,'results','service-device-public.json')) as Record<string,unknown>;
  const identifiers=inspectLabDeviceIdentifiers(identity,device);
  const receipts=readdirSync(directory).filter(n=>/^business-context-[a-f0-9-]{36}\.json$/.test(n)).map(n=>json(join(directory,n)));
  const context=choosePublishedLabContext(receipts);
  const saved=json(join(authority,'central-runtime-environment.json')) as {env?:NodeJS.ProcessEnv};
  const env=saved?.env;
  if(!env||typeof env!=='object'||Array.isArray(env)||Object.values(env).some(v=>typeof v!=='string')||env.CENTRAL_DEPLOYMENT_ENVIRONMENT!=='PREPRODUCTION')fail('LAB_READINESS_ENVIRONMENT_REJECTED');
  const url=new URL(env.CENTRAL_DATABASE_URL!);
  if(url.username!=='pos_platform_app'||url.hostname!=='postgres.camacho-pos.local'||url.port!=='55433'||url.pathname!=='/camacho_windows_login_lab'||url.searchParams.get('sslmode')!=='verify-full')fail('LAB_READINESS_DATABASE_REJECTED');
  const previous=process.env.PGPASSFILE;
  // Reuse the existing PostgreSQL role credentials. No credentials are
  // generated, printed or passed as command arguments.
  const pgpass=join(directory,'pgpass-tls.conf');managed(pgpass);process.env.PGPASSFILE=pgpass;
  const pool=createPostgresPool(url.href,1,'windows-lab-commercial-live-readiness');
  pool.options.connectionTimeoutMillis=5000;
  try{
    await PostgresCommercialDeploymentContext.verify(pool,{expectedDatabase:'camacho_windows_login_lab',checksums:json(join(directory,'authentication-manifest.json')) as Record<string,string>});
    const c=await pool.connect();
    let boundHuman=false,scopeRegistered=false,keyMatches=false,activeCredentials=0,status:string|null=null,constraintV7=false;
    try{
      await c.query('BEGIN READ ONLY');
      if((await c.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl!==true)fail('LAB_READINESS_DATABASE_TLS_REQUIRED');
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[context.tenantId]);
      const human=await c.query(LAB_CURRENT_HUMAN_SCOPE_SQL,[context.userId,context.factorId,context.materialId,context.membershipId,context.tenantId,context.companyId,context.branchId,LAB_ADMIN_POLICY.company,LAB_ADMIN_POLICY.branch]);
      boundHuman=human.rows.length===1;
      const registry=(await c.query('SELECT installation_id::text,tenant_id::text,company_id::text,device_key_id,device_public_key,status FROM identity.device_registry WHERE device_id=$1',[identity.device_id])).rows[0];
      if(registry){
        status=registry.status;
        scopeRegistered=registry.installation_id===identity.installation_id&&registry.tenant_id===context.tenantId&&registry.company_id===context.companyId;
        keyMatches=createPublicKey(Buffer.from(registry.device_public_key)).export({format:'der',type:'spki'}).equals(createPublicKey(String(device.publicKeyPem)).export({format:'der',type:'spki'}))&&registry.device_key_id===device.deviceKeyId;
      }
      activeCredentials=Number((await c.query("SELECT count(*)::int AS n FROM identity.device_credentials WHERE device_id=$1 AND status='ACTIVE' AND revoked_at IS NULL AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp()",[identity.device_id])).rows[0]?.n??0);
      const constraints=(await c.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='identity.device_registry'::regclass AND conname='device_registry_id_v7_ck'")).rows;
      constraintV7=constraints.length===1&&/is_uuid_v7/.test(constraints[0].definition);
    }finally{try{await c.query('ROLLBACK');}finally{c.release();}}
    const preflight=inspectCentralLoginPreflight(env);
    const blockers:string[]=[];
    if(!preflight.configurationValid||!preflight.tlsIdentityMatched||!preflight.environmentAllowed)blockers.push('CENTRAL_DEPLOYMENT_OR_TLS_NOT_VALIDATED');
    if(!boundHuman)blockers.push('ACTIVE_BUSINESS_HUMAN_CONTEXT_NOT_REVALIDATED');
    if(!identifiers.historicalReceiptBindingMatches)blockers.push('SCM_PUBLIC_RECEIPT_BINDING_MISMATCH');
    if(constraintV7&&!identifiers.canonicalDeviceUuidV7)blockers.push('SCM_DEVICE_UUID_VERSION_INCOMPATIBLE_WITH_DEV003');
    if(!constraintV7)blockers.push('DEVICE_SCHEMA_UUID_CONSTRAINT_NOT_VERIFIED');
    if(status===null)blockers.push('DEVICE_REGISTRY_ABSENT');
    else if(status!=='ACTIVE'||!scopeRegistered||!keyMatches||activeCredentials===0)blockers.push('DEVICE_ENROLLMENT_NOT_READY');
    if(preflight.missingFiles.includes('CENTRAL_COMMERCIAL_PROVISION_FILE'))blockers.push('BUSINESS_PROVISION_NOT_CONFIGURED');
    const report={profile:'CAMACHO_LAB_COMMERCIAL_LIVE_READINESS_V1',identifiers,canonicalDeploymentVerified:true,
      humanContextRevalidated:boundHuman,deviceRegistry:{status,scopeMatches:scopeRegistered,keyMatches,activeCredentials,canonicalUuidV7Constraint:constraintV7},
      historicalDpapiReceipt:{protection:device.protection==='OS_BOUND'?'OS_BOUND':'UNVERIFIED',sameIdentityRecovery:device.dpapiSameIdentityRecovery===true},
      missingBusinessFiles:preflight.missingFiles.filter(n=>n!=='CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE'),
      globalProvisionPresent:!preflight.missingFiles.includes('CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE'),blockers,
      status:blockers.length?'BLOCKED':'PREREQUISITES_PRESENT_UNCERTIFIED',windowsRuntimeVerified:false,
      freshDevicePossessionVerified:false,businessSessionIssued:false,humanLoginCertified:false,productionCertified:false};
    const file=join(root,'results','commercial-live-readiness-'+uuidV7()+'.json');
    writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({...report,evidenceFile:file},null,2));
  }finally{try{await pool.end();}finally{if(previous===undefined)delete process.env.PGPASSFILE;else process.env.PGPASSFILE=previous;}}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch((error:unknown)=>{console.error('LAB_COMMERCIAL_LIVE_READINESS_FAILED: '+safeLabCommercialError(error));process.exitCode=1;});
}
