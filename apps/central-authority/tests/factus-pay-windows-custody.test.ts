import {it,expect} from "vitest";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {uuidV7} from "@pos-platform/contracts";
import {ManagedFactusPayCredentials} from "../src/subscription-collection-runtime.js";
const windowsIt=process.platform==='win32'?it:it.skip;
windowsIt("existing custody: real DPAPI, masked operator import, no authentication, exact binding, ACL and tamper denial",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"camacho-factus-custody-")),path=join(dir,"api-custody.json"),bindingPath=join(dir,"binding.json");
  const binding={tenantId:uuidV7(),companyId:uuidV7(),integrationId:uuidV7(),credentialReference:"TEST_REFERENCE",generation:1,environment:"SANDBOX" as const,providerAccountReference:"TEST_ACCOUNT_ONLY"};
  const fixture="TEST_ONLY_NOT_A_PROVIDER_TOKEN",script=resolve('../../tools/operators/factus-pay-sandbox-custody.ps1');
  const run=(source:string,input:unknown)=>spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',source],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:20000});
  try{
    const provision=run(String.raw`
$p=[Console]::In.ReadToEnd()|ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
[void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
[IO.Directory]::SetAccessControl($p.dir,$acl)
[IO.File]::WriteAllText($p.bindingPath,($p.binding|ConvertTo-Json -Compress))
$file=New-Object Security.AccessControl.FileSecurity;$file.SetOwner($sid);$file.SetAccessRuleProtection($true,$false)
[void]$file.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));[IO.File]::SetAccessControl($p.bindingPath,$file)
function global:Read-Host {param($Prompt,[switch]$AsSecureString);if($AsSecureString){return ConvertTo-SecureString -String $p.token -AsPlainText -Force};return 'IMPORT SANDBOX'}
& $p.script -Mode ImportToken -CustodyFile $p.path -BindingFile $p.bindingPath
`,{dir,path,bindingPath,binding,token:fixture,script});
    expect(provision.status,provision.stderr).toBe(0);expect(provision.stdout).not.toContain(fixture);
    const original=await readFile(path,'utf8');expect(original).not.toContain(fixture);expect(original).not.toContain('accessToken');
    const store=new ManagedFactusPayCredentials(path);
    expect(await store.resolve(binding,new AbortController().signal)).toEqual({binding,accessToken:fixture,expiresAt:null});
    const inspect=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode','Inspect','-CustodyFile',path,'-BindingFile',bindingPath],{encoding:'utf8',windowsHide:true,timeout:20000});
    expect(inspect.status,inspect.stderr).toBe(0);expect(JSON.parse(inspect.stdout)).toMatchObject({exists:true,dpapiProtected:true,networkCalled:false,tokenValidityVerified:false});
    const preserve=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode','ImportToken','-CustodyFile',path,'-BindingFile',bindingPath],{encoding:'utf8',windowsHide:true,timeout:20000});
    expect(preserve.status).toBe(1);expect(await readFile(path,'utf8')).toBe(original);
    await expect(store.resolve({...binding,generation:2},new AbortController().signal)).rejects.toThrow('MANAGED_CREDENTIAL_REJECTED');
    const altered=JSON.parse(original);altered.credentials[0].binding.providerAccountReference='OTHER_TEST_ACCOUNT';await writeFile(path,JSON.stringify(altered));
    await expect(store.resolve({...binding,providerAccountReference:'OTHER_TEST_ACCOUNT'},new AbortController().signal)).rejects.toThrow();
    await writeFile(path,original);const corrupt=JSON.parse(original);corrupt.credentials[0].protectedCredential.data=Buffer.alloc(64).toString('base64');await writeFile(path,JSON.stringify(corrupt));
    await expect(store.resolve(binding,new AbortController().signal)).rejects.toThrow();await writeFile(path,original);
    const acl=run(String.raw`$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;$acl=Get-Acl -LiteralPath $p.path;[void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-1-0')),'Read','Allow')));[IO.File]::SetAccessControl($p.path,$acl)`,{path});
    expect(acl.status).toBe(0);await expect(store.resolve(binding,new AbortController().signal)).rejects.toThrow();
  }finally{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('camacho-factus-custody-'))throw Error('CLEANUP_REJECTED');await rm(dir,{recursive:true,force:true});}
},60000);
