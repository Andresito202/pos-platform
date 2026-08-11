# TECH-002C: esquema físico de dispositivos y licencias

## Estado y alcance

`IN_REVIEW` dentro de `TECH-002`.

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

- `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, company_id, id)`;
- FK `(tenant_id, company_id)` y `(tenant_id, company_id, branch_id)`;
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

- `UNIQUE (tenant_id, id)`;
- FK `(tenant_id, device_id)` cuando exista;
- una instalación solo puede enlazarse una vez a Device; cambiar Device requiere flujo explícito de recuperación, no update ordinario;
- `replacement_installation_id` no reutiliza identidad ni transfiere activación;
- índice `(tenant_id, device_id, retired_at, created_at DESC)`.

### `devices.device_keys`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `device_id uuid NOT NULL`, `device_key_id uuid NOT NULL`, `public_key bytea NOT NULL`, `public_key_checksum bytea NOT NULL`, `algorithm_id text NOT NULL`, `key_status text NOT NULL` con estados conceptuales, `created_at`, `activated_at`, `rotated_at`, `retired_at`, `revoked_at`, `replacement_key_id uuid NULL`, `proof_method text NOT NULL`, `policy_version text NOT NULL` y `version bigint NOT NULL`.

Constraints:

- `UNIQUE (device_key_id)` y `UNIQUE (public_key_checksum)` para impedir reutilización silenciosa;
- FK compuesta `(tenant_id, device_id)`;
- FK self `replacement_key_id`, diferente de la misma fila;
- una sola clave `ACTIVE` por dispositivo mediante unique parcial;
- coherencia entre estado y timestamps;
- la tabla local equivalente es `devices_device_keys` y no contiene clave privada.

### `devices.device_hardware_evidence`

Append-only: `id`, `tenant_id`, `device_id`, `installation_id`, `evidence_version`, `evidence_hash`, `evidence_type`, `observed_at`, `change_classification`, `risk_status`, `retained_until`, `correlation_id`.

Constraints: FK compuestas a Device e Installation, `UNIQUE (tenant_id, device_id, installation_id, evidence_version, evidence_type)`, índice `(tenant_id, device_id, observed_at DESC)`. El hash no se usa como identidad y el payload crudo solo se conserva si una política de minimización lo autoriza expresamente.

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
- PK `(tenant_id, device_id)` y FK compuestas a Device e Installation.

Un heartbeat solo avanza `last_seen_at` si prueba Device/Installation válida y no está fuera de orden según la política. `last_sync_at` cambia únicamente después de sincronización confirmada. El estado no modifica confianza ni licencia.

### `devices.device_management_profiles`

Una fila versionada por dispositivo y vigencia: `id`, `tenant_id`, `device_id`, `asset_ownership_mode`, `management_mode`, `policy_version`, `managed_since_at`, `management_ends_at`, `status`, `created_at`, `version`.

Constraints: modos exactos del modelo conceptual, rango temporal válido y máximo un perfil activo por Device. `DEVICE_MANAGED` y `KIOSK_MANAGED` requieren evidencia de contrato/política referenciada; el perfil nunca otorga entitlements.

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
| `device_limit` | `integer` | no | `>= 0` |
| `branch_limit` | `integer` | no | `>= 0` |
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
- rango temporal válido;
- `supersedes_license_id <> id`;
- ninguna actualización ordinaria: un cambio emite otra License;
- índice `(tenant_id, issued_at DESC, id)` y `(tenant_id, contract_status, issued_at DESC)`;
- `EXPIRED`, `INVALID` y `RESTRICTED` son resultados calculados, no valores de `contract_status`.

### `licensing.feature_entitlements`

Columnas: `id`, `tenant_id`, `license_id`, `entitlement_version`, `feature_code`, `enabled`, `limit_value numeric(19,6) NULL`, `valid_from`, `valid_until`, `policy_version`.

Constraints: FK compuesta a License, `UNIQUE (tenant_id, license_id, entitlement_version, feature_code)`, rango temporal válido y `limit_value >= 0`. El feature code debe pertenecer al catálogo publicado; no equivale a Permission.

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

- FKs tenant-scoped a License, Device, Installation y DeviceKey;
- el Device de Installation y DeviceKey debe coincidir con `device_id`, mediante claves compuestas;
- `branch_id` exige `company_id`;
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
- FKs tipadas donde apliquen;
- `UNIQUE (tenant_id, target_type, target-id-tipado, sequence)` mediante índices parciales por tipo;
- una secuencia menor nunca anula una mayor;
- append-only, sin delete en cliente;
- índice por target y `effective_at DESC`.

`SIGNING_KEY` y `UPDATE_KEY` referencian TrustedSigningKey y validan `key_purpose`; no se mezclan con DeviceKey.

### `licensing.grace_authorizations`

Artefacto append-only: `id`, `tenant_id`, `license_id`, `activation_id NULL`, `issued_at`, `starts_at`, `ends_at`, `allowed_features jsonb`, `restricted_features jsonb`, `reason_code`, `grace_sequence`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`.

Constraints: rango `starts_at < ends_at`, FK activation debe pertenecer a la misma License cuando exista, `UNIQUE (tenant_id, license_id, grace_sequence)`, listas con schema/version y ninguna capacidad fuera de entitlements originales.

### `licensing.trusted_signing_keys`

Catálogo global por ambiente: `id uuid PK`, `key_id text NOT NULL`, `key_purpose text NOT NULL`, `environment text NOT NULL`, `public_key bytea NOT NULL`, `public_key_checksum bytea NOT NULL`, `algorithm_id text NOT NULL`, `key_status text NOT NULL`, `valid_from`, `valid_until`, `replaced_by_key_id uuid NULL`, `created_at`, `retired_at`, `revoked_at`.

Constraints: `UNIQUE (environment, key_purpose, key_id)`, `UNIQUE (environment, public_key_checksum)`, FK self y coherencia estado/timestamps. Producción, staging y sandbox nunca comparten registro ni clave privada.

## Activación online y offline

### `devices.activation_requests`

Mismo UUID local/central. Columnas: `id`, `tenant_id`, `license_reference`, `device_id`, `installation_id`, `device_key_id`, `challenge_nonce bytea`, `requested_at_local`, `received_at NULL`, `app_version`, `operating_system_family`, `device_evidence_hash NULL`, `proof_of_possession bytea`, `payload_checksum bytea`, `request_status`, `reason_code NULL`, `created_at`, `expires_at`, `idempotency_key`, `correlation_id`.

Constraints: `UNIQUE (tenant_id, idempotency_key)`, `UNIQUE (tenant_id, challenge_nonce)`, FKs compuestas a Device/Installation/DeviceKey, rango temporal y estados `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`. Repetir la misma clave/checksum devuelve el mismo resultado; checksum distinto produce conflicto.

### `devices.activation_responses`

Artefacto append-only: `id`, `request_id`, `activation_id`, `tenant_id`, `license_id`, `device_id`, `installation_id`, `issued_at`, `not_before`, `expires_at`, `activation_status`, `offline_authorization jsonb`, `policy_version`, `request_checksum`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`, `applied_at NULL`, `rejected_at NULL`, `rejection_reason NULL`.

Constraints: una respuesta por request, FKs compuestas a request y Activation, coincidencia exacta tenant/license/device/installation, aplicación idempotente y rechazo de replay/mismatch.

## Snapshot de autorización offline

### PostgreSQL `authorization.offline_authorization_snapshots`

### SQLite `authorization_offline_authorization_snapshots`

Columnas compartidas: `id`, `tenant_id`, `user_id`, `tenant_membership_id`, `device_id`, `installation_id`, `authorization_policy_version_id`, `permission_codes`, `company_scopes`, `branch_scopes`, `mfa_evidence NULL`, `issued_at`, `expires_at`, `payload_version`, `canonical_payload`, `payload_checksum`, `signing_key_id`, `signature_algorithm_id`, `signature`, `revoked_at NULL`.

Representación:

- PostgreSQL usa `jsonb` solo para los arrays inmutables del snapshot firmado;
- SQLite usa JSON canónico `TEXT` validado;
- no contiene credenciales ni tokens;
- FKs centrales prueban misma membership/tenant y misma Device/Installation;
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

Una operación central idempotente confirma Device, vínculo de Installation, clave pública, evidencia mínima, estado operativo inicial, AuditEvent y outbox. La clave privada ya existe localmente y nunca cruza la frontera.

### Activación

Una operación central bloquea el conjunto License/Device/Installation, valida límites, revocaciones y prueba de posesión, crea LicenseActivation y ActivationResponse, registra auditoría/outbox y confirma una sola vez. Reemplazar una activación marca la anterior según DEC-008 y crea otra; no reescribe su payload.

### Aplicación local de artefactos

POS Local Service verifica trust store, firma, checksum, versión, tenant, Device, Installation, secuencia, vigencia y revocaciones; luego reemplaza el snapshot efectivo y registra auditoría local dentro de una sola transacción SQLite. El renderer no escribe estas tablas.

### Heartbeat

La recepción central valida Device/Installation y orden temporal, inserta evidencia append-only cuando corresponda y actualiza DeviceOperationalState con expected version. No modifica Trust, License ni Activation.

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

## Gate del bloque

Este bloque permanece `IN_REVIEW` hasta:

1. auditar columna por columna contra DEC-008 y los cuatro casos de uso fuente;
2. cerrar todas las FK diferidas del bloque fundacional;
3. definir el orden de migración conjunta sin ciclos imposibles;
4. ejecutar PoC de firma/canonicalización y almacenamiento seguro local;
5. ejecutar PoC RLS y pruebas de ambos dialectos.

La primera migración continúa en `NO-GO`.
