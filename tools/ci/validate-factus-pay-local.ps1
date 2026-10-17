[CmdletBinding()]
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
  throw "Ejecuta este script desde una carpeta dentro del repositorio Git."
}
Set-Location $repoRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $env:TEMP "camacho-pos-factus-pay-validation-$stamp.log"
$results = [System.Collections.Generic.List[object]]::new()

Start-Transcript -Path $logPath -Force | Out-Null
try {
  Write-Host "Camacho POS / Factus Pay — validación local sin GitHub Actions" -ForegroundColor Cyan
  Write-Host ("Repositorio: " + $repoRoot)
  Write-Host ("Commit: " + (git rev-parse HEAD))
  Write-Host ("Rama: " + (git branch --show-current))
  Write-Host ("Node: " + (node --version))
  Write-Host ("pnpm: " + (pnpm --version))
  Write-Host "No se aplicarán migraciones ni se contactará Factus Pay."

  if (-not $SkipInstall) {
    & pnpm install --frozen-lockfile
    $code = $LASTEXITCODE
    $results.Add([pscustomobject]@{ check = "pnpm install --frozen-lockfile"; exitCode = $code; result = $(if ($code -eq 0) { "PASS" } else { "FAIL" }) })
    if ($code -ne 0) {
      throw "La instalación reproducible falló; no se ejecutan pruebas con dependencias incompletas."
    }
  }

  $checks = @(
    @{ name = "contracts typecheck"; args = @("--filter", "@pos-platform/contracts", "typecheck") },
    @{ name = "database-postgres typecheck"; args = @("--filter", "@pos-platform/database-postgres", "typecheck") },
    @{ name = "central-authority typecheck"; args = @("--filter", "@pos-platform/central-authority", "typecheck") },
    @{ name = "target-migrations typecheck"; args = @("--filter", "@pos-platform/target-migrations", "typecheck") },
    @{ name = "Factus Pay verifier and HTTP tests"; args = @("--filter", "@pos-platform/central-authority", "exec", "vitest", "run", "tests/factus-pay-collection-event.test.ts", "tests/factus-pay-webhook-handler.test.ts") },
    @{ name = "Factus Pay migration contract tests"; args = @("--filter", "@pos-platform/target-migrations", "exec", "vitest", "run", "tests/postgres-009-factus-pay.test.ts") },
    @{ name = "database-postgres unit tests"; args = @("--filter", "@pos-platform/database-postgres", "test") }
  )

  foreach ($check in $checks) {
    Write-Host ""
    Write-Host ("=== " + $check.name + " ===") -ForegroundColor Yellow
    $arguments = $check.args
    & pnpm @arguments
    $code = $LASTEXITCODE
    $result = if ($code -eq 0) { "PASS" } else { "FAIL" }
    $results.Add([pscustomobject]@{ check = $check.name; exitCode = $code; result = $result })
    Write-Host ("Resultado: " + $result + " (exit " + $code + ")")
  }

  Write-Host ""
  Write-Host "=== Resultado consolidado ===" -ForegroundColor Cyan
  $results | Format-Table -AutoSize
  Write-Host ("Log: " + $logPath)
  if (($results | Where-Object { $_.exitCode -ne 0 }).Count -gt 0) {
    Write-Host "VALIDACIÓN NO APROBADA: revisa cada fallo; no actives el webhook." -ForegroundColor Red
    exit 1
  }
  Write-Host "Pruebas locales completadas. Esto NO valida una base de datos desplegada, HTTPS público ni correlación de pagos." -ForegroundColor Green
  exit 0
}
finally {
  Stop-Transcript | Out-Null
}
