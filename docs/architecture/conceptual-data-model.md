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

Representa el derecho contractual emitido para un tenant.

No representa una activación, una sesión, un dispositivo ni un permiso de usuario.

Atributos conceptuales:

- id;
- tenant_id;
- payload_version;
- issuer_id;
- issued_at;
- not_before opcional;
- expires_at opcional;
- deployment_mode;
- contract_status;
- device_limit;
- branch_limit;
- allowed_app_versions;
- offline_policy;
- grace_policy opcional;
- supersedes_license_id opcional;
- signing_key_id;
- signature_algorithm_id;
- canonicalization_version;
- signature.

Valores conceptuales de `contract_status`:

- `TRIAL`;
- `ACTIVE`;
- `PAST_DUE`;
- `SUSPENDED`;
- `CANCELLED`;
- `TERMINATED`.

La vigencia temporal no forma parte de `contract_status`.

Se determina mediante `not_before`, `expires_at` y la evidencia temporal aplicable.

`EXPIRED` es un resultado temporal de evaluación y no un estado contractual persistente.

La gracia se representa mediante `GraceAuthorization`.

La revocación se representa mediante `LicenseRevocation`.

`INVALID` representa un resultado de validación y no un estado contractual.

`RESTRICTED` representa una decisión efectiva de autorización y no un estado contractual base.

Reglas:

1. La licencia pertenece a un tenant.
2. La licencia es distinta de una activación.
3. Los campos que afectan autorización están cubiertos por la firma.
4. Una modificación requiere emitir una nueva versión.
5. Una licencia sustituida conserva historial.
6. Una licencia cancelada, terminada o temporalmente expirada no elimina datos.
7. La licencia local perpetua no incluye automáticamente actualizaciones mayores.
8. El cliente no modifica derechos, límites ni vigencia.
9. `contract_status` no mezcla vigencia temporal, gracia, revocación ni validez criptográfica.
10. La autorización efectiva se calcula a partir del contrato, vigencia, entitlements, gracia, activación, revocaciones y política aplicable.

### FeatureEntitlement

Define una capacidad contractual habilitada por una licencia.

Atributos conceptuales:

- id;
- tenant_id;
- license_id;
- entitlement_version;
- feature_code;
- enabled;
- limit_value opcional;
- valid_from;
- valid_until opcional;
- policy_version.

Reglas:

1. Todo entitlement pertenece a una licencia.
2. Un entitlement no equivale a un permiso de usuario.
3. Los derechos efectivos deben ser verificables.
4. El cliente no amplía módulos ni límites.
5. Un cambio requiere una nueva versión verificable.

### LicenseActivation

Representa la asociación autorizada entre una licencia, un dispositivo y una instalación.

Atributos conceptuales:

- id;
- tenant_id;
- license_id;
- company_id opcional;
- branch_id opcional;
- device_id;
- installation_id;
- device_key_id;
- activation_status;
- payload_version;
- issued_at;
- not_before opcional;
- expires_at opcional;
- offline_authorization;
- grace_policy opcional;
- previous_activation_id opcional;
- replacement_reason opcional;
- signing_key_id;
- signature_algorithm_id;
- signature;
- idempotency_key;
- revoked_at opcional.

Valores conceptuales de `activation_status`:

- `PENDING`;
- `ACTIVE`;
- `SUSPENDED`;
- `REVOKED`;
- `REPLACED`;
- `EXPIRED`;
- `REVIEW_REQUIRED`.

Reglas:

1. Una activación pertenece a una licencia.
2. Una activación no amplía derechos.
3. Una activación referencia una identidad concreta de dispositivo.
4. Una solicitud idempotente no crea activaciones duplicadas.
5. Un reemplazo genera una nueva activación.
6. Una activación revocada no se reutiliza.
7. La activación anterior conserva historial.

### LicenseRevocation

Representa una revocación verificable de una licencia, activación, dispositivo o clave.

Atributos conceptuales:

- id;
- tenant_id;
- target_type;
- target_id;
- reason_code;
- issued_at;
- effective_at;
- sequence;
- payload_version;
- signing_key_id;
- signature.

Valores conceptuales de `target_type`:

- `LICENSE`;
- `ACTIVATION`;
- `DEVICE`;
- `SIGNING_KEY`;
- `UPDATE_KEY`.

Reglas:

1. Toda revocación tiene identidad propia.
2. Una revocación no elimina el objeto afectado.
3. Una secuencia anterior no revierte una revocación posterior.
4. Una revocación conocida se aplica también durante operación offline.
5. El cliente no elimina revocaciones aplicadas.

### GraceAuthorization

Representa una autorización temporal y verificable de continuidad operativa.

Atributos conceptuales:

- id;
- tenant_id;
- license_id;
- activation_id opcional;
- issued_at;
- starts_at;
- ends_at;
- allowed_features;
- restricted_features;
- reason_code;
- grace_sequence;
- payload_version;
- signing_key_id;
- signature.

Reglas:

1. La gracia no se infiere.
2. La gracia no nace de una falla de red.
3. La gracia no corrige una firma inválida.
4. La gracia no amplía derechos originales.
5. Una gracia agotada no se reinicia localmente.
6. Una reinstalación no reinicia la gracia.

### TrustedSigningKey

Representa material público de verificación previamente confiado.

Atributos conceptuales:

- id;
- key_id;
- key_purpose;
- environment;
- public_key;
- algorithm_id;
- key_status;
- valid_from;
- valid_until opcional;
- replaced_by_key_id opcional;
- created_at;
- retired_at opcional;
- revoked_at opcional.

Valores conceptuales de `key_status`:

- `PENDING`;
- `ACTIVE`;
- `ROTATING`;
- `VERIFY_ONLY`;
- `RETIRED`;
- `REVOKED`;
- `COMPROMISED`;
- `DESTROYED`.

Reglas:

1. Solo una clave `ACTIVE` firma artefactos nuevos.
2. `VERIFY_ONLY` permite validar artefactos históricos.
3. Una clave comprometida no vuelve a `ACTIVE`.
4. Una clave retirada no firma artefactos nuevos.
5. Los ambientes no comparten claves de producción.
6. El cliente no acepta claves arbitrarias recibidas junto con un artefacto.

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

Representa una identidad operativa autorizada para ejecutar el POS o servicios relacionados.

La identidad no depende exclusivamente de una huella de hardware.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id opcional;
- type;
- installation_id;
- app_version;
- operating_system;
- trust_status;
- status;
- last_seen_at;
- registered_at;
- revoked_at opcional;
- replacement_device_id opcional.

Valores conceptuales de `trust_status`:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `REVOKED`;
- `UNKNOWN`;
- `REVIEW_REQUIRED`.

Reglas:

1. `device_id` es globalmente único.
2. `device_id` no se reutiliza.
3. `installation_id` identifica una instalación concreta.
4. Una reinstalación limpia genera un nuevo `installation_id`.
5. Un cambio menor de hardware no revoca automáticamente.
6. Un dispositivo revocado no recupera confianza sin autorización.
7. La confianza del dispositivo no sustituye permisos de usuario.

### DeviceKey

Representa una identidad criptográfica asociada a un dispositivo.

Atributos conceptuales:

- id;
- tenant_id;
- device_id;
- device_key_id;
- public_key;
- algorithm_id;
- key_status;
- created_at;
- activated_at opcional;
- rotated_at opcional;
- retired_at opcional;
- revoked_at opcional;
- replacement_key_id opcional;
- proof_method;
- policy_version.

Valores conceptuales de `key_status`:

- `PENDING`;
- `ACTIVE`;
- `ROTATING`;
- `RETIRED`;
- `REVOKED`;
- `COMPROMISED`;
- `UNKNOWN`.

Reglas:

1. La clave privada no se almacena en el modelo central.
2. La clave privada no se transmite al servidor.
3. La misma clave no se comparte entre dispositivos.
4. Una clave revocada o comprometida no autentica nuevas operaciones.
5. La pérdida de la clave requiere recuperación.
6. La rotación conserva trazabilidad.

### DeviceHardwareEvidence

Representa evidencia secundaria sobre el entorno físico o lógico del dispositivo.

Atributos conceptuales:

- id;
- tenant_id;
- device_id;
- evidence_version;
- evidence_hash;
- evidence_type;
- observed_at;
- change_classification;
- risk_status;
- retained_until opcional.

Valores conceptuales de `change_classification`:

- `EXPECTED_CHANGE`;
- `MINOR_CHANGE`;
- `MAJOR_CHANGE`;
- `SUSPICIOUS_CHANGE`;
- `UNKNOWN_CHANGE`.

Reglas:

1. La evidencia de hardware no es identidad principal.
2. No debe contener más datos personales de los necesarios.
3. Un único atributo no produce bloqueo irreversible.
4. La evidencia anterior se conserva para auditoría.
5. Los cambios sospechosos pueden producir degradación o revisión.

### DeviceOperationalState

Representa el estado técnico y de disponibilidad conocido de un dispositivo.

No sustituye `trust_status` ni define derechos de licencia.

Atributos conceptuales:

- tenant_id;
- device_id;
- device_status;
- connectivity_status;
- health_status;
- last_seen_at opcional;
- last_sync_at opcional;
- stale_since_at opcional;
- unreachable_since_at opcional;
- review_status opcional;
- last_transition_at;
- policy_version.

Valores conceptuales de `device_status`:

- `ACTIVE`;
- `OFFLINE`;
- `STALE`;
- `UNREACHABLE`;
- `DEGRADED`;
- `DEACTIVATED`;
- `REVIEW_REQUIRED`.

Reglas:

1. `device_status` no sustituye `trust_status`.
2. `OFFLINE` no implica revocación.
3. `STALE` no implica revocación.
4. `UNREACHABLE` no confirma desinstalación.
5. `last_seen_at` solo avanza después de actividad válida.
6. `last_sync_at` solo avanza después de sincronización confirmada.
7. Los umbrales temporales se definen mediante política versionada.
8. Una transición operativa no amplía permisos ni derechos contractuales.

### DeviceManagementProfile

Representa la modalidad contractual y administrativa bajo la cual se gestiona un dispositivo o activo asociado.

La propiedad del hardware se modela independientemente de la licencia del software.

Atributos conceptuales:

- tenant_id;
- device_id;
- asset_ownership_mode;
- management_mode;
- policy_version;
- managed_since_at opcional;
- management_ends_at opcional;
- status.

Valores conceptuales de `asset_ownership_mode`:

- `CUSTOMER_OWNED`;
- `PROVIDER_OWNED`;
- `LEASED`;
- `MANAGED_ASSET`.

Valores conceptuales de `management_mode`:

- `SOFTWARE_ONLY`;
- `SOFTWARE_MANAGED`;
- `DEVICE_MANAGED`;
- `KIOSK_MANAGED`.

Reglas:

1. La propiedad del activo no modifica `trust_status`.
2. La modalidad de administración no amplía derechos de licencia.
3. `SOFTWARE_ONLY` no autoriza control general del sistema operativo.
4. `DEVICE_MANAGED` y `KIOSK_MANAGED` requieren política y contrato explícitos.
5. Las políticas de administración son versionadas.
6. Toda acción remota sensible queda auditada.
7. Un dispositivo `CUSTOMER_OWNED` no se bloquea para impedir software de terceros.
8. La terminación de administración debe permitir desasociación controlada.

### DeviceActivationRequest

Representa una solicitud de activación online u offline.

Atributos conceptuales:

- id;
- tenant_id;
- license_reference;
- device_id;
- installation_id;
- device_key_id;
- challenge_nonce;
- requested_at_local;
- app_version;
- operating_system_family;
- device_evidence_hash opcional;
- proof_of_possession;
- payload_checksum;
- request_status;
- created_at;
- expires_at;
- idempotency_key.

Reglas:

1. Toda solicitud tiene identidad propia.
2. El nonce no se reutiliza.
3. La misma solicitud idempotente no genera efectos duplicados.
4. La solicitud no contiene claves privadas.
5. Una solicitud vencida se rechaza.

### DeviceActivationResponse

Representa la respuesta verificable emitida para una solicitud de activación.

Atributos conceptuales:

- id;
- request_id;
- activation_id;
- tenant_id;
- license_id;
- device_id;
- installation_id;
- issued_at;
- not_before opcional;
- expires_at opcional;
- activation_status;
- offline_authorization;
- policy_version;
- request_checksum;
- signing_key_id;
- signature.

Reglas:

1. La respuesta queda vinculada a la solicitud original.
2. No puede utilizarse en otro dispositivo.
3. No puede utilizarse en otra instalación.
4. Aplicarla nuevamente produce el mismo resultado o un rechazo de replay.
5. La respuesta debe poder verificarse sin conexión cuando sea offline.

## Identidad y autorización

### User

Representa una identidad autenticable global.

La identidad del usuario es independiente de cualquier tenant concreto.

La pertenencia a tenants se representa exclusivamente mediante `TenantMembership`.

Atributos conceptuales:

- id;
- email;
- phone;
- full_name;
- password_hash;
- status;
- mfa_enabled.

Reglas:

1. `User` no contiene `tenant_id` como autoridad de pertenencia.
2. Un usuario puede no pertenecer todavía a ningún tenant.
3. Un usuario puede pertenecer a más de un tenant únicamente mediante relaciones `TenantMembership` explícitas y autorizadas.
4. La autenticación de un usuario no concede acceso automático a ningún tenant.
5. La identidad global no sustituye roles, permisos ni políticas ABAC.
6. El acceso efectivo requiere una pertenencia válida al tenant correspondiente.

### TenantMembership

Representa la pertenencia explícita de un usuario a un tenant.

Permite separar la identidad autenticada del usuario de su alcance dentro de uno o varios tenants.

Atributos conceptuales:

- id;
- tenant_id;
- user_id;
- membership_type;
- status;
- is_primary;
- created_at;
- activated_at opcional;
- suspended_at opcional;
- revoked_at opcional;
- created_by;
- version.

Valores conceptuales de `membership_type`:

- `OWNER`;
- `ADMIN`;
- `MEMBER`;
- `SERVICE`.

Valores conceptuales de `status`:

- `PENDING`;
- `ACTIVE`;
- `SUSPENDED`;
- `REVOKED`.

Reglas:

1. La pertenencia debe identificar explícitamente `tenant_id` y `user_id`.
2. Un usuario no obtiene acceso a un tenant por coincidencia de correo, teléfono o nombre.
3. Un usuario puede tener más de una pertenencia únicamente cuando la política del producto lo permita.
4. Una pertenencia no concede por sí sola todos los permisos del tenant.
5. Los permisos efectivos se determinan mediante roles, permisos atómicos y políticas ABAC.
6. Una pertenencia `OWNER` identifica al propietario administrativo del tenant.
7. Un tenant debe conservar al menos una pertenencia propietaria válida según la política aplicable.
8. Revocar una pertenencia no elimina al usuario ni los datos del tenant.
9. Las transiciones de estado deben quedar auditadas.
10. Los cambios de propietario requieren autorización reforzada, MFA o reautenticación según política.
11. La identidad del usuario es independiente de una pertenencia específica.
12. `TenantMembership` es la relación normativa entre usuario y tenant para el diseño físico posterior.
### Role

Agrupa permisos.

### Permission

Representa una acción atómica.

### UserRoleAssignment

Asigna un rol a una pertenencia de tenant dentro de un alcance operativo autorizado.

No determina pertenencia al tenant y no sustituye `TenantMembership`.

Atributos conceptuales:

- id;
- tenant_membership_id;
- role_id;
- company_id opcional;
- branch_id opcional;
- status;
- valid_from;
- valid_until opcional;
- created_at;
- created_by;
- revoked_at opcional;
- version.

Reglas:

1. Toda asignación pertenece a una `TenantMembership` válida.
2. El tenant efectivo se deriva de la pertenencia y no de un parámetro libre enviado por el cliente.
3. `company_id`, cuando exista, debe pertenecer al mismo tenant de la pertenencia.
4. `branch_id`, cuando exista, debe pertenecer a la empresa y tenant autorizados.
5. Una asignación de rol no permite acceder a otro tenant.
6. Revocar una asignación no elimina la identidad del usuario ni su pertenencia.
7. Una pertenencia puede tener múltiples asignaciones únicamente cuando la política lo permita.
8. Los permisos efectivos se calculan mediante rol, permisos atómicos y políticas ABAC.
9. La asignación debe conservar historial y auditoría.
10. La ausencia de una asignación requerida produce denegación, no elevación implícita.

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

Representa una reserva explícita de inventario para pedidos u otros procesos pendientes.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- inventory_location_id;
- product_id;
- variant_id opcional;
- lot_id opcional;
- reference_type;
- reference_id;
- quantity;
- consumed_quantity;
- released_quantity;
- status;
- expires_at opcional;
- idempotency_key;
- version;
- created_by;
- created_at;
- updated_at.

Estados conceptuales:

- `ACTIVE`;
- `PARTIALLY_CONSUMED`;
- `CONSUMED`;
- `RELEASED`;
- `EXPIRED`.

Reglas:

1. Una reserva reduce disponibilidad pero no existencia física.
2. Una reserva no constituye una salida definitiva.
3. El consumo debe generar los movimientos de inventario correspondientes.
4. La liberación no genera una entrada ficticia de inventario.
5. Una reserva no puede consumir más cantidad que la reservada.
6. Los cambios sensibles deben respetar control de concurrencia.
7. `idempotency_key` evita creación o transición duplicada por reintentos.
8. La reserva debe permanecer dentro del mismo tenant que el recurso y la operación que la originan.

### InventoryTransfer

Representa el ciclo de vida de un traslado de inventario entre ubicaciones autorizadas.

No sustituye a `InventoryMovement`.

Los movimientos continúan siendo la fuente de verdad de existencias; `InventoryTransfer` conserva la identidad, estado y trazabilidad de la operación que origina los movimientos de salida y entrada.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- source_branch_id;
- source_location_id;
- destination_branch_id;
- destination_location_id;
- status;
- requested_by;
- approved_by opcional;
- dispatched_by opcional;
- received_by opcional;
- requested_at;
- approved_at opcional;
- dispatched_at opcional;
- received_at opcional;
- cancelled_at opcional;
- cancellation_reason opcional;
- idempotency_key;
- version;
- created_at;
- updated_at.

Estados conceptuales:

- `REQUESTED`;
- `APPROVED`;
- `IN_TRANSIT`;
- `RECEIVED`;
- `PARTIALLY_RECEIVED`;
- `CANCELLED`;
- `REJECTED`.

Reglas:

1. Origen y destino deben pertenecer al mismo tenant.
2. Origen y destino deben ser diferentes.
3. Un traslado no modifica directamente `StockBalance`.
4. La salida del origen genera uno o más `InventoryMovement`.
5. La recepción genera uno o más `InventoryMovement` de entrada.
6. Los movimientos asociados deben usar `reference_type = INVENTORY_TRANSFER` y `reference_id = InventoryTransfer.id`.
7. La cantidad global del tenant no cambia salvo diferencias, pérdidas, mermas o ajustes explícitos.
8. Una recepción parcial debe conservarse explícitamente.
9. Una cancelación posterior a la salida requiere compensación explícita.
10. No se eliminan movimientos para revertir un traslado.
11. Los cambios de estado deben respetar control de concurrencia.
12. `idempotency_key` debe impedir creación o ejecución duplicada por reintentos.

### InventoryTransferLine

Representa cada producto, variante y lote involucrado en un traslado.

Atributos conceptuales:

- id;
- transfer_id;
- product_id;
- variant_id opcional;
- lot_id opcional;
- requested_quantity;
- dispatched_quantity;
- received_quantity;
- difference_quantity;
- base_unit;
- status;
- created_at;
- updated_at.

Reglas:

1. Las cantidades no pueden ser negativas.
2. `dispatched_quantity` no puede superar la cantidad autorizada salvo política explícita.
3. `received_quantity` puede ser menor que `dispatched_quantity`, pero la diferencia debe quedar registrada.
4. Una diferencia no se corrige mediante sobrescritura silenciosa.
5. Las diferencias deben producir ajuste, incidencia, revisión o compensación según política.

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
