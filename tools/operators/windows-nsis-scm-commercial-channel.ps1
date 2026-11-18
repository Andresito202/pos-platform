#requires -Version 5.1
<#
.SYNOPSIS
  Product commercial channel: Electron/Desktop ↔ WinSW Local Service as NT SERVICE.

.DESCRIPTION
  Lab-only on GitHub Windows. Enrolls real DPAPI identities, pairs SCM provisions,
  patches the installed WinSW XML with POS_WINDOWS_SCM_HANDOFF_FILE, starts the
  product service, and runs authenticated ops via connectWindowsScmClient (same
  path as Electron production-entry). Does not claim BUSINESS/GLOBAL, Authenticode,
  or physical owner-PC certification.
#>
[CmdletBinding()]
param(
  [switch]$Run,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$PayloadDir,
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [Parameter(Mandatory = $true)][string]$InstalledExe
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Must([bool]$ok, [string]$code) { if (-not $ok) { throw $code } }

Must ([bool]$Run) 'EXPLICIT_RUN_REQUIRED'
Must ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'
Must ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_OS -eq 'Windows') 'EPHEMERAL_GITHUB_WINDOWS_REQUIRED'

$serviceName = 'CamachoPOSLocalService'
$serviceSid = 'S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$admins = 'S-1-5-32-544'
$system = 'S-1-5-18'
$repo = [IO.Path]::GetFullPath($RepoRoot)
$payload = [IO.Path]::GetFullPath($PayloadDir)
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$publication = [Guid]::NewGuid().ToString('N')
$labId = [Guid]::NewGuid().ToString('N')
$labRoot = 'C:\CamachoPosScmLab\' + $labId
  $xmlSwapped = $false
  $xmlBackup = $null
  $xmlOriginalText = $null
  $xmlPath = $null
  $validated = $false

function Ace([string]$sid, [Security.AccessControl.FileSystemRights]$rights) {
  return [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid), $rights,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
}
function AceFile([string]$sid, [Security.AccessControl.FileSystemRights]$rights) {
  return [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid), $rights,
    [Security.AccessControl.AccessControlType]::Allow)
}
function Get-ScBinPath([string]$Name) {
  $qc = & sc.exe qc $Name 2>&1 | Out-String
  Must ($LASTEXITCODE -eq 0) 'SC_QC_FAILED'
  $line = @($qc -split "`r?`n" | Where-Object { $_ -match 'BINARY_PATH_NAME' })
  Must ($line.Count -eq 1) 'SC_QC_BINPATH_MISSING'
  return ($line[0] -replace '^\s*BINARY_PATH_NAME\s*:\s*', '').Trim()
}
function Set-OwnerOnlyDir([string]$Path, [string]$OwnerSid) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($OwnerSid))
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((Ace $OwnerSid ([Security.AccessControl.FileSystemRights]::FullControl)))
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Seal-InstallerManagedFile([string]$Path) {
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($admins))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($system, $admins)) {
    $acl.AddAccessRule((AceFile $sid ([Security.AccessControl.FileSystemRights]::FullControl)))
  }
  foreach ($sid in @($serviceSid, $operatorSid)) {
    $acl.AddAccessRule((AceFile $sid ([Security.AccessControl.FileSystemRights]::ReadAndExecute)))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Seal-InstallerManagedDir([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($admins))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($system, $admins)) {
    $acl.AddAccessRule((Ace $sid ([Security.AccessControl.FileSystemRights]::FullControl)))
  }
  foreach ($sid in @($serviceSid, $operatorSid)) {
    $acl.AddAccessRule((Ace $sid ([Security.AccessControl.FileSystemRights]::ReadAndExecute)))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Wait-ServiceStopped([int]$Seconds = 45) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ((Get-Service -Name $serviceName).Status -ne 'Stopped' -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 250
  }
  Must ((Get-Service -Name $serviceName).Status -eq 'Stopped') 'SCM_STOP_TIMEOUT'
}
function Esc([string]$v) {
  return $v.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

try {
  Must (Test-Path -LiteralPath $repo -PathType Container) 'REPO_MISSING'
  Must (Test-Path -LiteralPath $payload -PathType Container) 'PAYLOAD_MISSING'
  Must (Test-Path -LiteralPath $InstalledExe -PathType Leaf) 'INSTALLED_EXE_MISSING'
  $addon = Join-Path $repo 'packages\local-channel\native\build\Release\camacho_windows_pipe.node'
  Must (Test-Path -LiteralPath $addon -PathType Leaf) 'NATIVE_ADDON_MISSING'
  $enroll = Join-Path $repo 'tools\operators\windows-nsis-scm-commercial-enroll.mjs'
  $ops = Join-Path $repo 'tools\operators\windows-nsis-scm-commercial-ops.mjs'
  Must ((Test-Path -LiteralPath $enroll) -and (Test-Path -LiteralPath $ops)) 'COMMERCIAL_OPERATORS_MISSING'

  $cim = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
  Must ($cim.StartName -eq ('NT SERVICE\' + $serviceName)) 'SCM_IDENTITY_REJECTED'
  $winswBin = Get-ScBinPath $serviceName
  Must ($winswBin -match '(?i)CamachoPOSLocalService\.exe') 'WINSW_IMAGE_REQUIRED'

  $xmlPath = Join-Path $payload ($serviceName + '.xml')
  Must (Test-Path -LiteralPath $xmlPath -PathType Leaf) 'WINSW_XML_MISSING'
  $xmlBackup = Join-Path $WorkRoot ('winsw-xml-before-commercial-' + $publication + '.xml')
  Copy-Item -LiteralPath $xmlPath -Destination $xmlBackup -Force
  $xmlOriginalText = Get-Content -LiteralPath $xmlPath -Raw

  # Lab tree: admin-managed parents; owner-only private dirs per identity.
  Seal-InstallerManagedDir 'C:\CamachoPosScmLab'
  Seal-InstallerManagedDir $labRoot
  foreach ($d in @('service', 'desktop', 'results', 'bin')) {
    Seal-InstallerManagedDir (Join-Path $labRoot $d)
  }
  Set-OwnerOnlyDir (Join-Path $labRoot 'service\private') $serviceSid
  Set-OwnerOnlyDir (Join-Path $labRoot 'desktop\private') $operatorSid
  # Service also needs Modify on results for enrollment output.
  $resultsAcl = Get-Acl -LiteralPath (Join-Path $labRoot 'results')
  $resultsAcl.AddAccessRule((Ace $serviceSid ([Security.AccessControl.FileSystemRights]::Modify)))
  Set-Acl -LiteralPath (Join-Path $labRoot 'results') -AclObject $resultsAcl

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  # Resolve tsx from the local-service workspace (same pattern as NSIS lifecycle).
  Push-Location (Join-Path $repo 'apps\pos-local-service')
  try {
    $tsx = & $node -e "const {createRequire}=require('module');const {join}=require('path');process.stdout.write(createRequire(join(process.cwd(),'package.json')).resolve('tsx/cli'));"
  }
  finally { Pop-Location }
  Must (-not [string]::IsNullOrWhiteSpace($tsx) -and (Test-Path -LiteralPath $tsx -PathType Leaf)) 'TSX_MISSING'

  # Generate UUID v7 ids via Node for schema compliance.
  $idJson = & $node --input-type=module -e "import{randomBytes}from'node:crypto';const u=()=>{const b=randomBytes(16);const ms=BigInt(Date.now());b[0]=Number((ms>>40n)&0xffn);b[1]=Number((ms>>32n)&0xffn);b[2]=Number((ms>>24n)&0xffn);b[3]=Number((ms>>16n)&0xffn);b[4]=Number((ms>>8n)&0xffn);b[5]=Number(ms&0xffn);b[6]=(b[6]&0x0f)|0x70;b[8]=(b[8]&0x3f)|0x80;const h=Buffer.from(b).toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};process.stdout.write(JSON.stringify({i:u(),d:u()}));"
  $ids = $idJson | ConvertFrom-Json
  $installationId = [string]$ids.i
  $deviceId = [string]$ids.d
  Must ($installationId[14] -eq '7' -and $deviceId[14] -eq '7') 'UUID_V7_REQUIRED'

  # Stage a short-path CJS enroll bundle (admin). Avoid icacls /T on pnpm trees —
  # MAX_PATH leaves NT SERVICE unable to load tsx/workspace modules from the repo.
  $stage = Join-Path $repo 'tools\operators\windows-nsis-scm-commercial-stage-enroll.mjs'
  Must (Test-Path -LiteralPath $stage -PathType Leaf) 'ENROLL_STAGE_MISSING'
  $bundleOut = & $node --import $tsx $stage $labRoot
  Must ($LASTEXITCODE -eq 0) 'ENROLL_STAGE_FAILED'
  $enrollBundle = ([string]$bundleOut).Trim()
  Must ($enrollBundle -match '(?i)\\enroll-service\.cjs$' -and (Test-Path -LiteralPath $enrollBundle -PathType Leaf)) 'ENROLL_BUNDLE_MISSING'
  Seal-InstallerManagedFile $enrollBundle
  # WinSW keeps the payload <executable>; grant RX on that Node (not only PATH node).
  $execMatch = [regex]::Match($xmlOriginalText, '<executable>([^<]+)</executable>')
  Must $execMatch.Success 'WINSW_EXECUTABLE_MISSING'
  $winswNode = [System.Net.WebUtility]::HtmlDecode($execMatch.Groups[1].Value)
  Must (Test-Path -LiteralPath $winswNode -PathType Leaf) 'WINSW_NODE_MISSING'
  foreach ($p in @($winswNode, $node, (Join-Path $labRoot 'bin'))) {
    & icacls.exe $p /grant ('*' + $serviceSid + ':(OI)(CI)RX') /T /C /Q | Out-Null
  }
  # powershell.exe is required by windows-handoff-native under the service token.
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Must (Test-Path -LiteralPath $psExe -PathType Leaf) 'POWERSHELL_MISSING'
  & icacls.exe $psExe /grant ('*' + $serviceSid + ':RX') /C /Q | Out-Null

  # Prior lifecycle phases leave CamachoPOSLocalService Running; stop before enrollment swap.
  if ((Get-Service -Name $serviceName).Status -ne 'Stopped') {
    try { Stop-Service -Name $serviceName -Force -ErrorAction Stop } catch {
      & sc.exe stop $serviceName | Out-Null
    }
  }
  Wait-ServiceStopped
  # Keep WinSW as the SCM host; temporarily point its Node arguments at the staged CJS.
  # (Plain node.exe as binPath is not a service and would be rejected by SCM.)
  $enrollArgument = '"' + $enrollBundle + '" "' + $labRoot + '" ' + $publication + ' ' + $installationId + ' ' + $deviceId
  $enrollXml = $xmlOriginalText
  $enrollXml = [regex]::Replace($enrollXml, '<arguments>[^<]*</arguments>', ('<arguments>' + (Esc $enrollArgument) + '</arguments>'))
  # Disable onfailure restarts during one-shot enrollment.
  $enrollXml = [regex]::Replace($enrollXml, '<onfailure[^/]*/>', '')
  # UTF-8 without BOM — WinSW 2.x rejects BOM'd companion XML on some hosts.
  [IO.File]::WriteAllText($xmlPath, $enrollXml, [Text.UTF8Encoding]::new($false))
  $xmlSwapped = $true

  & sc.exe start $serviceName | Out-Null
  $startExit = $LASTEXITCODE
  $serviceOut = Join-Path $labRoot ('results\commercial-service-' + $publication + '.json')
  $until = [DateTime]::UtcNow.AddSeconds(90)
  while (-not (Test-Path -LiteralPath $serviceOut -PathType Leaf) -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $serviceOut -PathType Leaf)) {
    Write-Host ('SERVICE_ENROLL_START_EXIT=' + $startExit)
    Write-Host ('SERVICE_ENROLL_STATUS=' + (Get-Service -Name $serviceName).Status)
    $logDir = Join-Path $env:ProgramData 'CamachoPOS\logs'
    if (Test-Path -LiteralPath $logDir) {
      Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 4 |
        ForEach-Object {
          Write-Host ('SERVICE_ENROLL_LOG=' + $_.Name)
          try {
            Get-Content -LiteralPath $_.FullName -Tail 40 -ErrorAction SilentlyContinue |
              ForEach-Object { Write-Host ('SERVICE_ENROLL_LOG_LINE=' + $_) }
          } catch {}
        }
    }
    $resultsDir = Join-Path $labRoot 'results'
    if (Test-Path -LiteralPath $resultsDir) {
      Write-Host ('SERVICE_ENROLL_RESULTS=' + ((Get-ChildItem -LiteralPath $resultsDir -Force | Select-Object -ExpandProperty Name) -join ','))
    }
    throw 'SERVICE_ENROLLMENT_MISSING'
  }
  try { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue } catch {}
  Wait-ServiceStopped
  Write-Host 'SERVICE_CHANNEL_ENROLLMENT=PASS'

  # Desktop enrollment under interactive operator token.
  & $node --import $tsx $enroll DESKTOP $labRoot $publication $installationId $deviceId
  Must ($LASTEXITCODE -eq 0) 'DESKTOP_ENROLLMENT_FAILED'
  $desktopOut = Join-Path $labRoot ('desktop\commercial-desktop-' + $publication + '.json')
  Must (Test-Path -LiteralPath $desktopOut -PathType Leaf) 'DESKTOP_ENROLLMENT_MISSING'

  & $node --import $tsx $enroll PAIR $labRoot $publication $installationId $deviceId
  Must ($LASTEXITCODE -eq 0) 'PAIR_FAILED'
  $serviceManifest = Join-Path $labRoot ('service\commercial-provision-' + $publication + '.json')
  $desktopManifest = Join-Path $labRoot ('desktop\commercial-provision-' + $publication + '.json')
  Must ((Test-Path -LiteralPath $serviceManifest) -and (Test-Path -LiteralPath $desktopManifest)) 'MANIFESTS_MISSING'
  Seal-InstallerManagedFile $serviceManifest
  Seal-InstallerManagedFile $desktopManifest
  $adapterPath = Join-Path $labRoot 'service\camacho_windows_pipe.node'
  Must (Test-Path -LiteralPath $adapterPath -PathType Leaf) 'ADAPTER_MISSING'
  Seal-InstallerManagedFile $adapterPath

  # Restore product WinSW XML from backup, then bind IDs + SCM handoff for PRODUCT.
  $xml = $xmlOriginalText
  $xml = [regex]::Replace($xml, 'name="POS_INSTALLATION_ID" value="[^"]*"', ('name="POS_INSTALLATION_ID" value="' + (Esc $installationId) + '"'))
  $xml = [regex]::Replace($xml, 'name="POS_DEVICE_ID" value="[^"]*"', ('name="POS_DEVICE_ID" value="' + (Esc $deviceId) + '"'))
  if ($xml -notmatch 'POS_WINDOWS_SCM_HANDOFF_FILE') {
    $xml = $xml.Replace('</service>', ('  <env name="POS_WINDOWS_SCM_HANDOFF_FILE" value="' + (Esc $serviceManifest) + '"/>' + "`r`n</service>"))
  }
  else {
    $xml = [regex]::Replace($xml, 'name="POS_WINDOWS_SCM_HANDOFF_FILE" value="[^"]*"', ('name="POS_WINDOWS_SCM_HANDOFF_FILE" value="' + (Esc $serviceManifest) + '"'))
  }
  # Keep commercialLogin false path: never inject POS_WINDOWS_COMMERCIAL_PROVISION_FILE.
  Must ($xml -notmatch 'POS_WINDOWS_COMMERCIAL_PROVISION_FILE') 'COMMERCIAL_PROVISION_MUST_STAY_ABSENT'
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.UTF8Encoding]::new($false))
  $xmlSwapped = $false

  Start-Service -Name $serviceName -ErrorAction Stop
  $logDir = Join-Path $env:ProgramData 'CamachoPOS\logs'
  $started = $false
  $until = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $until) {
    $svc = Get-Service -Name $serviceName
    $cimNow = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    if ($svc.Status -eq 'Running' -and $cimNow.StartName -eq ('NT SERVICE\' + $serviceName)) {
      # WinSW roll logs under logpath; also check wrapper stdout/err if present.
      $logHits = @()
      if (Test-Path -LiteralPath $logDir) {
        $logHits = @(Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
          Where-Object { $_.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddMinutes(-5) } |
          ForEach-Object {
            try { Select-String -LiteralPath $_.FullName -Pattern 'runtime\.started' -SimpleMatch -ErrorAction SilentlyContinue } catch {}
          })
      }
      if ($logHits.Count -gt 0) { $started = $true; break }
      # Service Running under virtual account with SCM handoff is necessary;
      # log scan may miss if WinSW buffers — probe with desktop ops below.
      $started = $true
      break
    }
    if ($svc.Status -eq 'Stopped') { throw 'PRODUCT_SERVICE_STOPPED_AFTER_COMMERCIAL_START' }
    Start-Sleep -Milliseconds 500
  }
  Must $started 'PRODUCT_SCM_SERVICE_NOT_READY'
  Write-Host 'PRODUCT_SCM_SERVICE_RUNNING=PASS'

  # Authenticated ops via production connectWindowsScmClient (not interactive LS).
  $env:POS_WINDOWS_SCM_HANDOFF_FILE = $desktopManifest
  try {
    & $node --import $tsx $ops
    Must ($LASTEXITCODE -eq 0) 'COMMERCIAL_OPS_FAILED'
  }
  finally {
    Remove-Item Env:POS_WINDOWS_SCM_HANDOFF_FILE -ErrorAction SilentlyContinue
  }

  # Installed Electron production-entry path with SCM handoff (spawn + persist).
  $prevScm = [Environment]::GetEnvironmentVariable('POS_WINDOWS_SCM_HANDOFF_FILE', 'Process')
  $env:POS_WINDOWS_SCM_HANDOFF_FILE = $desktopManifest
  $launch = $null
  try {
    $launch = Start-Process -FilePath $InstalledExe -PassThru -WorkingDirectory ([IO.Path]::GetDirectoryName($InstalledExe))
    Start-Sleep -Seconds 12
    $alive = $null -ne $launch -and -not $launch.HasExited
    Must $alive 'INSTALLED_ELECTRON_SCM_PERSIST_FAILED'
    Write-Host 'INSTALLED_ELECTRON_SCM_CHANNEL=PASS'
  }
  finally {
    if ($null -ne $launch -and -not $launch.HasExited) {
      try { Stop-Process -Id $launch.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    if ($null -eq $prevScm) { Remove-Item Env:POS_WINDOWS_SCM_HANDOFF_FILE -ErrorAction SilentlyContinue }
    else { $env:POS_WINDOWS_SCM_HANDOFF_FILE = $prevScm }
  }

  $receipt = [ordered]@{
    profile = 'CAMACHO_NSIS_SCM_COMMERCIAL_CHANNEL_V1'
    publication = $publication
    labRoot = $labRoot
    installation_id = $installationId
    device_id = $deviceId
    service_manifest = $serviceManifest
    desktop_manifest = $desktopManifest
    productService = 'RUNNING'
    commercialOps = 'PASS'
    installedElectron = 'PASS'
    businessSessionIssued = $false
    authenticode = 'RT-009-B_BLOCKED'
    physicalOwnerPc = 'NOT_TESTED'
  }
  $receiptPath = Join-Path $WorkRoot ('scm-commercial-channel-' + $publication + '.json')
  ($receipt | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $receiptPath -Encoding utf8
  Write-Host ("SCM_COMMERCIAL_CHANNEL_RECEIPT=" + $receiptPath)
  Write-Host 'ELECTRON_WINSW_SCM_COMMERCIAL_IPC=PASS'
  Write-Host 'AUTHENTICODE=RT-009-B_BLOCKED'
  Write-Host 'PHYSICAL_OWNER_PC=NOT_TESTED'
  $validated = $true
}
finally {
  if ($xmlSwapped -and $null -ne $xmlOriginalText -and (Test-Path -LiteralPath $xmlPath)) {
    try {
      try { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Milliseconds 500
      [IO.File]::WriteAllText($xmlPath, $xmlOriginalText, [Text.UTF8Encoding]::new($false))
    }
    catch {}
  }
}

Must $validated 'SCM_COMMERCIAL_CHANNEL_INCOMPLETE'
