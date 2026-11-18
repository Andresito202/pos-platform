# Cierre comercial Windows — intento 2026-11-18

**Rama:** `cursor/commercial-design-review-0d11` · **PR:** #106 Draft  
**Base SCM NSIS cerrada:** `5e526641` (`WINDOWS_SCM_INTEGRACION_CERRADA`)  
**HEAD de este incremento:** (rellenar tras push)

## Objetivo

Cerrar la operación comercial del POS instalado en Windows: Electron ↔ Local Service bajo `NT SERVICE\CamachoPOSLocalService`, DPAPI/ACL, 4 roles, sesiones, auto-start, recuperación, upgrade y negativos — **sin** debilitar `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` ni inventar Authenticode.

## Qué se conserva

| Pieza | Estado |
|---|---|
| WinSW/SCM NSIS autónomo | Aprobado; no se reescribe el instalador ni se introduce fallback auxiliar |
| `commercialLogin=false` en descriptor | Conservado |
| Gate `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` | **ACTIVO** (sin bypass por env) |
| RT-009-B Authenticode Camacho | **BLOCKED** (certificado externo ausente) |
| FACTUS / sectores | Sin cambios |

## Qué se añade en este corte

1. **G1 nativo sobre el SCM ya instalado por NSIS** (`tools/operators/windows-nsis-scm-g1-identity.ps1`):
   - Retarget temporal del mismo `CamachoPOSLocalService` al probe C# + peer nativo.
   - Prueba Session 0 + DPAPI CurrentUser del servicio + denegación cruzada Desktop.
   - Peer interactivo real (cuenta local desechable con logon SID).
   - Restaura binPath WinSW y reinicia el producto.
   - **No** certifica handshake comercial Electron ni levanta el gate.

2. **Negativos de seguridad** (`tools/operators/windows-nsis-security-negatives.ps1`):
   - ACL payload / virtual account.
   - Arranque con provisión SCM forjada → gate fail-closed antes de SQLite.
   - Rechazo de LocalSystem como identidad aceptable.

3. **Lifecycle NSIS**: `scm_restart_recovery`, `security_negatives`, `g1_native_on_installed_scm`, `winsw_restored_after_g1`.

4. **Workflow nativo G1** habilitado en esta rama + build del addon en el lab NSIS.

5. **Smoke**: cierre/revocación de sesión, autorización 4 roles, entrada comercial SCM fail-closed.

## Matriz de evidencia (actualizar tras CI exact-head)

| Capacidad | Resultado esperado | Evidencia |
|---|---|---|
| Silent install / upgrade / uninstall NSIS | PASS (previo) | lifecycle report |
| WinSW `NT SERVICE\CamachoPOSLocalService` + Automatic | PASS (previo) | `winsw_scm_registration` |
| Reinicio servicio / recuperación | PASS/FAIL | `scm_restart_recovery` |
| Negativos ACL / provisión forjada / no-LocalSystem | PASS/FAIL | `security_negatives` |
| G1 nativo en SCM instalado | PASS/FAIL/SKIP | `g1_native_on_installed_scm` |
| Restaura WinSW tras G1 | PASS/FAIL | `winsw_restored_after_g1` |
| Electron ↔ Local Service interactivo (same-user) | PASS (lab) | `electron_local_service_ipc` + Playwright live |
| Electron ↔ NT SERVICE comercial (RSA/Ed25519+lease) | **SKIP** | gate activo |
| 4 roles auth + aislamiento | PASS/FAIL | Playwright `local-operator-live` + vitest auth |
| Renovación / cierre / revocación sesión | PASS/FAIL | `native-session-close-lifecycle` + live logout |
| Auto-start tras reboot Windows | **SKIP**/parcial | Automatic verificado; reboot físico no en GHA |
| Upgrade conserva SQLite comercial | PASS (previo) | `sqlite_preserved_across_upgrade` |
| Win10/11 alcance soportado | SKIP lab | Lab = Server 2022; contrato Win10/11 documentado, no re-ejecutado aquí |
| Authenticode Camacho | **BLOCKED** | RT-009-B |
| Merge a `main` | NO | Draft only |

## Criterio para levantar el gate (aún no cumplido)

Sólo tras recibos observados en el HEAD exacto de:

1. G1 nativo en el SCM instalado = PASS  
2. Physical product handoff (`windows-scm-physical.test.ts`) SERVICE+DESKTOP/Electron = PASS  
3. Revisión explícita del cambio a `assertWindowsScmCommercialCertification`  

Hasta entonces el gate permanece incondicional.

## Comandos CI

- `Windows NSIS installer lab` (esta rama)
- `Windows SCM native artifact lab` (esta rama)
