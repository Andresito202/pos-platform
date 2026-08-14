# TECH-002 R2-B: contrato físico base de Inventory

## Estado y alcance

`CLOSED` documentalmente dentro de `TECH-002 / R2-B`, sin DDL.

Este contrato completa movimientos, proyección, reservas, ajustes, mermas, lotes y vencimientos. Reutiliza `inventory-receiving-schema.md` para Supplier, GoodsReceipt, allocations, Lot, costo y entrada. `InventoryMovement` es la fuente de hechos; `StockBalance` es reconstruible. No existe `InventoryItem` gigante ni actualización destructiva de stock histórico.

## Ubicación y autoridad

InventoryLocation y versiones de InventoryPolicy son `CENTRAL_MASTER_REPLICATED`. InventoryMovement, InventoryReservation y operaciones locales autorizadas son `LOCAL_AUTHORITATIVE_SYNCED` hasta aceptación central. StockBalance es `DERIVED_PROJECTION`. Lot acompaña al hecho que lo crea y se consolida sin last-write-wins.

## `inventory.inventory_movements` / `inventory_inventory_movements`

Se conserva el contrato de recepción y se generaliza a todo movimiento:

`id`, `tenant_id`, `company_id`, `branch_id`, `inventory_location_id`, `presentation_id`, `lot_id NULL`, `movement_type`, `direction`, `quantity numeric(19,6)`, `unit_id`, `reference_type`, `reference_id`, `reason_code NULL`, `reason_detail NULL`, `evidence_reference_id NULL`, `approval_actor_id NULL`, `inventory_policy_version_id`, `operation_id`, `origin_device_id`, `actor_type`, `actor_id NULL`, `idempotency_key`, `request_checksum`, `movement_sequence`, `business_date`, `occurred_at`, `timezone_id`, `utc_offset_minutes`, `created_at`, `server_recorded_at NULL`, `compensates_movement_id NULL`.

Reglas:

- append-only, cantidad positiva y dirección `IN`/`OUT`; el signo no codifica semántica;
- tipos estables incluyen entradas/salidas respaldadas, `POSITIVE_ADJUSTMENT`, `NEGATIVE_ADJUSTMENT`, `WASTE`, `TRANSFER_OUT`, `TRANSFER_IN` y `RESERVATION_CONSUMPTION`; devolución, expiración, daño o consumo interno son causa/referencia, no aliases intercambiables;
- `WASTE` exige reason code de dominio como `DAMAGED`, `EXPIRED`, `SPOILAGE`, `LOSS` u otro publicado, evidencia y aprobación cuando policy lo requiera;
- vencimiento no crea movimiento por sí solo; la baja se registra explícitamente;
- `UNIQUE (tenant_id, origin_device_id, idempotency_key, movement_sequence)`; una operación de dominio referencia una SyncOperation y sus varios movimientos comparten `operation_id`, sin duplicar el payload;
- todas las referencias fuertes conservan tenant/company/branch/location; referencias funcionales tipadas se validan por puerto;
- compensar crea otro movimiento y una cadena trazable, nunca UPDATE/DELETE.

Un agregado `Waste` separado no se justifica en el alcance vigente: movimiento `WASTE` + motivo + evidencia + approval + audit satisface `UC-INVENTORY-002`. Si un workflow futuro exige solicitud, inspección o disposición con lifecycle independiente, requerirá caso de uso y decisión posterior.

## `inventory.stock_balances` / `inventory_stock_balances`

Clave: tenant, company, branch, location, presentation y lot nullable con uniques separados para semántica NULL. Columnas de proyección: `on_hand_quantity`, `reserved_quantity`, `available_quantity`, `last_movement_id`, `version`, `updated_at`.

Se actualiza con expected version en la misma transacción del hecho. No acepta correcciones directas, no es autoridad de auditoría y puede reconstruirse desde movimientos/reservas aceptados.

## `inventory.inventory_reservations` / `inventory_inventory_reservations`

Columnas: `id`, `tenant_id`, `company_id`, `branch_id`, `inventory_location_id`, `presentation_id`, `lot_id NULL`, `reference_type`, `reference_id`, `quantity`, `consumed_quantity`, `released_quantity`, `status`, `expires_at NULL`, `inventory_policy_version_id`, `origin_device_id`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id NULL`, `version`, actor y timestamps.

Estados: `ACTIVE`, `PARTIALLY_CONSUMED`, `CONSUMED`, `RELEASED`, `EXPIRED`, `CANCELLED`, conforme al caso de uso. Una reserva reduce disponibilidad, no existencia; consumir crea movimiento, liberar no crea entrada ficticia. Cantidades exactas y acumulados no superan la reserva.

## Lotes y vencimientos

`inventory.lots` conserva: identidad tenant/company/presentation, supplier opcional, batch code/dedup key bajo policy, manufacture/received/expiration dates opcionales, parent lot, lot policy version, status y version. La ubicación y cantidad no se duplican en Lot: se obtienen de movimientos y StockBalance por ubicación/lote.

Lote/vencimiento se activa por control de Product/Presentation + capability/entitlement + InventoryPolicy efectiva; no es obligatorio para todos los productos. Si la presentación exige lote, movimientos y reservas lo requieren. `expiration_date` es nullable cuando no aplica; controles FEFO, bloqueo y ventanas usan policy versionada. No se asumen receta, registro sanitario ni requisitos farmacéuticos no documentados.

## Adjustment, Waste y evidencia

Adjustment y Waste son operaciones sobre el ledger, no tablas universales. El movimiento conserva reason, actor, approval, evidence reference, policy version, causalidad y compensación. Se distinguen devolución comercial, corrección de conteo, merma real, vencimiento, daño y consumo interno mediante `reference_type`/`reason_code` autorizados, sin convertirlos en el mismo estado.

La evidencia grande o binaria pertenece a un puerto/almacén autorizado; la tabla conserva referencia, checksum y metadatos sanitizados, nunca un JSON libre o secreto.

## Productos pesables y extensibilidad

Inventory opera por `ProductPresentation`, UnitOfMeasure y cantidad decimal exacta. Peso, volumen y conteo comparten el contrato dimensional; lotes, seriales o variantes son módulos/relaciones optativos y no columnas específicas del negocio en Product o StockBalance. Serial tracking no se materializa en R2-B porque no existe contrato funcional aprobado.

Báscula, escáner y otros dispositivos entregan mediciones/identidades validadas mediante puertos. Inventory no conoce marca, modelo o SDK.

## Fronteras transaccionales y sync

- movimiento: insert append-only + update de StockBalance con expected version + AuditEvent + `SyncOperation`/Outbox en un commit;
- reserva/transición: Reservation + proyección reservada + audit/outbox en un commit;
- consumo: movimiento + acumulado de reserva + balance + audit/outbox en un commit;
- ajuste/merma: movimiento tipado + approval/evidence + balance + audit/outbox en un commit;
- recepción sigue el contrato `inventory-receiving-schema.md`;
- traslado confirmado usa operaciones idempotentes enlazadas por origen/destino, no una transacción distribuida.

El origen local se permite solo por policy/licencia/permiso/dispositivo. Central Inbox revalida y no reescribe el hecho ante conflicto: acepta, rechaza, espera dependencia, revisa o genera compensación explícita. StockBalance central/local no se fusiona bidireccionalmente.

## Seguridad y observabilidad futura

Tenant/scope/actor se derivan de contexto confiable. RLS y FKs tenant-aware, RBAC/ABAC, MFA/reauth para ajustes sensibles, idempotencia/replay, audit append-only, validación de hardware/sync y evidencia sanitizada se mapean a `SEC-G01` a `SEC-G10`. `LoggerPort`, `MetricsPort` y `AuditPort` observarán movimientos, stock insuficiente, expiración, merma, drift, conflicto y reconstrucción sin alterar decisiones.

## Pruebas futuras obligatorias

Cross-tenant y cross-branch/location, exactitud/precisión, movimiento append-only y compensación, reconstrucción de balance, concurrencia/doble consumo, reservas, lote obligatorio/opcional, expiración, FEFO/FIFO, motivos distintos, approval de merma, evidencia, operación offline/replay/conflicto, producto pesable y equivalencia PostgreSQL/SQLite.

## Resultado

Inventory base queda cerrado para R2-B. PurchaseOrder, serial tracking y workflows especializados permanecen diferidos; lotes, vencimientos y merma encajan sin rediseñar Sales o Product.
