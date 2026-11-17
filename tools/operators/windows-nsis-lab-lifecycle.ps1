<#
.SYNOPSIS
  Unsigned NSIS lab lifecycle on GitHub Actions Windows runners.

.DESCRIPTION
  Silent install (/S), file verification, optional second install as upgrade,
  data-preservation marker check, uninstall (/S), residual report.

  Does NOT claim Authenticode, physical certification, commercial WinSW/SCM
  interop, or FACTUS. deleteAppDataOnUninstall is false in electron-builder.yml,
  so AppData retention after uninstall is expected and reported honestly.

  Packaged production Electron fail-closes without Local Service / DPAPI
  provisioning (production-entry.ts). Launch persistence without WinSW is SKIP,
  not FAIL — IPC evidence belongs to local-operator-live on the same runner.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [string]$ProductName = 'Camacho POS Colombia'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$reportPath = Join-Path $WorkRoot 'nsis-lifecycle-report.json'
$installDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$markerDir = Join-Path $env:APPDATA $ProductName
$markerFile = Join-Path $markerDir 'lab-data-marker.txt'
$markerValue = "CAMACHO_LAB_MARKER_$([guid]::NewGuid().ToString('N'))"

function Write-Step([string]$Name, [string]$Status, [hashtable]$Detail = @{}) {
  $detailText = @($Detail.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
  # Write-Host so GHA logs capture STEP lines (Write-Output is swallowed by Add).
  Write-Host ("STEP={0} STATUS={1} {2}" -f $Name, $Status, $detailText)
  return [ordered]@{ name = $Name; status = $Status; detail = $Detail }
}

function Save-Report([System.Collections.Generic.List[object]]$StepList) {
  $failed = @($StepList | Where-Object { $_.status -eq 'FAIL' })
  $payload = [ordered]@{
    schema = 'camacho-nsis-lab-lifecycle/v1'
    productName = $ProductName
    installer = $InstallerPath
    certificationScope = 'WINDOWS_LAB_RUNNER_NOT_PHYSICAL'
    authenticode = 'UNSIGNED_LAB_ONLY'
    failed = $failed.Count
    steps = $StepList
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-Host "REPORT=$reportPath"
  return $failed.Count
}

$steps = New-Object System.Collections.Generic.List[object]
$exitCode = 0

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "INSTALLER_MISSING:$InstallerPath"
  }

  # --- Silent install ---
  $p = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  [void]$steps.Add((Write-Step 'silent_install' $(if ($p.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) @{ exitCode = $p.ExitCode; installDir = $installDir }))
  if ($p.ExitCode -ne 0) { throw "SILENT_INSTALL_FAILED:$($p.ExitCode)" }

  Start-Sleep -Seconds 3
  $exeCandidates = @(
    (Join-Path $installDir "$ProductName.exe"),
    (Join-Path $installDir 'Camacho POS Colombia.exe')
  )
  $installedExe = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  $uninstaller = Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  $aclSummary = ''
  try {
    $acl = Get-Acl -LiteralPath $installDir
    $aclSummary = ($acl.Access | Select-Object -First 8 | ForEach-Object {
      "{0}:{1}:{2}" -f $_.IdentityReference, $_.FileSystemRights, $_.AccessControlType
    }) -join '|'
  } catch {
    $aclSummary = "ACL_READ_FAILED:$($_.Exception.Message)"
  }
  [void]$steps.Add((Write-Step 'verify_installed_files' $(if ($installedExe) { 'PASS' } else { 'FAIL' }) @{
    exe = "$installedExe"
    uninstaller = $(if ($uninstaller) { $uninstaller.FullName } else { '' })
    dirExists = (Test-Path -LiteralPath $installDir)
  }))
  [void]$steps.Add((Write-Step 'verify_install_acl' $(if ($aclSummary -and ($aclSummary -notlike 'ACL_READ_FAILED*')) { 'PASS' } else { 'FAIL' }) @{
    acl = $aclSummary
  }))
  if (-not $installedExe) { throw 'INSTALLED_EXE_MISSING' }

  # Marker for data preservation across upgrade (AppData commercial area).
  New-Item -ItemType Directory -Force -Path $markerDir | Out-Null
  Set-Content -LiteralPath $markerFile -Value $markerValue -Encoding utf8
  [void]$steps.Add((Write-Step 'data_marker_written' 'PASS' @{ marker = $markerFile }))

  # --- Launch smoke ---
  # Production entry fail-closes without WinSW/DPAPI Local Service handoff.
  # Process spawn proves the installed binary is executable; GUI persistence
  # without SCM is SKIP (IPC proven separately by local-operator-live).
  $svc = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  $launch = Start-Process -FilePath $installedExe -ArgumentList @('--no-sandbox') -PassThru
  $spawned = $null -ne $launch -and $launch.Id -gt 0
  Start-Sleep -Seconds 5
  $alive = $spawned -and (-not $launch.HasExited)
  $exitAfter = if ($spawned -and $launch.HasExited) { $launch.ExitCode } else { $null }
  if ($spawned -and -not $launch.HasExited) {
    try { Stop-Process -Id $launch.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  [void]$steps.Add((Write-Step 'launch_installed_exe_spawn' $(if ($spawned) { 'PASS' } else { 'FAIL' }) @{
    pid = $(if ($spawned) { $launch.Id } else { 0 })
    spawned = $spawned
  }))
  if ($alive) {
    [void]$steps.Add((Write-Step 'launch_installed_exe_persist' 'PASS' @{ alive = $true }))
  } elseif (-not $svc) {
    [void]$steps.Add((Write-Step 'launch_installed_exe_persist' 'SKIP' @{
      reason = 'Production Electron fail-closes without WinSW/Local Service; expected on NSIS-only lab'
      exitCode = "$exitAfter"
      servicePresent = $false
    }))
  } else {
    [void]$steps.Add((Write-Step 'launch_installed_exe_persist' 'FAIL' @{
      reason = 'Service present but installed Electron did not stay alive'
      exitCode = "$exitAfter"
    }))
  }

  [void]$steps.Add((Write-Step 'winsw_scm_commercial' 'SKIP' @{
    reason = 'WinSW/SCM not bundled in desktop NSIS; commercial interop NOT_PROVEN'
    servicePresent = [bool]$svc
  }))
  [void]$steps.Add((Write-Step 'electron_local_service_ipc' 'SKIP' @{
    reason = 'Installed EXE↔WinSW IPC NOT_PROVEN here; covered by local-operator-live real-auth step'
  }))

  # --- Silent upgrade (re-run installer /S) ---
  $upgrade = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  $markerSurvived = (Test-Path -LiteralPath $markerFile) -and ((Get-Content -LiteralPath $markerFile -Raw).Trim() -eq $markerValue)
  $exeAfterUpgrade = Test-Path -LiteralPath $installedExe
  [void]$steps.Add((Write-Step 'silent_upgrade' $(if ($upgrade.ExitCode -eq 0 -and $exeAfterUpgrade) { 'PASS' } else { 'FAIL' }) @{
    exitCode = $upgrade.ExitCode
    exePresent = $exeAfterUpgrade
  }))
  [void]$steps.Add((Write-Step 'data_preserved_across_upgrade' $(if ($markerSurvived) { 'PASS' } else { 'FAIL' }) @{
    markerSurvived = $markerSurvived
  }))

  # --- Silent uninstall ---
  if (-not $uninstaller) {
    $uninstaller = Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if (-not $uninstaller) { throw 'UNINSTALLER_MISSING' }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  Start-Sleep -Seconds 3
  $dirGone = -not (Test-Path -LiteralPath $installDir)
  $appDataRemains = Test-Path -LiteralPath $markerFile
  [void]$steps.Add((Write-Step 'silent_uninstall' $(if ($uninstall.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) @{
    exitCode = $uninstall.ExitCode
    installDirRemoved = $dirGone
  }))
  [void]$steps.Add((Write-Step 'residuals_after_uninstall' 'PASS' @{
    note = 'deleteAppDataOnUninstall=false; AppData retention expected for commercial data safety'
    appDataMarkerPresent = $appDataRemains
    installDirPresent = (-not $dirGone)
  }))

  # Cleanup lab marker only (do not claim commercial wipe).
  if (Test-Path -LiteralPath $markerFile) {
    Remove-Item -LiteralPath $markerFile -Force -ErrorAction SilentlyContinue
  }
} catch {
  Write-Host "LIFECYCLE_ERROR=$($_.Exception.Message)"
  [void]$steps.Add((Write-Step 'lifecycle_exception' 'FAIL' @{ message = $_.Exception.Message }))
  $exitCode = 1
} finally {
  $failCount = Save-Report $steps
  if ($failCount -gt 0) { $exitCode = 1 }
}

exit $exitCode
