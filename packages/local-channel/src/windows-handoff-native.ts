import {spawnSync} from "node:child_process";

// Native operations are closed and called only from privileged code/operator
// tooling. Private key plaintext travels on inherited process pipes, never
// argv, env, logs, renderer, or shared files. No DPAPI LocalMachine fallback.
const script=String.raw`
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
Add-Type -AssemblyName System.Security
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class CamachoReceiverToken {
 [StructLayout(LayoutKind.Sequential)] struct Entry { public IntPtr Sid; public uint Attributes; }
 [StructLayout(LayoutKind.Sequential)] struct Groups { public uint Count; public Entry First; }
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr buffer,int length,out int needed);
 public static string LogonSid(IntPtr token) {
  int needed;
  if(GetTokenInformation(token,2,IntPtr.Zero,0,out needed) || Marshal.GetLastWin32Error()!=122 || needed<=0) throw new Win32Exception();
  IntPtr buffer=Marshal.AllocHGlobal(needed);
  try {
   if(!GetTokenInformation(token,2,buffer,needed,out needed))throw new Win32Exception();
   int count=Marshal.ReadInt32(buffer);if(count<1 || count>1024)throw new InvalidOperationException();
   int offset=Marshal.OffsetOf(typeof(Groups),"First").ToInt32(),size=Marshal.SizeOf(typeof(Entry));
   string result=null;
   for(int i=0;i<count;i++) {
    Entry entry=(Entry)Marshal.PtrToStructure(IntPtr.Add(buffer,offset+i*size),typeof(Entry));
    if((entry.Attributes & 0xc0000000)==0xc0000000) {
     if(result!=null)throw new InvalidOperationException();result=new SecurityIdentifier(entry.Sid).Value;
    }
   }
   if(result==null || !result.StartsWith("S-1-5-5-",StringComparison.Ordinal))throw new InvalidOperationException();
   return result;
  }finally{Marshal.FreeHGlobal(buffer);}
 }
}
'@
$p=[Console]::In.ReadToEnd() | ConvertFrom-Json
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$sid=$id.User.Value
$groups=@($id.Groups | ForEach-Object {$_.Value})
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
if(-not $id.IsAuthenticated){throw 'WINDOWS_TOKEN_REJECTED'}
# The SCM virtual service token may lack an interactive logon SID; no service
# operation consumes a logon SID as authority. Never relax the Desktop check.
if($session -eq 0 -and $id.Name -eq 'NT SERVICE\CamachoPOSLocalService'){
  try{$logon=[CamachoReceiverToken]::LogonSid($id.Token)}catch{$logon=''}
}else{
  $logon=[CamachoReceiverToken]::LogonSid($id.Token)
}
function SafePath([string]$path){
 if(-not [IO.Path]::IsPathRooted($path) -or $path.StartsWith('\\')){throw 'LOCAL_ABSOLUTE_PATH_REQUIRED'}
 $cursor=$path
 while($cursor){
  if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_PATH_REJECTED'}}
  $parent=[IO.Path]::GetDirectoryName($cursor)
  if($parent -eq $cursor){break};$cursor=$parent
 }
}
function CheckAcl([string]$path,[string[]]$writers,[string[]]$readers){
 SafePath $path
 $acl=Get-Acl -LiteralPath $path
 if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $writers){throw 'HANDOFF_OWNER_REJECTED'}
 $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
 foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($ace.AccessControlType -ne 'Allow'){throw 'HANDOFF_COMPLEX_ACL_REJECTED'}
  $who=$ace.IdentityReference.Value
  if($who -notin @($writers+$readers) -or (($ace.FileSystemRights -band $write) -ne 0 -and $who -notin $writers)){throw 'HANDOFF_ACL_REJECTED'}
 }
}
if($p.action -eq 'read-managed'){
 SafePath $p.path
 # Open first, disallow concurrent write/delete, then inspect the held file.
 $stream=New-Object IO.FileStream($p.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{
  if($stream.Length -gt 8388608){throw 'MANAGED_FILE_LIMIT'}
  $acl=$stream.GetAccessControl()
  $trusted=@('S-1-5-18','S-1-5-32-544')
  if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'MANAGED_FILE_OWNER_REJECTED'}
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if($ace.AccessControlType -ne 'Allow' -or (($ace.FileSystemRights -band $write) -ne 0 -and $ace.IdentityReference.Value -notin $trusted)){throw 'MANAGED_FILE_ACL_REJECTED'}
  }
  $cursor=[IO.Path]::GetDirectoryName($p.path)
  $ancestorTrusted=@($trusted+'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $replace=[Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  while($cursor){
   $parentAcl=Get-Acl -LiteralPath $cursor
   if($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $ancestorTrusted){throw 'MANAGED_ANCESTOR_OWNER_REJECTED'}
   foreach($ace in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($ace.AccessControlType -ne 'Allow' -or (($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($ace.FileSystemRights -band $replace) -ne 0 -and $ace.IdentityReference.Value -notin $ancestorTrusted)){throw 'MANAGED_ANCESTOR_ACL_REJECTED'}
   }
   $parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent
  }
  $bytes=New-Object byte[] ([int]$stream.Length);$offset=0
  while($offset -lt $bytes.Length){$read=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($read -le 0){throw 'MANAGED_READ_FAILED'};$offset+=$read}
  [Console]::Write([Convert]::ToBase64String($bytes))
 }finally{$stream.Dispose();if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}}
}elseif($p.action -in @('protect-service-signer','open-service-signer','write-service-signer','read-service-signer')){
 if($id.Name -ne 'NT SERVICE\CamachoPOSLocalService' -or $session -ne 0){throw 'SCM_SIGNER_IDENTITY_REQUIRED'}
 SafePath $p.path
 CheckAcl ([IO.Path]::GetDirectoryName($p.path)) @($sid) @()
 if($p.action -eq 'write-service-signer'){
  $acl=New-Object Security.AccessControl.FileSecurity;$acl.SetOwner($id.User);$acl.SetAccessRuleProtection($true,$false)
  [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id.User,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)))
  $stream=New-Object IO.FileStream($p.path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)
  try{$bytes=[Text.Encoding]::UTF8.GetBytes($p.content);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose();if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}}
  [Console]::Write('OK')
 }elseif($p.action -eq 'read-service-signer'){
  CheckAcl $p.path @($sid) @();if((Get-Item -LiteralPath $p.path).Length -gt 32768){throw 'SIGNER_FILE_LIMIT'}
  [Console]::Write([IO.File]::ReadAllText($p.path))
 }else{
  $sha=[Security.Cryptography.SHA256]::Create();try{$entropy=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($p.context))}finally{$sha.Dispose()}
  $bytes=[Convert]::FromBase64String($p.bytes)
  try{
   if($p.action -eq 'protect-service-signer'){$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
   else{CheckAcl $p.path @($sid) @();$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
   [Console]::Write([Convert]::ToBase64String($result))
  }finally{[Array]::Clear($bytes,0,$bytes.Length);if($result){[Array]::Clear($result,0,$result.Length)}}
 }
}elseif($p.action -eq 'identity'){
 @{sid=$sid;logonSid=$logon;sessionId=$session;interactive=(@($groups | Where-Object {$_ -in @('S-1-5-4','S-1-5-14')}).Count -gt 0);service=($id.Name -eq 'NT SERVICE\CamachoPOSLocalService')} | ConvertTo-Json -Compress
}elseif($p.action -eq 'write-receiver'){
 if($session -eq 0 -or @($groups | Where-Object {$_ -in @('S-1-5-4','S-1-5-14')}).Count -eq 0){throw 'INTERACTIVE_RECEIVER_REQUIRED'}
 SafePath $p.path
 CheckAcl ([IO.Path]::GetDirectoryName($p.path)) @($sid) @()
 $acl=New-Object Security.AccessControl.FileSecurity
 $acl.SetOwner($id.User);$acl.SetAccessRuleProtection($true,$false)
 [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id.User,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)))
 $stream=New-Object IO.FileStream($p.path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)
 try{
  $bytes=[Text.Encoding]::UTF8.GetBytes($p.content);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)
 }finally{$stream.Dispose()}
 [Console]::Write('OK')
}elseif($p.action -eq 'read-receiver'){
 CheckAcl $p.path @($sid) @()
 CheckAcl ([IO.Path]::GetDirectoryName($p.path)) @($sid) @()
 if((Get-Item -LiteralPath $p.path).Length -gt 32768){throw 'RECEIVER_FILE_LIMIT'}
 [Console]::Write([IO.File]::ReadAllText($p.path))
}elseif($p.action -eq 'protect-receiver' -or $p.action -eq 'open-receiver'){
 if($session -eq 0 -or @($groups | Where-Object {$_ -in @('S-1-5-4','S-1-5-14')}).Count -eq 0){throw 'INTERACTIVE_RECEIVER_REQUIRED'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$entropy=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($p.context))}finally{$sha.Dispose()}
 $bytes=[Convert]::FromBase64String($p.bytes)
 try{
  if($p.action -eq 'protect-receiver'){$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
  else{CheckAcl $p.path @($sid) @();$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
  [Console]::Write([Convert]::ToBase64String($result))
 }finally{[Array]::Clear($bytes,0,$bytes.Length);if($result){[Array]::Clear($result,0,$result.Length)}}
}else{throw 'HANDOFF_NATIVE_OPERATION_REJECTED'}
`;

export function handoffNative(input:Readonly<Record<string,unknown>>):string{
  if(process.platform!=="win32")throw Error("WINDOWS_HANDOFF_REQUIRED");
  const value=JSON.stringify(input);
  if(Buffer.byteLength(value)>262144)throw Error("HANDOFF_NATIVE_INPUT_LIMIT");
  const r=spawnSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",script],
    {input:value,encoding:"utf8",windowsHide:true,maxBuffer:12*1024*1024,timeout:15000});
  if(r.error||r.status!==0)throw Error("HANDOFF_NATIVE_REJECTED");
  return r.stdout.trim();
}
export interface WindowsHandoffIdentity{sid:string;logonSid:string;sessionId:number;interactive:boolean;service:boolean}
export function currentHandoffIdentity():WindowsHandoffIdentity{return JSON.parse(handoffNative({action:"identity"}));}
