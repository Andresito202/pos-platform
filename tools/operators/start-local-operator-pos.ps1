param(
  [switch]$SkipBuild,
  [switch]$ServiceOnly,
  [switch]$DesignReview
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Real Electron + real POS Local Service + durable SQLite.
# DEVELOPMENT / DESIGN-REVIEW provisioning — NOT a centrally authorized BUSINESS installation.
# Both processes inherit the SAME process environment so installation IDs, data directory
# and license provision path stay synchronized without a two-terminal hand-off.
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$serviceRoot = Join-Path $repo 'apps/pos-local-service'
$accounts = Join-Path $env:LOCALAPPDATA 'CamachoPOS/development/accounts.v1.json'
if (-not (Test-Path -LiteralPath $accounts -PathType Leaf)) {
  throw 'LOCAL_ACCOUNTS_NOT_INITIALIZED: run node tools/operators/local-development-accounts.mjs init'
}

if ($DesignReview) {
  $root = Join-Path $env:LOCALAPPDATA 'CamachoPOS/design-review-runtime'
} else {
  $root = Join-Path $env:LOCALAPPDATA 'CamachoPOS/local-operator-runtime'
}
$database = Join-Path $root 'data'
$installationPath = Join-Path $root 'installation.json'
New-Item -ItemType Directory -Path $root, $database -Force | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $serviceRoot 'node_modules/tsx/dist/cli.mjs'
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) { throw 'MISSING_TSX: run pnpm install --frozen-lockfile' }

$licenseProvisionFile = $null
$registerId = $null
if ($DesignReview) {
  $prepare = Join-Path $serviceRoot 'scripts/prepare-commercial-design-review.ts'
  if (-not (Test-Path -LiteralPath $prepare -PathType Leaf)) {
    throw 'DESIGN_REVIEW_PREPARE_SCRIPT_MISSING'
  }
  $prepareOutput = & $node $tsx $prepare --root $root
  if ($LASTEXITCODE -ne 0) { throw 'DESIGN_REVIEW_PREPARE_FAILED' }
  $summary = ($prepareOutput | Select-Object -Last 1) | ConvertFrom-Json
  if ($null -eq $summary.license_capacity_provision_file -or $null -eq $summary.register_id) {
    throw 'DESIGN_REVIEW_PREPARE_SUMMARY_INVALID'
  }
  $licenseProvisionFile = [string]$summary.license_capacity_provision_file
  $registerId = [string]$summary.register_id
  $installationPath = [string]$summary.installation_path
}

if (-not (Test-Path -LiteralPath $installationPath -PathType Leaf)) {
  $installation = @{
    installation_id = [guid]::NewGuid().ToString()
    device_id = [guid]::NewGuid().ToString()
    tenant_id = [guid]::NewGuid().ToString()
    company_id = [guid]::NewGuid().ToString()
    branch_id = [guid]::NewGuid().ToString()
  }
  $json = $installation | ConvertTo-Json -Compress
  $stream = [System.IO.File]::Open($installationPath, [System.IO.FileMode]::CreateNew)
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}
$installation = Get-Content -LiteralPath $installationPath -Raw | ConvertFrom-Json
foreach ($key in @('installation_id','device_id','tenant_id','company_id','branch_id')) {
  $parsedGuid = [guid]::Empty
  if ($null -eq $installation.$key -or -not [guid]::TryParse([string]$installation.$key, [ref]$parsedGuid)) {
    throw 'LOCAL_INSTALLATION_METADATA_INVALID'
  }
}
if ($DesignReview) {
  $parsedRegister = [guid]::Empty
  if ($null -eq $registerId -or -not [guid]::TryParse($registerId, [ref]$parsedRegister)) {
    throw 'DESIGN_REVIEW_REGISTER_ID_INVALID'
  }
  if ($null -eq $installation.register_id -or [string]$installation.register_id -ne $registerId) {
    throw 'DESIGN_REVIEW_REGISTER_ID_DESYNC'
  }
}

$previous = @{}
Get-ChildItem Env: | Where-Object { $_.Name -like 'POS_*' -or $_.Name -eq 'NODE_ENV' } |
  ForEach-Object { $previous[$_.Name] = $_.Value; Remove-Item -Path "Env:$($_.Name)" }
$service = $null
$values = $null
try {
  $values = @{
    NODE_ENV = 'development'
    POS_DATA_DIRECTORY = $database
    POS_INSTALLATION_ID = [string]$installation.installation_id
    POS_DEVICE_ID = [string]$installation.device_id
    POS_TENANT_ID = [string]$installation.tenant_id
    POS_COMPANY_ID = [string]$installation.company_id
    POS_BRANCH_ID = [string]$installation.branch_id
    POS_SERVICE_VERSION = '1.0.0'
    POS_PROTOCOL_MIN = '1.0.0'
    POS_PROTOCOL_MAX = '1.0.0'
    POS_LOCAL_OPERATOR_AUTH_STORE = $accounts
  }
  if ($DesignReview) {
    $values['POS_LICENSE_CAPACITY_PROVISION_FILE'] = $licenseProvisionFile
  }
  foreach ($pair in $values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'Process')
  }

  if (-not $SkipBuild) {
    Push-Location $repo
    try {
      & pnpm --filter @pos-platform/pos-desktop build
      if ($LASTEXITCODE -ne 0) { throw 'DESKTOP_BUILD_FAILED' }
    } finally { Pop-Location }
  }

  $out = Join-Path $root 'service.stdout.log'
  $err = Join-Path $root 'service.stderr.log'
  # Logs contain diagnostics only, never credentials.
  $service = Start-Process -FilePath $node -ArgumentList @("`"$tsx`"", 'src/main.ts') `
    -WorkingDirectory $serviceRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if ($service.HasExited) { break }
    if ((Test-Path -LiteralPath $out) -and
        (Select-String -LiteralPath $out -SimpleMatch '"event":"runtime.started"' -Quiet)) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Write-Host "El servicio local no arrancó. Diagnóstico: $out y $err"
    throw 'LOCAL_SERVICE_NOT_READY'
  }

  Write-Host 'POS_SERVICE_READY'
  Write-Host "SQLite persistente: $database"
  Write-Host 'LOGIN_LOCAL_REAL: servicio y Electron comparten el mismo entorno de proceso'
  if ($DesignReview) {
    Write-Host 'DESIGN_REVIEW_MODE: runtime aislado con provisión de capacidad firmada y catálogo demo'
    Write-Host "DESIGN_REVIEW_REGISTER_ID: $registerId"
    Write-Host "DESIGN_REVIEW_LICENSE_PROVISION: $licenseProvisionFile"
    Write-Host 'Usa admin.local / cajero.local del almacén de cuentas de desarrollo.'
    Write-Host 'Abre Caja y ventas, pega el REGISTER_ID, recorre carrito → cobro → denominaciones.'
  }
  Write-Host 'AVISO: identidad local no equivale a sesión comercial BUSINESS de Central.'
  if ($ServiceOnly) { Write-Host 'POS_LOCAL_SERVICE_SMOKE_PASS'; return }
  Push-Location $repo
  try {
    # Electron inherits the same Process environment set above — no second terminal.
    & pnpm --filter @pos-platform/pos-desktop start:production
    if ($LASTEXITCODE -ne 0) { throw 'DESKTOP_START_FAILED' }
  } finally { Pop-Location }
} finally {
  if ($null -ne $service) {
    try {
      if (-not $service.HasExited) { Stop-Process -Id $service.Id -Force -ErrorAction SilentlyContinue }
    } finally { $service.Dispose() }
  }
  if ($null -ne $values) {
    foreach ($name in $values.Keys) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  }
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name,[string]$previous[$name],'Process')
  }
}
