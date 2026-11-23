# Preparación visual para Reporting administrativo

Documento de preparación (fase visual). **No implementa Reporting.**
Referencia de backlog: `REP-001` / `REP-002` / `REP-003` en `docs/product/backlog.md`.

## Principios

- Reporting no es fuente de verdad (`docs/architecture/data-ownership.md`).
- La UI no consulta tablas directamente desde React.
- `null` ≠ `0`: ausencia de autorización o de publicación del agregado no se muestra como venta cero.
- SUPERADMINISTRADOR local ≠ autoridad GLOBAL ≠ ADMINISTRADOR BUSINESS.
- La interfaz comercial usa mensajes para comerciantes; este documento conserva la jerga técnica (contratos, IPC, permisos agregados, REP-001).

## Estado REP-001 fase 1–2 (cierre técnico)

| Capacidad | Estado | Nota |
|---|---|---|
| Permisos `REPORTING_*` en contracts + use case | MATERIALIZED | Bridge local **no** los otorga |
| Catálogo Central `034_reporting_aggregate_permissions` | MATERIALIZED (SQL) + artifact TESTED offline | Runtime apply PostgreSQL: **NO VERIFICADO** (sin servidor disposable en este entorno) |
| Emisión SSA/SAS comercial con esos grants | BLOQUEADO | Falta emisor HTTP POS + SnapshotProvider (ver `docs/testing/ssa-sas-central-implementation-proposal-20261123.md`) |
| `readSales` acumulado + hoy | MATERIALIZED | Filtro `installation_id` + `business_date` comercial `America/Bogota` (no `created_at` UTC) |
| `readCash` / `readPayments` | MATERIALIZED | Cash por `origin_device_id`; pagos `CONFIRMED` + `installation_id` |
| Dashboard admin conectado | MATERIALIZED | Alcance INSTALLATION_BRANCH honesto; inventario = proyección local de sucursal |
| Certificación Reporting comercial | **NO** | Bloqueada mientras SSA/SAS comercial no emita grants |

## Estado actual de superficies

| Rol / superficie | Componente | Backend hoy | Estado UI |
|---|---|---|---|
| Supervisor — transferencias | `TransferReviewPanel` | `payment.get`, `payment.transfer.confirm`, `payment.cancel` | Conectado |
| Administrador — dashboard | `AdministrativeControlPanel` | `admin.metrics.get` | Conectado; ventas/caja/pagos agregados requieren grants REPORTING_* |
| Administrador BUSINESS (browser) | `BusinessCashRegisterPanel` | HTTP Central BUSINESS | Conectado |
| Superadministrador local — auditoría | `LocalAdministrativeAuditPanel` | Sin IPC cableado para `audit.event.list` | Estructura visual; sin filas inventadas |

## Datos ya existentes (almacenes)

### SQLite local (`SqliteAdminMetricsStore`)

Alcance real: **INSTALLATION_BRANCH**. No hay evidencia de inbox que importe hechos comerciales de otras instalaciones a esta SQLite; aun así ventas/pagos filtran `installation_id` y turnos filtran `origin_device_id`. Inventario es proyección de sucursal en la base local (sin columna de instalación). No es consolidado multicaja ni empresa.

| Lectura | Tabla / filtro | Expuesta hoy por `admin.metrics.get` |
|---|---|---|
| Ventas acumuladas (conteo + importe) | `sales_sales` COMPLETED + `installation_id` | **Sí** si `REPORTING_SALES_AGGREGATE_READ` |
| Ventas de hoy (conteo + importe) | mismo + `business_date` = fecha comercial `America/Bogota` | **Sí** con el mismo grant; nunca `created_at` UTC |
| Existencias controladas | `inventory_stock` count (branch local) | **Sí** si `INVENTORY_STOCK_READ` |
| Turnos abiertos | `cash_shift` OPEN/CLOSING + `origin_device_id` | **Sí** si `REPORTING_CASH_AGGREGATE_READ` |
| Pagos confirmados / por método | `payments_payments` CONFIRMED + `installation_id` | **Sí** si `REPORTING_PAYMENTS_AGGREGATE_READ` |
| Transferencias pendientes | TRANSFER CREATED/PENDING/REVIEW_REQUIRED + `installation_id` | **Sí** (conteo informativo; no es recaudo) |

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
| Agregados Reporting futuros | Consolidado multicaja/empresa, utilidad, alertas | Fuera de `admin.metrics.get` V1 instalación/sucursal |

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
