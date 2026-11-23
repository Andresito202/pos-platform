# Preparación visual para Reporting administrativo

Documento de preparación (fase visual). **No implementa Reporting.**
Referencia de backlog: `REP-001` / `REP-002` / `REP-003` en `docs/product/backlog.md`.

## Principios

- Reporting no es fuente de verdad (`docs/architecture/data-ownership.md`).
- La UI no consulta tablas directamente desde React.
- `null` ≠ `0`: ausencia de autorización o de publicación del agregado no se muestra como venta cero.
- SUPERADMINISTRADOR local ≠ autoridad GLOBAL ≠ ADMINISTRADOR BUSINESS.
- La interfaz comercial usa mensajes para comerciantes; este documento conserva la jerga técnica (contratos, IPC, permisos agregados, REP-001).

## Estado REP-001 fase 1 (backend)

| Capacidad | Estado | Nota |
|---|---|---|
| Permisos `REPORTING_SALES_AGGREGATE_READ`, `REPORTING_CASH_AGGREGATE_READ`, `REPORTING_PAYMENTS_AGGREGATE_READ` | MATERIALIZED en `permission-codes.ts` + enforced en `GetAdminMetricsUseCase` | Central debe concederlos; el bridge local de desarrollo **no** los otorga |
| `readSales` / `readCash` | Habilitados cuando el permiso agregado está en el snapshot | Scope `tenant/company/branch` |
| `readPayments` | Habilitado: solo `CONFIRMED`; pendientes de transferencia no son recaudo | scale-6 vía bigint |
| Emisión Central de esos grants | BLOQUEADO / pendiente | Sin fabricar concesiones comerciales en el bridge |
| UI Dashboard mostrando nuevos campos de pagos | Pendiente fase 2 | Contrato ya compatible (`null` por defecto) |

## Estado actual de superficies

| Rol / superficie | Componente | Backend hoy | Estado UI |
|---|---|---|---|
| Supervisor — transferencias | `TransferReviewPanel` | `payment.get`, `payment.transfer.confirm`, `payment.cancel` | Conectado |
| Administrador — dashboard | `AdministrativeControlPanel` | `admin.metrics.get` | Conectado; ventas/caja/pagos agregados requieren grants REPORTING_* |
| Administrador BUSINESS (browser) | `BusinessCashRegisterPanel` | HTTP Central BUSINESS | Conectado |
| Superadministrador local — auditoría | `LocalAdministrativeAuditPanel` | Sin IPC cableado para `audit.event.list` | Estructura visual; sin filas inventadas |

## Datos ya existentes (almacenes)

### SQLite local (`SqliteAdminMetricsStore`)

| Lectura | Tabla / filtro | Expuesta hoy por `admin.metrics.get` |
|---|---|---|
| Ventas completadas (conteo + importe) | `sales_sales` `status='COMPLETED'` | **No** — el use case devuelve `null` hasta permisos agregados canónicos |
| Existencias controladas | `inventory_stock` count | **Sí** si `INVENTORY_STOCK_READ` |
| Turnos abiertos | `cash_shift` `OPEN`/`CLOSING` | **No** — siempre `null` en el use case actual |

### PostgreSQL Central

| Ámbito | Evidencia existente | Reporting UI |
|---|---|---|
| Cajas BUSINESS | APIs de cash register master | Panel BUSINESS existente |
| Licencias / empresas / dispositivos | Módulos Central / Platform | Fuera del panel local SUPERADMIN |
| Rol `pos_reporting` | Reservado; sin grants de datasets | Diferido |

### Contratos IPC documentados sin cableado desktop

| Mensaje | Uso previsto | Gap |
|---|---|---|
| `audit.event.list` | Lista append-only de auditoría local | No está en IPC/preload del desktop ni handler local en esta línea |
| Agregados Reporting futuros | Ventas del día, métodos de pago, alertas | Sin contrato de producto publicado más allá de `admin.metrics.get` V1 |

## Permisos

| Indicador | Permiso operativo actual | Permiso agregado / Reporting |
|---|---|---|
| Dashboard visible | `AUDIT_EVENT_READ` (+ rol `ADMINISTRADOR` para montar Dashboard) | — |
| Inventario en métricas | `INVENTORY_STOCK_READ` | — |
| Ventas / importe agregados | No reutilizar `SALES_RECEIPT_READ` | `REPORTING_SALES_AGGREGATE_READ` (código materializado; grant Central pendiente) |
| Turnos abiertos agregados | No reutilizar `CASH_SHIFT_OPEN` | `REPORTING_CASH_AGGREGATE_READ` |
| Pagos confirmados / pendientes transferencia | No reutilizar `PAYMENTS_PAYMENT_READ` | `REPORTING_PAYMENTS_AGGREGATE_READ` |
| Confirmar transferencia | `PAYMENTS_TRANSFER_CONFIRM` | — |
| Cancelar pago pendiente | `PAYMENTS_PAYMENT_CANCEL` | — |
| Utilidad estimada | — | Permiso financiero explícito (no inventar) |
| GLOBAL licencias/empresas | Autoridad plataforma | Módulos Central; no heredar desde SUPERADMIN local |

## Endpoints / mensajes necesarios después (sin implementar ahora)

### Supervisor

| Necesidad UI | Fuente candidata | Endpoint / mensaje |
|---|---|---|
| Transferencias pendientes | Payments | Extensión de listado filtrado (hoy: consulta por referencia) |
| Pagos confirmados del día | Payments / Reporting projection | Contrato Reporting de sucursal |
| Operaciones a revisar | Payments + Audit | Listado autorizado por branch |
| Diferencias de caja | Cash shift close facts | Reporting de caja / turno |
| Actividad de sucursal | Reporting read model | `reporting.branch.activity` (nombre tentativo; ADR pendiente) |

### Administrador BUSINESS

| Necesidad UI | Fuente candidata | Endpoint / mensaje |
|---|---|---|
| Ventas del día / total vendido | `sales_sales` / proyección | Ampliar `admin.metrics.get` o `reporting.business.summary` con grants agregados |
| Cobros por método | Payments | Reporting projection |
| Efectivo esperado / turnos abiertos | `cash_shift` (ya hay store local) | Publicar campo tras permiso agregado |
| Inventario crítico | Inventory | Threshold + read autorizado |
| Alertas / por caja y sucursal | Reporting | Contratos por scope |
| Utilidad estimada | Financial read | Solo con permiso financiero dedicado |

### GLOBAL

| Necesidad UI | Fuente candidata | Endpoint / mensaje |
|---|---|---|
| Empresas y licencias | Platform / Licensing | APIs Central existentes en sus módulos |
| Planes y suscripciones | Licensing | Central |
| Dispositivos activados | Device lifecycle | Central |
| Estado técnico / sync | Sync / ops | Observabilidad autorizada |
| Incidentes / auditoría | Audit | Lectura GLOBAL; no mezclar en panel local |

## Incorporación posterior en UI

1. Publicar permisos agregados y contratos de lectura (ADR + packages/contracts).
2. Materializar proyecciones o ampliar use cases fail-closed (`GetAdminMetricsUseCase`, Reporting).
3. Sustituir slots `data-metric-state="unavailable"` por lecturas reales sin cambiar ownership.
4. Conservar distinción visual: valor / sin datos (`0` legítimo) / sin permiso / no disponible / error.
5. Certificar con sesión SSA/SAS real; no usar smoke-entry ni Role Preview como evidencia comercial.
