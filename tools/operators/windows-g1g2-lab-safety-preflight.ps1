#requires -Version 5.1
<#
Read-only G1/G2 Windows lab inventory. Never installs/stops services, changes
ACLs, reads private keys/SQLite contents, or prints environment variable values.
An assessment is NOT authorization to run SCM or evidence of channel interoperability.
#>
[CmdletBinding()]
param([switch]$Json)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'G1G2_LAB_PREFLIGHT_REQUIRES_WINDOWS' }

$blocks = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$old = Get-CimInstance Win32_Service -Filter "Name='PosLocalService'" -ErrorAction Stop
$commercial = Get-CimInstance Win32_Service -Filter "Name='CamachoPOSLocalService'" -ErrorAction Stop
$oldActive = $null -ne $old -and $old.State -eq 'Running'
$oldDataDefined = $false
$oldDataExists = $false
$oldConfigurationPath = Join-Path $root 'apps\pos-local-service\.lab-state\service\pos-local-service.xml'
if ([IO.File]::Exists($oldConfigurationPath)) {
  try {
    [xml]$oldConfig = [IO.File]::ReadAllText($oldConfigurationPath)
    $oldDataValue = @($oldConfig.service.env | Where-Object { $_.name -eq 'POS_DATA_DIRECTORY' } | Select-Object -First 1)
    if ($oldDataValue.Count -gt 0) {
      $oldDataDefined = -not [string]::IsNullOrWhiteSpace($oldDataValue[0].value)
      if ($oldDataDefined) { $oldDataExists = Test-Path -LiteralPath $oldDataValue[0].value -PathType Container }
    }
  } catch { [void]$warnings.Add('LEGACY_CONFIG_NOT_PARSEABLE') }
}
if ($oldActive) { [void]$warnings.Add('LEGACY_POS_SERVICE_ACTIVE_PRESERVE_UNCHANGED') }
if ($oldDataExists) { [void]$warnings.Add('LEGACY_SQLITE_DPAPI_DATA_EXISTS_DO_NOT_REUSE') }
if ($null -ne $commercial) { [void]$blocks.Add('COMMERCIAL_SCM_SERVICE_ALREADY_REGISTERED_INSPECT_MANUALLY') }

$labRoot = 'C:\ProgramData\CamachoPOS-G1G2-Lab'
$labExists = Test-Path -LiteralPath $labRoot
if ($labExists) { [void]$blocks.Add('LAB_ROOT_ALREADY_EXISTS_REQUIRES_MANUAL_REVIEW') }

$winsw = Join-Path $root 'apps\pos-local-service\.lab-state\winsw\WinSW-x64.exe'
$winswPresent = [IO.File]::Exists($winsw)
$winswSigned = $false
$winswVersionOk = $false
if ($winswPresent) {
  $winswVersionOk = (Get-Item -LiteralPath $winsw).VersionInfo.ProductVersion -match '^2\.12\.0(?:[.+ -]|$)'
  $winswSigned = (Get-AuthenticodeSignature -LiteralPath $winsw).Status -eq 'Valid'
}
if (-not $winswPresent) { [void]$blocks.Add('WINSW_LAB_CANDIDATE_NOT_FOUND') }
if ($winswPresent -and -not $winswSigned) { [void]$blocks.Add('WINSW_AUTHENTICODE_NOT_VALID') }
if ($winswPresent -and -not $winswVersionOk) { [void]$blocks.Add('WINSW_VERSION_NOT_APPROVED') }
# This never attempts to classify ACLs, signer pinning, DPAPI or cross-identity proof.
[void]$blocks.Add('SCM_CROSS_IDENTITY_PHYSICAL_CERTIFICATION_PENDING')

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$hyperVState = 'UNKNOWN'
try {
  $feature = Get-WindowsOptionalFeature -Online -FeatureName 'Microsoft-Hyper-V-All' -ErrorAction Stop
  $hyperVState = [string]$feature.State
} catch {
  [void]$warnings.Add('HYPERV_FEATURE_STATE_NOT_READABLE')
}
if ($hyperVState -ne 'Enabled') { [void]$warnings.Add('HYPERV_LAB_NOT_CONFIGURED') }

$report = [pscustomobject]@{
  Scope='READ_ONLY_HOST_LAB_INVENTORY'
  Elevated=$elevated
  LegacyServiceRegistered=($null -ne $old)
  LegacyServiceRunning=$oldActive
  LegacyDataPathConfigured=$oldDataDefined
  LegacyDataPathExists=$oldDataExists
  CommercialServiceRegistered=($null -ne $commercial)
  SeparateLabRootExists=[bool]$labExists
  HyperVFeatureState=$hyperVState
  WinSWCandidatePresent=$winswPresent
  WinSWVersion2_12=$winswVersionOk
  WinSWAuthenticodeValid=$winswSigned
  CommercialScmCertified=$false
  HumanMfaCertified=$false
  Blockers=@($blocks.ToArray())
  Warnings=@($warnings.ToArray())
}
if ($Json) { $report | ConvertTo-Json -Depth 4 }
else { $report | Format-List }
# For tooling: nonzero means NOT approved for a privileged install, not a probe crash.
if ($blocks.Count -gt 0) { exit 2 }
