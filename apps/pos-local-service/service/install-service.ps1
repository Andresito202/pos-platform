#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Instala `pos-local-service` como servicio de Windows, usando WinSW.

.DESCRIPTION
  Dos modos, y sólo dos:

  1. Por defecto (el que usa CI): instala lo que ya está en `-StagingPath`,
     sin tocarlo. Espera ahí:
       - `pos-local-service.mjs`        el artefacto de `build-artifact.mjs`
       - `node_modules/better-sqlite3/` su addon nativo, sin bundlear
       - `pos-local-service.xml`        la configuración de WinSW, ya con identidad
       - `pos-local-service.exe`        el binario de WinSW, RENOMBRADO

  2. `-Lab`: prepara e instala un equipo de LABORATORIO de punta a punta, para
     probar en un PC físico lo que ningún arnés puede probar —el servicio real
     de Windows, el canal por named pipe y el Electron real—. Hace, en orden:
       - descarga WinSW `v2.12.0` si falta;
       - copia la plantilla `pos-local-service.xml` al staging;
       - crea o REUTILIZA `provisioning.json` (identidad de laboratorio);
       - fija la ruta absoluta de `node.exe` y las variables de `config.ts`;
       - instala el servicio para que corra como TU usuario de Windows;
       - lo arranca y espera `runtime.started` en su log.

  **Por qué el servicio corre como tu usuario y no como `LocalSystem`.** El
  canal local (`packages/local-channel/src/windows-production.ts`) deriva su
  clave raíz con DPAPI en alcance `CurrentUser` y deja el fichero con ACL de
  un solo dueño. El servicio y la ventana de Electron comparten ese secreto:
  si corren con cuentas distintas, ninguno puede leer lo que el otro creó, y
  la named pipe de `LocalSystem` no admite escritura desde un usuario normal.
  `docs/security/secret-key-and-support-management.md` deja abierta la
  elección entre alcance de máquina, cuenta de servicio o almacén
  criptográfico hasta el piloto, y exige «cuenta de servicio con mínimo
  privilegio»: `LocalSystem` es el máximo. Esto NO cierra esa decisión; es la
  única configuración de laboratorio que no altera el diseño criptográfico.

  **La identidad de laboratorio no es la de un comercio.** El instalador real
  —que derivaría tenant/empresa/sucursal de la licencia firmada— no existe
  (`E8`/`E9` en `DOCUMENTED`; `RT-006` lo registra como gap). El tenant es el
  fijo de `dev-only/dev-session-bootstrap.ts` (`DEV_TENANT_ID`): el snapshot
  de `-DevRolePreset` concede sus permisos sobre ese tenant, y con cualquier
  otro toda operación comercial respondería `UNAUTHORIZED`.

.PARAMETER StagingPath
  Directorio del artefacto. Por defecto: el de este script en el modo
  normal, y `..\dist\staging` (la salida de `build-artifact.mjs`) con `-Lab`.

.PARAMETER WinSwUrl
  Si se da, descarga WinSW desde esta URL antes de instalar.

.PARAMETER Lab
  Prepara e instala un equipo de laboratorio completo (ver arriba).

.PARAMETER DevRolePreset
  Sólo con `-Lab`. Sesión de revisión de pantallas `ADMIN`, `SUPERVISOR` o
  `CAJERO` firmada con claves efímeras de ese arranque — NUNCA producción.

.PARAMETER ReceiptPrinterConfigPath
  Sólo con `-Lab`. Fichero JSON con la configuración de la impresora
  (`ReceiptPrinterConfigSchema` en `src/config.ts`). Sin él, el equipo no
  declara impresora y `sales.receipt.print` responde `NOT_CONFIGURED`.

.PARAMETER ResetLabData
  Sólo con `-Lab`. Si `data\` tiene contenido y no hay `provisioning.json`
  que diga de quién es, en vez de negarse lo MUEVE a `data.bak-<fecha>` —no
  lo borra— y empieza de cero.
#>
param(
  [string]$StagingPath,
  [string]$WinSwUrl,
  [switch]$Lab,
  [ValidateSet("ADMIN", "SUPERVISOR", "CAJERO")]
  [string]$DevRolePreset,
  [string]$ReceiptPrinterConfigPath,
  [switch]$ResetLabData
)

$ErrorActionPreference = "Stop"

$DefaultWinSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
# `DEV_TENANT_ID` de `apps/pos-local-service/src/dev-only/dev-session-bootstrap.ts`.
$LabTenantId = "00000000-0000-7000-8000-0000000000d1"
$ServiceName = "PosLocalService"

if (-not $Lab -and ($DevRolePreset -or $ReceiptPrinterConfigPath -or $ResetLabData)) {
  throw "-DevRolePreset, -ReceiptPrinterConfigPath y -ResetLabData sólo existen con -Lab."
}

if (-not $StagingPath) {
  if ($Lab) { $StagingPath = Join-Path $PSScriptRoot "..\dist\staging" } else { $StagingPath = $PSScriptRoot }
}
if (-not (Test-Path $StagingPath)) {
  throw "No existe '$StagingPath'. Construye el artefacto antes: pnpm --filter @pos-platform/pos-local-service run build:artifact"
}
$StagingPath = (Resolve-Path $StagingPath).Path

$serviceExe = Join-Path $StagingPath "pos-local-service.exe"
$serviceXml = Join-Path $StagingPath "pos-local-service.xml"
$artifact = Join-Path $StagingPath "pos-local-service.mjs"
$dataDirectory = Join-Path $StagingPath "data"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Assert-Uuid([string]$Name, [string]$Value) {
  if ($Value -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw "provisioning.json: '$Name' no es un UUID en minúsculas: '$Value'"
  }
}

function Grant-ServiceLogonRight([string]$Account) {
  # Sin «Iniciar sesión como servicio» el SCM rechaza arrancar con la cuenta
  # (error 1069). `sc.exe config` no lo concede; la consola de servicios sí,
  # por eso se hace aquí con la misma llamada de LSA que usa esa consola.
  if (-not ("PosLabLsa" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class PosLabLsa {
  [StructLayout(LayoutKind.Sequential)]
  private struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }

  [StructLayout(LayoutKind.Sequential)]
  private struct LSA_OBJECT_ATTRIBUTES {
    public int Length; public IntPtr RootDirectory; public IntPtr ObjectName;
    public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
  }

  [DllImport("advapi32.dll")]
  private static extern uint LsaOpenPolicy(IntPtr systemName, ref LSA_OBJECT_ATTRIBUTES attributes, uint access, out IntPtr policy);
  [DllImport("advapi32.dll")]
  private static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);
  [DllImport("advapi32.dll")]
  private static extern uint LsaClose(IntPtr policy);
  [DllImport("advapi32.dll")]
  private static extern int LsaNtStatusToWinError(uint status);

  private const uint POLICY_ALL_ACCESS = 0x00F0FFF;

  public static void Grant(string account, string right) {
    SecurityIdentifier sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier));
    byte[] sidBytes = new byte[sid.BinaryLength];
    sid.GetBinaryForm(sidBytes, 0);

    LSA_OBJECT_ATTRIBUTES attributes = new LSA_OBJECT_ATTRIBUTES();
    attributes.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
    IntPtr policy;
    uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, POLICY_ALL_ACCESS, out policy);
    if (status != 0) throw new Win32Exception(LsaNtStatusToWinError(status));
    try {
      LSA_UNICODE_STRING[] rights = new LSA_UNICODE_STRING[1];
      rights[0].Buffer = Marshal.StringToHGlobalUni(right);
      rights[0].Length = (ushort)(right.Length * 2);
      rights[0].MaximumLength = (ushort)((right.Length + 1) * 2);
      try {
        status = LsaAddAccountRights(policy, sidBytes, rights, 1);
        if (status != 0) throw new Win32Exception(LsaNtStatusToWinError(status));
      } finally {
        Marshal.FreeHGlobal(rights[0].Buffer);
      }
    } finally {
      LsaClose(policy);
    }
  }
}
"@
  }
  [PosLabLsa]::Grant($Account, "SeServiceLogonRight")
}

function Initialize-LabStaging {
  if (-not (Test-Path $artifact)) {
    throw "Falta '$artifact'. Ejecuta antes: pnpm --filter @pos-platform/pos-local-service run build:artifact"
  }
  if (-not (Test-Path $serviceExe)) {
    $url = $WinSwUrl
    if (-not $url) { $url = $DefaultWinSwUrl }
    Write-Host "Descargando WinSW desde $url"
    Invoke-WebRequest -Uri $url -OutFile $serviceExe -UseBasicParsing
  }

  $provisioningPath = Join-Path $StagingPath "provisioning.json"
  $account = "$env:USERDOMAIN\$env:USERNAME"

  if (Test-Path $provisioningPath) {
    $provisioning = Get-Content -Raw -Path $provisioningPath | ConvertFrom-Json
    Write-Host "Reutilizando la identidad de laboratorio de $provisioningPath (la base local ya está ligada a ella)."
  } else {
    if ((Test-Path $dataDirectory) -and (Get-ChildItem -Force $dataDirectory | Select-Object -First 1)) {
      if (-not $ResetLabData) {
        throw "'$dataDirectory' tiene datos y no hay provisioning.json que diga de quién son. No se inventa una identidad para una base existente. Repite con -ResetLabData para apartarla (se mueve, no se borra)."
      }
      $backup = "$dataDirectory.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Move-Item -Path $dataDirectory -Destination $backup
      Write-Host "Datos anteriores apartados en $backup"
    }
    $provisioning = [pscustomobject][ordered]@{
      kind            = "LAB"
      created_at      = (Get-Date).ToUniversalTime().ToString("o")
      installation_id = [guid]::NewGuid().ToString()
      device_id       = [guid]::NewGuid().ToString()
      tenant_id       = $LabTenantId
      company_id      = [guid]::NewGuid().ToString()
      branch_id       = [guid]::NewGuid().ToString()
      data_directory  = $dataDirectory
      service_account = $account
    }
    Write-Utf8NoBom $provisioningPath ($provisioning | ConvertTo-Json)
    Write-Host "Identidad de laboratorio creada en $provisioningPath"
  }

  foreach ($field in @("installation_id", "device_id", "tenant_id", "company_id", "branch_id")) {
    Assert-Uuid $field $provisioning.$field
  }
  if ($provisioning.data_directory -ne $dataDirectory) {
    throw "provisioning.json apunta a '$($provisioning.data_directory)' y este staging es '$dataDirectory'. No se mezclan dos equipos."
  }
  if ($provisioning.service_account -ne $account) {
    throw "provisioning.json se creó para '$($provisioning.service_account)' y estás en '$account'. El secreto DPAPI de esa cuenta no lo puede leer otra."
  }

  $printerJson = $null
  if ($ReceiptPrinterConfigPath) {
    $printerJson = (Get-Content -Raw -Path $ReceiptPrinterConfigPath | ConvertFrom-Json) | ConvertTo-Json -Depth 10 -Compress
  }

  $node = Get-Command node.exe -ErrorAction Stop | Select-Object -First 1

  Copy-Item (Join-Path $PSScriptRoot "pos-local-service.xml") $serviceXml -Force
  [xml]$xml = Get-Content -Raw -Path $serviceXml
  # El SCM no hereda el PATH de esta consola: `node.exe` a secas puede no
  # resolver dentro del servicio. Mismo motivo y misma solución que CI.
  $xml.service.executable = $node.Source

  foreach ($existing in @($xml.service.SelectNodes("env"))) { [void]$xml.service.RemoveChild($existing) }
  $vars = [ordered]@{
    POS_DATA_DIRECTORY  = $dataDirectory
    POS_INSTALLATION_ID = $provisioning.installation_id
    POS_DEVICE_ID       = $provisioning.device_id
    POS_SERVICE_VERSION = "1.0.0"
    POS_PROTOCOL_MIN    = "1.0.0"
    POS_PROTOCOL_MAX    = "1.0.0"
    POS_TENANT_ID       = $provisioning.tenant_id
    POS_COMPANY_ID      = $provisioning.company_id
    POS_BRANCH_ID       = $provisioning.branch_id
  }
  if ($DevRolePreset) { $vars["POS_DEV_ROLE_PRESET"] = $DevRolePreset }
  if ($printerJson) { $vars["POS_RECEIPT_PRINTER"] = $printerJson }
  foreach ($key in $vars.Keys) {
    $element = $xml.CreateElement("env")
    $element.SetAttribute("name", $key)
    $element.SetAttribute("value", [string]$vars[$key])
    [void]$xml.service.AppendChild($element)
  }
  $xml.Save($serviceXml)

  Write-Host "node.exe del servicio: $($node.Source)"
  Write-Host "installation_id: $($provisioning.installation_id)"
  Write-Host "device_id:       $($provisioning.device_id)"
  return $account
}

$labAccount = $null
if ($Lab) {
  $labAccount = Initialize-LabStaging
} elseif ($WinSwUrl) {
  Write-Host "Descargando WinSW desde $WinSwUrl"
  Invoke-WebRequest -Uri $WinSwUrl -OutFile $serviceExe -UseBasicParsing
}

foreach ($required in @($serviceExe, $serviceXml, $artifact)) {
  if (-not (Test-Path $required)) {
    throw "Falta '$required'. Construye el artefacto (build-artifact.mjs) y coloca WinSW antes de instalar."
  }
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$credential = $null
if ($Lab) {
  # Se pide ANTES de tocar el servicio: si se cancela, nada queda a medias.
  $credential = Get-Credential -UserName $labAccount -Message "Contraseña de Windows de $labAccount (la de iniciar sesión, NO el PIN). El servicio correrá con esta cuenta para compartir el secreto DPAPI con la ventana de Electron."
  if (-not $credential) { throw "Sin contraseña no se instala: el servicio no podría compartir el canal con Electron." }
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "El servicio ya existe: deteniendo y reinstalando en vez de duplicar."
  if ($existing.Status -ne "Stopped") { Stop-Service -Name $ServiceName -Force }
  & $serviceExe uninstall
  Start-Sleep -Seconds 2
}

& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "WinSW 'install' terminó con código $LASTEXITCODE" }

if (-not $Lab) {
  Write-Host "Servicio '$ServiceName' instalado. Arranca con: Start-Service $ServiceName"
  return
}

Grant-ServiceLogonRight $labAccount
$change = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" |
  Invoke-CimMethod -MethodName Change -Arguments @{
    StartName     = $labAccount
    StartPassword = $credential.GetNetworkCredential().Password
  }
if ($change.ReturnValue -ne 0) {
  throw "No se pudo asignar la cuenta '$labAccount' al servicio (Win32_Service.Change devolvió $($change.ReturnValue))."
}
Write-Host "El servicio correrá como $labAccount."

# Logs de una ejecución anterior confundirían la espera de `runtime.started`.
Get-ChildItem $StagingPath -Filter "*.log" -ErrorAction SilentlyContinue | Remove-Item -Force

try {
  Start-Service -Name $ServiceName
} catch {
  throw "El servicio no arrancó: $($_.Exception.Message). Si dice 'logon failure' (1069), la contraseña no es la de la cuenta de Windows (el PIN no sirve)."
}

$deadline = (Get-Date).AddSeconds(60)
$started = $false
while ((Get-Date) -lt $deadline -and -not $started) {
  Start-Sleep -Milliseconds 500
  foreach ($log in Get-ChildItem $StagingPath -Filter "*.log" -ErrorAction SilentlyContinue) {
    if (Select-String -Path $log.FullName -Pattern "runtime.started" -Quiet -ErrorAction SilentlyContinue) { $started = $true; break }
  }
}

$status = (Get-Service -Name $ServiceName).Status
if (-not $started -or $status -ne "Running") {
  Get-ChildItem $StagingPath -Filter "*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "---- $($_.Name) (últimas 40 líneas) ----"
    Get-Content $_.FullName -Tail 40
  }
  throw "El servicio no llegó a 'runtime.started' en 60 s (estado: $status). Arriba están sus logs."
}

Write-Host ""
Write-Host "OK: '$ServiceName' está Running como $labAccount y registró runtime.started."
Write-Host "Siguiente, en la terminal de VS Code (sin administrador, con ESTE mismo usuario de Windows):"
Write-Host "  pnpm --filter @pos-platform/pos-desktop run start:production:lab"
