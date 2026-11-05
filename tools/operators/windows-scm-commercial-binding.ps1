#requires -Version 5.1
<# LAB ONLY. Preserves the v4 physical harness and DeviceIdentity keys. Enrolls
   distinct channel keys for the existing v7 device under their ACTUAL owners.
   Does not enroll DEV-003, issue a session or clear any certification gate. #>
[CmdletBinding()]
param([switch]$Run,[Parameter(Mandatory=$true)][string]$LabRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-scm-lab-binding.ps1')
$serviceName='CamachoPOSLocalService'
$serviceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$operatorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$started=$false;$replaced=$false;$backup=$null;$installedHash=$null;$lock=$null
function Must([bool]$ok,[string]$code){if(-not $ok){throw $code}}
function Hash([string]$p){return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}
function NoReparse([string]$p){
 $cursor=[IO.Path]::GetFullPath($p)
 while($cursor){
  Must (-not ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'COMMERCIAL_REPARSE_REJECTED'
  $cursor=[IO.Path]::GetDirectoryName($cursor)
 }
}
function InstallerManaged([string]$p){
 NoReparse $p
 $acl=Get-Acl -LiteralPath $p
 Must ($acl.AreAccessRulesProtected -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @('S-1-5-18','S-1-5-32-544')) 'INSTALLER_BOUNDARY_REJECTED'
 $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
 foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  Must ($ace.AccessControlType -eq 'Allow') 'INSTALLER_DENY_REQUIRES_REVIEW'
  if($ace.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){Must (($ace.FileSystemRights -band $write) -eq 0) 'INSTALLER_UNTRUSTED_WRITER'}
 }
}
function SealNew([string]$p){
 NoReparse $p
 $acl=[Security.AccessControl.FileSecurity]::new()
 $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544',$serviceSid,$operatorSid)){
  $rights=if($sid -in @('S-1-5-18','S-1-5-32-544')){'FullControl'}else{'ReadAndExecute'}
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),$rights,'Allow'))
 }
 Set-Acl -LiteralPath $p -AclObject $acl
}
function NewBytes([string]$p,[byte[]]$b){
 $s=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}
 SealNew $p
}
function NewText([string]$p,[string]$text){NewBytes $p ([Text.UTF8Encoding]::new($false).GetBytes($text))}
try{
 Must ([bool]$Run) 'EXPLICIT_RUN_REQUIRED'
 Must ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'
 $os=Get-CimInstance Win32_OperatingSystem
 Must ($os.BuildNumber -eq '20348' -and $os.ProductType -ne 1) 'SERVER_2022_LAB_REQUIRED'
 $machine=Get-CimInstance Win32_ComputerSystem
 Must (($machine.Manufacturer+' '+$machine.Model) -match '(?i)virtual|hyper-v') 'DISPOSABLE_VM_REQUIRED'
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 Must ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and [Diagnostics.Process]::GetCurrentProcess().SessionId -gt 0) 'INTERACTIVE_ELEVATED_VM_OPERATOR_REQUIRED'
 Must ($LabRoot -cmatch '^C:\\CamachoPosScmLab\\[a-f0-9]{32}$') 'LAB_ROOT_REJECTED'
 NoReparse $LabRoot
 Must ((& git -C $repo branch --show-current).Trim() -eq 'feat/p0-windows-login-install-readiness') 'BRANCH_REJECTED'
 Must (@(& git -C $repo status --porcelain --untracked-files=normal).Count -eq 0) 'CONCURRENT_WORK_REQUIRES_REVIEW'
 $sha=(& git -C $repo rev-parse HEAD).Trim()
 $serviceDir=Join-Path $LabRoot 'service'
 $runner=Join-Path $serviceDir 'run-physical-test.ps1'
 foreach($p in @($LabRoot,$serviceDir,(Join-Path $LabRoot 'desktop'),$runner)){InstallerManaged $p}
 $svc=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
 Must ($null -ne $svc -and $svc.StartName -eq ('NT SERVICE\'+$serviceName) -and $svc.StartMode -eq 'Manual' -and $svc.State -eq 'Stopped') 'SCM_STATE_OR_IDENTITY_REJECTED'
 $exe=Join-Path $serviceDir 'CamachoPOSLocalService.exe'
 Must (Test-WindowsScmLabImagePath $svc.PathName $exe) 'SCM_IMAGE_REJECTED'
 Must ((Hash $exe) -eq 'D405E480FE1B14ED3895E06A4F7B4DB758CF270F09A2C1B607F415E747C5A7CD') 'WINSW_HASH_REJECTED'
 Must ((Get-AuthenticodeSignature -LiteralPath $exe).Status -eq 'Valid') 'WINSW_SIGNATURE_REJECTED'
 $originalHash=Hash $runner
 $runtimes=@(Get-ChildItem -LiteralPath (Join-Path $LabRoot 'runtimes') -Directory | Where-Object {
  $_.Name -cmatch '^[a-f0-9]{32}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'READY.json')) -and
  (Test-Path -LiteralPath (Join-Path $_.FullName 'control\service-physical-runner.ps1')) -and
  (Hash (Join-Path $_.FullName 'control\service-physical-runner.ps1')) -eq $originalHash
 })
 Must ($runtimes.Count -eq 1) 'UNIQUE_EXISTING_BOUND_RUNTIME_REQUIRED'
 $runtime=$runtimes[0].FullName;NoReparse $runtime
 & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'windows-scm-isolated-runtime.ps1') -Mode Verify -RequireScmProbe -LabRoot $LabRoot -Attempt $runtime
 Must ($LASTEXITCODE -eq 0) 'ISOLATED_RUNTIME_REJECTED'
 # The frozen dependency/native runtime is reused only if every imported
 # channel source still equals the current reviewed commit (newline-neutral).
 foreach($name in @('windows-service-signer.ts','windows-handoff.ts','windows-handoff-native.ts','canonical-json.ts')){
  $relative='packages/local-channel/src/'+$name
  $current=[IO.File]::ReadAllText((Join-Path $repo $relative)).Replace("`r`n","`n")
  $frozen=[IO.File]::ReadAllText((Join-Path $runtime ('payload/'+$relative))).Replace("`r`n","`n")
  Must ($current -ceq $frozen) 'FROZEN_CHANNEL_SOURCE_CHANGED_REQUIRES_NEW_RUNTIME'
 }
 $publicPath=Join-Path $LabRoot 'results\service-device-public.json';NoReparse $publicPath
 $device=Get-Content -LiteralPath $publicPath -Raw | ConvertFrom-Json
 $installation=[string]$device.binding.installation_id;$deviceId=[string]$device.binding.device_id
 foreach($id in @($installation,$deviceId)){Must ($id -cmatch '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') 'EXISTING_UUID7_DEVICE_REQUIRED'}
 # Public receipt selects a device only; it is not accepted as authentication.
 $publication=[Guid]::NewGuid().ToString('N')
 $lockPath=Join-Path $serviceDir 'commercial-binding.lock'
 if(-not (Test-Path -LiteralPath $lockPath)){NewText $lockPath ''}
 NoReparse $lockPath
 $lockAcl=Get-Acl -LiteralPath $lockPath
 Must ($lockAcl.AreAccessRulesProtected -and $lockAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544') 'INSTALLER_LOCK_OWNER_REJECTED'
 InstallerManaged $lockPath
 $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $worker=Join-Path $serviceDir ('commercial-worker-'+$publication+'.mjs')
 # Worker imports its paired pure path validator from the same trusted folder.
 $pair=Join-Path $serviceDir 'windows-scm-manifest-pair.mjs'
 $pairSource=Join-Path $PSScriptRoot 'windows-scm-manifest-pair.mjs'
 if(Test-Path -LiteralPath $pair){InstallerManaged $pair;Must ((Hash $pair) -eq (Hash $pairSource)) 'EXISTING_WORKER_HELPER_CHANGED'}else{NewText $pair ([IO.File]::ReadAllText($pairSource))}
 NewText $worker ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-scm-commercial-binding-worker.mjs')))
 $backup=Join-Path $serviceDir ('runner-before-commercial-'+$publication+'.ps1')
 $originalBytes=[IO.File]::ReadAllBytes($runner)
 NewBytes $backup $originalBytes
 Must ((Hash $backup) -eq $originalHash) 'RUNNER_BACKUP_NOT_VERIFIED'
 $node=Join-Path $runtime 'payload\.scm-runtime\node.exe'
 $working=Join-Path $runtime 'payload\apps\central-authority'
 $serviceOutput=Join-Path $LabRoot ('results\commercial-service-'+$publication+'.json')
 $body=@"
`$ErrorActionPreference='Stop'
Set-Location -LiteralPath '$working'
& '$node' --import tsx '$worker' SERVICE '$LabRoot' '$runtime' '$publication' '$installation' '$deviceId'
exit `$LASTEXITCODE
"@
 Must ((Hash $runner) -eq $originalHash -and (Get-Service -Name $serviceName).Status -eq 'Stopped') 'CONCURRENT_RUNNER_OR_SERVICE_CHANGE'
 $originalAcl=(Get-Acl -LiteralPath $runner).Sddl
 $bodyBytes=[Text.UTF8Encoding]::new($false).GetBytes($body)
 $digest=[Security.Cryptography.SHA256]::Create()
 try{$installedHash=[BitConverter]::ToString($digest.ComputeHash($bodyBytes)).Replace('-','')}finally{$digest.Dispose()}
 $replaced=$true
 [IO.File]::WriteAllBytes($runner,$bodyBytes)
 Must ((Hash $runner) -eq $installedHash) 'RUNNER_WRITE_NOT_VERIFIED'
 Must ((Get-Acl -LiteralPath $runner).Sddl -eq $originalAcl) 'RUNNER_ACL_CHANGED'
 $started=$true
 try{Start-Service -Name $serviceName}catch{
  # One-shot may have exited before SCM reports Running; await its result.
 }
 $deadline=[DateTime]::UtcNow.AddSeconds(45)
 while(-not (Test-Path -LiteralPath $serviceOutput) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 250}
 Must (Test-Path -LiteralPath $serviceOutput -PathType Leaf) 'SERVICE_CHANNEL_ENROLLMENT_NOT_OBSERVED'
 if((Get-Service -Name $serviceName).Status -ne 'Stopped'){Stop-Service -Name $serviceName -ErrorAction Stop}
 $started=$false
 # Desktop custody stays under the currently logged-on RDP operator.
 Push-Location $working
 try{& $node --import tsx $worker DESKTOP $LabRoot $runtime $publication $installation $deviceId;Must ($LASTEXITCODE -eq 0) 'DESKTOP_ENROLLMENT_FAILED'}finally{Pop-Location}
 $desktopOutput=Join-Path $LabRoot ('desktop\commercial-desktop-'+$publication+'.json')
 # Use reviewed current source for canonical managed manifest validation.
 Push-Location $repo
 try{
  & pnpm --filter @pos-platform/central-authority exec tsx ../../tools/operators/windows-scm-manifest-pair.mjs $LabRoot $desktopOutput $serviceOutput $installation $deviceId ('--commercial-binding='+$publication)
  Must ($LASTEXITCODE -eq 0) 'PAIRED_PUBLICATION_FAILED'
 }finally{Pop-Location}
 $desktopManifest=Join-Path $LabRoot ('desktop\commercial-provision-'+$publication+'.json')
 $serviceManifest=Join-Path $LabRoot ('service\commercial-provision-'+$publication+'.json')
 SealNew $desktopManifest;SealNew $serviceManifest
 $receipt=[ordered]@{profile='CAMACHO_LAB_CHANNEL_BINDING_PREPARED';commit=$sha;publication=$publication;installation_id=$installation;device_id=$deviceId;desktop_manifest=$desktopManifest;service_manifest=$serviceManifest;runtime=$runtime;nativeChannelVerified=$false;freshDevicePossessionVerified=$false;businessSessionIssued=$false;humanLoginCertified=$false;productionCertified=$false}
 $receiptPath=Join-Path $serviceDir ('commercial-binding-'+$publication+'.json')
 NewText $receiptPath (ConvertTo-Json $receipt -Depth 5)
}finally{
 try{
  if($started -and (Get-Service -Name $serviceName).Status -ne 'Stopped'){Stop-Service -Name $serviceName -ErrorAction Stop}
  if($replaced){
   Must ((Hash $runner) -eq $installedHash) 'CONCURRENT_RUNNER_CHANGE_PRESERVED_RESTORE_REQUIRED'
   [IO.File]::WriteAllBytes($runner,$originalBytes)
   Must ((Hash $runner) -eq $originalHash -and (Get-Acl -LiteralPath $runner).Sddl -eq $originalAcl) 'RUNNER_RESTORE_NOT_VERIFIED'
  }
 }finally{if($null -ne $lock){$lock.Dispose()}}
}
Write-Host ('LAB_COMMERCIAL_CHANNEL_PREPARED='+$receiptPath)
Write-Host 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE'
