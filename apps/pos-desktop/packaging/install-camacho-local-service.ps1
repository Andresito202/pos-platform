#requires -Version 5.1
<#
  Elevated helper: materialize WinSW XML from template, install/start or stop/uninstall
  CamachoPOSLocalService. Used by NSIS custom actions and the lab lifecycle.

  Does NOT clear SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN.
  Does NOT claim Authenticode for Camacho PE (RT-009-B).
  Verifies WinSW payload SHA-256 against payload-integrity.json when present.

  Virtual-account ACLs: after WinSW install creates NT SERVICE\CamachoPOSLocalService,
  grant RX on the payload and Modify on ProgramData data/log directories before start.
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
$serviceAccount = "NT SERVICE\$serviceId"
$winswExe = Join-Path $PayloadDir "$serviceId.exe"
$template = Join-Path $PayloadDir "$serviceId.xml.template"
$xmlPath = Join-Path $PayloadDir "$serviceId.xml"
$nodeExe = Join-Path $PayloadDir 'runtime\node.exe'
$bundle = Join-Path $PayloadDir 'local-service\pos-local-service.mjs'
$workDir = Join-Path $PayloadDir 'local-service'
$integrityFile = Join-Path $PayloadDir 'payload-integrity.json'
$logDirectory = Join-Path $env:ProgramData 'CamachoPOS\logs'

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

function Get-FileSha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  # Do NOT use Get-FileHash: nsExec-hosted Windows PowerShell often cannot resolve
  # Microsoft.PowerShell.Utility. Prefer certutil (always present on Windows), then BCL.
  $certutil = Join-Path $env:WINDIR 'System32\certutil.exe'
  if (Test-Path -LiteralPath $certutil -PathType Leaf) {
    $raw = & $certutil -hashfile $Path SHA256 2>&1
    if ($LASTEXITCODE -eq 0) {
      $hex = (
        @($raw | ForEach-Object { [string]$_ }) |
          Where-Object { $_ -match '^[0-9A-Fa-f]{64}$' -or $_ -match '^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2}){31}$' } |
          Select-Object -First 1
      )
      if ($hex) {
        return (($hex -replace '\s', '').ToLowerInvariant())
      }
    }
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

function Clear-ScmInstallOkMarker {
  $marker = Join-Path $env:ProgramData 'CamachoPOS\logs\scm-install.ok'
  if (Test-Path -LiteralPath $marker) {
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  }
}

function Write-ScmInstallOkMarker {
  param([Parameter(Mandatory = $true)]$Payload)
  $dir = Join-Path $env:ProgramData 'CamachoPOS\logs'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $marker = Join-Path $dir 'scm-install.ok'
  $body = [ordered]@{
    at = [DateTime]::UtcNow.ToString('o')
    serviceId = $serviceId
    startName = [string]$Payload.startName
    status = [string]$Payload.status
    identityOk = [bool]$Payload.identityOk
  }
  ($body | ConvertTo-Json -Compress) | Set-Content -LiteralPath $marker -Encoding ASCII
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

function Resolve-DataDirectory {
  if ([string]::IsNullOrWhiteSpace($DataDirectory)) {
    return (Join-Path $env:ProgramData 'CamachoPOS\lab-data')
  }
  return $DataDirectory
}

function Materialize-Xml {
  $script:resolvedDataDirectory = Resolve-DataDirectory
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
  if ($xml -notmatch '<logpath>') {
    throw 'WINSW_TEMPLATE_MISSING_LOGPATH'
  }
  # WinSW 2.12 XmlServiceConfig only binds <domain>/<user>. A lone <username>
  # is ignored and the service installs as LocalSystem — reject that shape.
  if ($xml -match '<username>') {
    throw 'WINSW_TEMPLATE_USES_USERNAME_NOT_DOMAIN_USER'
  }
  if ($xml -notmatch '(?s)<serviceaccount>.*<domain>NT SERVICE</domain>.*<user>CamachoPOSLocalService</user>') {
    throw 'WINSW_TEMPLATE_MISSING_VIRTUAL_SERVICEACCOUNT'
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

function Grant-VirtualServiceAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][Security.AccessControl.FileSystemRights]$Rights,
    [switch]$Directory
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "ACL_TARGET_MISSING:$Path"
  }
  $account = New-Object Security.Principal.NTAccount($serviceAccount)
  # Translate fails if the virtual account does not exist yet (must run after winsw install).
  $null = $account.Translate([Security.Principal.SecurityIdentifier])
  $acl = Get-Acl -LiteralPath $Path
  $inherit = [Security.AccessControl.InheritanceFlags]::None
  if ($Directory) {
    $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
  }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $account,
    $Rights,
    $inherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule) | Out-Null
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Grant-ServiceRuntimeAcls {
  # Payload under Program Files: RX for the virtual account (not a Users-group member).
  Grant-VirtualServiceAcl -Path $PayloadDir -Rights ([Security.AccessControl.FileSystemRights]::ReadAndExecute) -Directory
  # Data + logs under ProgramData: Modify for SQLite/DPAPI/WinSW logs (not Program Files).
  Grant-VirtualServiceAcl -Path $script:resolvedDataDirectory -Rights ([Security.AccessControl.FileSystemRights]::Modify) -Directory
  Grant-VirtualServiceAcl -Path $logDirectory -Rights ([Security.AccessControl.FileSystemRights]::Modify) -Directory
  # Parent CamachoPOS folder so the account can traverse.
  $camachoRoot = Join-Path $env:ProgramData 'CamachoPOS'
  if (Test-Path -LiteralPath $camachoRoot) {
    Grant-VirtualServiceAcl -Path $camachoRoot -Rights ([Security.AccessControl.FileSystemRights]::ReadAndExecute) -Directory
  }
}

function Get-ScmDiagnostics {
  $query = (& sc.exe queryex $serviceId 2>&1 | Out-String).Trim()
  $qc = (& sc.exe qc $serviceId 2>&1 | Out-String).Trim()
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
    scQueryEx = $query
    scQc = $qc
    logTail = $logTail
    xmlPath = $xmlPath
    payloadDir = $PayloadDir
    dataDirectory = $(if ($script:resolvedDataDirectory) { $script:resolvedDataDirectory } else { '' })
    logDirectory = $logDirectory
  }
}

function Invoke-WinSW {
  # Never name a parameter $args — it collides with the automatic $args variable
  # and Start-Process -ArgumentList receives $null ("Argument types"/null collection).
  param([Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$WinSwArguments)
  $clean = @($WinSwArguments | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  if ($clean.Count -eq 0) {
    throw 'WINSW_ARGUMENTS_EMPTY'
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

Write-HelperLog ("BEGIN action={0} payloadDir={1} dataDirectory={2} elevated={3}" -f $Action, $PayloadDir, $DataDirectory, $(
  try {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    [string]$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { 'unknown' }
))

try {

switch ($Action) {
  'Status' {
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    Write-Result @{
      ok = $true
      registered = [bool]$svc
      status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
      startType = $(if ($svc) { [string]$svc.StartType } else { '' })
      startName = $(if ($svc) {
          $cim = Get-CimInstance Win32_Service -Filter "Name='$serviceId'" -ErrorAction SilentlyContinue
          if ($cim) { [string]$cim.StartName } else { '' }
        } else { '' })
      payloadDir = $PayloadDir
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
    } 0
  }
  'Install' {
    Assert-Admin
    Clear-ScmInstallOkMarker
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
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_INSTALL_FAILED'
        exitCode = $installCode
      } (Get-ScmDiagnostics)) 5
    }

    # Fail closed before start if SCM did not bind the virtual account.
    $cimAfterInstall = Get-CimInstance Win32_Service -Filter "Name='$serviceId'" -ErrorAction SilentlyContinue
    $startNameAfterInstall = if ($cimAfterInstall) { [string]$cimAfterInstall.StartName } else { '' }
    if ($startNameAfterInstall -ne $serviceAccount) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_VIRTUAL_ACCOUNT_NOT_BOUND'
        startName = $startNameAfterInstall
        expectedStartName = $serviceAccount
        xmlSnippet = $(if (Test-Path -LiteralPath $xmlPath) {
            $xmlBody = [IO.File]::ReadAllText($xmlPath)
            (($xmlBody -split "`n") | Select-String -Pattern 'serviceaccount|domain|user|username' | ForEach-Object { $_.Line.Trim() }) -join ' | '
          } else { '' })
      } (Get-ScmDiagnostics)) 7
    }

    # Virtual account exists only after install — grant runtime ACLs before start.
    try {
      Grant-ServiceRuntimeAcls
    } catch {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'SERVICE_ACL_GRANT_FAILED'
        message = [string]$_.Exception.Message
        startName = $startNameAfterInstall
      } (Get-ScmDiagnostics)) 9
    }

    $startCode = Invoke-WinSW -WinSwArguments @('start')
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    $running = $null -ne $svc -and ($svc.Status -eq 'Running' -or $svc.Status -eq 'StartPending')
    if (-not $running) {
      Write-Result (Merge-Result @{
        ok = $false
        error = 'WINSW_START_FAILED'
        exitCode = $startCode
        status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
        startName = $startNameAfterInstall
      } (Get-ScmDiagnostics)) 6
    }
    # Give Node child time to bind pipe / open SQLite
    Start-Sleep -Seconds 5
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    $cim = Get-CimInstance Win32_Service -Filter "Name='$serviceId'" -ErrorAction SilentlyContinue
    $startName = if ($cim) { [string]$cim.StartName } else { '' }
    $identityOk = $startName -eq $serviceAccount
    $stillRunning = $null -ne $svc -and ($svc.Status -eq 'Running' -or $svc.Status -eq 'StartPending')
    if (-not ($stillRunning -and $identityOk)) {
      Write-Result (Merge-Result @{
        ok = $false
        error = $(if (-not $identityOk) { 'WINSW_VIRTUAL_ACCOUNT_NOT_BOUND' } else { 'WINSW_START_NOT_STABLE' })
        registered = ($null -ne $svc)
        status = $(if ($svc) { [string]$svc.Status } else { 'Absent' })
        startName = $startName
        identityOk = $identityOk
        dataDirectory = $script:resolvedDataDirectory
        logDirectory = $logDirectory
        xml = $xmlPath
        commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
        authenticodeProduct = 'RT-009-B_BLOCKED'
      } (Get-ScmDiagnostics)) 7
    }
    $success = @{
      ok = $true
      registered = $true
      status = [string]$svc.Status
      startName = $startName
      identityOk = $true
      dataDirectory = $script:resolvedDataDirectory
      logDirectory = $logDirectory
      xml = $xmlPath
      commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'
      authenticodeProduct = 'RT-009-B_BLOCKED'
      note = 'Service installed under NT SERVICE virtual account; commercial Desktop/NT SERVICE IPC remains NOT_PROVEN'
    }
    Write-ScmInstallOkMarker -Payload $success
    Write-Result $success 0
  }
  'Uninstall' {
    Assert-Admin
    # Do not require the full runtime payload (node/bundle/template). Uninstall must
    # succeed even if NSIS already removed part of $INSTDIR; otherwise the running
    # service keeps file locks and Program Files cannot be deleted.
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    $stopNotes = New-Object System.Collections.Generic.List[string]
    if ($svc) {
      try {
        Stop-Service -Name $serviceId -Force -ErrorAction Stop
        [void]$stopNotes.Add('Stop-Service=ok')
      } catch {
        [void]$stopNotes.Add(('Stop-Service=' + $_.Exception.Message))
      }
      $scStop = (& sc.exe stop $serviceId 2>&1 | Out-String).Trim()
      [void]$stopNotes.Add(('sc_stop=' + $scStop))
      for ($i = 0; $i -lt 45; $i++) {
        $wait = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
        if ($null -eq $wait -or $wait.Status -eq 'Stopped') { break }
        Start-Sleep -Seconds 1
      }
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
      # Authoritative SCM removal — WinSW uninstall alone can leave the key if the
      # process was busy or the exe was already deleted by NSIS.
      $scDelete = (& sc.exe delete $serviceId 2>&1 | Out-String).Trim()
      [void]$stopNotes.Add(('sc_delete=' + $scDelete))
      Start-Sleep -Seconds 2
    } else {
      [void]$stopNotes.Add('service_already_absent')
    }
    $after = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    # Never delete commercial AppData / ProgramData SQLite here.
    Write-Result @{
      ok = ($null -eq $after)
      registered = ($null -ne $after)
      dataPreserved = $true
      stopNotes = ([string[]]$stopNotes.ToArray() -join ' | ')
      note = 'Service removed; commercial data directories left intact'
    } $(if ($null -eq $after) { 0 } else { 8 })
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
