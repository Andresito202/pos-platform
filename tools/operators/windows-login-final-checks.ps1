#requires -Version 5.1
<#
Camacho POS P0 - focused final automated checks.
NO actions unless -Run is explicitly provided.
Never configures Windows services, modifies credentials or migrates PostgreSQL.
Run only once code changes are integrated and the owner authorizes final tests.
Tests may use TEMP fixtures; this is NOT human MFA / SCM certification.
#>
[CmdletBinding()]
param([switch]$Run, [switch]$IncludeIsolatedPostgres, [switch]$IsolatedLabOnly)
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
    @{ Name='Service SSA/SAS/RBAC trust and signed grants'; Args=@('--filter','@pos-platform/pos-local-service','exec','vitest','run','tests/authorization-trust-lifecycle.test.ts','tests/authorization-trust-deployment.test.ts','tests/authorization-snapshot.test.ts','tests/session-assertion-verifier.test.ts','tests/session-trust-key-resolver.test.ts','tests/channel-commercial-transport.test.ts','tests/commercial-ipc.test.ts','--no-file-parallelism') },
    @{ Name='Channel service ownership and desktop no-create'; Args=@('--filter','@pos-platform/local-channel','exec','vitest','run','tests/windows-production.test.ts','--no-file-parallelism') },
    @{ Name='Central login readiness, registration and trust'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/central-login-preflight.test.ts','tests/central-certification-preflight.test.ts','tests/central-deployment-configuration.test.ts','tests/commercial-native-client-catalog.test.ts','tests/isolated-authorization-trust.test.ts','tests/business-login-coordinator.test.ts','tests/native-authorization-constraints.test.ts','tests/native-authorization-callback.test.ts','tests/native-authorization-code-exchange.test.ts','tests/session-trust-key-issuer.test.ts','tests/central-session-assertion-issuer.test.ts','--no-file-parallelism') },
    @{ Name='Electron native login and account lifecycle'; Args=@('--filter','@pos-platform/pos-desktop','exec','vitest','run','tests/commercial-account.test.ts','tests/native-business-login.test.ts','tests/native-commercial-service-login.test.ts','tests/native-business-code-transport.test.ts','tests/native-business-assertion-delivery.test.ts','tests/renderer/session-recovery.test.tsx','--no-file-parallelism') }
)
if ($IsolatedLabOnly -and -not $IncludeIsolatedPostgres) { throw 'LOGIN_LOCAL_LAB_REQUIRES_ISOLATED_POSTGRES' }
if ($IsolatedLabOnly) {
    # Reuse the canonical HTTPS/Electron scenarios; never bootstrap productive
    # accounts, TLS trust, Windows services or a second authentication system.
    $steps=@(
        @{ Name='Actual Windows interactive token (no injected runner)'; Args=@('--filter','@pos-platform/pos-local-service','exec','vitest','run','tests/windows-commercial-host-identity.test.ts','-t','real Windows token:','--no-file-parallelism') }
    )
}
if ($IncludeIsolatedPostgres -and -not $Run) { throw 'LOGIN_POSTGRES_TESTS_REQUIRE_EXPLICIT_RUN' }
if (-not $Run) {
    Write-Output 'P0 LOGIN — PLAN DE PRUEBAS FINAL, SIN EJECUTAR'
    foreach ($step in $steps) { Write-Output (' - ' + $step.Name) }
    Write-Output 'Invocar -Run solo después del cierre de implementación y autorización de pruebas.'
    exit 0
}
# PostgreSQL integration is strictly opt-in, is confined to an isolated test
# instance on the operator's local port 55433, and creates/drops random test DBs.
if ($IncludeIsolatedPostgres) {
    $uriValue = [Environment]::GetEnvironmentVariable('POSTGRES_TEST_URL','Process')
    if ([string]::IsNullOrWhiteSpace($uriValue)) { throw 'LOGIN_POSTGRES_TEST_URL_REQUIRED' }
    $parsed = $null
    try { $parsed = [uri]$uriValue } catch { throw 'LOGIN_POSTGRES_TEST_URL_INVALID' }
    if ($parsed.Scheme -notin @('postgres','postgresql') -or
        $parsed.Host -notin @('localhost','127.0.0.1') -or
        $parsed.Port -ne 55433) {
        throw 'LOGIN_POSTGRES_TESTS_REQUIRE_LOOPBACK_55433'
    }
    if ($IsolatedLabOnly) {
        if ($parsed.AbsolutePath -ne '/postgres') { throw 'LOGIN_LAB_ADMIN_DATABASE_REQUIRED' }
        $inspection=& docker inspect target-migrations-postgres-1
        if($LASTEXITCODE -ne 0){throw 'LOGIN_LAB_CONTAINER_REQUIRED'}
        $container=@($inspection | ConvertFrom-Json)[0]
        if(-not $container.State.Running -or @($container.Mounts).Count -ne 0 -or
          -not $container.HostConfig.Tmpfs.PSObject.Properties['/var/lib/postgresql/data']) {
            throw 'LOGIN_LAB_REQUIRES_RUNNING_TMPFS_POSTGRES_WITHOUT_PERSISTENT_MOUNTS'
        }
        $ports=@($container.NetworkSettings.Ports.'5432/tcp')
        if($ports.Count -ne 1 -or $ports[0].HostIp -ne '127.0.0.1' -or $ports[0].HostPort -ne '55433') {
            throw 'LOGIN_LAB_CONTAINER_LOOPBACK_BINDING_REQUIRED'
        }
        $steps += @(
            @{ Name='Canonical deployment HTTPS, negatives, rollback and login abuse (LAB)'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/central-commercial-deployment-physical.test.ts','-t','^deployment','--no-file-parallelism'); Expected=3 },
            @{ Name='Real Electron, PostgreSQL, DPAPI, BUSINESS, SSA/SAS and dashboard (virtual MFA LAB)'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/business-access-preparation-physical.test.ts','-t','V2 SSA SAS integration:','--no-file-parallelism'); Expected=1 }
        )
    } else { $steps += @(
        @{ Name='BUSINESS real PostgreSQL MFA (isolated random DB)'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/business-initial-mfa-physical.test.ts','--no-file-parallelism') },
        @{ Name='BUSINESS durable session/CAS (isolated random DB)'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/business-session-authority-physical.test.ts','--no-file-parallelism') },
        @{ Name='Native PKCE one-time token consumption (isolated random DB)'; Args=@('--filter','@pos-platform/central-authority','exec','vitest','run','tests/native-authorization-full-composition-physical.test.ts','--no-file-parallelism') }
    ) }
}
Set-Location $root
$branch=& git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'LOGIN_TESTS_GIT_BRANCH_UNAVAILABLE' }
if ($branch -ne 'feat/p0-windows-login-install-readiness') {
    throw 'LOGIN_TESTS_REQUIRE_P0_PR99_BRANCH'
}
$verifiedHead = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or -not ($verifiedHead -match '^[a-f0-9]{40}$')) {
    throw 'LOGIN_TESTS_COMMIT_NOT_VERIFIED'
}
$dirty = @(& git status --porcelain=v1)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) {
    throw 'LOGIN_TESTS_REQUIRE_CLEAN_WORKTREE'
}
foreach ($relativePath in @(
    'apps\pos-local-service\src\security\windows-commercial-host-identity.ts',
    'apps\central-authority\src\central-login-preflight.ts'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath) -PathType Leaf)) {
        throw 'LOGIN_TESTS_REQUIRED_PR99_SOURCES_MISSING'
    }
}
Write-Output ('P0 LOGIN - SHA tested: ' + $verifiedHead)
$labReports=$null
if($IsolatedLabOnly){
    # Test artifacts only; unique output never overwrites existing evidence.
    $labReports=Join-Path $root ('artifacts\windows-p0\2026-10-29\local-lab-'+[guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $labReports)
    Write-Output 'LAB: temporary test identities and virtual WebAuthn only; no human/SCM certification.'
}
$stepIndex=0
foreach ($step in $steps) {
    Write-Output ('INICIO: ' + $step.Name)
    $pnpmArgs = [string[]]$step.Args
    if($IsolatedLabOnly){
        $stepIndex++
        $report=Join-Path $labReports ("step-$stepIndex.json")
        $pnpmArgs+=@('--reporter=json',"--outputFile=$report")
    }
    & pnpm @pnpmArgs
    if ($LASTEXITCODE -ne 0) {
        throw ('LOGIN_FINAL_STEP_FAILED: ' + $step.Name)
    }
    if($IsolatedLabOnly){
        $result=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
        $expected=if($step.ContainsKey('Expected')){[int]$step.Expected}else{1}
        if(-not $result.success -or $result.numFailedTests -ne 0 -or $result.numPassedTests -ne $expected){throw 'LOGIN_LAB_EXPECTED_TESTS_NOT_EXECUTED'}
        Write-Output ('EVIDENCE_SHA256: '+(Get-FileHash -LiteralPath $report -Algorithm SHA256).Hash)
    }
    Write-Output ('PASS: ' + $step.Name)
}
if($IsolatedLabOnly){Write-Output ('LAB_REPORTS: '+$labReports)}
Write-Output 'AUTO_CHECKS_PASSED. No certifica MFA fisico, identidad SCM ni provisionamiento HTTPS real.'
