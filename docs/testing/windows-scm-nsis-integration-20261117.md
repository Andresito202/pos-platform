# Integración WinSW/SCM en NSIS — 2026-11-17

**Rama:** `cursor/commercial-design-review-0d11` · **PR:** #106 Draft  
**Base aprobada previa:** `ceba5daf` (CERTIFICACION_WINDOWS_LAB_CERRADA)

## Qué se integra (reutiliza, no duplica)

| Pieza | Origen |
|---|---|
| Descriptor WinSW | `apps/pos-local-service/src/windows-service-descriptor.ts` (`commercialLogin=false`) |
| Artefacto LOCAL_SERVICE | `build:artifact` win32-x64 INTERACTIVE |
| WinSW 2.12.0 | Oficial `WinSW-x64.exe`, SHA `05b82d46…` |
| Node 22.19.0 | Oficial win-x64, SHA desde SHASUMS256.txt |
| Install/uninstall SCM | `packaging/install-camacho-local-service.ps1` + `installer.nsh` |
| Pack | `stage-nsis-service-payload.mjs` → `extraResources` → `pack:windows-nsis` |

## Seguridad conservada

- Sin certificados ficticios; Camacho PE = RT-009-B BLOCKED.
- Sin secretos embebidos.
- `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` **no** se limpia: Desktop CurrentUser DPAPI ≠ `NT SERVICE\CamachoPOSLocalService`.
- IPC comercial Electron↔WinSW Session 0: **NOT_PROVEN** (SKIP explícito en lifecycle).
- Real-auth roles/sectores siguen el canal interactivo same-user (evidencia lab previa).
- `deleteAppDataOnUninstall=false`; uninstall retira servicio, no datos comerciales.

## Estabilidad agrupada

- App settled-identity: no reset en primer settle (carrera #1480).
- Hardware channel vertical: techo 60s bajo serialización Windows (evidencia timeout 30s).
- Node zip extract: sin `Expand-Archive` (PS7 `ExtractToDirectory` 3-arg); `tar.exe` / ZipFile 2-arg / `unzip`.
- Lifecycle `installDir`: resolución dinámica post-install/upgrade. `perMachine` → `Program Files\Camacho POS Colombia`; no congelar `LocalAppData\Programs` antes del install (electron-builder suele dejar `InstallLocation` vacío). SCM payload bajo `resources\service-payload`; datos SCM en `ProgramData\CamachoPOS\lab-data`; retención comercial AppData intacta.
- WinSW helper: nunca parametrizar `$args` (colisión PS → `ArgumentList` null). Tras `winsw install`, ACL RX al payload y Modify a `ProgramData\CamachoPOS\{lab-data,logs}` para `NT SERVICE\CamachoPOSLocalService`. `<logpath>` fuera de Program Files. STDERR/sc diagnostics en fallos.
- WinSW 2.12 XML: usar `<domain>NT SERVICE</domain>` + `<user>CamachoPOSLocalService</user>`. El elemento `<username>` **no** lo lee XmlServiceConfig → el servicio queda en LocalSystem. `allowservicelogon=false` para cuentas virtuales (LookupAccountName corre antes de CreateService).
- Lifecycle exige `StartName=NT SERVICE\CamachoPOSLocalService` + Running; LocalSystem nunca PASS.
- Uninstall: helper ya no exige payload completo; stop + WinSW uninstall + `sc delete`; NSIS `customUnInstall` también ejecuta `sc stop/delete` por si el payload ya no está.
- NSIS-hosted PS: **no** `Get-FileHash` → SHA256 vía `certutil` (fallback BCL). Éxito escribe `ProgramData\CamachoPOS\logs\scm-install.ok`.
- NSIS `customInstall`: `Abort` si falta `scm-install.ok` (no confiar sólo en el exit code de nsExec).
- Lifecycle: **sin** fallback auxiliar. Exige marker + Running + `NT SERVICE\…` + Automatic tras install y tras upgrade; Absent post-upgrade = FAIL.

## Niveles de certificación

| Nivel | Estado esperado |
|---|---|
| Lab packaging + SCM register/start/uninstall | Objetivo de este incremento |
| IPC comercial Desktop↔NT SERVICE | BLOQUEADO por gate de interoperabilidad |
| Distribución Authenticode Camacho | RT-009-B BLOCKED |
| Física PC propietario | Fuera de alcance |

## Hallazgo CI `feec4277` (job 134429481565)

- Paths/ACL/payload/native: PASS.
- WinSW `install`+`start` reportaron éxito, pero `StartName=LocalSystem` → `identityOk=false` → exit 7 → `WINSW_SCM_REGISTRATION_FAILED`.
- Causa raíz: plantilla con `<username>NT SERVICE\…</username>`; WinSW 2.12.0 `XmlServiceConfig` sólo asigna `Domain`/`User` desde `<domain>`/`<user>`, así que `HasServiceAccount()` era false y SCM caía al default LocalSystem.
- Corrección en tip posterior: `<domain>/<user>` + `allowservicelogon=false` + gate lifecycle de identidad virtual.

## Hallazgo CI `4c20762e` (run 44198910243) — SUCCESS enmascarado

1. NSIS `customInstall` → `HELPER_UNCAUGHT`: `Get-FileHash` no reconocido bajo nsExec → servicio ausente tras install.
2. Lifecycle usó fallback auxiliar → PASS falso de registro.
3. Upgrade: `customUnInstall` quitó el servicio; `customInstall` falló otra vez por Get-FileHash → `servicePresent=False` con `paths_after_upgrade` aún PASS (sólo miraba payload).

## Veredicto

Se declara tras CI exact-head del tip que incluye este empaquetado:

- `WINDOWS_SCM_INTEGRACION_CERRADA` — sólo si SCM register/start/upgrade-persist/remove PASS **sin** fallback de lab, identidad virtual, Automatic start, **y** el alcance declarado no exige IPC comercial Session 0 (ese sigue NOT_PROVEN).
- `WINDOWS_SCM_INTEGRACION_BLOQUEADA` — si falla payload/SCM/lifecycle, o si se pretendía cerrar handoff comercial sin evidencia.
