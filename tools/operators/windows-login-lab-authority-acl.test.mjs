import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('./windows-login-lab-authority-acl.ps1',import.meta.url));
function run(args){return spawnSync('powershell.exe',['-NoProfile',...args],{encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,CAMACHO_LAB_ACL_SOURCE_TEST:file}});}
test('PowerShell recovery script parses and defaults to no filesystem or ACL action',{skip:process.platform!=='win32'},()=>{
 const parser=run(['-Command',"$ErrorActionPreference='Stop';$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($env:CAMACHO_LAB_ACL_SOURCE_TEST,[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"]);
 assert.equal(parser.status,0,parser.stderr);
 const result=run(['-File',file]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/LAB_AUTHORITY_ACL_NO_ACTION/);
});
test('an attempted run outside the exact approved lab stops before any ACL operation',{skip:process.platform!=='win32'},()=>{
 const result=run(['-File',file,'-LabRoot','C:\\NotTheLab','-Run']);
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/LAB_AUTHORITY_ACL_SCOPE_REJECTED/);
});
