#requires -Version 5.1
# Real Windows SCM virtual-account and DPAPI identity probe in an ephemeral GitHub Actions VM.
# Does not run Camacho POS runtime, connect to Central, change existing installations, or enable commercial login.
[CmdletBinding()]
param([switch]$Run,[switch]$NativePipe)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Must([bool]$ok,[string]$code){if(-not $ok){throw $code}}
Must ([bool]$Run -and $env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_OS -eq 'Windows') 'EPHEMERAL_GITHUB_WINDOWS_REQUIRED'
$os=Get-CimInstance Win32_OperatingSystem
Must ($os.BuildNumber -eq '20348' -and $os.ProductType -ne 1) 'SERVER_2022_REQUIRED'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
Must $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) 'ADMIN_REQUIRED'
$serviceName='CamachoPOSLocalService'
Must ($null -eq (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) 'EXISTING_SCM_SERVICE_MUST_NOT_BE_CHANGED'
$serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$admins='S-1-5-32-544';$system='S-1-5-18'
$lab=Join-Path 'C:\ProgramData\CamachoActionsScmLab' ([Guid]::NewGuid().ToString('N'))
$bin=Join-Path $lab 'bin';$results=Join-Path $lab 'results'
$exe=Join-Path $bin 'CamachoHostedScmProbe.exe'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$source=Join-Path $PSScriptRoot 'ci-windows-scm-identity-service.cs'
$created=$false;$cleanupOk=$true;$validated=$false
$labUser=$null;$labProcess=$null;$labSecret=$null
function Ace([string]$sid,[Security.AccessControl.FileSystemRights]$rights){
  return [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid),$rights,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
}
function SealDirectory([string]$path,[Security.AccessControl.FileSystemRights]$serviceRights){
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($admins))
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((Ace $admins ([Security.AccessControl.FileSystemRights]::FullControl)))
  $acl.AddAccessRule((Ace $system ([Security.AccessControl.FileSystemRights]::FullControl)))
  $acl.AddAccessRule((Ace $serviceSid $serviceRights))
  Set-Acl -LiteralPath $path -AclObject $acl
  $check=Get-Acl -LiteralPath $path
  Must ($check.AreAccessRulesProtected -and $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $admins) 'LAB_DIRECTORY_ACL_UNTRUSTED'
}
try {
  foreach($dir in @($lab,$bin,$results)){[void][IO.Directory]::CreateDirectory($dir)}
  SealDirectory $lab ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
  SealDirectory $bin ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
  SealDirectory $results ([Security.AccessControl.FileSystemRights]::Modify)

  $csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  Must (Test-Path -LiteralPath $csc -PathType Leaf) 'NETFRAMEWORK_CSC_MISSING'
  & $csc '/nologo' '/target:exe' '/platform:x64' ('/out:'+$exe) '/reference:System.ServiceProcess.dll' '/reference:System.Security.dll' $source
  Must ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe -PathType Leaf)) 'EPHEMERAL_SERVICE_COMPILATION_FAILED'

  if($NativePipe){
    $addonSource=Join-Path $repo 'packages/local-channel/native/build/Release/camacho_windows_pipe.node'
    $scriptSource=Join-Path $repo 'tools/operators/ci-windows-scm-native-peer.mjs'
    Must (Test-Path -LiteralPath $addonSource -PathType Leaf) 'NATIVE_ADDON_NOT_COMPILED'
    Must (Test-Path -LiteralPath $scriptSource -PathType Leaf) 'NATIVE_TEST_SCRIPT_MISSING'
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    $addon=Join-Path $bin 'camacho_windows_pipe.node'
    $peerScript=Join-Path $bin 'ci-windows-scm-native-peer.mjs'
    Copy-Item -LiteralPath $addonSource -Destination $addon -ErrorAction Stop
    Copy-Item -LiteralPath $scriptSource -Destination $peerScript -ErrorAction Stop
    # The hosted runner token has no logon SID. Create a disposable, low
    # privilege *interactive logon*, rather than claiming a fabricated SID.
    $labUser='camachog1'+([Guid]::NewGuid().ToString('N').Substring(0,9))
    $password=[Guid]::NewGuid().ToString('N')+'!Aa9'+[Guid]::NewGuid().ToString('N')
    $labSecret=ConvertTo-SecureString $password -AsPlainText -Force
    $password=$null
    New-LocalUser -Name $labUser -Password $labSecret -AccountNeverExpires -UserMayNotChangePassword -ErrorAction Stop | Out-Null
    Add-LocalGroupMember -Group 'Users' -Member $labUser -ErrorAction Stop
    $userSid=(Get-LocalUser -Name $labUser).SID.Value
    Must ($userSid -match '^S-1-5-21-') 'EPHEMERAL_DESKTOP_ACCOUNT_SID_INVALID'
    foreach($entry in @(
      @{p=$lab; rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute},
      @{p=$bin; rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute},
      @{p=$results; rights=[Security.AccessControl.FileSystemRights]::Modify}
    )){
      $acl=Get-Acl -LiteralPath $entry.p
      $acl.AddAccessRule((Ace $userSid $entry.rights))
      Set-Acl -LiteralPath $entry.p -AclObject $acl -ErrorAction Stop
      Must ((Get-Acl -LiteralPath $entry.p).AreAccessRulesProtected) 'LAB_DESKTOP_ACL_NOT_PROTECTED'
    }
    $policyFile=Join-Path $results 'native-policy.json'
    $credential=[PSCredential]::new(('.\'+$labUser),$labSecret)
    $labProcess=Start-Process -FilePath $node -Credential $credential -ArgumentList @(
      ('"'+$peerScript+'"'),'desktop',('"'+$policyFile+'"')
    ) -PassThru -ErrorAction Stop
    $credential=$null
    $identityFile=Join-Path $results 'native-client-identity.json'
    $until=[DateTime]::UtcNow.AddSeconds(40)
    while(-not (Test-Path -LiteralPath $identityFile -PathType Leaf) -and [DateTime]::UtcNow -lt $until){
      if($labProcess.HasExited){throw 'EPHEMERAL_DESKTOP_PEER_EXITED_DURING_IDENTITY'}
      Start-Sleep -Milliseconds 100
    }
    Must (Test-Path -LiteralPath $identityFile -PathType Leaf) 'EPHEMERAL_DESKTOP_TOKEN_PROOF_MISSING'
    $peer=Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
    Must ($peer.user_sid -eq $userSid -and $peer.logon_sid -match '^S-1-5-5-[0-9]+-[0-9]+$' -and
      [int]$peer.session -gt 0) 'EPHEMERAL_DESKTOP_TOKEN_PROOF_REJECTED'
    $policy=@{
      profile='CAMACHO_EPHEMERAL_NATIVE_PIPE_G1_ONLY'
      endpoint=('\\.\pipe\camacho-pos-'+[Guid]::NewGuid().ToString()+'-scm')
      service=$serviceSid
      recipient=$userSid
      logon=$peer.logon_sid
      session=[int]$peer.session
      addon=$addon
      results=$results
    }|ConvertTo-Json -Compress
    [IO.File]::WriteAllText($policyFile,$policy,[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllLines((Join-Path $results 'native-runner.txt'),
      [string[]]@($node,$peerScript,$policyFile),[Text.UTF8Encoding]::new($false))
  }
  # Separate probe binary. Commercial WinSW is deliberately not installed here.
  $arguments=@('create',$serviceName,'binPath=',($exe+' '+$results),'start=','demand','obj=',('NT SERVICE\'+$serviceName),'type=','own')
  & sc.exe @arguments
  Must ($LASTEXITCODE -eq 0) 'SCM_VIRTUAL_ACCOUNT_CREATE_FAILED'
  $created=$true
  & sc.exe sidtype $serviceName unrestricted | Out-Null
  Must ($LASTEXITCODE -eq 0) 'SCM_SERVICE_SID_CONFIGURATION_FAILED'
  $svc=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  Must ($null -ne $svc -and $svc.StartName -eq ('NT SERVICE\'+$serviceName) -and $svc.StartMode -eq 'Manual') 'SCM_ACCOUNT_OR_MODE_REJECTED'
  & sc.exe start $serviceName | Out-Null
  Must ($LASTEXITCODE -eq 0) 'SCM_PROBE_START_FAILED'
  $proof=Join-Path $results 'service-proof.txt'
  $failure=Join-Path $results 'service-failure.txt'
  $until=[DateTime]::UtcNow.AddSeconds(40)
  while(-not (Test-Path -LiteralPath $proof) -and -not (Test-Path -LiteralPath $failure) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 250}
  Must (-not (Test-Path -LiteralPath $failure)) 'SCM_PROBE_IDENTITY_OR_DPAPI_FAILED'
  Must (Test-Path -LiteralPath $proof -PathType Leaf) 'SCM_PROBE_RECEIPT_MISSING'
  $receipt=Get-Content -LiteralPath $proof -Raw
  Must ($receipt.Contains('SERVICE_IDENTITY=PASS') -and $receipt.Contains('SESSION_ZERO=PASS') -and $receipt.Contains('DPAPI_CURRENTUSER=PASS')) 'SCM_PROBE_RECEIPT_UNTRUSTED'
  $cipher=Join-Path $results 'service-dpapi-ciphertext.txt'
  Must (Test-Path -LiteralPath $cipher -PathType Leaf) 'SCM_DPAPI_CIPHER_MISSING'
  $bytes=[Convert]::FromBase64String((Get-Content -LiteralPath $cipher -Raw).Trim())
  Add-Type -AssemblyName System.Security -ErrorAction Stop
  $entropy=[Text.Encoding]::UTF8.GetBytes('CAMACHO_GITHUB_EPHEMERAL_SERVICE_IDENTITY_V1')
  $denied=$false
  try {
    $unexpected=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if($null -ne $unexpected){[Array]::Clear($unexpected,0,$unexpected.Length)}
  }catch [Security.Cryptography.CryptographicException] {$denied=$true}
  finally {[Array]::Clear($bytes,0,$bytes.Length)}
  Must $denied 'DESKTOP_COULD_UNPROTECT_SERVICE_DPAPI'
  if($NativePipe){
    $ready=Join-Path $results 'native-ready.json'
    $until=[DateTime]::UtcNow.AddSeconds(30)
    while(-not (Test-Path -LiteralPath $ready -PathType Leaf) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
    Must (Test-Path -LiteralPath $ready -PathType Leaf) 'NATIVE_SERVICE_PIPE_NOT_LISTENING'
    $desktopProof=Join-Path $results 'native-desktop-pass.json'
    $until=[DateTime]::UtcNow.AddSeconds(30)
    while(-not (Test-Path -LiteralPath $desktopProof -PathType Leaf) -and [DateTime]::UtcNow -lt $until){
      if($labProcess.HasExited){break}
      Start-Sleep -Milliseconds 100
    }
    if(-not (Test-Path -LiteralPath $desktopProof -PathType Leaf)){
      foreach($role in @('service','desktop')){
        $failurePath=Join-Path $results ('native-'+$role+'-failure.json')
        if(Test-Path -LiteralPath $failurePath -PathType Leaf){
          $detail=Get-Content -LiteralPath $failurePath -Raw | ConvertFrom-Json
          Write-Host ('G1_NATIVE_'+$role.ToUpperInvariant()+'_FAIL_PHASE='+$detail.phase)
          if($role -eq 'desktop' -and $detail.phase -eq 'DESKTOP_CONNECT'){
            $classification=[string]$detail.scm_token_query
            if($classification -notin @('PROCESS_OPEN_DENIED','TOKEN_QUERY_DENIED','TOKEN_QUERY_ALLOWED','TOKEN_PROBE_INCONCLUSIVE')){
              $classification='TOKEN_PROBE_INCONCLUSIVE'
            }
            Write-Host ('G1_NATIVE_SCM_TOKEN_QUERY='+$classification)
            $nativeStage=[string]$detail.native_stage
            if($nativeStage -notin @('DESKTOP_SELF_IDENTITY','DESKTOP_PIPE_OPEN','DESKTOP_PREFACE','DESKTOP_SERVER_ATTESTATION')){
              $nativeStage='NOT_CLASSIFIED'
            }
            Write-Host ('G1_NATIVE_CONNECT_STAGE='+$nativeStage)
          }
        }
      }
    }
    Must (Test-Path -LiteralPath $desktopProof -PathType Leaf) 'NATIVE_DESKTOP_CONNECT_FAILED'
    $serviceProof=Join-Path $results 'native-service-pass.json'
    $desktopProof=Join-Path $results 'native-desktop-pass.json'
    $until=[DateTime]::UtcNow.AddSeconds(10)
    while(-not (Test-Path -LiteralPath $serviceProof -PathType Leaf) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
    Must ((Test-Path -LiteralPath $serviceProof -PathType Leaf) -and (Test-Path -LiteralPath $desktopProof -PathType Leaf)) 'G1_TWO_OS_IDENTITY_RECEIPTS_REQUIRED'
    $a=Get-Content -LiteralPath $serviceProof -Raw | ConvertFrom-Json
    $d=Get-Content -LiteralPath $desktopProof -Raw | ConvertFrom-Json
    Must ($a.status -eq 'PASS' -and $a.peer_role -eq 'DESKTOP' -and $d.status -eq 'PASS' -and $d.peer_role -eq 'SCM_SERVICE') 'G1_NATIVE_PEER_PROOF_REJECTED'
    Write-Host 'G1_NATIVE_SCM_TO_INTERACTIVE_IDENTITY=PASS'
    Write-Host 'G1_NATIVE_PEER_RECHECK=PASS'
  }
  Write-Host 'SCM_VIRTUAL_ACCOUNT_REAL=PASS'
  Write-Host 'SCM_SERVICE_SESSION_0=PASS'
  Write-Host 'SCM_SERVICE_DPAPI_CURRENTUSER=PASS'
  Write-Host 'DESKTOP_DPAPI_CROSS_IDENTITY_DENIED=PASS'
  Write-Host 'COMMERCIAL_SCM_ELECTRON_HANDSHAKE=NOT_TESTED'
  $validated=$true
} finally {
  if($labProcess -ne $null){
    try{if(-not $labProcess.HasExited){$labProcess.Kill()}; $labProcess.WaitForExit(5000) | Out-Null; $labProcess.Dispose()}catch{$cleanupOk=$false}
  }
  if($labUser -ne $null){
    try{Remove-LocalUser -Name $labUser -ErrorAction Stop}catch{$cleanupOk=$false}
  }
  $labSecret=$null;
  if($created){
    try {& sc.exe stop $serviceName 2>&1 | Out-Null}catch{}
    Start-Sleep -Milliseconds 800
    try {& sc.exe delete $serviceName 2>&1 | Out-Null; if($LASTEXITCODE -ne 0){$cleanupOk=$false}}catch{$cleanupOk=$false}
  }
  if($cleanupOk){
    try {Remove-Item -LiteralPath $lab -Recurse -Force -ErrorAction Stop}catch{$cleanupOk=$false}
  }
  if(-not $cleanupOk){throw 'EPHEMERAL_SERVICE_CLEANUP_NOT_PROVEN'}
}
Must $validated 'SERVICE_PROBE_INCOMPLETE'
