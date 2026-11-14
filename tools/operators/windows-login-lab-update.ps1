#requires -Version 5.1
<# Preserve the reviewed VM enrollment edits and fast-forward the SAME branch.
No reset, stash, restore, force push, workflow dispatch or SCM operation.
Stops before staging if any local content differs from its published Git blob.
#>
[CmdletBinding()]
param(
 [string]$RepoRoot='C:\CamachoLab\pos-platform',
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHead,
 [Parameter(Mandatory=$true)][ValidatePattern('^C:\\CamachoPosScmLab\\[a-f0-9]{32}$')][string]$LabRoot,
 [switch]$Run,[switch]$ApplyBusinessContext
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not $Run){Write-Output 'LAB_UPDATE_NO_ACTION: explicit -Run required';exit 0}
if([IO.Path]::GetFullPath($RepoRoot) -cne 'C:\CamachoLab\pos-platform'){throw 'CANONICAL_VM_REPOSITORY_REQUIRED'}
$os=Get-CimInstance Win32_OperatingSystem
if($os.ProductType -eq 1 -or $os.BuildNumber -ne '20348'){throw 'ISOLATED_WINDOWS_SERVER_2022_REQUIRED'}
function Git([string[]]$Arguments){
 $previous=$ErrorActionPreference
 try{$ErrorActionPreference='Continue';$lines=@(& git.exe -C $RepoRoot @Arguments 2>&1);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$previous}
 if($code -ne 0){throw ('LAB_GIT_OPERATION_FAILED:'+ $Arguments[0])}
 return @($lines | ForEach-Object {$_.ToString()})
}
function GitValue([string[]]$Arguments){
 $lines=@(Git $Arguments)
 if($Arguments[0] -in @('rev-parse','hash-object')){
  $hashes=@($lines | Where-Object {$_ -match '^[a-f0-9]{40}$'})
  if($hashes.Count -ne 1){throw 'GIT_HASH_OUTPUT_AMBIGUOUS'}
  return [string]$hashes[0]
 }
 return [string]$lines[-1]
}
$branch='feat/p0-windows-login-install-readiness'
if((GitValue @('branch','--show-current')).Trim() -ne $branch){throw 'ACTIVE_BRANCH_REQUIRED'}
Git @('fetch','origin',$branch) | Out-Host
$remote=(GitValue @('rev-parse',('origin/'+$branch))).Trim()
if($remote -ne $ExpectedHead){throw 'REMOTE_CHANGED_REVIEW_REQUIRED'}
$old=(GitValue @('rev-parse','HEAD')).Trim()
Git @('merge-base','--is-ancestor',$old,$ExpectedHead) | Out-Null
$allowed=@('tools/operators/windows-login-lab-enrollment.mts','tools/operators/windows-login-lab-enrollment.test.mts',
 'tools/operators/windows-login-lab-business-context.mts','tools/operators/windows-login-lab-business-context.test.mts',
 'tools/operators/windows-login-lab-business-context.ps1','tools/operators/windows-login-lab-update.ps1')
$status=@(Git @('status','--porcelain=v1','--untracked-files=all'))
$paths=[Collections.Generic.List[string]]::new()
foreach($line in $status){
 if($line.Length -lt 4){throw 'UNEXPECTED_STATUS_FORMAT'}
 $relative=$line.Substring(3)
 if($relative -notin $allowed -or $line.Substring(0,2) -match '[DRCU]'){throw ('CONCURRENT_WORK_PRESERVED:'+ $relative)}
 # Build the revision explicitly; no path from status is evaluated as code.
 $published=(GitValue @('rev-parse',($ExpectedHead+':'+$relative))).Trim()
 $actual=(GitValue @('hash-object',('--path='+$relative),'--',$relative)).Trim()
 if($actual -ne $published){throw ('LOCAL_CONTENT_DIFFERS_PRESERVED:'+ $relative)}
 $paths.Add($relative)
}
$evidence=Join-Path $LabRoot ('central-lab\git-update-'+[guid]::NewGuid().ToString('N')+'.json')
[pscustomobject]@{oldHead=$old;expectedHead=$ExpectedHead;localStatus=$status;allPendingContentAlreadyPublished=$true;
 recordedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidence -Encoding UTF8
# Every staged file is proven byte-equivalent (Git normalization) to the
# incoming commit. No local edit is discarded or overwritten with other content.
if($paths.Count -gt 0){Git (@('add','--')+$paths.ToArray()) | Out-Host}
Git @('merge','--ff-only',$ExpectedHead) | Out-Host
if((GitValue @('rev-parse','HEAD')).Trim() -ne $ExpectedHead){throw 'HEAD_VERIFICATION_FAILED'}
if(@(Git @('status','--porcelain=v1','--untracked-files=all')).Count -ne 0){throw 'WORKTREE_NOT_CLEAN_PRESERVED_FOR_REVIEW'}
Write-Output ('LAB_GIT_SYNC=PASS '+$ExpectedHead)
if($ApplyBusinessContext){
 & (Join-Path $RepoRoot 'tools\operators\windows-login-lab-business-context.ps1') -LabRoot $LabRoot -LockTimeoutMs 5000 -Run -Apply
}
