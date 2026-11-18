<#
.SYNOPSIS
  Unsigned NSIS lab lifecycle on GitHub Actions Windows runners.

.DESCRIPTION
  Silent install (/S), real path discovery, ACL/native deps, SQLite preservation,
  Local Service provisioning + installed EXE launch (no --no-sandbox), upgrade,
  uninstall. Always writes nsis-lifecycle-report.json (PASS/FAIL/SKIP explicit).

  WinSW/SCM: PASS when bundled payload registers CamachoPOSLocalService.
  Commercial Desktop↔NT SERVICE IPC remains NOT_PROVEN (no fake handoff).

  Install-dir resolution is dynamic AFTER install/upgrade: electron-builder
  perMachine lands under Program Files and often leaves InstallLocation empty.
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

# Canonical candidates (resolved only after install/upgrade — never freeze AppData pre-install).
$programFilesInstallDir = Join-Path ${env:ProgramFiles} $ProductName
$localAppInstallDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$installDir = $null
$installedExe = $null
$uninstallerExe = $null
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
$g1Status = 'SKIP'

function Write-Step([string]$Name, [string]$Status, [hashtable]$Detail = @{}) {
  $detailText = @($Detail.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
  Write-Host ("STEP={0} STATUS={1} {2}" -f $Name, $Status, $detailText)
  return [ordered]@{ name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToUniversalTime().ToString('o') }
}

function Save-Report([System.Collections.Generic.List[object]]$StepList) {
  $stepArray = Convert-ObjectListToArray -List $StepList
  $failed = @($stepArray | Where-Object { $_.status -eq 'FAIL' })
  $failedNames = @($failed | ForEach-Object { [string]$_.name })
  $payload = [ordered]@{
    schema = 'camacho-nsis-lab-lifecycle/v1'
    productName = $ProductName
    installer = $InstallerPath
    repoRoot = $RepoRoot
    installDir = $installDir
    programFilesInstallDir = $programFilesInstallDir
    localAppInstallDir = $localAppInstallDir
    installedExe = $installedExe
    uninstallerExe = $uninstallerExe
    userDataDir = $userDataDir
    dataDirectory = $dataDirectory
    certificationScope = 'WINDOWS_LAB_RUNNER_NOT_PHYSICAL'
    authenticode = 'UNSIGNED_LAB_ONLY'
    failed = $failed.Count
    failedSteps = $failedNames
    steps = $stepArray
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-Host "REPORT=$reportPath"
  Write-Host ("FAILED_COUNT={0} FAILED_STEPS={1}" -f $failed.Count, ($failedNames -join ','))
  return [int]$failed.Count
}

function Get-QuotedExe([string]$Raw) {
  if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
  if ($Raw -match '"([^"]+\.exe)"') { return $Matches[1] }
  if ($Raw -match '([A-Za-z]:\\[^\s"]+\.exe)') { return $Matches[1] }
  return $null
}

function Convert-ObjectListToArray {
  # PS7: wrapping List[object] with the array subexpression operator throws
  # ArgumentException "Argument types do not match". Use List.ToArray() instead.
  # Unary comma keeps Object[] intact across function returns.
  param($List)
  if ($null -eq $List) { return ,[object[]]@() }
  if ($List -is [System.Collections.Generic.List[object]]) {
    if ($List.Count -eq 0) { return ,[object[]]@() }
    return ,[object[]]$List.ToArray()
  }
  $buf = [System.Collections.Generic.List[object]]::new()
  foreach ($item in $List) { [void]$buf.Add($item) }
  if ($buf.Count -eq 0) { return ,[object[]]@() }
  return ,[object[]]$buf.ToArray()
}

function Convert-StringListToArray {
  param([Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$List)
  if ($List.Count -eq 0) { return ,[string[]]@() }
  return ,[string[]]$List.ToArray()
}

function Find-FirstExistingPath {
  param([AllowNull()][object]$Candidates)
  foreach ($candidate in @($Candidates)) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
    $path = [string]$candidate
    if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
  }
  return $null
}

function Find-UninstallEntries {
  # perMachine → prefer HKLM; keep HKCU for older per-user artifacts.
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $hits = [System.Collections.Generic.List[object]]::new()
  foreach ($pattern in $paths) {
    try {
      Get-ItemProperty -Path $pattern -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like "*Camacho POS*" -or $_.DisplayName -eq $ProductName } |
        ForEach-Object { [void]$hits.Add($_) }
    } catch {}
  }
  # Never wrap $hits with the array subexpression operator (PS7 type mismatch).
  return (Convert-ObjectListToArray -List $hits)
}

function Test-ProductInstallDir([string]$Dir) {
  if ([string]::IsNullOrWhiteSpace($Dir)) { return $false }
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return $false }
  $exeNames = @("$ProductName.exe", 'Camacho POS Colombia.exe')
  foreach ($name in $exeNames) {
    if (Test-Path -LiteralPath (Join-Path $Dir $name) -PathType Leaf) { return $true }
  }
  # Accept dir that already has Uninstall*.exe + resources (partial layout during upgrade race).
  $hasUninstall = [bool](Get-ChildItem -LiteralPath $Dir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)
  $hasResources = Test-Path -LiteralPath (Join-Path $Dir 'resources') -PathType Container
  return ($hasUninstall -and $hasResources)
}

function Resolve-InstalledLayout {
  $entries = @(Find-UninstallEntries)
  $primary = if ($entries.Count -gt 0) { $entries[0] } else { $null }
  $dirCandidates = [System.Collections.Generic.List[string]]::new()
  $exeCandidates = [System.Collections.Generic.List[string]]::new()
  $uninstallCandidates = [System.Collections.Generic.List[string]]::new()

  foreach ($entry in $entries) {
    if ($null -eq $entry) { continue }
    if ($entry.PSObject.Properties['InstallLocation'] -and $entry.InstallLocation) {
      $loc = [string]$entry.InstallLocation.Trim().TrimEnd('\')
      if ($loc) { [void]$dirCandidates.Add($loc) }
    }
    if ($entry.PSObject.Properties['DisplayIcon'] -and $entry.DisplayIcon) {
      $iconPath = Get-QuotedExe (($entry.DisplayIcon -split ',')[0])
      if (-not $iconPath) { $iconPath = (($entry.DisplayIcon -split ',')[0]).Trim().Trim('"') }
      if ($iconPath -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
        [void]$exeCandidates.Add([string]$iconPath)
        $iconDir = [IO.Path]::GetDirectoryName([string]$iconPath)
        if ($iconDir) { [void]$dirCandidates.Add([string]$iconDir) }
      }
    }
    if ($entry.PSObject.Properties['UninstallString'] -and $entry.UninstallString) {
      $u = Get-QuotedExe ([string]$entry.UninstallString)
      if ($u -and (Test-Path -LiteralPath $u -PathType Leaf)) {
        [void]$uninstallCandidates.Add([string]$u)
        $uDir = [IO.Path]::GetDirectoryName([string]$u)
        if ($uDir) { [void]$dirCandidates.Add([string]$uDir) }
      }
    }
  }

  # Filesystem discovery — Program Files first (perMachine), then LocalAppData (legacy).
  foreach ($dir in @($programFilesInstallDir, $localAppInstallDir)) {
    if (-not [string]::IsNullOrWhiteSpace($dir)) { [void]$dirCandidates.Add([string]$dir) }
  }

  $resolvedDir = $null
  # Prefer Program Files when the product is actually there.
  if (Test-ProductInstallDir $programFilesInstallDir) {
    $resolvedDir = $programFilesInstallDir
  } else {
    $uniqueDirs = @(Convert-StringListToArray -List $dirCandidates | Select-Object -Unique)
    foreach ($dir in $uniqueDirs) {
      if (Test-ProductInstallDir ([string]$dir)) { $resolvedDir = [string]$dir; break }
    }
  }

  if (-not $resolvedDir) {
    return [ordered]@{
      ok = $false
      installDir = $null
      installedExe = $null
      uninstallerExe = $null
      registryDisplayName = $(if ($primary) { [string]$primary.DisplayName } else { '' })
      registryInstallLocation = $(if ($primary -and $primary.PSObject.Properties['InstallLocation'] -and $primary.InstallLocation) { [string]$primary.InstallLocation } else { '' })
      source = 'NONE'
    }
  }

  $exeNames = @("$ProductName.exe", 'Camacho POS Colombia.exe')
  foreach ($name in $exeNames) {
    $p = Join-Path $resolvedDir $name
    if (Test-Path -LiteralPath $p -PathType Leaf) { [void]$exeCandidates.Insert(0, [string]$p) }
  }
  $resolvedExe = Find-FirstExistingPath -Candidates (Convert-StringListToArray -List $exeCandidates)

  $uninstallFromDir = $null
  $uninstallLeaf = Get-ChildItem -LiteralPath $resolvedDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $uninstallLeaf) { $uninstallFromDir = [string]$uninstallLeaf.FullName }
  if ($uninstallFromDir) { [void]$uninstallCandidates.Insert(0, $uninstallFromDir) }
  $resolvedUninstall = Find-FirstExistingPath -Candidates (Convert-StringListToArray -List $uninstallCandidates)

  $source = if ($resolvedDir -eq $programFilesInstallDir) { 'PROGRAM_FILES' }
    elseif ($resolvedDir -eq $localAppInstallDir) { 'LOCALAPPDATA_PROGRAMS' }
    else { 'REGISTRY_OR_DERIVED' }

  $ok = -not [string]::IsNullOrWhiteSpace($resolvedExe) `
    -and -not [string]::IsNullOrWhiteSpace($resolvedUninstall) `
    -and (Test-Path -LiteralPath $resolvedDir -PathType Container)

  return [ordered]@{
    ok = [bool]$ok
    installDir = [string]$resolvedDir
    installedExe = $(if ($resolvedExe) { [string]$resolvedExe } else { $null })
    uninstallerExe = $(if ($resolvedUninstall) { [string]$resolvedUninstall } else { $null })
    registryDisplayName = $(if ($primary) { [string]$primary.DisplayName } else { '' })
    registryInstallLocation = $(if ($primary -and $primary.PSObject.Properties['InstallLocation'] -and $primary.InstallLocation) { [string]$primary.InstallLocation } else { '' })
    source = $source
    servicePayloadDir = (Join-Path $resolvedDir 'resources\service-payload')
  }
}

function Apply-ResolvedLayout($Layout) {
  $script:installDir = [string]$Layout.installDir
  $script:installedExe = [string]$Layout.installedExe
  $script:uninstallerExe = [string]$Layout.uninstallerExe
}

$steps = New-Object System.Collections.Generic.List[object]
$exitCode = 0

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "INSTALLER_MISSING:$InstallerPath" }
  if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "REPO_ROOT_MISSING:$RepoRoot" }

  # --- Silent install ---
  Write-Host "PHASE=silent_install"
  $helperLogPath = Join-Path $env:ProgramData 'CamachoPOS\logs\winsw-helper.log'
  $scmOkMarkerProgramData = Join-Path $env:ProgramData 'CamachoPOS\logs\scm-install.ok'
  $p = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  $helperLogTail = ''
  if (Test-Path -LiteralPath $helperLogPath) {
    $helperLogTail = ((Get-Content -LiteralPath $helperLogPath -Tail 80 -ErrorAction SilentlyContinue) -join ' || ')
    Write-Host ('WINSW_HELPER_LOG_TAIL=' + $helperLogTail)
  }
  # After Abort, Program Files may be rolled back — still capture whatever evidence remains.
  $layoutProbe = Resolve-InstalledLayout
  $payloadMarkerPath = ''
  if ($layoutProbe.ok -and $layoutProbe.installDir) {
    $payloadMarkerPath = Join-Path $layoutProbe.installDir 'resources\service-payload\scm-install.ok'
  }
  $scmOkMarkerPresent = (
    (Test-Path -LiteralPath $scmOkMarkerProgramData -PathType Leaf) -or
    ($payloadMarkerPath -and (Test-Path -LiteralPath $payloadMarkerPath -PathType Leaf))
  )
  if ($p.ExitCode -ne 0 -or -not $scmOkMarkerPresent) {
    [void]$steps.Add((Write-Step 'silent_install' 'FAIL' @{
      exitCode = $p.ExitCode
      phase = 'install'
      installer = $InstallerPath
      scmOkMarkerPresent = $scmOkMarkerPresent
      scmOkMarkerProgramData = $scmOkMarkerProgramData
      payloadMarkerPath = "$payloadMarkerPath"
      helperLogTail = $helperLogTail
      layoutOk = [bool]$layoutProbe.ok
      layoutSource = "$($layoutProbe.source)"
    }))
    throw ("SILENT_INSTALL_FAILED:exit={0};scmOkMarker={1}" -f $p.ExitCode, $scmOkMarkerPresent)
  }
  [void]$steps.Add((Write-Step 'silent_install' 'PASS' @{
    exitCode = 0
    installer = $InstallerPath
    scmOkMarkerPresent = $true
  }))

  Start-Sleep -Seconds 3

  # --- Real path discovery (dynamic; do not trust pre-install AppData fallback) ---
  $layout = Resolve-InstalledLayout
  Apply-ResolvedLayout $layout
  [void]$steps.Add((Write-Step 'verify_installed_paths' $(if ($layout.ok) { 'PASS' } else { 'FAIL' }) @{
    installDir = "$($layout.installDir)"
    exe = "$($layout.installedExe)"
    uninstaller = "$($layout.uninstallerExe)"
    registryDisplayName = "$($layout.registryDisplayName)"
    registryInstallLocation = "$($layout.registryInstallLocation)"
    resolutionSource = "$($layout.source)"
    programFilesCandidate = $programFilesInstallDir
    localAppCandidate = $localAppInstallDir
  }))
  if (-not $layout.ok) { throw 'INSTALLED_PRODUCT_PATHS_MISSING' }

  # --- ACL on real installDir + service payload (icacls; avoid Get-Acl) ---
  $aclSummary = ''
  $payloadAclOk = $false
  $icaclsExe = Join-Path $env:WINDIR 'System32\icacls.exe'
  $payloadForAcl = Join-Path $installDir 'resources\service-payload'
  try {
    if (-not (Test-Path -LiteralPath $icaclsExe -PathType Leaf)) { throw "ICACLS_MISSING:$icaclsExe" }
    $aclRaw = (& $icaclsExe $installDir 2>&1 | Out-String).Trim()
    $aclSummary = (($aclRaw -split "`r?`n") | Select-Object -First 20) -join ' | '
    if (Test-Path -LiteralPath $payloadForAcl) {
      $payloadAclRaw = (& $icaclsExe $payloadForAcl 2>&1 | Out-String)
      $payloadAclOk = ($payloadAclRaw -match 'NT SERVICE\\CamachoPOSLocalService' -or $payloadAclRaw -match 'S-1-5-80-')
      $aclSummary = $aclSummary + ' || PAYLOAD=' + ((($payloadAclRaw -split "`r?`n") | Select-Object -First 12) -join ' | ')
    }
  } catch { $aclSummary = "ACL_READ_FAILED:$($_.Exception.Message)" }
  [void]$steps.Add((Write-Step 'verify_install_acl' $(if ($aclSummary -and ($aclSummary -notlike 'ACL_READ_FAILED*') -and $payloadAclOk) { 'PASS' } else { 'FAIL' }) @{
    acl = $aclSummary
    installDir = $installDir
    payloadDir = $payloadForAcl
    virtualAccountAclPresent = $payloadAclOk
  }))
  if (-not $payloadAclOk) { throw 'INSTALL_ACL_MISSING_NT_SERVICE_GRANT' }

  # --- Native dependencies next to EXE ---
  $installFiles = @(Get-ChildItem -LiteralPath $installDir -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  $nativeHints = @('ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'vk_swiftshader.dll')
  $nativePresent = @($nativeHints | Where-Object { $installFiles -contains $_ })
  [void]$steps.Add((Write-Step 'verify_native_dependencies' $(if ($nativePresent.Count -ge 2) { 'PASS' } else { 'FAIL' }) @{
    found = ($nativePresent -join ',')
    installFileCount = $installFiles.Count
    installDir = $installDir
  }))

  # --- Services / WinSW/SCM (bundled under resources/service-payload when staged) ---
  $payloadDir = Join-Path $installDir 'resources\service-payload'
  $winswHelper = Join-Path $payloadDir 'install-camacho-local-service.ps1'
  $svc = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $winswHelper)) {
    [void]$steps.Add((Write-Step 'winsw_scm_registration' 'FAIL' @{
      reason = 'SERVICE_PAYLOAD_MISSING_FROM_INSTALLER'
      payloadDir = $payloadDir
      installDir = $installDir
      servicePresent = [bool]$svc
    }))
    throw 'SERVICE_PAYLOAD_MISSING_FROM_INSTALLER'
  }

  # Expected payload leaves (audit before SCM claims).
  $requiredPayload = @(
    (Join-Path $payloadDir 'CamachoPOSLocalService.exe'),
    (Join-Path $payloadDir 'CamachoPOSLocalService.xml.template'),
    (Join-Path $payloadDir 'runtime\node.exe'),
    (Join-Path $payloadDir 'local-service\pos-local-service.mjs'),
    (Join-Path $payloadDir 'install-camacho-local-service.ps1')
  )
  $missingPayload = @($requiredPayload | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
  [void]$steps.Add((Write-Step 'verify_service_payload_files' $(if ($missingPayload.Count -eq 0) { 'PASS' } else { 'FAIL' }) @{
    payloadDir = $payloadDir
    missing = ($missingPayload -join ',')
  }))
  if ($missingPayload.Count -gt 0) { throw 'SERVICE_PAYLOAD_FILES_INCOMPLETE' }

  # NSIS customInstall MUST have registered the service. Lab must NOT paper over
  # installer failure with an auxiliary helper install (masks Get-FileHash / hook bugs).
  $scmDataDirectory = Join-Path $env:ProgramData 'CamachoPOS\lab-data'
  $expectedScmAccount = 'NT SERVICE\CamachoPOSLocalService'
  $helperLog = $helperLogPath
  if (Test-Path -LiteralPath $helperLog) {
    $helperLogTail = ((Get-Content -LiteralPath $helperLog -Tail 40 -ErrorAction SilentlyContinue) -join ' || ')
    Write-Host ('WINSW_HELPER_LOG_TAIL=' + $helperLogTail)
  }
  $payloadMarkerNow = Join-Path $payloadDir 'scm-install.ok'
  $markerOkNow = (
    (Test-Path -LiteralPath $scmOkMarkerProgramData -PathType Leaf) -or
    (Test-Path -LiteralPath $payloadMarkerNow -PathType Leaf)
  )
  if (-not $markerOkNow) {
    [void]$steps.Add((Write-Step 'winsw_scm_registration' 'FAIL' @{
      reason = 'SCM_INSTALL_OK_MARKER_MISSING'
      scmOkMarkerProgramData = $scmOkMarkerProgramData
      payloadMarkerPath = $payloadMarkerNow
      helperLogTail = $helperLogTail
      labFallbackUsed = $false
    }))
    throw 'WINSW_SCM_REGISTRATION_FAILED_NSIS_DID_NOT_REGISTER'
  }
  $scmStatus = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $winswHelper `
    -Action Status -PayloadDir $payloadDir -Json 2>&1 | Out-String
  Write-Host $scmStatus
  $svc = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  $cimAfter = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction SilentlyContinue
  $startNameAfter = if ($cimAfter) { [string]$cimAfter.StartName } else { '' }
  $identityOk = $startNameAfter -eq $expectedScmAccount
  $runningOk = $null -ne $svc -and ($svc.Status -eq 'Running' -or $svc.Status -eq 'StartPending')
  $autoStartOk = $null -ne $svc -and ($svc.StartType -eq 'Automatic')
  # LocalSystem / wrong account must NEVER pass — even if the process is Running.
  $scmOk = $runningOk -and $identityOk -and $autoStartOk
  $scQc = (& sc.exe qc CamachoPOSLocalService 2>&1 | Out-String).Trim()
  $nsisRegistered = $scmOk -and ($helperLogTail -match 'RESULT action=Install code=0')
  [void]$steps.Add((Write-Step 'winsw_scm_registration' $(if ($scmOk) { 'PASS' } else { 'FAIL' }) @{
    servicePresent = [bool]$svc
    status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
    startType = $(if ($svc) { [string]$svc.StartType } else { '' })
    startName = $startNameAfter
    identityOk = $identityOk
    autoStartOk = $autoStartOk
    expectedStartName = $expectedScmAccount
    payloadDir = $payloadDir
    installDir = $installDir
    scmDataDirectory = $scmDataDirectory
    labFallbackUsed = $false
    nsisHelperInstallOk = $nsisRegistered
    helperLogTail = $helperLogTail
    scQc = $scQc
    commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    authenticodeProduct = 'RT-009-B_BLOCKED'
    statusJson = $scmStatus.Trim()
  }))
  if (-not $scmOk) {
    throw 'WINSW_SCM_REGISTRATION_FAILED_NSIS_DID_NOT_REGISTER'
  }

  # --- Unexpected interruption recovery: stop/start must restore Running + virtual identity ---
  Write-Host "PHASE=scm_restart_recovery"
  try {
    Restart-Service -Name 'CamachoPOSLocalService' -Force -ErrorAction Stop
  }
  catch {
    # Restart-Service can race with WinSW onfailure; fall back to stop/start.
    try { Stop-Service -Name 'CamachoPOSLocalService' -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 2
    Start-Service -Name 'CamachoPOSLocalService' -ErrorAction Stop
  }
  $recoverDeadline = [DateTime]::UtcNow.AddSeconds(45)
  $svcRecover = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  while ($null -ne $svcRecover -and $svcRecover.Status -ne 'Running' -and [DateTime]::UtcNow -lt $recoverDeadline) {
    Start-Sleep -Milliseconds 500
    $svcRecover = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  }
  $cimRecover = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction SilentlyContinue
  $recoverOk = $null -ne $svcRecover -and $svcRecover.Status -eq 'Running' -and
    $null -ne $cimRecover -and $cimRecover.StartName -eq $expectedScmAccount -and
    $svcRecover.StartType -eq 'Automatic'
  [void]$steps.Add((Write-Step 'scm_restart_recovery' $(if ($recoverOk) { 'PASS' } else { 'FAIL' }) @{
    status = $(if ($svcRecover) { [string]$svcRecover.Status } else { 'Absent' })
    startType = $(if ($svcRecover) { [string]$svcRecover.StartType } else { '' })
    startName = $(if ($cimRecover) { [string]$cimRecover.StartName } else { '' })
    expectedStartName = $expectedScmAccount
    note = 'Proxies unexpected interruption + Automatic start after Windows restart (lab; no full reboot)'
  }))
  if (-not $recoverOk) { throw 'SCM_RESTART_RECOVERY_FAILED' }

  # --- Negative ACL / forged provision / LocalSystem impersonation checks ---
  Write-Host "PHASE=security_negatives"
  $negScript = Join-Path $RepoRoot 'tools/operators/windows-nsis-security-negatives.ps1'
  $negExit = 0
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $negScript `
      -Run -PayloadDir $payloadDir -ScmDataDirectory $scmDataDirectory -WorkRoot $WorkRoot
    $negExit = $LASTEXITCODE
  }
  catch {
    $negExit = 1
    Write-Host ("SECURITY_NEGATIVES_EXCEPTION=" + $_.Exception.Message)
  }
  $negReport = Join-Path $WorkRoot 'nsis-security-negatives.json'
  $negDetail = @{ exitCode = $negExit; report = $negReport }
  if (Test-Path -LiteralPath $negReport) {
    try {
      $negJson = Get-Content -LiteralPath $negReport -Raw | ConvertFrom-Json
      $negDetail['failed'] = [int]$negJson.failed
      $negDetail['stepCount'] = @($negJson.steps).Count
    }
    catch {}
  }
  [void]$steps.Add((Write-Step 'security_negatives' $(if ($negExit -eq 0) { 'PASS' } else { 'FAIL' }) $negDetail))
  if ($negExit -ne 0) { throw 'SECURITY_NEGATIVES_FAILED' }

  # --- G1 native identity on the NSIS-installed SCM virtual account (not Electron commercial handshake) ---
  Write-Host "PHASE=g1_native_on_installed_scm"
  $addonPath = Join-Path $RepoRoot 'packages/local-channel/native/build/Release/camacho_windows_pipe.node'
  $g1Script = Join-Path $RepoRoot 'tools/operators/windows-nsis-scm-g1-identity.ps1'
  $g1Status = 'SKIP'
  $g1Detail = [ordered]@{ addonPresent = (Test-Path -LiteralPath $addonPath -PathType Leaf) }
  if (-not (Test-Path -LiteralPath $addonPath -PathType Leaf)) {
    $g1Detail['reason'] = 'NATIVE_ADDON_NOT_BUILT_IN_WORKFLOW'
    [void]$steps.Add((Write-Step 'g1_native_on_installed_scm' 'SKIP' $g1Detail))
  }
  else {
    $g1Exit = 1
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $g1Script `
        -Run -RepoRoot $RepoRoot -ResultsRoot (Join-Path $WorkRoot 'g1-installed')
      $g1Exit = $LASTEXITCODE
    }
    catch {
      $g1Exit = 1
      $g1Detail['exception'] = [string]$_.Exception.Message
      Write-Host ("G1_ON_INSTALLED_EXCEPTION=" + $_.Exception.Message)
    }
    $g1Detail['exitCode'] = $g1Exit
    $g1Detail['commercialGate'] = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    $g1Detail['electronHandshake'] = 'NOT_TESTED'
    $g1Status = $(if ($g1Exit -eq 0) { 'PASS' } else { 'FAIL' })
    [void]$steps.Add((Write-Step 'g1_native_on_installed_scm' $g1Status $g1Detail))
    if ($g1Exit -ne 0) { throw 'G1_NATIVE_ON_INSTALLED_SCM_FAILED' }
    # Confirm WinSW product identity still intact after G1 restore.
    $cimAfterG1 = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction SilentlyContinue
    $svcAfterG1 = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
    $afterG1Ok = $null -ne $svcAfterG1 -and ($svcAfterG1.Status -eq 'Running' -or $svcAfterG1.Status -eq 'StartPending') -and
      $null -ne $cimAfterG1 -and $cimAfterG1.StartName -eq $expectedScmAccount
    [void]$steps.Add((Write-Step 'winsw_restored_after_g1' $(if ($afterG1Ok) { 'PASS' } else { 'FAIL' }) @{
      status = $(if ($svcAfterG1) { [string]$svcAfterG1.Status } else { 'Absent' })
      startName = $(if ($cimAfterG1) { [string]$cimAfterG1.StartName } else { '' })
    }))
    if (-not $afterG1Ok) { throw 'WINSW_NOT_RESTORED_AFTER_G1' }
  }

  # --- Real SQLite preservation marker (AppData commercial retention path) ---
  New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
  $markerScript = Join-Path $RepoRoot 'tools/operators/windows-nsis-lab-sqlite-marker.mjs'
  $createOut = & node $markerScript create $sqlitePath $markerToken 2>&1 | Out-String
  Write-Host $createOut
  if ($LASTEXITCODE -ne 0) {
    [void]$steps.Add((Write-Step 'sqlite_marker_create' 'FAIL' @{ exitCode = $LASTEXITCODE; output = $createOut.Trim(); path = $sqlitePath }))
    throw "SQLITE_MARKER_CREATE_FAILED:$LASTEXITCODE"
  }
  [void]$steps.Add((Write-Step 'sqlite_marker_create' 'PASS' @{ path = $sqlitePath; output = $createOut.Trim() }))

  # --- Provision interactive Local Service (process) + channel secret for installed EXE ---
  # This is NOT the NT SERVICE path; commercial Desktop↔SCM IPC stays NOT_PROVEN.
  Write-Host "PHASE=local_service_provision"
  $serviceRoot = Join-Path $RepoRoot 'apps/pos-local-service'
  Push-Location $serviceRoot
  try {
    $tsxPath = node -e "const {createRequire}=require('module');const {join}=require('path');process.stdout.write(createRequire(join(process.cwd(),'package.json')).resolve('tsx/cli'));"
  } finally { Pop-Location }
  if (-not $tsxPath) { throw 'TSX_CLI_RESOLVE_FAILED' }

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
    dataDirectory = $dataDirectory
  }))
  if (-not $ready) { throw 'LOCAL_SERVICE_NOT_READY' }

  $secretPath = Join-Path $dataDirectory 'security/local-channel-auth.secret'
  $secretOk = Test-Path -LiteralPath $secretPath
  [void]$steps.Add((Write-Step 'dpapi_channel_secret' $(if ($secretOk) { 'PASS' } else { 'FAIL' }) @{ path = $secretPath }))
  if (-not $secretOk) { throw 'CHANNEL_SECRET_NOT_PROVISIONED' }

  # --- Launch installed EXE without --no-sandbox, with production provisioning env ---
  Write-Host "PHASE=launch_installed_exe"
  $launch = Start-Process -FilePath $installedExe -PassThru -WorkingDirectory $installDir
  $spawned = $null -ne $launch -and $launch.Id -gt 0
  Start-Sleep -Seconds 12
  $alive = $spawned -and (-not $launch.HasExited)
  $launchExit = if ($spawned -and $launch.HasExited) { $launch.ExitCode } else { $null }
  [void]$steps.Add((Write-Step 'launch_installed_exe_spawn' $(if ($spawned) { 'PASS' } else { 'FAIL' }) @{
    pid = $(if ($spawned) { $launch.Id } else { 0 })
    exe = $installedExe
    workingDirectory = $installDir
    args = 'none(--no-sandbox_not_used)'
  }))
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
    note = 'Installed EXE stayed alive against interactive Local Service/DPAPI channel'
    scmCommercialIpc = 'DEFERRED_UNTIL_AFTER_UPGRADE'
    note2 = 'Product SCM commercial IPC runs after silent upgrade against the restored WinSW service'
  }))

  # --- Silent upgrade ---
  Write-Host "PHASE=silent_upgrade"
  $upgrade = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  Start-Sleep -Seconds 3
  $layoutAfterUpgrade = Resolve-InstalledLayout
  Apply-ResolvedLayout $layoutAfterUpgrade
  $exeAfterUpgrade = [bool]$layoutAfterUpgrade.ok -and (Test-Path -LiteralPath $installedExe -PathType Leaf)
  if ($upgrade.ExitCode -ne 0 -or -not $exeAfterUpgrade) {
    [void]$steps.Add((Write-Step 'silent_upgrade' 'FAIL' @{
      exitCode = $upgrade.ExitCode
      exePresent = $exeAfterUpgrade
      installDir = "$installDir"
      resolutionSource = "$($layoutAfterUpgrade.source)"
      phase = 'upgrade'
    }))
    throw "SILENT_UPGRADE_FAILED:exit=$($upgrade.ExitCode);exePresent=$exeAfterUpgrade"
  }
  [void]$steps.Add((Write-Step 'silent_upgrade' 'PASS' @{
    exitCode = 0
    exePresent = $true
    installDir = $installDir
    resolutionSource = "$($layoutAfterUpgrade.source)"
  }))

  # Payload + SCM service must survive upgrade (NSIS customInstall re-registers after
  # customUnInstall). Lab must not reinstall the service here.
  $payloadAfter = Join-Path $installDir 'resources\service-payload'
  $payloadOk = Test-Path -LiteralPath (Join-Path $payloadAfter 'install-camacho-local-service.ps1') -PathType Leaf
  $svcAfterUpgrade = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  $cimAfterUpgrade = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction SilentlyContinue
  $startNameAfterUpgrade = if ($cimAfterUpgrade) { [string]$cimAfterUpgrade.StartName } else { '' }
  $identityAfterUpgrade = $startNameAfterUpgrade -eq $expectedScmAccount
  $runningAfterUpgrade = $null -ne $svcAfterUpgrade -and (
    $svcAfterUpgrade.Status -eq 'Running' -or $svcAfterUpgrade.Status -eq 'StartPending'
  )
  $autoAfterUpgrade = $null -ne $svcAfterUpgrade -and ($svcAfterUpgrade.StartType -eq 'Automatic')
  $payloadMarkerAfterUpgrade = Join-Path $payloadAfter 'scm-install.ok'
  $markerAfterUpgrade = (
    (Test-Path -LiteralPath $scmOkMarkerProgramData -PathType Leaf) -or
    (Test-Path -LiteralPath $payloadMarkerAfterUpgrade -PathType Leaf)
  )
  $upgradeScmOk = $payloadOk -and $runningAfterUpgrade -and $identityAfterUpgrade -and $autoAfterUpgrade -and $markerAfterUpgrade
  $scQcAfterUpgrade = (& sc.exe qc CamachoPOSLocalService 2>&1 | Out-String).Trim()
  $helperLogAfterUpgrade = ''
  if (Test-Path -LiteralPath $helperLogPath) {
    $helperLogAfterUpgrade = ((Get-Content -LiteralPath $helperLogPath -Tail 40 -ErrorAction SilentlyContinue) -join ' || ')
  }
  [void]$steps.Add((Write-Step 'paths_after_upgrade' $(if ($upgradeScmOk) { 'PASS' } else { 'FAIL' }) @{
    installDir = $installDir
    payloadDir = $payloadAfter
    payloadOk = $payloadOk
    scmOkMarkerPresent = $markerAfterUpgrade
    servicePresent = [bool]$svcAfterUpgrade
    serviceStatus = $(if ($svcAfterUpgrade) { [string]$svcAfterUpgrade.Status } else { 'Absent' })
    startType = $(if ($svcAfterUpgrade) { [string]$svcAfterUpgrade.StartType } else { '' })
    startName = $startNameAfterUpgrade
    identityOk = $identityAfterUpgrade
    expectedStartName = $expectedScmAccount
    scQc = $scQcAfterUpgrade
    helperLogTail = $helperLogAfterUpgrade
  }))
  if (-not $payloadOk) { throw 'SERVICE_PAYLOAD_MISSING_AFTER_UPGRADE' }
  if (-not $upgradeScmOk) { throw 'WINSW_SCM_MISSING_OR_WRONG_IDENTITY_AFTER_UPGRADE' }

  $verifyOut = & node $markerScript verify $sqlitePath $markerToken 2>&1 | Out-String
  Write-Host $verifyOut
  $sqliteOk = ($LASTEXITCODE -eq 0)
  [void]$steps.Add((Write-Step 'sqlite_preserved_across_upgrade' $(if ($sqliteOk) { 'PASS' } else { 'FAIL' }) @{
    path = $sqlitePath
    output = $verifyOut.Trim()
    exitCode = $LASTEXITCODE
  }))
  if (-not $sqliteOk) { throw 'SQLITE_NOT_PRESERVED_ACROSS_UPGRADE' }

  # --- Product commercial IPC: Electron/Desktop ↔ WinSW NT SERVICE (real handoff) ---
  Write-Host "PHASE=electron_winsw_scm_commercial_ipc"
  $commercialStatus = 'SKIP'
  $commercialDetail = [ordered]@{
    g1NativeOnInstalledScm = $g1Status
    authenticodeProduct = 'RT-009-B_BLOCKED'
    physicalOwnerPc = 'NOT_TESTED'
  }
  if ($g1Status -ne 'PASS') {
    $commercialDetail['reason'] = 'G1_NATIVE_ON_INSTALLED_SCM_REQUIRED'
    [void]$steps.Add((Write-Step 'electron_winsw_scm_commercial_ipc' 'SKIP' $commercialDetail))
  }
  else {
    $commercialScript = Join-Path $RepoRoot 'tools/operators/windows-nsis-scm-commercial-channel.ps1'
    $commercialExit = 1
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $commercialScript `
        -Run `
        -RepoRoot $RepoRoot `
        -PayloadDir $payloadAfter `
        -WorkRoot $WorkRoot `
        -InstalledExe $installedExe
      $commercialExit = $LASTEXITCODE
    }
    catch {
      $commercialExit = 1
      $commercialDetail['exception'] = [string]$_.Exception.Message
      Write-Host ("SCM_COMMERCIAL_CHANNEL_EXCEPTION=" + $_.Exception.Message)
    }
    $commercialDetail['exitCode'] = $commercialExit
    $commercialStatus = $(if ($commercialExit -eq 0) { 'PASS' } else { 'FAIL' })
    [void]$steps.Add((Write-Step 'electron_winsw_scm_commercial_ipc' $commercialStatus $commercialDetail))
    if ($commercialExit -ne 0) { throw 'ELECTRON_WINSW_SCM_COMMERCIAL_IPC_FAILED' }
  }

  # --- Silent uninstall ---
  Write-Host "PHASE=silent_uninstall"
  if (-not $uninstallerExe -or -not (Test-Path -LiteralPath $uninstallerExe)) {
    $layoutForUninstall = Resolve-InstalledLayout
    Apply-ResolvedLayout $layoutForUninstall
  }
  if (-not $uninstallerExe -or -not (Test-Path -LiteralPath $uninstallerExe)) {
    [void]$steps.Add((Write-Step 'silent_uninstall' 'FAIL' @{ reason = 'UNINSTALLER_MISSING'; phase = 'uninstall'; installDir = "$installDir" }))
    throw 'UNINSTALLER_MISSING'
  }
  $trackedInstallDir = $installDir
  $uninstallProc = Start-Process -FilePath $uninstallerExe -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
  # SCM delete can leave a brief "marked for deletion" window; wait for absence.
  $svcAfter = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 30 -and $null -ne $svcAfter; $i++) {
    Start-Sleep -Seconds 1
    $svcAfter = Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
  }
  $pfGone = -not (Test-Path -LiteralPath $programFilesInstallDir)
  $laGone = -not (Test-Path -LiteralPath $localAppInstallDir)
  $trackedGone = -not (Test-Path -LiteralPath $trackedInstallDir)
  $helperLogTail = ''
  $helperLogPath = Join-Path $env:ProgramData 'CamachoPOS\logs\winsw-helper.log'
  if (Test-Path -LiteralPath $helperLogPath) {
    $helperLogTail = ((Get-Content -LiteralPath $helperLogPath -Tail 40 -ErrorAction SilentlyContinue) -join ' || ')
  }
  if ($uninstallProc.ExitCode -ne 0) {
    [void]$steps.Add((Write-Step 'silent_uninstall' 'FAIL' @{
      exitCode = $uninstallProc.ExitCode
      installDirRemoved = $trackedGone
      programFilesRemoved = $pfGone
      localAppRemoved = $laGone
      phase = 'uninstall'
      helperLogTail = $helperLogTail
    }))
    throw "SILENT_UNINSTALL_FAILED:exit=$($uninstallProc.ExitCode)"
  }
  [void]$steps.Add((Write-Step 'silent_uninstall' 'PASS' @{
    exitCode = 0
    installDirRemoved = $trackedGone
    programFilesRemoved = $pfGone
    localAppRemoved = $laGone
    uninstaller = $uninstallerExe
  }))

  $scAfter = (& sc.exe query CamachoPOSLocalService 2>&1 | Out-String).Trim()
  [void]$steps.Add((Write-Step 'winsw_scm_removed_after_uninstall' $(if ($null -eq $svcAfter) { 'PASS' } else { 'FAIL' }) @{
    servicePresent = [bool]$svcAfter
    scQuery = $scAfter
    helperLogTail = $helperLogTail
    note = 'NSIS customUnInstall must remove CamachoPOSLocalService without wiping commercial data'
  }))
  if ($null -ne $svcAfter) { throw 'WINSW_SCM_STILL_REGISTERED_AFTER_UNINSTALL' }

  $sqliteAfterUninstall = Test-Path -LiteralPath $sqlitePath
  [void]$steps.Add((Write-Step 'residuals_after_uninstall' 'PASS' @{
    note = 'deleteAppDataOnUninstall=false; commercial/AppData retention expected'
    sqliteStillPresent = $sqliteAfterUninstall
    installDirPresent = (-not $trackedGone)
    programFilesPresent = (-not $pfGone)
    localAppPresent = (-not $laGone)
  }))

  # Cleanup lab SQLite only (do not claim commercial wipe of other AppData).
  try {
    if (Test-Path -LiteralPath $dataDirectory) {
      Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
catch {
  $errMsg = [string]$_.Exception.Message
  $stack = [string]$_.ScriptStackTrace
  $errType = [string]$_.Exception.GetType().FullName
  Write-Host "LIFECYCLE_ERROR=$errMsg"
  Write-Host "LIFECYCLE_EXCEPTION_TYPE=$errType"
  Write-Host "SCRIPT_STACK_TRACE=$stack"
  [void]$steps.Add((Write-Step 'lifecycle_exception' 'FAIL' @{
    message = $errMsg
    exceptionType = $errType
    scriptStackTrace = $stack
  }))
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
