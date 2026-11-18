#requires -Version 5.1
<#
.SYNOPSIS
  G1 native pipe identity proof against the NSIS-installed CamachoPOSLocalService.

.DESCRIPTION
  Lab-only. Temporarily retargets the already-registered SCM virtual account to the
  ephemeral C# identity probe + native peer (same attestation as the disposable
  G1 lab), then restores the WinSW image path and restarts the product service.

  Proves: NT SERVICE\CamachoPOSLocalService (Session 0) ↔ interactive desktop peer
  on the SAME SCM registration NSIS created. Does NOT enroll commercial keys,
  open BUSINESS sessions, clear SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN,
  or claim Electron commercial handshake.
#>
[CmdletBinding()]
param(
  [switch]$Run,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$ResultsRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Must([bool]$ok, [string]$code) {
  if (-not $ok) { throw $code }
}

function Get-ScBinPath([string]$Name) {
  $qc = & sc.exe qc $Name 2>&1 | Out-String
  Must ($LASTEXITCODE -eq 0) 'SC_QC_FAILED'
  # BINARY_PATH_NAME : "C:\...\exe" args...
  $line = @($qc -split "`r?`n" | Where-Object { $_ -match 'BINARY_PATH_NAME' })
  Must ($line.Count -eq 1) 'SC_QC_BINPATH_MISSING'
  $raw = ($line[0] -replace '^\s*BINARY_PATH_NAME\s*:\s*', '').Trim()
  Must (-not [string]::IsNullOrWhiteSpace($raw)) 'SC_QC_BINPATH_EMPTY'
  return $raw
}

function Format-ScConfigBinPath([string]$Exe, [string]$Arg) {
  # sc config binPath= requires the entire value as one token; quote exe + arg.
  return ('"' + $Exe + '" "' + $Arg + '"')
}

Must ([bool]$Run) 'EXPLICIT_RUN_REQUIRED'
Must ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'
Must ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_OS -eq 'Windows') 'EPHEMERAL_GITHUB_WINDOWS_REQUIRED'
$os = Get-CimInstance Win32_OperatingSystem
Must ($os.BuildNumber -eq '20348' -and $os.ProductType -ne 1) 'SERVER_2022_REQUIRED'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
Must $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) 'ADMIN_REQUIRED'

$serviceName = 'CamachoPOSLocalService'
$serviceSid = 'S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$admins = 'S-1-5-32-544'
$system = 'S-1-5-18'
$repo = [IO.Path]::GetFullPath($RepoRoot)
$resultsParent = [IO.Path]::GetFullPath($ResultsRoot)
Must (Test-Path -LiteralPath $repo -PathType Container) 'REPO_ROOT_MISSING'
New-Item -ItemType Directory -Force -Path $resultsParent | Out-Null

$lab = Join-Path $resultsParent ('g1-installed-' + [Guid]::NewGuid().ToString('N'))
$bin = Join-Path $lab 'bin'
$results = Join-Path $lab 'results'
$exe = Join-Path $bin 'CamachoHostedScmProbe.exe'
$source = Join-Path $repo 'tools\operators\ci-windows-scm-identity-service.cs'
$createdDirs = $false
$binPathSwapped = $false
$originalBinPath = $null
$labUser = $null
$labProcess = $null
$labSecret = $null
$validated = $false
$restored = $false

function Ace([string]$sid, [Security.AccessControl.FileSystemRights]$rights) {
  return [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid), $rights,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
}

function SealDirectory([string]$path, [Security.AccessControl.FileSystemRights]$serviceRights) {
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($admins))
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((Ace $admins ([Security.AccessControl.FileSystemRights]::FullControl)))
  $acl.AddAccessRule((Ace $system ([Security.AccessControl.FileSystemRights]::FullControl)))
  $acl.AddAccessRule((Ace $serviceSid $serviceRights))
  Set-Acl -LiteralPath $path -AclObject $acl
  $check = Get-Acl -LiteralPath $path
  Must ($check.AreAccessRulesProtected -and $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $admins) 'LAB_DIRECTORY_ACL_UNTRUSTED'
}

try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
  Must ($null -ne $svc) 'INSTALLED_SCM_SERVICE_REQUIRED'
  Must ($svc.StartName -eq ('NT SERVICE\' + $serviceName)) 'INSTALLED_SCM_IDENTITY_REJECTED'
  $originalBinPath = Get-ScBinPath $serviceName
  Must ($originalBinPath -match '(?i)CamachoPOSLocalService\.exe') 'INSTALLED_WINSW_IMAGE_REQUIRED'

  foreach ($dir in @($lab, $bin, $results)) {
    [void][IO.Directory]::CreateDirectory($dir)
  }
  $createdDirs = $true
  SealDirectory $lab ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
  SealDirectory $bin ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
  SealDirectory $results ([Security.AccessControl.FileSystemRights]::Modify)

  $addonSource = Join-Path $repo 'packages\local-channel\native\build\Release\camacho_windows_pipe.node'
  $scriptSource = Join-Path $repo 'tools\operators\ci-windows-scm-native-peer.mjs'
  Must (Test-Path -LiteralPath $addonSource -PathType Leaf) 'NATIVE_ADDON_NOT_COMPILED'
  Must (Test-Path -LiteralPath $scriptSource -PathType Leaf) 'NATIVE_TEST_SCRIPT_MISSING'
  Must (Test-Path -LiteralPath $source -PathType Leaf) 'PROBE_SOURCE_MISSING'

  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  Must (Test-Path -LiteralPath $csc -PathType Leaf) 'NETFRAMEWORK_CSC_MISSING'
  & $csc '/nologo' '/target:exe' '/platform:x64' ('/out:' + $exe) '/reference:System.ServiceProcess.dll' '/reference:System.Security.dll' $source
  Must ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe -PathType Leaf)) 'EPHEMERAL_SERVICE_COMPILATION_FAILED'

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $addon = Join-Path $bin 'camacho_windows_pipe.node'
  $peerScript = Join-Path $bin 'ci-windows-scm-native-peer.mjs'
  Copy-Item -LiteralPath $addonSource -Destination $addon -ErrorAction Stop
  Copy-Item -LiteralPath $scriptSource -Destination $peerScript -ErrorAction Stop

  $labUser = 'camachog1' + ([Guid]::NewGuid().ToString('N').Substring(0, 9))
  $password = [Guid]::NewGuid().ToString('N') + '!Aa9' + [Guid]::NewGuid().ToString('N')
  $labSecret = ConvertTo-SecureString $password -AsPlainText -Force
  $password = $null
  New-LocalUser -Name $labUser -Password $labSecret -AccountNeverExpires -UserMayNotChangePassword -ErrorAction Stop | Out-Null
  Add-LocalGroupMember -Group 'Users' -Member $labUser -ErrorAction Stop
  $userSid = (Get-LocalUser -Name $labUser).SID.Value
  Must ($userSid -match '^S-1-5-21-') 'EPHEMERAL_DESKTOP_ACCOUNT_SID_INVALID'
  foreach ($entry in @(
      @{ p = $lab; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute },
      @{ p = $bin; rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute },
      @{ p = $results; rights = [Security.AccessControl.FileSystemRights]::Modify }
    )) {
    $acl = Get-Acl -LiteralPath $entry.p
    $acl.AddAccessRule((Ace $userSid $entry.rights))
    Set-Acl -LiteralPath $entry.p -AclObject $acl -ErrorAction Stop
    Must ((Get-Acl -LiteralPath $entry.p).AreAccessRulesProtected) 'LAB_DESKTOP_ACL_NOT_PROTECTED'
  }

  $policyFile = Join-Path $results 'native-policy.json'
  $credential = [PSCredential]::new('.\' + $labUser, $labSecret)
  $labProcess = Start-Process -FilePath $node -Credential $credential -ArgumentList @(
    ('"' + $peerScript + '"'), 'desktop', ('"' + $policyFile + '"')
  ) -PassThru -ErrorAction Stop
  $credential = $null
  $identityFile = Join-Path $results 'native-client-identity.json'
  $until = [DateTime]::UtcNow.AddSeconds(40)
  while (-not (Test-Path -LiteralPath $identityFile -PathType Leaf) -and [DateTime]::UtcNow -lt $until) {
    if ($labProcess.HasExited) { throw 'EPHEMERAL_DESKTOP_PEER_EXITED_DURING_IDENTITY' }
    Start-Sleep -Milliseconds 100
  }
  Must (Test-Path -LiteralPath $identityFile -PathType Leaf) 'EPHEMERAL_DESKTOP_TOKEN_PROOF_MISSING'
  $peer = Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
  Must ($peer.user_sid -eq $userSid -and $peer.logon_sid -match '^S-1-5-5-[0-9]+-[0-9]+$' -and
    [int]$peer.session -gt 0) 'EPHEMERAL_DESKTOP_TOKEN_PROOF_REJECTED'
  $policy = @{
    profile   = 'CAMACHO_EPHEMERAL_NATIVE_PIPE_G1_ONLY'
    endpoint  = ('\\.\pipe\camacho-pos-' + [Guid]::NewGuid().ToString() + '-scm')
    service   = $serviceSid
    recipient = $userSid
    logon     = $peer.logon_sid
    session   = [int]$peer.session
    addon     = $addon
    results   = $results
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($policyFile, $policy, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllLines((Join-Path $results 'native-runner.txt'),
    [string[]]@($node, $peerScript, $policyFile), [Text.UTF8Encoding]::new($false))

  # Stop product WinSW, swap binPath to identity probe under the SAME virtual account.
  if ((Get-Service -Name $serviceName).Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Get-Service -Name $serviceName).Status -ne 'Stopped' -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  Must ((Get-Service -Name $serviceName).Status -eq 'Stopped') 'SCM_STOP_TIMEOUT'

  $probeBinPath = Format-ScConfigBinPath $exe $results
  & sc.exe config $serviceName binPath= $probeBinPath | Out-Null
  Must ($LASTEXITCODE -eq 0) 'SCM_BINPATH_SWAP_FAILED'
  $binPathSwapped = $true
  $swapped = Get-ScBinPath $serviceName
  Must ($swapped -like ('*' + [IO.Path]::GetFileName($exe) + '*')) 'SCM_BINPATH_SWAP_NOT_OBSERVED'

  & sc.exe start $serviceName | Out-Null
  Must ($LASTEXITCODE -eq 0) 'SCM_PROBE_START_FAILED'
  $proof = Join-Path $results 'service-proof.txt'
  $failure = Join-Path $results 'service-failure.txt'
  $until = [DateTime]::UtcNow.AddSeconds(40)
  while (-not (Test-Path -LiteralPath $proof) -and -not (Test-Path -LiteralPath $failure) -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 250
  }
  Must (-not (Test-Path -LiteralPath $failure)) 'SCM_PROBE_IDENTITY_OR_DPAPI_FAILED'
  Must (Test-Path -LiteralPath $proof -PathType Leaf) 'SCM_PROBE_RECEIPT_MISSING'
  $receipt = Get-Content -LiteralPath $proof -Raw
  Must ($receipt.Contains('SERVICE_IDENTITY=PASS') -and $receipt.Contains('SESSION_ZERO=PASS') -and $receipt.Contains('DPAPI_CURRENTUSER=PASS')) 'SCM_PROBE_RECEIPT_UNTRUSTED'

  $cipher = Join-Path $results 'service-dpapi-ciphertext.txt'
  Must (Test-Path -LiteralPath $cipher -PathType Leaf) 'SCM_DPAPI_CIPHER_MISSING'
  $bytes = [Convert]::FromBase64String((Get-Content -LiteralPath $cipher -Raw).Trim())
  Add-Type -AssemblyName System.Security -ErrorAction Stop
  $entropy = [Text.Encoding]::UTF8.GetBytes('CAMACHO_GITHUB_EPHEMERAL_SERVICE_IDENTITY_V1')
  $denied = $false
  try {
    $unexpected = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ($null -ne $unexpected) { [Array]::Clear($unexpected, 0, $unexpected.Length) }
  }
  catch [Security.Cryptography.CryptographicException] { $denied = $true }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
  Must $denied 'DESKTOP_COULD_UNPROTECT_SERVICE_DPAPI'

  $ready = Join-Path $results 'native-ready.json'
  $until = [DateTime]::UtcNow.AddSeconds(30)
  while (-not (Test-Path -LiteralPath $ready -PathType Leaf) -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 100
  }
  Must (Test-Path -LiteralPath $ready -PathType Leaf) 'NATIVE_SERVICE_PIPE_NOT_LISTENING'
  $desktopProof = Join-Path $results 'native-desktop-pass.json'
  $until = [DateTime]::UtcNow.AddSeconds(30)
  while (-not (Test-Path -LiteralPath $desktopProof -PathType Leaf) -and [DateTime]::UtcNow -lt $until) {
    if ($labProcess.HasExited) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $desktopProof -PathType Leaf)) {
    foreach ($role in @('service', 'desktop')) {
      $failurePath = Join-Path $results ('native-' + $role + '-failure.json')
      if (Test-Path -LiteralPath $failurePath -PathType Leaf) {
        $detail = Get-Content -LiteralPath $failurePath -Raw | ConvertFrom-Json
        Write-Host ('G1_NATIVE_' + $role.ToUpperInvariant() + '_FAIL_PHASE=' + $detail.phase)
        if ($role -eq 'desktop' -and $detail.phase -eq 'DESKTOP_CONNECT') {
          Write-Host ('G1_NATIVE_SCM_TOKEN_QUERY=' + [string]$detail.scm_token_query)
          Write-Host ('G1_NATIVE_CONNECT_STAGE=' + [string]$detail.native_stage)
        }
      }
    }
  }
  Must (Test-Path -LiteralPath $desktopProof -PathType Leaf) 'NATIVE_DESKTOP_CONNECT_FAILED'
  $serviceProof = Join-Path $results 'native-service-pass.json'
  $until = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath $serviceProof -PathType Leaf) -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 100
  }
  Must ((Test-Path -LiteralPath $serviceProof -PathType Leaf) -and (Test-Path -LiteralPath $desktopProof -PathType Leaf)) 'G1_TWO_OS_IDENTITY_RECEIPTS_REQUIRED'
  $a = Get-Content -LiteralPath $serviceProof -Raw | ConvertFrom-Json
  $d = Get-Content -LiteralPath $desktopProof -Raw | ConvertFrom-Json
  Must ($a.status -eq 'PASS' -and $a.peer_role -eq 'DESKTOP' -and $d.status -eq 'PASS' -and $d.peer_role -eq 'SCM_SERVICE') 'G1_NATIVE_PEER_PROOF_REJECTED'

  Write-Host 'G1_NATIVE_ON_INSTALLED_SCM=PASS'
  Write-Host 'G1_NATIVE_SCM_TO_INTERACTIVE_IDENTITY=PASS'
  Write-Host 'G1_NATIVE_PEER_RECHECK=PASS'
  Write-Host 'SCM_VIRTUAL_ACCOUNT_REAL=PASS'
  Write-Host 'SCM_SERVICE_SESSION_0=PASS'
  Write-Host 'SCM_SERVICE_DPAPI_CURRENTUSER=PASS'
  Write-Host 'DESKTOP_DPAPI_CROSS_IDENTITY_DENIED=PASS'
  Write-Host 'COMMERCIAL_SCM_ELECTRON_HANDSHAKE=NOT_TESTED'
  Write-Host 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE'
  $validated = $true
}
finally {
  if ($null -ne $labProcess) {
    try {
      if (-not $labProcess.HasExited) { $labProcess.Kill() }
      $labProcess.WaitForExit(5000) | Out-Null
      $labProcess.Dispose()
    }
    catch {}
  }
  if ($null -ne $labUser) {
    try { Remove-LocalUser -Name $labUser -ErrorAction Stop } catch {}
  }
  $labSecret = $null

  # Always attempt to restore WinSW image path and leave service Running when possible.
  try {
    $svcNow = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $svcNow) {
      if ($svcNow.Status -ne 'Stopped') {
        try { Stop-Service -Name $serviceName -Force -ErrorAction Stop } catch {}
        Start-Sleep -Milliseconds 800
      }
      if ($binPathSwapped -and $null -ne $originalBinPath) {
        & sc.exe config $serviceName binPath= $originalBinPath | Out-Null
        if ($LASTEXITCODE -eq 0) {
          $restoredCheck = Get-ScBinPath $serviceName
          if ($restoredCheck -match '(?i)CamachoPOSLocalService\.exe') { $restored = $true }
        }
      }
      elseif (-not $binPathSwapped) { $restored = $true }
      if ($restored) {
        try {
          Start-Service -Name $serviceName -ErrorAction Stop
          $cim = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
          if ($null -eq $cim -or $cim.StartName -ne ('NT SERVICE\' + $serviceName)) {
            $restored = $false
          }
        }
        catch { $restored = $false }
      }
    }
  }
  catch { $restored = $false }

  # Retain receipts on failure; scrub only after validated+restored.
  if ($validated -and $restored -and $createdDirs) {
    try { Remove-Item -LiteralPath $lab -Recurse -Force -ErrorAction Stop } catch {}
  }
  else {
    Write-Host ("G1_LAB_RECEIPTS_RETAINED=" + $lab)
  }
}

Must $validated 'G1_ON_INSTALLED_SCM_INCOMPLETE'
Must $restored 'WINSW_IMAGE_RESTORE_OR_RESTART_FAILED'
Write-Host 'WINSW_IMAGE_RESTORED_AFTER_G1=PASS'
