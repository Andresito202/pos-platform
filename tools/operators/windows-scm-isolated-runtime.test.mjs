import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inventory,verifyTree,verify,digest,writeNew,event,installationSteps,sterileEnvironment,
 dependencyGraph,inside,stage,runnerCandidates,assertAclPathLengths,verifyStaged} from './windows-scm-isolated-runtime.mjs';
function fixture(body){
 const parent=fs.realpathSync.native(os.tmpdir());
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(parent,'camacho-runtime-unit-')));
 try{return body(root);}finally{
  assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('camacho-runtime-unit-'));
  fs.rmSync(root,{recursive:true,force:true});
 }
}
function put(root,file,bytes='fixture'){
 const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,bytes);return target;
}
function ready(root){
 const payload=path.join(root,'payload');fs.mkdirSync(payload);put(payload,'package.json','{}');
 writeNew(path.join(root,'manifest.json'),{schema:2,files:inventory(payload)});
 writeNew(path.join(root,'READY.json'),{manifestSha256:digest(path.join(root,'manifest.json'))});return payload;
}
test('manifest verification is repeatable and read-only',()=>fixture(root=>{
 ready(root);const before=digest(path.join(root,'manifest.json'));
 const first=verify(root);assert.deepEqual(verify(root),first);assert.equal(digest(path.join(root,'manifest.json')),before);
}));
test('changed bytes, extra files and changed object kinds are rejected',()=>fixture(root=>{
 const payload=ready(root),expected=inventory(payload);
 fs.writeFileSync(path.join(payload,'package.json'),'{ }');
 assert.throws(()=>verifyTree(payload,expected),/MANIFEST_MISMATCH/);
 fs.writeFileSync(path.join(payload,'package.json'),'{}');put(payload,'injected.js');
 assert.throws(()=>verify(root),/MANIFEST_MISMATCH/);fs.unlinkSync(path.join(payload,'injected.js'));
 fs.unlinkSync(path.join(payload,'package.json'));fs.mkdirSync(path.join(payload,'package.json'));
 assert.throws(()=>verify(root),/MANIFEST_MISMATCH/);
}));
test('shared hardlinks are rejected',()=>fixture(root=>{
 const source=put(root,'source'),payload=path.join(root,'payload');fs.mkdirSync(payload);
 fs.linkSync(source,path.join(payload,'shared'));assert.throws(()=>inventory(payload),/SHARED_FILE/);
}));
test('internal junctions are inventoried; external and dangling targets fail',()=>fixture(root=>{
 const payload=path.join(root,'payload'),target=path.join(payload,'physical');fs.mkdirSync(target,{recursive:true});
 put(target,'worker.js');const link=path.join(payload,'link');fs.symlinkSync(target,link,'junction');
 const expected=inventory(payload);assert.equal(expected.find(f=>f.type==='link').target,'physical');
 verifyTree(payload,expected);fs.unlinkSync(link);fs.symlinkSync(root,link,'junction');
 assert.throws(()=>inventory(payload),/EXTERNAL/);fs.unlinkSync(link);
 fs.symlinkSync(path.join(root,'missing'),link,'junction');assert.throws(()=>inventory(payload));
}));
test('partial and failed attempts remain unusable without deleting evidence',()=>fixture(root=>{
 event(root,'INSTALLING');assert.throws(()=>verify(root),/NOT_READY/);
 const files=fs.readdirSync(path.join(root,'journal'));ready(root);
 writeNew(path.join(root,'FAILED-injected.json'),{error:'injected'});
 assert.throws(()=>verify(root),/FAILED_ATTEMPT/);assert.deepEqual(fs.readdirSync(path.join(root,'journal')),files);
}));
test('modified manifest cannot reuse READY',()=>fixture(root=>{
 ready(root);fs.appendFileSync(path.join(root,'manifest.json'),' ');
 assert.throws(()=>verify(root),/READY_HASH_MISMATCH/);
}));
test('journal events append without overwriting failed evidence',()=>fixture(root=>{
 event(root,'START');const first=path.join(root,'journal','000001-START.json'),before=digest(first);
 event(root,'FAILED');event(root,'RECOVERY',{verified:false});
 assert.equal(digest(first),before);assert.equal(fs.readdirSync(path.join(root,'journal')).length,3);
 assert.throws(()=>writeNew(first,{}),/EEXIST/);
}));
test('installation is frozen, filtered, script-disabled and uses isolated copy/store',()=>fixture(root=>{
 const step=installationSteps(path.join(root,'payload'),root,path.join(root,'pnpm.cjs'))[1],args=step[1];
 for(const flag of ['--frozen-lockfile','--ignore-scripts','--package-import-method=copy','--config.side-effects-cache=false','--config.virtual-store-dir-max-length=32'])assert.ok(args.includes(flag));
 assert.equal(args[args.indexOf('--store-dir')+1],path.join(root,'store'));assert.equal(step[0],process.execPath);
}));
test('smoke environment clears enrollment and dependency injection variables',()=>fixture(root=>{
 const keys={CAMACHO_SCM_EXPLICIT_OPERATOR_ENROLL:'1',CAMACHO_SCM_PHYSICAL_PROVISION:'private',NODE_OPTIONS:'--require=external',NODE_PATH:'external',POS_DEVICE_ID:'private',npm_config_store_dir:'external'};
 const prior=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,keys);const env=sterileEnvironment(root);
  for(const key of Object.keys(keys))assert.equal(env[key],undefined);
  assert.equal(env.TEMP,path.join(root,'work','operator'));
  assert.equal(sterileEnvironment(root,'service').TEMP,path.join(root,'work','service'));
 }finally{for(const key of Object.keys(keys)){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
}));
test('graph captures optional/peer edges and dynamic/native payload files',()=>fixture(root=>{
 const nm='node_modules/.pnpm/p@1/node_modules/p';
 put(root,nm+'/package.json',JSON.stringify({name:'p',version:'1',optionalDependencies:{'absent-platform':'1'},peerDependencies:{'optional-peer':'1'},peerDependenciesMeta:{'optional-peer':{optional:true}}}));
 put(root,nm+'/dist/dynamic-worker.js');put(root,nm+'/binding.node');
 const graph=dependencyGraph(root);assert.equal(graph.edges.length,2);
 assert.ok(graph.edges.every(e=>e.optional&&e.target===null));assert.equal(graph.nativeFiles.length,1);
 assert.ok(inventory(root).some(f=>f.path.endsWith('dynamic-worker.js')));
}));
test('missing required peers fail the graph audit',()=>fixture(root=>{
 put(root,'node_modules/.pnpm/p@1/node_modules/p/package.json',JSON.stringify({name:'p',version:'1',peerDependencies:{missing:'1'}}));
 assert.throws(()=>dependencyGraph(root),/REQUIRED_DEPENDENCY_MISSING/);
}));
test('path containment rejects prefix siblings',()=>fixture(root=>{
 assert.equal(inside(path.join(root,'payload'),path.join(root,'payload-other','file')),false);
}));
const windows={skip:process.platform!=='win32'};
function psFixture(body){
 return fixture(root=>{
  put(root,'file.js');
  const prelude=String.raw`
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'PS51_REQUIRED'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:TEST_RUNTIME_SCRIPT,[ref]$tokens,[ref]$errors)
if($errors.Count -gt 0){throw 'PS51_PARSE_FAILED'}
$names=@('RuntimeMust','RuntimeNoReparse','RuntimeAcl','RuntimeTargetAcl','RuntimeCheckAcl','RuntimeSeal','RuntimeRestore','RuntimeCheckOperatorWork')
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$false)){Invoke-Expression $fn.Extent.Text}
$runtimeServiceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$runtimeOperatorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$fixture=$env:TEST_RUNTIME_FIXTURE;$file=Join-Path $fixture 'file.js'
$a=Get-Acl -LiteralPath $file;Set-Acl -LiteralPath $file -AclObject $a
function Sddl($p){return (Get-Acl -LiteralPath $p).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
function Ensure($ok,$code){if(-not $ok){throw $code}}
`;
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(prelude+'\n'+body+'\nWrite-Output "FIXTURE_PASS"','utf16le').toString('base64')],
   {env:{...process.env,TEST_RUNTIME_SCRIPT:path.resolve('tools/operators/windows-scm-isolated-runtime.ps1'),TEST_RUNTIME_FIXTURE:root},encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/FIXTURE_PASS/);
 });
}
test('PS5.1 seals protected files with RX and verifies repeatability and recovery',windows,()=>psFixture(String.raw`
$a=Get-Acl -LiteralPath $file;$a.SetAccessRuleProtection($true,$true);Set-Acl -LiteralPath $file -AclObject $a
$before=Sddl $file;$journal=Join-Path $fixture 'acl.json'
RuntimeSeal @($file) $journal (Join-Path $fixture 'work');RuntimeCheckAcl $file
$after=Sddl $file;RuntimeCheckAcl $file;Ensure ((Sddl $file) -eq $after) 'VERIFY_MUTATED'
Ensure (RuntimeRestore $fixture $journal) 'RECOVERY_FAILED'
Ensure ((Sddl $file) -eq $before) 'SDDL_NOT_RESTORED'
`));
test('a real Set-Acl failure has a prior journal and verified recovery',windows,()=>psFixture(String.raw`
$before=Sddl $file;$journal=Join-Path $fixture 'acl.json';$script:fail=$true
function Set-Acl{
 param($LiteralPath,$AclObject)
 Ensure (Test-Path -LiteralPath $journal) 'JOURNAL_MISSING'
 Microsoft.PowerShell.Security\Set-Acl -LiteralPath $LiteralPath -AclObject $AclObject
 if($script:fail){$script:fail=$false;throw 'INJECTED_ACL_FAILURE'}
}
$failed=$false
try{RuntimeSeal @($file) $journal (Join-Path $fixture 'work')}catch{$failed=$_.Exception.Message -eq 'INJECTED_ACL_FAILURE'}
Ensure $failed 'EXPECTED_FAILURE_MISSING'
Ensure (RuntimeRestore $fixture $journal) 'RECOVERY_FAILED'
Ensure ((Sddl $file) -eq $before) 'RECOVERY_NOT_EXACT'
`));
test('recovery preserves concurrent ACL changes',windows,()=>psFixture(String.raw`
$journal=Join-Path $fixture 'acl.json';RuntimeSeal @($file) $journal (Join-Path $fixture 'work')
$a=Get-Acl -LiteralPath $file
$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow'))
Set-Acl -LiteralPath $file -AclObject $a;$concurrent=Sddl $file
Ensure (-not (RuntimeRestore $fixture $journal)) 'CONCURRENT_RECOVERY_ACCEPTED'
Ensure ((Sddl $file) -eq $concurrent) 'CONCURRENT_ACL_OVERWRITTEN'
`));
test('denies and preexisting service writes fail before journaling',windows,()=>psFixture(String.raw`
foreach($kind in @('Deny','Allow')){
 $before=Sddl $file;$a=Get-Acl -LiteralPath $file
 $rights=if($kind -eq 'Deny'){'ReadAndExecute'}else{'Modify'}
 $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($runtimeServiceSid),$rights,$kind))
 Set-Acl -LiteralPath $file -AclObject $a
 $journal=Join-Path $fixture ($kind+'.json');$failed=$false
 try{RuntimeSeal @($file) $journal (Join-Path $fixture 'work')}catch{$failed=$_.Exception.Message -match '^RUNTIME_(DENY_REQUIRES_REVIEW|PREEXISTING_WRITER_REJECTED)$'}
 Ensure ($failed -and -not (Test-Path $journal)) 'UNSAFE_ACL_ACCEPTED'
 $a=Get-Acl -LiteralPath $file;$a.SetSecurityDescriptorSddlForm($before,[Security.AccessControl.AccessControlSections]::Access)
 Set-Acl -LiteralPath $file -AclObject $a
}
`));
test('ACL sealing refuses junctions without touching targets',windows,()=>psFixture(String.raw`
$link=Join-Path $fixture 'junction';[void](New-Item -ItemType Junction -Path $link -Target $fixture)
$failed=$false
try{RuntimeSeal @($link) (Join-Path $fixture 'acl.json') (Join-Path $fixture 'work')}catch{$failed=$_.Exception.Message -eq 'RUNTIME_REPARSE_REJECTED'}
Ensure $failed 'JUNCTION_ACCEPTED'
`));
test('code is RX and scratch alone permits Modify',windows,()=>psFixture(String.raw`
$code=Join-Path $fixture 'payload';$work=Join-Path $fixture 'work'
[void][IO.Directory]::CreateDirectory($code);[void][IO.Directory]::CreateDirectory($work)
$a=Get-Acl -LiteralPath $code;Set-Acl -LiteralPath $code -AclObject $a
$a=Get-Acl -LiteralPath $work;Set-Acl -LiteralPath $work -AclObject $a
RuntimeSeal @($file,$code,$work) (Join-Path $fixture 'acl.json') $work
RuntimeCheckAcl $file;RuntimeCheckAcl $code;RuntimeCheckAcl $work $true
$failed=$false;try{RuntimeCheckAcl $work}catch{$failed=$true}
Ensure $failed 'SCRATCH_LABELLED_READONLY'
`));

test('failed isolated install retains archive/logs, refuses reuse and never publishes READY',()=>fixture(root=>{
 const repo=path.join(root,'source'),attempt=path.join(root,'attempt');
 fs.mkdirSync(repo);fs.mkdirSync(attempt);
 const git=(...args)=>{
  const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);return r.stdout;
 };
 git('init','-b','feat/p0-windows-login-install-readiness');
 put(repo,'package.json',JSON.stringify({name:'unit-fixture',packageManager:'pnpm@9.15.0'}));
 put(repo,'pnpm-lock.yaml',"lockfileVersion: '9.0'\r\n");
 git('-c','core.autocrlf=true','add','package.json','pnpm-lock.yaml');
 git('-c','user.name=Runtime Fixture','-c','user.email=runtime-fixture@example.invalid','commit','-m','fixture');
 const fakePnpm=put(root,'fake-pnpm.cjs',"if(process.argv.includes('--version'))console.log('9.15.0');else{console.error('injected install failure');process.exit(17)}");
 const addon=put(root,'compiled-fixture.node');
 assert.throws(()=>stage(repo,attempt,fakePnpm,addon,digest(addon)),/RUNTIME_COMMAND_FAILED:install.log/);
 const log=path.join(attempt,'install.log'),hash=digest(log);
 assert.ok(fs.readFileSync(log,'utf8').includes('injected install failure'));
 assert.ok(fs.existsSync(path.join(attempt,'source.tar')));
 assert.ok(fs.readdirSync(path.join(attempt,'journal')).some(f=>f.includes('INSTALLING')));
 assert.throws(()=>verify(attempt),/NOT_READY/);
 assert.throws(()=>stage(repo,attempt,fakePnpm,addon,digest(addon)),/EEXIST/);
 assert.equal(digest(log),hash);
}));
test('generated service runners parse on PS5.1 and keep probe separate from physical',windows,()=>fixture(root=>{
 const scripts=runnerCandidates(root);
 assert.ok(scripts.physical.includes('-RequireScmProbe'));
 assert.ok(scripts.physical.includes('--configLoader native'));
 assert.ok(!scripts.probe.includes('CAMACHO_SCM_PHYSICAL_PROVISION'));
 for(const [name,content]of Object.entries(scripts))put(root,name+'.ps1',content);
 const code=String.raw`
$ErrorActionPreference='Stop'
foreach($p in Get-ChildItem -LiteralPath $env:TEST_GENERATED_DIR -Filter '*.ps1'){
 $tokens=$null;$errors=$null
 [void][Management.Automation.Language.Parser]::ParseFile($p.FullName,[ref]$tokens,[ref]$errors)
 if($errors.Count -gt 0){$errors;exit 1}
}
`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{env:{...process.env,TEST_GENERATED_DIR:root},encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,r.stdout+r.stderr);
}));
test('parent/child sealing order preserves exact rollback',windows,()=>psFixture(String.raw`
$payload=Join-Path $fixture 'payload';$sub=Join-Path $payload 'sub';$child=Join-Path $sub 'chunk.js'
[void][IO.Directory]::CreateDirectory($sub);[IO.File]::WriteAllText($child,'fixture')
$before=@{}
foreach($p in @($payload,$sub,$child)){$a=Get-Acl -LiteralPath $p;Set-Acl -LiteralPath $p -AclObject $a;$before[$p]=Sddl $p}
$journal=Join-Path $fixture 'acl.json'
RuntimeSeal @($payload,$sub,$child) $journal (Join-Path $fixture 'work')
foreach($p in @($payload,$sub,$child)){RuntimeCheckAcl $p}
Ensure (RuntimeRestore $fixture $journal) 'TREE_RECOVERY_FAILED'
foreach($p in @($payload,$sub,$child)){Ensure ((Sddl $p) -eq $before[$p]) 'TREE_SDDL_CHANGED'}
`));

test('workspace dependencies cannot resolve to an external parent tree',()=>fixture(root=>{
 const payload=path.join(root,'payload');
 put(payload,'apps/pos-local-service/package.json',JSON.stringify({name:'@pos-platform/pos-local-service',dependencies:{external:'1'}}));
 fs.mkdirSync(path.join(payload,'node_modules/.pnpm'),{recursive:true});
 put(root,'node_modules/external/package.json',JSON.stringify({name:'external',version:'1'}));
 assert.throws(()=>dependencyGraph(payload),/DEPENDENCY_OUTSIDE_PAYLOAD/);
}));
test('interactive operator cannot substitute for the real SCM probe token',windows,()=>fixture(root=>{
 const result=spawnSync(process.execPath,[path.resolve('tools/operators/windows-scm-isolated-runtime.mjs'),'probe',root],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,2);assert.match(result.stderr,/REAL_SCM_TOKEN_REQUIRED/);
 assert.equal(fs.readdirSync(root).length,0);
}));

test('stage cannot mutate the source checkout or its node_modules',()=>fixture(root=>{
 const candidate=path.join(root,'node_modules','runtime');
 assert.throws(()=>stage(root,candidate,'unused','unused','unused'),/ATTEMPT_OVERLAPS_SOURCE/);
 assert.equal(fs.readdirSync(root).length,0);
 assert.throws(()=>stage(root,root,'unused','unused','unused'),/ATTEMPT_OVERLAPS_SOURCE/);
}));

test('SCM scratch cannot grant write access to the operator cache',windows,()=>psFixture(String.raw`
$work=Join-Path $fixture 'work';$service=Join-Path $work 'service';$operator=Join-Path $work 'operator'
[void][IO.Directory]::CreateDirectory($service);[void][IO.Directory]::CreateDirectory($operator)
$cache=Join-Path $operator 'cache.js';[IO.File]::WriteAllText($cache,'fixture')
foreach($p in @($work,$service,$operator)){$a=Get-Acl -LiteralPath $p;Set-Acl -LiteralPath $p -AclObject $a}
RuntimeSeal @($work,$service,$operator) (Join-Path $fixture 'acl.json') $service
RuntimeCheckAcl $operator;RuntimeCheckAcl $service $true
RuntimeCheckOperatorWork $operator
$a=Get-Acl -LiteralPath $cache
$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($runtimeServiceSid),'Modify','Allow'))
Set-Acl -LiteralPath $cache -AclObject $a
$blocked=$false
try{RuntimeCheckOperatorWork $operator}catch{$blocked=$_.Exception.Message -eq 'RUNTIME_OPERATOR_CACHE_WRITABLE_BY_OTHER_IDENTITY'}
Ensure $blocked 'SERVICE_CACHE_POISONING_NOT_REJECTED'
`));

test('long paths fail before PowerShell ACL sealing',()=>fixture(root=>{
 assert.doesNotThrow(()=>assertAclPathLengths(root,[{path:'short.js'}]));
 assert.throws(()=>assertAclPathLengths(root,[{path:'long/'.repeat(60)+'file.js'}]),/PATH_TOO_LONG_FOR_PS51/);
}));

function junctionFixture(body){
 psFixture(String.raw`
. (Join-Path (Split-Path $env:TEST_RUNTIME_SCRIPT -Parent) 'windows-scm-junction-acl.ps1')
Initialize-JunctionNative $fixture
$payload=Join-Path $fixture 'payload';$target=Join-Path $payload 'physical';$link=Join-Path $payload 'link'
[void][IO.Directory]::CreateDirectory($target)
[IO.File]::WriteAllText((Join-Path $target 'module.js'),'fixture')
foreach($p in @($target,(Join-Path $target 'module.js'))){$a=Get-Acl -LiteralPath $p;Set-Acl -LiteralPath $p -AclObject $a}
RuntimeSeal @($target,(Join-Path $target 'module.js')) (Join-Path $fixture 'target-before.json') (Join-Path $fixture 'unused')
[void](New-Item -ItemType Junction -Path $link -Target $target)
# Make the object's own DACL admin/SYSTEM-only, reproducing the observed defect.
$h=[CamachoScmJunction.Handle]::new($link,$true)
try{
 $s=$h.Read();$a=[Security.AccessControl.DirectorySecurity]::new()
 $a.SetSecurityDescriptorSddlForm((JunctionDesired $s),[Security.AccessControl.AccessControlSections]::Access)
 foreach($r in @($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){if($r.IdentityReference.Value -eq $runtimeServiceSid){$a.RemoveAccessRuleSpecific($r)}}
 $h.SetDacl($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))
}finally{$h.Dispose()}
$files=@([ordered]@{path='link';type='link';target='physical';linkText='physical'})
function SaveFixtureManifest{$m=[ordered]@{schema=2;files=$script:files};[IO.File]::WriteAllText((Join-Path $fixture 'manifest.json'),(ConvertTo-Json $m -Depth 6))}
$script:files=$files;SaveFixtureManifest
`+body);
}
test('junction self RX fixes kernel read model without changing target, parent or owner; recovery is exact',windows,()=>junctionFixture(String.raw`
$before=JunctionRead $link;$targetBefore=Sddl $target;$parentBefore=Sddl $payload
Ensure ([CamachoScmJunction.Handle]::RestrictedReadAttributes($link,$runtimeServiceSid,$true) -eq 5) 'MODEL_LINK_NOT_BLOCKED'
Ensure ([CamachoScmJunction.Handle]::RestrictedReadAttributes($target,$runtimeServiceSid,$true) -eq 0) 'MODEL_TARGET_NOT_READABLE'
$plan=@(JunctionPlan $fixture);$journal=Join-Path $fixture 'junction-before.json'
$blocked=$false
try{JunctionVerify $payload $plan}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_RX_UNVERIFIED'}
Ensure $blocked 'UNSEALED_JUNCTION_ACCEPTED'
JunctionSeal $payload $plan $journal
JunctionVerify $payload $plan;JunctionVerify $payload $plan
$after=JunctionRead $link
Ensure ($after.Owner -eq $before.Owner -and $after.Identity -eq $before.Identity) 'OWNER_OR_OBJECT_CHANGED'
Ensure ([CamachoScmJunction.Handle]::RestrictedReadAttributes($link,$runtimeServiceSid,$true) -eq 0) 'MODEL_LINK_RX_FAILED'
Ensure ((Sddl $target) -ceq $targetBefore -and (Sddl $payload) -ceq $parentBefore) 'TARGET_OR_PARENT_CHANGED'
$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetSecurityDescriptorSddlForm($after.Dacl,[Security.AccessControl.AccessControlSections]::Access)
Ensure $a.AreAccessRulesProtected 'JUNCTION_NOT_PROTECTED'
foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){Ensure ($r.InheritanceFlags -eq 'None' -and -not $r.IsInherited) 'JUNCTION_PROPAGATES_ACE'}
$again=@(JunctionPlan $fixture);$script:writes=0
function JunctionWriteDacl($handle,$dacl){$script:writes++;$handle.SetDacl($dacl)}
JunctionSeal $payload $again (Join-Path $fixture 'repeat.json')
Ensure ($script:writes -eq 0) 'IDEMPOTENT_RUN_WROTE'
Ensure (JunctionRestore $fixture $journal) 'JUNCTION_RECOVERY_FAILED'
Ensure ((JunctionRead $link).Dacl -ceq $before.Dacl) 'JUNCTION_NOT_RESTORED'
Ensure ((Sddl $target) -ceq $targetBefore -and (Sddl $payload) -ceq $parentBefore) 'RECOVERY_TOUCHED_TARGET'
`));
test('junction denied or writable ACLs fail planning without altering them',windows,()=>junctionFixture(String.raw`
$baseline=(JunctionRead $link).Dacl
foreach($kind in @('Deny','Allow')){
 $a=[Security.AccessControl.DirectorySecurity]::new();$a.SetSecurityDescriptorSddlForm($baseline,[Security.AccessControl.AccessControlSections]::Access)
 $rights=if($kind -eq 'Deny'){'ReadAndExecute'}else{'Modify'}
 $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($runtimeServiceSid),$rights,$kind))
 $h=[CamachoScmJunction.Handle]::new($link,$true);try{$h.SetDacl($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))}finally{$h.Dispose()}
 $before=(JunctionRead $link).Dacl;$blocked=$false
 try{JunctionPlan $fixture}catch{$blocked=$_.Exception.Message -match 'JUNCTION_(DENY_REQUIRES_REVIEW|EXISTING_WRITER_REJECTED)'}
 Ensure ($blocked -and (JunctionRead $link).Dacl -ceq $before) 'UNSAFE_LINK_ACL_ACCEPTED_OR_CHANGED'
}
`));
test('retargeted and replaced junctions fail without ACL changes on targets',windows,()=>junctionFixture(String.raw`
$plan=@(JunctionPlan $fixture);$before=Sddl $target
[IO.Directory]::Delete($link)
[void](New-Item -ItemType Junction -Path $link -Target $target)
$blocked=$false
try{JunctionSeal $payload $plan (Join-Path $fixture 'replaced.json')}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_CUSTODY_CHANGED'}
Ensure ($blocked -and (Sddl $target) -ceq $before) 'REPLACED_LINK_ACCEPTED'
$plan=@(JunctionPlan $fixture)
[IO.Directory]::Delete($link)
$outside=Join-Path $fixture 'external';[void][IO.Directory]::CreateDirectory($outside)
$externalBefore=Sddl $outside
[void](New-Item -ItemType Junction -Path $link -Target $outside)
$blocked=$false
try{JunctionSeal $payload $plan (Join-Path $fixture 'retargeted.json')}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_TARGET_CHANGED'}
Ensure ($blocked -and (Sddl $outside) -ceq $externalBefore -and (Sddl $target) -ceq $before) 'RETARGETED_LINK_MUTATED_TARGET'
Ensure (-not (JunctionRestore $fixture (Join-Path $fixture 'retargeted.json'))) 'RECOVERY_FOLLOWED_RETARGET'
`));
test('partial junction failure has a complete pre-write journal and repeatable exact recovery',windows,()=>junctionFixture(String.raw`
$second=Join-Path $payload 'second';[void](New-Item -ItemType Junction -Path $second -Target $target)
$script:files+=@{path='second';type='link';target='physical';linkText='physical'};SaveFixtureManifest
$plan=@(JunctionPlan $fixture);$journal=Join-Path $fixture 'partial.json';$script:failed=$false
function JunctionWriteDacl($handle,$dacl){
 $saved=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
 Ensure ($saved.Count -eq 2) 'INCOMPLETE_PREWRITE_JOURNAL'
 $handle.SetDacl($dacl)
 if(-not $script:failed){$script:failed=$true;throw 'INJECTED_AFTER_JUNCTION_WRITE'}
}
$blocked=$false
try{JunctionSeal $payload $plan $journal}catch{$blocked=$_.Exception.Message -eq 'INJECTED_AFTER_JUNCTION_WRITE'}
Ensure $blocked 'INJECTED_FAILURE_NOT_OBSERVED'
Ensure (JunctionRestore $fixture $journal) 'PARTIAL_RECOVERY_FAILED'
Ensure (JunctionRestore $fixture $journal) 'REPEATED_RECOVERY_FAILED'
foreach($entry in $plan){Ensure ((JunctionRead $entry.Path).Dacl -ceq $entry.Before) 'PARTIAL_ACL_LEFT_APPLIED'}
Ensure (Test-Path -LiteralPath $journal) 'JOURNAL_DELETED'
`));
test('concurrent junction ACL changes after journaling are preserved',windows,()=>junctionFixture(String.raw`
$second=Join-Path $payload 'second';[void](New-Item -ItemType Junction -Path $second -Target $target)
$script:files+=@{path='second';type='link';target='physical';linkText='physical'};SaveFixtureManifest
$plan=@(JunctionPlan $fixture);$journal=Join-Path $fixture 'concurrent.json'
$script:injected=$false;$script:concurrent=$null
function JunctionWriteDacl($handle,$dacl){
 $handle.SetDacl($dacl)
 if(-not $script:injected){
  $script:injected=$true
  $h=[CamachoScmJunction.Handle]::new($second,$true)
  try{
   $a=[Security.AccessControl.DirectorySecurity]::new()
   $a.SetSecurityDescriptorSddlForm($h.Read().Dacl,[Security.AccessControl.AccessControlSections]::Access)
   $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow'))
   $h.SetDacl($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))
   $script:concurrent=$h.Read().Dacl
  }finally{$h.Dispose()}
 }
}
$blocked=$false
try{JunctionSeal $payload $plan $journal}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_CONCURRENT_ACL_CHANGE'}
Ensure $blocked 'CONCURRENT_LINK_CHANGE_ACCEPTED'
Ensure (-not (JunctionRestore $fixture $journal)) 'CONCURRENT_LINK_RESTORE_ACCEPTED'
Ensure ((JunctionRead $second).Dacl -ceq $script:concurrent) 'CONCURRENT_LINK_ACL_OVERWRITTEN'
`));
test('junction plan rejects escaped manifest paths and missing link metadata',windows,()=>junctionFixture(String.raw`
$script:files=@(@{path='link';type='link';target='../outside';linkText='../outside'});SaveFixtureManifest
$blocked=$false
try{JunctionPlan $fixture}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_OUTSIDE_PAYLOAD'}
Ensure $blocked 'OUTSIDE_MANIFEST_TARGET_ACCEPTED'
$script:files=@(@{path='link';type='link';target='physical'});SaveFixtureManifest
$blocked=$false
try{JunctionPlan $fixture}catch{$blocked=$_.Exception.Message -eq 'JUNCTION_MANIFEST_POLICY_REQUIRED'}
Ensure $blocked 'OLD_LINK_POLICY_ACCEPTED'
`));

test('unprotected junction inheritance restores exactly and parent changes block recovery',windows,()=>junctionFixture(String.raw`
$h=[CamachoScmJunction.Handle]::new($link,$true)
try{
 $a=[Security.AccessControl.DirectorySecurity]::new()
 $a.SetSecurityDescriptorSddlForm($h.Read().Dacl,[Security.AccessControl.AccessControlSections]::Access)
 $a.SetAccessRuleProtection($false,$true)
 $h.SetDacl($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))
}finally{$h.Dispose()}
$plan=@(JunctionPlan $fixture);$journal=Join-Path $fixture 'inheritance.json'
JunctionSeal $payload $plan $journal
Ensure (JunctionRestore $fixture $journal) 'UNPROTECTED_RECOVERY_FAILED'
Ensure ((JunctionRead $link).Dacl -ceq $plan[0].Before) 'UNPROTECTED_DACL_CHANGED'
$plan=@(JunctionPlan $fixture);$journal=Join-Path $fixture 'parent-change.json'
JunctionSeal $payload $plan $journal
$after=(JunctionRead $link).Dacl
$a=Get-Acl -LiteralPath $payload
$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($runtimeServiceSid),'Modify','Allow'))
Set-Acl -LiteralPath $payload -AclObject $a
Ensure (-not (JunctionRestore $fixture $journal)) 'UNSAFE_PARENT_RECOVERY_ACCEPTED'
Ensure ((JunctionRead $link).Dacl -ceq $after) 'RECOVERY_UNPROTECTED_UNDER_CHANGED_PARENT'
`));

test('protected junction survives parent sealing and complete reverse-order recovery',windows,()=>junctionFixture(String.raw`
$a=Get-Acl -LiteralPath $payload;Set-Acl -LiteralPath $payload -AclObject $a
$parentBefore=Sddl $payload
$plan=@(JunctionPlan $fixture);$linksJournal=Join-Path $fixture 'junction-before.json'
JunctionSeal $payload $plan $linksJournal
RuntimeSeal @($payload,$target,(Join-Path $target 'module.js')) (Join-Path $fixture 'acl-before.json') (Join-Path $fixture 'unused')
JunctionVerify $payload $plan
Ensure (RuntimeRestore $fixture (Join-Path $fixture 'acl-before.json')) 'PHYSICAL_RECOVERY_FAILED'
Ensure (JunctionRestore $fixture $linksJournal) 'JUNCTION_AFTER_PARENT_RECOVERY_FAILED'
Ensure ((Sddl $payload) -ceq $parentBefore -and (JunctionRead $link).Dacl -ceq $plan[0].Before) 'COMPLETE_RECOVERY_NOT_EXACT'
`));

test('pre-publication tree verification rejects added junctions without publishing READY',()=>fixture(root=>{
 const payload=path.join(root,'payload');put(payload,'physical/module.js');
 writeNew(path.join(root,'manifest.json'),{schema:2,files:inventory(payload)});
 verifyStaged(root);
 fs.symlinkSync(path.join(payload,'physical'),path.join(payload,'late-link'),'junction');
 assert.throws(()=>verifyStaged(root),/MANIFEST_MISMATCH/);
 assert.equal(fs.existsSync(path.join(root,'READY.json')),false);
}));
