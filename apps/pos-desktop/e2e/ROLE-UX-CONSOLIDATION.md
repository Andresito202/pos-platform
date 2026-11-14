# Consolidación visual/funcional por roles — evidencia

> **Revisión visual NO certificada para producción.** No certifica login
> BUSINESS/SSA/SAS, capacidad comercial Central ni readiness operativo.

**Base:** `cursor/commercial-design-review-0d11`  
**PR:** #106 — consolidación hacia `main`, pendiente de integración  
**Alcance actual:** separación de Caja y supervisión en permisos locales y navegación, revisión de transferencias conectada al hook existente y limpieza de controles no operativos.  
**No tocado:** licenciamiento, autenticación comercial BUSINESS/SSA/SAS, reglas de negocio, keys.

## Matriz real de permisos locales (backend)

Fuente: `apps/pos-local-service/src/security/local-operator-development-bridge.ts`  
Los permisos del servicio autorizan. El rol local limita y ordena las pantallas ya autorizadas; no concede permisos. La sesión comercial sin rol local conserva sus capacidades firmadas y requiere revisión específica de sus asignaciones en Central.

| Permiso | CAJERO | SUPERVISOR | ADMINISTRADOR | SUPERADMINISTRADOR |
| --- | --- | --- | --- | --- |
| CASH_SHIFT_OPEN / CLOSE | sí | no | no | no |
| SALES_SALE_CREATE | sí | no | no | no |
| SALES_RECEIPT_READ | sí | sí | sí | no |
| PAYMENTS_PAYMENT_REGISTER | sí | no | no | no |
| PAYMENTS_PAYMENT_READ | sí | sí | sí | no |
| PAYMENTS_TRANSFER_REPORT | sí | no | no | no |
| PAYMENTS_TRANSFER_CONFIRM / PAYMENTS_PAYMENT_CANCEL | no | sí | sí | no |
| CATALOG_PRODUCT_READ | sí | sí | sí | no |
| CATALOG_PRODUCT_REGISTER | no | no | sí | no |
| CUSTOMERS_CUSTOMER_READ | sí | sí | sí | no |
| CUSTOMERS_CUSTOMER_REGISTER | no | no | sí | no |
| INVENTORY_STOCK_READ | no | sí | sí | no |
| INVENTORY_STOCK_RECEIVE / ADJUST | no | no | sí | no |
| AUDIT_EVENT_READ | no | no | sí | sí |
| FISCAL_DOCUMENT_ISSUE | no | no | no | no |
| LICENSE_PLAN_MANAGE | no | no | no | no |
| HARDWARE_READ | no | no | no | no |

### Inicio visual (si el permiso correspondiente existe)

| Rol | Pantalla inicial | Notas |
| --- | --- | --- |
| CAJERO | Caja y ventas | Sin Dashboard ni Inventario administrativo |
| SUPERVISOR | Inventario | Sin Caja ni carrito; revisión de transferencias separada |
| ADMINISTRADOR | Dashboard | Sin Caja ni carrito; conserva revisión y control |
| SUPERADMINISTRADOR | Dashboard / Auditoría | Sólo superficies con `AUDIT_EVENT_READ`; sin simular licencias/empresas |

Logout o cambio de usuario: `activeScreen` + `visitedScreens` se restablecen.

## Archivos recuperados / integrados

| Origen | Qué se tomó |
| --- | --- |
| `feat/caja-denominaciones-20261104` | CSS de denominaciones, payment-method layout, cash summary |
| `feat/brand-camacho-pos-2026-11-04` | `camacho-pos-colombia-login.png`, symbol/apilado/android, `login-waves.svg`, entrada branded |
| Árbol actual design-review | SalePanel funcional, logos Nequi/Daviplata en `public/payment-denominations/logos/`, billetes/monedas |
| Worktree `pos-platform-caja` | No accesible en este entorno Linux |

No se fusionaron ramas completas. No se sustituyeron componentes funcionales por placeholders.

## Correcciones de Caja / cobro

- Precios/payable/coberturas en COP humano (`$3.500`); exacto en `data-amount` y payloads backend.
- Cantidad por `unit_precision` de la presentación (`defaultQuantityInput` / display).
- Imágenes de billetes/monedas con `object-fit: contain`.
- Logos Nequi y Daviplata visibles en bloque de transferencia manual (no habilitan QR/tarjeta/crédito).
- CSP: `img-src 'self' data:` (sin debilitar script/default).
- Caja design-review: `POS_DESIGN_REVIEW_REGISTER_ID` → preload `posDesktopHints` → prefills el input (sin IPC nuevo de permisos).
- Se retiraron de Caja los botones reservados para tarjeta, QR integrado y crédito, y el botón siempre deshabilitado de balanza. No se eliminó ningún adapter de hardware ni método conectado.

## Catálogo / imágenes

- No hay fotografías de producto verificadas en las ramas auditadas.
- `ProductAvatar` permanece como fallback simbólico profesional (sin fingir foto real).

## Resultados históricos de pruebas (Linux agente; anteriores a esta corrección)

| Prueba | Resultado observado |
| --- | --- |
| `pnpm --filter @pos-platform/pos-desktop typecheck` | PASS |
| `pnpm --filter @pos-platform/pos-desktop build` | PASS (login PNG empaquetado; CSP con img-src) |
| `pnpm --filter @pos-platform/pos-desktop test` | **264 PASS / 0 FAIL** |
| Restricciones locales (`local-operator-authorization.test.ts`) | Ejecutar en este entorno junto al paquete local-service |
| E2E Windows Electron real | **NO EJECUTADO aquí** (entorno Linux) |
| Capturas 1024 / 1366 / 1920 | **PENDIENTE Windows** |
| CSS responsive breakpoints | Implementados en `commercial-precision.css` (1024 / 1366 / 600) |

### E2E Linux previo (no ocultar)

Documentado en `ROLE-PREVIEW.md`: 6 PASS / 5 SKIP / 5 FAIL (native-custody MODULE_IMPORT; real-channel disconnect/timeouts). Ese estado no se declara resuelto por estas pruebas unitarias.

## Pasos reproducibles (Windows)

```powershell
pnpm install --frozen-lockfile
pnpm --filter @pos-platform/pos-desktop build
pwsh -File tools/operators/open-commercial-design-review.ps1
```

Login local real:

| Usuario | Rol esperado | Inicio esperado |
| --- | --- | --- |
| `cajero.local` | CAJERO | Caja y ventas |
| `supervisor.local` | SUPERVISOR | Inventario |
| `admin.local` | ADMINISTRADOR | Dashboard |
| `superadmin.local` | SUPERADMINISTRADOR | Dashboard / Auditoría |

Tras login, el launcher imprime `DESIGN_REVIEW_REGISTER_ID`; Electron también lo precarga si `POS_DESIGN_REVIEW_REGISTER_ID` está en el proceso.

## Errores / pendientes

1. E2E Electron Windows + capturas por rol y anchos 1024/1366/1920: pendientes en Windows. El checkout del PC no se ha inspeccionado; no se presupone un directorio `pos-platform-design-review`. El script actual usa el repositorio desde el que se invoca y `%LOCALAPPDATA%\CamachoPOS\design-review-runtime` para los datos aislados.
2. Fallos E2E Linux previos de canal/custody: siguen abiertos; no certificados como PASS.
3. Sin imágenes fotográficas de catálogo verificadas: fallback simbólico a propósito.
4. Superadministrador local **no** gestiona licencias/empresas (correcto: no hay permiso ni superficie simulada).
5. Commit/push: **retenidos** hasta verificación explícita de este paquete de cambios.

## Criterio final

No basta «Servicio local: conectado». En Windows debe verse:

1. Identidad Camacho (logo login + marca lateral).
2. Denominaciones COP con imágenes contenidas.
3. Logos Nequi/Daviplata en transferencia manual.
4. Navegación inicial distinta por rol, autorizada sólo por permisos backend.
5. Flujo real caja → carrito → cobro (sin confirmaciones simuladas).


## Corrección de separación de roles — 2026-11-10

Base remota: `8d929231f7689465760de1d6b7c1d84d9234d045`. Cambio en la misma rama, sin crear otra.

- Causa: SUPERVISOR heredaba todos los permisos de CAJERO y ADMINISTRADOR heredaba SUPERVISOR; App abría SalePanel incluso con permisos de consulta/confirmación de pagos. La navegación sólo ordenaba pantallas.
- Corrección: capacidades locales de supervisión explícitas; Caja exige SALES_SALE_CREATE; las pantallas locales se limitan por rol. Se espera la consulta inicial de identidad antes de montar áreas operativas.
- TransferReviewPanel reutiliza useCommercialSale, payment.get, payment.transfer.confirm y payment.cancel. No duplica casos de uso ni crea otro POS. Conserva expected_version, idempotencia y resolución de resultados inciertos del hook existente.
- La consulta todavía requiere la referencia técnica del pago. No se ha implementado una bandeja de pendientes ni una notificación bancaria. El importe mostrado se etiqueta como reportado, no recibido.
- La limpieza textual y de controles no constituye un rediseño comercial terminado.

### Pruebas observadas en esta sesión

Se reprodujo antes de corregir: 1 fallo de navegación de administrador y 2 fallos de permisos supervisor/administrador. Después:

| Comando desde paquete correspondiente | Resultado |
|---|---|
| `vitest run --config vitest.config.ts` (desktop) | 31 archivos, 273 pruebas PASS, exit 0 |
| `vitest run src/commercial/local-operator-authorization.test.ts src/security/local-operator-session-registry.test.ts src/security/local-operator-password.test.ts src/security/local-operator-password-gate.test.ts` (local-service) | 4 archivos, 19 pruebas PASS, exit 0 |
| `tsc -p tsconfig.renderer.json` (desktop) | PASS, exit 0 |
| `tsc -p tsconfig.json` (local-service) | PASS, exit 0 |
| `vite build` (desktop) | Renderer compilado, exit 0; no equivale al build completo de Electron |

Incluye petición directa sale.create: el handler y CreateSaleUseCase reales rechazan supervisor, administrador y superadministrador antes de acceder a los stores. Incluye consulta/confirmación/cancelación de transferencia y versión del backend sin crear una venta desde supervisión.

Entorno de validación: snapshot de fuentes remotas y dependencias disponibles en caché, con Vitest 4.1.11 y Vite 6.4.3 (el repositorio declara 4.1.12 y 6.4.5). No se ejecutó una instalación limpia con frozen-lockfile; no se modificó lockfile para disimularlo.

Intento visual Chromium/Playwright: BLOQUEADO al iniciar navegador, process_singleton_posix socket() Operation not permitted. No hay capturas validadas, ni PASS responsive, ni E2E Windows de este incremento. No se retiraron los controles SCM ni se certificó BUSINESS.


## Ajuste RBAC del Supervisor — 2026-11-13

El rol local SUPERVISOR conserva consulta de catálogo/clientes/inventario y revisión de pagos, pero deja de recibir CATALOG_PRODUCT_REGISTER, CUSTOMERS_CUSTOMER_REGISTER, INVENTORY_STOCK_RECEIVE e INVENTORY_STOCK_ADJUST. El rol ADMINISTRADOR conserva esos cuatro permisos explícitamente. Cambio en `local-operator-development-bridge.ts` y prueba de regresión en `local-operator-authorization.test.ts`. **Pruebas añadidas, no ejecutadas ni certificadas en esta intervención.** No modifica los grants firmados BUSINESS de Central, que requieren auditoría propia.

## Entrega pendiente a Codex — controversias 1 y 2 (2026-11-13)

**Sin pruebas ejecutadas por GitHub Actions/Windows en estas dos controversias.** La verificación estructural previa de controversia 1 no sustituye Vitest ni un E2E. No hacer merge a `main` por esta documentación.

- [ ] En el HEAD exacto de `cursor/commercial-design-review-0d11`: `pnpm install --frozen-lockfile` con versiones del lockfile; registrar errores si aparecen.
- [ ] Ejecutar `pnpm --filter @pos-platform/pos-local-service exec vitest run src/commercial/local-operator-authorization.test.ts` y `pnpm --filter @pos-platform/pos-local-service run typecheck`; registrar SHA, plataforma, versiones, stdout, exit code. Si scripts o rutas difieren, consultar package.json y reportar sin inventar comandos.
- [ ] Comprobar los cuatro permisos denegados al SUPERVISOR (CATALOG_PRODUCT_REGISTER, CUSTOMERS_CUSTOMER_REGISTER, INVENTORY_STOCK_RECEIVE, INVENTORY_STOCK_ADJUST) **mediante peticiones reales al handler**, no únicamente sobre el arreglo de permisos. Conservar lecturas, confirmación/cancelación de pagos ya autorizadas; comprobar que ADMINISTRADOR mantiene esos cuatro grants locales y que CAJERO puede vender.
- [ ] Validar la correspondencia de los cuatro roles de interfaz con las asignaciones de Central sin cambiar roles existentes por equivalencia textual: plataforma/GLOBAL contra empresa/BUSINESS, límites de OWNER, GENERAL_ADMIN, BRANCH_MANAGER, SUPERVISOR y CASHIER; scopes tenant/company/branch, estado, vencimiento, licencia y revocación. Registrar qué perfiles especializados están realmente aprovisionados. No crear seeds/grants ni claims ficticios.
- [ ] Asegurar que ADMINISTRADOR/SUPERVISOR/SUPERADMINISTRADOR no ejecuten sale.create/turnos/cobros directamente, incluso con IPC forjado y frente al backend comercial. Validar navegación y rechazo backend, no solo botones ocultos.
- [ ] Reconciliar los contratos de operaciones excepcionales (autorizar / ejecutar / solicitar), especialmente devolución, cancelación, cierre y arqueo, con `docs/security/permission-matrix.md`; marcar como pendientes los permisos conceptuales que aún no existen en `packages/contracts/src/permission-codes.ts`.
- [ ] Ejecutar la regresión Electron/Windows y la sesión BUSINESS real **cuando el entorno físico/autorización firmada estén disponibles**; no presentar bridge local como comercial certificado.

**Estado de entrega:** documentación y proyección local modificadas en rama de consolidación, pruebas reales pendientes. No significa controversia 2 certificada ni que el catálogo de roles de Central haya sido migrado.

## Controversia 3 — superadministrador local frente a autoridad GLOBAL (2026-11-13)

**Hallazgo verificado en fuentes de la rama activa:** `local-operator-development-bridge.ts` concede al `SUPERADMINISTRADOR` local únicamente `AUDIT_EVENT_READ`. `local-operator-password.ts` identifica `superadmin.local` como cuenta local de desarrollo, no como sesión GLOBAL. `roleNavigation.ts` restringe su espacio a `dashboard` y `admin-audit`. `App.tsx` monta `AdministrativeControlPanel` para esas superficies. La existencia del código `LICENSE_PLAN_MANAGE` en `packages/contracts/src/permission-codes.ts` **no acredita** un endpoint comercial GLOBAL de venta/emisión ni el aprovisionamiento de grants.

**Decisión de seguridad:** NO asignar `LICENSE_PLAN_MANAGE` a `superadmin.local`, NO convertir una sesión local en GLOBAL, NO construir una pantalla simulada ni reemplazar los controles de Central. Las competencias de `PLATFORM_OWNER` se mantienen en plataforma/GLOBAL según `docs/product/roles.md`, `docs/security/permission-matrix.md` y `UC-LIC-002`. El POS Desktop local no es la consola comercial GLOBAL.

### Entrega de pruebas/verificación para Codex — cuando exista entorno de ejecución

- [ ] Reejecutar las suites focalizadas y typecheck pendientes de controversias 1 y 2 indicadas arriba, registrando HEAD exacto y versiones del lockfile.
- [ ] Con `superadmin.local` autenticado, verificar permisos efectivos: solo `AUDIT_EVENT_READ`; denegar `LICENSE_PLAN_MANAGE`, `SALES_SALE_CREATE`, `CASH_SHIFT_OPEN/CLOSE` y `PAYMENTS_PAYMENT_REGISTER`. Verificar también denegación al enviar IPC forjado contra el handler/caso de uso y aislamiento por conexión/logout.
- [ ] Inspeccionar rutas, controladores, servicios y UI de Central para identificar el endpoint/flujo realmente operativo de alta de empresa, cotización/contratación, cobro, emisión, asignación a dispositivos, renovación, suspensión y revocación de licencia. Clasificar cada etapa con evidencia exacta: DOCUMENTED / IMPLEMENTED / TESTED / END_TO_END / PRODUCTION; marcar inexistente si falta.
- [ ] Probar el actor GLOBAL firmado/validado frente a BUSINESS y sesión local; negar a OWNER/GENERAL_ADMIN/BRANCH_MANAGER/CASHIER la emisión de licencias de otras empresas. Verificar separación tenant/company/license/installation/device, límites y auditoría, sin IDs confiados desde el cliente.
- [ ] Probar contratación de licencias independientes para varias empresas y modalidades: identidad contractual, módulos habilitados, límites por caja y no contaminación entre negocios. No asumir que un plan compartido implica tenant, datos ni licencia compartidos.
- [ ] Probar fallos: sesión GLOBAL expirada/revocada, permisos retirados, pago no confirmado, emisión repetida (idempotencia), activación duplicada, dispositvo no vinculado y errores de sincronización.
- [ ] Registrar que las pruebas Android/Windows físicas y de Central productivo no se consideran cumplidas por tests aislados ni por documentación, y diferenciar los bloques realmente alcanzables de los pendientes.

**Estado:** controversia 3 delimitada y separación local/GLOBAL confirmada por inspección estática; funcionalidad comercial GLOBAL **NO CERTIFICADA**. No se ejecutaron Vitest, Windows E2E, Central ni acciones de licencia en esta intervención. Sin cambios en la autorización ni concesión de permisos.


## Controversia 4 — DesignReview frente al POS original (2026-11-13)

**Auditoría estática de la rama activa; NO es ejecución Windows.**

| Entrada | Código compartido y alcance | Aislamiento / límite |
| --- | --- | --- |
| `tools/local/launch-windows.ps1` | Arranque de Windows previsto para POS real, con verificaciones de aprovisionamiento y canal | No fabrica IDs ni sesiones; preflight `-CheckOnly` no demuestra login BUSINESS ni servicio SCM funcional |
| `tools/operators/start-local-operator-pos.ps1` | Lanza el servicio real y `@pos-platform/pos-desktop start:production` con cuentas locales de desarrollo | `%LOCALAPPDATA%\CamachoPOS\local-operator-runtime`; genera IDs de desarrollo; no es instalación BUSINESS |
| `tools/operators/open-commercial-design-review.ps1` | Envoltorio que invoca el launcher anterior con `-DesignReview` | `%LOCALAPPDATA%\CamachoPOS\design-review-runtime`; catálogo de demostración, licencia de capacidad firmada para laboratorio y caja de prueba; no emisión Central |
| `apps/pos-desktop/src/production-entry.ts` | Entrada de producción empaquetada en `dist/start.bundle.mjs` | Requiere aprovisionamiento de canal. El mismo artefacto Electron no convierte una identidad de laboratorio en negocio real |
| `apps/pos-desktop/renderer/src/App.tsx` | Pantallas comerciales compartidas; no se ha encontrado otro árbol de componentes `SalePanel` para DesignReview en los archivos examinados | La navegación depende de permisos efectivos y del entorno de la sesión |

**Hallazgo:** DesignReview no crea un segundo frontend del POS; es una ejecución aislada del código compartido. Los datos, IDs y provisión de laboratorio pueden hacer que el usuario vea un estado distinto al de una instalación comercial. No se debe retirar su script ni sus datos sin revisar consumidores y pruebas. Ningún registro de GitHub acredita cuál checkout o `dist` se está abriendo realmente en el PC del propietario.

### Pruebas de la controversia 4 para Codex (pendientes)

- [ ] Identificar el checkout y HEAD exactos del PC, rutas de ejecución y `dist/start.bundle.mjs`; anotar fecha/hash de build y verificar `dist/renderer/index.html`. No inferir que una ventana abierta corresponde al HEAD remoto.
- [ ] Verificar en Windows que ambos scripts de desarrollo utilizan el **mismo código** `apps/pos-desktop` y `apps/pos-local-service`, pero mantienen distintas rutas de datos; probar que las identidades, catálogo demo, caja y claves de DesignReview no contaminan instalación ni base comercial.
- [ ] Comprobar invocación de `open-commercial-design-review.ps1` → `start-local-operator-pos.ps1 -DesignReview` → `start:production` y el arranque comercial `launch-windows.ps1`, sin alterar controles de canal, SCM o firma.
- [ ] Comprobar que `-SkipBuild` muestra el estado previamente compilado, mientras que el build normal incluye fuente actual; registrar discrepancias, si existen, con hash y ruta.
- [ ] Probar entrada comercial únicamente con provisión válida; sin ella debe fallar cerrado. No convertir `LOCAL_OPERATOR` o `DESIGN_REVIEW` en sesión BUSINESS; verificar permisos por rol y ventas SQLite con datos de prueba aislados.
- [ ] Ejecutar E2E Electron y capturas reales por rol a 1024, 1366 y 1920 px, con servicio real detrás del canal y sin dobles que falsifiquen resultados. Revisar que login, Caja, pagos y cierre provengan del mismo producto.
- [ ] Dejar DesignReview como arnés de QA delimitado, no acceso principal recomendado para el cliente; retirar únicamente duplicados demostrados y con autorización, nunca datos o referencias desconocidos.

**Estado:** confusión de rutas reconciliada documentalmente; no se ejecutaron scripts Windows ni se validó el checkout local. Se conserva el trabajo de pruebas pendiente de controversias 1, 2 y 3 en este mismo documento.

## Controversia 5 — documento histórico de disponibilidad comercial (2026-11-13)

Se corrigió `docs/product/business-readiness.md`: la afirmación de septiembre sobre ausencia completa de la interfaz de Caja ya no debe aplicarse a la rama actual. Se añadió una tabla que distingue el código existente de los faltantes de certificación. **No se eliminaron las afirmaciones históricas ni se declararon sectores completos.**

### Trabajo pendiente de Codex

- [ ] Confirmar HEAD y archivo actual de `App.tsx` / `SalePanel.tsx`; ejecutar build, typecheck y pruebas focalizadas con `pnpm install --frozen-lockfile`; registrar salidas y SHA. No reutilizar resultados de HEAD anteriores como resultados nuevos.
- [ ] Ejecutar E2E real para Cajero: login autorizado → apertura de turno → búsqueda/escaneo de producto → carrito → guardar/recuperar en espera → venta → cobro → comprobante → cierre; comprobar SQLite durable, aislamiento por tenant/company/branch y ausencia de doble efecto por reintentos.
- [ ] Verificar permisos backend de cuatro roles y denegaciones de operaciones forjadas; enlazar con las pruebas pendientes de controversias 1–4. No confundir Bridge LOCAL con sesión BUSINESS.
- [ ] Probar inventario y CSV de existencias por fila con idempotencia, rechazo, reintento incierto y reinicio. No declarar XLSX disponible ni recuperación durable del formulario manual si no existe.
- [ ] Revisar `unit_precision`, peso, tara/balanza y D-14 con adaptador Factus actual; separar exactitud comercial de límites de serialización del proveedor. No inventar una resolución normativa ni redondear cantidades silenciosamente.
- [ ] Contrastar módulos de farmacia/droguería, salsamentaria/avícola y pastelería con `business-types.md`; emitir matriz de operaciones realmente alcanzables y faltantes: lotes, FEFO, vencimientos, transformación, recetas, habilitación sectorial firmada, Windows/Android/hardware.
- [ ] Revalidar con código y pruebas cualquier fila de readiness que se vaya a promover a `TESTED`, `END_TO_END` o `PRODUCTION`; no confundir integración parcial y producto terminado.

**Estado:** contradicción temporal/documental corregida; pruebas funcionales de controversia 5 y de 1–4 pendientes de ejecución por Codex. No se cambió el runtime ni se fusionó `main`.

## Controversia 6 — transferencias y notificaciones Nequi/Bre-B (2026-11-13)

**Auditoría de código publicada en esta rama, sin ejecución bancaria/Windows.**

**Estado de la rama activa:**
- `TransferReviewPanel.tsx` reutiliza `useCommercialSale` y muestra `expectedAmount` como **importe reportado**, nunca como abono bancario observado. La consulta requiere `payment_id`; no hay bandeja de pendientes automática en este panel.
- `ConfirmTransferPaymentUseCase` autoriza `PAYMENTS_TRANSFER_CONFIRM` por actor y ámbito, y pasa `paymentId`/`expectedVersion` al store. La solicitud **no incorpora** por sí misma comprobación bancaria, `confirmed_amount` observado del banco, `external_transaction_id` autenticado, ni pagador verificado. No afirmar que un permiso + clic constituye prueba externa.
- `UC-PAY-003` exige comprobación manual autorizada y distingue monto esperado de recibido; el cumplimiento completo de revisor, evidencia, segregación, duplicados y diferencias requiere trazado de handlers/SQLite y pruebas específicas.

**Trabajo existente NO integrado en la rama activa:**
- `feat/nequi-breb-static-qr-phase1` contiene `merchant-notification-ingest-routes.ts`, `merchant-notification-inbox.ts`, `merchant-notice-feed.ts`, `MerchantPaymentMethods.tsx` y `MerchantPaymentNoticePanel.tsx`, entre otros archivos. Su comparación con la línea activa muestra historia divergente; **NO fusionar ni cherry-pick de rama completa**.
- Su receptor exige prueba Ed25519 DEVICE_TRUST y consentimiento de comercio, deduplica observaciones y expone avisos `UNVERIFIED`, `bank_confirmed:false`, `sale_confirmed:false`. Un teléfono autorizado a reenviar una notificación **no** constituye confirmación del banco.
- El feed examinado consulta Central cada 5 segundos y el renderer cada 5 segundos cuando está visible: esto es sondeo (*near-real-time*), no push bancario ni garantía de entrega instantánea. El importe `reported_amount_cop` es **informado**, no monto abonado acreditado. `payer_display` puede ser `null`.
- `docs/architecture/qr-payment-real-time.md` describe la arquitectura objetivo y sus contratos; no convierte esa rama divergente en runtime certificado de producción.

**Contrato funcional vinculante para Caja:**
1. Mostrar separadamente **solicitado**, **informado/observado no verificado** y **confirmado**, con fuente, hora y estado explícitos. Nunca completar venta ni sonar notificación de cobro por SMS, captura, QR estático o importe coincidente.
2. Presentar pagador/referencia solo cuando la fuente los incluya; no inventar nombre o número. No asociar automáticamente una notificación de igual valor a una venta entre varias cajas; ante múltiples pendientes, `AMBIGUOUS` exige revisión.
3. `payment.transfer.confirm` manual queda en su flujo actual, bajo autorización y comprobación financiera humana fuera del POS; no reutilizarlo como webhook bancario. La confirmación automática requiere una fuente financiera autenticada, correlación inequívoca y un caso de uso central/local autorizado, no un botón.
4. Diferencias: si se solicitan COP 50.000 y se observan COP 45.000, no registrar COP 50.000 como recibidos. Ante sobrepago o parcial, exigir política y flujo de asignación/conciliación, sin deducir saldo desde el texto de un SMS.
5. Conservar alcance por tenant/empresa/sucursal, cuenta/QR de destino administrados, antirrepetición, deduplicación, idempotencia, auditabilidad, expiración y modo offline. **Sin conexión no hay aviso de banco en vivo** y una venta offline no debe inventar pago confirmado.
6. Conectar selectivamente los componentes existentes a owners reales después de comparar contratos/archivos y validar dependencias; no abrir otro POS ni reemplazar `SalePanel` completo. No inventar proveedor bancario, API ni tarifas.

### Ejecución pendiente de Codex — controversia 6
- [ ] Auditar diferencias exclusivas de la rama histórica por archivo y dueño antes de integrar: endpoints Central, consentimientos, UI Admin, proyección firmada, feed Local Service, Caja, Android receptor, contratos y migraciones existentes. Publicar tabla `ya está / falta / conflicto / sustituido`.
- [ ] Ejecutar pruebas focalizadas del flujo **manual** contra handlers reales y SQLite: permisos de reportante/confirmador, denegación a Cajero, referencias duplicadas, `expectedVersion`, idempotencia, operación incierta, pago cancelado y aislamiento de empresas.
- [ ] Verificar que `TransferReviewPanel` no trate `expectedAmount` como efectivo recibido ni habilite confirmación por una notificación no verificada; exigir revisión del origen de fondos, referencias y segregación de funciones en los controles aplicables.
- [ ] Para el receptor de avisos, verificar en entorno de pruebas: firma Ed25519, consentimiento revocable, replay, límites de tamaño, RLS, deduplicación, origen de importe/pagador, 4 cajas mismo comercio, empresas cruzadas y aviso `UNVERIFIED` sin mutación de `Payment`/`Sale`. No presentar tests de arnés como señal bancaria real.
- [ ] Probar errores de red, retrasos, actualizaciones repetidas, importes faltantes/inferiores/superiores, dos ventas con mismo valor y dos comercios con cuenta distinta. Comprobar que una notificación histórica no se asocie a una venta posterior.
- [ ] Revisar disponibilidad real de datos verificables del proveedor elegido, con evidencia de integración y consentimiento; si no hay canal oficial, mantener **solo** aviso informativo y confirmación manual, sin afirmar automáticamente `CONFIRMED`.
- [ ] Registrar HEAD exacto, tests ejecutados, exit codes, servicios externos empleados y brechas Windows/Android. Conservar además las pruebas no ejecutadas de controversias 1–5.

**Resultado de esta intervención:** auditoría y contrato de seguridad documentados, sin modificación de Payment/Sale ni importación de otra rama. **NO CERTIFICADO** el ingreso automático, importe real confirmado, identidad del pagador o notificación bancaria instantánea.
