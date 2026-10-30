#requires -Version 5.1
<#
.SYNOPSIS
  One approved Windows Server VM operator invocation for SCM laboratory
  ACL custody, actual DPAPI enrollments, paired manifests and physical tests.
.DESCRIPTION
  No production enablement, no external CA, no credentials, no broad ACL
  relaxation, no Git mutation, no certificate replacement. The service is
  temporarily started ONLY under NT SERVICE\CamachoPOSLocalService to enroll
  its own Ed25519 CurrentUser DPAPI key; desktop RSA uses the actual
  interactive token. A temporary service runner is restored in finally.
  Incomplete/partial runs fail closed and are not automatically retried.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$LabRoot,
  [switch]$Apply,
  [switch]$RunPhysical
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$git='C:\Program Files\Git\cmd\git.exe'
$node='C:\Program Files\nodejs\node.exe'
$svcName='CamachoPOSLocalService'
$svcSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$systemSid='S-1-5-18'
$adminsSid='S-1-5-32-544'
$operatorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:runnerRestore=$null
$script:xmlRestore=$null
$script:serviceAclRestore=$null
$script:serviceStartedByUs=$false
$script:stagingActive=$false
$script:cleanupFailed=$false
$script:previousEnvironment=@{}
foreach($key in @('CAMACHO_SCM_EXPLICIT_OPERATOR_ENROLL','CAMACHO_SCM_LAB_ROOT','CAMACHO_SCM_ENROLL_ROLE','CAMACHO_SCM_OPERATOR_PRIVATE_FILE','CAMACHO_SCM_OPERATOR_PUBLIC_FILE','POS_INSTALLATION_ID','POS_DEVICE_ID')){
  $script:previousEnvironment[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
}
function Must([bool]$yes,[string]$code){if(-not $yes){throw $code}}
function Ace([string]$sid,[Security.AccessControl.FileSystemRights]$rights,[bool]$inherited){
  $inherit=if($inherited){[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
  return [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid),
    $rights,$inherit,[Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
}
function SetProtectedDir([string]$path,[string]$owner,[string[]]$readers,[string[]]$modifiers){
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($owner))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($who in @($systemSid,$adminsSid)){
    if($who -eq $owner -and $readers.Count -eq 0 -and $modifiers.Count -eq 0){continue}
    $acl.AddAccessRule((Ace $who ([Security.AccessControl.FileSystemRights]::FullControl) $true))
  }
  foreach($who in $readers){
    $acl.AddAccessRule((Ace $who ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $true))
  }
  foreach($who in $modifiers){
    $acl.AddAccessRule((Ace $who ([Security.AccessControl.FileSystemRights]::Modify) $true))
  }
  Set-Acl -LiteralPath $path -AclObject $acl -ErrorAction Stop
  $actual=Get-Acl -LiteralPath $path
  Must $actual.AreAccessRulesProtected 'DIRECTORY_ACL_INHERITANCE_REJECTED'
  Must ($actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $owner) 'DIRECTORY_OWNER_MISMATCH'
}
function SetOnlyOwner([string]$path,[string]$owner){
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $id=[Security.Principal.SecurityIdentifier]::new($owner)
  $acl.SetOwner($id)
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((Ace $owner ([Security.AccessControl.FileSystemRights]::FullControl) $true))
  Set-Acl -LiteralPath $path -AclObject $acl -ErrorAction Stop
  $got=Get-Acl -LiteralPath $path
  Must ($got.AreAccessRulesProtected -and $got.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $owner) 'PRIVATE_OWNER_REJECTED'
  $rules=@($got.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  Must ($rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $owner) 'PRIVATE_ACL_NOT_OWNER_ONLY'
}
function SetProtectedFile([string]$path){
  $acl=[Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($adminsSid))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($who in @($systemSid,$adminsSid)){
    $acl.AddAccessRule((Ace $who ([Security.AccessControl.FileSystemRights]::FullControl) $false))
  }
  foreach($who in @($svcSid,$operatorSid)){
    $acl.AddAccessRule((Ace $who ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $false))
  }
  Set-Acl -LiteralPath $path -AclObject $acl -ErrorAction Stop
  $got=Get-Acl -LiteralPath $path
  Must ($got.AreAccessRulesProtected -and $got.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $adminsSid) 'MANAGED_FILE_ACL_REJECTED'
}
try{
  Write-Host '=== CAMACHO POS | SCM LAB PHYSICAL PROVISION ==='
  Must ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'
  $machine=Get-CimInstance Win32_ComputerSystem
  Must (($machine.Manufacturer+' '+$machine.Model) -match '(?i)virtual|hyper-v|vmware|virtualbox') 'VM_REQUIRED'
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  Must ($admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'ELEVATED_ADMIN_REQUIRED'
  $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
  Must ($session -gt 0) 'INTERACTIVE_OPERATOR_REQUIRED'
  $lab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
  Must ($lab -match '(?i)^C:\\CamachoPosScmLab\\[0-9a-f]{32}$') 'LAB_ROOT_PATTERN_REJECTED'
  Must (Test-Path -LiteralPath $lab -PathType Container) 'LAB_ROOT_NOT_FOUND'
  Must (Test-Path -LiteralPath $git -PathType Leaf) 'GIT_MISSING'
  Must (Test-Path -LiteralPath $node -PathType Leaf) 'NODE_MISSING'
  Must ((& $git -C $repo branch --show-current).Trim() -eq 'feat/p0-windows-login-install-readiness') 'WRONG_BRANCH'
  Must (@(& $git -C $repo status --porcelain).Count -eq 0) 'WORKTREE_NOT_CLEAN'
  $svc=Get-CimInstance Win32_Service -Filter "Name='$svcName'"
  Must ($null -ne $svc -and $svc.StartName -eq ('NT SERVICE\'+$svcName) -and
    $svc.StartMode -eq 'Manual' -and $svc.State -eq 'Stopped') 'SCM_ACCOUNT_OR_STATE_REJECTED'
  $serviceDir=Join-Path $lab 'service'
  $desktopDir=Join-Path $lab 'desktop'
  $resultsDir=Join-Path $lab 'results'
  $runner=Join-Path $serviceDir 'run-physical-test.ps1'
  $xml=Join-Path $serviceDir 'CamachoPOSLocalService.xml'
  $wrapper=Join-Path $serviceDir 'CamachoPOSLocalService.exe'
  Must (Test-Path -LiteralPath $runner -PathType Leaf) 'EXISTING_RUNNER_MISSING'
  Must (Test-Path -LiteralPath $xml -PathType Leaf) 'WINSW_XML_MISSING'
  Must (Test-Path -LiteralPath $resultsDir -PathType Container) 'RESULT_DIR_MISSING'
  $signedWrapperSha=(Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash
  Must ($signedWrapperSha -eq 'D405E480FE1B14ED3895E06A4F7B4DB758CF270F09A2C1B607F415E747C5A7CD') 'WINSW_LAB_SIGNED_HASH_CHANGED'
  $sig=Get-AuthenticodeSignature -LiteralPath $wrapper
  Must ($sig.Status -eq 'Valid' -and $null -ne $sig.SignerCertificate -and
    $sig.SignerCertificate.Thumbprint -eq 'D66CDBD8B1564BF4B8A8F0664A3DCD17C39D0911') 'WINSW_LAB_SIGNATURE_REJECTED'
  $addonSource=Join-Path $repo 'packages\local-channel\native\build\Release\camacho_windows_pipe.node'
  $addonLab=Join-Path $serviceDir 'camacho_windows_pipe.node'
  Must (Test-Path -LiteralPath $addonSource -PathType Leaf) 'COMPILED_ADDON_MISSING'
  $servicePrivate=Join-Path $serviceDir 'private'
  $desktopPrivate=Join-Path $desktopDir 'private'
  $receiverPrivate=Join-Path $desktopPrivate 'receiver.dpapi.json'
  $signerPrivate=Join-Path $servicePrivate 'signer.dpapi.json'
  $receiverPublic=Join-Path $desktopPrivate 'receiver-public.json'
  $signerPublic=Join-Path $resultsDir 'service-signer-public.json'
  $desktopManifest=Join-Path $desktopDir 'desktop-provision.json'
  $serviceManifest=Join-Path $serviceDir 'service-provision.json'
  $idFile=Join-Path $lab 'scm-lab-identity.json'
  foreach($p in @($receiverPrivate,$signerPrivate,$receiverPublic,$signerPublic,$desktopManifest,$serviceManifest)){
    Must (-not (Test-Path -LiteralPath $p)) ('PARTIAL_ENROLLMENT_REQUIRES_REVIEW:'+ [IO.Path]::GetFileName($p))
  }
  if(-not $Apply){
    Write-Host 'PRECHECK=PASS'
    Write-Host 'CHANGES=NONE'
    Write-Host 'RUN_WITH_APPLY=REQUIRED'
    exit 2
  }
  $existingRunner=[IO.File]::ReadAllText($runner)
  Must ($existingRunner.Contains('CAMACHO_SCM_PHYSICAL_PROVISION') -and $existingRunner.Contains('windows-scm-physical.test.ts')) 'RUNNER_UNEXPECTED_CONTENT'
  $script:runnerRestore=[IO.File]::ReadAllBytes($runner)
  $script:xmlRestore=[IO.File]::ReadAllBytes($xml)

  # Installer-scoped real UUIDs, solely for isolated lab. Reuse if prepared.
  if(Test-Path -LiteralPath $idFile -PathType Leaf){
    $ids=Get-Content -LiteralPath $idFile -Raw | ConvertFrom-Json
    Must ($ids.profile -eq 'CAMACHO_SCM_VM_LAB_ONLY') 'LAB_IDS_UNTRUSTED'
  }else{
    $ids=[ordered]@{
      profile='CAMACHO_SCM_VM_LAB_ONLY'
      installation_id=[guid]::NewGuid().ToString()
      device_id=[guid]::NewGuid().ToString()
      created_utc=[DateTime]::UtcNow.ToString('o')
    }
  }
  # Ancestors: no changes to C:\, Program Files, repository or Windows 10.
  $parent='C:\CamachoPosScmLab'
  SetProtectedDir $parent $adminsSid @($svcSid,$operatorSid) @()
  SetProtectedDir $lab $adminsSid @($svcSid,$operatorSid) @()
  SetProtectedDir $serviceDir $adminsSid @($svcSid,$operatorSid) @()
  SetProtectedDir $desktopDir $adminsSid @($svcSid,$operatorSid) @()
  SetProtectedDir $resultsDir $adminsSid @($operatorSid) @($svcSid)
  if(-not (Test-Path -LiteralPath $desktopPrivate -PathType Container)){
    [void][IO.Directory]::CreateDirectory($desktopPrivate)
  }
  SetOnlyOwner $desktopPrivate $operatorSid
  if(-not (Test-Path -LiteralPath $idFile -PathType Leaf)){
    [IO.File]::WriteAllText($idFile,(ConvertTo-Json -InputObject $ids -Depth 4),[Text.UTF8Encoding]::new($false))
  }
  SetProtectedFile $idFile
  if(Test-Path -LiteralPath $addonLab -PathType Leaf){
    Must ((Get-FileHash $addonLab -Algorithm SHA256).Hash -eq
      (Get-FileHash $addonSource -Algorithm SHA256).Hash) 'LAB_ADDON_PREEXISTING_MISMATCH'
  }else{Copy-Item -LiteralPath $addonSource -Destination $addonLab -ErrorAction Stop}
  SetProtectedFile $addonLab
  SetProtectedFile $wrapper
  Must ((Get-AuthenticodeSignature -LiteralPath $wrapper).Status -eq 'Valid') 'WINSW_SIGNATURE_CHANGED_AFTER_ACL'
  Write-Host 'A_LAB_INSTALLER_ACL=PASS'
  # Windows signed service account creates its own owner-only private directory.
  # During this controlled enrollment, allow the service to create that folder.
  $script:serviceAclRestore=Get-Acl -LiteralPath $serviceDir
  $stageAcl=Get-Acl -LiteralPath $serviceDir
  $stageAcl.AddAccessRule((Ace $svcSid ([Security.AccessControl.FileSystemRights]::Modify) $false))
  Set-Acl -LiteralPath $serviceDir -AclObject $stageAcl
  $script:stagingActive=$true
  $xmlDoc=[xml][IO.File]::ReadAllText($xml)
  Must ($xmlDoc.service.id -eq $svcName) 'SERVICE_XML_MISMATCH'
  if($null -eq $xmlDoc.service.logpath){
    $logpath=$xmlDoc.CreateElement('logpath')
    $logpath.InnerText=$resultsDir
    [void]$xmlDoc.service.AppendChild($logpath)
  }else{$xmlDoc.service.logpath=$resultsDir}
  $xmlDoc.Save($xml)
  SetProtectedFile $xml

  $temporaryRunner=@'
$ErrorActionPreference='Stop'
$repo='C:\CamachoLab\pos-platform'
$lab='__LAB__'
$private=Join-Path $lab 'service\private'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if($id.Name -ne 'NT SERVICE\CamachoPOSLocalService' -or [Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0){exit 93}
if(Test-Path -LiteralPath $private){exit 94}
[void][IO.Directory]::CreateDirectory($private)
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($id.User)
$acl.SetAccessRuleProtection($true,$false)
[void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
 $id.User,[Security.AccessControl.FileSystemRights]::FullControl,
 [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
 [Security.AccessControl.PropagationFlags]::None,
 [Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $private -AclObject $acl
$env:CAMACHO_SCM_EXPLICIT_OPERATOR_ENROLL='1'
$env:CAMACHO_SCM_LAB_ROOT=$lab
$env:CAMACHO_SCM_ENROLL_ROLE='SERVICE'
$env:CAMACHO_SCM_OPERATOR_PRIVATE_FILE=Join-Path $private 'signer.dpapi.json'
$env:CAMACHO_SCM_OPERATOR_PUBLIC_FILE=Join-Path $private 'signer-public.json'
$env:POS_INSTALLATION_ID='__INSTALLATION__'
$env:POS_DEVICE_ID='__DEVICE__'
$vitest=Join-Path $repo 'apps\pos-local-service\node_modules\vitest\vitest.mjs'
& 'C:\Program Files\nodejs\node.exe' $vitest run --root (Join-Path $repo 'apps\pos-local-service') 'tests/windows-scm-enrollment.operator.test.ts' '--no-file-parallelism' '--reporter=json' ('--outputFile='+(Join-Path $lab 'results\service-enrollment.json'))
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Copy-Item -LiteralPath (Join-Path $private 'signer-public.json') -Destination (Join-Path $lab 'results\service-signer-public.json') -ErrorAction Stop
exit 0
'@
  $temporaryRunner=$temporaryRunner.Replace('__LAB__',$lab).Replace('__INSTALLATION__',[string]$ids.installation_id).Replace('__DEVICE__',[string]$ids.device_id)
  [IO.File]::WriteAllText($runner,$temporaryRunner,[Text.UTF8Encoding]::new($false))
  SetProtectedFile $runner
  Write-Host 'B_SERVICE_IDENTITY_ENROLLMENT=STARTING'
  $script:serviceStartedByUs=$true
  try {
    Start-Service -Name $svcName -ErrorAction Stop
  }catch{
    # WinSW may finish the one-shot before Start-Service observes Running.
    # The actual output and Vitest result are authoritative, not this race.
    Write-Host 'SERVICE_START_RETURNED_NONPASS_VERIFYING_RESULT'
  }
  $serviceEnrollReport=Join-Path $resultsDir 'service-enrollment.json'
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  while([DateTime]::UtcNow -lt $deadline){
    if((Test-Path -LiteralPath $serviceEnrollReport -PathType Leaf) -and
       (Test-Path -LiteralPath $signerPublic -PathType Leaf)){break}
    Start-Sleep -Milliseconds 500
  }
  Must (Test-Path -LiteralPath $serviceEnrollReport -PathType Leaf) 'SERVICE_ENROLLMENT_REPORT_MISSING'
  Must (Test-Path -LiteralPath $signerPublic -PathType Leaf) 'SERVICE_PUBLIC_ENROLLMENT_MISSING'
  $sr=Get-Content -LiteralPath $serviceEnrollReport -Raw | ConvertFrom-Json
  Must ($sr.numTotalTests -eq 1 -and $sr.numPassedTests -eq 1 -and $sr.numFailedTests -eq 0 -and $sr.numPendingTests -eq 0) 'SERVICE_ENROLLMENT_NOT_PASS'
  for($i=0;$i -lt 30;$i++){
    if((Get-Service -Name $svcName).Status -eq 'Stopped'){break}
    Start-Sleep -Milliseconds 300
  }
  Must ((Get-Service -Name $svcName).Status -eq 'Stopped') 'SERVICE_NOT_STOPPED_AFTER_ENROLLMENT'
  $script:serviceStartedByUs=$false
  Write-Host 'B_SERVICE_DPAPI_ENROLLED=PASS'

  # Restore the original physical runner before any further action.
  [IO.File]::WriteAllBytes($runner,$script:runnerRestore)
  # Keep the protected lab-only WinSW log path pointed at the writable results
  # directory. Restoring the old XML would redirect log writes into the now
  # read-only service directory and break the subsequent physical SCM start.
  SetProtectedFile $runner
  SetProtectedFile $xml
  Set-Acl -LiteralPath $serviceDir -AclObject $script:serviceAclRestore
  $script:stagingActive=$false
  $script:runnerRestore=$null
  $script:xmlRestore=$null

  $env:CAMACHO_SCM_EXPLICIT_OPERATOR_ENROLL='1'
  $env:CAMACHO_SCM_LAB_ROOT=$lab
  $env:CAMACHO_SCM_ENROLL_ROLE='DESKTOP'
  $env:CAMACHO_SCM_OPERATOR_PRIVATE_FILE=$receiverPrivate
  $env:CAMACHO_SCM_OPERATOR_PUBLIC_FILE=$receiverPublic
  $env:POS_INSTALLATION_ID=[string]$ids.installation_id
  $env:POS_DEVICE_ID=[string]$ids.device_id
  $vitest=Join-Path $repo 'apps\pos-local-service\node_modules\vitest\vitest.mjs'
  & $node $vitest run --root (Join-Path $repo 'apps\pos-local-service') 'tests/windows-scm-enrollment.operator.test.ts' '--no-file-parallelism' '--reporter=json' ('--outputFile='+(Join-Path $resultsDir 'desktop-enrollment.json'))
  Must ($LASTEXITCODE -eq 0) 'DESKTOP_ENROLLMENT_FAILED'
  Must ((Test-Path $receiverPrivate -PathType Leaf) -and (Test-Path $receiverPublic -PathType Leaf)) 'DESKTOP_DPAPI_NOT_CREATED'
  Write-Host 'B_DESKTOP_DPAPI_ENROLLED=PASS'

  Push-Location $repo
  try{
    & $node (Join-Path $repo 'tools\operators\windows-scm-manifest-pair.mjs') $lab $receiverPublic $signerPublic ([string]$ids.installation_id) ([string]$ids.device_id)
    Must ($LASTEXITCODE -eq 0) 'SCM_MANIFEST_PAIR_FAILED'
  }finally{Pop-Location}
  SetProtectedFile $desktopManifest
  SetProtectedFile $serviceManifest
  Write-Host 'C_MANIFESTS_PINNED_AND_PROTECTED=PASS'

  if($RunPhysical){
    # Existing operator tests: two genuine rounds, Node and Electron-as-Node.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-scm-physical-one-shot.ps1') -Run -LabRoot $lab -DesktopProvision $desktopManifest -ServiceResult (Join-Path $resultsDir 'service-physical.json')
    Must ($LASTEXITCODE -eq 0) 'D_PHYSICAL_NODE_ELECTRON_FAILED'
    Write-Host 'D_PHYSICAL_NODE_ELECTRON=PASS'
  }else{
    Write-Host 'D_PHYSICAL_NODE_ELECTRON=NOT_EXECUTED'
  }
  $centralPreflight=Join-Path $PSScriptRoot 'windows-login-deployment-preflight.ps1'
  Must (Test-Path -LiteralPath $centralPreflight -PathType Leaf) 'CENTRAL_PREFLIGHT_SCRIPT_MISSING'
  $centralRequired=@('POS_CENTRAL_BASE_URL','POS_WINDOWS_COMMERCIAL_PROVISION_FILE',
    'POS_WINDOWS_DESKTOP_COMMERCIAL_FILE','POS_AUTHORIZATION_TRUST_PROVISION_FILE',
    'POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM','POS_SESSION_TRUST_ENVIRONMENT')
  $missingCentral=@($centralRequired | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_,'Process'))
  })
  if($missingCentral.Count -gt 0){
    Write-Host ('E_CENTRAL_CONFIG_BLOCKED_MISSING='+($missingCentral -join ','))
  }else{
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $centralPreflight -Interactive -Json | Out-Null
    if($LASTEXITCODE -eq 0){Write-Host 'E_CENTRAL_CONFIG_PRESENCE=PASS_NOT_CERTIFIED'}
    else{Write-Host 'E_CENTRAL_CONFIG_PREFLIGHT=BLOCKED'}
  }
  Write-Host 'E_CENTRAL_LOGIN=NOT_CERTIFIED'
  Write-Host 'HUMAN_MFA=NOT_CERTIFIED'
  Write-Host 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE'
}catch{
  Write-Host ('SCM_LAB_PROVISION_FAILED='+$_.Exception.Message)
  Write-Host 'HUMAN_LOGIN_READY=NO'
  exit 2
}finally{
  if($script:serviceStartedByUs){
    try{Stop-Service -Name $svcName -Force -ErrorAction Stop}catch{
      $script:cleanupFailed=$true;Write-Host 'SCM_CLEANUP_SERVICE_STOP_UNVERIFIED'
    }
  }
  if($script:runnerRestore -ne $null){
    try{[IO.File]::WriteAllBytes($runner,$script:runnerRestore)}catch{$script:cleanupFailed=$true;Write-Host 'SCM_CLEANUP_RUNNER_RESTORE_UNVERIFIED'}
  }
  if($script:xmlRestore -ne $null){
    try{[IO.File]::WriteAllBytes($xml,$script:xmlRestore)}catch{$script:cleanupFailed=$true;Write-Host 'SCM_CLEANUP_XML_RESTORE_UNVERIFIED'}
  }
  if($script:stagingActive -and $script:serviceAclRestore -ne $null){
    try{Set-Acl -LiteralPath $serviceDir -AclObject $script:serviceAclRestore}catch{$script:cleanupFailed=$true;Write-Host 'SCM_CLEANUP_ACL_RESTORE_UNVERIFIED'}
  }
  foreach($key in $script:previousEnvironment.Keys){
    [Environment]::SetEnvironmentVariable($key,$script:previousEnvironment[$key],'Process')
  }
}

if($script:cleanupFailed){Write-Host 'SCM_LAB_CLEANUP=FAIL';exit 2}
