#requires -Version 5.1
<#
.SYNOPSIS
  One invocation, two real native Windows SCM test rounds: Node and Electron.
.DESCRIPTION
  Reuses windows-scm-physical.test.ts on BOTH sides of a real WinSW service.
  Requires a previously approved disposable Windows VM, installed and stopped
  CamachoPOSLocalService WinSW instance, signed installer-owned provisions and
  a preconfigured service test command that writes ServiceResult JSON.
  Never creates a service, modifies DACLs/keys, deletes SQLite databases, or
  bypasses the commercial SCM release gate. All evidence is fail-closed.
  The SERVICE's WinSW XML must execute the existing physical test once per
  service start under NT SERVICE\CamachoPOSLocalService and overwrite ServiceResult.
#>
[CmdletBinding()]
param(
  [switch]$Run,
  [Parameter(Mandatory=$true)][string]$LabRoot,
  [Parameter(Mandatory=$true)][string]$DesktopProvision,
  [Parameter(Mandatory=$true)][string]$ServiceResult
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='CamachoPOSLocalService'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$recordRoot=Join-Path ([IO.Path]::GetTempPath()) ('camacho-scm-one-shot-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($recordRoot)|Out-Null
$startUtc=[DateTime]::UtcNow
$checks=[System.Collections.Generic.List[object]]::new()
$startedByUs=$false
$oldProvision=[Environment]::GetEnvironmentVariable('CAMACHO_SCM_PHYSICAL_PROVISION','Process')
$oldElectron=[Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
function Check([string]$Name,[bool]$Passed,[string]$Detail){
  $status=if($Passed){'PASS'}else{'FAIL'}
  $script:checks.Add([pscustomobject]@{name=$Name;status=$status;detail=$Detail})
  Write-Host "$Name=$status"
  if(-not $Passed){throw "ONE_SHOT_CHECK_FAILED:$Name"}
}
function Read-PhysicalResult([string]$Path,[DateTime]$After){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){throw 'PHYSICAL_JSON_MISSING'}
  $f=Get-Item -LiteralPath $Path
  if($f.LastWriteTimeUtc -le $After){throw 'PHYSICAL_JSON_STALE'}
  $json=Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json
  if($json.numTotalTests -ne 1 -or $json.numPassedTests -ne 1 -or
     $json.numFailedTests -ne 0 -or $json.numPendingTests -ne 0 -or
     $json.numFailedTestSuites -ne 0){throw 'PHYSICAL_TEST_NOT_1_OF_1_PASS'}
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Wait-ForResult([DateTime]$After){
  for($i=0;$i -lt 120;$i++){
    if((Test-Path -LiteralPath $ServiceResult -PathType Leaf) -and
       (Get-Item -LiteralPath $ServiceResult).LastWriteTimeUtc -gt $After){
      return Read-PhysicalResult $ServiceResult $After
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'SCM_SERVICE_PHYSICAL_REPORT_TIMEOUT'
}
function Invoke-Round([string]$Runtime){
  $svc=Get-Service -Name $serviceName -ErrorAction Stop
  Check "$Runtime-SCM-initially-stopped" ($svc.Status -eq 'Stopped') 'Preconfigured lab SCM must be stopped'
  $roundStarted=[DateTime]::UtcNow
  Start-Service -Name $serviceName -ErrorAction Stop
  $script:startedByUs=$true
  Start-Sleep -Milliseconds 750
  $clientJson=Join-Path $recordRoot ("desktop-"+$Runtime.ToLowerInvariant()+".json")
  $env:CAMACHO_SCM_PHYSICAL_PROVISION=$DesktopProvision
  if($Runtime -eq 'ELECTRON'){$env:ELECTRON_RUN_AS_NODE='1'}
  else{[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')}
  try{
    if($Runtime -eq 'NODE'){
      & pnpm --filter '@pos-platform/pos-local-service' exec vitest run 'tests/windows-scm-physical.test.ts' '--no-file-parallelism' '--reporter=json' "--outputFile=$clientJson"
    }else{
      & pnpm --filter '@pos-platform/pos-desktop' exec electron '../pos-local-service/node_modules/vitest/vitest.mjs' run '--root' '../pos-local-service' 'tests/windows-scm-physical.test.ts' '--no-file-parallelism' '--reporter=json' "--outputFile=$clientJson"
    }
    $exit=$LASTEXITCODE
  }finally{[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$oldElectron,'Process')}
  Check "$Runtime-Desktop-exit" ($exit -eq 0) 'Physical Desktop test process'
  $desktopHash=Read-PhysicalResult $clientJson $roundStarted
  Check "$Runtime-Desktop-physical" ($desktopHash.Length -eq 64) 'One passed, none skipped or failed'
  $serviceHash=Wait-ForResult $roundStarted
  Check "$Runtime-Service-physical" ($serviceHash.Length -eq 64) 'One passed, none skipped or failed'
  for($i=0;$i -lt 50;$i++){
    $svc=Get-Service -Name $serviceName -ErrorAction Stop
    if($svc.Status -eq 'Stopped'){break}
    Start-Sleep -Milliseconds 200
  }
  Check "$Runtime-SCM-shutdown" ((Get-Service -Name $serviceName).Status -eq 'Stopped') 'No service remains running after the physical test'
  $script:startedByUs=$false
  # Capture each per-round Service report before WinSW overwrites it again.
  Copy-Item -LiteralPath $ServiceResult -Destination (Join-Path $recordRoot ("service-"+$Runtime.ToLowerInvariant()+".json"))
}
$verdict='NOT_VERIFIED'
$failure=$null
try{
  Check 'Windows-x64' ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitOperatingSystem) 'Native pipe requires Windows x64'
  $computer=Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
  $vmText=($computer.Manufacturer+' '+$computer.Model)
  Check 'Disposable-VM-only' ($vmText -match '(?i)virtual|vmware|virtualbox|qemu|kvm|hyper-v|xen|parallels') 'Never install or start SCM lab on working PC'
  Check 'Explicit-run' ([bool]$Run) 'Pass -Run only after operator approves the disposable lab setup'
  $canonicalLab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
  Check 'Dedicated-lab-root' ($canonicalLab -match '(?i)^[a-z]:\\CamachoPosScmLab\\[a-z0-9-]{12,}$' -and
    (Test-Path -LiteralPath $canonicalLab -PathType Container)) 'Use a unique owner-approved path outside working system/repository'
  foreach($p in @($DesktopProvision,$ServiceResult)){
    Check 'Lab-input-absolute' ([IO.Path]::IsPathRooted($p) -and [IO.Path]::GetFullPath($p).StartsWith($canonicalLab+'\',[StringComparison]::OrdinalIgnoreCase)) 'Only lab-owned inputs are allowed'
  }
  Check 'Desktop-provision-present' (Test-Path -LiteralPath $DesktopProvision -PathType Leaf) 'Installer-owned desktop handoff'
  $branch=(& git -C $root branch --show-current).Trim()
  Check 'Correct-branch' ($branch -eq 'feat/p0-windows-login-install-readiness') 'PR #99'
  $changes=@(& git -C $root status --porcelain)
  Check 'Clean-worktree' ($changes.Count -eq 0) 'No local changes overwritten'
  $svc=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
  Check 'Lab-SCM-installed' ($null -ne $svc) 'Preinstalled disposable WinSW service required'
  Check 'SCM-virtual-identity' ($svc.StartName -eq 'NT SERVICE\CamachoPOSLocalService') 'Service may not run as SYSTEM or interactive Desktop'
  Check 'SCM-manual-start' ($svc.StartMode -eq 'Manual') 'Never run an automatically starting commercial service in lab'
  $binary=([regex]::Match($svc.PathName,'^\s*"?(.+?\.exe)"?(?:\s|$)')).Groups[1].Value
  Check 'SCM-binary-contained' ([IO.Path]::IsPathRooted($binary) -and
    [IO.Path]::GetFullPath($binary).StartsWith($canonicalLab+'\',[StringComparison]::OrdinalIgnoreCase)) 'WinSW runner must live under fresh lab root'
  Set-Location $root
  Invoke-Round 'NODE'
  Invoke-Round 'ELECTRON'
  $verdict='PASS_PHYSICAL_NATIVE_TWO_RUNTIMES'
}catch{
  $failure=$_.Exception.Message
  Write-Host ('SCM_ONE_SHOT_FAILURE='+$failure)
}finally{
  [Environment]::SetEnvironmentVariable('CAMACHO_SCM_PHYSICAL_PROVISION',$oldProvision,'Process')
  [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$oldElectron,'Process')
  if($startedByUs){
    try{
      $svc=Get-Service -Name $serviceName -ErrorAction Stop
      if($svc.Status -ne 'Stopped'){Stop-Service -Name $serviceName -Force -ErrorAction Stop}
    }catch{
      $verdict='FAIL_CLEANUP_UNVERIFIED'
      $failure='SCM_LAB_STOP_NOT_VERIFIED'
    }
  }
  $sha=(& git -C $root rev-parse HEAD 2>$null)
  $data=[ordered]@{
    schema='camacho-scm-physical-one-shot/v1'
    commit=($sha -join '').Trim()
    timestamp_utc=[DateTime]::UtcNow.ToString('o')
    status=$verdict
    failure=$failure
    scm_interop_verified=($verdict -eq 'PASS_PHYSICAL_NATIVE_TWO_RUNTIMES')
    business_login_verified=$false
    human_mfa_verified=$false
    production_enabled=$false
    checks=@($checks.ToArray())
  }
  $receipt=Join-Path $recordRoot 'receipt.json'
  $json=ConvertTo-Json -InputObject $data -Depth 10
  [IO.File]::WriteAllText($receipt,$json+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
  $hash=(Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $recordRoot 'receipt.json.sha256'),$hash+'  receipt.json'+[Environment]::NewLine)
  Write-Host ('SCM_ONE_SHOT_RECEIPT='+$receipt)
  Write-Host ('SCM_ONE_SHOT_RESULT='+$verdict)
}
if($verdict -ne 'PASS_PHYSICAL_NATIVE_TWO_RUNTIMES'){exit 1}
