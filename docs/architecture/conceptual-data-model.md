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
            ├── UserRoleAssignment con alcance de sucursal
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
- code opcional;
- legal_name;
- status;
- plan_id;
- deployment_mode;
- created_at.

Reglas:

1. `id` UUID v7 es la identidad canónica del tenant.
2. `code`, cuando exista, se normaliza de forma determinista y es único globalmente; es un identificador humano, no reemplaza `id` ni se reutiliza.

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

Reglas:

1. `tax_id`, cuando exista, se normaliza y es único dentro de `tenant_id` conforme a la matriz de restricciones de este documento.
2. `timezone` y `currency` son obligatorios para congelar fecha de negocio y valores monetarios; su modificación no reinterpreta documentos históricos.

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
- tenant_id;
- company_id;
- name;
- code opcional;
- address;
- city;
- latitude;
- longitude;
- timezone;
- status.

Reglas:

1. `code`, cuando exista, se normaliza y es único por `(tenant_id, company_id)`; es un identificador humano, no la PK.
2. La sucursal pertenece a una sola empresa y su `tenant_id` debe coincidir con el de esa empresa.
3. `timezone` es obligatoria y determina `business_date` para operaciones nuevas; cambiarla no altera fechas ya congeladas.

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
7. `email` se normaliza de forma determinista y es único globalmente para autenticación inicial.
8. `phone` se normaliza cuando exista, pero no constituye por sí solo autoridad de pertenencia ni de recuperación.
9. La PK UUID v7 de User es la autoridad de identidad; cambiar correo o teléfono no crea otra identidad.
10. Vincular un onboarding con un User existente exige autenticación, verificación o proceso administrativo autorizado; una coincidencia no basta.

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

Agrupa permisos atómicos dentro de un alcance autorizado.

Atributos conceptuales:

- id;
- code;
- name;
- scope_type;
- version;
- status;
- created_at;
- retired_at opcional.

Reglas:

1. El catálogo de roles es global y administrado por la plataforma.
2. `scope_type` diferencia roles de plataforma y roles de negocio.
3. `code` y `version` identifican de forma única una definición publicada.
4. Un rol utilizado no se elimina ni se modifica retroactivamente; se retira o sustituye mediante otra versión.
5. Esta decisión no habilita roles personalizados por tenant.

### Permission

Representa una acción atómica global e inmutable.

Atributos conceptuales:

- id;
- code;
- module;
- description;
- status;
- created_at;
- retired_at opcional.

Reglas:

1. `code` es globalmente único.
2. Un permiso utilizado se retira; no se elimina ni cambia de significado.
3. La relación versionada entre Role y Permission conserva vigencia e historial.

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

Registra sesiones activas, limitadas y revocables.

Atributos conceptuales:

- id;
- user_id;
- tenant_membership_id opcional hasta seleccionar contexto;
- device_id opcional;
- authenticated_at;
- expires_at;
- last_reauthenticated_at opcional;
- mfa_status;
- authorization_policy_version opcional;
- offline_valid_until opcional;
- revoked_at opcional;
- revoked_by opcional;
- revocation_reason opcional;
- created_at;
- version.

Reglas:

1. Autenticar un User no selecciona implícitamente un tenant.
2. El contexto tenant efectivo requiere una membership activa asociada a la sesión.
3. Una sesión revocada no vuelve a activa.
4. La vigencia offline nunca supera `offline_valid_until` ni amplía permisos conocidos.
5. MFA y reautenticación son evidencias separadas y auditables.
6. Revocar una sesión no elimina su historial.

### SecurityEvent

Registra intentos, cambios y alertas críticas.

## Catálogo

### Product

Representa el producto lógico compartido por empresa.

Atributos conceptuales:

- id;
- tenant_id;
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

Atributos conceptuales mínimos:

- id;
- tenant_id;
- company_id;
- product_id;
- canonical_attributes;
- status;
- created_at.

### ProductPresentation

Representa la forma concreta en la que un producto o variante se compra, almacena o vende.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
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

### ProductIdentifier

Permite varios identificadores por producto, variante o presentación.

Los códigos operativos utilizados para venta, compra o inventario deben resolver finalmente a una presentación.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- product_id;
- variant_id opcional;
- presentation_id;
- identifier_type;
- normalized_value;
- status;
- valid_from;
- valid_until opcional;
- created_at.

El valor activo es único dentro de `(company_id, identifier_type, normalized_value)`. La desactivación conserva historial y no autoriza reutilización inmediata.

### Category

Organiza el catálogo.

### UnitOfMeasure

Representa unidad, gramo, kilogramo, libra, litro, metro, caja, paquete u otra unidad.

### UnitConversion

Define equivalencias entre unidades.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- product_id;
- variant_id opcional;
- source_presentation_id;
- target_presentation_id;
- conversion_factor;
- valid_from;
- valid_until opcional;
- status;
- version;
- created_at.

Origen y destino pertenecen al mismo producto y variante opcional. `conversion_factor` es decimal exacto positivo y una conversión publicada no se modifica retroactivamente.

## Precios

### PriceList

Agrupa reglas de precios.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- name;
- currency;
- status;
- version;
- created_at;
- retired_at opcional.

### ProductPrice

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- price_list_id;
- branch_id opcional;
- sales_channel;
- amount;
- currency;
- valid_from;
- valid_until;
- status;
- pricing_policy_version;
- idempotency_key;
- version;
- created_at.

La resolución conceptual prioriza:

1. presentación;
2. variante;
3. producto.

El precio operativo final debe corresponder a una presentación concreta.

### PriceChange

Conserva historial, responsable y motivo.

### Promotion

Identidad estable de una promoción dentro de Tenant y Company.

### PromotionVersion

Versión inmutable que conserva tipo, condiciones, beneficios, alcances, prioridad, combinación, límites, vigencia, `promotion_policy_version`, checksum, actor y motivo.

Una versión publicada no se edita. No pueden coexistir versiones equivalentes, solapadas, con la misma prioridad y política incompatible dentro del mismo alcance.

### PromotionConsumption

Hecho idempotente que consume un límite de promoción para una venta y permite reconstruir contadores sin reescribir ventas.

### TaxRule

Identidad estable de una regla tributaria perteneciente a Tenant y Company.

### TaxRuleVersion

Versión inmutable que conserva categoría, código, tasa exacta, inclusión en precio, jurisdicción, alcance, prioridad, vigencia, referencia legal, `tax_policy_version`, checksum, actor y motivo.

Una regla activa no se modifica; se cierra su vigencia y se publica otra versión. Dos versiones equivalentes no pueden solaparse con la misma prioridad.

### RoundingPolicy

Política versionada por Tenant y Company que conserva moneda, algoritmo, unidad, vigencia, `rounding_policy_version` y checksum. Para COP, la política aprobada es `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` y produce un solo `payable_amount` antes de los pagos.

## Inventario

### InventoryLocation

Representa bodega, vitrina, caja o ubicación interna.

### StockBalance

Vista o proyección del saldo por:

- tenant;
- empresa;
- sucursal;
- ubicación;
- presentación;
- lote.

No debe ser la única fuente de verdad.

La clave operacional es `(tenant_id, company_id, branch_id, inventory_location_id, presentation_id, lot_id opcional)`. La proyección conserva `on_hand_quantity`, `reserved_quantity`, `available_quantity` y `version`.

### InventoryMovement

Fuente de verdad de existencias.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- inventory_location_id;
- presentation_id;
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
- tenant_id;
- company_id;
- presentation_id;
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
- presentation_id;
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

Representa cada presentación y lote involucrado en un traslado.

Atributos conceptuales:

- id;
- transfer_id;
- presentation_id;
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
6. `presentation_id` es obligatorio y resuelve el producto, variante opcional, unidad y conversión aplicables.

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

Atributos conceptuales mínimos:

- id;
- tenant_id;
- company_id;
- branch_id;
- code;
- status;
- version.

### CashShift

Representa el turno abierto por un usuario.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- cash_register_id;
- device_id;
- user_id;
- opened_at;
- closed_at opcional;
- business_date;
- timezone_id;
- opening_amount;
- expected_amount opcional;
- counted_amount opcional;
- difference opcional;
- status;
- idempotency_key;
- version.

### CashMovement

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- cash_register_id;
- cash_shift_id;
- document_series;
- sale_number;
- movement_type;
- amount;
- currency;
- reference_type;
- reference_id opcional;
- actor_id;
- business_date;
- occurred_at;
- idempotency_key;
- correlation_id;
- created_at.

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
- tenant_id;
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
- fiscal_total_amount;
- commercial_rounding_adjustment;
- payable_amount;
- pricing_pipeline_version;
- pricing_policy_version;
- promotion_policy_version opcional;
- tax_policy_version;
- rounding_policy_version;
- created_at;
- completed_at;
- idempotency_key.

Estados persistentes permitidos:

- `DRAFT`;
- `SUSPENDED`;
- `READY_FOR_PAYMENT`;
- `PAYMENT_IN_PROGRESS`;
- `COMPLETED`;
- `CANCELLED`;
- `EXPIRED`.

Las devoluciones, refunds, reversals, anulaciones fiscales y sus acumulados se representan mediante agregados o proyecciones separados. No se agregan a `Sale.status`.

La numeración humana:

1. no se calcula contando ventas;
2. usa una serie asignada a tenant, sucursal y dispositivo o terminal;
3. incrementa una secuencia local monotónica dentro de la serie;
4. es única por `(tenant_id, branch_id, document_series, sale_number)`;
5. permite saltos, pero no reutilización;
6. no sustituye el UUID global de Sale;
7. cualquier consecutivo fiscal diferente pertenece al documento fiscal y a su política regulatoria.

### SaleItem

Debe referenciar obligatoriamente `presentation_id` y conservar snapshot de:

- product_id;
- variant_id opcional;
- presentation_id;
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

Representa un medio financiero independiente que cubre total o parcialmente una obligación. Una venta puede tener uno o varios pagos relacionados mediante un `PaymentGroup`.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- payment_group_id;
- payment_method;
- expected_amount;
- confirmed_amount;
- currency;
- status;
- idempotency_key;
- version;
- created_at;
- confirmed_at opcional.

Estados persistentes permitidos:

- `CREATED`;
- `PENDING`;
- `PARTIALLY_CONFIRMED`;
- `CONFIRMED`;
- `FAILED`;
- `CANCELLED`;
- `REVIEW_REQUIRED`.

`SETTLED`, `RECONCILED`, `REFUNDED`, `REVERSED` y `CHARGEDBACK` no pertenecen a `Payment.status`.

### PaymentGroup

Agrupa los pagos que cubren una misma venta, pedido, cuenta por cobrar u obligación.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- obligation_type;
- obligation_id;
- currency;
- expected_payable_amount;
- status derivado;
- idempotency_key;
- created_at.

### PaymentAllocation

Relaciona un `Payment` con la obligación o porción que cubre y conserva el importe asignado.

### PaymentAttempt

Representa cada intento técnico u operativo de ejecutar o confirmar un `Payment`.

Conserva identidad global, `payment_id`, proveedor, referencia externa, importe, moneda, estado del intento, idempotencia, correlación, evidencia, errores y timestamps.

Una referencia externa solo puede ser única dentro del contexto de tenant, proveedor y tipo de referencia que la emite.

### Refund

Agregado compensatorio append-only que consume saldo confirmado y elegible sin reescribir `Payment` ni `Sale`.

### RefundItem

### SaleCancellation

Representa la cancelación o invalidación autorizada sin reutilizar estados financieros como estado de venta.

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

Restricciones conceptuales:

- `operation_id` es única globalmente;
- `local_sequence` es única y creciente por `(tenant_id, device_id)`;
- una operación tiene una sola entrada de outbox;
- el negocio y la outbox comparten commit o rollback.

### InboxEntry

Representa el registro central de una operación recibida.

Atributos conceptuales:

- tenant_id;
- operation_id;
- operation_type;
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

El inbox conserva unicidad por `operation_id` y por el alcance `(tenant_id, operation_type, idempotency_key)` de la intención. Inbox y efectos centrales comparten commit o rollback.

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

## Tiempo técnico y fecha comercial

Reglas:

1. `created_at`, `updated_at`, `recorded_at_server`, `received_at_server` y `committed_at_server` son instantes UTC con zona.
2. `occurred_at_local` conserva el instante reportado por el dispositivo junto con `timezone_id` y `utc_offset`; no define autoridad global.
3. `business_date` es una fecha comercial derivada al confirmar la operación usando la zona horaria congelada de la sucursal.
4. Sale, CashShift y movimientos de caja conservan `business_date` de forma explícita.
5. Cambiar la zona horaria de una empresa o sucursal no reescribe fechas comerciales históricas.
6. CashShift conserva `opened_at`, `closed_at` opcional, `business_date` y `timezone_id` utilizados.
7. La fecha operativa, la fecha contable y la fecha de liquidación se almacenan por separado cuando apliquen.
8. `effective_from` y `effective_until` forman intervalos semiabiertos `[from, until)`; un valor final nulo significa vigencia sin fin conocido, no vigencia retroactiva.

## Auditoría y soporte

### AuditEvent

Debe ser inmutable y registrar:

- audit_event_id;
- tenant_id opcional solo para eventos de plataforma o bootstrap previo;
- company_id opcional;
- branch_id opcional;
- actor_type;
- actor_id opcional para actor de sistema;
- session_id opcional;
- device_id opcional;
- action_code;
- resource_type;
- resource_id opcional;
- previous_value opcional;
- new_value opcional;
- reason_code opcional;
- reason_detail opcional;
- occurred_at_local opcional;
- recorded_at_server;
- IP opcional;
- correlation_id;
- causation_id opcional;
- schema_version;
- payload_checksum.

Reglas:

1. Es append-only y no admite actualización destructiva.
2. Un actor de sistema se identifica mediante `actor_type`; la ausencia de `actor_id` no elimina trazabilidad.
3. Las referencias a usuario, dispositivo o recurso no producen borrado en cascada.
4. Los snapshots históricos no se reconstruyen desde configuración actual.
5. Logs, métricas, trazas y eventos de dominio no sustituyen `AuditEvent`.
6. La retención y archivo preservan identidad, checksum y correlación.

### SupportTicket

### SupportAccessGrant

Permite acceso temporal y auditado al proveedor.

## Ciclo de vida y borrado

| Agregado | Política normativa |
|---|---|
| Tenant, Company, Branch | se desactivan, cancelan o terminan; no se eliminan si tienen actividad o referencias |
| User | se desactiva; la privacidad o anonimízación es un proceso separado y auditado |
| TenantMembership, UserRoleAssignment, Session | se suspenden o revocan y conservan historial |
| Role, Permission y política publicada | se retiran o sustituyen mediante versión; no se reescriben |
| Product, ProductVariant, ProductPresentation, ProductIdentifier | se desactivan y no se reutilizan inmediatamente |
| Price, Promotion, TaxPolicy y RoundingPolicy publicadas | expiran o se sustituyen; no alteran snapshots históricos |
| Sale, Payment, Refund, Reversal, Settlement, Reconciliation, CashShift, CashMovement | no admiten hard delete |
| InventoryMovement | no admite hard delete ni update destructivo |
| InventoryReservation | transiciona a consumida, liberada, expirada o cancelada |
| Device, Installation, Activation, License, Revocation | se desactivan, revocan, cancelan o terminan; conservan identidad |
| AuditEvent, SyncOperation, Inbox confirmado | se retienen o archivan conforme política; no se eliminan por cascada |

## Reglas estructurales

1. Toda entidad operativa debe estar aislada por tenant.
2. Las operaciones por sucursal deben incluir branch_id.
3. Los IDs sincronizables usan UUID v7 globalmente único; no se duplica `id` mediante otro `global_id`.
4. Las ventas, pagos, caja e inventario no se eliminan físicamente.
5. Los snapshots históricos no dependen de configuración actual.
6. Los saldos derivados no reemplazan los movimientos fuente.
7. Las relaciones entre módulos deben respetar propiedad de datos.
8. Toda entidad operacional incluye `tenant_id` y valida empresa y sucursal dentro del mismo tenant.
9. Las relaciones históricas no usan borrado en cascada.
10. Los identificadores humanos no sustituyen las PK globales.

## Restricciones mínimas exigibles al modelo físico

| Relación o agregado | Restricción semántica obligatoria |
|---|---|
| Tenant | `code` normalizado globalmente único cuando exista; PK UUID v7 no reutilizable |
| User | `email` normalizado globalmente único; identidad UUID v7 independiente de sus memberships |
| TenantMembership | una identidad lógica por `(tenant_id, user_id)` |
| Role | `code + version` globalmente únicos; scope de plataforma o negocio |
| Permission | `code` globalmente único |
| UserRoleAssignment | membership, rol, empresa y sucursal pertenecen al mismo alcance; no duplica la misma asignación vigente |
| Company | pertenece a un Tenant; `tax_id` normalizado no se duplica dentro del tenant |
| Branch | pertenece a Company/Tenant; `code` es único dentro de Company |
| Product | pertenece a Company/Tenant; `internal_code` activo es único dentro de Company cuando exista |
| ProductPresentation | pertenece al mismo Product/Variant; SKU activo único por Company |
| ProductIdentifier | resuelve una presentación; código activo único por Company |
| Lot | presentación obligatoria; `batch_code` único por Tenant/Company/Presentation |
| StockBalance | una proyección por Tenant/Company/Branch/Location/Presentation/Lot opcional |
| InventoryMovement | presentación, ubicación, tipo, cantidad, actor/operación y timestamp obligatorios; append-only |
| InventoryReservation | cantidad no negativa; consumida + liberada no supera reservada; versión obligatoria para mutar |
| Sale/SaleItem | tenant, empresa, sucursal y presentación consistentes; `(tenant_id, branch_id, document_series, sale_number)` único; importes no se reescriben después de completar |
| PaymentGroup/Payment | misma moneda, tenant y obligación; idempotencia única por alcance operativo; cobertura confirmada no se duplica |
| PaymentAttempt | pertenece a un Payment; referencia externa única por Tenant/Provider/ReferenceType cuando exista |
| Refund/Reversal | importe solicitado, reservado y completado no supera saldo elegible; versión obligatoria |
| CashShift | un solo turno abierto compatible por Tenant/Branch/Register/Terminal |
| CashMovement | pertenece a turno abierto o a corrección autorizada; append-only |
| SyncOperation | UUID global, idempotencia por Tenant/OperationType, checksum inmutable |
| OutboxEntry | una por operation; secuencia única y creciente por Tenant/Device |
| InboxEntry | operation global única; idempotencia y checksum coherentes |
| SyncCheckpoint | uno por Tenant/Device y canal definido; nunca avanza antes del commit |
| Device/Activation | identidad no reutilizable; una solicitud idempotente no crea duplicados; cupo no se excede |
| AuditEvent | UUID global, timestamp servidor, action, resource, correlation y actor type obligatorios; append-only |

Las restricciones anteriores deben expresarse mediante `FK`, `UNIQUE`, `CHECK`, `NOT NULL`, versión optimista o una combinación verificable. Una validación de aplicación no sustituye una restricción de base de datos cuando el motor pueda expresarla.
