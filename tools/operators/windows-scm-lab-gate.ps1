#requires -Version 5.1
<#
.SYNOPSIS
  Single-command gated physical SCM laboratory run for Camacho POS PR #99.
.DESCRIPTION
  Status is read-only. Physical delegates to the existing two-runtime one-shot
  only after checking the actual installed Windows service and installer-owned
  provisions. Never initializes DPAPI, manufactures trust/identity, launches a
  human login, changes ACLs, or enables production.
.EXAMPLE
  powershell.exe -NoProfile -File .\tools\operators\windows-scm-lab-gate.ps1 -LabRoot C:\CamachoPosScmLab\<unique-lab-id>
.EXAMPLE
  powershell.exe -NoProfile -File .\tools\operators\windows-scm-lab-gate.ps1 -Mode Physical -LabRoot C:\CamachoPosScmLab\<unique-lab-id>
#>
[CmdletBinding()]
param(
  [ValidateSet('Status','Physical')][string]$Mode='Status',
  [Parameter(Mandatory=$true)][string]$LabRoot,
  [string]$IsolatedRuntime,
  [string]$LabSignerThumbprint='D66CDBD8B1564BF4B8A8F0664A3DCD17C39D0911'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-scm-lab-binding.ps1')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$service='CamachoPOSLocalService'
$blockers=[System.Collections.Generic.List[string]]::new()
function Require([bool]$ok,[string]$code) {
  if(-not $ok){[void]$script:blockers.Add($code);Write-Host ($code+'=BLOCKED')}
  else {Write-Host ($code+'=PASS')}
}
try {
  $lab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
  $expectedParent='C:\CamachoPosScmLab\'
  $parentMatch=$lab.StartsWith($expectedParent,[StringComparison]::OrdinalIgnoreCase)
  $leaf=if($parentMatch){$lab.Substring($expectedParent.Length)}else{''}
  Require ($parentMatch -and $leaf -match '^[a-f0-9]{32}$' -and (Test-Path -LiteralPath $lab -PathType Container)) 'DEDICATED_LAB_ROOT'
  Require ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitOperatingSystem) 'WINDOWS_X64'
  if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_REQUIRED'}
  $computer=Get-CimInstance Win32_ComputerSystem
  Require ((($computer.Manufacturer+' '+$computer.Model) -match '(?i)virtual|hyper-v|vmware|qemu|kvm|virtualbox')) 'DISPOSABLE_VM'
  $branch=(& git -C $repo branch --show-current).Trim()
  $head=(& git -C $repo rev-parse HEAD).Trim()
  Require ($branch -eq 'feat/p0-windows-login-install-readiness') 'AUTHORIZED_BRANCH'
  Require ($head -match '^[0-9a-f]{40}$') 'GIT_HEAD'
  Require (@(& git -C $repo status --porcelain).Count -eq 0) 'CLEAN_WORKTREE'
  $svc=Get-CimInstance Win32_Service -Filter "Name='$service'" -ErrorAction Stop
  Require ($null -ne $svc) 'SCM_INSTALLED'
  if($null -ne $svc){
    Require ($svc.State -eq 'Stopped') 'SCM_STOPPED'
    Require ($svc.StartMode -eq 'Manual') 'SCM_MANUAL'
    Require ($svc.StartName -eq 'NT SERVICE\CamachoPOSLocalService') 'SCM_VIRTUAL_IDENTITY'
    $wrapper=Join-Path $lab 'service\CamachoPOSLocalService.exe'
    $imagePath=[string]$svc.PathName
    Require ((Test-Path -LiteralPath $wrapper -PathType Leaf) -and
      (Test-WindowsScmLabImagePath $imagePath $wrapper)) 'SCM_LAB_WRAPPER'
    if(Test-Path -LiteralPath $wrapper -PathType Leaf){
      $signature=Get-AuthenticodeSignature -LiteralPath $wrapper -ErrorAction Stop
      Require ($signature.Status -eq 'Valid' -and
        $null -ne $signature.SignerCertificate -and
        $signature.SignerCertificate.Thumbprint -eq $LabSignerThumbprint) 'LAB_PINNED_AUTHENTICODE'
      Require ((Get-Item -LiteralPath $wrapper).VersionInfo.ProductVersion -match '^2\.12\.0(?:[.+ -]|$)') 'WINSW_212'
    }
  }
  $desktop=Join-Path $lab 'desktop\desktop-provision.json'
  $serviceProvision=Join-Path $lab 'service\service-provision.json'
  $resultDir=Join-Path $lab 'results'
  foreach($p in @($desktop,$serviceProvision)){
    Require (Test-Path -LiteralPath $p -PathType Leaf) ('MANAGED_PROVISION_'+[IO.Path]::GetFileName($p))
  }
  Require (Test-Path -LiteralPath $resultDir -PathType Container) 'RESULT_DIRECTORY'
  Write-Host ('HEAD='+$head)
  Write-Host ('BLOCKER_COUNT='+$blockers.Count)
  Write-Host 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE'
  if($Mode -eq 'Status'){
    if($blockers.Count -gt 0){exit 2}
    Write-Host 'SCM_LAB_STATUS=READY_FOR_PHYSICAL_PRECHECK'
    return
  }
  if($blockers.Count -ne 0){throw ('PHYSICAL_LAB_NOT_READY:'+($blockers.ToArray() -join ','))}
  $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $oneShot=Join-Path $PSScriptRoot 'windows-scm-physical-one-shot.ps1'
  if(-not (Test-Path -LiteralPath $oneShot -PathType Leaf)){throw 'ONE_SHOT_MISSING'}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $oneShot -Run -LabRoot $lab -IsolatedRuntime $IsolatedRuntime -DesktopProvision $desktop -ServiceResult (Join-Path $resultDir 'service-physical.json')
  if($LASTEXITCODE -ne 0){throw 'PHYSICAL_ONE_SHOT_FAILED'}
  Write-Host 'SCM_NATIVE_PHYSICAL_TEST=FINISHED_CHECK_RECEIPT'
  Write-Host 'HUMAN_LOGIN_CERTIFIED=NO'
} catch {
  Write-Host ('SCM_LAB_GATE_ERROR='+$_.Exception.Message)
  exit 2
}
