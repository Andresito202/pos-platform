#requires -Version 5.1
<#
 .SYNOPSIS
   Minimal lab-only pnpm dependency ACL repair for the Windows SCM virtual account.
 .DESCRIPTION
   No recursive icacls /T, no symlink traversal, no ownership/deny changes.
   Adds only (RX) inherited grants to real directories and explicit (RX)
   to the actual Vitest entrypoint if its DACL blocks inheritance.
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
$service='CamachoPOSLocalService'
$serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
function Assert([bool]$condition,[string]$code){if(-not $condition){throw $code}}
function Within([string]$candidate,[string]$parent){
 $a=[IO.Path]::GetFullPath($candidate)
 $b=[IO.Path]::GetFullPath($parent).TrimEnd('\')+'\'
 return $a.StartsWith($b,[StringComparison]::OrdinalIgnoreCase)
}
function GrantRead([string]$path,[bool]$directory){
 $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
 Assert (-not (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) 'PNPM_REPARSE_CUSTODY_REJECTED'
 $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
 $sid=[Security.Principal.SecurityIdentifier]::new($serviceSid)
 $rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute
 $inherit=if($directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
 $exists=$false
 foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if($ace.IdentityReference.Value -eq $serviceSid -and $ace.AccessControlType -eq 'Deny' -and
      ($ace.FileSystemRights -band $rights) -ne 0){throw 'PNPM_EXPLICIT_DENY_REQUIRES_REVIEW'}
   if($ace.IdentityReference.Value -eq $serviceSid -and $ace.AccessControlType -eq 'Allow' -and
      ($ace.FileSystemRights -band $rights) -eq $rights -and
      (-not $directory -or ($ace.InheritanceFlags -band $inherit) -eq $inherit)){$exists=$true}
 }
 if($exists){Write-Host ('PNPM_RX_ALREADY_PRESENT='+$path);return}
 if(-not $Apply){Write-Host ('PNPM_RX_REQUIRED='+$path);return}
 $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,$inherit,
   [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
 $acl.AddAccessRule($rule)
 Set-Acl -LiteralPath $path -AclObject $acl -ErrorAction Stop
 $effective=Get-Acl -LiteralPath $path -ErrorAction Stop
 Assert (@($effective.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) |
    Where-Object {$_.IdentityReference.Value -eq $serviceSid -and $_.AccessControlType -eq 'Allow' -and
       ($_.FileSystemRights -band $rights) -eq $rights}).Count -gt 0) 'PNPM_RX_POSTWRITE_UNVERIFIED'
 Write-Host ('PNPM_RX_GRANTED='+$path)
}
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
 $real=@(& $node -e 'process.stdout.write(require("node:fs").realpathSync.native(process.argv[1]))' $vitestLink)
 Assert ($LASTEXITCODE -eq 0 -and $real.Count -eq 1) 'VITEST_CANONICAL_RESOLUTION_FAILED'
 $realVitest=[IO.Path]::GetFullPath($real[0])
 Assert (Within $realVitest $pnpmStore) 'VITEST_OUTSIDE_PNPM_STORE_REJECTED'
 Assert (Test-Path -LiteralPath $realVitest -PathType Leaf) 'REAL_VITEST_MISSING'
 Write-Host ('CANONICAL_VITEST='+$realVitest)
 # Nonrecursive, bounded set of concrete physical ancestors. No /T.
 GrantRead $pnpmStore $true
 $relative=$realVitest.Substring($pnpmStore.Length).TrimStart('\')
 $cursor=$pnpmStore
 $parts=$relative.Split('\')
 for($i=0;$i -lt $parts.Length-1;$i++){
   $cursor=Join-Path $cursor $parts[$i]
   Assert (Within $cursor $pnpmStore) 'PNPM_PATH_ESCAPES_ROOT'
   Assert (Test-Path -LiteralPath $cursor -PathType Container) 'PNPM_ANCESTOR_MISSING'
   GrantRead $cursor $true
 }
 GrantRead $realVitest $false
 Write-Host ('PNPM_RX_REPAIR='+$(if($Apply){'APPLIED'}else{'DRY_RUN'}))
 Write-Host 'SERVICE_EFFECTIVE_ACCESS=NOT_PROVEN_UNTIL_REAL_SCM_RUN'
}catch{
 Write-Host ('PNPM_RX_REPAIR_FAILED='+$_.Exception.Message)
 exit 2
}
