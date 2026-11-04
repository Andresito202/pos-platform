#requires -Version 5.1
<# Protect only the lab authority DIRECTORY from inherited permission changes.
Preserve every existing ACE, owner and permission; never grant access, recurse,
change key contents, start SCM or alter the physical Windows host.
#>
[CmdletBinding()]
param(
 [string]$LabRoot='C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046',
 [switch]$Run
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not $Run){Write-Output 'LAB_AUTHORITY_ACL_NO_ACTION';exit 0}
if($LabRoot -cne 'C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046'){throw 'LAB_AUTHORITY_ACL_SCOPE_REJECTED'}
$os=Get-CimInstance Win32_OperatingSystem
if($os.ProductType -eq 1 -or $os.BuildNumber -ne '20348' -or $env:COMPUTERNAME -ne 'WIN-QH2KNH6JRL3'){throw 'LAB_AUTHORITY_ACL_SERVER_VM_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $identity.IsAuthenticated -or $identity.IsSystem -or
 [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0 -or
 -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'LAB_AUTHORITY_ACL_INTERACTIVE_ADMIN_REQUIRED'}
$target=Join-Path $LabRoot 'central-lab\authority'
$results=Join-Path $LabRoot 'results'
foreach($path in @($target,$results)){
 $item=Get-Item -LiteralPath $path
 if(-not $item.PSIsContainer){throw 'LAB_AUTHORITY_ACL_DIRECTORY_REJECTED'}
 $ancestor=$item
 while($null -ne $ancestor){
  if($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'LAB_AUTHORITY_ACL_DIRECTORY_REJECTED'}
  $ancestor=$ancestor.Parent
 }
}
function RuleFingerprint($descriptor){
 $rows=@($descriptor.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
  '{0}|{1}|{2}|{3}|{4}' -f $_.IdentityReference.Value,[int64]$_.FileSystemRights,$_.InheritanceFlags,$_.PropagationFlags,$_.AccessControlType
 } | Sort-Object)
 return ($rows -join "`n")
}
$acl=Get-Acl -LiteralPath $target
$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$allowed=@('S-1-5-18','S-1-5-32-544',$identity.User.Value)
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($owner -ne 'S-1-5-32-544' -or $rules.Count -ne 3 -or
 @($rules | Where-Object {$_.AccessControlType -ne 'Allow' -or
  $_.IdentityReference.Value -notin $allowed -or $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl}).Count -ne 0 -or
 @($rules | ForEach-Object {$_.IdentityReference.Value} | Sort-Object -Unique).Count -ne 3){throw 'LAB_AUTHORITY_ACL_UNEXPECTED_RIGHTS_PRESERVED'}
if($acl.AreAccessRulesProtected){Write-Output 'LAB_AUTHORITY_ACL=UNCHANGED_PROTECTED';exit 0}
$originalSddl=$acl.Sddl
$fingerprint=RuleFingerprint $acl
$backup=Join-Path $results ('authority-acl-before-'+[guid]::NewGuid().ToString('N')+'.sddl.txt')
$stream=[IO.File]::Open($backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$bytes=[Text.Encoding]::UTF8.GetBytes($originalSddl);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
# Stop before writing if an operator changed the descriptor while it was backed up.
if((Get-Acl -LiteralPath $target).Sddl -cne $originalSddl){throw 'LAB_AUTHORITY_ACL_CONCURRENT_CHANGE_PRESERVED'}
$acl.SetAccessRuleProtection($true,$true)
$expectedSddl=$acl.Sddl
try{
 Set-Acl -LiteralPath $target -AclObject $acl
 $after=Get-Acl -LiteralPath $target
 if(-not $after.AreAccessRulesProtected -or $after.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner -or
  (RuleFingerprint $after) -cne $fingerprint){throw 'LAB_AUTHORITY_ACL_POSTCONDITION_FAILED'}
 Write-Output 'LAB_AUTHORITY_ACL=PROTECTED_SAME_PERMISSIONS'
 Write-Output ('LAB_AUTHORITY_ACL_BACKUP='+$backup)
}catch{
 # Restore only if the current descriptor is exactly our attempted write.
 # Unexpected/concurrent security changes are preserved for explicit review.
 $current=Get-Acl -LiteralPath $target
 if($current.Sddl -ceq $expectedSddl){
  $current.SetSecurityDescriptorSddlForm($originalSddl,[Security.AccessControl.AccessControlSections]::Access)
  Set-Acl -LiteralPath $target -AclObject $current
  Write-Output 'LAB_AUTHORITY_ACL_ORIGINAL_RESTORED'
 }
 Write-Output ('LAB_AUTHORITY_ACL_BACKUP='+$backup)
 throw 'LAB_AUTHORITY_ACL_FAILED_STOP_AND_REVIEW'
}
