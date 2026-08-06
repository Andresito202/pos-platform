# Modelo conceptual de datos

## Objetivo

Definir las entidades principales, sus responsabilidades y relaciones antes de diseñar tablas físicas.

## Jerarquía organizacional

Platform
└── Tenant
    └── Company
        └── Branch
            ├── CashRegister
            ├── Device
            ├── InventoryLocation
            ├── UserAssignment
            ├── Sale
            ├── Purchase
            └── DeliveryOperation

## Entidades de plataforma

### PlatformAccount

Representa usuarios internos del proveedor.

Atributos conceptuales:

- id;
- email;
- phone;
- status;
- security_level;
- last_login_at.

### Tenant

Representa al cliente contractual.

Atributos conceptuales:

- id;
- legal_name;
- status;
- plan_id;
- deployment_mode;
- created_at.

### License

Controla el derecho de uso.

Atributos conceptuales:

- id;
- tenant_id;
- status;
- start_at;
- expires_at;
- grace_period_ends_at;
- deployment_mode;
- signature;
- device_limit;
- branch_limit.

### FeatureEntitlement

Define módulos habilitados.

Atributos conceptuales:

- tenant_id;
- feature_code;
- enabled;
- limit_value;
- valid_from;
- valid_until.

## Entidades organizacionales

### Company

Representa una empresa o negocio.

Atributos conceptuales:

- id;
- tenant_id;
- legal_name;
- trade_name;
- tax_id;
- email;
- phone;
- timezone;
- currency;
- status.

### CompanyBranding

Contiene identidad visual.

Atributos conceptuales:

- company_id;
- logo_version;
- primary_color;
- secondary_color;
- slogan;
- receipt_branding_version.

### Branch

Representa una sede física u operativa.

Atributos conceptuales:

- id;
- company_id;
- name;
- code;
- address;
- city;
- latitude;
- longitude;
- timezone;
- status.

### Device

Representa un equipo autorizado.

Atributos conceptuales:

- id;
- company_id;
- branch_id;
- type;
- fingerprint;
- app_version;
- operating_system;
- status;
- last_seen_at.

## Identidad y autorización

### User

Representa una persona autenticada.

Atributos conceptuales:

- id;
- tenant_id;
- email;
- phone;
- full_name;
- password_hash;
- status;
- mfa_enabled.

### Role

Agrupa permisos.

### Permission

Representa una acción atómica.

### UserRoleAssignment

Relaciona usuario, rol, empresa y sucursal.

### Session

Registra sesiones activas y revocables.

### SecurityEvent

Registra intentos, cambios y alertas críticas.

## Catálogo

### Product

Representa el producto lógico compartido por empresa.

Atributos conceptuales:

- id;
- company_id;
- internal_code;
- name;
- description;
- brand;
- category_id;
- product_type;
- stock_controlled;
- lot_controlled;
- expiration_controlled;
- active.

### ProductVariant

Representa una combinación comercial opcional de atributos dentro de un producto.

Ejemplos:

- sabor;
- talla;
- color;
- concentración;
- modelo;
- capacidad.

No representa unidades, empaques ni cantidades contenidas.

### ProductPresentation

Representa la forma concreta en la que un producto o variante se compra, almacena o vende.

Atributos conceptuales:

- id;
- product_id;
- variant_id opcional;
- name;
- internal_sku;
- base_unit_id;
- contained_quantity;
- base_presentation_id opcional;
- conversion_factor opcional;
- sales_enabled;
- purchasing_enabled;
- inventory_enabled;
- breakable;
- stock_mode;
- active.

Toda presentación pertenece a un producto y, cuando exista variante, esta debe pertenecer al mismo producto.

Todo artículo vendible debe resolver finalmente a una presentación.

### ProductBarcode

Permite varios identificadores por producto, variante o presentación.

Los códigos operativos utilizados para venta, compra o inventario deben resolver finalmente a una presentación.

### Category

Organiza el catálogo.

### UnitOfMeasure

Representa unidad, gramo, kilogramo, libra, litro, metro, caja, paquete u otra unidad.

### UnitConversion

Define equivalencias entre unidades.

## Precios

### PriceList

Agrupa reglas de precios.

### ProductPrice

Atributos conceptuales:

- product_id;
- variant_id opcional;
- presentation_id opcional;
- price_list_id;
- branch_id opcional;
- sales_channel;
- amount;
- valid_from;
- valid_until;
- status.

La resolución conceptual prioriza:

1. presentación;
2. variante;
3. producto.

El precio operativo final debe corresponder a una presentación concreta.

### PriceChange

Conserva historial, responsable y motivo.

## Inventario

### InventoryLocation

Representa bodega, vitrina, caja o ubicación interna.

### StockBalance

Vista o proyección del saldo por:

- producto;
- variante;
- sucursal;
- ubicación;
- lote.

No debe ser la única fuente de verdad.

### InventoryMovement

Fuente de verdad de existencias.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- product_id;
- variant_id opcional;
- lot_id opcional;
- type;
- quantity;
- base_unit;
- reference_type;
- reference_id;
- user_id;
- created_at.

### Lot

Atributos conceptuales:

- id;
- product_id;
- supplier_id;
- batch_code;
- manufacture_date;
- expiration_date;
- received_at;
- unit_cost;
- status.

### InventoryReservation

Reserva stock para pedidos o procesos pendientes.

## Compras

### Supplier

### PurchaseOrder

### Purchase

### PurchaseItem

### GoodsReceipt

### GoodsReceiptItem

### SupplierReturn

La recepción y la factura de compra deben modelarse separadamente cuando el flujo lo requiera.

## Caja

### CashRegister

Representa la caja física o lógica.

### CashShift

Representa el turno abierto por un usuario.

Atributos conceptuales:

- id;
- cash_register_id;
- user_id;
- opened_at;
- closed_at;
- opening_amount;
- expected_amount;
- counted_amount;
- difference;
- status.

### CashMovement

Tipos conceptuales:

- opening;
- sale;
- income;
- expense;
- withdrawal;
- refund;
- adjustment;
- courier_settlement.

## Ventas

### Sale

Atributos conceptuales:

- id;
- global_id;
- company_id;
- branch_id;
- cash_register_id;
- cash_shift_id;
- customer_id opcional;
- channel;
- status;
- subtotal;
- discounts;
- taxes;
- total;
- created_at;
- completed_at;
- idempotency_key.

### SaleItem

Debe conservar snapshot de:

- nombre;
- código;
- unidad;
- cantidad;
- precio;
- impuesto;
- descuento;
- lote;
- costo aplicable.

### Payment

Una venta puede tener uno o varios pagos.

Atributos conceptuales:

- id;
- sale_id;
- payment_method;
- amount;
- status;
- external_reference;
- confirmed_by;
- confirmed_at.

### Refund

### RefundItem

### SaleCancellation

## Clientes y crédito

### Customer

### CustomerAddress

### CreditAccount

### CreditTransaction

## Domicilios

### Order

### OrderItem

### DeliveryAssignment

### Courier

### CourierShift

### CourierCashSettlement

### DeliveryTrackingPoint

### DeliveryOtp

### DeliveryIncident

## Comprobantes

### ReceiptTemplate

Versionada por empresa y opcionalmente por sucursal.

### ReceiptSnapshot

Conserva datos exactos impresos en una venta.

### FiscalDocument

Representa factura electrónica, documento equivalente u otro documento fiscal.

## Sincronización local-first

### SyncOperation

Representa una intención operativa generada por un dispositivo y sincronizable con el servidor central.

Atributos conceptuales:

- operation_id;
- tenant_id;
- company_id;
- branch_id;
- device_id;
- session_id;
- actor_id;
- aggregate_type;
- aggregate_id;
- operation_type;
- idempotency_key;
- expected_version;
- causation_id opcional;
- correlation_id;
- occurred_at_local;
- recorded_at_local;
- received_at_server opcional;
- committed_at_server opcional;
- schema_version;
- payload_checksum;
- sync_status.

La identidad de una operación es global y permanece estable durante todos sus reintentos.

Una modificación del payload requiere una operación nueva.

### OutboxEntry

Representa una operación local confirmada que debe enviarse al servidor.

Atributos conceptuales:

- outbox_id;
- operation_id;
- tenant_id;
- device_id;
- local_sequence;
- sync_status;
- attempt_count;
- next_attempt_at;
- last_attempt_at;
- last_error_code;
- created_at;
- updated_at.

La operación de negocio y su `OutboxEntry` deben persistirse dentro de la misma transacción local.

La outbox:

- es persistente;
- sobrevive reinicios;
- conserva errores e intentos;
- no elimina operaciones pendientes;
- mantiene aislamiento por tenant y dispositivo.

### InboxEntry

Representa el registro central de una operación recibida.

Atributos conceptuales:

- tenant_id;
- operation_id;
- idempotency_key;
- payload_checksum;
- processing_status;
- result_code;
- previous_version opcional;
- new_version opcional;
- received_at_server;
- committed_at_server opcional.

El inbox impide aplicar dos veces una operación aceptada.

La misma operación con el mismo checksum devuelve su resultado anterior.

La misma `idempotency_key` con un payload diferente genera conflicto.

### SyncCheckpoint

Representa la posición confirmada de sincronización entre un dispositivo y el servidor.

Atributos conceptuales:

- tenant_id;
- device_id;
- last_uploaded_sequence;
- last_server_acknowledged_sequence;
- last_downloaded_cursor;
- last_successful_sync_at;
- last_full_reconciliation_at;
- checkpoint_status.

El checkpoint:

- se actualiza transaccionalmente;
- no avanza antes de persistir la confirmación;
- permite reanudar después de reinicios;
- queda aislado por tenant y dispositivo.

### SyncConflict

Representa una operación que no puede aplicarse automáticamente.

Atributos conceptuales:

- conflict_id;
- tenant_id;
- operation_id;
- aggregate_type;
- aggregate_id;
- conflict_type;
- expected_version;
- current_version;
- authority_policy;
- severity;
- resolution_policy;
- status;
- detected_at;
- resolved_at opcional;
- resolved_by opcional;
- resolution_reason opcional.

Una resolución puede:

- aceptar;
- rechazar;
- compensar;
- esperar una dependencia;
- reintentar;
- requerir revisión manual;
- enviar a dead letter.

Un conflicto no se oculta ni sobrescribe silenciosamente el estado existente.

### SyncReview

Representa la intervención autorizada sobre un conflicto.

Atributos conceptuales:

- review_id;
- conflict_id;
- assigned_role;
- assigned_user opcional;
- decision;
- reason;
- evidence_reference opcional;
- created_at;
- resolved_at opcional.

La revisión conserva actor, decisión, motivo y evidencia.

### DeviceClockState

Representa la calidad conocida del reloj de un dispositivo.

Atributos conceptuales:

- tenant_id;
- device_id;
- device_clock_offset;
- clock_quality;
- last_clock_sync_at;
- measured_at_server;
- status.

Valores conceptuales de `clock_quality`:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `UNKNOWN`.

El reloj local sirve como evidencia contextual, no como autoridad global.

### DeviceSyncState

Representa el estado general de sincronización de un dispositivo.

Atributos conceptuales:

- tenant_id;
- device_id;
- connection_status;
- sync_status;
- outbox_depth;
- oldest_pending_at opcional;
- checkpoint_lag;
- last_successful_sync_at opcional;
- last_error_code opcional;
- schema_version;
- device_status.

Este concepto permite diagnosticar:

- colas detenidas;
- dispositivos revocados;
- versiones incompatibles;
- retrasos de sincronización;
- errores persistentes.

### Políticas de autoridad

Cada dominio declara una política conceptual:

- `LOCAL_AUTHORITATIVE_UNTIL_SYNC`;
- `SERVER_AUTHORITATIVE`;
- `APPEND_ONLY_SHARED`;
- `CENTRAL_REVIEW_REQUIRED`;
- `EXTERNAL_PROVIDER_AUTHORITATIVE`;
- `DERIVED_PROJECTION`.

La autoridad no se decide mediante una regla genérica de timestamps.

### Reglas estructurales de sincronización

1. Toda operación crítica tiene identidad global.
2. Todo reintento conserva `operation_id` e `idempotency_key`.
3. Una operación aceptada no se aplica dos veces.
4. El negocio local y la outbox se confirman atómicamente.
5. Los efectos centrales y el inbox se confirman atómicamente.
6. Un checkpoint no avanza sin confirmación persistida.
7. Una operación dependiente conserva causalidad.
8. Un conflicto no modifica silenciosamente el estado existente.
9. El reloj local no define precedencia global.
10. Un dispositivo revocado no sincroniza.
11. Un tenant no puede modificar datos de otro.
12. Los movimientos financieros y de inventario permanecen append-only.
13. Las proyecciones no sustituyen hechos.
14. La recuperación conserva operaciones pendientes.
15. Toda resolución queda auditada.

## Auditoría y soporte

### AuditEvent

Debe ser inmutable y registrar:

- actor;
- tenant;
- empresa;
- sucursal;
- dispositivo;
- acción;
- recurso;
- valor anterior;
- valor nuevo;
- motivo;
- fecha;
- IP;
- correlación.

### SupportTicket

### SupportAccessGrant

Permite acceso temporal y auditado al proveedor.

## Reglas estructurales

1. Toda entidad operativa debe estar aislada por tenant.
2. Las operaciones por sucursal deben incluir branch_id.
3. Los IDs sincronizables deben ser globalmente únicos.
4. Las ventas, pagos, caja e inventario no se eliminan físicamente.
5. Los snapshots históricos no dependen de configuración actual.
6. Los saldos derivados no reemplazan los movimientos fuente.
7. Las relaciones entre módulos deben respetar propiedad de datos.
