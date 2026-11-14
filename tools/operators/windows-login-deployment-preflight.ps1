#requires -Version 5.1
<#
Camacho POS - P0 Windows login deployment inventory.
Read-only. Never creates identities, credentials, Windows services, files, or keys.
Examines only the invoking PowerShell process and Windows service registry.
Presence of a variable is not proof that a service uses or trusts its contents.
#>
[CmdletBinding()]
param([switch]$Json, [switch]$Interactive)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_LOGIN_PREFLIGHT_REQUIRES_WINDOWS' }

$serviceName = 'CamachoPOSLocalService'
$required = @(
  'POS_DATA_DIRECTORY',
  'POS_INSTALLATION_ID',
  'POS_DEVICE_ID',
  'POS_TENANT_ID',
  'POS_COMPANY_ID',
  'POS_BRANCH_ID',
  'POS_SERVICE_VERSION',
  'POS_PROTOCOL_MIN',
  'POS_PROTOCOL_MAX',
  'POS_CENTRAL_BASE_URL',
  'POS_WINDOWS_COMMERCIAL_PROVISION_FILE',
  'POS_WINDOWS_DESKTOP_COMMERCIAL_FILE',
  'POS_SESSION_TRUST_ENVIRONMENT',
  'POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM',
  'POS_AUTHORIZATION_TRUST_PROVISION_FILE'
)
$managedFiles = @(
  'POS_WINDOWS_COMMERCIAL_PROVISION_FILE',
  'POS_WINDOWS_DESKTOP_COMMERCIAL_FILE',
  'POS_AUTHORIZATION_TRUST_PROVISION_FILE',
  'POS_SESSION_TRUST_ARTIFACT_PATH',
  'POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE'
)
$optional = @('POS_SESSION_TRUST_ARTIFACT_PATH','POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE')
$names = @($required + $optional | Select-Object -Unique)
$observed = @(
  foreach ($name in $names) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    $processPresent = -not [string]::IsNullOrWhiteSpace($value)
    $userPresent = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name,'User'))
    $machinePresent = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name,'Machine'))
    $fileExists = $null
    if ($name -in $managedFiles -and $processPresent) {
      $fileExists = [IO.Path]::IsPathRooted($value) -and
        [IO.File]::Exists($value)
    }
    [pscustomobject]@{
      Variable=$name
      Process=$processPresent
      User=$userPresent
      Machine=$machinePresent
      FileExistsInProcess=$fileExists
    }
  }
)
$blocks = New-Object 'System.Collections.Generic.List[string]'
$missing = @($observed | Where-Object { $_.Variable -in $required -and -not $_.Process } |
  ForEach-Object { $_.Variable })
if ($missing.Count -gt 0) { [void]$blocks.Add('PROCESS_CONFIGURATION_INCOMPLETE') }

# Current process only. It does not inspect a service's child-process token.
# Never print the Windows user name, SID or memberships to operator logs.
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$identityName = $currentIdentity.Name
$restrictedIdentity = $identityName.StartsWith('NT SERVICE\', [StringComparison]::OrdinalIgnoreCase) -or
  $identityName.StartsWith('NT AUTHORITY\', [StringComparison]::OrdinalIgnoreCase)
$logonGroups = @($currentIdentity.Groups | ForEach-Object { $_.Value })
$interactivePresent = @($logonGroups | Where-Object { $_ -in @('S-1-5-4','S-1-5-14') }).Count -gt 0
$processEligible = $currentIdentity.IsAuthenticated -and -not $currentIdentity.IsSystem -and
  -not $currentIdentity.IsAnonymous -and -not $restrictedIdentity -and $interactivePresent
if (-not $processEligible) { [void]$blocks.Add('CURRENT_PROCESS_NOT_INTERACTIVE_HOST') }

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service -and -not $Interactive) { [void]$blocks.Add('WINDOWS_SERVICE_NOT_REGISTERED') }
$accountModel = 'UNKNOWN'
if ($service) {
  try {
    $record = Get-CimInstance -ClassName Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
    if ($null -ne $record) {
      if ($record.StartName -eq 'NT SERVICE\CamachoPOSLocalService') {
        $accountModel = 'SCM_VIRTUAL_ACCOUNT'
      } else {
        $accountModel = 'OTHER_SCM_LOGON_CONTEXT'
      }
    }
  } catch {
    $accountModel = 'SCM_IDENTITY_NOT_INSPECTABLE'
  }
}

# Cross-logon channel design blocker, independent of presence-only probes:
# - WinSW descriptor uses NT SERVICE\CamachoPOSLocalService.
# - packages/local-channel/src/windows-production.ts uses DPAPI CurrentUser.
# - named pipe DACL uses the server's own S-1-5-5-* logon SID.
# Interactive Electron has a different Windows logon context. An installer
# cannot make that channel work merely by setting environment variables.
if (-not $Interactive) { [void]$blocks.Add('SCM_INTERACTIVE_CHANNEL_HANDOFF_NOT_IMPLEMENTED') }

# Either a signed installer artifact or the authenticated Central trust transport
# is required to bootstrap SSA for a commercial interactive session.
$ssaSources = @('POS_SESSION_TRUST_ARTIFACT_PATH','POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE')
$ssaDistributionPresent = @($observed | Where-Object { $_.Variable -in $ssaSources -and $_.Process -and $_.FileExistsInProcess -eq $true }).Count -gt 0
if (-not $ssaDistributionPresent) { [void]$blocks.Add('SSA_TRUST_DISTRIBUTION_NOT_CONFIGURED') }

$filesAbsent = @($observed | Where-Object {
  $_.Variable -in $managedFiles -and $_.Process -and $_.FileExistsInProcess -eq $false
} | ForEach-Object { $_.Variable })
if ($filesAbsent.Count -gt 0) {
  [void]$blocks.Add('REFERENCED_MANAGED_FILE_NOT_FOUND')
}

$result = [pscustomobject]@{
  Scope=if ($Interactive) { 'READ_ONLY_INTERACTIVE_LOGIN_CONFIGURATION' } else { 'READ_ONLY_CURRENT_WINDOWS_PROCESS' }
  HostMode=if ($Interactive) { 'INTERACTIVE_SAME_LOGON' } else { 'SCM_SERVICE' }
  ServiceRegistered=($null -ne $service)
  ServiceState=if ($service) { [string]$service.Status } else { 'NOT_REGISTERED' }
  ServiceAccountModel=$accountModel
  CurrentProcessInteractiveEligible=[bool]$processEligible
  Variables=$observed
  MissingRequiredVariableNames=$missing
  MissingReferencedFileNames=$filesAbsent
  ScmCommercialLoginReady=$false
  HumanLoginCertified=$false
  ConfigurationPresenceOnly=($blocks.Count -eq 0)
  ScmLimitations=@('SCM_INTERACTIVE_CHANNEL_HANDOFF_NOT_IMPLEMENTED')
  Blockers=@($blocks.ToArray())
}
if ($Json) {
  $result | ConvertTo-Json -Depth 6
} else {
  Write-Output 'CAMACHO POS - Login P0 - diagnostico SIN CAMBIOS'
  Write-Output ('Modo preflight: ' + $result.HostMode)
  Write-Output ('Servicio SCM: ' + $result.ServiceState)
  Write-Output ('Cuenta SCM: ' + $accountModel)
  Write-Output ('Contexto interactivo de este PowerShell: ' + [string]$result.CurrentProcessInteractiveEligible)
  $observed | Format-Table Variable,Process,User,Machine,FileExistsInProcess -AutoSize | Out-String |
    Write-Output
  Write-Output ('Bloqueos del modo seleccionado: ' + ($result.Blockers -join ', '))
  if ($Interactive) { Write-Output 'WinSW comercial permanece sin interop certificada; no es requisito del host interactivo.' }
  Write-Output 'Los estados de presencia no autorizan login, creacion de usuarios ni acceso al dashboard.'
}
if ($blocks.Count -gt 0) { exit 2 }
