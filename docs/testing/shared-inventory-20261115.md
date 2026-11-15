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

## Pendientes delimitados — SIN afirmar implementación

### Sync Central y concurrencia distribuida

1. Publicar y consumir eventos tipados de lote (fecha, proveedor, documento, estado, movimiento, checksum, fuente, versión) en Central; el payload actual del outbox de inventario conserva principalmente el agregado por presentación.
2. Resolver el **stock compartido entre cajas**. SQLite por dispositivo no es, por sí solo, una base de stock global. Dos cajas offline pueden ofrecer el mismo inventario. Se necesita titularidad por caja, reservas/asignaciones por sucursal o conciliación/limitación explícita, con pruebas de doble venta.
3. Reserva de ventas `READY_FOR_PAYMENT`: no existe retención duradera de lotes; la seguridad actual rechaza la segunda deducción al completar, pero no garantiza reserva anticipada.
4. Propagación de retiro, cuarentena y expiración entre dispositivos, con política para cajas offline y reloj confiable.
5. Verificación de autorización y recepción en Central, no solamente envío de la outbox; reconciliación idempotente tras reinicio y particiones.

### Catalog, conversiones y Pastelería

1. **Conversiones de presentaciones:** falta una equivalencia canónica por producto, expresada como fracción exacta y versionada/aprobada. Nunca aceptar factores libres del cajero ni multiplicar saldo duplicando el origen. El caso de uso deberá debitar origen y acreditar destino en una sola transacción, conservar genealogía de lotes, rechazar residuos submicroscópicos y probar reversión.
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

- Suite SQLite/IPC/renderer, recibos, merma, FEFO, doble envío, aislamiento, stock insuficiente, vencimiento, restart, pagos y migrations: **pendiente de verificar resultado del HEAD**.
- Sync Central de lote y stock entre cajas: **PENDIENTE**.
- Conversiones con ratios canónicos: **PENDIENTE**.
- Recetas automáticas: **PENDIENTE**.
- Certificación hardware: **PENDIENTE**.
