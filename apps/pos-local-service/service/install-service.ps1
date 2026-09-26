#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Instala `pos-local-service` como servicio de Windows, usando WinSW.

.DESCRIPTION
  Espera, en `-StagingPath` (por defecto, el directorio de este script):
    - `pos-local-service.mjs`        el artefacto de `build-artifact.mjs`
    - `node_modules/better-sqlite3/` su addon nativo, sin bundlear
    - `pos-local-service.xml`        este mismo directorio (`service/`)
    - `pos-local-service.exe`        el binario de WinSW, RENOMBRADO

  WinSW (https://github.com/winsw/winsw, MIT) **no lo trae este
  repositorio**: es un ejecutable de terceros, y este proyecto no vendoriza
  binarios sin revisión (la misma razón por la que el certificado de firma
  de código tampoco vive aquí). Se descarga en el paso de empaquetado, con
  `-WinSwUrl` apuntando a la versión exacta que se quiera fijar.

.PARAMETER StagingPath
  Directorio con el artefacto ya construido y el binario de WinSW ya
  colocado. Por defecto, el directorio de este script.

.PARAMETER WinSwUrl
  Si se da, descarga WinSW desde esta URL y lo coloca como
  `pos-local-service.exe` antes de instalar — pensado para CI, donde nada
  se coloca a mano de antemano.
#>
param(
  [string]$StagingPath = $PSScriptRoot,
  [string]$WinSwUrl
)

$ErrorActionPreference = "Stop"

$serviceExe = Join-Path $StagingPath "pos-local-service.exe"
$serviceXml = Join-Path $StagingPath "pos-local-service.xml"
$artifact = Join-Path $StagingPath "pos-local-service.mjs"

if ($WinSwUrl) {
  Write-Host "Descargando WinSW desde $WinSwUrl"
  Invoke-WebRequest -Uri $WinSwUrl -OutFile $serviceExe -UseBasicParsing
}

foreach ($required in @($serviceExe, $serviceXml, $artifact)) {
  if (-not (Test-Path $required)) {
    throw "Falta '$required'. Construye el artefacto (build-artifact.mjs) y coloca WinSW antes de instalar."
  }
}

$dataDirectory = Join-Path $StagingPath "data"
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$existing = Get-Service -Name "PosLocalService" -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "El servicio ya existe: deteniendo y reinstalando en vez de duplicar."
  if ($existing.Status -eq "Running") { Stop-Service -Name "PosLocalService" -Force }
  & $serviceExe uninstall
  Start-Sleep -Seconds 2
}

& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "WinSW 'install' terminó con código $LASTEXITCODE" }

Write-Host "Servicio 'PosLocalService' instalado. Arranca con: Start-Service PosLocalService"
