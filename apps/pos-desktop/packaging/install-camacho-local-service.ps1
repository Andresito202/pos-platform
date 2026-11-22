#requires -Version 5.1
<#
  Elevated helper: materialize WinSW XML from template, install/start or stop/uninstall
  CamachoPOSLocalService. Used by NSIS custom actions and the lab lifecycle.

  NSIS nsExec constraint (observed on GHA windows-2022):
  - Microsoft.PowerShell.Security often fails to load → Get-Acl/Set-Acl unusable.
  - Microsoft.PowerShell.Utility may fail for Get-FileHash.
  Critical path therefore uses native System32 tools (sc.exe, icacls.exe, certutil.exe)
  with verified paths + exit codes, plus BCL for crypto/SID. No broad ACL grants
  (Users/Everyone/Authenticated Users are never added).

  Does NOT clear SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN.
  Does NOT claim Authenticode for Camacho PE (RT-009-B).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall', 'Status', 'PreparePhysicalCertification')][string]$Action,
  [Parameter(Mandatory = $true)][string]$PayloadDir,
  [string]$DataDirectory,
  [string]$InstallationId,
  [string]$DeviceId,
  [string]$TenantId,
  [string]$CompanyId,
  [string]$BranchId,
  # Authenticated SCM pair for the managed SERVICE. Both required together; never
  # a commercial enable flag. Install still fails closed until physical certification.
  [string]$ScmHandoffFile,
  [string]$ScmCentralProvisionFile,
  # Owner attestation JSON for PreparePhysicalCertification only. Never an enable flag.
  [string]$PhysicalCertificationAttestation,
  [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceId = 'CamachoPOSLocalService'
$serviceAccount = "NT SERVICE\$serviceId"
$winswExe = Join-Path $PayloadDir "$serviceId.exe"
$template = Join-Path $PayloadDir "$serviceId.xml.template"
$xmlPath = Join-Path $PayloadDir "$serviceId.xml"
$nodeExe = Join-Path $PayloadDir 'runtime\node.exe'
$bundle = Join-Path $PayloadDir 'local-service\pos-local-service.mjs'
$workDir = Join-Path $PayloadDir 'local-service'
$integrityFile = Join-Path $PayloadDir 'payload-integrity.json'
$logDirectory = Join-Path $env:ProgramData 'CamachoPOS\logs'
$script:resolvedDataDirectory = $null
$script:serviceSidValue = $null

function Write-HelperLog([string]$Message) {
  try {
    $dir = Join-Path $env:ProgramData 'CamachoPOS\logs'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $line = '{0} {1}' -f ([DateTime]::UtcNow.ToString('o')), $Message
    Add-Content -LiteralPath (Join-Path $dir 'winsw-helper.log') -Value $line -Encoding UTF8
  } catch {}
}

function Write-Result($obj, [int]$code) {
  $payloadText = ''
  try { $payloadText = ($obj | ConvertTo-Json -Depth 6 -Compress) } catch { $payloadText = [string]$obj }
  Write-HelperLog ("RESULT action={0} code={1} payload={2}" -f $Action, $code, $payloadText)
  if ($Json) {
    try { $obj | ConvertTo-Json -Depth 8 -Compress | Write-Output }
    catch { Write-Output $payloadText }
  } else {
    $obj.GetEnumerator() | ForEach-Object { Write-Host ("{0}={1}" -f $_.Key, $_.Value) }
  }
  exit $code
}

function Escape-XmlValue([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;'))
}

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Result @{ ok = $false; error = 'ELEVATION_REQUIRED' } 2
  }
}

function Resolve-System32Tool {
  param([Parameter(Mandatory = $true)][string]$FileName)
  $candidate = Join-Path $env:WINDIR ("System32\" + $FileName)
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw ("NATIVE_TOOL_MISSING:{0}" -f $candidate)
  }
  return $candidate
}

function Format-NativeArg {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
  # Start-Process -ArgumentList as a string[] does NOT quote for us. Paths with
  # spaces ("C:\Program Files\…") become multiple argv tokens → icacls exit 87
  # ("Invalid parameter Files\Camacho"). Quote any token with whitespace or
  # shell-sensitive characters; double embedded quotes (CommandLineToArgvW).
  $v = [string]$Value
  if ($v -notmatch '[\s"&<>|()^]') {
    return $v
  }
  return ('"{0}"' -f ($v.Replace('"', '""')))
}

function Format-NativeArgumentList {
  param([Parameter(Mandatory = $true)][string[]]$ArgumentList)
  return ((@($ArgumentList | ForEach-Object { Format-NativeArg -Value ([string]$_) }) -join ' '))
}

function Invoke-NativeTool {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [string]$WorkingDirectory = ''
  )
  $exe = Resolve-System32Tool -FileName $FileName
  # Single Arguments string (not string[]) so quoting is preserved end-to-end.
  $argString = Format-NativeArgumentList -ArgumentList $ArgumentList
  $stdout = Join-Path $env:TEMP ("camacho-native-{0}-out.txt" -f [guid]::NewGuid().ToString('N'))
  $stderr = Join-Path $env:TEMP ("camacho-native-{0}-err.txt" -f [guid]::NewGuid().ToString('N'))
  try {
    $start = @{
      FilePath = $exe
      ArgumentList = $argString
      Wait = $true
      PassThru = $true
      NoNewWindow = $true
      RedirectStandardOutput = $stdout
      RedirectStandardError = $stderr
    }
    if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
      $start['WorkingDirectory'] = $WorkingDirectory
    }
    Write-HelperLog ("NATIVE_EXEC exe={0} args={1}" -f $exe, $argString)
    $p = Start-Process @start
    $outText = ''
    $errText = ''
    if (Test-Path -LiteralPath $stdout) { $outText = [string](Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $stderr) { $errText = [string](Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
    $code = if ($null -eq $p) { -1 } else { [int]$p.ExitCode }
    return [ordered]@{
      exe = $exe
      exitCode = $code
      args = $argString
      stdout = $outText
      stderr = $errText
      combined = (($outText + "`n" + $errText).Trim())
    }
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Get-FileSha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  # Prefer certutil (System32); never Get-FileHash (Utility module under nsExec).
  try {
    $raw = Invoke-NativeTool -FileName 'certutil.exe' -ArgumentList @('-hashfile', $Path, 'SHA256')
    if ($raw.exitCode -eq 0) {
      $hex = (
        @($raw.combined -split "`r?`n") |
          ForEach-Object { $_.Trim() } |
          Where-Object { $_ -match '^[0-9A-Fa-f]{64}$' -or $_ -match '^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2}){31}$' } |
          Select-Object -First 1
      )
      if ($hex) {
        return (($hex -replace '\s', '').ToLowerInvariant())
      }
    }
  } catch {
    Write-HelperLog ("CERTUTIL_HASH_FAILED err={0}" -f $_.Exception.Message)
  }
  $algo = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $bytes = $algo.ComputeHash($stream)
      return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $algo.Dispose()
  }
}

function Get-ScmInstallOkMarkerPaths {
  return @(
    (Join-Path $PayloadDir 'scm-install.ok'),
    (Join-Path $env:ProgramData 'CamachoPOS\logs\scm-install.ok')
  )
}

function Get-PhysicalCertificationMarkerPaths {
  return @(
    (Join-Path $PayloadDir 'physical-certification-prep.ok'),
    (Join-Path $env:ProgramData 'CamachoPOS\logs\physical-certification-prep.ok')
  )
}

function Clear-ScmInstallOkMarker {
  foreach ($marker in Get-ScmInstallOkMarkerPaths) {
    if (Test-Path -LiteralPath $marker) {
      Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    }
  }
}

function Clear-PhysicalCertificationMarker {
  foreach ($marker in Get-PhysicalCertificationMarkerPaths) {
    if (Test-Path -LiteralPath $marker) {
      Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    }
  }
}

function Write-ScmInstallOkMarker {
  param([Parameter(Mandatory = $true)]$Payload)
  $body = [ordered]@{
    at = [DateTime]::UtcNow.ToString('o')
    serviceId = $serviceId
    startName = [string]$Payload.startName
    status = [string]$Payload.status
    identityOk = [bool]$Payload.identityOk
    startType = 'Automatic'
  }
  $json = ($body | ConvertTo-Json -Compress)
  foreach ($marker in Get-ScmInstallOkMarkerPaths) {
    $dir = Split-Path -Parent $marker
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Set-Content -LiteralPath $marker -Value $json -Encoding ASCII
  }
  Write-HelperLog ("SCM_INSTALL_OK_MARKERS written payload={0}" -f $json)
}

function Write-PhysicalCertificationMarker {
  param([Parameter(Mandatory = $true)]$Payload)
  $body = [ordered]@{
    at = [DateTime]::UtcNow.ToString('o')
    profile = 'CAMACHO_SCM_PHYSICAL_CERTIFICATION_PREP_V1'
    purpose = 'PHYSICAL_CERTIFICATION_PREP'
    serviceId = $serviceId
    startName = [string]$Payload.startName
    status = [string]$Payload.status
    identityOk = [bool]$Payload.identityOk
    startType = [string]$Payload.startType
    commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    commercialReady = $false
    expectedCommercialGateDenial = [bool]$Payload.expectedCommercialGateDenial
    ownerAuthorizationId = [string]$Payload.ownerAuthorizationId
    attestationSha256 = [string]$Payload.attestationSha256
    scmHandoffFile = [string]$ScmHandoffFile
    scmCentralProvisionFile = [string]$ScmCentralProvisionFile
  }
  $json = ($body | ConvertTo-Json -Compress)
  foreach ($marker in Get-PhysicalCertificationMarkerPaths) {
    $dir = Split-Path -Parent $marker
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Set-Content -LiteralPath $marker -Value $json -Encoding ASCII
  }
  Write-HelperLog ("PHYSICAL_CERT_PREP_MARKERS written payload={0}" -f $json)
}

function Assert-Payload {
  foreach ($p in @($winswExe, $template, $nodeExe, $bundle)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
      Write-Result @{ ok = $false; error = "PAYLOAD_MISSING:$p" } 3
    }
  }
  if (Test-Path -LiteralPath $integrityFile) {
    $integrity = Get-Content -LiteralPath $integrityFile -Raw | ConvertFrom-Json
    $hash = Get-FileSha256Hex -Path $winswExe
    $expected = [string]$integrity.winsw.sha256
    if ($expected -and $hash -ne $expected.ToLowerInvariant()) {
      Write-Result @{ ok = $false; error = 'WINSW_SHA256_MISMATCH'; hash = $hash; expected = $expected } 4
    }
  }
}

function Assert-ManagedScmPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'SCM_MANAGED_PATH_REJECTED' }
  if ($Path -notmatch '^[A-Za-z]:\\') { throw 'SCM_MANAGED_PATH_REJECTED' }
  if ($Path -match '[\x00-\x1f]') { throw 'SCM_MANAGED_PATH_REJECTED' }
  if (($Path.Substring(2)).Contains(':')) { throw 'SCM_MANAGED_PATH_REJECTED' }
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not [string]::Equals($full, $Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'SCM_MANAGED_PATH_REJECTED'
  }
  $segments = $full -split '[\\/]'
  if (@($segments | Where-Object {
    $_ -match '^(?i:lab-data|\.lab-state|camachoposcmlab|design-review-runtime|preprod)$'
  }).Count -ne 0) { throw 'SCM_NONCOMMERCIAL_PATH_REJECTED' }
}

function Assert-CommercialInstallInputs {
  # Shared identity/path checks. Does not enable commercial SCM.
  if ([string]::IsNullOrWhiteSpace($DataDirectory)) { throw 'COMMERCIAL_DATA_DIRECTORY_REQUIRED' }
  if ($DataDirectory -notmatch '^[A-Za-z]:\\') { throw 'COMMERCIAL_DATA_DIRECTORY_NOT_LOCAL_ABSOLUTE' }
  $canonical = [System.IO.Path]::GetFullPath($DataDirectory)
  $segments = $canonical -split '[\\/]'
  if (@($segments | Where-Object {
    $_ -match '^(?i:lab-data|\.lab-state|camachoposcmlab|design-review-runtime|preprod)$'
  }).Count -ne 0) { throw 'COMMERCIAL_LAB_DIRECTORY_REJECTED' }
  foreach ($id in @($InstallationId, $DeviceId, $TenantId, $CompanyId, $BranchId)) {
    if ([string]::IsNullOrWhiteSpace($id) -or
        $id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or
        $id -match '^018f0000-0000-7000-8000-0000000000a[1-5]$') {
      throw 'COMMERCIAL_IDENTITY_INVALID_OR_SAMPLE'
    }
  }
  $hasHandoff = -not [string]::IsNullOrWhiteSpace($ScmHandoffFile)
  $hasCentral = -not [string]::IsNullOrWhiteSpace($ScmCentralProvisionFile)
  if ($hasHandoff -ne $hasCentral) { throw 'SCM_CENTRAL_PROVISION_REQUIRED' }
  if ($hasHandoff) {
    Assert-ManagedScmPath -Path $ScmHandoffFile
    Assert-ManagedScmPath -Path $ScmCentralProvisionFile
    if ([string]::Equals($ScmHandoffFile, $ScmCentralProvisionFile, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'SCM_MANAGED_PATH_REJECTED'
    }
  }
}

function Assert-CommercialProvisionReady {
  # Refuse all commercial installs until native SERVICE/DESKTOP provisioning
  # and cross-session interoperability have been physically certified.
  Assert-CommercialInstallInputs
  throw 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
}

function Assert-PhysicalCertificationAttestation {
  if ([string]::IsNullOrWhiteSpace($PhysicalCertificationAttestation)) {
    throw 'PHYSICAL_ATTESTATION_REQUIRED'
  }
  Assert-ManagedScmPath -Path $PhysicalCertificationAttestation
  if (-not (Test-Path -LiteralPath $PhysicalCertificationAttestation -PathType Leaf)) {
    throw 'PHYSICAL_ATTESTATION_MISSING'
  }
  $raw = [IO.File]::ReadAllText($PhysicalCertificationAttestation)
  $att = $raw | ConvertFrom-Json
  $required = @(
    'profile', 'purpose', 'commercial_ready', 'commercial_gate', 'owner_authorization_id',
    'target_machine', 'installation_id', 'device_id', 'issued_at', 'expires_at', 'scope'
  )
  foreach ($key in $required) {
    if (-not ($att.PSObject.Properties.Name -contains $key)) { throw 'PHYSICAL_ATTESTATION_SHAPE_REJECTED' }
  }
  if (@($att.PSObject.Properties).Count -ne $required.Count) { throw 'PHYSICAL_ATTESTATION_SHAPE_REJECTED' }
  if ([string]$att.profile -ne 'CAMACHO_SCM_PHYSICAL_CERTIFICATION_ATTESTATION_V1') {
    throw 'PHYSICAL_ATTESTATION_PROFILE_REJECTED'
  }
  if ([string]$att.purpose -ne 'PHYSICAL_CERTIFICATION_PREP') {
    throw 'PHYSICAL_ATTESTATION_PURPOSE_REJECTED'
  }
  if ($att.commercial_ready -ne $false) { throw 'PHYSICAL_ATTESTATION_COMMERCIAL_CLAIM_REJECTED' }
  if ([string]$att.commercial_gate -ne 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN') {
    throw 'PHYSICAL_ATTESTATION_GATE_REJECTED'
  }
  $ownerId = [string]$att.owner_authorization_id
  if ($ownerId.Trim().Length -lt 8 -or $ownerId.Length -gt 128) {
    throw 'PHYSICAL_ATTESTATION_OWNER_ID_REJECTED'
  }
  $machine = [string]$att.target_machine
  if ($machine.Trim().Length -lt 1 -or $machine.Length -gt 128) {
    throw 'PHYSICAL_ATTESTATION_MACHINE_REJECTED'
  }
  foreach ($pair in @(
    @{ Expected = $InstallationId; Actual = [string]$att.installation_id },
    @{ Expected = $DeviceId; Actual = [string]$att.device_id }
  )) {
    if ($pair.Actual -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or
        $pair.Actual -match '^018f0000-0000-7000-8000-0000000000a[1-5]$' -or
        -not [string]::Equals($pair.Expected, $pair.Actual, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'PHYSICAL_ATTESTATION_IDENTITY_REJECTED'
    }
  }
  if ([string]::Equals($att.installation_id, $att.device_id, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'PHYSICAL_ATTESTATION_IDENTITY_REJECTED'
  }
  $from = [DateTime]::Parse([string]$att.issued_at, $null, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  $until = [DateTime]::Parse([string]$att.expires_at, $null, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  $now = [DateTime]::UtcNow
  if ($until -le $from -or $from -gt $now -or $now -ge $until) { throw 'PHYSICAL_ATTESTATION_WINDOW_INVALID' }
  $expectedScope = @('WINSW_INSTALL', 'ACL_DPAPI_EVIDENCE', 'NATIVE_TRANSPORT_EVIDENCE')
  $scope = @($att.scope)
  if ($scope.Count -ne $expectedScope.Count) { throw 'PHYSICAL_ATTESTATION_SCOPE_REJECTED' }
  for ($i = 0; $i -lt $expectedScope.Count; $i++) {
    if ([string]$scope[$i] -ne $expectedScope[$i]) { throw 'PHYSICAL_ATTESTATION_SCOPE_REJECTED' }
  }
  $script:physicalAttestationOwnerId = $ownerId
  $script:physicalAttestationSha256 = Get-FileSha256Hex -Path $PhysicalCertificationAttestation
  Write-HelperLog ("PHYSICAL_ATTESTATION_OK owner={0} sha256={1}" -f $ownerId, $script:physicalAttestationSha256)
}

function Resolve-DataDirectory {
  param([switch]$ForPhysicalCertificationPrep)
  if ($ForPhysicalCertificationPrep) {
    Assert-CommercialInstallInputs
    Assert-PhysicalCertificationAttestation
    $hasHandoff = -not [string]::IsNullOrWhiteSpace($ScmHandoffFile)
    $hasCentral = -not [string]::IsNullOrWhiteSpace($ScmCentralProvisionFile)
    if (-not ($hasHandoff -and $hasCentral)) { throw 'SCM_CENTRAL_PROVISION_REQUIRED' }
    if (-not (Test-Path -LiteralPath $ScmHandoffFile -PathType Leaf)) { throw 'SCM_HANDOFF_FILE_MISSING' }
    if (-not (Test-Path -LiteralPath $ScmCentralProvisionFile -PathType Leaf)) { throw 'SCM_CENTRAL_PROVISION_FILE_MISSING' }
  } else {
    Assert-CommercialProvisionReady
  }
  return $DataDirectory
}

function Apply-ScmProvisionEnv {
  param([Parameter(Mandatory = $true)][string]$Xml)
  $hasHandoff = -not [string]::IsNullOrWhiteSpace($ScmHandoffFile)
  $hasCentral = -not [string]::IsNullOrWhiteSpace($ScmCentralProvisionFile)
  if ($hasHandoff -ne $hasCentral) { throw 'SCM_CENTRAL_PROVISION_REQUIRED' }
  if (-not $hasHandoff) {
    # Base commercial install without SCM transport: strip pair placeholders.
    $Xml = [regex]::Replace($Xml, '(?m)^\s*<env name="POS_WINDOWS_SCM_HANDOFF_FILE"[^/]*/>\r?\n?', '')
    $Xml = [regex]::Replace($Xml, '(?m)^\s*<env name="POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE"[^/]*/>\r?\n?', '')
    if ($Xml -match 'POS_WINDOWS_SCM_(?:HANDOFF|CENTRAL_PROVISION)_FILE') {
      throw 'WINSW_TEMPLATE_SCM_PLACEHOLDER_STUCK'
    }
    return $Xml
  }
  Assert-ManagedScmPath -Path $ScmHandoffFile
  Assert-ManagedScmPath -Path $ScmCentralProvisionFile
  if ([string]::Equals($ScmHandoffFile, $ScmCentralProvisionFile, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'SCM_MANAGED_PATH_REJECTED'
  }
  if ($Xml -notmatch '__CAMACHO_POS_WINDOWS_SCM_HANDOFF_FILE__' -or
      $Xml -notmatch '__CAMACHO_POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE__') {
    throw 'WINSW_TEMPLATE_MISSING_SCM_PAIR'
  }
  $Xml = $Xml.Replace('__CAMACHO_POS_WINDOWS_SCM_HANDOFF_FILE__', (Escape-XmlValue $ScmHandoffFile))
  $Xml = $Xml.Replace('__CAMACHO_POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE__', (Escape-XmlValue $ScmCentralProvisionFile))
  return $Xml
}

function Materialize-Xml {
  param([switch]$ForPhysicalCertificationPrep)
  $script:resolvedDataDirectory = Resolve-DataDirectory -ForPhysicalCertificationPrep:$ForPhysicalCertificationPrep
  New-Item -ItemType Directory -Force -Path $script:resolvedDataDirectory | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $script:resolvedDataDirectory 'security') | Out-Null
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

  $xml = [IO.File]::ReadAllText($template)
  $xml = $xml.Replace('__CAMACHO_SERVICE_NODE__', (Escape-XmlValue $nodeExe))
  $xml = $xml.Replace('__CAMACHO_SERVICE_BUNDLE__', (Escape-XmlValue $bundle))
  $xml = $xml.Replace('__CAMACHO_SERVICE_WORKDIR__', (Escape-XmlValue $workDir))
  $xml = $xml.Replace('__CAMACHO_SERVICE_LOGDIR__', (Escape-XmlValue $logDirectory))
  $xml = $xml.Replace('__CAMACHO_POS_DATA_DIRECTORY__', (Escape-XmlValue $script:resolvedDataDirectory))
  $xml = $xml.Replace('__CAMACHO_POS_INSTALLATION_ID__', (Escape-XmlValue $InstallationId))
  $xml = $xml.Replace('__CAMACHO_POS_DEVICE_ID__', (Escape-XmlValue $DeviceId))
  $xml = $xml.Replace('__CAMACHO_POS_TENANT_ID__', (Escape-XmlValue $TenantId))
  $xml = $xml.Replace('__CAMACHO_POS_COMPANY_ID__', (Escape-XmlValue $CompanyId))
  $xml = $xml.Replace('__CAMACHO_POS_BRANCH_ID__', (Escape-XmlValue $BranchId))
  $xml = Apply-ScmProvisionEnv -Xml $xml
  if ($xml -notmatch '<logpath>') {
    throw 'WINSW_TEMPLATE_MISSING_LOGPATH'
  }
  if ($xml -match '<username>') {
    throw 'WINSW_TEMPLATE_USES_USERNAME_NOT_DOMAIN_USER'
  }
  if ($xml -notmatch '(?s)<serviceaccount>.*<domain>NT SERVICE</domain>.*<user>CamachoPOSLocalService</user>') {
    throw 'WINSW_TEMPLATE_MISSING_VIRTUAL_SERVICEACCOUNT'
  }
  if ($ForPhysicalCertificationPrep) {
    if ($xml -notmatch 'POS_WINDOWS_SCM_HANDOFF_FILE' -or
        $xml -notmatch 'POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE') {
      throw 'WINSW_TEMPLATE_SCM_PAIR_NOT_MATERIALIZED'
    }
  }
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.UTF8Encoding]::new($false))
}

function Merge-Result([hashtable]$Base, $Extra) {
  $merged = [ordered]@{}
  foreach ($key in $Base.Keys) { $merged[$key] = $Base[$key] }
  if ($null -ne $Extra) {
    foreach ($key in $Extra.Keys) { $merged[$key] = $Extra[$key] }
  }
  return $merged
}

function Get-ScmQuery {
  # sc.exe queryex: exit 0 present; 1060 absent. Never Get-Service (optional under nsExec).
  $r = Invoke-NativeTool -FileName 'sc.exe' -ArgumentList @('queryex', $serviceId)
  $present = ($r.exitCode -eq 0)
  $state = 'Absent'
  if ($present) {
    $state = 'Unknown'
    foreach ($line in ($r.combined -split "`r?`n")) {
      if ($line -match 'STATE\s*:\s*\d+\s+(\w+)') {
        $state = $Matches[1]
        break
      }
    }
  }
  return [ordered]@{
    present = $present
    exitCode = $r.exitCode
    state = $state
    raw = $r.combined
  }
}

function Get-ScmConfig {
  $r = Invoke-NativeTool -FileName 'sc.exe' -ArgumentList @('qc', $serviceId)
  $startName = ''
  $startType = ''
  if ($r.exitCode -eq 0) {
    foreach ($line in ($r.combined -split "`r?`n")) {
      if ($line -match 'SERVICE_START_NAME\s*:\s*(.+)$') {
        $startName = $Matches[1].Trim()
      }
      if ($line -match 'START_TYPE\s*:\s*\d+\s+(\w+)') {
        $startType = $Matches[1].Trim()
      }
    }
  }
  return [ordered]@{
    exitCode = $r.exitCode
    startName = $startName
    startType = $startType
    raw = $r.combined
  }
}

function Stop-ScmServiceNative {
  $notes = New-Object System.Collections.Generic.List[string]
  $q0 = Get-ScmQuery
  if (-not $q0.present) {
    [void]$notes.Add('service_already_absent')
    return [ordered]@{ notes = $notes; present = $false }
  }
  $stop = Invoke-NativeTool -FileName 'sc.exe' -ArgumentList @('stop', $serviceId)
  [void]$notes.Add(('sc_stop_exit={0}' -f $stop.exitCode))
  for ($i = 0; $i -lt 45; $i++) {
    $q = Get-ScmQuery
    if (-not $q.present -or $q.state -eq 'STOPPED') { break }
    Start-Sleep -Seconds 1
  }
  $qEnd = Get-ScmQuery
  [void]$notes.Add(('sc_state_after_stop={0}' -f $qEnd.state))
  return [ordered]@{ notes = $notes; present = $qEnd.present; state = $qEnd.state }
}

function Resolve-VirtualServiceSid {
  # Virtual account SID exists only after CreateService (winsw install).
  $account = New-Object Security.Principal.NTAccount($serviceAccount)
  $sid = $account.Translate([Security.Principal.SecurityIdentifier])
  $script:serviceSidValue = $sid.Value
  Write-HelperLog ("SERVICE_SID={0} account={1}" -f $script:serviceSidValue, $serviceAccount)
  return $script:serviceSidValue
}

function Grant-PathAclViaIcacls {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidateSet('RX', 'M')][string]$RightToken,
    [Parameter(Mandatory = $true)][string]$SidValue,
    [switch]$Directory
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "ACL_TARGET_MISSING:$Path"
  }
  # Minimum privilege: only NT SERVICE\<service> SID. Never Users/Everyone/Authenticated Users.
  $grantSpec = if ($Directory) {
    ('*{0}:(OI)(CI){1}' -f $SidValue, $RightToken)
  } else {
    ('*{0}:{1}' -f $SidValue, $RightToken)
  }
  $grant = Invoke-NativeTool -FileName 'icacls.exe' -ArgumentList @($Path, '/grant', $grantSpec)
  if ($grant.exitCode -ne 0) {
    throw ("ICACLS_GRANT_FAILED:exit={0};path={1};grant={2};out={3}" -f $grant.exitCode, $Path, $grantSpec, $grant.combined)
  }
  Write-HelperLog ("ACL_ICACLS_GRANT_OK path={0} grant={1}" -f $Path, $grantSpec)
}

function Assert-EffectiveAclViaIcacls {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$SidValue,
    [Parameter(Mandatory = $true)][ValidateSet('RX', 'M')][string]$ExpectedRight
  )
  $list = Invoke-NativeTool -FileName 'icacls.exe' -ArgumentList @($Path)
  if ($list.exitCode -ne 0) {
    throw ("ICACLS_LIST_FAILED:exit={0};path={1};out={2}" -f $list.exitCode, $Path, $list.combined)
  }
  $matched = $false
  foreach ($line in ($list.combined -split "`r?`n")) {
    # icacls prints SID or friendly name; match SID and required right token.
    if ($line -match [regex]::Escape($SidValue) -or $line -match [regex]::Escape($serviceAccount)) {
      if ($ExpectedRight -eq 'M') {
        # Modify includes M, or expanded (M)/(RX,W)/etc. Reject lines that only show R without W/M.
        if ($line -match '\(M\)' -or $line -match '\(W\)' -or $line -match '\(M,') {
          $matched = $true
          break
        }
      } else {
        if ($line -match '\(RX\)' -or $line -match '\(R,X\)' -or $line -match '\(M\)' -or $line -match '\(R\)') {
          $matched = $true
          break
        }
      }
    }
  }
  if (-not $matched) {
    throw ("ACL_EFFECTIVE_MISSING:path={0};sid={1};expected={2};icacls={3}" -f $Path, $SidValue, $ExpectedRight, $list.combined)
  }
  Write-HelperLog ("ACL_EFFECTIVE_OK path={0} sid={1} expected={2}" -f $Path, $SidValue, $ExpectedRight)
}

function Grant-ServiceRuntimeAcls {
  $sid = Resolve-VirtualServiceSid
  $targets = @(
    @{ Path = $PayloadDir; Right = 'RX'; Directory = $true },
    @{ Path = $script:resolvedDataDirectory; Right = 'M'; Directory = $true },
    @{ Path = $logDirectory; Right = 'M'; Directory = $true }
  )
  $camachoRoot = Join-Path $env:ProgramData 'CamachoPOS'
  if (Test-Path -LiteralPath $camachoRoot) {
    $targets += @{ Path = $camachoRoot; Right = 'RX'; Directory = $true }
  }
  # Authenticated SCM provisions must be readable by the virtual account after
  # certification. Never broaden to Users/Everyone; file-level RX only.
  foreach ($scmPath in @($ScmHandoffFile, $ScmCentralProvisionFile)) {
    if ([string]::IsNullOrWhiteSpace($scmPath)) { continue }
    Assert-ManagedScmPath -Path $scmPath
    if (-not (Test-Path -LiteralPath $scmPath -PathType Leaf)) {
      throw ("SCM_PROVISION_ACL_TARGET_MISSING:{0}" -f $scmPath)
    }
    $parent = Split-Path -Parent $scmPath
    if (-not [string]::IsNullOrWhiteSpace($parent) -and (Test-Path -LiteralPath $parent -PathType Container)) {
      $targets += @{ Path = $parent; Right = 'RX'; Directory = $true }
    }
    $targets += @{ Path = $scmPath; Right = 'RX'; Directory = $false }
  }
  foreach ($t in $targets) {
    Grant-PathAclViaIcacls -Path $t.Path -RightToken $t.Right -SidValue $sid -Directory:$t.Directory
    Assert-EffectiveAclViaIcacls -Path $t.Path -SidValue $sid -ExpectedRight $t.Right
  }
}

function Get-ScmDiagnostics {
  $q = Get-ScmQuery
  $c = Get-ScmConfig
  $logTail = ''
  if (Test-Path -LiteralPath $logDirectory) {
    $logFile = Get-ChildItem -LiteralPath $logDirectory -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($null -ne $logFile) {
      $logTail = (Get-Content -LiteralPath $logFile.FullName -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
    }
  }
  return [ordered]@{
    scQueryEx = $q.raw
    scQc = $c.raw
    startName = $c.startName
    startType = $c.startType
    state = $q.state
    logTail = $logTail
    xmlPath = $xmlPath
    payloadDir = $PayloadDir
    dataDirectory = $(if ($script:resolvedDataDirectory) { $script:resolvedDataDirectory } else { '' })
    logDirectory = $logDirectory
    serviceSid = $(if ($script:serviceSidValue) { $script:serviceSidValue } else { '' })
  }
}

function Invoke-WinSW {
  param([Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$WinSwArguments)
  $clean = @($WinSwArguments | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  if ($clean.Count -eq 0) {
    throw 'WINSW_ARGUMENTS_EMPTY'
  }
  if (-not (Test-Path -LiteralPath $winswExe -PathType Leaf)) {
    throw ("WINSW_EXE_MISSING:{0}" -f $winswExe)
  }
  $stdout = Join-Path $env:TEMP ("camacho-winsw-{0}-out.txt" -f [guid]::NewGuid().ToString('N'))
  $stderr = Join-Path $env:TEMP ("camacho-winsw-{0}-err.txt" -f [guid]::NewGuid().ToString('N'))
  try {
    $p = Start-Process -FilePath $winswExe `
      -ArgumentList $clean `
      -WorkingDirectory $PayloadDir `
      -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr
    $outText = ''
    $errText = ''
    if (Test-Path -LiteralPath $stdout) { $outText = (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $stderr) { $errText = (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
    if (-not [string]::IsNullOrWhiteSpace($outText)) { Write-Host ("WINSW_STDOUT={0}" -f $outText.Trim()) }
    if (-not [string]::IsNullOrWhiteSpace($errText)) { Write-Host ("WINSW_STDERR={0}" -f $errText.Trim()) }
    if ($null -eq $p) { return -1 }
    return [int]$p.ExitCode
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Get-XmlAccountSnippet {
  if (-not (Test-Path -LiteralPath $xmlPath)) { return '' }
  $xmlBody = [IO.File]::ReadAllText($xmlPath)
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($xmlBody -split "`r?`n")) {
    $t = $line.Trim()
    if ($t -match 'serviceaccount|domain|user|username') {
      [void]$lines.Add($t)
    }
  }
  return ($lines -join ' | ')
}

Write-HelperLog ("BEGIN action={0} payloadDir={1} dataDirectory={2} elevated={3}" -f $Action, $PayloadDir, $DataDirectory, $(
  try {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    [string]$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { 'unknown' }
))

try {

switch ($Action) {
  'Status' {
    $q = Get-ScmQuery
    $c = Get-ScmConfig
    Write-Result @{
      ok = $true
      registered = [bool]$q.present
      status = $(if ($q.present) { [string]$q.state } else { 'Absent' })
      startType = $(if ($q.present) { [string]$c.startType } else { '' })
      startName = $(if ($q.present) { [string]$c.startName } else { '' })
      payloadDir = $PayloadDir
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    } 0
  }
  'Install' {
    Assert-CommercialProvisionReady
    Assert-Admin
    Clear-ScmInstallOkMarker
    Clear-PhysicalCertificationMarker
    Assert-Payload
    [void](Resolve-System32Tool -FileName 'sc.exe')
    [void](Resolve-System32Tool -FileName 'icacls.exe')
    [void](Resolve-System32Tool -FileName 'certutil.exe')
    Materialize-Xml
    # Unreachable while the commercial gate remains NOT_PROVEN; retained for
    # the authorized post-certification Install path without changing the gate.
    Write-Result @{
      ok = $false
      error = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    } 4
  }
  'PreparePhysicalCertification' {
    # Explicit owner-attested prep. Does NOT clear the commercial release gate,
    # does NOT enable Electron commercial SCM login, and is never invoked by NSIS.
    Assert-Admin
    Clear-ScmInstallOkMarker
    Clear-PhysicalCertificationMarker
    Assert-Payload
    [void](Resolve-System32Tool -FileName 'sc.exe')
    [void](Resolve-System32Tool -FileName 'icacls.exe')
    [void](Resolve-System32Tool -FileName 'certutil.exe')
    Materialize-Xml -ForPhysicalCertificationPrep

    $existing = Get-ScmQuery
    if ($existing.present) {
      $stopInfo = Stop-ScmServiceNative
      Write-HelperLog ("PRE_PHYSICAL_STOP {0}" -f ($stopInfo.notes -join ' | '))
      if (Test-Path -LiteralPath $winswExe -PathType Leaf) {
        [void](Invoke-WinSW -WinSwArguments @('uninstall'))
      }
      $del = Invoke-NativeTool -FileName 'sc.exe' -ArgumentList @('delete', $serviceId)
      Write-HelperLog ("PRE_PHYSICAL_SC_DELETE exit={0} out={1}" -f $del.exitCode, $del.combined)
      Start-Sleep -Seconds 2
    }

    $installCode = Invoke-WinSW -WinSwArguments @('install')
    if ($installCode -ne 0) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_INSTALL_FAILED'
        exitCode = $installCode
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 5
    }

    $cfgAfterInstall = Get-ScmConfig
    $startNameAfterInstall = [string]$cfgAfterInstall.startName
    if ($startNameAfterInstall -ne $serviceAccount) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_VIRTUAL_ACCOUNT_NOT_BOUND'
        startName = $startNameAfterInstall
        expectedStartName = $serviceAccount
        xmlSnippet = (Get-XmlAccountSnippet)
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 7
    }

    try {
      Grant-ServiceRuntimeAcls
    } catch {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'SERVICE_ACL_GRANT_FAILED'
        message = [string]$_.Exception.Message
        startName = $startNameAfterInstall
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 9
    }

    $startCode = Invoke-WinSW -WinSwArguments @('start')
    Start-Sleep -Seconds 5
    $qStable = Get-ScmQuery
    $cfgStable = Get-ScmConfig
    $startName = [string]$cfgStable.startName
    $identityOk = $startName -eq $serviceAccount
    $stillRunning = $qStable.present -and ($qStable.state -eq 'RUNNING' -or $qStable.state -eq 'START_PENDING')
    $helperLog = Join-Path $logDirectory 'winsw-helper.log'
    $serviceLogTail = ''
    if (Test-Path -LiteralPath $logDirectory) {
      $logFile = Get-ChildItem -LiteralPath $logDirectory -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne 'winsw-helper.log' -and $_.Name -ne 'physical-certification-prep.ok' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($null -ne $logFile) {
        try {
          $serviceLogTail = Get-Content -LiteralPath $logFile.FullName -Tail 40 -ErrorAction SilentlyContinue |
            Out-String
        } catch { $serviceLogTail = '' }
      }
    }
    $gateDenied = ($serviceLogTail -match 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN') -or
      ($serviceLogTail -match 'runtime\.start_failed')
    # With the authenticated SCM pair materialized, commercial entry must remain
    # fail-closed. Identity + ACL success with an expected gate denial is the
    # physical-prep evidence; a stable commercial RUNNING start is not.
    if (-not $identityOk) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_VIRTUAL_ACCOUNT_NOT_BOUND'
        registered = $qStable.present
        status = $qStable.state
        startName = $startName
        startExitCode = $startCode
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 7
    }
    if ($stillRunning) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'PHYSICAL_PREP_UNEXPECTED_COMMERCIAL_START'
        registered = $true
        status = $qStable.state
        startName = $startName
        note = 'SCM commercial entry must remain blocked during physical prep'
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 10
    }
    if (-not $gateDenied) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'PHYSICAL_PREP_GATE_DENIAL_NOT_OBSERVED'
        registered = $qStable.present
        status = $qStable.state
        startName = $startName
        startExitCode = $startCode
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      } (Get-ScmDiagnostics)) 11
    }

    $success = @{
      ok = $true
      purpose = 'PHYSICAL_CERTIFICATION_PREP'
      registered = $true
      status = [string]$qStable.state
      startName = $startName
      identityOk = $true
      startType = [string]$cfgStable.startType
      dataDirectory = $script:resolvedDataDirectory
      logDirectory = $logDirectory
      xml = $xmlPath
      expectedCommercialGateDenial = $true
      ownerAuthorizationId = [string]$script:physicalAttestationOwnerId
      attestationSha256 = [string]$script:physicalAttestationSha256
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      commercialReady = $false
      authenticodeProduct = 'RT-009-B_BLOCKED'
      note = 'WinSW identity and SCM ACLs prepared; commercial SCM start remains fail-closed'
      helperLog = $helperLog
    }
    Write-PhysicalCertificationMarker -Payload $success
    Write-Result $success 0
  }
  'Uninstall' {
    Assert-Admin
    Clear-ScmInstallOkMarker
    Clear-PhysicalCertificationMarker
    [void](Resolve-System32Tool -FileName 'sc.exe')
    $stopNotes = New-Object System.Collections.Generic.List[string]
    $q = Get-ScmQuery
    if ($q.present) {
      $stopInfo = Stop-ScmServiceNative
      foreach ($n in $stopInfo.notes) { [void]$stopNotes.Add([string]$n) }
      if (Test-Path -LiteralPath $winswExe -PathType Leaf) {
        try {
          $unCode = Invoke-WinSW -WinSwArguments @('uninstall')
          [void]$stopNotes.Add(('winsw_uninstall_exit=' + $unCode))
        } catch {
          [void]$stopNotes.Add(('winsw_uninstall=' + $_.Exception.Message))
        }
      } else {
        [void]$stopNotes.Add('winsw_exe_absent')
      }
      $scDelete = Invoke-NativeTool -FileName 'sc.exe' -ArgumentList @('delete', $serviceId)
      [void]$stopNotes.Add(('sc_delete_exit=' + $scDelete.exitCode))
      [void]$stopNotes.Add(('sc_delete=' + $scDelete.combined))
      Start-Sleep -Seconds 2
    } else {
      [void]$stopNotes.Add('service_already_absent')
    }
    $after = Get-ScmQuery
    Write-Result @{
      ok = (-not $after.present)
      registered = $after.present
      dataPreserved = $true
      stopNotes = ([string[]]$stopNotes.ToArray() -join ' | ')
      note = 'Service removed; commercial data directories left intact'
    } $(if (-not $after.present) { 0 } else { 8 })
  }
}

} catch {
  Write-Result @{
    ok = $false
    error = 'HELPER_UNCAUGHT'
    message = [string]$_.Exception.Message
    scriptStackTrace = [string]$_.ScriptStackTrace
    action = $Action
    payloadDir = $PayloadDir
  } 10
}
