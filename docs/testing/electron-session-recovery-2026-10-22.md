# Arranque Electron y recuperación local — 2026-10-22

Continuidad sobre `feat/android-commercial-runtime`. HEAD inicial local/remoto y
PR #96: `f0932e52781a2ab3b3e040a37443d6c8bd33d67b`. PR #92 sigue draft en
`b907d20f8deb65e577086d0ae11fe40ea1d63e49`; `acbd77c` es histórico. No cambio de
rama/base, merge a main ni recuperación de ramas antiguas. Se preservó el
directorio concurrente no rastreado `docs/product/oracleJdk-27/`.

## Recuperación del trabajo existente

| Archivo / función existente | Estado y conexión observada | Dependencia pendiente |
| --- | --- | --- |
| `apps/central-authority/src/business-initial-mfa-flow.ts`, `BusinessInitialMfaFlow` | Contraseña y MFA canónicos existentes, sin reconstrucción ni ejecución repetida en este incremento | Ceremonia humana en RP/origen real y despliegue confiable |
| `apps/central-authority/src/business-session-authority.ts`, `BusinessSessionAuthority` | Autoridad BUSINESS persistida existente, conservada | Políticas D3 aprobadas y emisión productiva montada |
| `apps/central-authority/src/isolated-commercial-https.ts` | Transporte HTTPS aislado previo; no confundido con despliegue público | Central Authority externa no existe o no está confirmada por el propietario |
| `apps/pos-desktop/src/native-business-login.ts`, `electron-business-login.ts` | Preparación PKCE/callback/custodia existente; no montada como login ficticio | Registro de cliente y binding navegador/nativo/dispositivo aprobados |
| `apps/pos-local-service/src/security/device-enrollment-service.ts`, `local-security-component.ts` | Owners de enrolamiento y confianza conservados, sin alteración de credenciales | Activación DEV-003, artefactos centrales verificados y perfil SEC-004 |
| `apps/pos-local-service/src/commercial/commercial-request-handler.ts`, `session.recover` | Recupera únicamente SSA durable verificada usando configuración local, sin identidad del caller | SSA y autorización centrales reales para un usuario; no se generan en este incremento |
| `apps/pos-desktop/src/production-entry.ts`, `start.ts`, `main.ts`, `preload.ts` | Entrada productiva real → DPAPI → named pipe autenticado → handshake → contextBridge → handler real | Prueba completa de servicio productivo provisionado sigue pendiente |
| `renderer/src/hooks/useAuthorizationCapabilities.ts`, `App.tsx` | Corregido el hueco: SESSION_NOT_BOUND ahora llama al contrato vacío session.recover; NONE muestra ausencia de sesión, ACTIVE obliga a releer capabilities | Acceso humano central completo, sin botones/formularios que simulen autenticación |

Los nombres de archivo de las últimas filas son relativos a `apps/pos-desktop`.
No hay otro repositorio, módulo, tabla, autenticador ni canal paralelo.

## Incremento exacto

La UI antes convertía la ausencia de binding en un error genérico y nunca
intentaba la recuperación ya implementada. Ahora diferencia carga, ausencia de
sesión, capacidades verificadas y servicio/verificación no disponible. El botón
«Comprobar sesión» repite la consulta real. No introduce contraseña, tokens,
permisos ni IDs de usuario desde React. El UUID devuelto por ACTIVE no concede
permisos: sólo las capabilities efectivas posteriores del backend los conceden.
Las respuestas se validan con los schemas canónicos; resultados incoherentes,
snapshots rechazados, errores de transporte y respuestas tardías se cierran sin
permisos. No se cambió el diseño, el logotipo ni las pantallas comerciales.

Se amplió el host E2E existente con `NODE_ENV=test`, modo explícito NONE y Windows
obligatorio. En ese modo no genera clave de firma, SSA, snapshot, usuarios,
semillas comerciales, credenciales fiscales ni proveedor simulado. Instancia
los componentes reales CommercialComponent y LocalChannelComponent con SQLite
temporal y reloj real. El secreto local usa el procedimiento DPAPI existente;
no se pasa al renderer ni por variables de prueba de Electron.

## Evidencia ejecutada

Windows, Electron 44.1.1 y Playwright 1.63.0 instalados por el workspace.

```powershell
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop typecheck
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/session-recovery.test.tsx tests/renderer/App.test.tsx tests/preload.test.ts tests/preload-api.test.ts tests/channel-bridge.test.ts tests/main.test.ts tests/local-service-channel.test.ts
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\electron-auth\2026-10-22'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='C:\Proyectos\pos-platform\artifacts\electron-auth\2026-10-22\playwright-results.json'
pnpm --filter @pos-platform/pos-desktop test:e2e unauthenticated-startup.spec.ts --reporter=json
pnpm architecture:check
```

- Build completo aprobado: main, entrada, preload CJS y renderer; 166 módulos,
  JS 375.23 kB / gzip 107.68 kB. TypeScript de ambos proyectos aprobado.
- **75/75** pruebas focalizadas en siete archivos. Los dobles de estas pruebas
  unitarias no acreditan login humano ni el E2E siguiente. Incluyen ACTIVE sin
  grant, rechazo de snapshot/recuperación incoherente, retry y respuesta tardía,
  y regresión de navegación/pantallas autorizadas existentes.
- **3/3 E2E reales**: entrada `dist/start.bundle.mjs`, renderer `file://`, preload
  real y servicio en otro proceso por named pipe. Sin sustituir window.posService.
  Se observaron conexión y NONE, catálogo/administración/capabilities denegados
  con SESSION_NOT_BOUND, método IPC incoherente rechazado, API congelada y Node
  ausente del renderer. sandbox/contextIsolation/webSecurity true y
  nodeIntegration false; no se pasó `--no-sandbox`.
- Reintento y reinicio completo de Electron sobre el mismo SQLite temporal:
  persiste NONE. Conteos físicos del owner SQLite: cero sesiones, snapshots,
  ventas y cajas. Al detener realmente el servicio, UI muestra no disponible,
  sin pantallas operativas. No se alteraron bases persistentes.
- Arquitectura: **16/16** verificaciones y ARCH-003 aprobado.

Artefactos locales ignorados en `artifacts/electron-auth/2026-10-22/`:
`electron-no-session.png`, `electron-service-unavailable.png`,
`observed-runtime.json` (preferencias, versiones, respuestas y conteos) y
`playwright-results.json`. Las capturas se generaron desde la ventana real; se
inspeccionó la de ausencia de sesión. La prueba es reproducible con los comandos
anteriores, sin activar servicios centrales ni tocar hardware.

SHA-256 de los artefactos observados:

| Archivo | SHA-256 |
| --- | --- |
| observed-runtime.json | `e7fef2096587f6d61f277d5a83f7f4cf144936477a7ac77c58b430b44b54a8b3` |
| playwright-results.json | `55bb752e4ba2a7ba1be44625ac30fd2c04e027c9b1c74b44c3ca0e8920704b9a` |
| electron-no-session.png | `af901c11e9fdce453398a8450b70e1ff5f836234343c677f30c2bc769b6fcedd` |
| electron-service-unavailable.png | `e292f250826f8dee884515d2b7d093318ae4e636d0ae978038adcf5f0d38dc8b` |

CI remoto previo consultado para f0932e52: run `39826548284`, check
`119991229354`, failure sin pasos. Anotación GitHub: el job no inició por pagos
fallidos o límite de gasto. Las pruebas locales no se presentan como CI verde.

Fallos conservados: baseline 65 aprobadas/2 fallidas por aserciones antiguas de
lámpara decorativa ya retirada. Se sustituyeron por recuperación/reintento, sin
restaurar controles eliminados. Primera E2E falló por payload de catálogo sin
query/offset; se corrigió la prueba conforme al contrato. TypeScript detectó
tipos del env y un método de inspección Electron no declarado; corregidos sin
relajar el runtime. Un intento de reporter múltiple falló por expansión de coma
en PowerShell; el comando reproducible usa sólo json. Avisos NO_COLOR/FORCE_COLOR
del entorno no equivalen a fallos de seguridad.

## Límite exacto y siguiente decisión

**Verificado:** arranque local real de Electron y recorrido de consulta/denegación
hasta el backend. **No verificado:** autenticación humana Central → BUSINESS →
dispositivo → SSA → servicio provisionado → permisos React. El host aislado no
es el bootstrap completo de LocalSecurityComponent con activación DEV-003. La
ruta ACTIVE tiene pruebas unitarias, no se acredita con una sesión firmada por
el propio arnés como login real. No se probaron roles de personas reales,
renovación productiva ni Android físico en este incremento.

Se conserva una sola [propuesta de aprobación](android-commercial-approval-proposal-2026-10-22.md).
Faltan: despliegue/operador Central, dominio TLS y RP/origen reales, registro de
clientes/redirects y firmante/DAL Android; binding previo navegador-dispositivo
compatible con DeviceProof; binding durable de refresh; vigencias, abuso y
reautenticación D3; activación y confianza DEV-003; SEC-004 y canal/origen DEC-025;
productor central de grants/policy y composición SSA. La aprobación de parámetros
no implementa por sí sola esas composiciones pendientes. Producción sigue cerrada.

## Requisito posterior de impresión, sin integración ahora

El propietario identifica `co.camachopos.printmini` versión **0.12**, con impresión
física previamente comprobada por él sobre M60WL/GP-L80160. Se registra como
observación del propietario, sin certificarla en esta sesión. La configuración
futura deberá incluir descarga oficial, versión y guía de instalación. Su API,
autenticación y compatibilidad comercial deben verificarse antes de diseñar un
adapter; no se inventa una API, copia un driver ni se opera impresora/cajón aquí.
