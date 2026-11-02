import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const windows={skip:process.platform!=='win32'};
const script=resolve('tools/operators/windows-scm-lab-binding.ps1');
function ps(code){
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{
  env:{...process.env,CAMACHO_BINDING_SCRIPT:script},encoding:'utf8',windowsHide:true,timeout:15000,
 });
 assert.equal(result.status,0,result.stderr);
 return result.stdout.trim();
}
test('SCM binding accepts the exact executable only; substring, arguments and unquoted spaces fail',windows,()=>{
 const results=JSON.parse(ps(String.raw`
 $ErrorActionPreference='Stop';. $env:CAMACHO_BINDING_SCRIPT
 $expected='C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046\service\CamachoPOSLocalService.exe'
 $space='C:\Lab With Spaces\CamachoPOSLocalService.exe'
 @(
  (Test-WindowsScmLabImagePath $expected $expected),
  (Test-WindowsScmLabImagePath ('"'+$expected+'"') $expected),
  (Test-WindowsScmLabImagePath ('"'+$expected+'" --other-config') $expected),
  (Test-WindowsScmLabImagePath ('C:\evil.exe --wrapper '+$expected) $expected),
  (Test-WindowsScmLabImagePath ('"'+$expected) $expected),
  (Test-WindowsScmLabImagePath '' $expected),
  (Test-WindowsScmLabImagePath $space $space),
  (Test-WindowsScmLabImagePath ('"'+$space+'"') $space),
  (Test-WindowsScmLabImagePath '%WRAPPER%' $expected)
 ) | ConvertTo-Json -Compress
 `));
 assert.deepEqual(results,[true,true,false,false,false,false,false,true,false]);
});
test('all changed operator PowerShell scripts parse on Windows PowerShell 5.1',windows,()=>{
 assert.equal(ps(String.raw`
 $ErrorActionPreference='Stop';$dir=Split-Path $env:CAMACHO_BINDING_SCRIPT -Parent
 foreach($file in @('windows-scm-lab-binding.ps1','windows-scm-lab-dependency-acl.ps1','windows-scm-lab-provision.ps1','windows-scm-lab-gate.ps1','windows-scm-five-stage.ps1','windows-scm-physical-one-shot.ps1')){
  $tokens=$null;$errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $dir $file),[ref]$tokens,[ref]$errors)
  if($errors.Count -ne 0){throw 'OPERATOR_SCRIPT_SYNTAX_REJECTED'}
 }
 Write-Output 'PARSE_PASS'
 `),'PARSE_PASS');
});
