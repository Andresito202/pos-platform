#requires -Version 5.1
# Handle-based ACLs for directory junctions ONLY. Never Set-Acl a link path.
function Initialize-JunctionNative([string]$tempDirectory){
 if('CamachoScmJunction.Handle' -as [type]){return}
 $source=@'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
namespace CamachoScmJunction {
 public sealed class Snapshot {
  public string Identity, Target, ReparseHash, Owner, Dacl;
  public uint Tag;
 }
 public sealed class Handle : IDisposable {
  SafeFileHandle handle;
  const uint ReadControl=0x20000, WriteDac=0x40000, ReadAttributes=0x80;
  const uint Flags=0x02200000, MountPoint=0xA0000003;
  [StructLayout(LayoutKind.Sequential)] struct Info {
   public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written;
   public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct SidAndAttributes {public IntPtr Sid;public uint Attributes;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle h,uint code,IntPtr input,uint length,byte[] output,uint outputLength,out uint returned,IntPtr overlap);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(IntPtr h,uint type,uint parts,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr sd);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr sd,out bool present,out IntPtr dacl,out bool defaulted);
  [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(IntPtr h,uint type,uint parts,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr old,uint flags,uint disabledCount,IntPtr disabled,uint privilegesCount,IntPtr privileges,uint restrictedCount,ref SidAndAttributes restricted,out IntPtr token);
  static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
  public Handle(string path,bool write) {
   handle=CreateFileW(path,ReadControl|ReadAttributes|(write?WriteDac:0),1,IntPtr.Zero,3,Flags,IntPtr.Zero);
   if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
   try{Read();}catch{handle.Dispose();throw;}
  }
  public Snapshot Read(){
   Info info;Check(GetFileInformationByHandle(handle,out info));
   if((info.Attributes&0x410)!=0x410)throw new InvalidOperationException("JUNCTION_KIND_REJECTED");
   byte[] data=new byte[16384];uint count;
   Check(DeviceIoControl(handle,0x900A8,IntPtr.Zero,0,data,(uint)data.Length,out count,IntPtr.Zero));
   uint tag=BitConverter.ToUInt32(data,0);
   if(tag!=MountPoint||count<16)throw new InvalidOperationException("JUNCTION_TAG_REJECTED");
   int offset=BitConverter.ToUInt16(data,8),length=BitConverter.ToUInt16(data,10);
   if((length&1)!=0||16+offset+length>count)throw new InvalidOperationException("JUNCTION_DATA_REJECTED");
   string target=System.Text.Encoding.Unicode.GetString(data,16+offset,length);
   if(target.StartsWith(@"\??\",StringComparison.Ordinal))target=target.Substring(4);
   if(target.Length<3||target[1]!=':'||target[2]!='\\')throw new InvalidOperationException("JUNCTION_TARGET_FORMAT_REJECTED");
   IntPtr owner,group,dacl,sacl,descriptor;
   uint error=GetSecurityInfo(handle.DangerousGetHandle(),1,5,out owner,out group,out dacl,out sacl,out descriptor);
   if(error!=0)throw new Win32Exception((int)error);
   RawSecurityDescriptor sd;
   try{byte[] bytes=new byte[GetSecurityDescriptorLength(descriptor)];Marshal.Copy(descriptor,bytes,0,bytes.Length);sd=new RawSecurityDescriptor(bytes,0);}
   finally{LocalFree(descriptor);}
   if(sd.DiscretionaryAcl==null)throw new InvalidOperationException("JUNCTION_NULL_DACL_REJECTED");
   string hash;
   using(SHA256 sha=SHA256.Create()){hash=BitConverter.ToString(sha.ComputeHash(data,0,(int)count)).Replace("-","").ToLowerInvariant();}
   return new Snapshot{Identity=info.Volume.ToString("x8")+":"+info.IndexHigh.ToString("x8")+info.IndexLow.ToString("x8"),
    Tag=tag,Target=target,ReparseHash=hash,Owner=sd.Owner.Value,Dacl=sd.GetSddlForm(AccessControlSections.Access)};
  }
  public void SetDacl(string sddl){
   RawSecurityDescriptor sd=new RawSecurityDescriptor(sddl);byte[] bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);
   IntPtr buffer=Marshal.AllocHGlobal(bytes.Length);
   try{
    Marshal.Copy(bytes,0,buffer,bytes.Length);bool present,defaulted;IntPtr dacl;
    Check(GetSecurityDescriptorDacl(buffer,out present,out dacl,out defaulted));
    if(!present||dacl==IntPtr.Zero)throw new InvalidOperationException("JUNCTION_NULL_DACL_REJECTED");
    uint protection=(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0?0x80000000u:0x20000000u;
    uint error=SetSecurityInfo(handle.DangerousGetHandle(),1,4|protection,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);
    if(error!=0)throw new Win32Exception((int)error);
   }finally{Marshal.FreeHGlobal(buffer);}
  }
  // Diagnostic model, NOT a real SCM token: normal rights AND restricting SID
  // must both pass Windows' access checks. Used only for read-only diagnostics.
  public static int RestrictedReadAttributes(string path,string sid,bool noFollow){
   IntPtr old=IntPtr.Zero,restricted=IntPtr.Zero,sidPointer=IntPtr.Zero;
   try{
    Check(OpenProcessToken(GetCurrentProcess(),0xE,out old));
    Check(ConvertStringSidToSidW(sid,out sidPointer));
    SidAndAttributes entry=new SidAndAttributes{Sid=sidPointer,Attributes=0};
    Check(CreateRestrictedToken(old,1,0,IntPtr.Zero,0,IntPtr.Zero,1,ref entry,out restricted));
    using(WindowsImpersonationContext context=WindowsIdentity.Impersonate(restricted)){
     using(SafeFileHandle file=CreateFileW(path,ReadAttributes,7,IntPtr.Zero,3,noFollow?Flags:0x02000000,IntPtr.Zero)){
      return file.IsInvalid?Marshal.GetLastWin32Error():0;
     }
    }
   }finally{if(restricted!=IntPtr.Zero)CloseHandle(restricted);if(old!=IntPtr.Zero)CloseHandle(old);if(sidPointer!=IntPtr.Zero)LocalFree(sidPointer);}
  }
  public void Dispose(){handle.Dispose();}
 }
}
'@
 $parameters=[CodeDom.Compiler.CompilerParameters]::new()
 $parameters.GenerateInMemory=$true
 [void]$parameters.ReferencedAssemblies.Add('System.dll')
 [void]$parameters.ReferencedAssemblies.Add('System.Core.dll')
 if($tempDirectory){$parameters.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($tempDirectory,$false)}
 Add-Type -TypeDefinition $source -Language CSharp -CompilerParameters $parameters -ErrorAction Stop
}
function JunctionRead([string]$path){
 $handle=[CamachoScmJunction.Handle]::new($path,$false)
 try{return $handle.Read()}finally{$handle.Dispose()}
}
function JunctionPaths([string]$payload,$entry){
 $root=[IO.Path]::GetFullPath($payload).TrimEnd('\')
 $path=[IO.Path]::GetFullPath($entry.Path)
 $target=[IO.Path]::GetFullPath($entry.Target)
 RuntimeMust ($path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -and $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'JUNCTION_OUTSIDE_PAYLOAD'
 RuntimeNoReparse ([IO.Path]::GetDirectoryName($path))
 RuntimeNoReparse $target
}
function JunctionValidate([string]$payload,$entry,$snapshot){
 JunctionPaths $payload $entry
 $target=[IO.Path]::GetFullPath($entry.Target)
 RuntimeMust ($snapshot.Target -ieq $target) 'JUNCTION_TARGET_CHANGED'
 if($entry.PSObject.Properties.Name -contains 'Identity'){
  RuntimeMust ($snapshot.Identity -ceq $entry.Identity -and $snapshot.ReparseHash -ceq $entry.ReparseHash) 'JUNCTION_CUSTODY_CHANGED'
 }
 RuntimeMust ($snapshot.Owner -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'JUNCTION_OWNER_REJECTED'
}
function JunctionDesired($snapshot){
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetSecurityDescriptorSddlForm($snapshot.Dacl,[Security.AccessControl.AccessControlSections]::Access)
 $acl.SetAccessRuleProtection($true,$false)
 foreach($ace in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($ace)}
 # All ACEs have InheritanceFlags.None: never propagate through the junction.
 foreach($ace in (RuntimeAcl $false).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$acl.AddAccessRule($ace)}
 return $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
}
function JunctionPreflight($snapshot){
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetSecurityDescriptorSddlForm($snapshot.Dacl,[Security.AccessControl.AccessControlSections]::Access)
 foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  RuntimeMust ($ace.AccessControlType -ne 'Deny') 'JUNCTION_DENY_REQUIRES_REVIEW'
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000 -bor 0x40000000
  if(($ace.FileSystemRights -band $write) -ne 0){RuntimeMust ($ace.IdentityReference.Value -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'JUNCTION_EXISTING_WRITER_REJECTED'}
 }
}
function JunctionPlan([string]$attempt){
 $payload=Join-Path $attempt 'payload'
 $manifest=Get-Content -LiteralPath (Join-Path $attempt 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 return @(foreach($file in $manifest.files){
  if($file.type -eq 'link'){
   $entry=[pscustomobject]@{Path=[IO.Path]::GetFullPath((Join-Path $payload $file.path));Target=[IO.Path]::GetFullPath((Join-Path $payload $file.target))}
   RuntimeMust ($file.PSObject.Properties.Name -contains 'linkText') 'JUNCTION_MANIFEST_POLICY_REQUIRED'
   RuntimeMust ($file.linkText -ieq $file.target) 'JUNCTION_CHAIN_REQUIRES_REVIEW'
   JunctionPaths $payload $entry
   $snapshot=JunctionRead $entry.Path
   JunctionValidate $payload $entry $snapshot
   JunctionPreflight $snapshot
   $parentAcl=Get-Acl -LiteralPath ([IO.Path]::GetDirectoryName($entry.Path))
   [pscustomobject]@{ParentBefore=$parentAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access);ParentOwner=$parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value;Path=$entry.Path;Target=$entry.Target;Identity=$snapshot.Identity;ReparseHash=$snapshot.ReparseHash;Owner=$snapshot.Owner;Before=$snapshot.Dacl;Expected=(JunctionDesired $snapshot)}
  }
 })
}
function JunctionWriteDacl($handle,[string]$dacl){$handle.SetDacl($dacl)}
function JunctionSeal([string]$payload,[object[]]$entries,[string]$journal){
 $json=ConvertTo-Json -InputObject @($entries) -Depth 6
 $stream=[IO.File]::Open($journal,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes($json);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
 foreach($entry in $entries){
  JunctionPaths $payload $entry
  $handle=[CamachoScmJunction.Handle]::new($entry.Path,$true)
  try{
   $before=$handle.Read();JunctionValidate $payload $entry $before
   RuntimeMust ($before.Owner -eq $entry.Owner -and $before.Dacl -ceq $entry.Before) 'JUNCTION_CONCURRENT_ACL_CHANGE'
   if($before.Dacl -ceq $entry.Expected){continue}
   JunctionWriteDacl $handle $entry.Expected
   $after=$handle.Read();JunctionValidate $payload $entry $after
   RuntimeMust ($after.Owner -eq $entry.Owner -and $after.Dacl -ceq $entry.Expected) 'JUNCTION_POSTWRITE_UNVERIFIED'
  }finally{$handle.Dispose()}
 }
}
function JunctionVerify([string]$payload,[object[]]$entries){
 foreach($entry in $entries){
  JunctionPaths $payload $entry
  $snapshot=JunctionRead $entry.Path;JunctionValidate $payload $entry $snapshot
  RuntimeMust ($snapshot.Owner -eq $entry.Owner -and $snapshot.Dacl -ceq $entry.Expected) 'JUNCTION_RX_UNVERIFIED'
 }
}
function JunctionRestore([string]$attempt,[string]$journal){
 $entries=Get-Content -LiteralPath $journal -Raw -Encoding UTF8 | ConvertFrom-Json
 $entries=@($entries);$ok=$true
 for($i=$entries.Count-1;$i -ge 0;$i--){
  $entry=$entries[$i]
  try{
   JunctionPaths (Join-Path $attempt 'payload') $entry
   $parentAcl=Get-Acl -LiteralPath ([IO.Path]::GetDirectoryName($entry.Path))
   RuntimeMust ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $entry.ParentOwner -and $parentAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $entry.ParentBefore) 'JUNCTION_RECOVERY_PARENT_CHANGED'
   $handle=[CamachoScmJunction.Handle]::new($entry.Path,$true)
   try{
    $current=$handle.Read();JunctionValidate (Join-Path $attempt 'payload') $entry $current
    RuntimeMust ($current.Owner -eq $entry.Owner) 'JUNCTION_RECOVERY_OWNER_CHANGED'
    if($current.Dacl -ceq $entry.Before){continue}
    RuntimeMust ($current.Dacl -ceq $entry.Expected) 'JUNCTION_RECOVERY_CONCURRENT_ACL'
    JunctionWriteDacl $handle $entry.Before
    $after=$handle.Read();JunctionValidate (Join-Path $attempt 'payload') $entry $after
    RuntimeMust ($after.Owner -eq $entry.Owner -and $after.Dacl -ceq $entry.Before) 'JUNCTION_RECOVERY_UNVERIFIED'
   }finally{$handle.Dispose()}
  }catch{$ok=$false;Write-Host ('JUNCTION_RECOVERY_REQUIRES_REVIEW='+$entry.Path)}
 }
 return $ok
}
