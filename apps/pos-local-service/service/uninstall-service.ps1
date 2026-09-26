#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Detiene y desinstala el servicio `PosLocalService`.

.DESCRIPTION
  No borra `data\` ni ningún archivo del equipo: desinstalar el servicio de
  Windows no es lo mismo que desinstalar el POS, y borrar la base de datos
  local como efecto colateral de "quitar el servicio" sería precisamente el
  tipo de sorpresa irreversible que este proyecto evita por regla.
#>
param(
  [string]$StagingPath = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$serviceExe = Join-Path $StagingPath "pos-local-service.exe"

$existing = Get-Service -Name "PosLocalService" -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "El servicio 'PosLocalService' no está instalado; nada que hacer."
  exit 0
}

if ($existing.Status -eq "Running") {
  Stop-Service -Name "PosLocalService" -Force
}

if (Test-Path $serviceExe) {
  & $serviceExe uninstall
  if ($LASTEXITCODE -ne 0) { throw "WinSW 'uninstall' terminó con código $LASTEXITCODE" }
} else {
  # El binario ya no está pero el servicio sigue registrado: se retira con
  # el propio SCM en vez de dejarlo huérfano.
  sc.exe delete PosLocalService | Out-Null
}

Write-Host "Servicio 'PosLocalService' desinstalado."
