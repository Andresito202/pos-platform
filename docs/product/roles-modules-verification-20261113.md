# Roles y módulos: contraste con implementación

Fecha: 2026-11-13 (America/Bogota). Base inspeccionada:
`e205e09b20ef8fa9123522c42e6f4a9b9dc85797`.
Rama existente: `cursor/commercial-design-review-0d11`; entrega mediante PR #106.

## Contrato funcional autorizado

| Rol | Responsabilidad y módulos objetivo | Exclusiones |
|---|---|---|
| Superadministrador GLOBAL | Empresas, licencias, planes/cobros SaaS, activaciones, modalidades, soporte y auditoría técnica | Sin carrito, cobro de productos ni administración cotidiana del inventario del cliente |
| Administrador del negocio | Catálogo/precios, inventario, compras/proveedores, personal, sucursales, clientes, reportes, pagos, fiscal y licencia propia | Sin carrito/cobro ni autoridad GLOBAL |
| Supervisor | Consulta de ventas/existencias, revisión operativa de cajas, incidencias y autorizaciones expresamente concedidas | Sin carrito/cobro, registro de catálogo/clientes, recepción/ajuste de stock, usuarios ni licencias |
| Cajero | Venta/carrito/cobro integrados, clientes mínimos autorizados, ventas en espera, comprobantes y turno propio | Sin configuración de precios/pagos, stock administrativo, costos globales, usuarios ni licencias |

La empresa delimita datos; la licencia habilita producto/cajas; el permiso autoriza
la operación. Varias cajas de una empresa no implican inventarios separados.
Modalidades sectoriales no conceden permisos automáticamente. La revocación remota
no puede conocerse inmediatamente sin conexión. Autorizaciones excepcionales deben
ligarse a operación/importe/motivo, vencimiento y consumo; no se consideran
implementadas por describirlas aquí.

## Evidencia del árbol y alcance

| Superficie | Evidencia inspeccionada | Resultado y límite |
|---|---|---|
| Navegación | `App.tsx`, `roleNavigation.ts` | Caja exige SALES_SALE_CREATE; los tres roles locales no cajeros excluyen sales. No certifica asignaciones BUSINESS de Central. |
| Supervisor local | `local-operator-development-bridge.ts` | Defecto confirmado: concedía cuatro permisos de escritura administrativa. Corregidos; conserva lectura y revisión de pagos. |
| Administrador local | Mismo mapa y endpoint authorization.capabilities.get | Conserva alta de productos/clientes, entrada/ajuste de stock y auditoría; no obtiene venta ni licencia GLOBAL. |
| Formularios | CatalogPanel, InventoryPanel, CustomerPanel | Antes mostraban edición sin permiso, con botón deshabilitado. Ahora solo se monta la edición autorizada. Consultas conservadas. |
| Backend | CommercialRequestHandler → RegisterProductUseCase / RegisterCustomerUseCase / ReceiveStockUseCase / AdjustStockUseCase | Pruebas con sesión local y payloads validados por schemas: supervisor rechazado antes de tocar almacenamiento. No cruzan socket ni constituyen E2E. |
| Plataforma | platform-entry.tsx, PlatformOfferEditor, PlatformActivations, PlatformLicenseFulfillment, platform-client.ts | Existen superficies GLOBAL para ofertas, emisión/asignación y activaciones. No se ejecutó compra real ni se certifican todos los módulos SaaS enumerados. |
| Dashboard y auditoría | AdministrativeControlPanel, useAdminMetrics, useAdministrativeAudit | Hay consultas conectadas y métricas no disponibles. La existencia del dashboard no acredita utilidades ni reportes comerciales completos. |
| Supervisión completa | App.tsx y TransferReviewPanel | Existe revisión de transferencia; no hay en esta navegación módulos completos independientes de autorizaciones de descuentos/devoluciones, arqueos e incidencias. No se crean botones sin backend. |
| Administración completa | Inventario de componentes y navegación | No se acreditan pantallas completas de compras/proveedores, personal y sucursales. No se deduce ausencia total de dominio/API desde ausencia de pantalla. |
| Clientes del cajero | Mapa local y CustomerPanel | Lectura disponible; registro mínimo sigue pendiente de contrato específico. No se concede registro fiscal/marketing amplio para aparentar cumplimiento. |
| BUSINESS | isolated-authorization-snapshot-issuer.ts | Permisos proceden de asignaciones/grants SQL firmados. Este incremento no cambia emisor, migraciones ni asignaciones productivas. |

Rutas de frontend bajo `apps/pos-desktop/renderer/src/`; backend bajo
`apps/pos-local-service/src/`; emisor bajo `apps/central-authority/src/`.
No se inspeccionaron bases ni instalación Windows del propietario.

## Validación ejecutada

Entorno Linux, Node 24.22.1, pnpm 9.15.0 mediante corepack; instalación
`corepack pnpm install --frozen-lockfile` exit 0. Sin modificación del lockfile.
Vitest 4.1.12, Vite desktop 6.4.5 y TypeScript 6.0.3 declarados.

- Antes del cambio: autorización local 5 FAIL / 13 PASS; formularios 3 FAIL / 27 PASS.
  Cuatro denegaciones alcanzaban stores ausentes por permisos indebidos; la quinta
  verificaba las capacidades concedidas. Los tres fallos UI muestran edición no autorizada.
- Desktop: `corepack pnpm --filter @pos-platform/pos-desktop test`: 37 archivos,
  324 PASS. Incluye altas/entradas existentes para administrador, consultas,
  navegación y formularios de solo lectura.
- Servicio: `corepack pnpm --filter @pos-platform/pos-local-service exec vitest run
  src/commercial/local-operator-authorization.test.ts
  src/security/local-operator-session-registry.test.ts
  src/security/local-operator-password.test.ts
  src/security/local-operator-password-gate.test.ts --maxWorkers 1 --testTimeout 20000`:
  4 archivos, 28 PASS. La prueba preexistente de 40 autenticaciones scrypt agotó
  5000 ms en dos intentos; se amplió únicamente el límite del runner, sin modificar
  algoritmo, assertions ni política de bloqueo. Ejecución final: 7.47 s total.
- Typecheck de pos-local-service: exit 0. La afirmación inicial de éxito del
  typecheck desktop fue prematura: terminó con dos errores en
  platform-fulfillment.test.tsx (fixture sin idempotent y lectura de unknown).
  Se conserva este fallo; la resolución y reejecución se registran en la
  validación del 2026-11-14.
- Build: build:main, build:entry, build:preload y build:renderer, cada script con
  corepack pnpm: exit 0. El comando compuesto inicial invocaba pnpm global 11
  desde sus subcomandos y falló; la ejecución explícita usa pnpm 9.15.0.
- Arquitectura: 16 PASS y ARCH-003 PASS, ejecutando directamente los dos comandos
  declarados por el target. Nx inicialmente no pudo abrir sockets en este entorno.
- No E2E Electron/Windows, revisión visual real, despliegue, CI remoto, operación
  comercial offline ni certificación de modalidades en este incremento.

## Continuidad pendiente

Aplicar la especificación a asignaciones BUSINESS exige revisar los grants y su
emisión en Central con scope real; no reemplazarla por el puente local. Las
funciones objetivo ausentes se integran en sus owners existentes y requieren
pruebas de autorización, aislamiento, persistencia e interfaz antes de declararse
terminadas. No se declara cierre integral de roles ni de farmacia/salsamentaria/
pastelería con este cambio.
