# TECH-002E: esquema físico de recepción de inventario

## Estado y alcance

`CLOSED` dentro de `TECH-002` para `PHY-G06`.

El flujo de recepción independiente queda diseñado a partir de `UC-INVENTORY-001`, `UC-INVENTORY-002` y `DEC-007`. No se autoriza DDL. `GoodsReceipt` es la recepción física del primer release y puede confirmarse sin `PurchaseOrder`.

El contrato actual no incluye una referencia a una compra genérica. `PurchaseOrder`, `SupplierDocument`, `AccountsPayable`, impuestos de compra, landed cost y `SupplierPayment` quedan diferidos; GoodsReceipt nunca se convierte en orden, factura, obligación o pago para anticiparlos.

## Autoridad y ubicación

| Agregado | Clase | Autoridad |
|---|---|---|
| Supplier, InventoryLocation | `CENTRAL_MASTER_REPLICATED` | central |
| GoodsReceipt, GoodsReceiptLine, GoodsReceiptLotAllocation | `LOCAL_AUTHORITATIVE_SYNCED` | POS Local Service que confirma la recepción hasta aceptación central |
| Lot, InventoryMovement, InventoryCostRecord | `LOCAL_AUTHORITATIVE_SYNCED` | transacción local de inventario |
| StockBalance | `DERIVED_PROJECTION` | reconstruible desde movimientos/reservas aceptados |

## Maestros requeridos

### `purchasing.suppliers` / `purchasing_suppliers`

Columnas: `id`, `tenant_id`, `company_id`, `name`, `name_normalized`, `status`, `created_at`, `retired_at NULL`, `version`.

Constraints: scope/FK compuestos a Company, `UNIQUE (tenant_id, company_id, name_normalized)`, estados `ACTIVE`/`RETIRED`, sin delete en cascada. No incluye crédito, datos fiscales, contactos o condiciones aún no contratadas.

### `inventory.inventory_locations` / `inventory_inventory_locations`

Columnas: `id`, `tenant_id`, `company_id`, `branch_id`, `code`, `code_normalized`, `name`, `location_type`, `status`, `created_at`, `retired_at NULL`, `version`.

Constraints: FK compuesta a Branch, `UNIQUE (tenant_id, company_id, branch_id, code_normalized)`, estados `ACTIVE`/`RETIRED`, tipos `WAREHOUSE`/`DISPLAY`/`CASH_REGISTER`/`INTERNAL` y `UNIQUE (tenant_id, company_id, branch_id, id)` para referencias aisladas.

## Recepción

### `purchasing.goods_receipts` / `purchasing_goods_receipts`

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID | PK, mismo ID local/central |
| `tenant_id`, `company_id`, `branch_id` | UUID | scope obligatorio |
| `inventory_location_id` | UUID | ubicación activa de esa sucursal |
| `supplier_id` | UUID | proveedor activo de la empresa |
| `received_at` | instante | fecha efectiva; local reportada con evidencia temporal |
| `received_by_actor_type`, `received_by_actor_id` | actor | usuario autorizado |
| `origin_device_id` | UUID | dispositivo/fuente autorizada de la operación local |
| `idempotency_key` | text | unique por tenant/dispositivo/origen |
| `request_checksum` | text | request canónico |
| `correlation_id` | UUID | trazabilidad |
| `created_at` | instante | persistencia local |
| `server_recorded_at` | instante nullable | aceptación central |

La fila confirmada es inmutable. No contiene estado DRAFT ni total comercial porque el caso de uso confirma una recepción y no define edición, orden, factura, obligación o pago. Cada recepción tiene una sola `inventory_location_id`; recibir en otra ubicación exige otra recepción.

Constraints:

- FKs compuestas a Branch, InventoryLocation y Supplier;
- `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, origin_device_id, idempotency_key)` tanto local como central;
- mismo key/checksum retorna el mismo resultado; checksum distinto produce conflicto.

### `purchasing.goods_receipt_lines` / `purchasing_goods_receipt_lines`

Columnas: `id`, `tenant_id`, `goods_receipt_id`, `line_number`, `presentation_id`, `source_unit_id`, `source_quantity`, `inventory_quantity`, `unit_cost`, `currency_code`, `cost_tax_treatment`, `unit_conversion_id NULL`, `conversion_factor NULL`, `conversion_version NULL`.

Representación decimal: cantidades `(19,6)`, costo `(19,6)`; SQLite usa texto canónico según TECH-002A.

Constraints:

- `UNIQUE (tenant_id, goods_receipt_id, line_number)`;
- FKs a Receipt, Presentation y UnitOfMeasure con tenant/scope;
- cantidades `> 0`, costo `>= 0`;
- `source_quantity` respeta precisión de source unit e `inventory_quantity` la de Presentation;
- `cost_tax_treatment` es `INCLUDED`, `EXCLUDED` o `UNKNOWN` y solo congela la evidencia declarada, sin calcular impuesto de compra;
- `unit_conversion_id`, `conversion_factor` y `conversion_version` son todos nulos o todos presentes;
- la suma de las asignaciones de la línea es exactamente `inventory_quantity`.

### `purchasing.goods_receipt_lot_allocations` / `purchasing_goods_receipt_lot_allocations`

Columnas: `id`, `tenant_id`, `goods_receipt_line_id`, `allocation_number`, `inventory_quantity`, `lot_id NULL`.

Constraints:

- `UNIQUE (tenant_id, goods_receipt_line_id, allocation_number)`;
- FK tenant-scoped a GoodsReceiptLine y Lot cuando exista;
- cantidad `> 0` y con precisión de la Presentation de la línea;
- `lot_id` es obligatorio cuando la política de la presentación controla lote y nulo cuando no lo permite;
- cada línea tiene al menos una asignación;
- una asignación confirmada es inmutable y origina exactamente un movimiento `IN`.

Los datos de lote capturados —código del proveedor, fabricación y vencimiento— alimentan la creación o resolución de `Lot`; no se duplican como atributos autoritativos de la línea o de la asignación.

Cardinalidades físicas: GoodsReceipt `1:N` GoodsReceiptLine; GoodsReceiptLine `1:N` GoodsReceiptLotAllocation; cada asignación referencia `0..1` Lot y cada Lot puede ser referenciado por `0..N` asignaciones históricas; asignación confirmada `1:1` InventoryMovement de entrada; línea confirmada `1:1` InventoryCostRecord.

## Hechos de inventario

### `inventory.lots` / `inventory_lots`

Columnas: `id`, `tenant_id`, `company_id`, `presentation_id`, `supplier_id NULL`, `batch_code NULL`, `batch_code_normalized NULL`, `deduplication_key NULL`, `lot_policy_version`, `manufacture_date NULL`, `expiration_date NULL`, `received_at`, `parent_lot_id NULL`, `status`, `created_at`, `version`.

Constraints:

- FK compuestas a Presentation/Supplier y self parent;
- unique parcial `(tenant_id, company_id, presentation_id, deduplication_key)` cuando la política produzca una clave;
- `deduplication_key` es determinista y versionada, nunca un hash de campos elegidos ad hoc;
- `expiration_date >= manufacture_date` cuando ambas existan;
- estados `ACTIVE`, `BLOCKED`, `DEPLETED`, `EXPIRED`;
- Lot no almacena costo autoritativo: múltiples recepciones pueden afectar valoración y InventoryCostRecord conserva los hechos.

### `inventory.inventory_movements` / `inventory_inventory_movements`

Append-only: `id`, `tenant_id`, `company_id`, `branch_id`, `inventory_location_id`, `presentation_id`, `lot_id NULL`, `movement_type`, `direction`, `quantity`, `unit_id`, `reference_type`, `reference_id`, `goods_receipt_lot_allocation_id NULL`, `actor_type`, `actor_id NULL`, `operation_id`, `idempotency_key`, `movement_sequence`, `business_date`, `occurred_at`, `origin_device_id`, `created_at`, `server_recorded_at NULL`.

Constraints:

- `quantity > 0`; el sentido es `IN`/`OUT`, no signo ambiguo;
- Unit coincide con la unidad inventariable de Presentation;
- todas las FKs compuestas conservan tenant/company/branch/location;
- `movement_sequence` es un entero positivo, estable dentro de la solicitud canónica;
- `UNIQUE (tenant_id, origin_device_id, idempotency_key, movement_sequence)` permite varios movimientos del mismo tipo sin duplicarlos en un reintento;
- cada asignación de lote crea exactamente un movimiento `IN` mediante unique parcial `goods_receipt_lot_allocation_id` para ese tipo;
- no se actualiza ni elimina; una corrección crea movimiento compensatorio referenciado.

### `inventory.inventory_cost_records` / `inventory_inventory_cost_records`

Append-only: `id`, `tenant_id`, `company_id`, `presentation_id`, `goods_receipt_line_id`, `unit_cost`, `currency_code`, `cost_tax_treatment`, `source_quantity`, `source_unit_id`, `conversion_factor NULL`, `conversion_version NULL`, `effective_at`, `recorded_by_actor_type`, `recorded_by_actor_id`, `recorded_source`, `created_at`.

Constraints: `UNIQUE (tenant_id, goods_receipt_line_id)`, costo `>= 0`, FKs del mismo scope y conversión completa o ausente. Conserva costo de recepción; no calcula landed cost, impuestos de compra, promedio ponderado o valoración contable, no modifica ProductPrice y no se actualiza destructivamente.

### `inventory.stock_balances` / `inventory_stock_balances`

Proyección mutable: `tenant_id`, `company_id`, `branch_id`, `inventory_location_id`, `presentation_id`, `lot_id NULL`, `on_hand_quantity`, `reserved_quantity`, `available_quantity`, `last_movement_id`, `version`, `updated_at`.

Constraints:

- `available_quantity = on_hand_quantity - reserved_quantity` se calcula/valida en dominio y se revalida en central;
- `reserved_quantity >= 0`; política decide si on-hand/available negativos son rechazados por operación;
- dos uniques, uno para `lot_id IS NULL` y otro para `lot_id IS NOT NULL`, impiden duplicados por semántica NULL;
- cada update usa expected version y referencia el último movimiento aplicado;
- es reconstruible y no sustituye InventoryMovement.

## Transacción local de recepción

POS Local Service, único escritor SQLite:

1. valida autorización offline, tenant/empresa/sucursal/ubicación;
2. valida Supplier y snapshots de catálogo vigentes;
3. reserva idempotency key y checksum;
4. inserta GoodsReceipt y GoodsReceiptLine;
5. crea/resuelve Lot bajo política versionada e inserta cada GoodsReceiptLotAllocation;
6. valida que asignaciones y cantidad de línea coincidan e inserta un InventoryMovement por asignación;
7. inserta un InventoryCostRecord por línea;
8. actualiza StockBalance con expected version;
9. inserta AuditEvent y outbox;
10. confirma un solo commit SQLite.

Un error revierte todo. Reintentar retorna el mismo receipt; nunca duplica lotes, movimientos, costos o saldo.

## Aceptación central

Inbox, validación tenant-scoped y efectos consolidados comparten una transacción PostgreSQL. Duplicado exacto retorna resultado anterior; checksum distinto o versión incompatible produce conflicto/revisión, no edición del movimiento local. La compensación central crea hechos explícitos.

## Pruebas obligatorias

1. ubicación de otro tenant/sucursal rechazada;
2. Supplier de otra empresa rechazado;
3. recepción independiente de PurchaseOrder funciona;
4. idempotencia concurrente no duplica efectos;
5. unidad incompatible, precisión inválida y costo negativo rechazados;
6. moneda y tratamiento tributario se congelan sin calcular impuesto de compra;
7. conversión incompleta o sin versión se rechaza;
8. producto con lote/vencimiento aplica campos obligatorios;
9. una línea puede distribuirse entre varios lotes y la suma debe coincidir;
10. cada asignación produce un movimiento una sola vez y cada línea un costo una sola vez;
11. mezclar ubicaciones requiere recepciones separadas;
12. precio de venta no cambia;
13. corrección o devolución crea operación compensatoria y no reescribe la recepción;
14. crash previo al commit no deja efectos parciales;
15. StockBalance se reconstruye desde movimientos;
16. sync duplicado no reaplica movimiento;
17. conflicto genera revisión/compensación, no overwrite;
18. decimales exactos en PostgreSQL y SQLite.

## Condición de cierre

`PHY-G06` se cierra sin definir PurchaseOrder porque el contrato vigente solo materializa recepción física independiente. La auditoría transversal verificó cardinalidades, lifecycle inmutable, compensaciones, eventos, permisos, migración heredada, atomicidad y consistencia con `DEC-007` y `UC-INVENTORY-002`.

No se inició `PHY-G07` en este cambio. El cierre documental de `PHY-G06` tampoco autorizó DDL: en ese corte la primera migración conservó su gate independiente `NO-GO`. Su evolución posterior se registra en `traceability.md` y `../../product/backlog.md`.
