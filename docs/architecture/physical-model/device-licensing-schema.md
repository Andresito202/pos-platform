# TECH-002C: esquema físico de dispositivos y licencias

## Estado y alcance

`IN_REVIEW` dentro de `TECH-002`.

Reconciliación aprobada por el propietario 2026-10-27: la implementación Central
de activación continuará sobre DEV-003 (`identity.device_registry` y
`identity.device_credentials`). Sus IDs textuales de clave no se convierten en
UUID ni crean una segunda identidad `devices.device_keys`. Los cuadros legacy
inferiores conservan referencia histórica; para el montaje DEV-003 mandan el
binding exacto tenant/company/device/installation/credential, la prueba de
posesión de propósito específico y capacidad V2 intacta. La aprobación no
materializa por sí sola el emisor/distribuidor ni aporta raíces o credenciales.

Este bloque materializa la cadena separada exigida por `DEC-008`, `UC-DEV-001`, `UC-DEV-002`, `UC-LIC-001`, `UC-LIC-002` y `SEC-004`:

```text
Tenant -> Device -> Installation -> DeviceKey
   \          \          \
    License --------> LicenseActivation
       \------------> FeatureEntitlement
```

Las flechas representan referencias verificables, no herencia ni equivalencia de identidades. No contiene DDL ni autoriza migraciones.

## Matriz de autoridad y ubicación

| Agregado | PostgreSQL | SQLite | Clase y autoridad |
|---|---|---|---|
| Device | registro central | identidad local enlazada | `DUAL_WITH_EXPLICIT_POLICY`; central confirma registro, local no autoaprueba confianza |
| Installation | copia aceptada | origen de instalación | `LOCAL_AUTHORITATIVE_SYNCED` hasta aceptación central |
| DeviceKey | solo clave pública y metadata | solo clave pública y metadata | identidad pública sincronizada; clave privada fuera de ambas bases |
| HardwareEvidence | consolidado | evidencia local mínima | `LOCAL_AUTHORITATIVE_SYNCED` |
| DeviceOperationalState | último estado aceptado | estado local actual | `DUAL_WITH_EXPLICIT_POLICY`; no last-write-wins |
| DeviceManagementProfile | contrato central | snapshot de lectura | `CENTRAL_MASTER_REPLICATED` |
| License, Entitlement | artefacto autoritativo | copia verificable | `CENTRAL_MASTER_REPLICATED` |
| LicenseActivation | artefacto autoritativo | copia verificable | `CENTRAL_MASTER_REPLICATED` |
| Revocation, GraceAuthorization | secuencia autoritativa | copia verificable append-only | `CENTRAL_MASTER_REPLICATED` |
| TrustedSigningKey | trust store publicado | trust store preinstalado/actualizado | `CENTRAL_MASTER_REPLICATED` |
| ActivationRequest | copia recibida | origen | `LOCAL_AUTHORITATIVE_SYNCED` |
| ActivationResponse | origen | copia aplicada | `CENTRAL_MASTER_REPLICATED` |
| OfflineAuthorizationSnapshot | copia/evidencia de emisión | copia verificable limitada | `CENTRAL_MASTER_REPLICATED` |

## Reglas criptográficas comunes

1. `signature`, `public_key`, nonces y checksums se almacenan como `bytea` en PostgreSQL y `BLOB` en SQLite; API/IPC usan codificación base64url canónica cuando necesiten texto.
2. Todo artefacto firmado conserva `payload_version`, `canonicalization_version` cuando aplique, `algorithm_id`, `signing_key_id`, payload canónico y firma.
3. Las columnas normalizadas permiten constraints y consultas; el payload firmado permite verificar que esas columnas no fueron alteradas. Persistir ambas formas exige comprobar igualdad antes del commit.
4. La clave privada del dispositivo reside en DPAPI, Windows Credential Manager o almacén aprobado. SQLite guarda como máximo el identificador público y una referencia no secreta del almacén cuando el adaptador la necesite.
5. Claves privadas centrales y credenciales de infraestructura nunca entran a estas tablas.
6. Una firma inválida, algoritmo desconocido, clave no confiable o checksum distinto falla cerrado.

## Dispositivos

### `devices.devices`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | `device_id`, PK, no reutilizable |
| `tenant_id` | `uuid` | no | FK tenant, RLS |
| `company_id` | `uuid` | no | FK compuesta al tenant |
| `branch_id` | `uuid` | sí | FK compuesta a company/tenant |
| `device_type` | `text` | no | primera capacidad: `POS_TERMINAL`; ampliar exige caso de uso |
| `trust_status` | `text` | no | valores exactos del modelo conceptual |
| `registered_at` | `timestamptz` | no | registro confirmado |
| `revoked_at` | `timestamptz` | sí | requerido con confianza `REVOKED` |
| `replacement_device_id` | `uuid` | sí | FK self; nunca igual a `id` |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, company_id, id)` y `UNIQUE (tenant_id, company_id, branch_id, id)` para scopes físicos;
- FK `tenant_id -> tenancy.tenants(id)`, FK `(tenant_id, company_id) -> organization.companies(tenant_id, id)` y FK `(tenant_id, company_id, branch_id) -> organization.branches(tenant_id, company_id, id)` cuando Branch exista;
- FK self `(tenant_id, replacement_device_id) -> devices(tenant_id, id)` con `NO ACTION`;
- `CHECK (replacement_device_id IS NULL OR replacement_device_id <> id)`;
- índice `(tenant_id, branch_id, trust_status, id)`;
- no contiene `installation_id`, estado operativo, versión de app ni último heartbeat.

### `devices.installations`

| Columna | Tipo PostgreSQL / SQLite | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` / UUID TEXT | no | `installation_id`, PK, generado localmente |
| `tenant_id` | `uuid` / UUID TEXT | no | mismo tenant del dispositivo |
| `device_id` | `uuid` / UUID TEXT | sí | nulo hasta registro aceptado |
| `app_version` | `text` | no | versión instalada |
| `operating_system` | `text` | no | familia y versión sanitizadas |
| `created_at` | timestamp | no | creación local |
| `linked_at` | timestamp | sí | aceptación del vínculo |
| `retired_at` | timestamp | sí | retiro irreversible |
| `replacement_installation_id` | UUID | sí | FK self, diferente de `id` |
| `version` | entero | no | concurrencia optimista |

Constraints:

- `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, device_id, id)`;
- FK `(tenant_id, device_id)` cuando exista;
- FK self `(tenant_id, replacement_installation_id)` a Installation con `NO ACTION`;
- una instalación solo puede enlazarse una vez a Device; cambiar Device requiere flujo explícito de recuperación, no update ordinario;
- `replacement_installation_id` no reutiliza identidad ni transfiere activación;
- índice `(tenant_id, device_id, retired_at, created_at DESC)`.

### `devices.device_keys`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `device_id uuid NOT NULL`, `public_key bytea NOT NULL`, `public_key_fingerprint bytea NOT NULL`, `key_version bigint NOT NULL`, `algorithm_id text NOT NULL`, `key_status text NOT NULL` con estados conceptuales, `created_at`, `activated_at`, `rotated_at`, `retired_at`, `revoked_at`, `replacement_key_id uuid NULL`, `proof_method text NOT NULL`, `policy_version text NOT NULL` y `version bigint NOT NULL`.

`id` es la única identidad UUID v7 del agregado y representa semánticamente `device_key_id`. Las columnas FK llamadas `device_key_id` apuntan a `devices.device_keys.id`; no existe una segunda columna UUID equivalente. `public_key_fingerprint` es una huella derivada del material público, `key_version` ordena versiones dentro del Device, `replacement_key_id` enlaza la rotación y el `signing_key_id` central pertenece al trust store, no a DeviceKey.

Constraints:

- `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, device_id, id)` y `UNIQUE (public_key_fingerprint)` para impedir reutilización silenciosa;
- `UNIQUE (tenant_id, device_id, key_version)`;
- FK compuesta `(tenant_id, device_id)`;
- FK self `(tenant_id, device_id, replacement_key_id)` para que la rotación permanezca en el mismo Device, diferente de la misma fila y con `NO ACTION`;
- una sola clave `ACTIVE` por dispositivo mediante unique parcial;
- coherencia entre estado y timestamps;
- la tabla local equivalente es `devices_device_keys` y no contiene clave privada.

### `devices.device_hardware_evidence`

Append-only: `id`, `tenant_id`, `device_id`, `installation_id`, `evidence_version`, `evidence_hash`, `evidence_type`, `observed_at`, `change_classification`, `risk_status`, `retained_until`, `correlation_id`.

Constraints: FK `(tenant_id, device_id)` a Device y FK `(tenant_id, device_id, installation_id)` a Installation, `UNIQUE (tenant_id, device_id, installation_id, evidence_version, evidence_type)`, índice `(tenant_id, device_id, observed_at DESC)`. Ambas FKs usan `NO ACTION`. El hash no se usa como identidad y el payload crudo solo se conserva si una política de minimización lo autoriza expresamente.

### `devices.device_operational_states`

Una fila mutable por Device:

- `tenant_id uuid NOT NULL`;
- `device_id uuid NOT NULL`;
- `installation_id uuid NOT NULL`;
- `device_status text NOT NULL` con estados conceptuales;
- `connectivity_status text NOT NULL`;
- `health_status text NOT NULL`;
- `last_seen_at`, `last_sync_at`, `stale_since_at`, `unreachable_since_at` opcionales;
- `review_status text NULL`;
- `last_transition_at timestamptz NOT NULL`;
- `policy_version text NOT NULL`;
- `version bigint NOT NULL`;
- PK `(tenant_id, device_id)`, FK `(tenant_id, device_id)` a Device y FK `(tenant_id, device_id, installation_id)` a Installation.

Un heartbeat solo avanza `last_seen_at` si prueba Device/Installation válida y no está fuera de orden según la política. `last_sync_at` cambia únicamente después de sincronización confirmada. El estado no modifica confianza ni licencia.

### `devices.device_management_profiles`

Una fila versionada por dispositivo y vigencia: `id`, `tenant_id`, `device_id`, `asset_ownership_mode`, `management_mode`, `policy_version`, `managed_since_at`, `management_ends_at`, `status`, `created_at`, `version`.

Constraints: FK `(tenant_id, device_id)` con `NO ACTION`, modos exactos del modelo conceptual, rango temporal válido y máximo un perfil activo por Device. `DEVICE_MANAGED` y `KIOSK_MANAGED` requieren evidencia de contrato/política referenciada; el perfil nunca otorga entitlements.

## Licencias

### `licensing.licenses`

Artefacto inmutable por versión emitida.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | `license_id`, PK |
| `tenant_id` | `uuid` | no | FK tenant, RLS |
| `payload_version` | `integer` | no | `>= 1` |
| `issuer_id` | `uuid` | no | emisor autorizado |
| `issued_at` | `timestamptz` | no | emisión |
| `not_before` | `timestamptz` | sí | inicio temporal |
| `expires_at` | `timestamptz` | sí | fin temporal; no estado base |
| `deployment_mode` | `text` | no | `HYBRID`, `LOCAL_PERPETUAL` según decisiones vigentes |
| `contract_status` | `text` | no | `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `TERMINATED` |
| `device_limit_type` | `text` | no | `FINITE`, `UNLIMITED`, `NOT_APPLICABLE` |
| `device_limit_value` | `integer` | sí | obligatorio y `>= 0` solo con `FINITE` |
| `branch_limit_type` | `text` | no | `FINITE`, `UNLIMITED`, `NOT_APPLICABLE` |
| `branch_limit_value` | `integer` | sí | obligatorio y `>= 0` solo con `FINITE` |
| `allowed_app_versions` | `jsonb` | no | snapshot firmado y schema versionado |
| `offline_policy` | `jsonb` | no | snapshot firmado y schema versionado |
| `grace_policy` | `jsonb` | sí | no crea GraceAuthorization |
| `supersedes_license_id` | `uuid` | sí | FK self |
| `signing_key_id` | `uuid` | no | FK trusted key |
| `signature_algorithm_id` | `text` | no | algoritmo permitido |
| `canonicalization_version` | `integer` | no | `>= 1` |
| `canonical_payload` | `jsonb` | no | payload exacto verificable |
| `payload_checksum` | `bytea` | no | unique con emisor |
| `signature` | `bytea` | no | firma |

Constraints e índices:

- `UNIQUE (tenant_id, id)` y `UNIQUE (issuer_id, payload_checksum)`;
- FK `tenant_id` a Tenant, FK self `(tenant_id, supersedes_license_id)` y FK global `signing_key_id` a TrustedSigningKey;
- rango temporal válido;
- `supersedes_license_id <> id`;
- ninguna actualización ordinaria: un cambio emite otra License;
- índice `(tenant_id, issued_at DESC, id)` y `(tenant_id, contract_status, issued_at DESC)`;
- `EXPIRED`, `INVALID` y `RESTRICTED` son resultados calculados, no valores de `contract_status`.
- `FINITE` exige valor entero exacto no negativo; cero significa que la dimensión aplica con cupo cero;
- `UNLIMITED` y `NOT_APPLICABLE` exigen valor nulo y no son equivalentes;
- una dimensión requerida sin tipo configurado impide emitir/firmar la License y su evaluación falla cerrada;
- no existe `NOT_CONFIGURED` persistente ni se usan `-1`, máximos artificiales o sentinels.

### `licensing.feature_entitlements`

Columnas: `id`, `tenant_id`, `license_id`, `entitlement_version`, `feature_code`, `enabled`, `limit_type text NOT NULL`, `limit_value numeric(19,6) NULL`, `valid_from`, `valid_until`, `policy_version`.

Constraints: `UNIQUE (tenant_id, id)`, FK `(tenant_id, license_id)` a License con `NO ACTION`, `UNIQUE (tenant_id, license_id, entitlement_version, feature_code)`, rango temporal válido y el feature code debe pertenecer al catálogo publicado; no equivale a Permission. `enabled` y límite son dimensiones separadas: `enabled = false` no equivale a `enabled = true` con `FINITE + 0`.

Todo entitlement persistido declara `limit_type` y usa exclusivamente `FINITE`, `UNLIMITED` o `NOT_APPLICABLE`; una capability sin dimensión cuantitativa usa `NOT_APPLICABLE`. `FINITE` exige valor exacto no negativo; `UNLIMITED`/`NOT_APPLICABLE` exigen valor nulo. Dispositivos y sucursales exigen entero exacto; otra capability conserva decimal exacto solo si su unidad normativa lo autoriza. Una configuración requerida ausente impide emitir el entitlement efectivo y falla cerrada, no se persiste como cuarto tipo.

### `licensing.license_activations`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | `activation_id`, PK |
| `tenant_id` | `uuid` | no | RLS |
| `license_id` | `uuid` | no | FK compuesta License |
| `company_id` | `uuid` | sí | mismo tenant |
| `branch_id` | `uuid` | sí | exige company, mismo tenant |
| `device_id` | `uuid` | no | FK compuesta Device |
| `installation_id` | `uuid` | no | FK compuesta Installation |
| `device_key_id` | `uuid` | no | FK a clave del mismo Device |
| `activation_status` | `text` | no | estados de DEC-008 |
| `payload_version` | `integer` | no | `>= 1` |
| `issued_at` | `timestamptz` | no | emisión |
| `not_before` | `timestamptz` | sí | vigencia |
| `expires_at` | `timestamptz` | sí | vigencia |
| `offline_authorization` | `jsonb` | no | parte firmada, schema versionado |
| `grace_policy` | `jsonb` | sí | parte firmada, no gracia implícita |
| `previous_activation_id` | `uuid` | sí | FK self |
| `replacement_reason` | `text` | sí | requerido si reemplaza |
| `signing_key_id` | `uuid` | no | FK trusted key |
| `signature_algorithm_id` | `text` | no | permitido |
| `canonical_payload` | `jsonb` | no | snapshot firmado |
| `payload_checksum` | `bytea` | no | checksum |
| `signature` | `bytea` | no | firma |
| `idempotency_key` | `text` | no | identidad de emisión |
| `revoked_at` | `timestamptz` | sí | requerido si revocada |

Constraints:

- `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, license_id, id)`, `UNIQUE (tenant_id, license_id, device_id, installation_id, device_key_id, id)` y FKs `(tenant_id, license_id)`, `(tenant_id, device_id)`, `(tenant_id, device_id, installation_id)` y `(tenant_id, device_id, device_key_id)`, todas `NO ACTION`;
- FK `(tenant_id, company_id)` cuando Company exista y FK `(tenant_id, company_id, branch_id)` cuando Branch exista;
- si `company_id` existe, FK `(tenant_id, company_id, device_id)` exige que el Device pertenezca a esa Company; si `branch_id` existe, FK `(tenant_id, company_id, branch_id, device_id)` exige que Device y Activation compartan Branch;
- el Device de Installation y DeviceKey coincide físicamente con `device_id` mediante claves compuestas;
- `branch_id` exige `company_id`; Company/Branch nulos significan activación tenant-wide autorizada, no scope inferido desde request;
- FK self `(tenant_id, license_id, previous_activation_id)` con `NO ACTION` exige la misma License; la aplicación valida cadena sin ciclos;
- `UNIQUE (tenant_id, idempotency_key)`;
- máximo una activación no terminal por `(tenant_id, license_id, device_id, installation_id)`;
- reemplazar crea otra fila y conserva anterior;
- índices `(tenant_id, device_id, installation_id, issued_at DESC)` y `(tenant_id, license_id, activation_status)`.

### `licensing.license_revocations`

Se evitan FK polimórficas sin integridad. La tabla conserva `target_type` y columnas tipadas:

- identidad: `id`, `tenant_id`, `target_type`;
- exactamente una de `license_id`, `activation_id`, `device_id`, `trusted_signing_key_id`;
- `reason_code`, `issued_at`, `effective_at`, `sequence`, `payload_version`;
- `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`.

Constraints:

- check “exactamente un target no nulo” y coherencia con `target_type`;
- FKs tipadas tenant-aware a License, Activation y Device; TrustedSigningKey es catálogo global por ambiente y usa FK global explícita, no una FK tenant ficticia;
- `UNIQUE (tenant_id, target_type, target-id-tipado, sequence)` mediante índices parciales por tipo;
- una secuencia menor nunca anula una mayor;
- append-only, sin delete en cliente;
- índice por target y `effective_at DESC`.

`SIGNING_KEY` y `UPDATE_KEY` referencian TrustedSigningKey y validan `key_purpose`; no se mezclan con DeviceKey.

### `licensing.grace_authorizations`

Artefacto append-only: `id`, `tenant_id`, `license_id`, `activation_id NULL`, `issued_at`, `starts_at`, `ends_at`, `allowed_features jsonb`, `restricted_features jsonb`, `reason_code`, `grace_sequence`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`.

Constraints: `UNIQUE (tenant_id, id)`, rango `starts_at < ends_at`, FK `(tenant_id, license_id)` y FK `(tenant_id, license_id, activation_id)` mediante candidate key de Activation cuando exista, `UNIQUE (tenant_id, license_id, grace_sequence)`, listas con schema/version y ninguna capacidad fuera de entitlements originales. Las FKs usan `NO ACTION`.

### `licensing.trusted_signing_keys`

Catálogo global por ambiente: `id uuid PK`, `key_id text NOT NULL`, `key_purpose text NOT NULL`, `environment text NOT NULL`, `public_key bytea NOT NULL`, `public_key_checksum bytea NOT NULL`, `algorithm_id text NOT NULL`, `key_status text NOT NULL`, `valid_from`, `valid_until`, `replaced_by_key_id uuid NULL`, `created_at`, `retired_at`, `revoked_at`.

Constraints: `UNIQUE (environment, key_purpose, key_id)`, `UNIQUE (environment, public_key_checksum)`, FK self y coherencia estado/timestamps. Producción, staging y sandbox nunca comparten registro ni clave privada.

## Activación online y offline

### `devices.activation_requests`

Mismo UUID local/central. Columnas: `id`, `tenant_id`, `license_reference`, `device_id`, `installation_id`, `device_key_id`, `challenge_nonce bytea`, `requested_at_local`, `received_at NULL`, `app_version`, `operating_system_family`, `device_evidence_hash NULL`, `proof_of_possession bytea`, `payload_checksum bytea`, `request_status`, `reason_code NULL`, `created_at`, `expires_at`, `idempotency_key`, `correlation_id`.

Constraints: `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, device_id, installation_id, device_key_id, id)`, `UNIQUE (tenant_id, idempotency_key)`, `UNIQUE (tenant_id, challenge_nonce)`, FKs `(tenant_id, device_id)`, `(tenant_id, device_id, installation_id)` y `(tenant_id, device_id, device_key_id)`, rango temporal y estados `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`. Todas las FKs históricas usan `NO ACTION`. Repetir la misma clave/checksum devuelve el mismo resultado; checksum distinto produce conflicto y señal de seguridad.

### `devices.activation_responses`

Artefacto append-only: `id`, `request_id`, `activation_id`, `tenant_id`, `license_id`, `device_id`, `installation_id`, `device_key_id`, `issued_at`, `not_before`, `expires_at`, `activation_status`, `offline_authorization jsonb`, `policy_version`, `request_checksum`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`, `applied_at NULL`, `rejected_at NULL`, `rejection_reason NULL`.

Constraints: `UNIQUE (tenant_id, id)`, una respuesta por `(tenant_id, request_id)`, FK `(tenant_id, device_id, installation_id, device_key_id, request_id)` a Request y FK `(tenant_id, license_id, device_id, installation_id, device_key_id, activation_id)` a Activation. Estas candidate keys prueban físicamente coincidencia exacta tenant/license/device/installation/DeviceKey; la aplicación valida además checksum del request. Aplicación idempotente y rechazo de replay/mismatch; ninguna FK usa cascade.

## Snapshot de autorización offline

### PostgreSQL `authorization.offline_authorization_snapshots`

### SQLite `authorization_offline_authorization_snapshots`

Columnas compartidas: `id`, `tenant_id`, `user_id`, `tenant_membership_id`, `device_id`, `installation_id`, `authorization_policy_version_id`, `permission_codes`, `company_scopes`, `branch_scopes`, `mfa_evidence NULL`, `issued_at`, `expires_at`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`, `revoked_at NULL`.

Representación:

- PostgreSQL usa `jsonb` solo para los arrays inmutables del snapshot firmado;
- SQLite usa JSON canónico `TEXT` validado;
- no contiene credenciales ni tokens;
- FKs centrales `(tenant_id, tenant_membership_id)`, `(user_id, tenant_membership_id)`, `(tenant_id, device_id)` y `(tenant_id, device_id, installation_id)` prueban misma membership/usuario/tenant y mismo Device/Installation;
- índice local `(user_id, expires_at DESC)` y central `(tenant_id, user_id, device_id, expires_at DESC)`;
- máximo un snapshot vigente por `(user_id, tenant_membership_id, device_id, installation_id, authorization_policy_version_id)`;
- la decisión offline cruza firma, vigencia, revocaciones conocidas, licencia, activación y estado de dispositivo; el snapshot aislado nunca basta.

## Tablas SQLite de este bloque

Las tablas productivas locales son:

```text
devices_devices
devices_installations
devices_device_keys
devices_device_hardware_evidence
devices_device_operational_states
devices_device_management_profiles
devices_activation_requests
devices_activation_responses
licensing_licenses
licensing_feature_entitlements
licensing_license_activations
licensing_license_revocations
licensing_grace_authorizations
licensing_trusted_signing_keys
authorization_offline_authorization_snapshots
```

Aplican las mismas identidades y constraints lógicas con las conversiones de `physical-conventions.md`. Los payloads firmados se reemplazan atómicamente por secuencia/version superior verificada; nunca por timestamp de llegada ni last-write-wins. SQLite no emite License, Activation, Revocation, GraceAuthorization, TrustedSigningKey u OfflineAuthorizationSnapshot.

## Fronteras transaccionales

### Registro de dispositivo

Una operación central idempotente confirma Device, vínculo de Installation, clave pública, evidencia mínima, estado operativo inicial, AuditEvent, `SyncOperation` entregable y su única Outbox. La clave privada ya existe localmente y nunca cruza la frontera.

### Activación

Una operación central bloquea el conjunto License/Device/Installation, valida límites, revocaciones y prueba de posesión, crea LicenseActivation y ActivationResponse, registra auditoría, `SyncOperation` entregable y su única Outbox, y confirma una sola vez. Reemplazar una activación marca la anterior según DEC-008 y crea otra; no reescribe su payload. La aplicación local posterior no comparte una transacción distribuida con PostgreSQL.

### Aplicación local de artefactos

POS Local Service verifica trust store, firma, checksum, versión, tenant, Device, Installation, secuencia, vigencia y revocaciones; luego reemplaza el snapshot efectivo y registra auditoría local dentro de una sola transacción SQLite. El renderer no escribe estas tablas.

### Heartbeat

La recepción central valida Device/Installation y orden temporal, inserta evidencia append-only cuando corresponda y actualiza DeviceOperationalState con expected version. No modifica Trust, License ni Activation.

## Grafo físico, ciclos y políticas de delete

Orden lógico de dependencias de este bloque:

1. Tenant, Company y Branch;
2. TrustedSigningKey global;
3. Device;
4. Installation;
5. DeviceKey, HardwareEvidence, OperationalState y ManagementProfile;
6. License;
7. FeatureEntitlement;
8. LicenseActivation;
9. GraceAuthorization, LicenseRevocation y artefactos request/response;
10. OfflineAuthorizationSnapshot;
11. SyncOperation/Outbox y Audit según la frontera transaccional.

No existe ciclo Device→Activation→Device porque Device no conserva `activation_id`. Los vínculos `replacement_device_id`, `replacement_installation_id`, `replacement_key_id`, `supersedes_license_id` y `previous_activation_id` referencian una fila anterior ya existente o nacen nulos cuando el lifecycle lo autoriza; no justifican `DEFERRABLE`. Una referencia que cerrara un ciclo futuro deberá demostrar su invariante antes de añadirse.

Todas las relaciones desde historia, evidencia, licencias emitidas, activaciones, revocaciones, requests/responses, Sync y Audit usan `RESTRICT`/`NO ACTION`. No se usa `CASCADE` desde Tenant, Company, Branch, Device, Installation, DeviceKey, License, Activation o TrustedSigningKey. `SET NULL` solo sería válido para metadata no autoritativa futura; no borra atribución, scope ni cadena criptográfica.

## Índices críticos

Además de los ya indicados:

- activaciones por `(tenant_id, device_id, installation_id, activation_status)`;
- revocaciones por cada target y secuencia descendente;
- licencias por tenant/emisión;
- claves por Device/status y trust keys por ambiente/propósito/status;
- requests pendientes por `(request_status, expires_at, id)`;
- estados operativos por `(tenant_id, device_status, last_transition_at)`;
- SQLite por claves exactas de validación, no por búsquedas administrativas especulativas.

## Pruebas obligatorias

1. Device, Installation, DeviceKey, Activation y License no son intercambiables.
2. Reinstalar crea Installation nueva y no reutiliza Activation.
3. Una clave pública no puede quedar activa en dos Devices.
4. Clave revocada/comprometida no prueba posesión.
5. Activación de otro tenant, Device o Installation se rechaza.
6. Licencia `LOCAL_PERPETUAL` opera offline con artefactos válidos sin dependencia permanente de Internet.
7. Revocación conocida prevalece sobre snapshots antiguos.
8. Falla de red no crea gracia.
9. Límite de dispositivos se protege bajo concurrencia.
10. Misma request idempotente no crea dos activaciones.
11. Nonce o response replay se rechazan y auditan.
12. Payload/columnas divergentes se rechazan.
13. SQLite no contiene clave privada, credencial central ni token reutilizable.
14. Heartbeat de Installation retirada no actualiza silenciosamente la vigente.
15. RLS impide cruce de tenant en cada tabla central tenant-scoped.
16. Restaurar SQLite no restaura automáticamente confianza ni activación obsoleta.
17. DeviceKey usa un solo UUID canónico y ninguna FK crea otra identidad equivalente.
18. `FINITE + 0`, `FINITE + positivo`, `UNLIMITED` y `NOT_APPLICABLE` conservan resultados distintos.
19. `FINITE` sin valor, valor negativo, valor fraccionario para Device/Branch o valor presente con `UNLIMITED`/`NOT_APPLICABLE` se rechazan.
20. Una dimensión requerida no configurada impide emitir/firmar y la evaluación falla cerrada.
21. Toda FK Device/Installation/DeviceKey/Activation/License cross-tenant o con Device incompatible se rechaza físicamente.
22. Ninguna eliminación de Tenant, Company, Branch, Device, Installation, Key, License o Activation destruye evidencia histórica.
23. El grafo se crea sin `DEFERRABLE` y los vínculos de reemplazo no forman ciclos ni reutilizan identidades.

## Gate del bloque

Este bloque permanece `IN_REVIEW`. R1 cerró la identidad canónica de DeviceKey y límites; R2-A cerró relaciones, candidate keys, orden y delete policies, pero no sustituye estas condiciones:

| Condición | Clasificación vigente | Tratamiento |
|---|---|---|
| identidad Device/Installation/DeviceKey/Activation/License | satisfecha documentalmente | DeviceKey usa un solo UUID; las identidades no son intercambiables |
| límites contractuales | satisfecha documentalmente | `FINITE`, `UNLIMITED`, `NOT_APPLICABLE`, ausencia fail-closed |
| PoC RLS PostgreSQL 16 | satisfecha con evidencia | `PHY-G14`, 30 PASS / 0 FAIL |
| auditoría columna por columna contra DEC-008/casos de uso | pendiente | cierre físico del bloque |
| FK diferidas con Foundation | satisfecha documentalmente y probada en el subconjunto R3 | R4 mantiene `device_id` nulo en 001 y difiere el bloque completo sin referencia libre |
| orden de migración y manifiesto | satisfecha para exclusión de 001 | `docs/migration/first-target-migration-manifest.md`; el orden del corte criptográfico posterior sigue condicionado por su PoC |
| PoC de firma/canonicalización/storage seguro | pendiente | requiere autorización y evidencia separadas |
| pruebas físicas PostgreSQL/SQLite | parcialmente satisfecha | R3 validó patrones comunes; la cadena criptográfica completa requiere su PoC y tests de implementación |

Al cerrar este bloque, la primera migración continuaba en `NO-GO`; su evolución posterior se registra en `traceability.md` y `../../product/backlog.md`. Device/Licensing permanece fuera de 001 y conserva sus gates propios.
