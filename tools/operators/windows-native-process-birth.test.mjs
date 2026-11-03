import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Compile the actual kernel reader. Cross-identity admission has its SCM test.
test('kernel process birth matches handles and rejects absent or exited peers',
 {skip:process.platform!=='win32',timeout:120000},t=>{
 const find=spawnSync('C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true});
 assert.equal(find.status,0,find.stderr);
 const installation=find.stdout.trim();assert.ok(installation);
 const directory=mkdtempSync(join(tmpdir(),'camacho-process-birth-'));
 t.diagnostic('Native evidence: '+directory);
 const source=join(directory,'birth.cc'),exe=join(directory,'birth.exe'),obj=join(directory,'birth.obj'),log=join(directory,'build.log');
 const header=resolve('packages/local-channel/native/windows-process-birth.h').replaceAll('\\','/');
 writeFileSync(source,`#include <winsock2.h>
#include <windows.h>
#include <string>
#include <stdexcept>
#include <vector>
#include <cstdint>
#include <iostream>
#include "${header}"
static uint64_t actual(HANDLE h){FILETIME c,x,k,u;if(!GetProcessTimes(h,&c,&x,&k,&u))throw std::runtime_error("time");return (uint64_t(c.dwHighDateTime)<<32)|c.dwLowDateTime;}
int wmain(int argc,wchar_t**){
 if(argc>1){Sleep(1500);return 0;}
 try{
  if(kernelProcessBirth(GetCurrentProcessId())!=actual(GetCurrentProcess()))throw std::runtime_error("self");
  bool denied=false;try{kernelProcessBirth(0xffffffff);}catch(...){denied=true;}
  if(!denied)throw std::runtime_error("missing accepted");
  wchar_t file[32768];if(!GetModuleFileNameW(nullptr,file,32768))throw std::runtime_error("path");
  std::wstring command(1,wchar_t(34));command+=file;command+=wchar_t(34);command+=L" --child";
  STARTUPINFOW start{};start.cb=sizeof(start);PROCESS_INFORMATION child{};
  if(!CreateProcessW(file,&command[0],nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&start,&child))throw std::runtime_error("child");
  CloseHandle(child.hThread);
  const auto born=kernelProcessBirth(child.dwProcessId);
  if(born!=actual(child.hProcess)){CloseHandle(child.hProcess);throw std::runtime_error("peer");}
  WaitForSingleObject(child.hProcess,10000);CloseHandle(child.hProcess);
  denied=false;for(unsigned i=0;i<100&&!denied;i++){try{kernelProcessBirth(child.dwProcessId);}catch(...){denied=true;}if(!denied)Sleep(10);}
  if(!denied)throw std::runtime_error("exited accepted");
  std::cout<<"KERNEL_PROCESS_BIRTH=PASS";return 0;
 }catch(const std::exception& e){std::cerr<<e.what();return 1;}
}
`,{flag:'wx'});
 const vcvars=join(installation,'VC','Auxiliary','Build','vcvars64.bat');
 const batch=join(directory,'build.cmd');
 writeFileSync(batch,'@echo off\r\ncall '+String.fromCharCode(34)+vcvars+String.fromCharCode(34)+' >nul\r\nif errorlevel 1 exit /b %errorlevel%\r\ncl.exe /nologo /EHsc /std:c++17 /Fe:'+String.fromCharCode(34)+exe+String.fromCharCode(34)+' /Fo:'+String.fromCharCode(34)+obj+String.fromCharCode(34)+' '+String.fromCharCode(34)+source+String.fromCharCode(34)+' >'+String.fromCharCode(34)+log+String.fromCharCode(34)+' 2>&1\r\nexit /b %errorlevel%\r\n',{flag:'wx'});
 const compiled=spawnSync('cmd.exe',['/d','/c',batch],{encoding:'utf8',windowsHide:true,timeout:90000});
 assert.equal(compiled.status,0,compiled.stdout+compiled.stderr+'\n'+(existsSync(log)?readFileSync(log,'utf8'):'NO_BUILD_LOG'));
 const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'KERNEL_PROCESS_BIRTH=PASS');
});
