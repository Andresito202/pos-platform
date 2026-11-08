param([switch]$SkipBuild,[switch]$ServiceOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Real Electron + real POS Local Service + durable SQLite. This is a
# DEVELOPMENT provisioning, NOT a centrally authorized BUSINESS installation.
# Both processes run under the same interactive Windows user for DPAPI custody.
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$serviceRoot = Join-Path $repo 'apps/pos-local-service'
$accounts = Join-Path $env:LOCALAPPDATA 'CamachoPOS/development/accounts.v1.json'
if (-not (Test-Path -LiteralPath $accounts -PathType Leaf)) {
  throw 'LOCAL_ACCOUNTS_NOT_INITIALIZED: run node tools/operators/local-development-accounts.mjs init'
}

$root = Join-Path $env:LOCALAPPDATA 'CamachoPOS/local-operator-runtime'
$database = Join-Path $root 'data'
$installationPath = Join-Path $root 'installation.json'
New-Item -ItemType Directory -Path $root, $database -Force | Out-Null
if (-not (Test-Path -LiteralPath $installationPath)) {
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
$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $serviceRoot 'node_modules/tsx/dist/cli.mjs'
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) { throw 'MISSING_TSX: run pnpm install --frozen-lockfile' }

$previous = @{}
Get-ChildItem Env: | Where-Object { $_.Name -like 'POS_*' -or $_.Name -eq 'NODE_ENV' } |
  ForEach-Object { $previous[$_.Name] = $_.Value; Remove-Item -Path "Env:$($_.Name)" }
$service = $null
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
  Write-Host 'LOGIN_LOCAL_REAL: servicio y Electron, sin Playwright'
  Write-Host 'AVISO: identidad local no equivale a sesión comercial BUSINESS ni habilita ventas sin autorización.'
  if ($ServiceOnly) { Write-Host 'POS_LOCAL_SERVICE_SMOKE_PASS'; return }
  Push-Location $repo
  try {
    & pnpm --filter @pos-platform/pos-desktop start:production
    if ($LASTEXITCODE -ne 0) { throw 'DESKTOP_START_FAILED' }
  } finally { Pop-Location }
} finally {
  if ($null -ne $service) {
    try {
      if (-not $service.HasExited) { Stop-Process -Id $service.Id -Force -ErrorAction SilentlyContinue }
    } finally { $service.Dispose() }
  }
  foreach ($name in $values.Keys) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name,[string]$previous[$name],'Process')
  }
}
