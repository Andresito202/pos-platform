import {it,expect} from "vitest";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {uuidV7} from "@pos-platform/contracts";
const windowsIt=process.platform==='win32'?it:it.skip;
windowsIt("webhook operator: CSPRNG hash, actual DPAPI custody, binding and no overwrite; never registers or contacts provider",async()=>{
  const dir=await mkdtemp(join(tmpdir(),'camacho-webhook-operator-')),path=join(dir,'webhook.dpapi.json'),bindingPath=join(dir,'binding.json');
  const binding={tenantId:uuidV7(),companyId:uuidV7(),integrationId:uuidV7(),environment:'SANDBOX'};
  const script=resolve('../../tools/operators/factus-pay-sandbox-webhook.ps1');
  const run=(mode:string)=>spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode',mode,'-SecretFile',path,'-BindingFile',bindingPath],{encoding:'utf8',windowsHide:true,timeout:15000});
  try{
    await writeFile(bindingPath,JSON.stringify(binding));
    const setup=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',String.raw`
$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
[void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));[IO.Directory]::SetAccessControl($p.dir,$acl)
$acl=New-Object Security.AccessControl.FileSecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
[void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));[IO.File]::SetAccessControl($p.bindingPath,$acl)
`],{input:JSON.stringify({dir,bindingPath}),encoding:'utf8',windowsHide:true});expect(setup.status,setup.stderr).toBe(0);
    const generated=run('Generate');expect(generated.status,generated.stderr).toBe(0);
    const observation=JSON.parse(generated.stdout);expect(observation).toMatchObject({protected:true,networkCalled:false,centralProvisioned:false,purpose:'WEBHOOK_ONLY'});
    expect(observation.secret_sha256).toMatch(/^[a-f0-9]{64}$/);
    const original=await readFile(path,'utf8');expect(JSON.parse(original)).toMatchObject({kind:'FACTUS_PAY_WEBHOOK_SECRET',binding});
    expect(JSON.parse(await readFile(path+'.registration.json','utf8'))).toEqual({binding,secret_sha256:observation.secret_sha256,registrationStatus:'NOT_REGISTERED'});
    expect(run('Generate').status).toBe(1);expect(await readFile(path,'utf8')).toBe(original);
    const inspect=run('Inspect');expect(inspect.status,inspect.stderr).toBe(0);expect(JSON.parse(inspect.stdout).secret_sha256).toBe(observation.secret_sha256);
    await writeFile(bindingPath,JSON.stringify({...binding,companyId:uuidV7()}));expect(run('Inspect').status).toBe(1);
  }finally{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('camacho-webhook-operator-'))throw Error('CLEANUP_REJECTED');await rm(dir,{recursive:true,force:true});}
},60000);
