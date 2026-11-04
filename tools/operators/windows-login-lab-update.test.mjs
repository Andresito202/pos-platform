import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

test('Git fast-forward preserves staged VM edits identical to the incoming tree; helper returns whole SHA',()=>{
 const base=realpathSync(tmpdir()),dir=mkdtempSync(join(base,'camacho-git-preservation-'));
 const emptyHooks=join(dir,'empty-hooks');mkdirSync(emptyHooks);
 const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath='+emptyHooks,...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:20000}).trim();
 try{
  const remote=join(dir,'remote.git'),vm=join(dir,'vm'),publisher=join(dir,'publisher');
  git(dir,'init','--bare',remote);git(dir,'clone',remote,vm);
  for(const name of ['user.name','user.email'])git(vm,'config',name,name==='user.name'?'Git preservation test':'git-test@localhost.invalid');
  writeFileSync(join(vm,'enrollment.txt'),'baseline\n');git(vm,'add','.');git(vm,'commit','-m','fixture baseline');git(vm,'push','origin','HEAD');
  git(dir,'clone',remote,publisher);
  git(publisher,'config','user.name','Git preservation test');git(publisher,'config','user.email','git-test@localhost.invalid');
  writeFileSync(join(publisher,'enrollment.txt'),'reviewed VM change\n');writeFileSync(join(publisher,'new-test.txt'),'reviewed untracked test\n');
  git(publisher,'add','.');git(publisher,'commit','-m','fixture incoming');git(publisher,'push','origin','HEAD');
  const target=git(publisher,'rev-parse','HEAD');
  writeFileSync(join(vm,'enrollment.txt'),'reviewed VM change\n');writeFileSync(join(vm,'new-test.txt'),'reviewed untracked test\n');
  git(vm,'fetch','origin');
  for(const file of ['enrollment.txt','new-test.txt'])assert.equal(git(vm,'hash-object','--path='+file,'--',file),git(vm,'rev-parse',target+':'+file));
  git(vm,'add','--','enrollment.txt','new-test.txt');git(vm,'merge','--ff-only',target);
  assert.equal(git(vm,'rev-parse','HEAD'),target);assert.equal(git(vm,'status','--porcelain'),'');
  assert.equal(readFileSync(join(vm,'enrollment.txt'),'utf8'),'reviewed VM change\n');
  // Deliberately different concurrent work must remain different and intact.
  writeFileSync(join(vm,'enrollment.txt'),'concurrent work must survive\n');
  assert.notEqual(git(vm,'hash-object','--path=enrollment.txt','--','enrollment.txt'),git(vm,'rev-parse',target+':enrollment.txt'));
  if(process.platform==='win32'){
   const wrapper=join(dir,'helpers.ps1');
   writeFileSync(wrapper,`param([string]$TargetRepo,[string]$SourceScript,[string]$Expected)
$RepoRoot=$TargetRepo;$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($SourceScript,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SYNTAX_FAILED'}
$functions=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Git','GitValue')},$true)
foreach($f in $functions){. ([scriptblock]::Create($f.Extent.Text))}
$sha=GitValue @('rev-parse','HEAD')
if($sha -cne $Expected){throw 'SCALAR_SHA_TRUNCATED'}
if(@(Git @('status','--porcelain')).Count -ne 1){throw 'STATUS_ARRAY_MISREAD'}
Write-Output 'GIT_HELPERS_PASS'
`);
   const source=fileURLToPath(new URL('./windows-login-lab-update.ps1',import.meta.url));
   const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',wrapper,'-TargetRepo',vm,'-SourceScript',source,'-Expected',target],{encoding:'utf8',windowsHide:true,timeout:15000});
   assert.match(out,/GIT_HELPERS_PASS/);
  }
 }finally{
  const target=realpathSync(dir);
  if(resolve(target).startsWith(resolve(base)+ '\\camacho-git-preservation-')||resolve(target).startsWith(resolve(base)+'/camacho-git-preservation-'))rmSync(target,{recursive:true,force:true});
 }
});
