#requires -Version 5.1
<#
 .SYNOPSIS
   Minimal lab-only pnpm dependency ACL repair for the Windows SCM virtual account.
 .DESCRIPTION
   No recursive icacls /T, no symlink traversal, no ownership/deny changes.
   Adds only (RX) inherited grants to real directories and explicit (RX)
   to vitest.mjs and dist\cli.js even when their DACLs block inheritance.
   This is NOT an installer/production ACL. Runs only on the dedicated VM.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Repository,
 [Parameter(Mandatory=$true)][string]$LabRoot,
 [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-scm-lab-binding.ps1')
$service='CamachoPOSLocalService'
$serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
function Assert([bool]$condition,[string]$code){if(-not $condition){throw $code}}
function Within([string]$candidate,[string]$parent){
 $a=[IO.Path]::GetFullPath($candidate)
 $b=[IO.Path]::GetFullPath($parent).TrimEnd('\')+'\'
 return $a.StartsWith($b,[StringComparison]::OrdinalIgnoreCase)
}
function ResolveVitestPath([string]$node,[string]$link){
 # PowerShell 5.1 strips embedded quotes from native -e arguments. Pass code
 # through stdin instead; argv[1] is '-' and the sole path is argv[2].
 # Return UTF-8 as base64: native stdout decoding under an OEM code page must
 # not corrupt a real pnpm path containing non-ASCII characters.
 $real=@('process.stdout.write(Buffer.from(require("node:fs").realpathSync.native(process.argv[2]),"utf8").toString("base64"))' | & $node - $link)
 Assert ($LASTEXITCODE -eq 0 -and $real.Count -eq 1) 'VITEST_CANONICAL_RESOLUTION_FAILED'
 $utf8=[Text.UTF8Encoding]::new($false,$true)
 return [IO.Path]::GetFullPath($utf8.GetString([Convert]::FromBase64String($real[0])))
}
function AssertPnpmPath([string]$path,[string]$store){
 $path=[IO.Path]::GetFullPath($path)
 $store=[IO.Path]::GetFullPath($store).TrimEnd('\')
 Assert ($path -ieq $store -or (Within $path $store)) 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'
 # Inspect from the store down before following an unexpected junction.
 $cursor=$store
 $paths=[System.Collections.Generic.List[string]]::new()
 [void]$paths.Add($cursor)
 if($path -ine $store){
  foreach($part in $path.Substring($store.Length).TrimStart('\').Split('\')){
   $cursor=Join-Path $cursor $part
   [void]$paths.Add($cursor)
  }
 }
 foreach($candidate in $paths){
  $item=Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
  Assert (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PNPM_REPARSE_CUSTODY_REJECTED'
 }
}
function NewVitestReadPlan([string]$node,[string]$store,[string]$entry){
 $entry=[IO.Path]::GetFullPath($entry)
 AssertPnpmPath $entry $store
 Assert ([IO.Path]::GetFileName($entry) -ieq 'vitest.mjs') 'VITEST_ENTRY_NAME_REJECTED'
 $cli=Join-Path ([IO.Path]::GetDirectoryName($entry)) 'dist\cli.js'
 AssertPnpmPath $cli $store
 $realCli=ResolveVitestPath $node $cli
 Assert (Within $realCli $store) 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'
 Assert ($realCli -ieq $cli) 'VITEST_CLI_CANONICAL_PATH_CHANGED'
 Write-Host ('CANONICAL_VITEST_CLI='+$realCli)
 $plan=[System.Collections.Generic.List[object]]::new()
 foreach($file in @($entry,$realCli)){
  $cursor=$store
  $parts=$file.Substring($store.Length).TrimStart('\').Split('\')
  if(-not (@($plan | ForEach-Object {$_.Path}) -contains $cursor)){[void]$plan.Add([pscustomobject]@{Path=$cursor;Directory=$true})}
  for($i=0;$i -lt $parts.Length-1;$i++){
   $cursor=Join-Path $cursor $parts[$i]
   if(-not (@($plan | ForEach-Object {$_.Path}) -contains $cursor)){[void]$plan.Add([pscustomobject]@{Path=$cursor;Directory=$true})}
  }
  [void]$plan.Add([pscustomobject]@{Path=$file;Directory=$false})
 }
 foreach($item in $plan){[void](InspectRead $item.Path $item.Directory)}
 return $plan.ToArray()
}
function InspectRead([string]$path,[bool]$directory){
 if($null -ne $script:physicalStore){AssertPnpmPath $path $script:physicalStore}
 $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
 Assert (-not (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) 'PNPM_REPARSE_CUSTODY_REJECTED'
 Assert ($item.PSIsContainer -eq $directory) 'PNPM_OBJECT_KIND_CHANGED'
 $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
 $rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute
 $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
 $inherit=if($directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
 $exists=$false
 foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   # These groups are applicable to an authenticated local SCM service. Other
   # token-specific denies still require the real SCM execution below the gate.
   if($ace.IdentityReference.Value -in @($serviceSid,'S-1-1-0','S-1-5-11','S-1-5-6','S-1-2-0') -and $ace.AccessControlType -eq 'Deny' -and
      ($ace.FileSystemRights -band $rights) -ne 0){throw 'PNPM_EXPLICIT_DENY_REQUIRES_REVIEW'}
   if($ace.IdentityReference.Value -eq $serviceSid -and $ace.AccessControlType -eq 'Allow' -and
      ($ace.FileSystemRights -band $write) -ne 0){throw 'PNPM_EXISTING_SERVICE_WRITE_REQUIRES_REVIEW'}
   if($ace.IdentityReference.Value -eq $serviceSid -and $ace.AccessControlType -eq 'Allow' -and
      ($ace.FileSystemRights -band $rights) -eq $rights -and
      ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
      (-not $directory -or ($ace.InheritanceFlags -band $inherit) -eq $inherit)){$exists=$true}
 }
 return [pscustomobject]@{Path=$path;Directory=$directory;Acl=$acl;NeedsGrant=(-not $exists)}
}
function GrantRead([string]$path,[bool]$directory){
 $inspection=InspectRead $path $directory
 if(-not $inspection.NeedsGrant){Write-Host ('PNPM_RX_ALREADY_PRESENT='+$path);return}
 if(-not $Apply){Write-Host ('PNPM_RX_REQUIRED='+$path);return}
 $acl=$inspection.Acl
 $sid=[Security.Principal.SecurityIdentifier]::new($serviceSid)
 $rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute
 $inherit=if($directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
 $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,$inherit,
   [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
 $before=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
 $acl.AddAccessRule($rule)
 $expected=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
 # Record before Set-Acl: an exception does not guarantee that nothing changed.
 $change=[pscustomobject]@{Path=$path;Directory=$directory;Before=$before;Expected=$expected;After=$null}
 [void]$script:aclChanges.Add($change)
 SaveJournal 'APPLYING'
 # Revalidate custody and the exact DACL after journaling, before the write.
 $current=InspectRead $path $directory
 Assert ($current.Acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $before) 'PNPM_CONCURRENT_ACL_CHANGE_NOT_OVERWRITTEN'
 Set-Acl -LiteralPath $path -AclObject $acl -ErrorAction Stop
 $effective=InspectRead $path $directory
 Assert (-not $effective.NeedsGrant) 'PNPM_RX_POSTWRITE_UNVERIFIED'
 $change.After=$effective.Acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
 SaveJournal 'APPLYING'
 Write-Host ('PNPM_RX_GRANTED='+$path)
}
function SaveJournal([string]$state){
 if($null -eq $script:journalPath){return}
 $value=[ordered]@{version=1;state=$state;effective_service_access='NOT_PROVEN';changes=@($script:aclChanges.ToArray())}
 [IO.File]::WriteAllText($script:journalPath,(ConvertTo-Json -InputObject $value -Depth 6),[Text.UTF8Encoding]::new($false))
}
function UndoReadChanges{
 $ok=$true
 for($i=$script:aclChanges.Count-1;$i -ge 0;$i--){
  $change=$script:aclChanges[$i]
  try{
   if($null -ne $script:physicalStore){AssertPnpmPath $change.Path $script:physicalStore}
   $item=Get-Item -LiteralPath $change.Path -Force -ErrorAction Stop
   Assert (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PNPM_ROLLBACK_REPARSE_REJECTED'
   Assert ($item.PSIsContainer -eq $change.Directory) 'PNPM_OBJECT_KIND_CHANGED'
   $acl=Get-Acl -LiteralPath $change.Path -ErrorAction Stop
   $now=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
   if($now -eq $change.Before){continue}
   $owned=if($null -eq $change.After){$change.Expected}else{$change.After}
   Assert ($now -eq $owned) 'PNPM_CONCURRENT_ACL_CHANGE_NOT_OVERWRITTEN'
   $acl.SetSecurityDescriptorSddlForm($change.Before,[Security.AccessControl.AccessControlSections]::Access)
   Set-Acl -LiteralPath $change.Path -AclObject $acl -ErrorAction Stop
   $restored=(Get-Acl -LiteralPath $change.Path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
   Assert ($restored -eq $change.Before) 'PNPM_ROLLBACK_UNVERIFIED'
  }catch{$ok=$false;Write-Host 'PNPM_ROLLBACK_PATH_REQUIRES_OPERATOR_REVIEW'}
 }
 return $ok
}
$script:aclChanges=[System.Collections.Generic.List[object]]::new()
$script:journalPath=$null
$script:physicalStore=$null
try{
 Assert ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitOperatingSystem) 'WINDOWS_X64_REQUIRED'
 $machine=Get-CimInstance Win32_ComputerSystem
 Assert (($machine.Manufacturer+' '+$machine.Model) -match '(?i)virtual|hyper-v|vmware|virtualbox|qemu|kvm') 'VM_REQUIRED'
 $root=[IO.Path]::GetFullPath($Repository).TrimEnd('\')
 Assert ($root -ieq 'C:\CamachoLab\pos-platform') 'REPO_NOT_LAB'
 $lab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
 Assert ($lab -match '(?i)^C:\\CamachoPosScmLab\\[0-9a-f]{32}$') 'LAB_ROOT_REJECTED'
 Assert (Test-Path -LiteralPath $lab -PathType Container) 'LAB_MISSING'
 $svc=Get-CimInstance Win32_Service -Filter "Name='$service'"
 Assert ($null -ne $svc -and $svc.State -eq 'Stopped' -and $svc.StartMode -eq 'Manual' -and
   $svc.StartName -eq ('NT SERVICE\'+$service)) 'SERVICE_UNSAFE'
 Assert (Test-WindowsScmLabImagePath $svc.PathName (Join-Path $lab 'service\CamachoPOSLocalService.exe')) 'SCM_LAB_IMAGE_PATH_MISMATCH'
 $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 Assert ($admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'ADMIN_REQUIRED'
 $pnpmStore=Join-Path $root 'node_modules\.pnpm'
 Assert (Test-Path -LiteralPath $pnpmStore -PathType Container) 'PNPM_STORE_NOT_FOUND'
 Assert (-not ((Get-Item -LiteralPath $pnpmStore -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PNPM_STORE_REPARSE_REJECTED'
 $vitestLink=Join-Path $root 'apps\pos-local-service\node_modules\vitest\vitest.mjs'
 Assert (Test-Path -LiteralPath $vitestLink -PathType Leaf) 'VITEST_LINK_NOT_FOUND'
 $node='C:\Program Files\nodejs\node.exe'
 Assert (Test-Path -LiteralPath $node -PathType Leaf) 'NODE_MISSING'
 # Node resolves pnpm junctions using exactly the same filesystem semantics
 # that the service runtime uses. Do not recurse over dangling junctions.
 $realVitest=ResolveVitestPath $node $vitestLink
 Assert (Within $realVitest $pnpmStore) 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'
 Assert (Test-Path -LiteralPath $realVitest -PathType Leaf) 'REAL_VITEST_MISSING'
 Write-Host ('CANONICAL_VITEST='+$realVitest)
 $script:physicalStore=$pnpmStore
 $plan=@(NewVitestReadPlan $node $pnpmStore $realVitest)
 # Validate the whole bounded plan before the first write. No directory walk,
 # recursion, link traversal, private custody or repository-wide write grant.
 foreach($entry in $plan){[void](InspectRead $entry.Path $entry.Directory)}
 if($Apply){
  $results=Join-Path $lab 'results'
  Assert (Test-Path -LiteralPath $results -PathType Container) 'PNPM_RESULTS_DIRECTORY_MISSING'
  Assert (-not ((Get-Item -LiteralPath $results -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PNPM_RESULTS_REPARSE_REJECTED'
  $script:journalPath=Join-Path $results ('dependency-acl-'+[guid]::NewGuid().ToString('N')+'.json')
  $stream=[IO.File]::Open($script:journalPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$stream.Dispose()
  SaveJournal 'PLANNED'
 }
 foreach($entry in $plan){GrantRead $entry.Path $entry.Directory}
 SaveJournal 'APPLIED_ACL_VERIFIED_NOT_SERVICE_TOKEN'
 Write-Host ('PNPM_RX_REPAIR='+$(if($Apply){'APPLIED'}else{'DRY_RUN'}))
 Write-Host 'SERVICE_EFFECTIVE_ACCESS=NOT_PROVEN_UNTIL_REAL_SCM_RUN'
}catch{
 if($script:aclChanges.Count -gt 0){
  $rollback=UndoReadChanges
  try{SaveJournal $(if($rollback){'ROLLED_BACK_DIRECT_PATHS'}else{'ROLLBACK_REQUIRES_REVIEW'})}catch{Write-Host 'PNPM_JOURNAL_RECOVERY_REQUIRES_REVIEW'}
  Write-Host ('PNPM_DIRECT_PATH_ROLLBACK='+$rollback)
 }
 Write-Host ('PNPM_RX_REPAIR_FAILED='+$_.Exception.Message)
 exit 2
}
