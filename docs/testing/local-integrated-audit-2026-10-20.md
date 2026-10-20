# Auditoría local integral — Windows, 2026-10-20

## Resultado y alcance

El núcleo comercial funciona en un E2E aislado de Electron contra el servicio y SQLite reales. La instalación comercial sigue **BLOQUEADA**: no hay aprovisionamiento configurado ni login central integrado. Ninguna persona se autenticó como cajero, supervisor, administrador, propietario o superadministrador.

Ejecución directa en `C:\Proyectos\pos-platform`, Windows 10 Pro build 19045, el 2026-10-20 aproximadamente 14:18–14:34 America/Bogota. Node **22.19.0**, pnpm **9.15.0**, Electron **44.1.1**, Vite **6.4.3**, React **19.1.0**, Playwright **1.63.0** instalados. No se utilizó Computer Use: PowerShell y Playwright controlaron procesos reales y capturaron el renderer de Electron. No se generaron imágenes.

Los resultados corresponden a `2ac19a236f8fd98028b761e65a42f62aa5db3666` **más el diff local descrito abajo**; no son pruebas del commit limpio ni CI. No se creó commit, rama, publicación ni merge.

## A. Arranque y equipo real

| Comprobación ejecutada | Resultado observado |
|---|---|
| `git status --short --branch`, `git rev-parse HEAD` iniciales | Rama `claude/pos-camacho-bloque-4c-ld43py`, árbol limpio, HEAD `d6bee7f661f4b5c77b0cc9478a19b984b276cdd0` |
| `git fetch origin`, comparación y `git merge --ff-only '@{upstream}'` | Tres commits incorporados sin conflicto en la misma rama. HEAD local/remoto `2ac19a236f8fd98028b761e65a42f62aa5db3666`, comparación posterior **0/0** |
| `docker ps -a`, `pg_isready`, `postgres --version` | `target-migrations-postgres-1` healthy; acepta conexiones; PostgreSQL **16.14**, puerto `127.0.0.1:55433`. No se aplicaron migraciones a esa instalación |
| Procesos, TCP y pipes | Al inicio había Electron con `e2e/visual-preview-entry.mjs` y un pipe Camacho existente. Ese proceso y ese pipe no acreditan un backend productivo. Al finalizar no quedaron procesos del servicio/Electron de esta auditoría; PostgreSQL continúa activo; 8443, 8787 y 5173 sin listener |
| Configuración de entorno | Ninguna variable POS/CENTRAL/FACTUS de aprovisionamiento en proceso, usuario o máquina. No se encontraron `.env*` en el repositorio excluyendo dependencias/dist. En LocalAppData/POSPlatform se encontró evidencia de migraciones, no configuración de dispositivo recuperable |
| Artefactos anteriores | Había `dist/` y bundles antiguos incluso sin fuentes actuales (`production-lab`, etc.). No se usaron como evidencia. Se recompiló renderer, preload y main desde el árbol actual |
| Logs previos | Tres logs de suites locales encontrados en raíz; son históricos, no se contabilizan como ejecución de esta auditoría |
| `powershell -NoProfile -File .\tools\local\launch-windows.ps1 -CheckOnly` | **Exit 2**, sin iniciar servicios. Faltan las nueve variables obligatorias |
| `pnpm --filter @pos-platform/pos-local-service start` | **Exit 1**, evento real `runtime.start_failed`: `parseServiceConfig` → ZodError por campos requeridos ausentes, antes de abrir SQLite |
| `pnpm --filter @pos-platform/pos-desktop start:production` | Error real `POS_DATA_DIRECTORY is required for production desktop bootstrap`, originado en `requireValue` de `packages/local-channel/src/windows-production.ts`. Electron mostró el fallo de carga; se cerró únicamente el árbol de proceso creado por este intento |
| `pnpm --filter @pos-platform/central-authority start` | **Exit 1**, `CENTRAL_DATABASE_URL is required`, `required()` en `apps/central-authority/src/main.ts`. No se configuraron certificados ni credenciales ficticias |

Variables ausentes: `POS_DATA_DIRECTORY`, `POS_INSTALLATION_ID`, `POS_DEVICE_ID`, `POS_SERVICE_VERSION`, `POS_PROTOCOL_MIN`, `POS_PROTOCOL_MAX`, `POS_TENANT_ID`, `POS_COMPANY_ID`, `POS_BRANCH_ID`. No se inventaron para la instalación. Tampoco había ancla SSA, URL central o configuración FACTUS.

Se revisó el launcher antes de invocarlo. Su camino integrado permanece **NO CERTIFICADO**, pues no superó el preflight. Su aviso de ausencia de login central sigue correspondiendo al código actual. No se inició el launcher completo con identidades de prueba.

### Ejecución aislada que sí arrancó

- `session-bootstrap-main-runtime.test.ts` arrancó **el `main.ts` de producción** con configuración y claves exclusivas de prueba en un directorio temporal. La prueba espera y analiza `runtime.started`, abre el named pipe real y valida activación, recuperación tras reinicio y revocación del trust. Aprobó **1/1**. Su stdout estructurado se consume dentro de la prueba; el log conservado acredita la ejecución y resultado, no contiene copia íntegra de esos eventos.
- `real-channel.spec.ts` lanzó Node y Electron independientes. En Windows reutiliza `LocalDatabaseComponent`, `DurableSyncComponent`, `OperationConfirmationComponent`, `CommercialComponent` y `LocalChannelComponent`; DPAPI protege el secreto temporal y las solicitudes cruzan el named pipe/HMAC, IPC allowlist y preload reales.
- La inspección del BrowserWindow real comprobó `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; en el renderer `require` y `process` resultaron `undefined`. Se conserva `electron-security.json`. No se cambiaron estas opciones para abrir la ventana.
- Las cuatro pruebas E2E aprobaron: efectivo/recibo/cierre; transferencia confirmada; alta/entrada/ajuste/consulta/clientes; rechazo fiscal por datos faltantes. No se sustituyó el handler comercial ni SQLite por respuestas fabricadas.
- Los **fixtures** del arnés siguen siendo identidad, snapshot de todos los permisos canónicos, SSA firmada, caja y rango fiscal. El reloj comercial es `2026-09-03T12:00:00Z`; por eso algunas fechas de eventos y fechas de negocio difieren en las capturas. El puerto fiscal existente es `FakeIssuancePort`: **no FACTUS sandbox verificado**.
- Se cerraron los procesos y se eliminó únicamente la base/directorio temporal creado por cada arnés. No queda un POS productivo abierto.

## B. Diagnóstico visual real

Hay **30 PNG** en [evidencia local](../../artifacts/local-audit/2026-10-20/). No se publican ni versionan los binarios de `artifacts/`. Son capturas de Electron, sin visual-preview, con SQLite temporal y **sin rol comercial autenticado**. Los nombres 1440/1024 corresponden al tamaño de ventana solicitado (1440×900 y 1024×768); el viewport efectivo está en `screens.json` y los PNG reflejan la escala/DPI de Windows. También se capturó la ventana maximizada.

| Superficie inspeccionada | Captura de escritorio | Evidencia visual y alcance |
|---|---|---|
| Estado de acceso sin sesión | [access-without-session.png](../../artifacts/local-audit/2026-10-20/access-without-session.png) | Canal conectado y acceso no disponible por `SESSION_NOT_BOUND`; **no es un formulario de login** |
| Caja y ventas | [screen-0-1440.png](../../artifacts/local-audit/2026-10-20/screen-0-1440.png) | Catálogo/carrito reales. [Efectivo completado](../../artifacts/local-audit/2026-10-20/cash-completed.png), [transferencia confirmada](../../artifacts/local-audit/2026-10-20/transfer-confirmed.png), [maximizada](../../artifacts/local-audit/2026-10-20/sales-maximized.png) |
| Fiscal | [screen-1-1440.png](../../artifacts/local-audit/2026-10-20/screen-1-1440.png) | [Bloqueo real](../../artifacts/local-audit/2026-10-20/fiscal-blocked.png): `PAYLOAD_ASSEMBLY_BLOCKED` / `LINE_FISCAL_ATTRIBUTE_MISSING` |
| Clientes | [screen-2-1440.png](../../artifacts/local-audit/2026-10-20/screen-2-1440.png) | Alta y lectura de adquiriente de prueba. Formulario largo con códigos DIAN técnicos |
| Comprobantes | [screen-3-1440.png](../../artifacts/local-audit/2026-10-20/screen-3-1440.png) | [Recibo encontrado](../../artifacts/local-audit/2026-10-20/receipt-found.png); también estados no encontrado/no cobrado. No prueba impresión física |
| Catálogo | [screen-4-1440.png](../../artifacts/local-audit/2026-10-20/screen-4-1440.png) | Alta real. Campos sin separación consistente y placeholders truncados |
| Inventario | [screen-5-1440.png](../../artifacts/local-audit/2026-10-20/screen-5-1440.png) | Entrada y ajuste reales. IDs/códigos técnicos y resultados como `POSTED5.000000` sin separación visual |
| Dashboard | [screen-6-1440.png](../../artifacts/local-audit/2026-10-20/screen-6-1440.png) | Tras actualizar muestra **3** existencias controladas; ventas/caja muestran `Sin permiso`. Se inspeccionaron Resumen/Seguimiento/Seguridad |
| Auditoría | [screen-7-1440.png](../../artifacts/local-audit/2026-10-20/screen-7-1440.png) | **26 eventos** locales tras actualizar; [Seguimiento reducido](../../artifacts/local-audit/2026-10-20/screen-7-monitoring-1024.png). Las columnas se superponen/truncan; se inspeccionaron las tres pestañas |
| Administración de usuarios/roles/empresa/configuración y plataforma superadmin | **INACCESIBLES** | `requiredPermissions: []` y `hasAny` en `App.tsx` las excluyen. Existen definiciones de navegación, no flujos de administración ejecutables. No se fabricaron capturas |

Observaciones visuales: logo oficial conservado y legible; jerarquía de caja más desarrollada que los formularios secundarios; bastante espacio vacío en fiscal/recibos; inputs basados en UUID/códigos en lugar de selección comercial; mensajes fiscales en JSON sin explicación; cifras monetarias con seis decimales; sidebar con scroll independiente en ventana reducida; etiqueta «próximamente» de poco contraste en elementos seleccionados. No se midieron ratios WCAG ni se certifica accesibilidad. No hubo modal comercial en los recorridos ejecutados. No se alteró el diseño durante esta auditoría.

`screens.json` registra viewport, scroll, botones deshabilitados y alertas de cada pantalla. En los resúmenes capturados no hubo overflow horizontal del documento; esto **no excluye** el defecto interno de la tabla de auditoría. Se observaron **0 errores** de consola renderer/pageerror desde la conexión del observador. Los logs contienen advertencias Node de `NO_COLOR`/`FORCE_COLOR`; no se confundieron con fallos de pruebas. No se afirma ausencia de errores previos a instalar ese observador.

## C. Estado funcional

La columna E2E refiere exclusivamente al entorno temporal; no promueve el tablero histórico ni acredita producción.

| Módulo | Estado observado | Límite |
|---|---|---|
| PostgreSQL local | FUNCIONA | Contenedor saludable/ready 16.14. No se certificó esquema persistente de login ni RLS de producción |
| SQLite/WAL y migraciones locales | FUNCIONA en arnés | Abre y soporta efectos comerciales; no se abrió una instalación de negocio |
| Servicio y canal seguro Windows | FUNCIONA en arnés / BLOQUEADO en instalación | Main runtime, DPAPI, named pipe y handshake probados con configuración de test |
| Caja / ventas / efectivo | FUNCIONA en E2E aislado | Apertura, dos rutas de selección, venta, cobro, recibo y cierre observados |
| Transferencia manual | FUNCIONA en E2E tras corrección | Reportar no cobra; confirmar con permiso/versión completa la venta. No movimiento bancario real |
| Catálogo | FUNCIONA en E2E | Alta, búsqueda y precio. No se afirma administración completa de variantes/precios |
| Inventario | FUNCIONA en E2E | Recibir 40, ajustar merma 3, consultar 37; ventas reducen existencias |
| Clientes | FUNCIONA en E2E | Alta, buscar por documento, consultar por ID. No gestión integral de CRM |
| Recibo | PARCIAL | Lectura y presentación reales; impresión/hardware no ejecutados |
| Fiscal / FACTUS | BLOQUEADO | Producto sin atributos fiscales; tampoco configuración/credenciales productivas disponibles. No llamada a FACTUS |
| Dashboard | PARCIAL | Inventario real; agregados de ventas/caja carecen de grants canónicos, no se inventaron |
| Auditoría local | FUNCIONA en alcance leído | 26 eventos consultados por handler real; tres negativas de autorización aprobadas. No auditoría central global certificada |
| Login y MFA comercial | NO IMPLEMENTADO de extremo a extremo | Primitivas existentes sin resolvedor de persona/sesión ni endpoint integrado |
| Administración / plataforma | NO IMPLEMENTADO como flujo completo | Navegación reservada/inaccesible, sin contratos/handlers/grants completos |
| Sync central | BLOQUEADO | Sin `POS_CENTRAL_BASE_URL`, credencial enrolada ni autoridad configurada; contenedores centrales históricos estaban detenidos |
| Balanza/tarjeta/QR integrado/crédito | BLOQUEADO | Adapter/contrato/decisión pendientes; no se habilitaron botones artificialmente |

## D. Login, roles y autenticación

Se contrastó `UC-AUTH-001`, DEC-015/016, backlog y código actual. `apps/central-authority/src/main.ts` continúa exponiendo únicamente `/health`, `/v1/session-trust` y `/v1/device-enrollment`. No hay endpoint de contraseña/MFA/login comercial/refresh/entrega SSA.

| Pieza existente | Ubicación y situación |
|---|---|
| Argon2id | `apps/central-authority/src/platform-password-verifier.ts`; PHC/perfiles/verificación implementados. Política productiva debe seleccionarse explícitamente. `argon2` sigue en devDependencies |
| MFA/WebAuthn | Verificadores y wrappers `platform-webauthn-*`, repositorios de challenge/material/transacción existentes. No equivalen a un servicio de login ni a enrolamiento público seguro; `@simplewebauthn/server` sigue en devDependencies |
| Identidad y sesiones PostgreSQL | Repositorios `platform-administration-session-repository.ts`, `business-session-ssa-eligibility-repository.ts`. Elegibilidad comprueba estado, tenant/membership/dispositivo/MFA/vigencia, pero no autentica contraseña ni prueba posesión por sí sola |
| Dispositivo | `packages/device-trust`, endpoint de enrolamiento y verificador de posesión existentes. No se encontró configuración legítima para esta instalación; no se inscribió un dispositivo ficticio |
| SSA y Ed25519 | `central-session-assertion-issuer.ts` y `session-trust-key-issuer.ts`: primitivas internas. El propio contrato exige `ResolveAuthenticatedSessionAssertion` de confianza; no existe cableado productivo al main |
| Secuencia durable | `PostgresBusinessSsaSequenceAllocator.reserveForVerifiedProof`, migración 011; ya existe. No se rehízo. Debe recibir sesión y prueba de dispositivo realmente verificadas, no IDs del renderer |
| Activación/recuperación local | `session.activate` / `session.recover`, verificador SSA y registry por conexión. Activación en E2E, recuperación/reinicio/revocación en prueba main-runtime aprobados; exclusivamente claves de test |
| Snapshot/RBAC | Permisos efectivos llegan del backend y config confiable; prueba sin sesión muestra acceso denegado. Auditoría rechaza falta de permiso y tenant ajeno. No se cambió la política ni se concedieron roles |
| Revocación | Main-runtime prueba revocación del trust y rechazo posterior; no acredita revocación de usuario desde una administración central inexistente |

**Cajero, supervisor, administrador del negocio, propietario y superadministrador: ninguno autenticado realmente.** El fixture de todos los permisos no se presenta como ninguno de esos roles.

La integración pendiente necesita un resolvedor real de credenciales/sesión revocable y posesión de dispositivo, MFA durable, políticas de KDF/RP/origin/TTL/rate limit, claves operacionales certificadas, aprovisionamiento legítimo, emisión/transporte SSA y snapshot confiable, y superficie de login. Conectar directamente los callbacks de prueba, aceptar UUIDs o `mfa_status` del cliente no satisface `UC-AUTH-001`; no se implementó ese atajo.

## E. Correcciones y pruebas

| Archivo | Defecto demostrado y corrección |
|---|---|
| `renderer/src/components/SalePanel.tsx` | **Defecto de producto:** pending/confirmar/cancelar comparaban `REPORTED`, ausente del lifecycle V1. `payment.get` devuelve `CREATED`, y SQLite solo confirma/cancela desde `CREATED` (DEC-016 §4). Se corrigieron tres comparaciones. Se conservan busy, permisos, estado y expected_version |
| `tests/renderer/SalePanel.test.tsx` | Fixture esperaba el estado inventado. Se alineó con `CREATED`. Antes del arreglo de producto: **9 fallidas / 25 aprobadas**. Después: **34/34 aprobadas** |
| `e2e/real-channel.spec.ts` | Shim Unix `tsx` producía ENOENT en Windows; ahora Node ejecuta `tsx/cli`. El secreto Windows usa DPAPI temporal. Cierre ordenado IPC espera terminación antes de eliminar SQLite (antes EBUSY). Se actualizaron navegación e ID de venta de acuerdo con UI existente; recarga tras activar SSA porque capabilities se carga al montar. Capturas/observaciones opcionales |
| `e2e/real-channel-entry.mjs`, `package.json` desktop | Importar `start.bundle.mjs` ejecutaba la entrada productiva y exigía aprovisionamiento real dentro del test. Se conserva ese bundle para producción y se emite `channel-start.bundle.mjs` desde `src/start.ts` como biblioteca sin autoejecución |
| `e2e-host/real-service-host.ts` | `PermissionCode` era type-only: import runtime fallaba. Usa `CanonicalPermission`. En Windows reutiliza el componente de canal real, que atiende runtime.status; el router incompleto anterior enviaba esa solicitud al handler comercial y cerraba el socket. Reutiliza componentes reales DB/sync/operaciones y cierre IPC de test |
| `apps/pos-local-service/tsconfig.json` | Incluye el host E2E en el typecheck para detectar futuras importaciones runtime de tipos |

Registro de ejecución (logs completos en `artifacts/local-audit/2026-10-20/logs/`):

| Comando | Resultado realmente observado |
|---|---|
| Desktop `typecheck` y `build`, inicial y tras cambio aplicable | Exit **0**; TypeScript main/renderer, bundle, preload CJS y renderer Vite construidos |
| Servicio `typecheck` incluyendo `e2e-host` | Exit **0** |
| `pnpm --filter @pos-platform/pos-local-service test -- tests/channel.test.ts tests/channel-commercial-vertical.test.ts tests/channel-commercial-transport.test.ts` | **3 archivos / 39 pruebas PASS, 0 omitidas**, exit **0**; incluye DACL Windows, replay, framing, cola, SQLite comercial, idempotencia y tenant ajeno |
| `pnpm --filter @pos-platform/pos-desktop test -- tests/renderer/SalePanel.test.tsx` | **34/34 PASS**, exit **0**, después de reproducir los 9 fallos con fixture canónico |
| `pnpm --filter @pos-platform/pos-desktop test:e2e -- real-channel.spec.ts --max-failures=1` con directorio de auditoría | Ejecución final **4/4 PASS**, **23.4 s**, exit **0**, capturas, pestañas e inspección de seguridad reales |
| `pnpm --filter @pos-platform/pos-local-service test -- tests/session-bootstrap-main-runtime.test.ts tests/audit-read-authorization.test.ts` | **4/4 PASS**, exit **0**: un caso main-runtime y tres casos de autorización de lectura de auditoría |
| `git diff --check` | Exit **0** |

Se conservan también fallos iniciales: ENOENT, export type-only, bundle autoejecutable, canal cerrado, EBUSY, selector `sale-id` antiguo y transferencia bloqueada por `REPORTED`. La inspección de seguridad aprobó en runtime, pero su primer typecheck detectó que Electron omite `getLastWebPreferences` de los tipos públicos; el arnés describe ahora el subconjunto observado, sin cambiar la llamada en runtime. Su salida fallida se conserva separada. Los intentos incompletos no se cuentan como PASS. No se reejecutaron los bloques centrales históricos cerrados ni el conjunto completo de 161 pruebas desktop. No se ejecutaron CI remoto ni gates de integración.

### Causas de botones deshabilitados

[Inventario exhaustivo de 42 condiciones, con archivo y línea](../../artifacts/local-audit/2026-10-20/button-conditions.md), generado con el parser TypeScript a partir del árbol auditado. Es análisis estático complementario; [screens.json](../../artifacts/local-audit/2026-10-20/screens.json) identifica qué botones se observaron realmente en cada captura.

| Botón / grupo | Condición exacta relevante y causa |
|---|---|
| Abrir turno | `sale.busy || !CASH_SHIFT_OPEN || registerId.trim() === ""`: inicialmente falta caja. Cerrar exige permiso, counted no vacío y no busy |
| Buscar por barras | `sale.busy || !CATALOG_PRODUCT_READ || barcode.trim() === ""`: inicialmente dato obligatorio vacío |
| Tarjeta de producto / agregar / quitar | `sale.busy || sale.unresolved || sale.sale !== null` (agregar también precio nulo): al final hay venta persistida, carrito congelado |
| Continuar al cobro | `busy || !SALES_SALE_CREATE || lines.length === 0 || sale !== null`: inicialmente carrito vacío, al final venta ya creada |
| Efectivo / transferencia finalizados | `busy || completed || !permiso`; transferencia además restringe otro pago no terminado. Se deshabilitan al completar la venta. No es ausencia de backend |
| Confirmar/cancelar transferencia | `busy`, permiso específico, versión nula o `status !== "CREATED"`; confirmar también `completed`. Antes del arreglo la comparación `REPORTED` bloqueaba una transferencia legítimamente creada |
| Consultar transferencia | `busy || paymentId.trim() === ""`: ID no diligenciado |
| Leer balanza | `disabled` constante, `SalePanel.tsx`: falta adapter real de Hardware Service |
| Tarjeta / QR integrado / fiado-crédito | `disabled` constante, `SalePanel.tsx`: contrato integrado pendiente; crédito además depende de decisión vigente. No pagos reales habilitados |
| Dar de alta producto | `catalog.busy || !CATALOG_PRODUCT_REGISTER || incomplete`; incomplete = code/name/presentationName/price vacíos. En la captura inicial faltaban esos datos |
| Recibir/ajustar/consultar inventario | busy, permiso específico, target vacío; recibir/ajustar también quantity vacía. En captura inicial faltaban presentación/cantidad |
| Registrar cliente | `directory.busy || !CUSTOMERS_CUSTOMER_REGISTER || incomplete`; documento/identificación/organización/tributo requeridos |
| Buscar cliente / consultar por ID | busy o permiso lectura, identificación/documento o ID vacíos respectivamente |
| Suscribirse cliente | busy, permiso registro, customer_id nulo o email nulo; el cliente de prueba no tenía email. No es falta de backend |
| Emitir identificado / anónimo | busy o saleId vacío; identificado además customerId vacío. Tras diligenciar, handler responde bloqueo fiscal, sin habilitación artificial |
| Ver recibo | `receipt.busy || saleId.trim() === ""`: inicialmente sin ID; después consulta real |
| Cargar más auditoría | `!audit.hasMore || audit.busy`: los 26 eventos caben en la primera página, no hay otra página |
| Actualizar métricas/auditoría | solo busy durante solicitud; su lectura requiere la autorización backend vigente |
| Acciones planned de administración | `disabled` constante en `App.tsx`, pero sus superficies con permisos vacíos **no son accesibles**. No se observaron ni se presentaron como botones operativos |
| Herramientas técnicas cerradas | `OperationPanel.tsx` exige no busy y operationId/idempotencyKey; confirmar además operationType. No se ejecutó `operation.confirm`: sigue pendiente su diseño de autorización de usuario en backlog |

Los guardas UI no sustituyen autenticación/autorización: el servicio vuelve a comprobar sesión, snapshot, scope y permiso. Las negativas observadas no acreditan el conjunto completo de RBAC de todos los módulos.

## F. Pendientes priorizados

1. Recuperar/aprovisionar legítimamente configuración del dispositivo y negocio; configurar confianza central, credenciales enroladas y directorio de datos. Sin esto el launcher falla antes de SQLite.
2. Completar sobre las primitivas existentes el servicio central de autenticación/MFA/sesión/refresh y resolvedor confiable; resolver políticas de seguridad pendientes. Después emitir SSA/snapshot certificados y validar los cinco roles con identidades reales autorizadas. No duplicar tablas ni saltarse controles.
3. Validar el lanzamiento integrado del launcher con esa instalación y login, incluyendo sync/autoridad real. La aprobación de los arneses no certifica ese camino.
4. Completar los atributos fiscales y su ruta autorizada existentes, adquiriente genérico/verificaciones pendientes y configuración FACTUS sandbox; ejecutar solo sandbox cuando haya credenciales válidas.
5. Materializar los contratos/grants pendientes de administración, métricas de ventas/caja y plataforma según sus owners. Conservar fuera de navegación lo que no está implementado.
6. Atender defectos visuales demostrados, empezando por auditoría y formularios técnicos, conservando identidad oficial; después hardware/impresión/canales de pago mediante adapters autorizados.
7. Conservar SHA/diff y evidencia, revisión y CI del futuro HEAD exacto antes de cualquier integración en main. Esta auditoría no autoriza merge.

## G. Reapertura reproducible

**No existe todavía un procedimiento que abra un POS comercial autenticado con la configuración disponible.** Para reproducir lo que sí funciona en aislamiento, desde la raíz y en una PowerShell nueva:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @pos-platform/pos-desktop build
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
$env:POS_E2E_AUDIT_DIRECTORY = Join-Path (Get-Location) 'artifacts\local-audit\reopen'
pnpm --filter @pos-platform/pos-desktop test:e2e -- real-channel.spec.ts --max-failures=1
if ($LASTEXITCODE -ne 0) { throw 'Real-channel E2E failed; inspect its output' }
Remove-Item Env:POS_E2E_AUDIT_DIRECTORY
```

Esto abre Electron real, ejecuta las cuatro pruebas con SQLite temporal, guarda capturas y cierra el entorno. **No crea una cuenta, no permite login humano ni deja una instalación utilizable.** `ELECTRON_RUN_AS_NODE` estaba heredada en el entorno de esta sesión; se retiró solamente en procesos hijos para lanzar Electron como aplicación.

Cuando haya aprovisionamiento real, volver a usar el procedimiento existente `tools/local/README.md`: primero `-CheckOnly`, y únicamente si los datos son consistentes, launcher integrado. No reutilizar los IDs/SSA de estos arneses.

Los hashes de los archivos de código modificados y el diff local están en `source-hashes.json` y `changes.patch` de la evidencia local. Los artefactos no contienen claves privadas, secretos DPAPI, tokens ni credenciales FACTUS reales.
