# Cierre comercial Windows — evidencia 2026-11-18

**Rama:** `cursor/commercial-design-review-0d11` · **PR:** #106 Draft  
**HEAD exacto:** `76253bb6082d1920eed5693b9ca7f2dcae7ae231`  
**Base SCM NSIS previa:** `5e526641` (`WINDOWS_SCM_INTEGRACION_CERRADA`)

## Artefacto instalador (lab unsigned)

| Campo | Valor observado |
|---|---|
| Archivo | `CamachoPOSColombia-0.0.0-win-x64.exe` |
| SHA-256 | `3fbb815cb9a589589420fd80b0f04c960d35581031aeb59137e1c924de57b72f` |
| Bytes | `158644625` |
| Authenticode | `UNSIGNED_LAB_ONLY` / **RT-009-B BLOCKED** |
| CI push | [run 44220691737](https://github.com/Andresito202/pos-platform/actions/runs/44220691737) |
| CI PR | [run 44220701201](https://github.com/Andresito202/pos-platform/actions/runs/44220701201) |
| Native G1 lab push | [run 44220691669](https://github.com/Andresito202/pos-platform/actions/runs/44220691669) |
| Lifecycle | `FAILED_COUNT=0` · artifact `camacho-pos-nsis-lab-76253bb6082d1920eed5693b9ca7f2dcae7ae231` |

Addon nativo (NSIS job): `NATIVE_ADDON_SHA256=A05BF7AD066D7C694E59F6F416ECBDF1AA694A3356083D634AA445ED6A0E4F82`

## Matriz PASS / FAIL / SKIP (observada)

| Capacidad | Resultado | Evidencia |
|---|---|---|
| Silent install NSIS | **PASS** | `silent_install` |
| Paths / ACL / native deps / payload | **PASS** | verify_* steps |
| WinSW `NT SERVICE\CamachoPOSLocalService` + Automatic | **PASS** | `winsw_scm_registration` · `labFallbackUsed=false` |
| Reinicio servicio / recuperación interrupción | **PASS** | `scm_restart_recovery` |
| Negativos ACL / no-LocalSystem / secret ACL | **PASS** | `security_negatives` (`failed=0`) |
| Negativo provisión SCM forjada (bundle path) | **SKIP** | `negative_forged_scm_provision_startup` (bundle/node no localizado en payload; fail-closed cubierto por vitest `windows-scm-commercial-entry-process`) |
| Entrada comercial SCM fail-closed | **PASS** | smoke `SCM_COMMERCIAL_ENTRY_FAIL_CLOSED=PASS` |
| G1 nativo en SCM **instalado** por NSIS | **PASS** | `g1_native_on_installed_scm` · `G1_NATIVE_ON_INSTALLED_SCM=PASS` |
| Peer G1 Session 0 ↔ interactivo + DPAPI cruzado denegado | **PASS** | mismos logs G1 + lab nativo efímero |
| Restaura WinSW tras G1 | **PASS** | `winsw_restored_after_g1` |
| Electron ↔ Local Service interactivo (same-user DPAPI) | **PASS** | `electron_local_service_ipc` + Playwright live 4 roles |
| Electron ↔ NT SERVICE comercial (RSA/Ed25519 + lease) | **SKIP** | `electron_winsw_scm_commercial_ipc` · gate activo |
| 4 roles auth real + aislamiento | **PASS** | Playwright captures + `FOUR_ROLE_AUTH_NEGATIVES=PASS` |
| Cierre / revocación sesión | **PASS** | `SESSION_CLOSE_REVOKE=PASS` |
| Auto-start tras reboot Windows físico | **SKIP** | Automatic verificado; reboot físico no ejecutado en GHA |
| Upgrade conserva SQLite comercial | **PASS** | `sqlite_preserved_across_upgrade` |
| Uninstall retira SCM, conserva AppData | **PASS** | `winsw_scm_removed_after_uninstall` + `residuals_after_uninstall` |
| Win10/11 físico dueño | **SKIP** | Lab = Server 2022 disposable |
| Authenticode Camacho | **BLOCKED** | RT-009-B · certificado externo ausente |
| Gate `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` | **ACTIVO** | sin bypass; `COMMERCIAL_GATE=ACTIVE` |
| Merge a `main` | **NO** | Draft only · sin FACTUS |

## Qué queda para levantar el gate

G1 de identidad en el SCM instalado ya es **PASS** en este HEAD. Aún falta el handoff criptográfico de producto (`windows-scm-physical.test.ts` SERVICE+DESKTOP/Electron con provisiones administradas) y revisión explícita del cambio a `assertWindowsScmCommercialCertification`. Hasta entonces el gate permanece incondicional.

## Conservado

- Instalación autónoma WinSW/SCM NSIS aprobada.
- `commercialLogin=false`.
- Sin mecanismos auxiliares que sustituyan el flujo comercial.
- Sin debilitar seguridad para CI.
- Sin ramas adicionales.
