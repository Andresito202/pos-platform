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
            ├── GoodsReceipt
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
- name;
- status;
- created_at.

Reglas:

1. `id` UUID v7 es la identidad canónica del tenant.
2. `code`, cuando exista, se normaliza de forma determinista y es único globalmente; es un identificador humano, no reemplaza `id` ni se reutiliza.
3. El plan efectivo, la modalidad de despliegue y los entitlements pertenecen a `License`; no se duplican como autoridad en `Tenant`.

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
- legal_name opcional;
- trade_name;
- tax_id opcional;
- email opcional;
- phone opcional;
- timezone;
- currency;
- status.

Reglas:

1. `tax_id`, cuando exista, se normaliza y es único dentro de `tenant_id` conforme a la matriz de restricciones de este documento.
2. `timezone` y `currency` son obligatorios para congelar fecha de negocio y valores monetarios; su modificación no reinterpreta documentos históricos.
3. `trade_name` materializa el `company_name` obligatorio de onboarding; `legal_name` solo se exige cuando el contrato comercial o fiscal aplicable lo requiera.

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
- address opcional;
- city opcional;
- latitude opcional;
- longitude opcional;
- timezone;
- status.

Reglas:

1. `code`, cuando exista, se normaliza y es único por `(tenant_id, company_id)`; es un identificador humano, no la PK.
2. La sucursal pertenece a una sola empresa y su `tenant_id` debe coincidir con el de esa empresa.
3. `timezone` es obligatoria y determina `business_date` para operaciones nuevas; cambiarla no altera fechas ya congeladas.

### OnboardingOperation

Representa la identidad, el estado y el resultado idempotente de `UC-ONB-001`.

Puede existir antes de que se cree el tenant y no sustituye los estados de tenant, licencia, usuario, sesión, dispositivo o sucursal.

Atributos conceptuales:

- id;
- actor_id;
- idempotency_key;
- request_checksum;
- correlation_id;
- tenant_id opcional;
- company_id opcional;
- branch_id opcional;
- owner_user_id opcional;
- tenant_membership_id opcional;
- status;
- reason_code opcional;
- license_reference opcional;
- requested_plan opcional;
- effective_plan opcional;
- pricing_policy_version opcional;
- tax_policy_version opcional;
- rounding_policy_version opcional;
- authorization_policy_version opcional;
- required_action opcional;
- created_at;
- updated_at;
- completed_at opcional;
- cancelled_at opcional.

Valores conceptuales de `status`:

- `PENDING`;
- `IN_PROGRESS`;
- `READY_FOR_LICENSE`;
- `READY_FOR_ACTIVATION`;
- `COMPLETED`;
- `FAILED`;
- `CANCELLED`;
- `REVIEW_REQUIRED`.

Reglas:

1. La misma identidad de idempotencia y el mismo `request_checksum` devuelven el mismo onboarding y resultado.
2. Reutilizar la misma identidad de idempotencia con otro checksum produce conflicto y no modifica el resultado existente.
3. `tenant_id`, `company_id`, `branch_id`, `owner_user_id` y `tenant_membership_id` permanecen opcionales hasta que la transacción de bootstrap confirme esos efectos.
4. Un estado `COMPLETED` exige que el resultado mínimo de `UC-ONB-001` haya quedado confirmado.
5. Las referencias de políticas registran las versiones aplicadas; no copian ni reemplazan sus reglas.
6. La emisión o activación de licencia y el registro de dispositivos son operaciones posteriores e idempotentes.
7. La cancelación o el fallo no eliminan silenciosamente estructuras ya confirmadas ni su auditoría.
8. La operación, sus efectos críticos, el resultado idempotente y la outbox se confirman en la frontera transaccional definida por `UC-ONB-001`.

### Device

Representa una identidad operativa autorizada para ejecutar el POS o servicios relacionados.

La identidad no depende exclusivamente de una huella de hardware.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id opcional;
- type;
- trust_status;
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
3. Las instalaciones asociadas se representan mediante `Installation`; `Device` no usa `installation_id` como identidad propia.
4. Un cambio menor de hardware no revoca automáticamente.
5. Un dispositivo revocado no recupera confianza sin autorización.
6. La confianza del dispositivo no sustituye permisos de usuario.

### Installation

Representa una instalación concreta de la aplicación POS y mantiene identidad independiente de dispositivo, clave, activación y licencia.

Atributos conceptuales:

- id;
- tenant_id;
- device_id opcional hasta completar el registro autorizado;
- app_version;
- operating_system;
- created_at;
- linked_at opcional;
- retired_at opcional;
- replacement_installation_id opcional.

Reglas:

1. `installation_id` es globalmente único y no se reutiliza.
2. Una reinstalación limpia crea una nueva `Installation`.
3. Una instalación puede existir antes de quedar vinculada a un `Device`, pero no obtiene por ello confianza, licencia ni activación.
4. Cuando `device_id` exista, la instalación y el dispositivo deben pertenecer al mismo tenant.
5. Retirar o reemplazar una instalación conserva su historia y no revive ni transfiere activaciones automáticamente.
6. La instalación no sustituye `DeviceKey`, `LicenseActivation` ni `License`.

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
- installation_id;
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
9. El estado operativo identifica la instalación observada; una señal de una instalación retirada no actualiza silenciosamente la instalación vigente.

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
- status.

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
11. Las credenciales y los factores MFA tienen ciclo de vida propio; `User` no almacena una bandera que los sustituya.

### UserCredential

Representa una credencial verificable asociada a una identidad global.

Atributos conceptuales:

- id;
- user_id;
- credential_type;
- verifier;
- status;
- failed_attempt_count;
- locked_until opcional;
- created_at;
- rotated_at opcional;
- last_used_at opcional;
- revoked_at opcional;
- retained_until opcional;
- version.

Reglas:

1. Para contraseña, `verifier` contiene únicamente un hash resistente con parámetros y salt propios; nunca contraseña, pista ni valor reversible.
2. El tipo de credencial debe estar soportado por un contrato implementado; el modelo no acepta mecanismos desconocidos por configuración libre.
3. Los intentos fallidos y el bloqueo temporal se actualizan de forma controlada y auditable.
4. Rotar o revocar una credencial conserva historia suficiente sin permitir reutilizar el verificador anterior.
5. Una credencial válida no concede pertenencia, rol ni contexto tenant.
6. Una credencial retirada no se purga antes de `retained_until` ni mientras sea necesaria para investigar un evento de seguridad; la duración concreta pertenece a la política de retención y no se inventa en el modelo.

### MfaFactor

Representa un segundo factor registrado y verificable para un usuario.

Atributos conceptuales:

- id;
- user_id;
- factor_type;
- secret_reference opcional;
- status;
- enrolled_at;
- verified_at opcional;
- last_used_at opcional;
- revoked_at opcional;
- retained_until opcional;
- version.

Reglas:

1. Un factor solo satisface MFA después de quedar verificado y vigente.
2. Los secretos o claves privadas del factor no se almacenan como texto plano; cuando existan se custodian mediante la referencia permitida por `SEC-004`.
3. La presencia de un factor no implica que toda sesión haya completado MFA.
4. Revocar un factor no elimina los eventos de seguridad ni la evidencia de sesiones anteriores.
5. Cada `factor_type` requiere contrato, almacenamiento y pruebas propios antes de habilitarse; este modelo no selecciona un proveedor o método por anticipado.
6. Un factor retirado no se purga antes de `retained_until` ni mientras sea necesario para una investigación o auditoría aplicable.

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

### RolePermissionGrant

Representa la relación publicada y versionada entre un rol y un permiso atómico.

Atributos conceptuales:

- id;
- role_id;
- permission_id;
- grant_version;
- status;
- valid_from;
- valid_until opcional;
- created_at;
- retired_at opcional.

Reglas:

1. Un grant solo referencia definiciones existentes de `Role` y `Permission`.
2. La combinación publicada de rol, permiso y versión no se modifica retroactivamente.
3. Retirar un grant conserva el historial y no elimina el permiso ni el rol.
4. Un grant no amplía el alcance definido por `UserRoleAssignment`, pertenencia o política ABAC.
5. La ausencia de un grant vigente produce denegación explícita.

### AuthorizationPolicyVersion

Identifica la versión exacta del conjunto determinista de reglas ABAC aplicado por backend.

Atributos conceptuales:

- id;
- code;
- version;
- ruleset_checksum;
- status;
- effective_from;
- effective_until opcional;
- created_at;
- retired_at opcional.

Reglas:

1. `code` y `version` identifican de forma única una política publicada.
2. `ruleset_checksum` vincula el registro con reglas backend revisadas y probadas; no sustituye las reglas ni las guarda como JSON opaco autoritativo.
3. Una política ABAC solo restringe permisos atómicos existentes; nunca crea permisos por sí misma.
4. Las decisiones sensibles registran la versión aplicada y un `reason_code` estable.
5. Una versión utilizada no se modifica retroactivamente; se retira o sustituye por otra.
6. No existe una `Configuration` global que la contenga. Su lifecycle, checksum y vigencia pertenecen a Authorization, y una versión local nunca amplía permisos atómicos.

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

### SessionRefreshToken

Representa un token de renovación rotatorio sin persistir el token utilizable.

Atributos conceptuales:

- id;
- session_id;
- token_family_id;
- parent_token_id opcional;
- token_hash;
- issued_at;
- expires_at;
- consumed_at opcional;
- replacement_token_id opcional;
- revoked_at opcional;
- revocation_reason opcional;
- reuse_detected_at opcional;
- retained_until opcional.

Reglas:

1. Solo se persiste un hash no reversible del refresh token; el token utilizable no entra a base, logs ni auditoría.
2. Un token consumido, vencido o revocado no vuelve a ser válido.
3. La rotación consume el token anterior y crea un sucesor dentro de la misma familia.
4. Detectar reutilización revoca la familia según la política y genera `SecurityEvent`.
5. Revocar la sesión invalida todos sus refresh tokens vigentes.
6. Un refresh token no cambia por sí mismo usuario, tenant, pertenencia, roles ni permisos de la sesión.
7. El hash y la metadata de un token invalidado se conservan hasta `retained_until` cuando sean necesarios para detectar reutilización; nunca se conserva el token utilizable.

### OfflineAuthorizationSnapshot

Representa el contexto mínimo, limitado y verificable con el que una instalación puede autorizar operaciones offline.

Atributos conceptuales:

- id;
- tenant_id;
- user_id;
- tenant_membership_id;
- device_id;
- installation_id;
- authorization_policy_version;
- permission_codes;
- company_scopes;
- branch_scopes;
- mfa_evidence opcional;
- issued_at;
- expires_at;
- payload_version;
- payload_checksum;
- signing_key_id;
- signature;
- revoked_at opcional.

Reglas:

1. El snapshot no contiene contraseña, factor MFA, access token, refresh token ni secreto reutilizable.
2. Solo conserva permisos y scopes efectivos ya autorizados; no permite elevarlos localmente.
3. Pertenece a un usuario, membership, dispositivo e instalación concretos del mismo tenant.
4. Su vigencia no supera la sesión ni `offline_valid_until` que lo originan.
5. Se verifica firma, checksum, versión, vigencia y revocaciones conocidas antes de usarlo.
6. Una revocación conocida prevalece sobre el snapshot.
7. Cambiar roles, política o instalación exige otro snapshot; el anterior conserva historia pero no se reescribe.

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
- brand_id opcional;
- category_id opcional según política del tipo de producto;
- product_type;
- variant_policy;
- base_unit_id;
- stock_controlled;
- lot_controlled;
- expiration_controlled;
- serial_controlled;
- tax_category_id opcional;
- business_attributes;
- status;
- created_at;
- updated_at;
- version.

Valores conceptuales de `status`:

- `DRAFT`;
- `ACTIVE`;
- `INACTIVE`.

Reglas:

1. `internal_code`, cuando exista, es único dentro de la empresa y no se reutiliza silenciosamente al desactivar.
2. `base_unit_id` debe ser compatible con la naturaleza y precisión del producto.
3. Un producto con `expiration_controlled` requiere `lot_controlled`.
4. Crear o actualizar Product no crea stock ni precio implícito.
5. Los cambios incompatibles con movimientos existentes requieren migración controlada; no reescriben historia.
6. `business_attributes` solo contiene atributos realmente abiertos y validados por tipo; no sustituye relaciones, estados, unidad, impuestos ni controles.

### Brand

Representa una marca comercial referenciable dentro del catálogo de una empresa.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- name;
- name_normalized;
- status;
- created_at;
- retired_at opcional;
- version.

Reglas:

1. Una marca pertenece a una empresa y no se comparte implícitamente entre tenants.
2. El nombre normalizado activo es único dentro de la empresa.
3. Retirar una marca no altera productos ni snapshots históricos.

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
- unit_id;
- contained_quantity;
- quantity_scale;
- variable_quantity;
- minimum_quantity opcional;
- maximum_quantity opcional;
- tare_quantity opcional;
- scale_format opcional;
- sales_enabled;
- purchasing_enabled;
- inventory_enabled;
- breakable;
- stock_mode;
- active.

Toda presentación pertenece a un producto y, cuando exista variante, esta debe pertenecer al mismo producto.

Todo artículo vendible debe resolver finalmente a una presentación.

La presentación define la precisión física de sus cantidades. Los límites y la tara solo aplican cuando `variable_quantity = true` y deben usar su misma unidad y precisión.

`base_presentation_id` y `conversion_factor` son entradas opcionales de creación que, cuando se informan, producen una `UnitConversion` versionada dentro de la misma operación. No se duplican como autoridad mutable en ProductPresentation.

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

Organiza de forma plana el catálogo de una empresa sin introducir jerarquías no exigidas por los casos de uso vigentes.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- code opcional;
- code_normalized opcional;
- name;
- name_normalized;
- status;
- created_at;
- retired_at opcional;
- version.

Reglas:

1. Category pertenece a una empresa.
2. Nombre normalizado y código normalizado, cuando exista, son únicos dentro de la empresa mientras estén vigentes.
3. Una categoría retirada conserva productos y operaciones históricas; no se elimina en cascada.
4. No se crea `parent_category_id` hasta que un caso de uso defina jerarquía, movimientos y prevención de ciclos.

### UnitOfMeasure

Representa una unidad física publicada y reutilizable para cantidades de catálogo.

Atributos conceptuales:

- id;
- code;
- name;
- symbol;
- dimension;
- precision_scale;
- status;
- created_at;
- retired_at opcional.

Valores conceptuales de `dimension`:

- `COUNT`;
- `MASS`;
- `VOLUME`;
- `LENGTH`;
- `AREA`;
- `PACKAGING`;
- `TIME`;
- `SERVICE`.

Reglas:

1. El catálogo inicial es global, publicado y administrado por plataforma; un tenant no crea unidades arbitrarias en esta fase.
2. `code` es globalmente único e inmutable.
3. `precision_scale` está entre 0 y 6 y define la granularidad máxima autorizada para cantidades.
4. Una unidad retirada permanece verificable para historia.
5. Conversiones entre dimensiones distintas solo existen mediante una equivalencia explícita de producto y presentación; nunca por una tabla global implícita.
6. Empaques comerciales concretos siguen siendo ProductPresentation aunque su unidad tenga dimensión `PACKAGING`.

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

### PricingPolicy

Identidad estable, perteneciente a Tenant y Company, de la política determinista que resuelve precios, descuentos y promociones. No contiene reglas tributarias ni una precedencia global implícita.

### PricingPolicyVersion

Versión inmutable publicada que conserva scopes, prioridades, vigencias, elegibilidad, composición, desempates, checksum, actor y motivo. Toda regla aplicable referencia la versión exacta.

La resolución conceptual de la identidad vendible prioriza:

1. presentación;
2. variante;
3. producto.

El precio operativo final debe corresponder a una presentación concreta.

La precedencia entre reglas comerciales no se deriva automáticamente del nivel Branch, Company, Tenant o Platform. Cada versión declara scope, prioridad, política de resolución, vigencia, elegibilidad y desempate. Igual prioridad sin desempate normativo produce ambigüedad explícita; no se resuelve por timestamp.

### PriceChange

Conserva historial, responsable y motivo.

### Promotion

Identidad estable de una promoción dentro de Tenant y Company.

### PromotionVersion

Versión inmutable que conserva tipo, condiciones, beneficios, alcances, prioridad, combinación, límites, vigencia, `promotion_policy_version`, checksum, actor y motivo.

Una versión publicada no se edita. No pueden coexistir versiones equivalentes, solapadas, con la misma prioridad y política incompatible dentro del mismo alcance.

### PromotionConsumption

Hecho idempotente que consume un límite de promoción para una venta y permite reconstruir contadores sin reescribir ventas.

## Impuestos

Tax es un dominio independiente y autoridad de reglas, clasificación, tasas, vigencia, cálculo y resultado tributario. Pricing consume su resultado en el pipeline; Electronic Invoicing consume el snapshot tributario de la operación sin poseerlo ni recalcularlo.

### TaxRule

Identidad estable de una regla tributaria perteneciente a Tenant y Company.

### TaxRuleVersion

Versión inmutable que conserva categoría, código, tasa exacta, inclusión en precio, jurisdicción, alcance, prioridad, vigencia, referencia legal, `tax_policy_version`, checksum, actor y motivo.

Una regla activa no se modifica; se cierra su vigencia y se publica otra versión. Dos versiones equivalentes no pueden solaparse con la misma prioridad.

## Redondeo comercial

### RoundingPolicy

Identidad estable de la política de redondeo comercial perteneciente a Tenant y Company.

### RoundingPolicyVersion

Versión inmutable publicada que conserva moneda, algoritmo, unidad, vigencia, `rounding_policy_version`, checksum, actor y motivo. Para COP, la política aprobada es `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` y produce un solo `payable_amount` antes de los pagos.

## Inventario

### InventoryPolicy

Identidad estable, perteneciente a Tenant y Company y opcionalmente limitada a Branch, de las políticas operativas que Inventory posee.

### InventoryPolicyVersion

Versión inmutable publicada que solo puede representar reglas normativamente aprobadas sobre FIFO/FEFO, vencimiento, stock negativo, reservas, restricciones offline y ajustes explícitos. Conserva vigencia, checksum, actor, motivo y versión sustituida; no usa payload JSON libre.

`InventoryPolicy` no contiene GoodsReceipt, InventoryMovement, StockBalance, reservas ni ajustes: estos conservan su identidad y ciclo propios. Una operación registra la versión aplicada y el resultado determinista; la política nueva no reescribe hechos anteriores.

### InventoryLocation

Representa bodega, vitrina, caja o ubicación interna.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- code;
- name;
- location_type;
- status;
- created_at;
- retired_at opcional;
- version.

Valores conceptuales de `location_type`:

- `WAREHOUSE`;
- `DISPLAY`;
- `CASH_REGISTER`;
- `INTERNAL`.

Reglas:

1. La ubicación pertenece a una sola sucursal, empresa y tenant.
2. El código es único dentro de la sucursal y no se reutiliza silenciosamente.
3. Retirar una ubicación impide movimientos nuevos, pero conserva movimientos y saldos históricos.

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
- unit_id;
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
- supplier_id opcional;
- batch_code;
- manufacture_date;
- expiration_date;
- received_at;
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

## Recepción y compras futuras

### Supplier

Representa un proveedor válido dentro de una empresa para operaciones de recepción.

Atributos conceptuales mínimos respaldados por `UC-INVENTORY-001`:

- id;
- tenant_id;
- company_id;
- name;
- name_normalized;
- status;
- created_at;
- retired_at opcional;
- version.

Reglas:

1. Supplier pertenece a una empresa y no se comparte implícitamente entre tenants.
2. Una recepción solo usa un proveedor activo del mismo tenant y empresa.
3. Retirar un proveedor conserva recepciones, lotes y costos históricos.
4. Datos fiscales, crédito, contactos y condiciones comerciales requieren un caso de uso de proveedores/compras; no se inventan en esta fase.

### PurchaseOrder

Concepto diferido a `PUR-001`. Representará una intención comercial de compra con líneas propias cuando su caso de uso defina identidad, estados, aprobación, cumplimiento y corrección. No forma parte del contrato físico del primer release y no es requisito para confirmar una recepción.

El modelo objetivo no contiene un agregado genérico `Purchase`: orden de compra, recepción física, documento del proveedor, cuenta por pagar y pago al proveedor son responsabilidades diferentes. `SupplierDocument`, `AccountsPayable` y `SupplierPayment` permanecen diferidos; `SupplierPayment` no comparte el agregado `Payment` utilizado para cobros.

### GoodsReceipt

Representa la recepción confirmada de mercancía; no es una factura de compra ni la fuente directa del saldo.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- inventory_location_id;
- supplier_id;
- received_at;
- received_by;
- idempotency_key;
- request_checksum;
- created_at.

Reglas:

1. Tenant, empresa, sucursal, ubicación y proveedor deben coincidir.
2. La recepción confirmada es inmutable; errores posteriores se compensan mediante movimientos explícitos.
3. La misma idempotency key/checksum devuelve la misma recepción; checksum distinto produce conflicto.
4. Confirmar crea líneas, asignaciones, lotes cuando correspondan, movimientos, costos, auditoría y outbox en una sola transacción local.
5. La recepción no crea ni modifica precio de venta.
6. GoodsReceipt puede existir sin PurchaseOrder; esa independencia no reduce trazabilidad de Supplier, ubicación, líneas, asignaciones y movimientos.
7. Una recepción utiliza exactamente una `inventory_location_id`; mercancía recibida en otra ubicación exige otra recepción.
8. La recepción no es factura, cuenta por pagar ni pago al proveedor, y no calcula impuestos de compra, landed cost o valoración contable.

Cardinalidades:

1. Un `GoodsReceipt` tiene una o más `GoodsReceiptLine`; cada línea pertenece exactamente a una recepción.
2. Una `GoodsReceiptLine` tiene una o más `GoodsReceiptLotAllocation`; cada asignación pertenece exactamente a una línea.
3. Una asignación referencia cero o un `Lot`; un Lot puede recibir cero o muchas asignaciones a lo largo del tiempo.
4. Cada asignación de una recepción confirmada referencia exactamente un `InventoryMovement` de entrada y ese movimiento no pertenece a otra asignación.
5. Cada línea confirmada origina exactamente un `InventoryCostRecord`.

### GoodsReceiptLine

Entidad de `GoodsReceipt` que congela la presentación, las cantidades y el costo declarado usados al recibir.

Atributos conceptuales:

- id;
- tenant_id;
- goods_receipt_id;
- line_number;
- presentation_id;
- source_unit_id;
- source_quantity;
- inventory_quantity;
- unit_cost;
- currency_code;
- cost_tax_treatment: `INCLUDED`, `EXCLUDED` o `UNKNOWN`;
- unit_conversion_id opcional;
- conversion_factor opcional;
- conversion_version opcional.

Reglas:

1. Cantidades son positivas y respetan precisión de sus unidades/presentación.
2. `inventory_quantity` conserva el resultado exacto en la unidad de inventario; no reemplaza la cantidad fuente.
3. Costo no es negativo y no modifica Pricing; expresa costo de recepción, no costo contable, valoración ni precio de venta.
4. Moneda y tratamiento tributario quedan congelados; `UNKNOWN` conserva ausencia de evidencia y no ejecuta cálculo tributario.
5. Identidad, factor y versión de conversión son todos ausentes o forman un conjunto completo y coherente.
6. Cada línea tiene una o más `GoodsReceiptLotAllocation` y la suma de sus cantidades coincide exactamente con `inventory_quantity`.

### GoodsReceiptLotAllocation

Entidad de `GoodsReceiptLine` que distribuye su cantidad inventariable entre lotes. También existe una asignación con `lot_id` ausente cuando la presentación no controla lote, de modo que toda cantidad recibida conserve una causa única para su movimiento.

Atributos conceptuales:

- id;
- tenant_id;
- goods_receipt_line_id;
- allocation_number;
- inventory_quantity;
- lot_id opcional.

Reglas:

1. La asignación pertenece al mismo tenant, empresa, presentación y recepción que su línea y lote.
2. `inventory_quantity` es positiva y respeta la precisión inventariable de la presentación.
3. Cada asignación origina exactamente un `InventoryMovement` de entrada, en la ubicación de su `GoodsReceipt`.
4. Una asignación confirmada no se actualiza ni elimina; una corrección crea un movimiento compensatorio nuevo.

### InventoryCostRecord

Hecho append-only que conserva el costo recibido sin convertirlo en precio de venta.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- presentation_id;
- goods_receipt_line_id;
- unit_cost;
- currency_code;
- cost_tax_treatment;
- source_quantity;
- source_unit_id;
- conversion_factor opcional;
- conversion_version opcional;
- effective_at;
- recorded_by;
- recorded_source;
- created_at.

Reglas:

1. El registro de costo se origina en una línea confirmada y no se actualiza destructivamente.
2. La política de valoración consume estos hechos; no reescribe la recepción.
3. Corregir un costo exige un hecho compensatorio o un caso de uso posterior explícito.
4. No calcula landed cost, promedio ponderado, valoración contable ni impuestos de compra.

### SupplierReturn

Concepto diferido a `PUR-001`. Una devolución al proveedor será una operación nueva que cause movimientos de salida referenciados y nunca anulará, editará o eliminará una recepción confirmada.

La recepción física y el documento del proveedor se modelan separadamente. El documento puede llegar antes o después de la mercancía y afectar valoración u obligación cuando exista el contrato futuro, pero nunca modifica inventario directamente.

## Caja

### CashRegister

Representa la caja física o lógica.

Atributos conceptuales mínimos:

- id;
- tenant_id;
- company_id;
- branch_id;
- code;
- currency_code;
- status;
- version.

Reglas:

1. CashRegister pertenece a una sucursal y opera en una moneda definida.
2. Retirar una caja no elimina turnos, movimientos, conteos o auditoría.

### CashShift

Representa el turno abierto por un usuario.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- cash_register_id;
- origin_device_id;
- opened_by;
- opened_at;
- closed_at opcional;
- business_date;
- timezone_id;
- currency_code;
- closed_by opcional;
- status;
- opening_idempotency_key;
- closing_idempotency_key opcional;
- last_movement_sequence;
- version.

Estados persistentes:

- `OPEN`;
- `CLOSING`;
- `CLOSED`.

Reglas:

1. La base inicial se deriva del único CashMovement `OPENING_FLOAT` `POSTED` del turno; no existe una segunda autoridad mutable ni FK circular.
2. Un turno cerrado tiene exactamente un CashCount `CLOSING` completado, relacionado por el turno y protegido por unicidad; no admite edición destructiva.
3. ExpectedCash se deriva de CashMovement `POSTED`; el turno no conserva un saldo esperado mutable.
4. Cada movimiento obtiene una secuencia monotónica dentro del turno y aumenta su versión.
5. Apertura y cierre tienen idempotencia/checksum independientes.

### CashMovement

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- cash_register_id;
- cash_shift_id;
- shift_sequence;
- movement_type;
- direction;
- amount;
- currency_code;
- status;
- reference_type;
- reference_id opcional;
- original_cash_movement_id opcional;
- reason_code;
- evidence_reference opcional;
- actor_type;
- actor_id opcional;
- approved_by opcional;
- business_date;
- occurred_at;
- device_reported_at;
- origin_device_id;
- idempotency_key;
- request_checksum;
- correlation_id;
- version;
- created_at.

Tipos conceptuales:

- `OPENING_FLOAT`;
- `CASH_SALE`;
- `CASH_PAYMENT`;
- `CHANGE_GIVEN`;
- `CASH_REFUND`;
- `CASH_REVERSAL_COMPENSATION`;
- `CASH_WITHDRAWAL`;
- `CASH_DEPOSIT`;
- `COURIER_COLLECTION`;
- `CASH_EXPENSE`;
- `CASH_ADJUSTMENT_POSITIVE`;
- `CASH_ADJUSTMENT_NEGATIVE`;
- `TRANSFER_TO_SAFE`;
- `TRANSFER_FROM_SAFE`;
- `CLOSING_TRANSFER`;
- `OTHER_AUTHORIZED`.

Estados persistentes:

- `CREATED`;
- `PENDING_APPROVAL`;
- `APPROVED`;
- `POSTED`;
- `REJECTED`;
- `FAILED`;
- `CANCELLED`;

Reglas:

1. Importe es positivo y dirección `IN`/`OUT` determina el efecto.
2. Solo movimientos `POSTED` participan en ExpectedCash.
3. Un movimiento `POSTED` es inmutable; corregirlo crea un movimiento compensatorio relacionado.
4. `(tenant_id, cash_shift_id, shift_sequence)` identifica el orden autoritativo dentro del turno.
5. Un movimiento pertenece al mismo tenant, empresa, sucursal, caja, turno y moneda.
6. `REVERSED_BY_COMPENSATION` es una proyección derivada; el movimiento original conserva estado persistido `POSTED`.

### CashPolicy

Identidad estable, perteneciente a Tenant y Company y opcionalmente limitada a Branch, de la política operativa de caja.

### CashPolicyVersion

Versión inmutable publicada que conserva únicamente reglas aprobadas de conteo, tolerancia, clasificación de diferencias, aprobación y restricciones offline. Conserva moneda y tipo cuando la regla los necesita, vigencia, checksum, actor, motivo y versión sustituida; no usa payload JSON libre.

`CashPolicy` no contiene ni sustituye `CashShift`, `CashMovement`, `CashCount` o revisiones. Esas operaciones conservan ciclo e identidad propios y registran las versiones de cálculo/tolerancia utilizadas.

### CashCount

Agregado que conserva la evidencia física de un arqueo parcial, cierre o corrección sin modificar CashMovement.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- cash_register_id;
- cash_shift_id;
- count_type: `PARTIAL`, `CLOSING` o `CORRECTION`;
- status: `IN_PROGRESS`, `COMPLETED` o `ABORTED`;
- blind_mode;
- started_shift_version;
- movement_cutoff_sequence;
- calculation_policy_version;
- calculation_checksum;
- expected_amount opcional hasta completar;
- counted_amount opcional hasta completar;
- difference_amount opcional hasta completar;
- difference_type opcional: `SHORTAGE`, `EXACT` u `OVERAGE`;
- severity opcional;
- currency_code;
- denomination_breakdown_status: `PROVIDED` o `NOT_PROVIDED`;
- tolerance_policy_version;
- tolerance_policy_checksum;
- supersedes_cash_count_id opcional;
- started_by;
- started_at;
- completed_by opcional;
- completed_at opcional;
- aborted_by opcional;
- aborted_at opcional;
- abort_reason_code opcional;
- origin_device_id;
- start_idempotency_key;
- completion_idempotency_key opcional;
- correlation_id;
- version.

Reglas:

1. Iniciar congela versión del turno y corte de movimientos; completar exige la misma versión o deja el conteo `ABORTED` y produce conflicto.
2. ExpectedCash se calcula desde movimientos `POSTED` hasta el corte y se congela con versión/checksum.
3. En arqueo ciego, expected_amount no se revela al actor antes de completar.
4. Un CashCount completado es inmutable y no crea ajustes automáticos.
5. Un conteo incorrecto crea CashCount `CORRECTION` relacionado; el original permanece y cada conteo admite como máximo un sucesor directo para formar una cadena lineal. La corrección conserva corte, esperado, moneda y políticas versionadas del conteo corregido.
6. Una corrección posterior al cierre no reemplaza el CashCount `CLOSING` original ni reescribe CashShift.
7. Todo CashCount completado con diferencia distinta de cero crea una CashDifferenceReview.

### CashCountDenomination

Entidad inmutable de CashCount que conserva denominación, valor, cantidad entera, subtotal y moneda. Cuando existe desglose, la suma de subtotales coincide exactamente con counted_amount.

### CashDifferenceReview

Agregado que representa revisión, aceptación, escalamiento y resolución de una diferencia sin modificar el conteo.

Estados persistentes:

- `REVIEW_REQUIRED`;
- `ACCEPTED`;
- `ESCALATED`;
- `RESOLVED`.

Reglas:

1. Existe como máximo una Review por CashCount.
2. Una diferencia material bloquea el cierre sin acción autorizada conforme a política.
3. El actor que contó no aprueba su propia diferencia crítica cuando aplica segregación.
4. Aceptar una diferencia no cambia su importe ni crea un movimiento.

### CashDifferenceReviewAction

Hecho append-only que conserva cada transición de CashDifferenceReview con actor, motivo, evidencia, política de autorización, idempotencia, checksum e instante.

Cardinalidades:

1. CashShift tiene cero o muchos CashCount y exactamente uno de cierre cuando está `CLOSED`.
2. CashCount tiene cero o muchas denominaciones según política de desglose.
3. CashCount referencia cero o un conteo anterior corregido y puede tener cero o un sucesor directo; la cadena de corrección no se ramifica.
4. CashCount completado con diferencia distinta de cero tiene exactamente una CashDifferenceReview; un conteo exacto solo la tiene si la política la exige.
5. CashDifferenceReview tiene una o más CashDifferenceReviewAction.

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

### SaleReturn

Agregado de Sales que representa una devolución comercial total o parcial posterior a una `Sale` completada. No es `Refund`, `Reversal`, `SaleCancellation`, movimiento de inventario, movimiento de caja ni documento fiscal.

Atributos conceptuales:

- id UUID v7 global;
- tenant_id;
- company_id;
- branch_id;
- sale_id;
- origin_device_id;
- requested_by_actor_id;
- approved_by_actor_id opcional;
- reason_code y reason_detail opcional;
- status;
- effective_at;
- currency_code;
- original_sale_payable_amount;
- requested_return_amount;
- approved_return_amount opcional;
- completed_return_amount;
- returned_tax_amount;
- versiones de pricing, impuestos y redondeo originales;
- operation_id;
- idempotency_key;
- request_checksum;
- expected_sale_version;
- correlation_id;
- causation_id opcional;
- timestamps coherentes con el ciclo;
- version.

Estados persistentes:

- `RETURN_REQUESTED`;
- `RETURN_UNDER_REVIEW`;
- `RETURN_APPROVED`;
- `RETURN_REJECTED`;
- `RETURN_EXECUTION_IN_PROGRESS`;
- `RETURN_PARTIALLY_COMPLETED`;
- `RETURN_COMPLETED`;
- `RETURN_FAILED`;
- `RETURN_REVIEW_REQUIRED`.

`PARTIALLY_RETURNED` y `FULLY_RETURNED` son exclusivamente proyecciones derivadas del acumulado de devoluciones completadas sobre `Sale`; no son estados persistentes de `Sale` ni de `SaleReturn`.

Reglas:

1. SaleReturn y Sale comparten tenant, company, branch y moneda.
2. La Sale original está `COMPLETED` y nunca se reescribe por la devolución.
3. Cantidad e importe acumulados no superan la elegibilidad de cada SaleItem.
4. Precios, descuentos, impuestos, cantidades y políticas se obtienen de snapshots originales, no de configuración actual.
5. Refund/Reversal, InventoryMovement, CashMovement y corrección fiscal son efectos separados bajo sus módulos propietarios.
6. La operación es idempotente, usa versión esperada y conserva causalidad, auditoría y evidencia de sincronización.
7. Conflictos concurrentes se rechazan o pasan a revisión; no se resuelven por último timestamp.

### SaleReturnLine

Referencia exactamente una `SaleItem` de la venta original y conserva presentación, lote opcional, unidad, cantidad vendida, cantidad previamente devuelta conocida, cantidades solicitada/aprobada/completada, condición física, resolución de inventario, valores monetarios e impuestos originales y valores devueltos. Las cantidades y el dinero usan decimal exacto.

Una línea comercial no modifica inventario directamente. Solo un `InventoryMovement` explícito del módulo Inventory puede restituir o clasificar unidades, y su cantidad nunca supera la cantidad comercial completada.

### PaymentProviderConfiguration

Identidad estable de Payments para una configuración de proveedor dentro de Tenant y Company, con los scopes de cuenta, Branch o terminal que el contrato de proveedor reconozca.

### PaymentProviderConfigurationVersion

Versión inmutable publicada que conserva proveedor, ambiente, capabilities declaradas, políticas operativas, vigencia, checksum y referencias opacas a secretos. Nunca contiene credenciales utilizables ni permite que el cliente local amplíe capacidades del proveedor.

La autoridad del proveedor sobre resultados externos permanece separada de esta configuración. Un cambio de versión no reescribe `Payment`, `PaymentAttempt`, `Refund`, `Reversal`, `Settlement` o `Reconciliation` históricos.

### Payment

Representa un cobro financiero independiente que cubre total o parcialmente una venta, pedido o cuenta por cobrar de cliente. Una venta puede tener uno o varios pagos relacionados mediante un `PaymentGroup`. No representa cuentas por pagar ni pagos a proveedores, que pertenecen a una capacidad futura y a un agregado separado.

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

Agrupa los pagos que cubren una misma venta, pedido o cuenta por cobrar de cliente.

Atributos conceptuales:

- id;
- tenant_id;
- company_id;
- branch_id;
- collection_subject_type;
- collection_subject_id;
- currency;
- expected_payable_amount;
- status derivado;
- idempotency_key;
- created_at.

### PaymentAllocation

Relaciona un `Payment` con la venta, pedido o cuenta por cobrar de cliente —o la porción correspondiente— y conserva el importe asignado.

### PaymentAttempt

Representa cada intento técnico u operativo de ejecutar o confirmar un `Payment`.

Conserva identidad global, `payment_id`, proveedor, referencia externa, importe, moneda, estado del intento, idempotencia, correlación, evidencia, errores y timestamps.

Una referencia externa solo puede ser única dentro del contexto de tenant, proveedor y tipo de referencia que la emite.

### Refund

Agregado compensatorio append-only que consume saldo confirmado y elegible sin reescribir `Payment` ni `Sale`.

### RefundItem

### Reversal

Agregado de Payments que revierte una autorización o confirmación únicamente cuando el estado real y la capacidad del proveedor o subsistema original lo permiten. Conserva Payment e intento originales, tenant/company/branch, importe solicitado y completado, moneda, estado de `ReversalStatus`, referencias y evidencia de proveedor, actores, motivo, idempotencia, causalidad y versión.

Un Reversal completado alimenta la proyección acumulada `reversed_amount`; no modifica Payment histórico, no es Refund ni demuestra una devolución comercial. Un resultado externo incierto permanece `UNKNOWN` o `REVIEW_REQUIRED` según `PAY-007`.

### Settlement

Agregado de Payments que registra una liquidación de caja, proveedor, adquirente, billetera o banco sin cambiar `PaymentStatus`. Conserva fuente, cuenta/lote/periodo como snapshot, moneda, evidencia original y los siguientes componentes exactos separados:

- `gross_amount`;
- `fee_amount`;
- `withholding_amount`;
- `refunded_amount`;
- `reversed_amount`;
- `chargeback_amount`;
- `positive_adjustment_amount`;
- `negative_adjustment_amount`;
- `net_amount`.

También conserva `calculation_policy_version`, entradas exactas, tratamiento declarado de `gross_amount` frente a reversals y resultado calculado. La política distingue entre bruto que incluye operaciones posteriormente reversadas y bruto ya neto de reversals; no existe descuento doble ni fórmula universal implícita. Un `SettlementItem` relaciona componentes financieros sin consumir dos veces el mismo importe.

### Reconciliation

Agregado de Payments que compara movimientos internos con fuentes externas mediante matching determinista y políticas versionadas. Su periodo o alcance es un snapshot inmutable del propio agregado, no un agregado con estado independiente.

Estados persistentes exclusivos, definidos por `PAY-007`:

- `CREATED`;
- `RUNNING`;
- `REVIEW_REQUIRED`;
- `PARTIALLY_RECONCILED`;
- `RECONCILED`;
- `FAILED`;
- `CANCELLED`;
- `CLOSED`;
- `REOPENED`.

`OPEN` y `PROCESSING` no pertenecen a `ReconciliationStatus`. `ReconciliationItem` conserva cada matching o diferencia con estado propio; `ReconciliationIncident` conserva investigación, evidencia, resolución y estado propio. Cierre, reapertura y resolución nunca reescriben Payment, Settlement, extractos o evidencia y requieren permisos, motivo y controles reforzados según política.

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

### FiscalEmissionConfiguration

Identidad estable de Electronic Invoicing para configurar emisión dentro de Tenant, Company, identidad fiscal y ambiente autorizados.

### FiscalEmissionConfigurationVersion

Versión inmutable publicada que conserva autorización o resolución, numeración, prefijo, proveedor, conexión, contingencias, capabilities, vigencia, checksum y referencias opacas a credenciales/certificados. No contiene secretos utilizables ni reglas de cálculo tributario.

El snapshot de emisión fiscal conserva esta versión y la evidencia del proveedor. El snapshot tributario de la operación conserva reglas, bases, tasas y resultados de Tax. Son evidencias distintas y no se agrupan bajo un `fiscal_snapshot` ambiguo.

### FiscalConnection

Identidad neutral y tenant-scoped de la conexión de Electronic Invoicing con un proveedor y ambiente. Conserva scope de Tenant/Company/Branch cuando aplique, identidad fiscal, capabilities, vigencia, versión de configuración y referencias opacas a secretos; nunca secretos utilizables.

### ElectronicDocument

Agregado canónico de Electronic Invoicing que representa factura electrónica, documento equivalente, nota u otro documento fiscal. Conserva identidad interna global anterior al envío, source comercial, estado interno, importes exactos, referencias separadas al snapshot tributario y al snapshot de emisión, numeración e identificadores externos cuando existan, incertidumbre, relación correctiva, versión y auditoría.

`FiscalDocument` no es una segunda entidad. Puede aparecer solo como descripción narrativa de `ElectronicDocument`. CUFE, CUDE, prefijo/número y referencias del proveedor o autoridad no reemplazan `electronic_document_id`.

Estados persistentes: `DRAFT`, `READY`, `QUEUED`, `SUBMITTING`, `ACCEPTED`, `REJECTED`, `UNKNOWN_OUTCOME`, `CONTINGENCY` y `VOIDED_BEFORE_SUBMISSION`.

### FiscalSubmissionAttempt

Interacción técnica versionada contra un proveedor para emitir, consultar, recuperar artefactos o ejecutar una operación fiscal autorizada. Estados persistentes: `CREATED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `UNKNOWN_OUTCOME` y `CANCELLED`. Su estado técnico, `transport_status` y `normalized_result` son dimensiones distintas; `ACCEPTED` y `REJECTED` no son estados del attempt.

### FiscalArtifact

Referencia tenant-scoped a XML, PDF, application response, QR data, payload firmado, respuesta de proveedor u otra evidencia autorizada. Conserva tipo, media type, checksum, tamaño/metadata, storage reference, inmutabilidad y política de retención, sin duplicar secretos.

### FiscalIncident

Situación persistente que requiere revisión y no un error técnico transitorio ordinario. Estados: `OPEN`, `IN_REVIEW`, `RESOLVED` y `ARCHIVED`. Tipo, severidad y forma de resolución se conservan como atributos separados; archivar no elimina evidencia.

### FiscalReconciliation

Comparación versionada entre estado interno y evidencia externa autoritativa. Estados: `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED` y `REOPENED`. Su scope/periodo es snapshot, no otro agregado con lifecycle paralelo, y no comparte físicamente la enum de Payments.

### FiscalReconciliationItem

Comparación tenant-scoped de un `ElectronicDocument` dentro de una ejecución fiscal. Conserva estado esperado/observado, evidencia, discrepancia, resultado y posible incidencia sin crear otra máquina de estados.

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

El payload canónico original pertenece lógicamente a esta operación y permanece inmutable. Outbox lo transporta o referencia e Inbox conserva checksum/resultado; ningún registro de dead letter crea otra copia autoritativa.

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

El ejecutor local de Sync controla `attempt_count`; una política técnica versionada de retry define límites, backoff, jitter, exclusiones y agotamiento sin números hardcodeados.

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

Representa la intervención autorizada sobre un conflicto o una dead letter.

Atributos conceptuales:

- review_id;
- conflict_id opcional;
- dead_letter_id opcional;
- assigned_role;
- assigned_user opcional;
- decision;
- reason;
- evidence_reference opcional;
- created_at;
- resolved_at opcional.

La revisión conserva actor, decisión, motivo y evidencia.

Una revisión referencia exactamente uno entre `conflict_id` y `dead_letter_id`.

### SyncDeadLetter

Agregado de Sync que conserva evidencia y tratamiento de una `SyncOperation` que agotó reintentos o presenta un error no recuperable automáticamente.

Es un registro separado porque revisión, autorización, concurrencia, retención y archivo tienen lifecycle propio. No reemplaza el estado operativo `DEAD_LETTER`, no es otra operación y no copia el payload.

Atributos conceptuales:

- id UUID v7 global;
- tenant_id;
- operation_id;
- outbox_id opcional;
- referencia a Inbox por tenant/operation cuando exista;
- conflict_id opcional;
- origin: `LOCAL_OUTBOX` o `CENTRAL_INBOX`;
- status;
- error_classification;
- error_code;
- reason_code opcional;
- first_failed_at;
- last_failed_at;
- retry_count;
- retry_policy_version;
- evidence_reference opcional;
- created_at;
- archived_at opcional;
- version;
- audit_reference opcional.

Estados persistentes de tratamiento reutilizados de `DEC-007`: `DEAD_LETTER`, `REVIEW_REQUIRED`, `RETRY_SCHEDULED` y `ARCHIVED`. `SERVER_ACCEPTED` y `SERVER_REJECTED` pertenecen a la operación/Inbox; una acción registra ese resultado antes de archivar la dead letter.

Clasificaciones: `TRANSIENT`, `PERMANENT`, `CONFLICT`, `AUTHORIZATION`, `VALIDATION`, `DEPENDENCY`, `VERSION_INCOMPATIBLE`, `TENANT_VIOLATION`, `DEVICE_REVOKED` y `UNKNOWN`.

Reglas:

1. Existe como máximo una dead letter por `operation_id`; reingresos añaden acciones sin duplicarla.
2. Tenant de dead letter, operación y referencias coincide.
3. Retry conserva operation, idempotency key, payload, checksum y causalidad.
4. Cambiar intención o payload exige otra SyncOperation causalmente relacionada.
5. Firma/checksum inválidos, tenant violation, autorización y dispositivo revocado no reciben retry automático.
6. `ARCHIVED` no borra operación, Inbox, Outbox, acciones, auditoría o evidencia retenida.
7. Toda transición usa expected version; timestamps no resuelven concurrencia.
8. Detecciones local y central concurrentes convergen a una identidad canónica mediante unicidad de operation y resultado central, no por timestamp.

### SyncDeadLetterAction

Hecho append-only que conserva cada revisión, retry autorizado, rechazo, resultado o archivo con tenant, operación, estados, actor/rol/scope, permiso, motivo, condición que cambió, clasificación/código, causalidad, correlación, timestamp confiable y evidencia/auditoría sanitizadas.

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
| Sale, SaleReturn, Payment, Refund, Reversal, Settlement, Reconciliation, CashShift, CashMovement, CashCount, CashDifferenceReview y acciones | no admiten hard delete |
| InventoryMovement | no admite hard delete ni update destructivo |
| InventoryReservation | transiciona a consumida, liberada, expirada o cancelada |
| Device, Installation, Activation, License, Revocation | se desactivan, revocan, cancelan o terminan; conservan identidad |
| AuditEvent, SyncOperation, Inbox confirmado, SyncDeadLetter y sus acciones | se retienen o archivan conforme política; no se eliminan por cascada |

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
| PaymentGroup/Payment | misma moneda, tenant y venta, pedido o cuenta por cobrar de cliente; idempotencia única por alcance operativo; cobertura confirmada no se duplica |
| PaymentAttempt | pertenece a un Payment; referencia externa única por Tenant/Provider/ReferenceType cuando exista |
| Refund/Reversal | importe solicitado, reservado y completado no supera saldo elegible; versión obligatoria |
| CashShift | un solo turno abierto compatible por Tenant/Branch/Register/Terminal |
| CashMovement | pertenece a turno abierto o a corrección autorizada; transición versionada antes de POSTED y hecho inmutable después |
| CashCount | corte/version de turno coherentes; completado inmutable; abortado terminal y auditable; un sucesor directo máximo; un conteo de cierre por turno cerrado |
| CashCountDenomination | pertenece al conteo y moneda; subtotal exacto; suma igual a counted_amount cuando el desglose fue informado |
| CashDifferenceReview | exactamente una por conteo completado con diferencia distinta de cero y máximo una en los demás casos; decisiones críticas respetan autorización y segregación; acciones append-only |
| SyncOperation | UUID global, idempotencia por Tenant/OperationType, checksum inmutable |
| OutboxEntry | una por operation; secuencia única y creciente por Tenant/Device |
| InboxEntry | operation global única; idempotencia y checksum coherentes |
| SyncCheckpoint | uno por Tenant/Device y canal definido; nunca avanza antes del commit |
| SyncDeadLetter | UUID global; una por operation; referencias tenant-aware; sin payload; estado/clasificación válidos; versión optimista |
| SyncDeadLetterAction | append-only; mismo tenant/operation de la dead letter; transición, actor, motivo y timestamp confiable obligatorios |
| Device/Activation | identidad no reutilizable; una solicitud idempotente no crea duplicados; cupo no se excede |
| AuditEvent | UUID global, timestamp servidor, action, resource, correlation y actor type obligatorios; append-only |

Las restricciones anteriores deben expresarse mediante `FK`, `UNIQUE`, `CHECK`, `NOT NULL`, versión optimista o una combinación verificable. Una validación de aplicación no sustituye una restricción de base de datos cuando el motor pueda expresarla.
