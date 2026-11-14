// Isolated SCM test runtime. Built-ins only; never installs into the source checkout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569';
export function must(ok,code){if(!ok)throw Error(code);}
export function inside(root,value){
 const rel=path.relative(path.resolve(root),path.resolve(value));
 return rel!==''&&!rel.split(path.sep).includes('..')&&!path.isAbsolute(rel);
}
export function digest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
export function noLinks(value){
 let cursor=path.resolve(value);
 while(true){
  must(!fs.lstatSync(cursor).isSymbolicLink(),'RUNTIME_ANCESTOR_REPARSE');
  const next=path.dirname(cursor);if(next===cursor)break;cursor=next;
 }
}
export function writeNew(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});}
export function event(attempt,state,detail={}){
 const dir=path.join(attempt,'journal');fs.mkdirSync(dir,{recursive:true});
 const number=fs.readdirSync(dir).length+1;
 writeNew(path.join(dir,String(number).padStart(6,'0')+'-'+state+'.json'),
  {schema:1,state,time:new Date().toISOString(),...detail});
}
export function inventory(root){
 noLinks(root);
 const rows=[];
 function walk(dir){
  for(const name of fs.readdirSync(dir).sort()){
   const file=path.join(dir,name),stat=fs.lstatSync(file);
   const relative=path.relative(root,file).split(path.sep).join('/');
   if(stat.isSymbolicLink()){
    const target=fs.realpathSync.native(file);
    must(inside(root,target),'RUNTIME_EXTERNAL_OR_DANGLING_LINK');
    // The lexical target must also stay inside; reject an external hop back in.
    const lexical=path.resolve(path.dirname(file),fs.readlinkSync(file));
    must(inside(root,lexical),'RUNTIME_EXTERNAL_LINK_HOP');
    noLinks(target);
    rows.push({path:relative,type:'link',target:path.relative(root,target).split(path.sep).join('/'),linkText:path.relative(root,lexical).split(path.sep).join('/')});
   }else if(stat.isDirectory()){
    rows.push({path:relative,type:'directory'});walk(file);
   }else{
    must(stat.isFile()&&stat.nlink===1,'RUNTIME_SPECIAL_OR_SHARED_FILE');
    rows.push({path:relative,type:'file',size:stat.size,sha256:digest(file)});
   }
  }
 }
 walk(root);return rows;
}
export function assertAclPathLengths(root,files){
 must(files.every(file=>path.join(root,file.path).length<250),'RUNTIME_PATH_TOO_LONG_FOR_PS51');
}
export function verifyTree(root,expected){
 const actual=inventory(root);
 must(JSON.stringify(actual)===JSON.stringify(expected),'RUNTIME_MANIFEST_MISMATCH');
 return actual;
}
export function command(exe,args,cwd,log,env=process.env){
 const result=spawnSync(exe,args,{cwd,env,encoding:'utf8',windowsHide:true,
  shell:false,timeout:600_000,maxBuffer:32*1024*1024});
 if(log)fs.writeFileSync(log,(result.stdout||'')+'\n'+(result.stderr||''),{flag:'wx'});
 must(!result.error&&result.status===0,'RUNTIME_COMMAND_FAILED:'+path.basename(log||exe));
 return (result.stdout||'').trim();
}
export function sterileEnvironment(attempt,role='operator'){
 const env={...process.env};
 for(const key of Object.keys(env)){
  if(/^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|CAMACHO_SCM_|POS_|npm_config_|PNPM_)/i.test(key))delete env[key];
 }
 const work=path.join(attempt,'work',role);
 return {...env,TEMP:work,TMP:work,TMPDIR:work,CI:'true',
  COREPACK_HOME:path.join(attempt,'downloads','corepack'),
  ELECTRON_CACHE:path.join(attempt,'downloads','electron')};
}
function packageAt(importer,name){
 let dir=importer;
 while(true){
  const candidate=path.join(dir,'node_modules',name,'package.json');
  if(fs.existsSync(candidate))return fs.realpathSync.native(path.dirname(candidate));
  const up=path.dirname(dir);if(up===dir)return null;dir=up;
 }
}
export function dependencyGraph(payload){
 // Inventory whole packages, including dynamic chunks, workers, JSON and WASM.
 const store=path.join(payload,'node_modules','.pnpm'),packages=[],edges=[],roots=[];
 for(const virtual of fs.readdirSync(store,{withFileTypes:true})){
  if(!virtual.isDirectory()||virtual.name==='node_modules')continue;
  const nm=path.join(store,virtual.name,'node_modules');
  if(!fs.existsSync(nm))continue;
  for(const entry of fs.readdirSync(nm,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const candidates=entry.name.startsWith('@')?fs.readdirSync(path.join(nm,entry.name))
    .map(name=>path.join(nm,entry.name,name)):[path.join(nm,entry.name)];
   for(const root of candidates){
    if(!fs.lstatSync(root).isSymbolicLink()&&fs.existsSync(path.join(root,'package.json')))roots.push([root,false]);
   }
  }
 }
 // Audit workspace resolution too: an absent local dependency must not fall
 // back to node_modules of a parent directory outside the snapshot.
 const workspaces=new Map();
 for(const parent of ['apps','packages']){
  const base=path.join(payload,parent);if(!fs.existsSync(base))continue;
  for(const name of fs.readdirSync(base)){
   const root=path.join(base,name),file=path.join(root,'package.json');
   if(fs.existsSync(file)){
    const p=JSON.parse(fs.readFileSync(file,'utf8'));workspaces.set(p.name,{root,manifest:p});
   }
  }
 }
 const queue=['@pos-platform/pos-local-service','@pos-platform/pos-desktop'],seen=new Set();
 while(queue.length){
  const name=queue.pop(),workspace=workspaces.get(name);if(!workspace||seen.has(name))continue;
  seen.add(name);roots.push([workspace.root,true]);
  for(const section of ['dependencies','devDependencies','optionalDependencies']){
   for(const [dependency,range]of Object.entries(workspace.manifest[section]||{})){
    if(range.startsWith('workspace:')){
     must(workspaces.has(dependency),'RUNTIME_WORKSPACE_MISSING:'+dependency);queue.push(dependency);
    }
   }
  }
 }
 for(const [root,workspace]of roots){
  const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  packages.push({name:p.name,version:p.version,workspace,path:path.relative(payload,root),
   os:p.os,cpu:p.cpu,engines:p.engines,exports:p.exports,scripts:p.scripts});
  const sections=['dependencies','optionalDependencies','peerDependencies',...(workspace?['devDependencies']:[])];
  for(const section of sections){
   for(const name of Object.keys(p[section]||{})){
    const target=packageAt(root,name);
    const optional=section==='optionalDependencies'||(section==='peerDependencies'&&p.peerDependenciesMeta?.[name]?.optional===true);
    must(target||optional,'RUNTIME_REQUIRED_DEPENDENCY_MISSING:'+p.name+':'+name);
    if(target)must(inside(payload,target),'RUNTIME_DEPENDENCY_OUTSIDE_PAYLOAD');
    edges.push({from:p.name,section,name,optional,target:target?path.relative(payload,target):null});
   }
  }
 }
 return {packages,edges,nativeFiles:inventory(payload).filter(f=>f.type==='file'&&/\.(node|exe|dll|wasm)$/i.test(f.path))};
}
export function planSource(repo){
 noLinks(repo);
 const git=(...args)=>command('git',['-C',repo,...args],repo);
 must(git('branch','--show-current')==='feat/p0-windows-login-install-readiness','RUNTIME_WRONG_BRANCH');
 must(git('status','--porcelain')==='','RUNTIME_DIRTY_CHECKOUT');
 const commit=git('rev-parse','HEAD');
 const modes=git('ls-tree','-r',commit);
 must(!/^120000 /m.test(modes),'RUNTIME_TRACKED_SYMLINK_REJECTED');
 const manifest=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
 must(process.arch==='x64','RUNTIME_NODE_X64_REQUIRED');
 must(manifest.packageManager==='pnpm@9.15.0','RUNTIME_PNPM_VERSION_UNREVIEWED');
 const locked=spawnSync('git',['-C',repo,'show',commit+':pnpm-lock.yaml'],{shell:false,windowsHide:true});
 must(locked.status===0&&!locked.error,'RUNTIME_LOCK_BLOB_MISSING');
 return {commit,lockSha256:crypto.createHash('sha256').update(locked.stdout).digest('hex'),
  node:process.version,arch:process.arch,platform:process.platform,packageManager:manifest.packageManager};
}
export function installationSteps(payload,attempt,pnpm){
 const store=path.join(attempt,'store');
 return [
  [process.execPath,[pnpm,'--version']],
  [process.execPath,[pnpm,'install','--frozen-lockfile','--ignore-scripts',
   '--filter','@pos-platform/pos-local-service...','--filter','@pos-platform/pos-desktop...',
   '--store-dir',store,'--package-import-method=copy','--config.side-effects-cache=false',
   '--config.virtual-store-dir-max-length=32']]
 ];
}
function fileInPackage(payload,importer,name,relative){
 const root=packageAt(path.join(payload,importer),name);
 must(root&&inside(payload,root),'RUNTIME_PACKAGE_MISSING:'+name);
 const file=path.join(root,relative);
 must(fs.existsSync(file),'RUNTIME_PACKAGE_FILE_MISSING:'+name+':'+relative);
 return file;
}
export function smoke(attempt,runtime='NODE',probe=false){
 must(['NODE','ELECTRON'].includes(runtime),'RUNTIME_SMOKE_RUNTIME_REJECTED');
 const payload=path.join(attempt,'payload'),env=sterileEnvironment(attempt,probe?'service':'operator');
 const work=path.join(attempt,'work',probe?'service':'operator');
 const node=path.join(payload,'.scm-runtime','node.exe');
 const vitest=fileInPackage(payload,'apps/pos-local-service','vitest','vitest.mjs');
 const executable=runtime==='NODE'?node:fileInPackage(payload,'apps/pos-desktop','electron','dist/electron.exe');
 if(runtime==='ELECTRON')env.ELECTRON_RUN_AS_NODE='1';
 const id=crypto.randomUUID(),log=path.join(work,'smoke-'+id+'.log');
 // No SCM, DPAPI, enrollment or valid native listen/connect operations here.
 const nativeCode=[
  "const {createRequire}=require('node:module');const req=createRequire(process.argv[1]);",
  runtime==='NODE'?"const DB=req('better-sqlite3');const db=new DB(':memory:');db.close();":"",
  "const pipe=req(process.argv[2]);for(const key of ['listen','accept','connect','adopt','release','recheck','stop'])if(typeof pipe[key]!=='function')throw Error('NATIVE_API_MISSING');"
 ].join('');
 command(executable,['-e',nativeCode,path.join(payload,'apps/pos-local-service/package.json'),
  path.join(payload,'.scm-runtime/camacho_windows_pipe.node')],payload,log,env);
 const report=path.join(work,'smoke-'+id+'.json');
 command(executable,[vitest,'run','--root',path.join(payload,'apps/pos-local-service'),
  '--config',path.join(payload,'.scm-runtime',probe?'vitest.config.mjs':'vitest-operator.config.mjs'),'--configLoader','native',
  'tests/windows-scm-physical.test.ts','tests/windows-scm-enrollment.operator.test.ts',
  '--no-file-parallelism','--reporter=json','--outputFile='+report],
 payload,path.join(work,'vitest-'+id+'.log'),env);
 const data=JSON.parse(fs.readFileSync(report,'utf8'));
 must(data.numTotalTests===2&&data.numPendingTests===2&&data.numFailedTests===0&&data.numPassedTests===0,
  'RUNTIME_SMOKE_MUST_SKIP_PHYSICAL_AND_ENROLLMENT');
 return {runtime,probe,status:'DEPENDENCY_LOAD_ONLY',report};
}
export function stage(repo,attempt,pnpm,addon,addonHash){
 must(path.relative(repo,attempt)!==''&&!inside(repo,attempt)&&!inside(attempt,repo),'RUNTIME_ATTEMPT_OVERLAPS_SOURCE');
 noLinks(attempt);
 const source=planSource(repo),payload=path.join(attempt,'payload');
 const env=sterileEnvironment(attempt);
 must(digest(addon)===addonHash.toLowerCase(),'RUNTIME_ADDON_HASH_MISMATCH');
 noLinks(addon);
 fs.mkdirSync(payload);
 fs.mkdirSync(path.join(attempt,'work','operator'),{recursive:true});
 fs.mkdirSync(path.join(attempt,'work','service'));
 event(attempt,'SNAPSHOT',source);
 const archive=path.join(attempt,'source.tar');
 const packed=spawnSync('git',['-C',repo,'-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=tar',source.commit],
  {shell:false,windowsHide:true,maxBuffer:128*1024*1024});
 must(packed.status===0&&!packed.error,'RUNTIME_ARCHIVE_FAILED');
 fs.writeFileSync(archive,packed.stdout,{flag:'wx'});
 command('tar',['-xf',archive,'-C',payload],attempt,path.join(attempt,'extract.log'),env);
 must(digest(path.join(payload,'pnpm-lock.yaml'))===source.lockSha256,'RUNTIME_LOCK_CHANGED');
 const steps=installationSteps(payload,attempt,pnpm);
 must(command(steps[0][0],steps[0][1],payload,path.join(attempt,'pnpm-version.log'),env)==='9.15.0','RUNTIME_PNPM_MISMATCH');
 event(attempt,'INSTALLING');
 command(steps[1][0],steps[1][1],payload,path.join(attempt,'install.log'),env);
 must(digest(path.join(payload,'pnpm-lock.yaml'))===source.lockSha256,'RUNTIME_LOCK_CHANGED');
 // Only Electron's pinned installer is executed; SQLite 13 needs no install script.
 const electronInstall=fileInPackage(payload,'apps/pos-desktop','electron','install.js');
 command(process.execPath,[electronInstall],path.dirname(electronInstall),path.join(attempt,'electron-install.log'),env);
 const sqliteRoot=packageAt(path.join(payload,'packages/database-sqlite'),'better-sqlite3');
 must(sqliteRoot,'RUNTIME_SQLITE_MISSING');
 // better-sqlite3 13 ships N-API prebuilds in its integrity-pinned package.
 must(fs.existsSync(path.join(sqliteRoot,'prebuilds','win32-x64.node')),'RUNTIME_SQLITE_PREBUILD_MISSING');
 const bin=path.join(payload,'.scm-runtime');fs.mkdirSync(bin);
 fs.copyFileSync(process.execPath,path.join(bin,'node.exe'),fs.constants.COPYFILE_EXCL);
 fs.copyFileSync(addon,path.join(bin,'camacho_windows_pipe.node'),fs.constants.COPYFILE_EXCL);
 must(digest(path.join(bin,'camacho_windows_pipe.node'))===addonHash.toLowerCase(),'RUNTIME_ADDON_COPY_MISMATCH');
 for(const [role,name]of [['service','vitest.config.mjs'],['operator','vitest-operator.config.mjs']]){
  fs.writeFileSync(path.join(bin,name),
   'export default '+JSON.stringify({cacheDir:path.join(attempt,'work',role,'vite-cache'),
    test:{pool:'forks',maxWorkers:1}})+';\n',{flag:'wx'});
 }
 const graph=dependencyGraph(payload);
 writeNew(path.join(attempt,'dependencies.json'),graph);
 event(attempt,'SMOKE_NODE',smoke(attempt));
 event(attempt,'SMOKE_ELECTRON',smoke(attempt,'ELECTRON'));
 const files=inventory(payload);
 assertAclPathLengths(payload,files);
 writeNew(path.join(attempt,'manifest.json'),{schema:2,source,pnpmCliSha256:digest(pnpm),addonHash,files});
 event(attempt,'STAGED',{files:files.length,packages:graph.packages.length});
}
export function runnerCandidates(attempt){
 const lab=path.dirname(path.dirname(attempt));
 const common=[
  "#requires -Version 5.1","$ErrorActionPreference='Stop'","Set-StrictMode -Version Latest",
  "$attempt="+JSON.stringify(attempt).replaceAll('\\\\','\\'),
  "$lab="+JSON.stringify(lab).replaceAll('\\\\','\\'),
  "$id=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "if($id.User.Value -ne '"+serviceSid+"' -or [Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0){throw 'REAL_SCM_SESSION_REQUIRED'}",
  "$node=Join-Path $attempt 'payload\\.scm-runtime\\node.exe'",
  "$checker=Join-Path $attempt 'control\\windows-scm-isolated-runtime.ps1'"
 ];
 const probe=[...common,
  "& powershell.exe -NoProfile -File $checker -Mode Probe -LabRoot $lab -Attempt $attempt -Node $node",
  "exit $LASTEXITCODE"].join('\r\n')+'\r\n';
 const physical=[...common,
  "& powershell.exe -NoProfile -File $checker -Mode Verify -RequireScmProbe -LabRoot $lab -Attempt $attempt -Node $node",
  "if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",
  "$env:CAMACHO_SCM_PHYSICAL_PROVISION=Join-Path $lab 'service\\service-provision.json'",
  "$env:TEMP=Join-Path $attempt 'work\\service';$env:TMP=$env:TEMP",
  "$repo=Join-Path $attempt 'payload'",
  "& $node (Join-Path $repo 'apps\\pos-local-service\\node_modules\\vitest\\vitest.mjs') run --root (Join-Path $repo 'apps\\pos-local-service') --config (Join-Path $repo '.scm-runtime\\vitest.config.mjs') --configLoader native 'tests/windows-scm-physical.test.ts' --no-file-parallelism --reporter=json ('--outputFile='+(Join-Path $lab 'results\\service-physical.json'))",
  "exit $LASTEXITCODE"].join('\r\n')+'\r\n';
 return {probe,physical};
}
export function verifyStaged(attempt){
 noLinks(attempt);
 const manifest=JSON.parse(fs.readFileSync(path.join(attempt,'manifest.json'),'utf8'));
 must(manifest.schema===2,'RUNTIME_MANIFEST_SCHEMA_REQUIRES_NEW_ATTEMPT');
 verifyTree(path.join(attempt,'payload'),manifest.files);
 return manifest;
}
export function verify(attempt){
 noLinks(attempt);
 must(!fs.readdirSync(attempt).some(name=>name.startsWith('FAILED-')),'RUNTIME_FAILED_ATTEMPT_REJECTED');
 must(fs.existsSync(path.join(attempt,'READY.json')),'RUNTIME_NOT_READY');
 const ready=JSON.parse(fs.readFileSync(path.join(attempt,'READY.json'),'utf8'));
 must(ready.manifestSha256===digest(path.join(attempt,'manifest.json')),'RUNTIME_READY_HASH_MISMATCH');
 return verifyStaged(attempt);
}
export function writeIsolationProbe(payload,existingFile='package.json'){
 const candidate=path.join(payload,'write-probe-'+crypto.randomUUID());
 let denied=false;
 try{const fd=fs.openSync(candidate,'wx');fs.closeSync(fd);}
 catch(error){denied=['EACCES','EPERM'].includes(error.code);}
 must(denied,'RUNTIME_CODE_WRITABLE');
 if(existingFile===null)return;
 // Also open an existing code file for writing without modifying its bytes.
 denied=false;
 try{const fd=fs.openSync(path.join(payload,existingFile),'r+');fs.closeSync(fd);}
 catch(error){denied=['EACCES','EPERM'].includes(error.code);}
 must(denied,'RUNTIME_EXISTING_CODE_WRITABLE');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 try{
  if(mode==='stage')stage(...args);
  else if(mode==='runners'){
   const scripts=runnerCandidates(args[0]);
   for(const [kind,body] of Object.entries(scripts))fs.writeFileSync(path.join(args[0],'control','service-'+kind+'-runner.ps1'),body,{flag:'wx'});
  }
  else if(mode==='plan')console.log(JSON.stringify(planSource(args[0])));
  else if(mode==='check-tree'){verifyStaged(args[0]);console.log('ISOLATED_STAGED_TREE=PASS');}
  else if(mode==='verify'){verify(args[0]);console.log('ISOLATED_RUNTIME_HASHES=PASS');}
  else if(mode==='smoke'){verify(args[0]);console.log(JSON.stringify(smoke(args[0],args[1]||'NODE')));}
  else if(mode==='probe'){
   must(process.platform==='win32','WINDOWS_REQUIRED');
   const who=command('whoami.exe',['/user','/fo','csv','/nh'],args[0]);
   must(who.includes(serviceSid),'REAL_SCM_TOKEN_REQUIRED');
   verify(args[0]);writeIsolationProbe(path.join(args[0],'payload'));
   writeIsolationProbe(path.join(args[0],'work','operator'),null);
   const result=smoke(args[0],'NODE',true);
   const receipt={...result,serviceSid,manifestSha256:digest(path.join(args[0],'manifest.json')),timestamp:new Date().toISOString()};
   const file=path.join(args[0],'work','service','scm-probe-'+crypto.randomUUID()+'.json');
   writeNew(file,receipt);console.log('SCM_DEPENDENCY_PROBE='+file);
  }else throw Error('RUNTIME_MODE_REJECTED');
 }catch(error){console.error(error.message);process.exitCode=2;}
}
