# Inventario compartido — auditoría, implementación y límites verificables

**Repositorio:** Camacho POS Colombia, núcleo original. **Rama única:** `cursor/commercial-design-review-0d11`.
**Alcance de producto:** Salsamentaria, Farmacia, Pastelería. **PR #106:** no fusionar.
**Fecha de trabajo:** 2026-11-15. **Regla:** pruebas de CI deben acreditarse contra el HEAD exacto y no contra commits anteriores cancelados.

## Auditoría ejecutable del estado original

| Dominio | Ya operativo, antes de este bloque | No operativo / no inferible |
|---|---|---|
| Catalog | Producto y presentación por empresa; unidad, `unit_precision` 0–6; precio único activo; `stock_controlled` | Equivalencias comerciales aprobadas entre presentaciones; recetas/versionado de ingredientes; metadatos regulatorios de farmacia |
| Inventory | `inventory_stock` consolidado por tenant/company/branch/presentation; `inventory_movement` inmutable e idempotente; escala 6 mediante BigInt; auditoría/outbox | Libro por lote, elegibilidad FEFO y cuarentena (antes de v22) |
| Receiving | `ReceiveStockUseCase` y `inventory.stock.receive` con permiso `INVENTORY_STOCK_RECEIVE`, atomicidad por SQLite | Proveedor, documento, lote y vencimiento asociados a cada recepción (antes de este bloque) |
| Sales | Comprobación de disponibilidad antes de crear; comprobación definitiva dentro de la transacción de pago | Reserva duradera de stock por período; coordinación entre cajas desconectadas |
| Payments | Cobro y completion con descuento de stock en una sola transacción; rollback de cobro si no hay saldo | No debe ser alterado para simular FEFO o recaudo automático |
| Sync | Outbox local, idempotencia, reintentos y transporte hacia Central | No hay contrato verificado para replicar estados de lote, proveedor, documento, reserva o conversiones entre cajas |
| Esquemas físicos | MIGRATION_014 Catalog, _015 Inventory, tablas históricas de venta/Payment y _021 QR | No debe redefinirse ninguna migración histórica ni reinterpretarse stock antiguo |

## Cambios locales de este bloque (pendientes de certificación de CI)

- `MIGRATION_022`, nueva y **aditiva**: `inventory_lot_tracking`, `inventory_lot`, `inventory_lot_movement`, `inventory_lot_status_event`; índices FEFO y triggers append-only. No se modifica `sales_sale_items`, `sales_sales`, `inventory_stock` ni `inventory_movement`.
- El repositorio **existente** `SqliteInventoryStore` ofrece recepción documentada por lote, FEFO sobre existencias elegibles, salida exacta de lote para merma y consumo manual autorizado, saldos por lote y estados `AVAILABLE`, `QUARANTINE`, `BLOCKED`, `RECALLED`.
- Primera recepción trazable solo con inventario consolidado igual a cero; si hay stock legado, retorna `LEGACY_STOCK_RECONCILIATION_REQUIRED`. No se fabrican lotes para cuadrar existencias históricas.
- El descuento FEFO ocurre al completar la venta, dentro de la transacción existente de Payments. Una venta creada no constituye reserva.
- La lectura requiere `INVENTORY_STOCK_READ`; recepción requiere `INVENTORY_STOCK_RECEIVE`; cuarentena, retiro, merma y consumo manual de ingredientes requieren `INVENTORY_STOCK_ADJUST`. Se verifica en backend sobre autorización firmada, no por la visibilidad del botón.
- Contratos `inventory.stock.receive` y `inventory.stock.adjust` ampliados sin reemplazarlos; nuevos `inventory.batch.list` y `inventory.batch.status` en el mismo canal IPC. `InventoryPanel` existente muestra lotes y ofrece acciones según permiso.
- Decimal: cantidades como texto escala 6 y `BigInt`; entradas con más precisión que la presentación se rechazan y no se redondean.
- Test files: `apps/pos-local-service/tests/inventory-batches.test.ts`, `packages/database-sqlite/tests/inventory-v22-migration.test.ts`, `apps/pos-desktop/tests/renderer/InventoryBatchPanel.test.tsx`, más regresiones de `inventory.test.ts` y `payment.test.ts`.

**Criterio de certificación:** no se considera completo mientras el job TARGET correspondiente al HEAD actual no acredite migración, pruebas SQLite, tipos, renderer y regresión de Payments. El éxito de tests aislados o de un commit anterior no sustituye ese resultado.

## Incremento 023 — conversión exacta en el núcleo existente

- **MIGRATION_023**, aditiva: `inventory_conversion_rule` (equivalencia por producto, versiones inmutables y aprobación de usuario) e `inventory_conversion_event` (genealogía inmutable). Sin editar migraciones 001–022 ni alterar ventas antiguas.
- `ApprovePresentationConversionUseCase` exige simultáneamente `CATALOG_PRODUCT_REGISTER` y `INVENTORY_STOCK_ADJUST`; `ConvertPresentationUseCase` exige `INVENTORY_STOCK_ADJUST`. Ninguna autorización nace del renderer.
- `SqliteInventoryStore.convertPresentation` usa el ratio aprobado más reciente por dirección, aritmética `BigInt` de escala 6, saldo y elegibilidad del lote, procedencia y atomicidad entre los dos asientos. Una cantidad destino no representable con la precisión de la presentación se rechaza, nunca se aproxima.
- Los asientos se registran en los libros existentes `inventory_movement`/`inventory_stock` y `inventory_lot_movement`/`inventory_lot`; la genealogía origen/destino queda en `inventory_conversion_event`. Los dos movimientos conservan auditoría y outbox del inventario.
- Contratos `inventory.conversion.rule.approve` y `inventory.conversion.execute` incorporados al IPC real y al `InventoryPanel` existente con gating de permisos. Los reintentos inciertos conservan la clave idempotente.
- `MATERIAL_CONSUMPTION` manual ya estaba presente. Se refuerza con rechazo de insumos vencidos, bloqueados o en cuarentena, manteniendo la merma física autorizada para retirada.
- Las pruebas nuevas cubren ratio exacto, dos saldos, genealogía, doble envío, alteración de clave, denegación de permisos, fracciones no representables y actualización 22→23. El resultado de CI debe comprobarse **en el HEAD definitivo**, no extrapolarse de TARGET #1389.

**Limitación de catálogo**: el producto actual registra inicialmente una presentación. La conversión requiere que la presentación destino ya esté aprovisionada dentro del mismo producto. Falta una operación comercial completa para añadir presentaciones secundarias desde catálogo, no debe sembrarse producción con filas SQL manuales. No declarar lista una conversión sectorial hasta cubrir esta precondición.

## Pendientes delimitados — SIN afirmar implementación

### Incremento 024 — reservas locales duraderas

- **MIGRATION_024**, aditiva: `inventory_reservation` + `inventory_reservation_lot`. Reduce disponibilidad, no on-hand físico. Consume al completar venta; release/expire liberan sin inventar stock.
- `CreateSaleUseCase` reserva presentaciones `stock_controlled` dentro de la misma transacción de `READY_FOR_PAYMENT`. `appendSaleDeduction` consume la reserva y aplica los lotes FEFO preasignados.
- IPC `inventory.reservation.create` / `inventory.reservation.release` con permiso `INVENTORY_STOCK_ADJUST`. Outbox local incluye `lot_allocations` en movimientos de venta y eventos de reserva.
- Pruebas: INV-015 create/concurrencia/idempotencia/release/expire/consume en `inventory-batches.test.ts`; migración 23→24 en `inventory-v24-reservation-migration.test.ts`.

### Cierre Prompt 4 — riesgos de reserva (P0/P1)

**HEAD de partida certificado:** `dc4fff6566050bee840f276a928798f0c7d87d25`. El cierre se acredita sólo contra el HEAD final de este incremento.

| Riesgo | Severidad | Corrección local |
|---|---|---|
| Liberación IPC manual de reserva `SALE` activa | P0 | `releaseReservation` / use case IPC rechazan `reference_type='SALE'` con `CONFLICT` |
| Cobro sin revalidar lotes preasignados | P0 | `validateReservationForSaleDeduction` antes del débito: scope, cantidad restante, `AVAILABLE`, no vencido, on-hand físico; fallo → `INSUFFICIENT_STOCK` y rollback de pago |
| Expiración por reloj de holds de venta | P1 | `expireDueReservations` sólo aplica a `MANUAL`; SALE exige transición Sales |
| Cancelación sin liberar hold | P1 | `SqliteSaleStore.cancelReadyForPayment` (sólo `READY_FOR_PAYMENT`) + `releaseReservationsBoundToSale` tras `CANCELLED`/`EXPIRED` en la misma transacción |
| Trazabilidad consume/release/expire | P1 | Auditoría + outbox local `INVENTORY_RESERVATION_CONSUME` / `_RELEASE` / `_EXPIRE` (sin ACK Central simulado) |

**Contrato Central pendiente (no simulado):** receptor tipado para `INVENTORY_RESERVATION_*` y ACK idempotente. Outbox local es evidencia de emisión, no de sync certificado.

**IPC `sales.sale.cancel`:** no materializado en `CanonicalPermission` / canal comercial en este cierre. La política y el writer atómico quedan listos; el grant/IPC se abre en un prompt autorizado aparte.

### Sync Central y concurrencia distribuida

1. Publicar y consumir eventos tipados de lote (fecha, proveedor, documento, estado, movimiento, checksum, fuente, versión) en Central; el outbox local ya puede llevar `lot_allocations`, pero **no** hay receptor Central certificado.
2. Resolver el **stock compartido entre cajas**. SQLite por dispositivo no es, por sí solo, una base de stock global. La reserva 024 cubre concurrencia **en la misma caja/DB**; no certifica dos terminales offline.
3. Propagación de retiro, cuarentena y expiración entre dispositivos, con política para cajas offline y reloj confiable.
4. Verificación de autorización y recepción en Central, no solamente envío de la outbox; reconciliación idempotente tras reinicio y particiones.

### Catalog, conversiones y Pastelería

1. **Conversiones de presentaciones:** la equivalencia exacta y el débito/crédito local se añaden en 023; **pendiente** aprovisionamiento de presentaciones secundarias por flujo comercial, validación de CI del HEAD, reglas de negocio sectoriales y sincronización Central del evento de genealogía.
2. **Consumo de materia prima:** el ajuste `MATERIAL_CONSUMPTION` manual registra salida por lote y requiere permiso de ajuste, pero **no es** un sistema de recetas/escandallos. Faltan BOM versionados, rendimiento, mermas de proceso, elaboración/producción e idempotencia de órdenes.
3. **Farmacia:** falta política por producto para exigir lote/vencimiento y controles regulatorios de dispensación. Un vencimiento nulo no se debe interpretar como permitido en todas las categorías.
4. **Recepción con stock legado:** falta conciliación administrativa documentada para activar lotes sin perder historia ni inventar procedencia.
5. **Paginación:** el contrato de listados tiene un límite definido; no existe paginación para volúmenes masivos de lotes.

### Hardware y experiencia comercial

1. Escáner/balanza: no hay verificación física de asociación automática de lotes a EAN/GS1 ni captura de lotes por dispositivo; se requiere laboratorio hardware separado.
2. Impresoras, etiquetas, alertas de vencimiento y recetas vinculadas a productos finales requieren UX y pruebas de dispositivo.
3. Las pantallas actuales muestran inventario local autorizado; no deben afirmar disponibilidad global en tiempo real sin Central.

## Reversión segura

SQLite no dispone de un `DROP MIGRATION 022` operativo seguro: retirar tablas después de recibir datos destruiría historial. Una recuperación antes de activar lotes debe usar el mecanismo de **backup verificado** y recuperación existente. No se elimina ni reescribe una migración histórica, y la restauración de un backup antiguo no debe disfrazarse de reconciliación de stock.

## Condiciones de salida

- P0 reservas (release SALE bloqueado + revalidación al cobro): **implementado y probado en suite local**; CI del HEAD final debe quedar SUCCESS.
- Suite SQLite/IPC, FEFO, reservas, cancelación READY_FOR_PAYMENT, restart, pagos y migrations: acreditable sólo con CI del HEAD final.
- Sync Central de lote/reserva y stock entre cajas: **PENDIENTE** (severidad alta, dependencia Central).
- Alta comercial de presentaciones secundarias: **PENDIENTE**.
- Recetas/BOM y órdenes de producción: **PENDIENTE**.
- Políticas regulatorias de Farmacia: **PENDIENTE**.
- Integraciones físicas Windows/Android y hardware: **PENDIENTE**.
- IPC autorizado `sales.sale.cancel`: **PENDIENTE** (writer local listo; permiso canónico no materializado).
