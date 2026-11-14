#requires -Version 5.1
<# Verify paired Vitest JSON reports from a REAL Windows SCM service and Desktop.
Read-only. Does not install services, change trust, certify the UI, or accept skips.
Operator MUST independently attest identity/SCM ancestry; JSON alone cannot prove it.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$ServiceReport,
 [Parameter(Mandatory=$true)][string]$DesktopReport,
 [string]$ElectronReport,
 [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Read-PhysicalResult([string]$path,[string]$role){
 if (-not [IO.Path]::IsPathRooted($path) -or -not [IO.File]::Exists($path)) {
  throw "SCM_EVIDENCE_FILE_MISSING_OR_NOT_ABSOLUTE:$role"
 }
 $raw=[IO.File]::ReadAllText($path)
 $data=ConvertFrom-Json -InputObject $raw -ErrorAction Stop
 if ($data.success -ne $true -or $data.numFailedTests -ne 0 -or
     $data.numPassedTests -ne 1 -or $data.numPendingTests -ne 0) {
  throw "SCM_PHYSICAL_TEST_NOT_PASSED:$role"
 }
 if ($data.PSObject.Properties.Name -contains 'numTodoTests' -and $data.numTodoTests -ne 0) {
  throw "SCM_PHYSICAL_TODO_TESTS:$role"
 }
 $tests=@($data.testResults)
 if ($tests.Count -ne 1 -or -not ($tests[0].name -match 'windows-scm-physical\.test\.ts$')) {
  throw "SCM_PHYSICAL_WRONG_SUITE:$role"
 }
 $assertions=@($tests[0].assertionResults)
 if($assertions.Count -ne 1 -or $assertions[0].status -ne 'passed') {
  throw "SCM_PHYSICAL_SKIPPED_OR_WRONG_ASSERTION:$role"
 }
 return [pscustomobject]@{
  Role=$role
  PhysicalSuitePassed=$true
  ReportSHA256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
 }
}
$results=[System.Collections.Generic.List[object]]::new()
[void]$results.Add((Read-PhysicalResult $ServiceReport 'SERVICE'))
[void]$results.Add((Read-PhysicalResult $DesktopReport 'DESKTOP'))
if (-not [string]::IsNullOrWhiteSpace($ElectronReport)) {
 [void]$results.Add((Read-PhysicalResult $ElectronReport 'ELECTRON_AS_NODE'))
}
$report=[pscustomobject]@{
 Scope='REPORT_STRUCTURAL_VERIFICATION_ONLY'
 Reports=@($results.ToArray())
 ReportStructurePassed=$true
 WindowsSCMIdentityIndependentlyAttested=$false
 CrossIdentityTransportCertified=$false
 CommercialWinSWApproved=$false
 HumanLoginCertified=$false
 Next='Verify real SCM ancestry, Windows tokens, SID, DPAPI, native peer, ACL, trusted signatures and negative tests outside the Vitest JSON before certification.'
}
if($Json){$report|ConvertTo-Json -Depth 5}else{$report|Format-List;$report.Reports|Format-Table -AutoSize}
