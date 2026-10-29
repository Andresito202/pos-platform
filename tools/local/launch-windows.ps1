#requires -Version 5.1
<#
  Camacho POS Colombia — REAL local Windows launch, no preview stubs.
  Requires already-provisioned device / tenant IDs and DPAPI context. Does not
  fabricate a user, sign an SSA, bypass authorization or enable disabled actions.
  -CheckOnly: read-only prerequisite inventory; does not start services.
  Default: build Electron, launch actual Local Service (SQLite + named pipe),
  wait for runtime.started and open the actual production desktop.
#>
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$SkipBuild,
    [switch]$RequireCommercialLogin
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$service = $null
$stdoutPath = $null
$stderrPath = $null

function Stop-OwnedService {
    if ($null -ne $script:service -and -not $script:service.HasExited) {
        # Cleanup only the process tree this launcher created. Do not kill
        # unrelated Electron, Docker, PostgreSQL or other POS instances.
        try {
            & taskkill.exe /PID $script:service.Id /T /F 2>$null | Out-Null
        } catch {
            Write-Warning "No se pudo cerrar el proceso local que inicio este script (PID $($script:service.Id)). Comprueba su estado sin detener otros servicios."
        }
    }
}
try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'LOCAL_LAUNCH_REQUIRES_WINDOWS'
    }

    $required = @(
        'POS_DATA_DIRECTORY', 'POS_INSTALLATION_ID', 'POS_DEVICE_ID',
        'POS_SERVICE_VERSION', 'POS_PROTOCOL_MIN', 'POS_PROTOCOL_MAX',
        'POS_TENANT_ID', 'POS_COMPANY_ID', 'POS_BRANCH_ID'
    )
    $missing = @(
        foreach ($name in $required) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ([string]::IsNullOrWhiteSpace($value)) { $name }
        }
    )
    Write-Host '=== Camacho POS: diagnóstico de arranque REAL ==='
    Write-Host "Repositorio: $root"
    Write-Host 'Modo: POS Local Service + canal autenticado Windows + Electron producción'
    Write-Host 'NO es visual-preview; NO fabrica sesiones ni permisos.'
    if ($missing.Count -gt 0) {
        Write-Host "BLOQUEADO: faltan variables de aprovisionamiento: $($missing -join ', ')" -ForegroundColor Yellow
        Write-Host 'No se generan IDs aleatorios para suplantar una instalación o empresa.'
        exit 2
    }
    foreach ($name in @('POS_INSTALLATION_ID','POS_DEVICE_ID','POS_TENANT_ID','POS_COMPANY_ID','POS_BRANCH_ID')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        $parsed = [guid]::Empty
        if (-not [guid]::TryParse($value, [ref]$parsed) -or $parsed -eq [guid]::Empty) {
            throw "LOCAL_LAUNCH_INVALID_UUID: $name"
        }
    }
    $dataDir = [Environment]::GetEnvironmentVariable('POS_DATA_DIRECTORY')
    if (-not [System.IO.Path]::IsPathRooted($dataDir) -or -not (Test-Path -LiteralPath $dataDir -PathType Container)) {
        throw 'LOCAL_LAUNCH_DATA_DIRECTORY_MUST_EXIST_AND_BE_ABSOLUTE'
    }
    if ($env:POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM -and $env:POS_SESSION_TRUST_ENVIRONMENT) {
        Write-Host 'Confianza SSA: ancla raíz y ambiente declarados. Firma/activación reales por verificar.'
    } else {
        Write-Host 'BLOQUEO SESIÓN: no consta ancla de confianza SSA configurada.' -ForegroundColor Yellow
    }
    if (-not $env:POS_CENTRAL_BASE_URL) {
        Write-Host 'Sin POS_CENTRAL_BASE_URL: sync central no se habilita; el POS local puede arrancar.'
    }
    # The canonical Central V2 login/SSA endpoints exist, but remain disabled
    # without authorized HTTPS, Identity, D3 and installed Windows provision.
    $loginKeys = @('POS_CENTRAL_BASE_URL','POS_WINDOWS_COMMERCIAL_PROVISION_FILE','POS_WINDOWS_DESKTOP_COMMERCIAL_FILE','POS_AUTHORIZATION_TRUST_PROVISION_FILE')
    $loginMissing = @($loginKeys | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
    if ($loginMissing.Count -gt 0) {
        Write-Host "LOGIN COMERCIAL: falta provision Windows-Central: $($loginMissing -join ', ')" -ForegroundColor Yellow
    } else {
        Write-Host 'LOGIN COMERCIAL: rutas de provision declaradas; no certifica archivos, MFA, SSA/SAS ni acceso real.' -ForegroundColor Yellow
    }
    if ($RequireCommercialLogin -or -not [string]::IsNullOrWhiteSpace($env:POS_WINDOWS_COMMERCIAL_PROVISION_FILE) -or -not [string]::IsNullOrWhiteSpace($env:POS_WINDOWS_DESKTOP_COMMERCIAL_FILE)) {
        $loginRequired = @(
            'POS_CENTRAL_BASE_URL',
            'POS_WINDOWS_COMMERCIAL_PROVISION_FILE',
            'POS_WINDOWS_DESKTOP_COMMERCIAL_FILE',
            'POS_AUTHORIZATION_TRUST_PROVISION_FILE',
            'POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM',
            'POS_SESSION_TRUST_ENVIRONMENT'
        )
        $notProvisioned = @($loginRequired | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
        if ($notProvisioned.Count -gt 0) {
            throw "WINDOWS_COMMERCIAL_LOGIN_PROVISION_INCOMPLETE: $($notProvisioned -join ', ')"
        }
        foreach ($name in @('POS_WINDOWS_COMMERCIAL_PROVISION_FILE', 'POS_WINDOWS_DESKTOP_COMMERCIAL_FILE', 'POS_AUTHORIZATION_TRUST_PROVISION_FILE')) {
            $path = [Environment]::GetEnvironmentVariable($name)
            if (-not [IO.Path]::IsPathRooted($path) -or -not [IO.File]::Exists($path)) {
                throw "WINDOWS_COMMERCIAL_LOGIN_MANAGED_FILE_MISSING: $name"
            }
            if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "WINDOWS_COMMERCIAL_LOGIN_MANAGED_FILE_SYMLINK: $name"
            }
        }
        if ([string]::IsNullOrWhiteSpace($env:POS_SESSION_TRUST_ARTIFACT_PATH) -and [string]::IsNullOrWhiteSpace($env:POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE)) {
            throw 'WINDOWS_COMMERCIAL_LOGIN_SSA_DISTRIBUTION_REQUIRED'
        }
        foreach ($name in @('POS_SESSION_TRUST_ARTIFACT_PATH', 'POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE')) {
            $path = [Environment]::GetEnvironmentVariable($name)
            if (-not [string]::IsNullOrWhiteSpace($path)) {
                if (-not [IO.Path]::IsPathRooted($path) -or -not [IO.File]::Exists($path)) {
                    throw "WINDOWS_COMMERCIAL_LOGIN_MANAGED_FILE_MISSING: $name"
                }
                if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw "WINDOWS_COMMERCIAL_LOGIN_MANAGED_FILE_SYMLINK: $name"
                }
            }
        }
        Write-Host 'LOGIN COMERCIAL: archivos presentes. No certifica credenciales, roots SSA/SAS, D3, MFA o roles.'
    }
    $pnpm = Get-Command pnpm -ErrorAction Stop
    if (-not (Test-Path (Join-Path $root 'apps\pos-desktop\package.json'))) {
        throw 'LOCAL_LAUNCH_REPOSITORY_LAYOUT_INVALID'
    }
    if ($CheckOnly) {
        Write-Host 'PREFLIGHT_TERMINADO: no se iniciaron procesos ni se tocaron datos.'
        exit 0
    }

    Set-Location $root
    if (-not $SkipBuild) {
        Write-Host 'Compilando desktop de producción...'
        & $pnpm.Source --filter '@pos-platform/pos-desktop' build
        if ($LASTEXITCODE -ne 0) { throw "LOCAL_LAUNCH_DESKTOP_BUILD_FAILED: $LASTEXITCODE" }
    }
    $logRoot = Join-Path $env:TEMP 'camacho-pos-real-launch'
    [void](New-Item -ItemType Directory -Force -Path $logRoot)
    $run = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $logRoot "service-$run.stdout.log"
    $stderrPath = Join-Path $logRoot "service-$run.stderr.log"
    Write-Host 'Iniciando POS Local Service REAL. No se modifica configuración ni se crean usuarios.'
    $service = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c','pnpm --filter @pos-platform/pos-local-service start') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $service.Refresh()
        if ($service.HasExited) { break }
        if (Test-Path -LiteralPath $stdoutPath) {
            $lines = @(Get-Content -LiteralPath $stdoutPath -Tail 45 -ErrorAction SilentlyContinue)
            foreach ($line in $lines) {
                if ($line -match '"event"\s*:\s*"runtime\.started"') {
                    $ready = $true
                    break
                }
                if ($line -match '"event"\s*:\s*"runtime\.start_failed"') { break }
            }
        }
        if ($ready) { break }
    }
    if (-not $ready) {
        Write-Host 'LOCAL_SERVICE_NOT_READY: revise únicamente los logs de esta ejecución.' -ForegroundColor Red
        Write-Host "Salida: $stdoutPath"
        Write-Host "Errores: $stderrPath"
        throw 'LOCAL_LAUNCH_SERVICE_BOOT_FAILED'
    }

    Write-Host 'POS Local Service iniciado; canal Windows y SQLite activos según runtime.started.'
    Write-Host 'Iniciando Electron por la entrada de PRODUCCIÓN (no visual-preview).'
    $previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE')
    try {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        & $pnpm.Source --filter '@pos-platform/pos-desktop' start:production
    } finally {
        if ($null -ne $previousElectronMode) { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
    }
    if ($LASTEXITCODE -ne 0) {
        throw "LOCAL_LAUNCH_ELECTRON_EXIT: $LASTEXITCODE"
    }
}
finally {
    Stop-OwnedService
    if ($stdoutPath) {
        Write-Host 'Logs de arranque guardados (sin volcar secretos en pantalla):'
        Write-Host $stdoutPath
        Write-Host $stderrPath
    }
}
