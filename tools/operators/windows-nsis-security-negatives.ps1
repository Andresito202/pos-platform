#requires -Version 5.1
<#
.SYNOPSIS
  Negative ACL / impersonation / credential-manipulation checks for NSIS lab.

.DESCRIPTION
  Fail-closed lab probes only. Never softens product gates. Expects the
  CamachoPOSLocalService payload under Program Files and ProgramData lab paths.
#>
[CmdletBinding()]
param(
  [switch]$Run,
  [Parameter(Mandatory = $true)][string]$PayloadDir,
  [Parameter(Mandatory = $true)][string]$ScmDataDirectory,
  [Parameter(Mandatory = $true)][string]$WorkRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Must([bool]$ok, [string]$code) {
  if (-not $ok) { throw $code }
}

Must ([bool]$Run) 'EXPLICIT_RUN_REQUIRED'
Must ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'

$steps = [System.Collections.Generic.List[object]]::new()
function Add-Step([string]$Name, [string]$Status, [hashtable]$Detail = @{}) {
  $obj = [ordered]@{ name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToUniversalTime().ToString('o') }
  [void]$steps.Add($obj)
  Write-Host ("NEG={0} STATUS={1}" -f $Name, $Status)
}

$report = Join-Path $WorkRoot 'nsis-security-negatives.json'
$serviceSid = 'S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$failed = 0

try {
  Must (Test-Path -LiteralPath $PayloadDir -PathType Container) 'PAYLOAD_DIR_MISSING'
  Must (Test-Path -LiteralPath $ScmDataDirectory -PathType Container) 'SCM_DATA_DIR_MISSING'

  # --- Unauthorized write into Program Files payload must be denied for Users ---
  $probeFile = Join-Path $PayloadDir ('unauthorized-write-' + [Guid]::NewGuid().ToString('N') + '.txt')
  $wrote = $false
  try {
    [IO.File]::WriteAllText($probeFile, 'SHOULD_FAIL')
    $wrote = $true
  }
  catch {
    $wrote = $false
  }
  if ($wrote) {
    try { Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue } catch {}
    # Admin runner can write Program Files; verify ACL still includes virtual account RX and no Everyone write.
    $icacls = (& icacls.exe $PayloadDir 2>&1 | Out-String)
    $hasEveryoneWrite = $icacls -match '(?i)\(Everyone\).*\((W|M|F)\)'
    $hasUsersFull = $icacls -match '(?i)\(BUILTIN\\Users\).*\(F\)'
    if ($hasEveryoneWrite -or $hasUsersFull) {
      Add-Step 'negative_payload_world_writable' 'FAIL' @{ icacls = $icacls.Trim(); note = 'Payload ACL too open' }
      $failed++
    }
    else {
      Add-Step 'negative_payload_world_writable' 'PASS' @{
        note = 'Admin lab runner can write Program Files; Everyone/Users-Full absent'
        icaclsPresent = ($icacls.Length -gt 0)
      }
    }
  }
  else {
    Add-Step 'negative_payload_unauthorized_write' 'PASS' @{ note = 'Non-writable payload path rejected write' }
  }

  # --- Virtual account ACL must be present on payload (impersonation surface) ---
  $icaclsPayload = (& icacls.exe $PayloadDir 2>&1 | Out-String)
  $virtualPresent = $icaclsPayload -match [regex]::Escape($serviceSid) -or $icaclsPayload -match 'CamachoPOSLocalService'
  if ($virtualPresent) {
    Add-Step 'negative_virtual_account_acl_present' 'PASS' @{ serviceSid = $serviceSid }
  }
  else {
    Add-Step 'negative_virtual_account_acl_present' 'FAIL' @{ icacls = $icaclsPayload.Trim() }
    $failed++
  }

  # --- Forge / manipulate channel secret path: missing or world-readable is FAIL ---
  $secretCandidates = @(
    (Join-Path $ScmDataDirectory 'security\local-channel-auth.secret'),
    (Join-Path $env:APPDATA 'Camacho POS Colombia\lab-data\security\local-channel-auth.secret')
  )
  $secretFound = $false
  foreach ($secretPath in $secretCandidates) {
    if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
      $secretFound = $true
      $acl = Get-Acl -LiteralPath $secretPath
      $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      $bad = $false
      foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($ace.AccessControlType -ne 'Allow') { continue }
        $sid = $ace.IdentityReference.Value
        if ($sid -in @('S-1-1-0', 'S-1-5-11')) { $bad = $true } # Everyone / Authenticated Users
      }
      if ($bad) {
        Add-Step 'negative_channel_secret_acl' 'FAIL' @{ path = $secretPath; owner = $owner; reason = 'WORLD_OR_AUTHENTICATED_ACE' }
        $failed++
      }
      else {
        Add-Step 'negative_channel_secret_acl' 'PASS' @{ path = $secretPath; owner = $owner }
      }
      break
    }
  }
  if (-not $secretFound) {
    Add-Step 'negative_channel_secret_acl' 'SKIP' @{ reason = 'SECRET_NOT_YET_PROVISIONED_AT_THIS_PHASE' }
  }

  # --- Credential forgery: empty / garbage POS_WINDOWS_SCM_HANDOFF_FILE must not start product under SCM ---
  # Uses the installed node bundle if present; otherwise SKIP.
  $bundle = Get-ChildItem -LiteralPath $PayloadDir -Filter 'main.js' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  $nodeExe = Join-Path $PayloadDir 'node\node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    $nodeExe = Join-Path $PayloadDir 'runtime\node.exe'
  }
  if ($null -ne $bundle -and (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
    $fake = Join-Path $WorkRoot ('forge-provision-' + [Guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($fake, '{"version":1,"role":"SERVICE","forged":true}')
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeExe
    $psi.Arguments = '"' + $bundle.FullName + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    # Windows PowerShell 5.1 / nsExec-safe: EnvironmentVariables, not .Environment.
    $envMap = $psi.EnvironmentVariables
    $envMap['POS_WINDOWS_SCM_HANDOFF_FILE'] = $fake
    $envMap['POS_DATA_DIRECTORY'] = (Join-Path $WorkRoot 'forge-data-must-not-exist')
    $envMap['POS_INSTALLATION_ID'] = [guid]::NewGuid().ToString()
    $envMap['POS_DEVICE_ID'] = [guid]::NewGuid().ToString()
    $envMap['POS_TENANT_ID'] = [guid]::NewGuid().ToString()
    $envMap['POS_COMPANY_ID'] = [guid]::NewGuid().ToString()
    $envMap['POS_BRANCH_ID'] = [guid]::NewGuid().ToString()
    $envMap['POS_SERVICE_VERSION'] = '1.0.0'
    $envMap['POS_PROTOCOL_MIN'] = '1.0.0'
    $envMap['POS_PROTOCOL_MAX'] = '1.0.0'
    $p = [Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit(15000)) {
      try { $p.Kill() } catch {}
      Add-Step 'negative_forged_scm_provision_startup' 'FAIL' @{ reason = 'TIMEOUT' }
      $failed++
    }
    else {
      $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
      # Interactive hosts must fail closed before SQLite; service Session-0 context is required.
      $gateHeld = $out -match 'SCM_COMMERCIAL_SERVICE_CONTEXT_REQUIRED|SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      $started = $out -match 'runtime\.started'
      $dataCreated = Test-Path -LiteralPath (Join-Path $WorkRoot 'forge-data-must-not-exist')
      if ($gateHeld -and -not $started -and -not $dataCreated -and $p.ExitCode -ne 0) {
        Add-Step 'negative_forged_scm_provision_startup' 'PASS' @{
          exitCode = $p.ExitCode
          gate = 'SCM_COMMERCIAL_SERVICE_CONTEXT_REQUIRED'
        }
      }
      else {
        Add-Step 'negative_forged_scm_provision_startup' 'FAIL' @{
          exitCode = $p.ExitCode
          gateHeld = $gateHeld
          started = $started
          dataCreated = $dataCreated
          outputTail = $out.Substring([Math]::Max(0, $out.Length - 500))
        }
        $failed++
      }
    }
  }
  else {
    Add-Step 'negative_forged_scm_provision_startup' 'SKIP' @{ reason = 'BUNDLE_OR_NODE_NOT_FOUND_IN_PAYLOAD' }
  }

  # --- Service must not be LocalSystem (impersonation of wrong account) ---
  $cim = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction SilentlyContinue
  if ($null -eq $cim) {
    Add-Step 'negative_service_not_localsystem' 'FAIL' @{ reason = 'SERVICE_ABSENT' }
    $failed++
  }
  elseif ($cim.StartName -eq 'LocalSystem' -or $cim.StartName -eq 'NT AUTHORITY\SYSTEM') {
    Add-Step 'negative_service_not_localsystem' 'FAIL' @{ startName = $cim.StartName }
    $failed++
  }
  elseif ($cim.StartName -eq 'NT SERVICE\CamachoPOSLocalService') {
    Add-Step 'negative_service_not_localsystem' 'PASS' @{ startName = $cim.StartName }
  }
  else {
    Add-Step 'negative_service_not_localsystem' 'FAIL' @{ startName = $cim.StartName; expected = 'NT SERVICE\CamachoPOSLocalService' }
    $failed++
  }
}
catch {
  Add-Step 'negative_suite_exception' 'FAIL' @{ message = [string]$_.Exception.Message }
  $failed++
}

$payload = [ordered]@{
  schema = 'camacho-nsis-security-negatives/v1'
  failed = $failed
  steps  = @($steps.ToArray())
}
$payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $report -Encoding utf8
Write-Host "NEGATIVES_REPORT=$report"
Write-Host "NEGATIVES_FAILED=$failed"
if ($failed -gt 0) { exit 1 }
exit 0
