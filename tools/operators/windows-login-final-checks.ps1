#requires -Version 5.1
<#
Camacho POS P0 - focused final automated checks.
NO actions unless -Run is explicitly provided.
Never configures Windows services, modifies credentials or migrates PostgreSQL.
Run only once code changes are integrated and the owner authorizes final tests.
Tests may use TEMP fixtures; this is NOT human MFA / SCM certification.
#>
[CmdletBinding()]
param([switch]$Run)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_LOGIN_FINAL_CHECKS_REQUIRE_WINDOWS' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$steps=@(
    @{ Name='Local channel TypeScript'; Args=@('--filter','@pos-platform/local-channel','run','typecheck') },
    @{ Name='Local Service TypeScript'; Args=@('--filter','@pos-platform/pos-local-service','run','typecheck') },
    @{ Name='Desktop TypeScript/build'; Args=@('--filter','@pos-platform/pos-desktop','build') },
    @{ Name='Central Authority TypeScript'; Args=@('--filter','@pos-platform/central-authority','run','typecheck') },
    @{ Name='Service DPAPI, pipe, descriptor and commercial configuration'; Args=@('--filter','@pos-platform/pos-local-service','exec','vitest','run','tests/service-descriptor.test.ts','tests/channel.test.ts','tests/windows-dpapi.test.ts','tests/windows-commercial-runtime.test.ts','tests/windows-commercial-host-identity.test.ts','--no-file-parallelism') },
    @{ Name='Channel service ownership and desktop no-create'; Args=@('--filter','@pos-platform/local-channel','exec','vitest','run','tests/windows-production.test.ts','--no-file-parallelism') },
    @{ Name='Central login readiness, registration and trust'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/central-login-preflight.test.ts','tests/central-certification-preflight.test.ts','tests/central-deployment-configuration.test.ts','tests/commercial-native-client-catalog.test.ts','tests/isolated-authorization-trust.test.ts','--no-file-parallelism') },
    @{ Name='Electron native login and account lifecycle'; Args=@('--filter','@pos-platform/pos-desktop','exec','vitest','run','tests/commercial-account.test.ts','tests/native-business-login.test.ts','tests/native-commercial-service-login.test.ts','tests/native-business-code-transport.test.ts','--no-file-parallelism') }
)
if (-not $Run) {
    Write-Output 'P0 LOGIN — PLAN DE PRUEBAS FINAL, SIN EJECUTAR'
    foreach ($step in $steps) { Write-Output (' - ' + $step.Name) }
    Write-Output 'Invocar -Run solo después del cierre de implementación y autorización de pruebas.'
    exit 0
}
Set-Location $root
$branch=& git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'LOGIN_TESTS_GIT_BRANCH_UNAVAILABLE' }
$dirty=@(& git status --porcelain=v1)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'LOGIN_TESTS_REQUIRE_CLEAN_WORKTREE' }
Write-Output ('P0 LOGIN — PRUEBAS AUTOMATIZADAS EN: ' + $branch)
foreach ($step in $steps) {
    Write-Output ('INICIO: ' + $step.Name)
    $pnpmArgs = [string[]]$step.Args
    & pnpm @pnpmArgs
    if ($LASTEXITCODE -ne 0) { throw ('LOGIN_FINAL_STEP_FAILED: ' + $step.Name) }
    Write-Output ('PASS: ' + $step.Name)
}
Write-Output 'AUTO_CHECKS_PASSED. No certifica MFA fisico, identidad SCM ni provisionamiento HTTPS real.'
