import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const script=resolve('tools/operators/windows-scm-lab-dependency-acl.ps1');
const windows={skip:process.platform!=='win32'};
function run(body){
 const directory=mkdtempSync(join(tmpdir(),'camacho-pnpm-acl-unit-'));
 writeFileSync(join(directory,'entry with spaces á.mjs'),'// read-only path resolution fixture\n');
 const prelude=String.raw`
 $ErrorActionPreference='Stop'
 Set-StrictMode -Version Latest
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile($env:CAMACHO_ACL_SCRIPT,[ref]$tokens,[ref]$errors)
 if($errors.Count -ne 0){throw 'SCRIPT_PARSE_FAILED'}
 $names=@('Assert','Within','ResolveVitestPath','InspectRead','GrantRead','SaveJournal','UndoReadChanges')
 $functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$false))
 if($functions.Count -ne $names.Count){throw 'EXPECTED_FUNCTIONS_MISSING'}
 foreach($fn in $functions){Invoke-Expression $fn.Extent.Text}
 $serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
 $sid=[Security.Principal.SecurityIdentifier]::new($serviceSid)
 $Apply=$true;$script:journalPath=$null
 $script:aclChanges=[System.Collections.Generic.List[object]]::new()
 $fixture=$env:CAMACHO_ACL_FIXTURE
 $file=Join-Path $fixture 'entry with spaces á.mjs'
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
  const root=resolve(tmpdir())+sep;
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
