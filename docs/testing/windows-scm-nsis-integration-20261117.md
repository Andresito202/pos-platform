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

## Niveles de certificación

| Nivel | Estado esperado |
|---|---|
| Lab packaging + SCM register/start/uninstall | Objetivo de este incremento |
| IPC comercial Desktop↔NT SERVICE | BLOQUEADO por gate de interoperabilidad |
| Distribución Authenticode Camacho | RT-009-B BLOCKED |
| Física PC propietario | Fuera de alcance |

## Veredicto

Se declara tras CI exact-head del tip que incluye este empaquetado:

- `WINDOWS_SCM_INTEGRACION_CERRADA` — sólo si SCM register/start/remove PASS **y** el alcance declarado no exige IPC comercial Session 0 (ese sigue NOT_PROVEN).
- `WINDOWS_SCM_INTEGRACION_BLOQUEADA` — si falla payload/SCM/lifecycle, o si se pretendía cerrar handoff comercial sin evidencia.
