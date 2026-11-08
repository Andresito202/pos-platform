param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Single command: isolated design-review Electron with real Local Service,
# persistent IDs, signed license-capacity provision, demo catalog and cash register.
# Not a BUSINESS Central certification path.
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'POWERSHELL_7_REQUIRED' }

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$accountsScript = Join-Path $PSScriptRoot 'local-development-accounts.mjs'
$accounts = Join-Path $env:LOCALAPPDATA 'CamachoPOS/development/accounts.v1.json'
if (-not (Test-Path -LiteralPath $accounts -PathType Leaf)) {
  Write-Host 'Inicializando cuentas locales de desarrollo (contraseñas se muestran una sola vez)...'
  Push-Location -LiteralPath $repo
  try {
    & node $accountsScript init
    if ($LASTEXITCODE -ne 0) { throw 'LOCAL_ACCOUNT_PROVISIONING_FAILED' }
  } finally { Pop-Location }
}

$launcher = Join-Path $PSScriptRoot 'start-local-operator-pos.ps1'
$args = @('-DesignReview')
if ($SkipBuild) { $args += '-SkipBuild' }
Write-Host 'Abriendo Camacho POS en modo revisión de diseño comercial (SQLite aislada).'
& pwsh -NoProfile -File $launcher @args
if ($LASTEXITCODE -ne 0) { throw 'COMMERCIAL_DESIGN_REVIEW_LAUNCH_FAILED' }
