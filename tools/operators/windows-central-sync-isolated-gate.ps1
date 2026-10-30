#requires -Version 5.1
<#
  End-to-end Central HTTP -> PostgreSQL gate in an EPHEMERAL, NEW container.
  Explicit -Run only. It does not run against the existing preprod container.
  This is Central persistence/replay, NOT SQLite-outbox-to-Central E2E.
  No Windows services are installed, stopped or modified.
#>
[CmdletBinding()]
param([switch]$Run)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$container = 'camacho-pos-sync-isolated-lab'
$dbPort = 55436
$apiPort = 18787
$server = $null
$created = $false
$prior = @{}
$variables = @('POSTGRES_TEST_URL','POSTGRES_ADMIN_URL','DATABASE_URL','CENTRAL_SYNC_BASE_URL','CENTRAL_SYNC_BIND_HOST','CAMACHO_ISOLATED_SYNC_LAB','PORT')

function Assert-FreePort([int]$port) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
  try { $listener.Start() } catch { throw "LAB_PORT_IN_USE:$port" } finally { $listener.Stop() }
}
function Set-LabEnvironment([string]$name,[string]$value) {
  [Environment]::SetEnvironmentVariable($name,$value,'Process')
}
if ($env:OS -ne 'Windows_NT') { throw 'LAB_REQUIRES_WINDOWS' }
if (-not $Run) { Write-Host 'DRY: Pass -Run to create a disposable PostgreSQL container and test Central persistence/replays.'; exit 0 }
Set-Location $root
$branch = (& git branch --show-current).Trim()
if ($branch -ne 'feat/p0-windows-login-install-readiness') { throw 'LAB_WRONG_BRANCH' }
if ((& git status --porcelain).Count -gt 0) { throw 'LAB_REQUIRES_CLEAN_WORKTREE' }
$existing = @(& docker ps -a --filter "name=^/$container$" --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'DOCKER_NOT_AVAILABLE' }
if ($existing.Count -gt 0) { throw 'LAB_CONTAINER_ALREADY_EXISTS_ABORT' }
Assert-FreePort $dbPort
Assert-FreePort $apiPort
$freeMB = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024
if ($freeMB -lt 512) { throw 'LAB_INSUFFICIENT_FREE_RAM_512MB' }

$logDir = Join-Path $env:TEMP ('camacho-sync-gate-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
[IO.Directory]::CreateDirectory($logDir) | Out-Null
foreach ($name in $variables) { $prior[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
  Write-Host 'Starting isolated temporary PostgreSQL on 127.0.0.1:55436; this container has NO persistent volume.'
  # Trust is restricted to a loopback-only disposable container; never for customer data.
  & docker run --detach --rm --name $container --publish '127.0.0.1:55436:5432' --env 'POSTGRES_HOST_AUTH_METHOD=trust' --env 'POSTGRES_DB=postgres' --env 'POSTGRES_USER=postgres' 'postgres:16.14' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_POSTGRES_START_FAILED' }
  $created = $true
  $ready = $false
  for ($i=0; $i -lt 40; $i++) {
    & docker exec $container pg_isready -U postgres -d postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true;break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'ISOLATED_POSTGRES_NOT_READY' }

  Set-LabEnvironment 'POSTGRES_TEST_URL' 'postgres://postgres@127.0.0.1:55436/postgres'
  Set-LabEnvironment 'POSTGRES_ADMIN_URL' 'postgres://postgres@127.0.0.1:55436/postgres'
  Set-LabEnvironment 'DATABASE_URL' 'postgres://pos_app@127.0.0.1:55436/postgres'
  Set-LabEnvironment 'CENTRAL_SYNC_BASE_URL' 'http://127.0.0.1:18787'
  Set-LabEnvironment 'CENTRAL_SYNC_BIND_HOST' '127.0.0.1'
  Set-LabEnvironment 'PORT' '18787'
  Set-LabEnvironment 'CAMACHO_ISOLATED_SYNC_LAB' 'YES'

  & pnpm --filter '@pos-platform/target-migrations' exec tsx 'src/central-sync-lab-migrate.ts'
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_POSTGRES_MIGRATION_FAILED' }

  $pkg = Join-Path $root 'tools\target-migrations'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $logDir 'central-stdout.log'
  $stderr = Join-Path $logDir 'central-stderr.log'
  $server = Start-Process -FilePath $node -ArgumentList @('--import','tsx','src/central-sync-server.ts') -WorkingDirectory $pkg -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  $responding = $false
  for ($i=0; $i -lt 35; $i++) {
    if ($server.HasExited) { throw 'ISOLATED_CENTRAL_EXITED_EARLY' }
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:18787/health' -TimeoutSec 2
      if ($health.status -eq 'ok') { $responding=$true;break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $responding) { throw 'ISOLATED_CENTRAL_HEALTH_FAILED' }

  & pnpm --filter '@pos-platform/target-migrations' central-sync:gate
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_CENTRAL_SYNC_GATE_FAILED' }
  Write-Host 'PASS: Real Central HTTP/PostgreSQL persistence, proof replay and idempotency gate.'
  Write-Host 'NOT_PROVEN: local SQLite dispatch, production device enrollment, multi-business 1000-user capacity.'
} finally {
  if ($null -ne $server) {
    try { if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction Stop } } catch { Write-Warning 'LAB_SERVER_STOP_FAILED_INSPECT_PROCESS' }
  }
  if ($created) { & docker rm --force $container | Out-Null }
  foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name,$prior[$name],'Process') }
  Write-Host ('LAB_LOG_DIRECTORY=' + $logDir)
  Write-Host 'Only the uniquely named temporary PostgreSQL container and newly started API process were targeted for cleanup.'
}
