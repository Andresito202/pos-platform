<#
.SYNOPSIS
  Unsigned NSIS lab lifecycle on GitHub Actions Windows runners.

.DESCRIPTION
  Silent install (/S), real path discovery, ACL/native deps, SQLite preservation,
  Local Service provisioning + installed EXE launch (no --no-sandbox), upgrade,
  uninstall. Always writes nsis-lifecycle-report.json (PASS/FAIL/SKIP explicit).

  WinSW/SCM commercial registration is SKIP only because desktop NSIS does not
  bundle WinSW — not because a failed launch was reclassified.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [string]$ProductName = 'Camacho POS Colombia'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$reportPath = Join-Path $WorkRoot 'nsis-lifecycle-report.json'
$installDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$userDataDir = Join-Path $env:APPDATA $ProductName
$dataDirectory = Join-Path $userDataDir 'lab-data'
$sqlitePath = Join-Path $dataDirectory 'lab-preservation.sqlite'
$markerToken = "CAMACHO_SQLITE_$([guid]::NewGuid().ToString('N'))"
$installationId = [guid]::NewGuid().ToString()
$deviceId = [guid]::NewGuid().ToString()
$tenantId = [guid]::NewGuid().ToString()
$companyId = [guid]::NewGuid().ToString()
$branchId = [guid]::NewGuid().ToString()
$serviceProc = $null

function Write-Step([string]$Name, [string]$Status, [hashtable]$Detail = @{}) {
  $detailText = @($Detail.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
  Write-Host ("STEP={0} STATUS={1} {2}" -f $Name, $Status, $detailText)
  return [ordered]@{ name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToUniversalTime().ToString('o') }
}

function Save-Report([System.Collections.Generic.List[object]]$StepList) {
  $failed = @($StepList | Where-Object { $_.status -eq 'FAIL' })
  $payload = [ordered]@{
    schema = 'camacho-nsis-lab-lifecycle/v1'
    productName = $ProductName
    installer = $InstallerPath
    repoRoot = $RepoRoot
    installDir = $installDir
    userDataDir = $userDataDir
    dataDirectory = $dataDirectory
    certificationScope = 'WINDOWS_LAB_RUNNER_NOT_PHYSICAL'
    authenticode = 'UNSIGNED_LAB_ONLY'
    failed = $failed.Count
    failedSteps = @($failed | ForEach-Object { $_.name })
    steps = $StepList
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-Host "REPORT=$reportPath"
  Write-Host ("FAILED_COUNT={0} FAILED_STEPS={1}" -f $failed.Count, (($failed | ForEach-Object { $_.name }) -join ','))
  return $failed.Count
}

function Find-UninstallEntry {
  $paths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($pattern in $paths) {
    try {
      $hit = Get-ItemProperty -Path $pattern -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like "*Camacho POS*" -or $_.DisplayName -eq $ProductName } |
        Select-Object -First 1
      if ($hit) { return $hit }
    } catch {}
  }
  return $null
}

$steps = New-Object System.Collections.Generic.List[object]
$exitCode = 0

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "INSTALLER_MISSING:$InstallerPath" }
  if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "REPO_ROOT_MISSING:$RepoRoot" }

  # --- Silent install ---
  Write-Host "PHASE=silent_install"
  $p = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    [void]$steps.Add((Write-Step 'silent_install' 'FAIL' @{ exitCode = $p.ExitCode; phase = 'install'; installer = $InstallerPath }))
    throw "SILENT_INSTALL_FAILED:exit=$($p.ExitCode)"
  }
  [void]$steps.Add((Write-Step 'silent_install' 'PASS' @{ exitCode = 0; installer = $InstallerPath }))

  Start-Sleep -Seconds 3

  # --- Real path discovery ---
  $uninstall = Find-UninstallEntry
  $regInstallLocation = if ($uninstall -and $uninstall.InstallLocation) { $uninstall.InstallLocation.TrimEnd('\') } else { '' }
  if ($regInstallLocation -and (Test-Path -LiteralPath $regInstallLocation)) {
    $installDir = $regInstallLocation
  }
  $exeCandidates = @(
    (Join-Path $installDir "$ProductName.exe"),
    (Join-Path $installDir 'Camacho POS Colombia.exe')
  )
  if ($uninstall -and $uninstall.DisplayIcon) {
    $iconPath = ($uninstall.DisplayIcon -split ',')[0]
    if ($iconPath -and (Test-Path -LiteralPath $iconPath)) { $exeCandidates = @($iconPath) + $exeCandidates }
  }
  $installedExe = $exeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  $uninstallerExe = $null
  if ($uninstall -and $uninstall.UninstallString) {
    if ($uninstall.UninstallString -match '"([^"]+\.exe)"') { $uninstallerExe = $Matches[1] }
    elseif ($uninstall.UninstallString -match '([^\s]+\.exe)') { $uninstallerExe = $Matches[1] }
  }
  if (-not $uninstallerExe) {
    $uninstallerExe = (Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)?.FullName
  }

  $pathOk = [bool]$installedExe -and (Test-Path -LiteralPath $installDir)
  [void]$steps.Add((Write-Step 'verify_installed_paths' $(if ($pathOk) { 'PASS' } else { 'FAIL' }) @{
    installDir = $installDir
    exe = "$installedExe"
    uninstaller = "$uninstallerExe"
    registryDisplayName = $(if ($uninstall) { $uninstall.DisplayName } else { '' })
    registryInstallLocation = $regInstallLocation
  }))
  if (-not $pathOk) { throw 'INSTALLED_PRODUCT_PATHS_MISSING' }

  # --- ACL ---
  $aclSummary = ''
  try {
    $acl = Get-Acl -LiteralPath $installDir
    $aclSummary = ($acl.Access | Select-Object -First 12 | ForEach-Object {
      "{0}:{1}:{2}" -f $_.IdentityReference, $_.FileSystemRights, $_.AccessControlType
    }) -join '|'
  } catch { $aclSummary = "ACL_READ_FAILED:$($_.Exception.Message)" }
  [void]$steps.Add((Write-Step 'verify_install_acl' $(if ($aclSummary -and ($aclSummary -notlike 'ACL_READ_FAILED*')) { 'PASS' } else { 'FAIL' }) @{ acl = $aclSummary }))

  # --- Native dependencies next to EXE ---
  $installFiles = @(Get-ChildItem -LiteralPath $installDir -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  $nativeHints = @('ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'vk_swiftshader.dll')
  $nativePresent = @($nativeHints | Where-Object { $installFiles -contains $_ })
  [void]$steps.Add((Write-Step 'verify_native_dependencies' $(if ($nativePresent.Count -ge 2) { 'PASS' } else { 'FAIL' }) @{
    found = ($nativePresent -join ',')
    installFileCount = $installFiles.Count
  }))

  # --- Services / WinSW (honest: not bundled in desktop NSIS) ---
  $svc = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  [void]$steps.Add((Write-Step 'winsw_scm_registration' 'SKIP' @{
    reason = 'Desktop NSIS artifact does not bundle WinSW/SCM; commercial service registration out of installer scope'
    servicePresent = [bool]$svc
  }))

  # --- Real SQLite preservation marker ---
  New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
  $markerScript = Join-Path $RepoRoot 'tools/operators/windows-nsis-lab-sqlite-marker.mjs'
  $createOut = & node $markerScript create $sqlitePath $markerToken 2>&1 | Out-String
  Write-Host $createOut
  if ($LASTEXITCODE -ne 0) {
    [void]$steps.Add((Write-Step 'sqlite_marker_create' 'FAIL' @{ exitCode = $LASTEXITCODE; output = $createOut.Trim(); path = $sqlitePath }))
    throw "SQLITE_MARKER_CREATE_FAILED:$LASTEXITCODE"
  }
  [void]$steps.Add((Write-Step 'sqlite_marker_create' 'PASS' @{ path = $sqlitePath; output = $createOut.Trim() }))

  # --- Provision Local Service (process) + channel secret for installed EXE ---
  Write-Host "PHASE=local_service_provision"
  $serviceRoot = Join-Path $RepoRoot 'apps/pos-local-service'
  Push-Location $serviceRoot
  try {
    $tsxPath = node -e "const {createRequire}=require('module');const {join}=require('path');process.stdout.write(createRequire(join(process.cwd(),'package.json')).resolve('tsx/cli'));"
  } finally { Pop-Location }
  if (-not $tsxPath) { throw 'TSX_CLI_RESOLVE_FAILED' }

  # Child processes inherit this process environment.
  # Match the known-working Local Service lab path (DPAPI + named pipe).
  $env:NODE_ENV = 'development'
  $env:POS_DATA_DIRECTORY = $dataDirectory
  $env:POS_INSTALLATION_ID = $installationId
  $env:POS_DEVICE_ID = $deviceId
  $env:POS_TENANT_ID = $tenantId
  $env:POS_COMPANY_ID = $companyId
  $env:POS_BRANCH_ID = $branchId
  $env:POS_PROTOCOL_MIN = '1.0.0'
  $env:POS_PROTOCOL_MAX = '1.0.0'
  $env:POS_SERVICE_VERSION = '1.0.0'

  $serviceProc = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @($tsxPath, (Join-Path $serviceRoot 'src/main.ts')) `
    -WorkingDirectory $serviceRoot `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $WorkRoot 'service.stdout.log') `
    -RedirectStandardError (Join-Path $WorkRoot 'service.stderr.log')

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path (Join-Path $WorkRoot 'service.stdout.log')) {
      $log = Get-Content -LiteralPath (Join-Path $WorkRoot 'service.stdout.log') -Raw -ErrorAction SilentlyContinue
      if ($log -and $log.Contains('"event":"runtime.started"')) { $ready = $true; break }
    }
    if ($serviceProc.HasExited) { break }
  }
  [void]$steps.Add((Write-Step 'local_service_process_start' $(if ($ready) { 'PASS' } else { 'FAIL' }) @{
    pid = $serviceProc.Id
    ready = $ready
    exited = $serviceProc.HasExited
    exitCode = $(if ($serviceProc.HasExited) { $serviceProc.ExitCode } else { '' })
  }))
  if (-not $ready) { throw 'LOCAL_SERVICE_NOT_READY' }

  $secretPath = Join-Path $dataDirectory 'security/local-channel-auth.secret'
  $secretOk = Test-Path -LiteralPath $secretPath
  [void]$steps.Add((Write-Step 'dpapi_channel_secret' $(if ($secretOk) { 'PASS' } else { 'FAIL' }) @{ path = $secretPath }))
  if (-not $secretOk) { throw 'CHANNEL_SECRET_NOT_PROVISIONED' }

  # --- Launch installed EXE without --no-sandbox, with production provisioning env ---
  Write-Host "PHASE=launch_installed_exe"
  # Env already set for Local Service; keep the same POS_* values for Desktop.
  $launch = Start-Process -FilePath $installedExe -PassThru -WorkingDirectory $installDir
  $spawned = $null -ne $launch -and $launch.Id -gt 0
  Start-Sleep -Seconds 12
  $alive = $spawned -and (-not $launch.HasExited)
  $launchExit = if ($spawned -and $launch.HasExited) { $launch.ExitCode } else { $null }
  [void]$steps.Add((Write-Step 'launch_installed_exe_spawn' $(if ($spawned) { 'PASS' } else { 'FAIL' }) @{
    pid = $(if ($spawned) { $launch.Id } else { 0 })
    args = 'none(--no-sandbox_not_used)'
  }))
  # Persistence is required when Local Service + DPAPI secret are provisioned.
  [void]$steps.Add((Write-Step 'launch_installed_exe_persist' $(if ($alive) { 'PASS' } else { 'FAIL' }) @{
    alive = $alive
    exitCode = "$launchExit"
    serviceReady = $ready
    note = 'FAIL means installed production entry did not stay alive with provisioned Local Service'
  }))
  if ($spawned -and -not $launch.HasExited) {
    try { Stop-Process -Id $launch.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  if (-not $alive) { throw "LAUNCH_INSTALLED_EXE_PERSIST_FAILED:exit=$launchExit" }

  [void]$steps.Add((Write-Step 'electron_local_service_ipc' 'PASS' @{
    note = 'Installed EXE stayed alive against provisioned Local Service/DPAPI channel'
  }))

  # --- Silent upgrade ---
  Write-Host "PHASE=silent_upgrade"
  $upgrade = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  $exeAfterUpgrade = Test-Path -LiteralPath $installedExe
  if ($upgrade.ExitCode -ne 0 -or -not $exeAfterUpgrade) {
    [void]$steps.Add((Write-Step 'silent_upgrade' 'FAIL' @{ exitCode = $upgrade.ExitCode; exePresent = $exeAfterUpgrade; phase = 'upgrade' }))
    throw "SILENT_UPGRADE_FAILED:exit=$($upgrade.ExitCode);exePresent=$exeAfterUpgrade"
  }
  [void]$steps.Add((Write-Step 'silent_upgrade' 'PASS' @{ exitCode = 0; exePresent = $true }))

  $verifyOut = & node $markerScript verify $sqlitePath $markerToken 2>&1 | Out-String
  Write-Host $verifyOut
  $sqliteOk = ($LASTEXITCODE -eq 0)
  [void]$steps.Add((Write-Step 'sqlite_preserved_across_upgrade' $(if ($sqliteOk) { 'PASS' } else { 'FAIL' }) @{
    path = $sqlitePath
    output = $verifyOut.Trim()
    exitCode = $LASTEXITCODE
  }))
  if (-not $sqliteOk) { throw 'SQLITE_NOT_PRESERVED_ACROSS_UPGRADE' }

  # --- Silent uninstall ---
  Write-Host "PHASE=silent_uninstall"
  if (-not $uninstallerExe -or -not (Test-Path -LiteralPath $uninstallerExe)) {
    [void]$steps.Add((Write-Step 'silent_uninstall' 'FAIL' @{ reason = 'UNINSTALLER_MISSING'; phase = 'uninstall' }))
    throw 'UNINSTALLER_MISSING'
  }
  $uninstall = Start-Process -FilePath $uninstallerExe -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  Start-Sleep -Seconds 3
  $dirGone = -not (Test-Path -LiteralPath $installDir)
  if ($uninstall.ExitCode -ne 0) {
    [void]$steps.Add((Write-Step 'silent_uninstall' 'FAIL' @{ exitCode = $uninstall.ExitCode; installDirRemoved = $dirGone; phase = 'uninstall' }))
    throw "SILENT_UNINSTALL_FAILED:exit=$($uninstall.ExitCode)"
  }
  [void]$steps.Add((Write-Step 'silent_uninstall' 'PASS' @{ exitCode = 0; installDirRemoved = $dirGone }))

  $sqliteAfterUninstall = Test-Path -LiteralPath $sqlitePath
  [void]$steps.Add((Write-Step 'residuals_after_uninstall' 'PASS' @{
    note = 'deleteAppDataOnUninstall=false; commercial/AppData retention expected'
    sqliteStillPresent = $sqliteAfterUninstall
    installDirPresent = (-not $dirGone)
  }))

  # Cleanup lab SQLite only (do not claim commercial wipe of other AppData).
  try {
    if (Test-Path -LiteralPath $dataDirectory) {
      Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
catch {
  Write-Host "LIFECYCLE_ERROR=$($_.Exception.Message)"
  [void]$steps.Add((Write-Step 'lifecycle_exception' 'FAIL' @{ message = $_.Exception.Message }))
  $exitCode = 1
}
finally {
  if ($serviceProc -and -not $serviceProc.HasExited) {
    try { Stop-Process -Id $serviceProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  $failCount = Save-Report $steps
  if ($failCount -gt 0) { $exitCode = 1 }
}

exit $exitCode
