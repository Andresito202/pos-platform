#requires -Version 5.1
<#
  Elevated helper: materialize WinSW XML from template, install/start or stop/uninstall
  CamachoPOSLocalService. Used by NSIS custom actions and the lab lifecycle.

  Does NOT clear SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN.
  Does NOT claim Authenticode for Camacho PE (RT-009-B).
  Verifies WinSW payload SHA-256 against payload-integrity.json when present.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall', 'Status')][string]$Action,
  [Parameter(Mandatory = $true)][string]$PayloadDir,
  [string]$DataDirectory,
  [string]$InstallationId = '018f0000-0000-7000-8000-0000000000a1',
  [string]$DeviceId = '018f0000-0000-7000-8000-0000000000a2',
  [string]$TenantId = '018f0000-0000-7000-8000-0000000000a3',
  [string]$CompanyId = '018f0000-0000-7000-8000-0000000000a4',
  [string]$BranchId = '018f0000-0000-7000-8000-0000000000a5',
  [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceId = 'CamachoPOSLocalService'
$winswExe = Join-Path $PayloadDir "$serviceId.exe"
$template = Join-Path $PayloadDir "$serviceId.xml.template"
$xmlPath = Join-Path $PayloadDir "$serviceId.xml"
$nodeExe = Join-Path $PayloadDir 'runtime\node.exe'
$bundle = Join-Path $PayloadDir 'local-service\pos-local-service.mjs'
$workDir = Join-Path $PayloadDir 'local-service'
$integrityFile = Join-Path $PayloadDir 'payload-integrity.json'

function Write-Result([hashtable]$obj, [int]$code) {
  if ($Json) { $obj | ConvertTo-Json -Depth 6 -Compress | Write-Output }
  else { $obj.GetEnumerator() | ForEach-Object { Write-Host ("{0}={1}" -f $_.Key, $_.Value) } }
  exit $code
}

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Result @{ ok = $false; error = 'ELEVATION_REQUIRED' } 2
  }
}

function Assert-Payload {
  foreach ($p in @($winswExe, $template, $nodeExe, $bundle)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
      Write-Result @{ ok = $false; error = "PAYLOAD_MISSING:$p" } 3
    }
  }
  if (Test-Path -LiteralPath $integrityFile) {
    $integrity = Get-Content -LiteralPath $integrityFile -Raw | ConvertFrom-Json
    $hash = (Get-FileHash -LiteralPath $winswExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = [string]$integrity.winsw.sha256
    if ($expected -and $hash -ne $expected.ToLowerInvariant()) {
      Write-Result @{ ok = $false; error = 'WINSW_SHA256_MISMATCH'; hash = $hash; expected = $expected } 4
    }
  }
}

function Materialize-Xml {
  if ([string]::IsNullOrWhiteSpace($DataDirectory)) {
    $DataDirectory = Join-Path $env:ProgramData 'CamachoPOS\lab-data'
  }
  New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
  $security = Join-Path $DataDirectory 'security'
  New-Item -ItemType Directory -Force -Path $security | Out-Null

  $xml = [IO.File]::ReadAllText($template)
  $xml = $xml.Replace('__CAMACHO_SERVICE_NODE__', $nodeExe)
  $xml = $xml.Replace('__CAMACHO_SERVICE_BUNDLE__', $bundle)
  $xml = $xml.Replace('__CAMACHO_SERVICE_WORKDIR__', $workDir)
  $xml = $xml.Replace('__CAMACHO_POS_DATA_DIRECTORY__', $DataDirectory)
  $xml = $xml.Replace('__CAMACHO_POS_INSTALLATION_ID__', $InstallationId)
  $xml = $xml.Replace('__CAMACHO_POS_DEVICE_ID__', $DeviceId)
  $xml = $xml.Replace('__CAMACHO_POS_TENANT_ID__', $TenantId)
  $xml = $xml.Replace('__CAMACHO_POS_COMPANY_ID__', $CompanyId)
  $xml = $xml.Replace('__CAMACHO_POS_BRANCH_ID__', $BranchId)
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.UTF8Encoding]::new($false))
}

function Invoke-WinSW {
  # Never name a parameter $args — it collides with the automatic $args variable
  # and Start-Process -ArgumentList receives $null ("Argument types"/null collection).
  param([Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$WinSwArguments)
  $clean = @($WinSwArguments | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  if ($clean.Count -eq 0) {
    throw 'WINSW_ARGUMENTS_EMPTY'
  }
  $p = Start-Process -FilePath $winswExe `
    -ArgumentList $clean `
    -WorkingDirectory $PayloadDir `
    -Wait -PassThru -NoNewWindow
  if ($null -eq $p) { return -1 }
  return [int]$p.ExitCode
}

switch ($Action) {
  'Status' {
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    Write-Result @{
      ok = $true
      registered = [bool]$svc
      status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
      startType = $(if ($svc) { [string]$svc.StartType } else { '' })
      payloadDir = $PayloadDir
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    } 0
  }
  'Install' {
    Assert-Admin
    Assert-Payload
    Materialize-Xml
    $existing = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    if ($existing) {
      try { Stop-Service -Name $serviceId -Force -ErrorAction SilentlyContinue } catch {}
      [void](Invoke-WinSW -WinSwArguments @('uninstall'))
      Start-Sleep -Seconds 2
    }
    $installCode = Invoke-WinSW -WinSwArguments @('install')
    if ($installCode -ne 0) {
      Write-Result @{ ok = $false; error = 'WINSW_INSTALL_FAILED'; exitCode = $installCode; xml = $xmlPath; payloadDir = $PayloadDir } 5
    }
    $startCode = Invoke-WinSW -WinSwArguments @('start')
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    $running = $null -ne $svc -and $svc.Status -eq 'Running'
    if (-not $running -and $startCode -ne 0) {
      Write-Result @{ ok = $false; error = 'WINSW_START_FAILED'; exitCode = $startCode; status = $(if ($svc) { [string]$svc.Status } else { 'Absent' }); xml = $xmlPath } 6
    }
    # Give Node child time to bind pipe / open SQLite
    Start-Sleep -Seconds 5
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    Write-Result @{
      ok = ($null -ne $svc)
      registered = ($null -ne $svc)
      status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
      dataDirectory = $DataDirectory
      xml = $xmlPath
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      authenticodeProduct = 'RT-009-B_BLOCKED'
      note = 'Service installed; commercial Desktop↔NT SERVICE IPC remains NOT_PROVEN until handoff certified'
    } $(if ($null -ne $svc) { 0 } else { 7 })
  }
  'Uninstall' {
    Assert-Admin
    Assert-Payload
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    if ($svc) {
      try { Stop-Service -Name $serviceId -Force -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Seconds 2
      [void](Invoke-WinSW -WinSwArguments @('uninstall'))
      Start-Sleep -Seconds 2
    }
    $after = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    # Never delete commercial AppData / ProgramData SQLite here.
    Write-Result @{
      ok = ($null -eq $after)
      registered = ($null -ne $after)
      dataPreserved = $true
      note = 'Service removed; commercial data directories left intact'
    } $(if ($null -eq $after) { 0 } else { 8 })
  }
}
