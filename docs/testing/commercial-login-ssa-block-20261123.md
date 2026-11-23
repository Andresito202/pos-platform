# Bloqueo — login comercial SSA/SAS (2026-11-23)

Rama: `cursor/commercial-login-form-c53a`  
HEAD de referencia visual: `76774944`  
Alcance: auditoría del enlace del formulario aprobado al flujo comercial autorizado.

## Conclusión

El formulario de login aprobado **no puede completar** una sesión BUSINESS firmada
en este árbol sin inventar credenciales. El bloqueo es de **emisión y
aprovisionamiento Central**, no del diseño visual del login.

No se habilitó `POS_LOCAL_OPERATOR_AUTH_STORE` en producción.  
No se promovió `local-operator-development-bridge` a autoridad comercial.  
No se fabricaron SSA/SAS, identidades ni permisos firmados.

## Flujo comercial canónico (ya materializado en servicio)

1. Confianza de dispositivo / custodia OS (`CommercialDeviceCredentialProvider`).
2. Central emite SSA en `POST /v1/business-session/assertions` (posesión firmada).
3. Desktop/servicio llama `session.activate` con `session_assertion` firmada.
4. Central entrega SAS en `/v1/business-session/authorization`.
5. `authorization.capabilities.get` proyecta permisos efectivos del snapshot firmado.
6. `session.recover` rehidrata el vínculo tras reinicio desde SSA durable.

Contratos IPC: `packages/contracts` (`session.activate`, `session.recover`,
`authorization.capabilities.get`). Handlers: `CommercialRequestHandler`.  
Canal: `LocalChannelComponent` (win32) / SCM (PR #127 — no modificada).

## Qué falta para conectar el login existente

| Pieza | Estado | Evidencia |
|---|---|---|
| UI de login visual | Implementada | `LocalOperatorLoginPanel` + marca amarilla |
| IPC `session.activate` / `recover` en allowlist | Implementado | `preload-api`, `ipc-allowlist` |
| Llamada del renderer a `session.activate` | Ausente | Cero referencias en `apps/pos-desktop/renderer` |
| Emisión SSA por Central con operador humano | Fuera de este POS | Requiere Central + MFA/token comercial |
| Cliente local que obtenga SSA tras login | Ausente | No hay IPC de adquisición SSA→activate |
| `SnapshotAcquisitionService` (SAS-003) en `main.ts` | Desconectado | `materialization-state.md` — cero instancias en runtime |
| Trust keys de sesión en runtime | Condicional | Vacío → `session.activate` falla cerrado |
| Device Trust / enrollment comercial | Aprovisionamiento | Exige OS_BOUND + credencial enrollada |
| SCM comercial interoperable | No acreditado | Conservar bloqueo; no debilitar PR #127 |

## Diferenciación obligatoria

| Concepto | Qué es | Qué no es |
|---|---|---|
| Autenticación de operador local | Password store de desarrollo (`CAMACHO_DEV_ACCOUNTS_V1`) | SSA/SAS BUSINESS |
| Vinculación de sesión | `session.activate` / `recover` + binding por `connectionId` | Login UI por sí solo |
| Autorización BUSINESS | Snapshot firmado + `capabilities.get` | `LOCAL_DEVELOPMENT_INTERNAL` |
| Bridge de desarrollo | Proyección RBAC local con `NODE_ENV=development` | Autoridad comercial certificada |

`config.ts` rechaza el store local fuera de development
(`LOCAL_OPERATOR_AUTH_DEVELOPMENT_ONLY`).

## Requisitos manuales restantes (Windows)

1. Servicio Local en win32 con canal SCM o named-pipe provisionado.
2. Device Trust enrollado y custodia OS.
3. Trust bundle `SESSION_ASSERTION` y, cuando corresponda, publicación Central.
4. Emisión real de SSA/SAS desde Central para el operador.
5. Cablear adquisición SSA → `session.activate` → capabilities (sin bypass local).
6. Ejecutar `e2e/local-operator-live` / prueba comercial con artefactos reales.
7. No declarar certificación comercial hasta evidencia física de ese camino.

## Decisión de implementación en esta rama

Se documenta el bloqueo y se corrigen defectos visuales demostrables de Caja
(y revisión de navegación por permisos). **No** se publica un login que aparenta
sesión comercial firmada apoyándose en permisos locales de desarrollo.
