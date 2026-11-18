# Canal comercial Electron ↔ NT SERVICE — Prompt 1 (continuación)

**Rama:** `cursor/commercial-design-review-0d11` · **PR:** #106 Draft  
**Preserva evidencia aprobada:** `76253bb6082d1920eed5693b9ca7f2dcae7ae231` (G1 on installed SCM, NSIS lifecycle, negativos)

## Cambio de gate (no bypass por entorno)

`assertWindowsScmCommercialCertification` ya no lanza incondicionalmente `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.

Exige identidad OS real:

- `NT SERVICE\CamachoPOSLocalService`
- Session 0
- recibo `SCM_COMMERCIAL_SERVICE_CONTEXT_VERIFIED`

Justificación: G1 nativo sobre el SCM instalado por NSIS = **PASS** en `76253bb6`. El descriptor sigue rechazando `commercialLogin=true` y `POS_WINDOWS_COMMERCIAL_PROVISION_FILE` con el código histórico. RT-009-B Authenticode permanece **BLOCKED**.

## Operador de producto

`tools/operators/windows-nsis-scm-commercial-channel.ps1`:

1. Enrollment SERVICE bajo WinSW (misma cuenta virtual; argumentos temporales; no sustituye binPath por Node crudo).
2. Enrollment DESKTOP interactivo (DPAPI CurrentUser del operador).
3. Pair de provisiones + ACL installer-managed.
4. XML WinSW de producto con `POS_WINDOWS_SCM_HANDOFF_FILE`.
5. Arranque del Local Service empaquetado.
6. Ops autenticadas con `connectWindowsScmClient` (mismo path que `production-entry.ts`).
7. Persistencia del EXE instalado con `POS_WINDOWS_SCM_HANDOFF_FILE`.

Lifecycle: paso `electron_winsw_scm_commercial_ipc` tras upgrade (ya no SKIP automático tras G1 PASS).

## Bloqueos externos / físicos (explícitos)

| Ítem | Estado |
|---|---|
| Authenticode Camacho (RT-009-B) | **BLOCKED** |
| PC físico del propietario / Win10-11 dueño | **NOT_TESTED** |
| BUSINESS/GLOBAL + MFA humano | **NOT_CERTIFIED** |
| Reboot Windows completo | Automatic verificado; reboot físico **SKIP** |

## Matriz a completar tras CI del HEAD de este incremento

| Capacidad | Esperado |
|---|---|
| Evidencia `76253bb6` (G1, NSIS, negativos) | **PRESERVED** |
| Gate servicio Session 0 | PASS (unit + proceso) |
| `electron_winsw_scm_commercial_ipc` | PASS/FAIL (producto) |
| Negativos impersonación / pin en canal SCM | PASS |
| Authenticode | BLOCKED |
| Merge `main` | NO |
