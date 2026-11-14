import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const script=resolve('tools/operators/windows-scm-lab-dependency-acl.ps1');
const windows={skip:process.platform!=='win32'};
function run(body){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'camacho-pnpm-acl-unit-')));
 writeFileSync(join(directory,'entry with spaces á.mjs'),'// read-only path resolution fixture\n');
 const prelude=String.raw`
 $ErrorActionPreference='Stop'
 Set-StrictMode -Version Latest
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile($env:CAMACHO_ACL_SCRIPT,[ref]$tokens,[ref]$errors)
 if($errors.Count -ne 0){throw 'SCRIPT_PARSE_FAILED'}
 $names=@('Assert','Within','AssertPnpmPath','NewVitestReadPlan','ResolveVitestPath','InspectRead','GrantRead','SaveJournal','UndoReadChanges')
 $functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$false))
 if($functions.Count -ne $names.Count){throw 'EXPECTED_FUNCTIONS_MISSING'}
 foreach($fn in $functions){Invoke-Expression $fn.Extent.Text}
 $serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
 $sid=[Security.Principal.SecurityIdentifier]::new($serviceSid)
 $Apply=$true;$script:journalPath=$null;$script:physicalStore=$null
 $script:aclChanges=[System.Collections.Generic.List[object]]::new()
 $fixture=$env:CAMACHO_ACL_FIXTURE
 $file=Join-Path $fixture 'entry with spaces á.mjs'
 # Establish a Windows-normalized inherited DACL before taking snapshots.
 # Fresh Node-created files can gain the AI metadata flag on their first Set-Acl.
 $acl=Get-Acl -LiteralPath $file;Set-Acl -LiteralPath $file -AclObject $acl
 function Ensure([bool]$value,[string]$code){if(-not $value){throw $code}}
 function Sddl([string]$p){return (Get-Acl -LiteralPath $p).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
 function AddFixtureAce([string]$p,[Security.AccessControl.FileSystemAccessRule]$rule){$a=Get-Acl -LiteralPath $p;$a.AddAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $a}
 `;
 try{
  const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(prelude+'\n'+body+'\nWrite-Output "FIXTURE_PASS"','utf16le').toString('base64')],{
   env:{...process.env,CAMACHO_ACL_SCRIPT:script,CAMACHO_ACL_FIXTURE:directory,CAMACHO_ACL_NODE:process.execPath},encoding:'utf8',windowsHide:true,timeout:20000,
  });
  assert.equal(r.status,0,`${r.stderr}\n${r.stdout}`);
  assert.match(r.stdout,/FIXTURE_PASS/);
 }finally{
  const root=realpathSync.native(tmpdir())+sep;
  assert.ok(resolve(directory).startsWith(root)&&directory.includes('camacho-pnpm-acl-unit-'));
  rmSync(directory,{recursive:true,force:true});
 }
}

test('PS5.1 resolves the actual pnpm-style entry path through stdin, preserving spaces and Unicode',windows,()=>run(String.raw`
 $got=ResolveVitestPath $env:CAMACHO_ACL_NODE $file
 Ensure ($got -ceq $file) 'CANONICAL_PATH_CHANGED'
 Ensure (-not (Within $file (Join-Path $fixture 'other'))) 'PREFIX_ESCAPE_ACCEPTED'
`));
test('RX grant is bounded, contains no write permissions and a repeated run makes no change',windows,()=>run(String.raw`
 GrantRead $file $false
 $after=Sddl $file
 Ensure (-not (InspectRead $file $false).NeedsGrant) 'RX_MISSING'
 GrantRead $file $false
 Ensure ((Sddl $file) -eq $after -and $script:aclChanges.Count -eq 1) 'NOT_IDEMPOTENT'
`));
test('dry-run never changes ACLs or creates rollback changes',windows,()=>run(String.raw`
 $before=Sddl $file;$Apply=$false
 GrantRead $file $false
 Ensure ((Sddl $file) -eq $before -and $script:aclChanges.Count -eq 0) 'DRY_RUN_MUTATED'
`));
test('pre-existing service Modify is rejected rather than labelled RX-ready',windows,()=>run(String.raw`
 AddFixtureAce $file ([Security.AccessControl.FileSystemAccessRule]::new($sid,'Modify','Allow'))
 $before=Sddl $file;$denied=$false
 try{GrantRead $file $false}catch{$denied=$_.Exception.Message -eq 'PNPM_EXISTING_SERVICE_WRITE_REQUIRES_REVIEW'}
 Ensure ($denied -and (Sddl $file) -eq $before) 'EXCESS_WRITE_ACCEPTED_OR_MUTATED'
`));
test('service deny ACE is preserved and rejected before mutation',windows,()=>run(String.raw`
 AddFixtureAce $file ([Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadAndExecute','Deny'))
 $before=Sddl $file;$denied=$false
 try{GrantRead $file $false}catch{$denied=$_.Exception.Message -eq 'PNPM_EXPLICIT_DENY_REQUIRES_REVIEW'}
 Ensure ($denied -and (Sddl $file) -eq $before) 'DENY_REWRITTEN_OR_ACCEPTED'
`));
test('InheritOnly does not falsely establish access on the directory itself',windows,()=>run(String.raw`
 $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','InheritOnly','Allow')
 AddFixtureAce $fixture $rule
 Ensure ((InspectRead $fixture $true).NeedsGrant) 'INHERIT_ONLY_ACCEPTED'
 GrantRead $fixture $true
 Ensure (-not (InspectRead $fixture $true).NeedsGrant) 'DIRECTORY_ACCESS_UNVERIFIED'
`));
test('rollback restores only changes made by this invocation',windows,()=>run(String.raw`
 $before=Sddl $file;GrantRead $file $false
 Ensure (UndoReadChanges) 'ROLLBACK_FAILED'
 Ensure ((Sddl $file) -eq $before) 'ACL_NOT_RESTORED'
`));
test('rollback refuses to overwrite a concurrent ACL change',windows,()=>run(String.raw`
 GrantRead $file $false
 $other=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
 AddFixtureAce $file ([Security.AccessControl.FileSystemAccessRule]::new($other,'Read','Allow'))
 $concurrent=Sddl $file
 Ensure (-not (UndoReadChanges)) 'CONCURRENT_CHANGE_NOT_DETECTED'
 Ensure ((Sddl $file) -eq $concurrent) 'CONCURRENT_ACL_OVERWRITTEN'
`));
test('a Set-Acl exception after a real write still has a restorable pre-write record',windows,()=>run(String.raw`
 $before=Sddl $file;$script:failAfterWrite=$true
 function Set-Acl{
  param([string]$LiteralPath,$AclObject,[string]$ErrorAction)
  Microsoft.PowerShell.Security\Set-Acl -LiteralPath $LiteralPath -AclObject $AclObject -ErrorAction Stop
  if($script:failAfterWrite){$script:failAfterWrite=$false;throw 'INJECTED_AFTER_REAL_WRITE'}
 }
 $failed=$false
 try{GrantRead $file $false}catch{$failed=$_.Exception.Message -eq 'INJECTED_AFTER_REAL_WRITE'}
 Ensure ($failed -and $script:aclChanges.Count -eq 1 -and (Sddl $file) -ne $before) 'PARTIAL_WRITE_NOT_EXERCISED'
 Ensure (UndoReadChanges) 'PARTIAL_WRITE_ROLLBACK_FAILED'
 Ensure ((Sddl $file) -eq $before) 'PARTIAL_WRITE_LEFT_APPLIED'
`));
test('junctions are rejected without traversing or granting the target',windows,()=>run(String.raw`
 $target=Join-Path $fixture 'physical';[void][IO.Directory]::CreateDirectory($target)
 $link=Join-Path $fixture 'link';[void](New-Item -ItemType Junction -Path $link -Target $target)
 $before=Sddl $target;$denied=$false
 try{GrantRead $link $true}catch{$denied=$_.Exception.Message -eq 'PNPM_REPARSE_CUSTODY_REJECTED'}
 Ensure ($denied -and (Sddl $target) -eq $before) 'JUNCTION_TARGET_MUTATED'
`));

test("protected cli is included, RX stays protected, repeated plan is idempotent and rollback restores it",windows,()=>run(String.raw`
$store=Join-Path $fixture '.pnpm'
$package=Join-Path $store 'vitest@fixture\node_modules\vitest'
[void][IO.Directory]::CreateDirectory((Join-Path $package 'dist'))
$entry=Join-Path $package 'vitest.mjs'
$cli=Join-Path $package 'dist\cli.js'
[IO.File]::WriteAllText($entry,'// fixture')
[IO.File]::WriteAllText($cli,'// fixture')
$script:physicalStore=$store
# Normalize the fixture root before snapshots; keep production comparisons exact.
$acl=Get-Acl -LiteralPath $store;Set-Acl -LiteralPath $store -AclObject $acl
$acl=Get-Acl -LiteralPath $cli;$acl.SetAccessRuleProtection($true,$true)
Set-Acl -LiteralPath $cli -AclObject $acl
$before=Sddl $cli
$plan=@(NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry)
Ensure (@($plan | Where-Object {-not $_.Directory}).Count -eq 2) 'FILES_MISSING'
Ensure (@($plan | Where-Object {$_.Path -eq (Join-Path $package 'dist')}).Count -eq 1) 'DIST_MISSING'
Ensure (@($plan.Path | Select-Object -Unique).Count -eq $plan.Count) 'DUPLICATES'
foreach($p in $plan){GrantRead $p.Path $p.Directory}
Ensure ((Get-Acl -LiteralPath $cli).AreAccessRulesProtected) 'PROTECTION_CHANGED'
Ensure (-not (InspectRead $cli $false).NeedsGrant) 'CLI_RX_MISSING'
$after=Sddl $cli;$count=$script:aclChanges.Count
foreach($p in @(NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry)){GrantRead $p.Path $p.Directory}
Ensure ($count -eq $script:aclChanges.Count -and (Sddl $cli) -eq $after) 'REPEAT_MUTATED'
Ensure (UndoReadChanges) 'ROLLBACK_FAILED'
Ensure ((Sddl $cli) -eq $before) 'CLI_NOT_RESTORED'
`));

test("cli ACL failure has a prior journal and verified rollback",windows,()=>run(String.raw`
$store=Join-Path $fixture '.pnpm'
$package=Join-Path $store 'vitest@fixture\node_modules\vitest'
[void][IO.Directory]::CreateDirectory((Join-Path $package 'dist'))
$entry=Join-Path $package 'vitest.mjs'
$cli=Join-Path $package 'dist\cli.js'
[IO.File]::WriteAllText($entry,'// fixture')
[IO.File]::WriteAllText($cli,'// fixture')
$script:physicalStore=$store
# Normalize the fixture root before snapshots; keep production comparisons exact.
$acl=Get-Acl -LiteralPath $store;Set-Acl -LiteralPath $store -AclObject $acl
$acl=Get-Acl -LiteralPath $cli;$acl.SetAccessRuleProtection($true,$true)
Set-Acl -LiteralPath $cli -AclObject $acl
$before=Sddl $cli
$script:journalPath=Join-Path $fixture 'journal.json'
$script:failAfterWrite=$true
function Set-Acl{
 param([string]$LiteralPath,$AclObject,[string]$ErrorAction)
 $journal=Get-Content -LiteralPath $script:journalPath -Raw | ConvertFrom-Json
 Ensure ($journal.state -eq 'APPLYING' -and $journal.changes[0].Before -eq $before) 'JOURNAL_NOT_PRIOR'
 Microsoft.PowerShell.Security\Set-Acl -LiteralPath $LiteralPath -AclObject $AclObject -ErrorAction Stop
 if($script:failAfterWrite){$script:failAfterWrite=$false;throw 'INJECTED_CLI_ACL_FAILURE'}
}
$failed=$false
try{GrantRead $cli $false}catch{$failed=$_.Exception.Message -eq 'INJECTED_CLI_ACL_FAILURE'}
Ensure ($failed -and $script:aclChanges.Count -eq 1) 'FAILURE_NOT_EXERCISED'
Ensure (UndoReadChanges) 'ROLLBACK_FAILED'
Ensure ((Sddl $cli) -eq $before -and (Get-Acl -LiteralPath $cli).AreAccessRulesProtected) 'ROLLBACK_UNVERIFIED'
`));

test("plan rejects external paths, missing cli and altered canonical resolution",windows,()=>run(String.raw`
$store=Join-Path $fixture '.pnpm'
$package=Join-Path $store 'vitest@fixture\node_modules\vitest'
[void][IO.Directory]::CreateDirectory((Join-Path $package 'dist'))
$entry=Join-Path $package 'vitest.mjs'
$cli=Join-Path $package 'dist\cli.js'
[IO.File]::WriteAllText($entry,'// fixture')
[IO.File]::WriteAllText($cli,'// fixture')
$script:physicalStore=$store
# Normalize the fixture root before snapshots; keep production comparisons exact.
$acl=Get-Acl -LiteralPath $store;Set-Acl -LiteralPath $store -AclObject $acl
$blocked=$false
try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $file}catch{$blocked=$_.Exception.Message -eq 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'}
Ensure $blocked 'EXTERNAL_ACCEPTED'
$script:redirect=$file
function ResolveVitestPath([string]$node,[string]$link){return $script:redirect}
$blocked=$false
try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry}catch{$blocked=$_.Exception.Message -eq 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'}
Ensure $blocked 'CANONICAL_EXTERNAL_ACCEPTED'
$script:redirect=$entry;$blocked=$false
try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry}catch{$blocked=$_.Exception.Message -eq 'VITEST_CLI_CANONICAL_PATH_CHANGED'}
Ensure $blocked 'CHANGED_CANONICAL_ACCEPTED'
Remove-Item -LiteralPath $cli
$blocked=$false
try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry}catch{$blocked=$true}
Ensure ($blocked -and $script:aclChanges.Count -eq 0) 'MISSING_ACCEPTED'
`));

test("dist junction is rejected without granting external target",windows,()=>run(String.raw`
$store=Join-Path $fixture '.pnpm'
$package=Join-Path $store 'vitest@fixture\node_modules\vitest'
[void][IO.Directory]::CreateDirectory((Join-Path $package 'dist'))
$entry=Join-Path $package 'vitest.mjs'
$cli=Join-Path $package 'dist\cli.js'
[IO.File]::WriteAllText($entry,'// fixture')
[IO.File]::WriteAllText($cli,'// fixture')
$script:physicalStore=$store
# Normalize the fixture root before snapshots; keep production comparisons exact.
$acl=Get-Acl -LiteralPath $store;Set-Acl -LiteralPath $store -AclObject $acl
Remove-Item -LiteralPath $cli
Remove-Item -LiteralPath (Join-Path $package 'dist')
$target=Join-Path $fixture 'external'
[void][IO.Directory]::CreateDirectory($target)
[IO.File]::WriteAllText((Join-Path $target 'cli.js'),'// fixture')
$before=Sddl $target
[void](New-Item -ItemType Junction -Path (Join-Path $package 'dist') -Target $target)
$blocked=$false
try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry}catch{$blocked=$_.Exception.Message -eq 'PNPM_REPARSE_CUSTODY_REJECTED'}
Ensure ($blocked -and (Sddl $target) -eq $before -and $script:aclChanges.Count -eq 0) 'JUNCTION_ACCEPTED'
`));

test("cli applicable deny and service write reject plan before any grant",windows,()=>run(String.raw`
$store=Join-Path $fixture '.pnpm'
$package=Join-Path $store 'vitest@fixture\node_modules\vitest'
[void][IO.Directory]::CreateDirectory((Join-Path $package 'dist'))
$entry=Join-Path $package 'vitest.mjs'
$cli=Join-Path $package 'dist\cli.js'
[IO.File]::WriteAllText($entry,'// fixture')
[IO.File]::WriteAllText($cli,'// fixture')
$script:physicalStore=$store
# Normalize the fixture root before snapshots; keep production comparisons exact.
$acl=Get-Acl -LiteralPath $store;Set-Acl -LiteralPath $store -AclObject $acl
foreach($kind in @('Deny','Allow')){
 $rights=if($kind -eq 'Deny'){'ReadAndExecute'}else{'Modify'}
 $sddl=Sddl $cli
 $identity=if($kind -eq 'Deny'){[Security.Principal.SecurityIdentifier]::new('S-1-5-11')}else{$sid}
 AddFixtureAce $cli ([Security.AccessControl.FileSystemAccessRule]::new($identity,$rights,$kind))
 $blocked=$false
 try{NewVitestReadPlan $env:CAMACHO_ACL_NODE $store $entry}catch{$blocked=$_.Exception.Message -match '^PNPM_(EXPLICIT_DENY|EXISTING_SERVICE_WRITE)_REQUIRES_REVIEW$'}
 Ensure ($blocked -and $script:aclChanges.Count -eq 0) 'UNSAFE_PLAN_ACCEPTED'
 $acl=Get-Acl -LiteralPath $cli
 $acl.SetSecurityDescriptorSddlForm($sddl,[Security.AccessControl.AccessControlSections]::Access)
 Set-Acl -LiteralPath $cli -AclObject $acl
}
`));

test("rollback reports review when Windows changes inherited DACL metadata",windows,()=>run(String.raw`
$fresh=Join-Path $fixture 'fresh.js';[IO.File]::WriteAllText($fresh,'// fixture')
$before=Sddl $fresh
GrantRead $fresh $false
$ok=UndoReadChanges
$after=Sddl $fresh
Ensure ($ok -eq ($after -eq $before)) 'NONEXACT_ROLLBACK_REPORTED_SUCCESS'
Ensure (-not ($after -match [regex]::Escape($serviceSid))) 'SERVICE_GRANT_REMAINS'
`));

test("concurrent ACL change after journaling is not overwritten",windows,()=>run(String.raw`
$before=Sddl $file
function SaveJournal([string]$state){
 if($state -eq 'APPLYING'){
  $other=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
  AddFixtureAce $file ([Security.AccessControl.FileSystemAccessRule]::new($other,'Read','Allow'))
 }
}
$blocked=$false
try{GrantRead $file $false}catch{$blocked=$_.Exception.Message -eq 'PNPM_CONCURRENT_ACL_CHANGE_NOT_OVERWRITTEN'}
$concurrent=Sddl $file
Ensure ($blocked -and $script:aclChanges.Count -eq 1) 'CONCURRENT_WRITE_ACCEPTED'
Ensure (-not (UndoReadChanges)) 'CONCURRENT_ROLLBACK_ACCEPTED'
Ensure ((Sddl $file) -eq $concurrent) 'CONCURRENT_ACL_OVERWRITTEN'
`));
