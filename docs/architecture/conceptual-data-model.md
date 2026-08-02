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

Representa una presentación o combinación específica.

Ejemplos:

- sabor;
- tamaño;
- color;
- concentración;
- empaque.

### ProductBarcode

Permite varios códigos por producto o variante.

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

- product_id o variant_id;
- price_list_id;
- branch_id opcional;
- sales_channel;
- amount;
- valid_from;
- valid_until;
- status.

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
