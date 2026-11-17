<#
.SYNOPSIS
  Static + synthetic validation for windows-nsis-lab-lifecycle.ps1 before push.
  Catches PS7 List[object] + @() "Argument types do not match" and AST errors.
#>
[CmdletBinding()]
param(
  [string]$LifecyclePath = (Join-Path $PSScriptRoot 'windows-nsis-lab-lifecycle.ps1')
)

$ErrorActionPreference = 'Stop'
$failed = 0

function Assert-True([bool]$Cond, [string]$Name, [string]$Detail = '') {
  if ($Cond) {
    Write-Host "VALIDATE_PASS=$Name $Detail"
  } else {
    Write-Host "VALIDATE_FAIL=$Name $Detail"
    $script:failed++
  }
}

if (-not (Test-Path -LiteralPath $LifecyclePath)) {
  throw "LIFECYCLE_MISSING:$LifecyclePath"
}

# --- AST parse ---
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($LifecyclePath, [ref]$tokens, [ref]$errors)
Assert-True ($null -ne $ast) 'ast_present'
Assert-True ($errors.Count -eq 0) 'ast_errors' ("count={0}; {1}" -f $errors.Count, (($errors | ForEach-Object { $_.ToString() }) -join ' | '))

# --- Ban direct @($genericList) anti-patterns in executable lines (ignore comments) ---
$codeLines = @(
  Get-Content -LiteralPath $LifecyclePath |
    Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*<#' -and $_ -notmatch '^\s*\.' }
)
$codeBlob = ($codeLines -join "`n")
Assert-True ($codeBlob -notmatch 'return\s+@\(\$hits\)') 'ban_return_at_hits'
Assert-True ($codeBlob -notmatch '@\(\$hits\)') 'ban_at_hits'
Assert-True ($codeBlob -notmatch '@\(\$steps\)(?!\s*\|)') 'ban_at_steps_no_pipeline'
Assert-True ($codeBlob -match 'ScriptStackTrace') 'script_stack_trace_logged'
Assert-True ($codeBlob -match 'Convert-ObjectListToArray') 'uses_toarray_helper'
Assert-True ($codeBlob -match 'ToArray\(\)') 'uses_toarray'

# --- Reproduce PS7 List[object] hazard (New-Object path used on failing GHA tip) ---
$list = New-Object 'System.Collections.Generic.List[object]'
[void]$list.Add([pscustomobject]@{ DisplayName = 'Camacho POS Colombia'; InstallLocation = '' })
$atFailed = $false
try {
  $null = @($list)
} catch {
  $atFailed = ([string]$_.Exception.Message -like '*Argument types do not match*')
}
Assert-True $atFailed 'repro_at_list_still_throws' 'New-Object List[object] + array subexpression'

# Function return of array-subexpression around List (exact CI failure shape)
function Invoke-BadHitsReturn {
  $hits = New-Object 'System.Collections.Generic.List[object]'
  [void]$hits.Add([pscustomobject]@{ DisplayName = 'Camacho POS Colombia' })
  return @($hits)
}
$badReturnFailed = $false
try { $null = Invoke-BadHitsReturn } catch {
  $badReturnFailed = ([string]$_.Exception.Message -like '*Argument types do not match*')
}
Assert-True $badReturnFailed 'repro_return_at_hits' 'return array-subexpression of List[object]'

$arr = [object[]]$list.ToArray()
Assert-True ($arr.Count -eq 1) 'toarray_count'
Assert-True ($arr[0].DisplayName -eq 'Camacho POS Colombia') 'toarray_payload'

$empty = [System.Collections.Generic.List[object]]::new()
$emptyArr = [object[]]$empty.ToArray()
Assert-True ($emptyArr.Count -eq 0) 'toarray_empty'

# --- Exercise helper logic equivalent to Find-UninstallEntries return ---
function Convert-ObjectListToArray-Local {
  param($List)
  if ($null -eq $List) { return ,[object[]]@() }
  if ($List -is [System.Collections.Generic.List[object]]) {
    if ($List.Count -eq 0) { return ,[object[]]@() }
    return ,[object[]]$List.ToArray()
  }
  $buf = [System.Collections.Generic.List[object]]::new()
  foreach ($item in $List) { [void]$buf.Add($item) }
  if ($buf.Count -eq 0) { return ,[object[]]@() }
  return ,[object[]]$buf.ToArray()
}

function Find-UninstallEntries-Local {
  $hits = [System.Collections.Generic.List[object]]::new()
  [void]$hits.Add([pscustomobject]@{ DisplayName = 'Camacho POS Colombia 0.0.0'; InstallLocation = ''; DisplayIcon = 'C:\Program Files\Camacho POS Colombia\Camacho POS Colombia.exe'; UninstallString = '"C:\Program Files\Camacho POS Colombia\Uninstall Camacho POS Colombia.exe"' })
  [void]$hits.Add([pscustomobject]@{ DisplayName = 'Camacho POS Colombia 0.0.0 (dup)'; InstallLocation = '' })
  return (Convert-ObjectListToArray-Local -List $hits)
}

try {
  $entries = @(Find-UninstallEntries-Local)
  Assert-True ($entries.Count -eq 2) 'find_entries_count'
  Assert-True ($entries[0].DisplayName -like 'Camacho POS*') 'find_entries_name'
} catch {
  Assert-True $false 'find_entries_invoke' $_.Exception.Message
}

# --- String list ToArray + scalar first path ---
$dirs = [System.Collections.Generic.List[string]]::new()
[void]$dirs.Add('C:\Program Files\Camacho POS Colombia')
[void]$dirs.Add('C:\Users\runneradmin\AppData\Local\Programs\Camacho POS Colombia')
$strArr = [string[]]$dirs.ToArray()
Assert-True ($strArr.Count -eq 2) 'string_list_toarray'
$unique = @($strArr | Select-Object -Unique)
Assert-True ($unique.Count -eq 2) 'string_list_unique'

# --- Save-Report style: List[object] → ToArray → filter (must not use @($list) bare) ---
$steps = [System.Collections.Generic.List[object]]::new()
[void]$steps.Add([ordered]@{ name = 'silent_install'; status = 'PASS' })
[void]$steps.Add([ordered]@{ name = 'verify_installed_paths'; status = 'FAIL' })
$stepArray = [object[]]$steps.ToArray()
$failedSteps = @($stepArray | Where-Object { $_.status -eq 'FAIL' })
Assert-True ($failedSteps.Count -eq 1) 'save_report_filter'
Assert-True ($failedSteps[0].name -eq 'verify_installed_paths') 'save_report_name'

# --- Unary comma return keeps Object[] intact (do not re-wrap with @()) ---
function Return-CommaArray {
  $h = [System.Collections.Generic.List[object]]::new()
  [void]$h.Add([pscustomobject]@{ N = 1 })
  [void]$h.Add([pscustomobject]@{ N = 2 })
  return ,[object[]]$h.ToArray()
}
$got = Return-CommaArray
Assert-True (($got -is [array]) -and ($got.Count -eq 2)) 'comma_return_count'

# --- install-camacho-local-service.ps1: ban parameter named $args ---
$helperPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'apps/pos-desktop/packaging/install-camacho-local-service.ps1'
if (-not (Test-Path -LiteralPath $helperPath)) {
  # Repo layout: tools/operators -> ../../apps/...
  $helperPath = Join-Path $PSScriptRoot '..\..\apps\pos-desktop\packaging\install-camacho-local-service.ps1'
}
$helperPath = [IO.Path]::GetFullPath($helperPath)
Assert-True (Test-Path -LiteralPath $helperPath) 'helper_present' $helperPath
$helperSrc = Get-Content -LiteralPath $helperPath -Raw
$helperTokens = $null
$helperErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$helperTokens, [ref]$helperErrors)
Assert-True ($helperErrors.Count -eq 0) 'helper_ast_errors' (($helperErrors | ForEach-Object { $_.ToString() }) -join ' | ')
Assert-True ($helperSrc -notmatch 'function\s+Invoke-WinSW\s*\(\s*\[string\[\]\]\s*\$args\s*\)') 'ban_invoke_winsw_args_param'
Assert-True ($helperSrc -match 'WinSwArguments') 'uses_winsw_arguments_param'
Assert-True ($helperSrc -match 'WorkingDirectory\s+\$PayloadDir') 'winsw_workdir_payload'
Assert-True ($helperSrc -match 'ValidateNotNullOrEmpty') 'helper_validates_winsw_args'
Assert-True ($helperSrc -match 'Grant-ServiceRuntimeAcls|Grant-VirtualServiceAcl') 'grants_virtual_service_acl'
Assert-True ($helperSrc -match 'CAMACHO_SERVICE_LOGDIR|logDirectory') 'winsw_log_under_programdata'
Assert-True ($helperSrc -match 'RedirectStandardError') 'captures_winsw_stderr'
Assert-True ($helperSrc -match 'sc\.exe queryex') 'scm_diagnostics_on_failure'

$stagePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\apps\pos-desktop\scripts\stage-nsis-service-payload.mjs'))
Assert-True (Test-Path -LiteralPath $stagePath) 'stage_script_present' $stagePath
$stageSrc = Get-Content -LiteralPath $stagePath -Raw
Assert-True ($stageSrc -match '<logpath>') 'stage_template_has_logpath'
Assert-True ($stageSrc -match '__CAMACHO_SERVICE_LOGDIR__') 'stage_logdir_placeholder'

if ($failed -gt 0) {
  Write-Host "VALIDATE_SUMMARY=FAIL count=$failed"
  exit 1
}
Write-Host 'VALIDATE_SUMMARY=PASS'
exit 0
