#requires -Version 5.1
<# Read-only code-signing capability inventory. No certificate enrollment, trust-store
edits, private-key access, signing, or Windows service changes. Certificate
subjects/thumbprints are intentionally not emitted to the terminal. #>
[CmdletBinding()]
param([switch]$Json)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
$report = [System.Collections.Generic.List[object]]::new()
foreach ($scope in @('Cert:\CurrentUser\My','Cert:\LocalMachine\My')) {
  try {
    $certificates = @(Get-ChildItem -LiteralPath $scope -ErrorAction Stop)
    $candidates = @($certificates | Where-Object {
      $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date) -and
      @($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
    })
    [void]$report.Add([pscustomobject]@{
      Store=$scope
      Accessible=$true
      PotentialValidCodeSigningCertificates=$candidates.Count
      ApprovedSignerConfigured=$false
      KeyUsabilityTested=$false
      TrustChainValidated=$false
    })
  } catch {
    [void]$report.Add([pscustomobject]@{
      Store=$scope
      Accessible=$false
      PotentialValidCodeSigningCertificates=0
      ApprovedSignerConfigured=$false
      KeyUsabilityTested=$false
      TrustChainValidated=$false
    })
  }
}
$result = [pscustomobject]@{
  Scope='READ_ONLY_CERTIFICATE_METADATA'
  Certificates=@($report.ToArray())
  CommercialWinSWSigningReady=$false
  Reason='Inventory is not signability, chain-of-trust, publisher approval, or authenticated SCM channel certification.'
}
if ($Json) { $result | ConvertTo-Json -Depth 4 } else { $result | Format-List; $result.Certificates | Format-Table -AutoSize }
