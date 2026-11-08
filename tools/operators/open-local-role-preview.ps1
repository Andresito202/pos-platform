param(
  [ValidateSet('admin.local','supervisor.local','cajero.local','superadmin.local')]
  [string]$Username = 'cajero.local',
  [switch]$Initialize
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'POWERSHELL_7_REQUIRED' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$accounts = Join-Path $PSScriptRoot 'local-development-accounts.mjs'
if (-not (Test-Path -LiteralPath (Join-Path $repo 'apps/pos-desktop/dist/start.bundle.mjs'))) {
  throw 'POS_DESKTOP_NOT_BUILT_RUN_PNPM_BUILD'
}
if ($Initialize) {
  & node $accounts init
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_ACCOUNT_PROVISIONING_FAILED' }
}
$password = Read-Host "Contrasena local para $Username" -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $password).Password
$node = (Get-Command node -ErrorAction Stop).Source
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $node
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.ArgumentList.Add($accounts)
$start.ArgumentList.Add('verify')
$start.ArgumentList.Add($Username)
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
try {
  if (-not $process.Start()) { throw 'LOCAL_ACCOUNT_VERIFIER_START_FAILED' }
  $process.StandardInput.WriteLine($plain)
  $process.StandardInput.Close()
  $plain = $null
  $password.Dispose()
  $result = $process.StandardOutput.ReadToEnd().Trim()
  $errorText = $process.StandardError.ReadToEnd().Trim()
  $process.WaitForExit(10000) | Out-Null
  if (-not $process.HasExited) { $process.Kill(); throw 'LOCAL_ACCOUNT_VERIFIER_TIMEOUT' }
  if ($process.ExitCode -ne 0 -or -not $result.StartsWith('DEV_PASSWORD_VERIFIED:')) {
    throw 'LOCAL_DEVELOPMENT_PASSWORD_REJECTED'
  }
  $role=$result.Substring('DEV_PASSWORD_VERIFIED:'.Length)
} finally {
  $plain=$null
  $process.Dispose()
}
if ($role -notin @('CAJERO','SUPERVISOR','ADMINISTRADOR','SUPERADMINISTRADOR')) {
  throw 'LOCAL_ROLE_VERIFIER_INVALID_RESULT'
}
$env:POS_E2E_ROLE = $role
$env:POS_E2E_INTERACTIVE = '1'
$env:POS_E2E_PERSISTENT_DEV = '1'
try {
  Write-Host "Abriendo vista de desarrollo: $role. SQLite de DESARROLLO persistente, separado por rol."
  Write-Host "No es una identidad BUSINESS ni una base comercial de produccion."
  Push-Location -LiteralPath $repo
  try {
    & pnpm --filter @pos-platform/pos-desktop exec playwright test --config e2e/playwright.config.ts e2e/role-isolation.spec.ts --workers=1 --retries=0
    if ($LASTEXITCODE -ne 0) { throw "LOCAL_DEVELOPMENT_ROLE_PREVIEW_FAILED:$role" }
  } finally { Pop-Location }
} finally {
  Remove-Item Env:POS_E2E_ROLE,Env:POS_E2E_INTERACTIVE,Env:POS_E2E_PERSISTENT_DEV -ErrorAction SilentlyContinue
}
