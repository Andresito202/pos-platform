#requires -Version 5.1
<#
One-command fail-closed five-phase SCM readiness for isolated PR #99 Windows VM.
No private keys or trust roots are manufactured; no interactive login is launched.
-RunPhysical delegates to the existing Node/Electron one-shot only after readiness.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$LabRoot,[switch]$RunPhysical)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$blocks=[System.Collections.Generic.List[string]]::new()
function Gate([string]$name,[bool]$passed){
 if($passed){Write-Host ($name+'=PASS')}else{
  Write-Host ($name+'=BLOCKED');[void]$script:blocks.Add($name)
 }
}
function FileExists([string]$path){return (Test-Path -LiteralPath $path -PathType Leaf)}
function Custody([string]$path,[string]$sid){
 if(-not (Test-Path -LiteralPath $path -PathType Container)){return $false}
 $acl=Get-Acl -LiteralPath $path
 if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){return $false}
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($rules.Count -eq 0){return $false}
 foreach($r in $rules){
  if($r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Value -ne $sid){return $false}
 }
 return $true
}
function Managed([string]$path,[string]$role){
 if(-not (FileExists $path)){return $false}
 try {
  $file=Get-Item -LiteralPath $path
  if($file.Length -gt 131072){return $false}
  $acl=Get-Acl -LiteralPath $path
  $trusted=@('S-1-5-18','S-1-5-32-544')
  if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){return $false}
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach($ace in @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){
   if($ace.AccessControlType -ne 'Allow' -or (($ace.FileSystemRights -band $write) -ne 0 -and $ace.IdentityReference.Value -notin $trusted)){return $false}
  }
  $p=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
  if($p.version -ne 1 -or $p.role -cne $role -or $p.handoff.service_id -cne 'CamachoPOSLocalService'){return $false}
  if([string]::IsNullOrWhiteSpace([string]$p.adapter_sha256) -or [string]::IsNullOrWhiteSpace([string]$p.signer_spki_sha256)){return $false}
  if($role -eq 'SERVICE'){return -not [string]::IsNullOrWhiteSpace([string]$p.signer_private_file) -and [string]::IsNullOrWhiteSpace([string]$p.receiver_file)}
  return -not [string]::IsNullOrWhiteSpace([string]$p.receiver_file) -and [string]::IsNullOrWhiteSpace([string]$p.signer_private_file)
 }catch{return $false}
}
try {
 Write-Host '=== CAMACHO POS | FIVE STAGES | WINDOWS VM ==='
 if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_REQUIRED'}
 $machine=Get-CimInstance Win32_ComputerSystem
 if(($machine.Manufacturer+' '+$machine.Model) -notmatch '(?i)virtual|hyper-v|vmware|virtualbox|qemu|kvm'){throw 'VM_REQUIRED'}
 $lab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
 if($lab -notmatch '(?i)^C:\\CamachoPosScmLab\\[a-f0-9]{32}$' -or -not (Test-Path -LiteralPath $lab -PathType Container)){throw 'LAB_ROOT_REJECTED'}
 $gitExe='C:\Program Files\Git\cmd\git.exe'
 if(-not (Test-Path -LiteralPath $gitExe -PathType Leaf)){throw 'GIT_EXE_MISSING'}
 $branch=(& $gitExe -C $repo branch --show-current).Trim()
 if($LASTEXITCODE -ne 0 -or $branch -ne 'feat/p0-windows-login-install-readiness'){throw 'BRANCH_REJECTED'}
 $changes=@(& $gitExe -C $repo status --porcelain)
 if($LASTEXITCODE -ne 0 -or $changes.Count -ne 0){throw 'WORKTREE_NOT_CLEAN'}
 Write-Host ('HEAD='+(& $gitExe -C $repo rev-parse HEAD).Trim())
 $svc=Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction Stop
 Gate 'A_SCM_VIRTUAL_ACCOUNT' ($null -ne $svc -and $svc.StartName -eq 'NT SERVICE\CamachoPOSLocalService' -and $svc.StartMode -eq 'Manual' -and $svc.State -eq 'Stopped')
 $desktopSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
 $dp=Join-Path $lab 'desktop\private'
 $sp=Join-Path $lab 'service\private'
 Gate 'A_DESKTOP_PRIVATE_ACL' (Custody $dp $desktopSid)
 $serviceEnrollmentReport=Join-Path $lab 'results\service-enrollment.json'
 $serviceEnrollmentPublic=Join-Path $lab 'results\service-signer-public.json'
 $serviceAttested=$false
 if((FileExists $serviceEnrollmentReport) -and (FileExists $serviceEnrollmentPublic)){
  try{
   $enrollment=Get-Content -LiteralPath $serviceEnrollmentReport -Raw | ConvertFrom-Json -ErrorAction Stop
   $serviceAttested=($enrollment.numTotalTests -eq 1 -and $enrollment.numPassedTests -eq 1 -and
     $enrollment.numFailedTests -eq 0 -and $enrollment.numPendingTests -eq 0)
  }catch{$serviceAttested=$false}
 }
 # The caller must NOT gain access to SERVICE-private DPAPI files merely to inspect them.
 Gate 'A_SERVICE_SELF_CUSTODY_ATTESTED' $serviceAttested
 $wrapper=Join-Path $lab 'service\CamachoPOSLocalService.exe'
 if(FileExists $wrapper){
  $sig=Get-AuthenticodeSignature -LiteralPath $wrapper
  Gate 'A_LAB_SIGNED_WINSW' ($sig.Status -eq 'Valid' -and $null -ne $sig.SignerCertificate -and $sig.SignerCertificate.Thumbprint -eq 'D66CDBD8B1564BF4B8A8F0664A3DCD17C39D0911')
 }else{Gate 'A_LAB_SIGNED_WINSW' $false}
 Gate 'B_DESKTOP_DPAPI_PRESENT' (FileExists (Join-Path $dp 'receiver.dpapi.json'))
 Gate 'B_SERVICE_DPAPI_SELF_ENROLLED' $serviceAttested
 $desktop=Join-Path $lab 'desktop\desktop-provision.json'
 $service=Join-Path $lab 'service\service-provision.json'
 Gate 'C_DESKTOP_MANAGED_PROVISION' (Managed $desktop 'DESKTOP')
 Gate 'C_SERVICE_MANAGED_PROVISION' (Managed $service 'SERVICE')
 $crossBindings=$false
 if((Managed $desktop 'DESKTOP') -and (Managed $service 'SERVICE')){
  try {
   $d=Get-Content -LiteralPath $desktop -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
   $v=Get-Content -LiteralPath $service -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
   $adapterPath=Join-Path $lab 'service\camacho_windows_pipe.node'
   $canonicalD=ConvertTo-Json -InputObject $d.handoff -Depth 15 -Compress
   $canonicalV=ConvertTo-Json -InputObject $v.handoff -Depth 15 -Compress
   $crossBindings=($canonicalD -ceq $canonicalV) -and
    ($d.adapter_file -ceq $v.adapter_file) -and
    ($d.adapter_sha256 -ceq $v.adapter_sha256) -and
    ($d.signer_spki_sha256 -ceq $v.signer_spki_sha256) -and
    ($d.signer_public_key_pem -ceq $v.signer_public_key_pem) -and
    (Test-Path -LiteralPath $adapterPath -PathType Leaf) -and
    ($d.adapter_sha256 -ceq (Get-FileHash -LiteralPath $adapterPath -Algorithm SHA256).Hash.ToLowerInvariant())
  } catch { $crossBindings=$false }
 }
 Gate 'C_PAIR_BINDING_AND_ADDON_HASH' $crossBindings
 Gate 'D_RESULT_DIRECTORY' (Test-Path -LiteralPath (Join-Path $lab 'results') -PathType Container)
 $keys=@('POS_CENTRAL_BASE_URL','POS_WINDOWS_COMMERCIAL_PROVISION_FILE','POS_WINDOWS_DESKTOP_COMMERCIAL_FILE','POS_AUTHORIZATION_TRUST_PROVISION_FILE','POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM','POS_SESSION_TRUST_ENVIRONMENT')
 $missing=@($keys | Where-Object {[string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_,'Process'))})
 Gate 'E_CENTRAL_PROVISION_PRESENT' ($missing.Count -eq 0)
 if($missing.Count -gt 0){Write-Host ('E_MISSING_VARIABLE_NAMES='+($missing -join ','))}
 $centralPreflight=Join-Path $PSScriptRoot 'windows-login-deployment-preflight.ps1'
 if(-not (FileExists $centralPreflight)){Gate 'E_CENTRAL_PREFLIGHT' $false}
 elseif($missing.Count -gt 0){Gate 'E_CENTRAL_PREFLIGHT' $false}
 else{
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $centralPreflight -Interactive -Json | Out-Null
  Gate 'E_CENTRAL_PREFLIGHT' ($LASTEXITCODE -eq 0)
 }
 $physicalBlockers=@($blocks.ToArray() | Where-Object {$_ -notlike 'E_*'})
 if($RunPhysical){
  if($physicalBlockers.Count -ne 0){throw ('PHYSICAL_PRECONDITIONS_BLOCKED:'+($physicalBlockers -join ','))}
  $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $oneShot=Join-Path $PSScriptRoot 'windows-scm-physical-one-shot.ps1'
  if(-not (FileExists $oneShot)){throw 'ONE_SHOT_MISSING'}
  $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$oneShot,'-Run','-LabRoot',$lab,'-DesktopProvision',$desktop,'-ServiceResult',(Join-Path $lab 'results\service-physical.json'))
  & powershell.exe @args
  if($LASTEXITCODE -ne 0){throw 'PHYSICAL_NODE_ELECTRON_FAILED'}
  Write-Host 'D_PHYSICAL_NODE_ELECTRON=PASS'
 }else{Write-Host 'D_PHYSICAL_NODE_ELECTRON=NOT_EXECUTED'}
 Write-Host ('BLOCKER_COUNT='+$blocks.Count)
 Write-Host 'HUMAN_LOGIN_READY=NO'
 Write-Host 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE'
 if($blocks.Count -gt 0 -or -not $RunPhysical){exit 2}
}catch{
 Write-Host ('FIVE_STAGE_GATE_FAILURE='+$_.Exception.Message)
 Write-Host 'HUMAN_LOGIN_READY=NO'
 exit 2
}
