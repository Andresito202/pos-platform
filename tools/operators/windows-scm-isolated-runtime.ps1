#requires -Version 5.1
<#
Lab-only isolated test preparation. No SCM operations or DPAPI access.
Prepare creates a NEW attempt. Verify/Probe are read-only except scratch outputs.
Recover restores only journaled ACLs of this attempt; it never deletes evidence.
#>
[CmdletBinding()]
param(
 [ValidateSet('Prepare','Verify','Probe','Recover')][string]$Mode='Verify',
 [Parameter(Mandatory=$true)][string]$LabRoot,
 [Parameter(Mandatory=$true)][string]$Attempt,
 [string]$Repository='C:\CamachoLab\pos-platform',
 [string]$Node='C:\Program Files\nodejs\node.exe',
 [string]$PnpmCli='C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js',
 [string]$NativeAddon,
 [string]$NativeAddonSha256,
 [switch]$RequireScmProbe
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$runtimeServiceSid='S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569'
$runtimeOperatorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$preparationLock=$null
. (Join-Path $PSScriptRoot 'windows-scm-junction-acl.ps1')
function RuntimeMust([bool]$ok,[string]$code){if(-not $ok){throw $code}}
function RuntimeNoReparse([string]$path){
 $cursor=[IO.Path]::GetFullPath($path)
 while($cursor){
  $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
  RuntimeMust (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'RUNTIME_REPARSE_REJECTED'
  $parent=[IO.Path]::GetDirectoryName($cursor)
  if($parent -eq $cursor){break};$cursor=$parent
 }
}
function RuntimeAcl([bool]$directory,[bool]$writable=$false){
 $acl=if($directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544',$runtimeServiceSid)){
  $rights=if($sid -ne $runtimeServiceSid){[Security.AccessControl.FileSystemRights]::FullControl}elseif($writable){[Security.AccessControl.FileSystemRights]::Modify}else{[Security.AccessControl.FileSystemRights]::ReadAndExecute}
  $inherit=if($directory -and ($sid -ne $runtimeServiceSid -or $writable)){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
   [Security.Principal.SecurityIdentifier]::new($sid),$rights,$inherit,
   [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
 }
 return $acl
}
function RuntimeCheckAcl([string]$path,[bool]$writable=$false){
 RuntimeNoReparse $path
 $item=Get-Item -LiteralPath $path -Force
 $actual=Get-Acl -LiteralPath $path
 RuntimeMust $actual.AreAccessRulesProtected 'RUNTIME_ACL_NOT_PROTECTED'
 RuntimeMust ($actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'RUNTIME_UNTRUSTED_OWNER'
 $expected=RuntimeAcl $item.PSIsContainer $writable
 $wanted=@($expected.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 $got=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 RuntimeMust ($got.Count -eq $wanted.Count) 'RUNTIME_UNEXPECTED_ACE'
 foreach($rule in $wanted){
  $matches=@($got | Where-Object {
   $_.IdentityReference.Value -eq $rule.IdentityReference.Value -and
   $_.AccessControlType -eq $rule.AccessControlType -and
   $_.FileSystemRights -eq $rule.FileSystemRights -and
   $_.InheritanceFlags -eq $rule.InheritanceFlags -and
   $_.PropagationFlags -eq $rule.PropagationFlags -and -not $_.IsInherited
  })
  RuntimeMust ($matches.Count -eq 1) 'RUNTIME_RX_OR_WRITE_ISOLATION_FAILED'
 }
}
function RuntimeTargetAcl([string]$path,[bool]$writable=$false){
 $item=Get-Item -LiteralPath $path -Force
 $acl=Get-Acl -LiteralPath $path
 # Retain Windows' existing DACL metadata (including AI) for exact recovery.
 $acl.SetAccessRuleProtection($true,$false)
 foreach($ace in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($ace)}
 foreach($ace in (RuntimeAcl $item.PSIsContainer $writable).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$acl.AddAccessRule($ace)}
 return $acl
}
function RuntimeSeal([string[]]$paths,[string]$journal,[string]$work){
 # Persist the complete bounded pre-write journal once, before the first ACL.
 # No ownership changes. Junctions are sealed separately through pinned handles.
 $changes=@(foreach($path in @($paths | Sort-Object {$_.Split('\').Count} -Descending)){
  RuntimeNoReparse $path
  $item=Get-Item -LiteralPath $path -Force
  $before=Get-Acl -LiteralPath $path
  RuntimeMust ($before.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'RUNTIME_UNTRUSTED_OWNER'
  foreach($ace in $before.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   RuntimeMust ($ace.AccessControlType -ne 'Deny') 'RUNTIME_DENY_REQUIRES_REVIEW'
   if($ace.IdentityReference.Value -in @($runtimeServiceSid,'S-1-1-0','S-1-5-11','S-1-5-6','S-1-2-0')){
    $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    RuntimeMust (($ace.FileSystemRights -band $write) -eq 0) 'RUNTIME_PREEXISTING_WRITER_REJECTED'
   }
  }
  $expected=RuntimeTargetAcl $path ($path -eq $work)
  [pscustomobject]@{Path=$path;Directory=$item.PSIsContainer;Owner=$before.GetOwner([Security.Principal.SecurityIdentifier]).Value;Before=$before.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access);Expected=$expected.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
 })
 $json=ConvertTo-Json -InputObject @($changes) -Depth 5
 $stream=[IO.File]::Open($journal,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes($json);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
 foreach($change in $changes){
  RuntimeNoReparse $change.Path
  $now=Get-Acl -LiteralPath $change.Path
  RuntimeMust ($now.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $change.Before) 'RUNTIME_CONCURRENT_ACL_CHANGE'
  $desired=RuntimeTargetAcl $change.Path ($change.Path -eq $work)
  RuntimeMust ($desired.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $change.Expected) 'RUNTIME_CONCURRENT_TARGET_ACL_CHANGE'
  Set-Acl -LiteralPath $change.Path -AclObject $desired
  RuntimeMust ((Get-Acl -LiteralPath $change.Path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $change.Expected) 'RUNTIME_POSTWRITE_SDDL_CHANGED'
  RuntimeCheckAcl $change.Path ($change.Path -eq $work)
 }
}
function RuntimeRestore([string]$attempt,[string]$journal){
 $changes=Get-Content -LiteralPath $journal -Raw -Encoding UTF8 | ConvertFrom-Json
 $changes=@($changes)
 $ok=$true
 for($i=$changes.Count-1;$i -ge 0;$i--){
  $change=$changes[$i]
  try{
   $target=[IO.Path]::GetFullPath($change.Path)
   RuntimeMust ($target.StartsWith($attempt+'\',[StringComparison]::OrdinalIgnoreCase) -or $target -eq $attempt) 'RUNTIME_RECOVERY_PATH_REJECTED'
   RuntimeNoReparse $target
   RuntimeMust ((Get-Item -LiteralPath $target).PSIsContainer -eq $change.Directory) 'RUNTIME_RECOVERY_KIND_CHANGED'
   $acl=Get-Acl -LiteralPath $target
   RuntimeMust ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $change.Owner) 'RUNTIME_RECOVERY_OWNER_CHANGED'
   $current=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
   if($current -eq $change.Before){continue}
   RuntimeMust ($current -eq $change.Expected) 'RUNTIME_RECOVERY_CONCURRENT_ACL'
   $acl.SetSecurityDescriptorSddlForm($change.Before,[Security.AccessControl.AccessControlSections]::Access)
   Set-Acl -LiteralPath $target -AclObject $acl
   RuntimeMust ((Get-Acl -LiteralPath $target).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $change.Before) 'RUNTIME_RECOVERY_UNVERIFIED'
  }catch{$ok=$false;Write-Host ('RUNTIME_RECOVERY_REVIEW='+$change.Path)}
 }
 return $ok
}
function RuntimeCheckOperatorWork([string]$path){
 $stack=[Collections.Generic.Stack[string]]::new();$stack.Push($path)
 while($stack.Count -gt 0){
  foreach($item in Get-ChildItem -LiteralPath $stack.Pop() -Force){
   RuntimeNoReparse $item.FullName
   $acl=Get-Acl -LiteralPath $item.FullName
   RuntimeMust ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'RUNTIME_OPERATOR_CACHE_OWNER_UNTRUSTED'
   foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000 -bor 0x40000000
    if($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -ne 0){
     RuntimeMust ($ace.IdentityReference.Value -in @('S-1-5-18','S-1-5-32-544',$runtimeOperatorSid)) 'RUNTIME_OPERATOR_CACHE_WRITABLE_BY_OTHER_IDENTITY'
    }
   }
   if($item.PSIsContainer){$stack.Push($item.FullName)}
  }
 }
}
function RuntimePayloadPaths([string]$attempt){
 $manifest=Get-Content -LiteralPath (Join-Path $attempt 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $payload=Join-Path $attempt 'payload'
 $paths=[Collections.Generic.List[string]]::new()
 [void]$paths.Add($payload)
 foreach($entry in $manifest.files){
  $p=[IO.Path]::GetFullPath((Join-Path $payload $entry.path))
  RuntimeMust ($p.StartsWith($payload+'\',[StringComparison]::OrdinalIgnoreCase)) 'RUNTIME_MANIFEST_PATH_REJECTED'
  if($entry.type -ne 'link'){[void]$paths.Add($p)}
 }
 return $paths.ToArray()
}
try{
 RuntimeMust ([string]::IsNullOrWhiteSpace($env:NODE_OPTIONS) -and [string]::IsNullOrWhiteSpace($env:NODE_PATH)) 'RUNTIME_NODE_INJECTION_REJECTED'
 RuntimeMust ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitOperatingSystem) 'WINDOWS_X64_REQUIRED'
 $lab=[IO.Path]::GetFullPath($LabRoot).TrimEnd('\')
 RuntimeMust ($lab -match '(?i)^C:\\CamachoPosScmLab\\[a-f0-9]{32}$') 'RUNTIME_LAB_ROOT_REJECTED'
 RuntimeNoReparse $lab
 # Existing lab custody is inspected, never changed. Do not inspect private children.
 foreach($parent in @([IO.Path]::GetDirectoryName($lab),$lab)){
  RuntimeNoReparse $parent
  $parentAcl=Get-Acl -LiteralPath $parent
  RuntimeMust ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @('S-1-5-18','S-1-5-32-544')) 'RUNTIME_LAB_PARENT_OWNER_REJECTED'
  foreach($ace in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if($ace.AccessControlType -eq 'Deny' -and $ace.IdentityReference.Value -in @($runtimeServiceSid,'S-1-1-0','S-1-5-11','S-1-5-6','S-1-2-0') -and ($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne 0){throw 'RUNTIME_LAB_PARENT_DENY_REQUIRES_REVIEW'}
   $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000 -bor 0x40000000
   if($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -ne 0){
    RuntimeMust ($ace.IdentityReference.Value -in @('S-1-5-18','S-1-5-32-544')) 'RUNTIME_LAB_PARENT_WRITABLE'
   }
  }
 }
 $attemptPath=[IO.Path]::GetFullPath($Attempt).TrimEnd('\')
 $prefix=Join-Path $lab 'runtimes'
 RuntimeMust ($attemptPath -match ('(?i)^'+[regex]::Escape($prefix)+'\\[a-f0-9]{32}$')) 'RUNTIME_ATTEMPT_PATH_REJECTED'
 $tool=Join-Path $PSScriptRoot 'windows-scm-isolated-runtime.mjs'
 if($Mode -eq 'Prepare'){
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  RuntimeMust ($admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'RUNTIME_ADMIN_REQUIRED'
  $machine=Get-CimInstance Win32_ComputerSystem
  RuntimeMust (($machine.Manufacturer+' '+$machine.Model) -match '(?i)virtual|hyper-v|vmware|qemu|kvm|virtualbox') 'RUNTIME_VM_REQUIRED'
  RuntimeMust ($NativeAddonSha256 -match '^[a-fA-F0-9]{64}$' -and (Test-Path -LiteralPath $NativeAddon -PathType Leaf)) 'RUNTIME_NATIVE_INPUT_REQUIRED'
  RuntimeNoReparse $Repository
  if(Test-Path -LiteralPath $attemptPath){
   RuntimeNoReparse $attemptPath
   RuntimeMust (Test-Path -LiteralPath (Join-Path $attemptPath 'READY.json')) 'RUNTIME_PARTIAL_ATTEMPT_PRESERVED_USE_NEW_ID_OR_RECOVER'
   $expectedHead=(& git -C $Repository rev-parse HEAD).Trim()
   RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_SOURCE_HEAD_UNAVAILABLE'
   $prior=Get-Content -LiteralPath (Join-Path $attemptPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
   RuntimeMust ($prior.source.commit -eq $expectedHead) 'RUNTIME_PREPARED_FOR_ANOTHER_COMMIT'
   $Mode='Verify'
  }else{
   if(-not (Test-Path -LiteralPath $prefix)){[void][IO.Directory]::CreateDirectory($prefix);Set-Acl -LiteralPath $prefix -AclObject (RuntimeAcl $true)}
   RuntimeCheckAcl $prefix
   [void][IO.Directory]::CreateDirectory($attemptPath)
   # Exclusive claim before any ACL or installer mutation of this attempt.
   $preparationLock=[IO.File]::Open((Join-Path $attemptPath '.prepare.lock'),[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
   # Staging starts admin/SYSTEM-only. There is no inherited SCM write access.
   $initial=[Security.AccessControl.DirectorySecurity]::new()
   $initial.SetAccessRuleProtection($true,$false)
   foreach($sid in @('S-1-5-18','S-1-5-32-544')){
    $initial.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
     [Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
   }
   Set-Acl -LiteralPath $attemptPath -AclObject $initial
   try{
    & $Node $tool stage $Repository $attemptPath $PnpmCli $NativeAddon $NativeAddonSha256
    RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_STAGE_FAILED_SEE_RETAINED_LOGS'
    $control=Join-Path $attemptPath 'control';[void][IO.Directory]::CreateDirectory($control)
    RuntimeMust ((Get-FileHash $tool -Algorithm SHA256).Hash -eq (Get-FileHash (Join-Path $attemptPath 'payload\tools\operators\windows-scm-isolated-runtime.mjs') -Algorithm SHA256).Hash) 'RUNTIME_CONTROL_NOT_IN_SNAPSHOT'
    RuntimeMust ((Get-FileHash $PSCommandPath -Algorithm SHA256).Hash -eq (Get-FileHash (Join-Path $attemptPath 'payload\tools\operators\windows-scm-isolated-runtime.ps1') -Algorithm SHA256).Hash) 'RUNTIME_PS_CONTROL_NOT_IN_SNAPSHOT'
    Copy-Item -LiteralPath $tool -Destination $control
    Copy-Item -LiteralPath $PSCommandPath -Destination $control
    $junctionHelper=Join-Path $PSScriptRoot 'windows-scm-junction-acl.ps1'
    RuntimeMust ((Get-FileHash $junctionHelper -Algorithm SHA256).Hash -eq (Get-FileHash (Join-Path $attemptPath 'payload\tools\operators\windows-scm-junction-acl.ps1') -Algorithm SHA256).Hash) 'JUNCTION_HELPER_NOT_IN_SNAPSHOT'
    Copy-Item -LiteralPath $junctionHelper -Destination $control
    & $Node $tool runners $attemptPath
    RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_RUNNER_CANDIDATES_FAILED'
    $work=Join-Path $attemptPath 'work\service'
    # Work may contain smoke output/cache. Its descendants inherit ONLY here.
    Initialize-JunctionNative (Join-Path $attemptPath 'work\operator')
    $junctions=@(JunctionPlan $attemptPath)
    # Protect junction objects BEFORE sealing parents, without following targets.
    JunctionSeal (Join-Path $attemptPath 'payload') $junctions (Join-Path $attemptPath 'junction-before.json')
    $paths=@(RuntimePayloadPaths $attemptPath)
    $paths+=@($control,(Join-Path $control 'windows-scm-isolated-runtime.mjs'),(Join-Path $control 'windows-scm-isolated-runtime.ps1'),(Join-Path $control 'service-probe-runner.ps1'),(Join-Path $control 'service-physical-runner.ps1'),(Join-Path $attemptPath 'manifest.json'),(Join-Path $attemptPath 'dependencies.json'),(Join-Path $attemptPath 'work'),(Join-Path $attemptPath 'work\operator'),$work,$attemptPath)
    $paths+=@((Join-Path $control 'windows-scm-junction-acl.ps1'),(Join-Path $attemptPath 'junction-before.json'))
    RuntimeSeal $paths (Join-Path $attemptPath 'acl-before.json') $work
    & $Node (Join-Path $control 'windows-scm-isolated-runtime.mjs') check-tree $attemptPath
    RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_CHANGED_BEFORE_READY'
    JunctionVerify (Join-Path $attemptPath 'payload') $junctions
    $ready=[ordered]@{schema=2;junctionPolicy='nofollow-v1';junctionPlanSha256=(Get-FileHash (Join-Path $attemptPath 'junction-before.json') -Algorithm SHA256).Hash.ToLowerInvariant();junctionHelperSha256=(Get-FileHash (Join-Path $control 'windows-scm-junction-acl.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();operatorSid=$runtimeOperatorSid;manifestSha256=(Get-FileHash (Join-Path $attemptPath 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant();controlNodeSha256=(Get-FileHash (Join-Path $control 'windows-scm-isolated-runtime.mjs') -Algorithm SHA256).Hash.ToLowerInvariant();controlPsSha256=(Get-FileHash (Join-Path $control 'windows-scm-isolated-runtime.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();probeRunnerSha256=(Get-FileHash (Join-Path $control 'service-probe-runner.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();physicalRunnerSha256=(Get-FileHash (Join-Path $control 'service-physical-runner.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();dependenciesSha256=(Get-FileHash (Join-Path $attemptPath 'dependencies.json') -Algorithm SHA256).Hash.ToLowerInvariant();effective_scm_access='NOT_PROVEN'}
    $readyPath=Join-Path $attemptPath 'READY.json'
    [IO.File]::WriteAllText($readyPath,(ConvertTo-Json $ready),[Text.UTF8Encoding]::new($false))
    Set-Acl -LiteralPath $readyPath -AclObject (RuntimeAcl $false)
    RuntimeCheckAcl $readyPath
   }catch{
    $failure=Join-Path $attemptPath ('FAILED-'+[guid]::NewGuid().ToString('N')+'.json')
    [IO.File]::WriteAllText($failure,(ConvertTo-Json @{error=$_.Exception.Message;time=[DateTime]::UtcNow.ToString('o')}),[Text.UTF8Encoding]::new($false))
    if(Test-Path -LiteralPath (Join-Path $attemptPath 'acl-before.json')){
     $restored=RuntimeRestore $attemptPath (Join-Path $attemptPath 'acl-before.json')
     Write-Host ('RUNTIME_AUTOMATIC_ACL_RECOVERY='+$restored)
    }
    if(Test-Path -LiteralPath (Join-Path $attemptPath 'junction-before.json')){
     $restoredLinks=JunctionRestore $attemptPath (Join-Path $attemptPath 'junction-before.json')
     Write-Host ('RUNTIME_JUNCTION_RECOVERY='+$restoredLinks)
    }
    throw
   }
   $Mode='Verify'
  }
 }
 RuntimeNoReparse $attemptPath
 if($Mode -eq 'Recover'){
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  RuntimeMust ($admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'RUNTIME_ADMIN_REQUIRED'
  RuntimeMust (-not (Test-Path -LiteralPath (Join-Path $attemptPath 'READY.json')) -or @(Get-ChildItem -LiteralPath $attemptPath -Filter 'FAILED-*').Count -gt 0) 'RUNTIME_READY_RECOVERY_REJECTED'
  $lock=Join-Path $attemptPath '.prepare.lock'
  RuntimeNoReparse $lock
  $preparationLock=[IO.File]::Open($lock,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $journal=Join-Path $attemptPath 'acl-before.json'
  $linkJournal=Join-Path $attemptPath 'junction-before.json'
  RuntimeMust ((Test-Path -LiteralPath $journal) -or (Test-Path -LiteralPath $linkJournal)) 'RUNTIME_NO_RECOVERY_JOURNAL'
  $restored=$true
  if(Test-Path -LiteralPath $journal){RuntimeNoReparse $journal;$restored=RuntimeRestore $attemptPath $journal}
  if(Test-Path -LiteralPath $linkJournal){
   RuntimeNoReparse $linkJournal;Initialize-JunctionNative (Join-Path $attemptPath 'work\operator')
   $restoredLinks=JunctionRestore $attemptPath $linkJournal;$restored=$restored -and $restoredLinks
  }
  $record=Join-Path $attemptPath ('RECOVERY-'+[guid]::NewGuid().ToString('N')+'.json')
  [IO.File]::WriteAllText($record,(ConvertTo-Json @{acl_restored=$restored;time=[DateTime]::UtcNow.ToString('o')}),[Text.UTF8Encoding]::new($false))
  RuntimeMust $restored 'RUNTIME_RECOVERY_REQUIRES_REVIEW'
  Write-Host 'RUNTIME_RECOVERY=ACL_RESTORED_EVIDENCE_RETAINED'
  return
 }
 RuntimeMust (@(Get-ChildItem -LiteralPath $attemptPath -Filter 'FAILED-*').Count -eq 0) 'RUNTIME_FAILED_ATTEMPT_REJECTED'
 $readyPath=Join-Path $attemptPath 'READY.json';RuntimeNoReparse $readyPath
 $ready=Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
 RuntimeMust ($ready.operatorSid -match '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$') 'RUNTIME_OPERATOR_SID_REJECTED'
 RuntimeMust ($ready.PSObject.Properties.Name -contains 'junctionPolicy') 'JUNCTION_POLICY_UPGRADE_REQUIRED_NEW_ATTEMPT'
 RuntimeMust ($ready.schema -eq 2 -and $ready.junctionPolicy -ceq 'nofollow-v1') 'JUNCTION_POLICY_UPGRADE_REQUIRED_NEW_ATTEMPT'
 $runtimeOperatorSid=$ready.operatorSid
 RuntimeCheckAcl $readyPath
 RuntimeMust ((Get-FileHash (Join-Path $attemptPath 'dependencies.json') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ready.dependenciesSha256) 'RUNTIME_DEPENDENCY_GRAPH_HASH_CHANGED'
 $control=Join-Path $attemptPath 'control'
 foreach($spec in @(@('windows-scm-isolated-runtime.mjs',$ready.controlNodeSha256),@('windows-scm-isolated-runtime.ps1',$ready.controlPsSha256),@('service-probe-runner.ps1',$ready.probeRunnerSha256),@('service-physical-runner.ps1',$ready.physicalRunnerSha256),@('windows-scm-junction-acl.ps1',$ready.junctionHelperSha256))){
  $p=Join-Path $control $spec[0];RuntimeCheckAcl $p
  RuntimeMust ((Get-FileHash $p -Algorithm SHA256).Hash.ToLowerInvariant() -eq $spec[1]) 'RUNTIME_CONTROL_HASH_CHANGED'
 }
 # Bootstrap using PowerShell hashes, before invoking any Node from the artifact.
 $manifestPath=Join-Path $attemptPath 'manifest.json';RuntimeCheckAcl $manifestPath
 RuntimeMust ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ready.manifestSha256) 'RUNTIME_MANIFEST_BOOTSTRAP_HASH_FAILED'
 $manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $nodeRecords=@($manifest.files | Where-Object {$_.path -ceq '.scm-runtime/node.exe' -and $_.type -eq 'file'})
 RuntimeMust ($nodeRecords.Count -eq 1) 'RUNTIME_BOOTSTRAP_NODE_MISSING'
 RuntimeNoReparse $Node
 RuntimeMust ((Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant() -eq $nodeRecords[0].sha256) 'RUNTIME_BOOTSTRAP_NODE_HASH_CHANGED'
 $linkJournal=Join-Path $attemptPath 'junction-before.json';RuntimeCheckAcl $linkJournal
 RuntimeMust ((Get-FileHash $linkJournal -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $ready.junctionPlanSha256) 'JUNCTION_JOURNAL_HASH_CHANGED'
 $junctions=Get-Content -LiteralPath $linkJournal -Raw -Encoding UTF8 | ConvertFrom-Json
 $junctions=@($junctions)
 $links=@($manifest.files | Where-Object {$_.type -eq 'link'})
 RuntimeMust ($junctions.Count -eq $links.Count) 'JUNCTION_MANIFEST_COVERAGE_MISMATCH'
 $payload=Join-Path $attemptPath 'payload'
 foreach($link in $links){
  $expectedPath=[IO.Path]::GetFullPath((Join-Path $payload $link.path))
  $expectedTarget=[IO.Path]::GetFullPath((Join-Path $payload $link.target))
  $matches=@($junctions | Where-Object {$_.Path -ieq $expectedPath -and $_.Target -ieq $expectedTarget})
  RuntimeMust ($matches.Count -eq 1 -and $link.PSObject.Properties.Name -contains 'linkText' -and $link.linkText -ieq $link.target) 'JUNCTION_MANIFEST_COVERAGE_MISMATCH'
 }
 $compilerRole=if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq $runtimeServiceSid){'service'}else{'operator'}
 Initialize-JunctionNative (Join-Path $attemptPath ('work\'+$compilerRole))
 # Check self DACLs before Node's realpath is allowed to traverse any link.
 JunctionVerify $payload $junctions
 & $Node (Join-Path $control 'windows-scm-isolated-runtime.mjs') verify $attemptPath
 RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_HASH_VERIFICATION_FAILED'
 foreach($p in @(RuntimePayloadPaths $attemptPath)+@($attemptPath,$prefix,$control,(Join-Path $attemptPath 'manifest.json'),(Join-Path $attemptPath 'dependencies.json'))){RuntimeCheckAcl $p}
 RuntimeCheckAcl (Join-Path $attemptPath 'work')
 RuntimeCheckAcl (Join-Path $attemptPath 'work\operator')
 RuntimeCheckAcl (Join-Path $attemptPath 'work\service') $true
 # Only the interactive preflight consumes operator cache; SCM has its own cache.
 if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $runtimeServiceSid){RuntimeCheckOperatorWork (Join-Path $attemptPath 'work\operator')}
 if($RequireScmProbe){
  $manifestHash=(Get-FileHash (Join-Path $attemptPath 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  $valid=$false
  foreach($receipt in Get-ChildItem -LiteralPath (Join-Path $attemptPath 'work\service') -Filter 'scm-probe-*.json'){
   RuntimeNoReparse $receipt.FullName
   $owner=(Get-Acl -LiteralPath $receipt.FullName).GetOwner([Security.Principal.SecurityIdentifier]).Value
   if($owner -ne $runtimeServiceSid){continue}
   $p=Get-Content -LiteralPath $receipt.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
   if($p.status -eq 'DEPENDENCY_LOAD_ONLY' -and $p.probe -eq $true -and
      $p.serviceSid -eq $runtimeServiceSid -and $p.manifestSha256 -eq $manifestHash -and
      $receipt.LastWriteTimeUtc -gt (Get-Item -LiteralPath $readyPath).LastWriteTimeUtc){$valid=$true}
  }
  RuntimeMust $valid 'RUNTIME_REAL_SCM_PROBE_REQUIRED'
 }
 if($Mode -eq 'Probe'){
  & (Join-Path $attemptPath 'payload\.scm-runtime\node.exe') (Join-Path $control 'windows-scm-isolated-runtime.mjs') probe $attemptPath
  RuntimeMust ($LASTEXITCODE -eq 0) 'RUNTIME_REAL_SCM_PROBE_FAILED'
 }else{Write-Host 'ISOLATED_RUNTIME=READY_ACL_AND_HASH_VERIFIED_NOT_SCM_EXECUTED'}
}catch{Write-Host ('ISOLATED_RUNTIME_FAILED='+$_.Exception.Message);exit 2}
finally{if($null -ne $preparationLock){$preparationLock.Dispose()}}
