#requires -Version 5.1
# Real Windows SCM virtual-account and DPAPI identity probe in an ephemeral GitHub Actions VM.
# Does not run Camacho POS runtime, connect to Central, change existing installations, or enable commercial login.
[CmdletBinding()]
param([switch]$Run)
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
  $entropy=[Text.Encoding]::UTF8.GetBytes('CAMACHO_GITHUB_EPHEMERAL_SERVICE_IDENTITY_V1')
  $denied=$false
  try {
    $unexpected=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if($null -ne $unexpected){[Array]::Clear($unexpected,0,$unexpected.Length)}
  }catch [Security.Cryptography.CryptographicException] {$denied=$true}
  finally {[Array]::Clear($bytes,0,$bytes.Length)}
  Must $denied 'DESKTOP_COULD_UNPROTECT_SERVICE_DPAPI'
  Write-Host 'SCM_VIRTUAL_ACCOUNT_REAL=PASS'
  Write-Host 'SCM_SERVICE_SESSION_0=PASS'
  Write-Host 'SCM_SERVICE_DPAPI_CURRENTUSER=PASS'
  Write-Host 'DESKTOP_DPAPI_CROSS_IDENTITY_DENIED=PASS'
  Write-Host 'COMMERCIAL_SCM_ELECTRON_HANDSHAKE=NOT_TESTED'
  $validated=$true
} finally {
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
