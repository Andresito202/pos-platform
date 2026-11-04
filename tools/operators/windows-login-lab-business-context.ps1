#requires -Version 5.1
<# Runs only the new lab publication tests and real transaction verification.
No SCM, DPAPI changes, credential enrollment, HTTP login, Actions or DDL.
-Apply is effective only with -Run and only after successful rolled-back verification.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^C:\\CamachoPosScmLab\\[a-f0-9]{32}$')][string]$LabRoot,
 [Parameter(Mandatory=$true)][ValidateRange(1,30000)][int]$LockTimeoutMs,
 [switch]$Run,[switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if(-not $Run){Write-Output 'LAB_BUSINESS_CONTEXT_NO_ACTION: explicit -Run required';exit 0}
$os=Get-CimInstance Win32_OperatingSystem
if($os.ProductType -eq 1 -or $os.BuildNumber -ne '20348'){throw 'ISOLATED_WINDOWS_SERVER_2022_REQUIRED'}
if((git -C $repo branch --show-current).Trim() -ne 'feat/p0-windows-login-install-readiness'){throw 'ACTIVE_BRANCH_REQUIRED'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'LOCAL_LAB_ADMINISTRATOR_REQUIRED'}
$sha=(git -C $repo rev-parse HEAD).Trim()
$evidence=Join-Path $LabRoot ('central-lab\business-context-execution-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
$steps=[Collections.Generic.List[object]]::new()
Push-Location -LiteralPath $repo
try{
 function Step([string]$Name,[string[]]$Arguments){
  $log=Join-Path $evidence ($Name+'.log')
  # Native stderr may contain benign Node deprecation warnings in PS 5.1.
  # Capture it without treating it as success/failure; the exit code decides.
  $previousPreference=$ErrorActionPreference
  try{$ErrorActionPreference='Continue';$output=@(& pnpm @Arguments 2>&1);$code=$LASTEXITCODE}
  finally{$ErrorActionPreference=$previousPreference}
  $output | ForEach-Object {$_.ToString()} | Tee-Object -FilePath $log | Out-Host
  $steps.Add([pscustomobject]@{name=$Name;exit=$code;log=$log})
  if($code -ne 0){throw ('LAB_STEP_FAILED:'+ $Name)}
 }
 Step 'new-operator-tests' @('--filter','@pos-platform/central-authority','exec','tsx','--test','../../tools/operators/windows-login-lab-business-context.test.mts')
 $common=@('--filter','@pos-platform/central-authority','exec','tsx','../../tools/operators/windows-login-lab-business-context.mts')
 Step 'postgres-verify-rollback' ($common+@('--verify-transaction','--lab-root',$LabRoot,'--lock-timeout-ms',[string]$LockTimeoutMs))
 if($Apply){Step 'postgres-apply' ($common+@('--apply','--lab-root',$LabRoot,'--lock-timeout-ms',[string]$LockTimeoutMs))
  Step 'postgres-idempotent-retry' ($common+@('--apply','--lab-root',$LabRoot,'--lock-timeout-ms',[string]$LockTimeoutMs))}
 Write-Output ('LAB_BUSINESS_CONTEXT_EXECUTION='+$evidence)
 Write-Output 'BUSINESS_SESSION_ISSUED=FALSE'
}finally{
 [pscustomobject]@{schema='CAMACHO_LAB_BUSINESS_CONTEXT_EXECUTION_V1';sourceSha=$sha;
  operatorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;steps=$steps.ToArray();
  businessSessionIssued=$false;scmOperations=0;actionsDispatched=0;completedAt=[DateTime]::UtcNow.ToString('o')
 } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'execution.json') -Encoding UTF8
 Pop-Location
}
