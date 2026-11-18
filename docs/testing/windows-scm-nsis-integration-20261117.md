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
- NSIS-hosted PS: **no** `Get-FileHash` → SHA256 vía `certutil` (fallback BCL).
- Marker `scm-install.ok` en `$INSTDIR\resources\service-payload\` (NSIS) + copia ProgramData (diagnóstico). **No** usar `$COMMONAPPDATA` (warning 6000 en electron-builder NSIS → pack fail).
- NSIS `customInstall`: `Abort` si falta el marker bajo `$INSTDIR` (no confiar sólo en exit code de nsExec).
- Lifecycle: **sin** fallback auxiliar. Exige marker + Running + `NT SERVICE\…` + Automatic tras install y tras upgrade; vuelca `winsw-helper.log` si falla.

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

## Hallazgo CI `95e8279f` (run 44201766108) / `3f215949`

- `95e8279f`: `SILENT_INSTALL_FAILED:exit=2` — Abort de `customInstall` sin volcado de `winsw-helper.log` en el report.
- `3f215949`: pack fail — makensis `warning 6000: unknown variable/constant "COMMONAPPDATA\..."` (warning treated as error). Marker debe vivir bajo `$INSTDIR`, no `$COMMONAPPDATA`.

## Hallazgo CI `5980453d` (run 44205420193) — helper trail recuperado

- Pack OK; silent install Abort.
- Helper: `SERVICE_ACL_GRANT_FAILED` — `Get-Acl` found in `Microsoft.PowerShell.Security` but module could not load under nsExec (misma clase que `Get-FileHash`).
- SCM ya estaba `NT SERVICE\CamachoPOSLocalService` (STOPPED); falló antes de start.
- Cierre integral (no parches sueltos): helper crítico usa sólo `sc.exe` / `icacls.exe` / `certutil.exe` (System32 verificado + exit code) + BCL SID/SHA. Sin `Get-Acl`/`Set-Acl`/`Get-FileHash`/`Get-Service`/`Get-CimInstance`. ACL mínima al SID virtual; `icacls` lista y exige ACE efectiva. Gate estático: `tools/operators/assert-helper-nsis-safe.mjs`.

## Hallazgo CI `15a862ce` (run 44208000488)

- `ICACLS_GRANT_FAILED:exit=87` — `Invalid parameter "Files\Camacho"`: `Start-Process -ArgumentList` string[] sin quoting partió `C:\Program Files\…`.
- Corrección: `Format-NativeArg` / `Format-NativeArgumentList` → una sola cadena Arguments con paths/grants entrecomillados; regresión `test-native-arg-quoting.mjs`.

## Veredicto

**`WINDOWS_SCM_INTEGRACION_CERRADA`** (lab NSIS/WinSW/SCM) — CI exact-head `5e526641` run `44209778273` / job `134484871341`:

- Silent install/upgrade/uninstall PASS; `FAILED_COUNT=0`.
- `identityOk=true`, `SERVICE_START_NAME=NT SERVICE\CamachoPOSLocalService`, `startType=Automatic`.
- `labFallbackUsed=false`; marker `scm-install.ok` presente post-install y post-upgrade.
- ACL virtual en payload verificada (`virtualAccountAclPresent=true`).
- Datos comerciales AppData preservados tras upgrade/uninstall.
- **No** cierra IPC comercial Desktop↔`NT SERVICE` (`SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` / SKIP).
- **No** cierra Authenticode Camacho (`RT-009-B_BLOCKED`).
- **No** merge a `main`; Draft; sin FACTUS.

## Continuación 2026-11-18 (mismo PR / misma rama)

Ver `docs/testing/windows-commercial-close-attempt-20261118.md`: G1 nativo sobre SCM instalado, negativos ACL/provisión forjada, `scm_restart_recovery`, smoke de 4 roles/sesión. El gate comercial y RT-009-B permanecen.
