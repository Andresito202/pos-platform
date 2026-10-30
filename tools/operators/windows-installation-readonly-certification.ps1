#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only certification inventory for the currently installed Camacho POS Windows service.
.DESCRIPTION
  Does not install, start, stop, restart, reconfigure, grant privileges, or read
  protected credential contents. Operates only on local SCM metadata and file
  metadata. Writes JSON evidence in a unique directory under TEMP.
  NOT_INSTALLED is a truthful non-PASS result, never an installer simulation.
#>
[CmdletBinding()]
param(
  [string]$ServiceName = 'CamachoPOSLocalService'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedName = 'CamachoPOSLocalService'
if ($ServiceName -cne $expectedName) { throw 'SERVICE_NAME_NOT_ALLOWLISTED' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }

$logDir = Join-Path ([IO.Path]::GetTempPath()) ('camacho-pos-windows-readonly-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $logDir -ErrorAction Stop | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [string]$Status, [string]$Detail) {
  $script:results.Add([pscustomobject]@{ check=$Name; status=$Status; detail=$Detail })
  Write-Host ("{0}: {1} - {2}" -f $Status,$Name,$Detail)
}

$sha = (& git rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0) { $sha = $null }
$service = Get-CimInstance -ClassName Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction Stop
if ($null -eq $service) {
  Add-Check 'SCM_SERVICE_PRESENT' 'NOT_VERIFIED' 'Service not installed; no changes made'
} else {
  Add-Check 'SCM_SERVICE_PRESENT' 'PASS' 'Expected Windows service exists'
  if ($service.StartMode -eq 'Auto') {
    Add-Check 'SCM_START_MODE' 'PASS' 'Automatic'
  } else {
    Add-Check 'SCM_START_MODE' 'FAIL' ('Observed: ' + $service.StartMode)
  }
  if ($service.StartName -eq 'NT SERVICE\CamachoPOSLocalService') {
    Add-Check 'SCM_ACCOUNT' 'PASS' 'Expected virtual service identity'
  } else {
    Add-Check 'SCM_ACCOUNT' 'FAIL' ('Unexpected identity: ' + $service.StartName)
  }
  if ($service.State -eq 'Running') {
    Add-Check 'SCM_RUNNING' 'PASS' 'Running at observation time'
  } else {
    Add-Check 'SCM_RUNNING' 'NOT_VERIFIED' ('Observed: ' + $service.State)
  }
  $scm = & sc.exe qc $expectedName 2>&1
  if ($LASTEXITCODE -eq 0) {
    $output = ($scm -join [Environment]::NewLine)
    if ($output -match 'BINARY_PATH_NAME') {
      Add-Check 'SCM_BINARY_PATH_METADATA' 'PASS' 'SCM configuration query succeeded'
    } else {
      Add-Check 'SCM_BINARY_PATH_METADATA' 'NOT_VERIFIED' 'Unable to identify binary path in SCM output'
    }
  } else {
    Add-Check 'SCM_BINARY_PATH_METADATA' 'NOT_VERIFIED' 'SCM query unavailable'
  }
  # No termination or fault injection. A running service does not prove
  # stop/restart safety, SQLite durability, DPAPI or named-pipe interoperability.
}

$checks = @($results.ToArray())
$required = @('SCM_SERVICE_PRESENT', 'SCM_START_MODE', 'SCM_ACCOUNT', 'SCM_RUNNING', 'SCM_BINARY_PATH_METADATA')
$allPass = $true
foreach ($name in $required) {
  if (@($checks | Where-Object { $_.check -eq $name -and $_.status -eq 'PASS' }).Count -ne 1) {
    $allPass = $false
  }
}
$status = if ($allPass) { 'PASS_READONLY_INVENTORY' } else { 'NOT_CERTIFIED' }
$receipt = [ordered]@{
  schema = 'camacho-pos-windows-scm-readonly/v1'
  git_commit = if ($sha) { ($sha -join '').Trim() } else { $null }
  service_name = $expectedName
  observed_at_utc = [DateTime]::UtcNow.ToString('o')
  status = $status
  installation_certified = $false
  service_restart_certified = $false
  commercial_login_certified = $false
  installed_hardware_certified = $false
  safety = 'READ_ONLY_NO_SCM_MUTATION'
  checks = $checks
}
$json = ConvertTo-Json -InputObject $receipt -Depth 8
$receiptPath = Join-Path $logDir 'receipt.json'
[IO.File]::WriteAllText($receiptPath, ($json + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
$digest = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $logDir 'receipt.json.sha256'), ($digest + '  receipt.json' + [Environment]::NewLine))
Write-Host ('WINDOWS_SCM_READONLY_RECEIPT=' + $receiptPath)
Write-Host ('WINDOWS_SCM_READONLY_RESULT=' + $status)
if (-not $allPass) { exit 1 }
