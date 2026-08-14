# TECH-002 / R4 — manifiesto exacto de primera migración objetivo

## 1. Propósito y autoridad

Estado de R4: `PASS` documental.

Este documento es la única autoridad de alcance para las primeras migraciones del stack objetivo:

- PostgreSQL: `001_central_foundation`;
- SQLite: `001_local_migration_control`.

No contiene DDL ni código Kysely. Tampoco autoriza ejecutar las migraciones. Define el menor corte que permite implementar después el control plane del primer vertical: Tenant → Company → Branch → User → TenantMembership → autenticación/sesión → autorización tenant-aware → Audit, con `SyncOperation`/`OutboxEntry` centrales para el bootstrap sincronizable.

La migración 001 no habilita un POS ni login operacional de terminal. DeviceKey, licencias, activaciones y snapshots offline permanecen fail-closed hasta cerrar el PoC criptográfico y un corte posterior. `TECH-002` sigue `IN_PROGRESS`; primera migración `NO-GO` hasta revisión transversal independiente.

Fuentes normativas:

- [convenciones físicas](../architecture/physical-model/physical-conventions.md);
- [Foundation](../architecture/physical-model/foundation-schema.md);
- [Devices/Licensing](../architecture/physical-model/device-licensing-schema.md);
- [Sync base](../architecture/physical-model/sync-base-schema.md);
- [trazabilidad TECH-002](../architecture/physical-model/traceability.md);
- [propiedad de datos](../architecture/data-ownership.md);
- [onboarding](../use-cases/onboarding/UC-ONB-001-initialize-tenant.md);
- [login](../use-cases/auth/UC-AUTH-001-login.md);
- [DEC-007](../adr/DEC-007-local-first-data-authority.md) y [DEC-008](../adr/DEC-008-device-trust-license-activation.md);
- [migración del legado](avicola-baseline-migration.md).

## 2. Prerrequisitos y regla de alcance

R1, R2-A, R2-B y R3 están en `PASS`; R3 conserva `97/97` verificaciones PostgreSQL 16.14 y `83/83` SQLite 3.50.4/WAL. PHY-G14 conserva `30/30 PASS` para RLS. La evidencia no se regenera en R4.

Un objeto entra en 001 solo si es dependencia directa del primer vertical central, infraestructura obligatoria desde el primer commit o si diferirlo rompería una invariante. En particular:

1. el bootstrap central exige `OnboardingOperation`, Audit, `SyncOperation` y una única Outbox en su transacción;
2. Inbox y Checkpoint no son necesarios hasta recibir operaciones de dispositivos;
3. Device/Licensing no es dependencia de crear Tenant/Company/Branch: el onboarding puede quedar `READY_FOR_LICENSE` y un tenant puede existir sin dispositivos;
4. ningún dato local de negocio existe todavía, por lo que una base SQLite de dominio sería autoridad ficticia;
5. referencias a Device se conservan físicamente nulas mediante checks temporales, no como UUID libres sin FK.

## 3. Manifiesto de objetos PostgreSQL incluidos

### 3.1 Schemas y objetos de infraestructura

| Order | Schema | Object | Owner | Purpose | Included | Reason |
|---:|---|---|---|---|---|---|
| 1 | cluster | roles físicos | infraestructura | separación owner/migrator/runtime/admin | precondición 001 | RLS probado exige identidades separadas |
| 2 | `platform` | schema | Platform | objetos técnicos globales | sí | contexto tenant y ledger |
| 3 | `identity` | schema | Identity | identidad y sesión central | sí | primer vertical |
| 4 | `tenancy` | schema | Tenants | tenants, memberships y onboarding | sí | primer vertical |
| 5 | `organization` | schema | Companies/Branches | empresas y sucursales | sí | primer vertical |
| 6 | `authorization` | schema | Authorization | RBAC/ABAC persistente | sí | primer vertical |
| 7 | `sync` | schema | Sync | operación y entrega centrales | sí | bootstrap sincronizable |
| 8 | `audit` | schema | Audit | evidencia inmutable | sí | transversal obligatoria |
| 9 | `platform` | `current_tenant_id()`, `is_uuid_v7(uuid)` | Platform | contexto tenant fail-closed y validación de identidad | sí | RLS y UUID canónico |

`current_tenant_id()` devuelve `NULL` ante setting ausente, vacío o UUID inválido. Las políticas comparan por igualdad; `NULL` nunca autoriza. `is_uuid_v7(uuid)` valida versión 7 y variante RFC 4122 sobre la representación canónica; toda PK/identidad UUID nueva la usa. No se crea un schema genérico adicional.

### 3.2 Tablas

| Order | Schema | Table | Owner domain | Purpose | Location | Tenant-scoped | RLS | Dependencies | Included | Reason |
|---:|---|---|---|---|---|---:|---:|---|---:|---|
| 10 | `platform` | `target_migration_executions` | Platform | ledger del migrador | central | no | no | ninguna | sí | versioning/recovery |
| 11 | `identity` | `users` | Identity | identidad global | central | no | no | ninguna | sí | autenticación |
| 12 | `tenancy` | `tenants` | Tenants | límite de aislamiento | central master | por `id` | sí | ninguna | sí | raíz del vertical |
| 13 | `organization` | `companies` | Companies | empresa del tenant | central master | sí | sí | Tenant | sí | vertical mínimo |
| 14 | `organization` | `branches` | Branches | sede de Company | central master | sí | sí | Company | sí | vertical mínimo |
| 15 | `tenancy` | `tenant_memberships` | Tenants | relación User↔Tenant | central master | sí | sí | Tenant, User | sí | pertenencia explícita |
| 16 | `identity` | `user_credentials` | Identity | verificadores de autenticación | central only | no | no | User | sí | login |
| 17 | `identity` | `mfa_factors` | Identity | factores sin secreto embebido | central only | no | no | User | sí | MFA fail-closed |
| 18 | `authorization` | `roles` | Authorization | definición versionada de roles | central master | no | no | ninguna | sí | RBAC |
| 19 | `authorization` | `permissions` | Authorization | permisos atómicos publicados | central master | no | no | ninguna | sí | RBAC |
| 20 | `authorization` | `role_permission_grants` | Authorization | relación Role↔Permission | central master | no | no | Role, Permission | sí | RBAC normalizado |
| 21 | `authorization` | `authorization_policy_versions` | Authorization | versión/checksum ABAC backend | central master | no | no | ninguna | sí | decisión reproducible |
| 22 | `authorization` | `user_role_assignments` | Authorization | rol y scope de membership | central master | sí | sí | Membership, Role, Company, Branch | sí | autorización tenant-aware |
| 23 | `identity` | `sessions` | Identity | sesión central revocable | central only | scope opcional | no | User, Membership, Policy | sí | sesión/login |
| 24 | `identity` | `session_refresh_tokens` | Identity | rotación/replay de refresh | central only | no | no | Session, self | sí | sesión revocable |
| 25 | `identity` | `security_events` | Identity | señal append-only de seguridad | central only/mixed | opcional | sí para filas tenant | User, Session | sí | auth/replay evidence |
| 26 | `tenancy` | `onboarding_operations` | Tenants | bootstrap idempotente pre-tenant | central only | resultado opcional | no | objetos 11–25 aplicables | sí | frontera de onboarding |
| 27 | `sync` | `sync_operations` | Sync | intención central sincronizable | central origin | sí | sí | Tenant, Company, Branch, Session, self | sí | operación canónica |
| 28 | `sync` | `outbox_entries` | Sync | retry/entrega sin payload duplicado | central origin | sí | sí | SyncOperation | sí | outbox 1:1 |
| 29 | `audit` | `audit_events` | Audit | evidencia append-only | central/mixed | opcional | sí para filas tenant | Session, Company, Branch, Operation | sí | auditoría obligatoria |

## 4. Columnas y constraints exactos PostgreSQL

Reglas comunes: PK UUID v7 generado por aplicación; timestamps `timestamptz` UTC; texto obligatorio no acepta `btrim(value) = ''`; checksums Foundation son `text` hexadecimal lowercase de 64 caracteres y checksums Sync/ledger son `bytea` de 32 bytes; `version bigint` inicia en 1; todas las FK usan `NO ACTION`, nunca cascade.

### 4.1 `platform.target_migration_executions`

Columnas: `execution_id uuid PK`, `migration_id text NOT NULL`, `dialect text NOT NULL`, `manifest_version integer NOT NULL`, `checksum bytea NOT NULL`, `status text NOT NULL`, `started_at timestamptz NOT NULL`, `finished_at timestamptz NULL`, `runner_version text NOT NULL`, `error_code text NULL`.

Constraints: UUID v7; `dialect = 'POSTGRESQL'`; `manifest_version >= 1`; checksum de 32 bytes; status `STARTED|APPLIED|FAILED|ROLLED_BACK`; terminal exige `finished_at`; `error_code` solo con `FAILED`; unique parcial `migration_id WHERE status = 'APPLIED'`; unique `(migration_id, checksum, execution_id)`. El runner escribe `STARTED` antes de la transacción y finaliza la fila después del commit/rollback.

### 4.2 `identity.users`

Columnas: `id uuid PK`, `email text NOT NULL`, `email_normalized text NOT NULL`, `phone text NULL`, `phone_normalized text NULL`, `full_name text NOT NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: `users_email_normalized_uq`; check par phone; status `ACTIVE|INACTIVE`; `updated_at >= created_at`; version `>=1`. Índice `users_status_id_idx(status,id)`.

### 4.3 `tenancy.tenants`

Columnas: `id uuid PK`, `name text NOT NULL`, `code text NULL`, `code_normalized text NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: `tenants_code_normalized_uq` unique parcial no nulo; par code; status `ACTIVE|SUSPENDED`; timestamps/version. RLS compara `id` con `platform.current_tenant_id()`.

### 4.4 `organization.companies`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `legal_name text NULL`, `trade_name text NOT NULL`, `tax_id text NULL`, `tax_id_normalized text NULL`, `email text NULL`, `phone text NULL`, `phone_normalized text NULL`, `timezone text NOT NULL`, `currency_code char(3) NOT NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: `companies_tenant_id_id_uq(tenant_id,id)`; FK `companies_tenant_fk(tenant_id)->tenants(id)`; unique parcial `(tenant_id,tax_id_normalized)`; pares normalizados; currency `[A-Z]{3}`; status `ACTIVE|INACTIVE`; timestamps/version. Índice `companies_tenant_status_id_idx`.

### 4.5 `organization.branches`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `company_id uuid NOT NULL`, `name text NOT NULL`, `code text NULL`, `code_normalized text NULL`, `address text NULL`, `city text NULL`, `latitude numeric(9,6) NULL`, `longitude numeric(9,6) NULL`, `timezone text NOT NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: unique `(tenant_id,id)` y `(tenant_id,company_id,id)`; FK compuesta a Company; unique parcial code por company; par lat/long y rangos; status `ACTIVE|INACTIVE`; timestamps/version. Índice `branches_tenant_company_status_id_idx`.

### 4.6 `tenancy.tenant_memberships`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `user_id uuid NOT NULL`, `membership_type text NOT NULL`, `status text NOT NULL`, `is_primary boolean NOT NULL DEFAULT false`, `created_by_actor_type text NOT NULL`, `created_by_actor_id uuid NULL`, `created_at timestamptz NOT NULL`, `activated_at timestamptz NULL`, `suspended_at timestamptz NULL`, `revoked_at timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: unique `(tenant_id,id)` y `(user_id,id)`; FK Tenant y User; unique parcial `(tenant_id,user_id) WHERE status <> 'REVOKED'`; unique parcial `(user_id) WHERE is_primary AND status='ACTIVE'`; membership `OWNER|ADMIN|MEMBER|SERVICE`; estado/timestamps coherentes; actor `USER|PLATFORM_ACCOUNT|SYSTEM`, con id nulo solo para SYSTEM; version. Índice `tenant_memberships_user_status_tenant_idx`.

La existencia de al menos un OWNER activo es invariante transaccional bajo lock de Tenant; no se falsifica con CHECK.

### 4.7 `identity.user_credentials`

Columnas: `id uuid PK`, `user_id uuid NOT NULL`, `credential_type text NOT NULL`, `verifier text NOT NULL`, `status text NOT NULL`, `failed_attempt_count integer NOT NULL DEFAULT 0`, `locked_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `rotated_at timestamptz NULL`, `last_used_at timestamptz NULL`, `revoked_at timestamptz NULL`, `retained_until timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: UUID v7; FK `user_credentials_user_fk`; `credential_type='PASSWORD'`; status `ACTIVE|RETIRED|REVOKED`; failed attempts `>=0`; revoked timestamp obligatorio solo con REVOKED; rotated timestamp coherente con RETIRED; version `>=1`; unique parcial `user_credentials_active_type_uq(user_id,credential_type) WHERE status='ACTIVE'`. Índice `user_credentials_user_status_idx(user_id,status)`. `verifier` no recibe grant SELECT para roles fuera del repositorio Identity.

### 4.8 `identity.mfa_factors`

Columnas: `id uuid PK`, `user_id uuid NOT NULL`, `factor_type text NOT NULL`, `secret_reference text NULL`, `status text NOT NULL`, `enrolled_at timestamptz NOT NULL`, `verified_at timestamptz NULL`, `last_used_at timestamptz NULL`, `revoked_at timestamptz NULL`, `retained_until timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`. PK UUID v7; FK `mfa_factors_user_fk`; status `PENDING|ACTIVE|REVOKED`; verified requerido con ACTIVE; revoked requerido con REVOKED; version `>=1`; `secret_reference` es referencia opaca no vacía cuando presente; factor_type no vacío y no se siembra ningún método. Índice `mfa_factors_user_status_type_idx(user_id,status,factor_type)`.

### 4.9 Catálogos Authorization

- `roles`: `id uuid PK`, `code text NOT NULL`, `name text NOT NULL`, `scope_type text NOT NULL`, `version bigint NOT NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`; scope `PLATFORM|BUSINESS`, status `ACTIVE|RETIRED`, version `>=1`, unique `roles_code_version_uq(code,version)` y coherencia de retiro.
- `permissions`: `id uuid PK`, `code text NOT NULL`, `module text NOT NULL`, `description text NOT NULL`, `status text NOT NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`; status `ACTIVE|RETIRED`, unique `permissions_code_uq(code)` y coherencia de retiro.
- `role_permission_grants`: `id uuid PK`, `role_id uuid NOT NULL`, `permission_id uuid NOT NULL`, `grant_version bigint NOT NULL`, `status text NOT NULL`, `valid_from timestamptz NOT NULL`, `valid_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`; FK Role/Permission; status `ACTIVE|RETIRED`; version `>=1`; unique `role_permission_grants_role_permission_version_uq(role_id,permission_id,grant_version)`; rango/coherencia. Una versión publicada es inmutable.
- `authorization_policy_versions`: `id uuid PK`, `code text NOT NULL`, `version bigint NOT NULL`, `ruleset_checksum text NOT NULL`, `status text NOT NULL`, `effective_from timestamptz NOT NULL`, `effective_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`; status `ACTIVE|RETIRED`; version `>=1`; unique `authorization_policy_versions_code_version_uq(code,version)`; checksum hexadecimal lowercase de 64 caracteres; rango/coherencia. No contiene ruleset JSON.

### 4.10 `authorization.user_role_assignments`

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `tenant_membership_id uuid NOT NULL`, `role_id uuid NOT NULL`, `company_id uuid NULL`, `branch_id uuid NULL`, `status text NOT NULL`, `valid_from timestamptz NOT NULL`, `valid_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `created_by_actor_type text NOT NULL`, `created_by_actor_id uuid NULL`, `revoked_at timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: PK; unique `(tenant_id,id)`; FK `(tenant_id,tenant_membership_id)`; FK Role; FK `(tenant_id,company_id)` y `(tenant_id,company_id,branch_id)` con MATCH SIMPLE; branch exige company; actor y vigencia/estado coherentes. Unicidad activa se implementa con tres índices parciales separados: tenant scope `(membership,role)` cuando company/branch nulos; company scope `(membership,role,company)` cuando branch nulo; branch scope `(membership,role,company,branch)`. Índice de evaluación `(tenant_id,tenant_membership_id,status,valid_from,valid_until)`.

### 4.11 `identity.sessions`

Columnas: `id uuid PK`, `user_id uuid NOT NULL`, `tenant_id uuid NULL`, `tenant_membership_id uuid NULL`, `device_id uuid NULL`, `authenticated_at timestamptz NOT NULL`, `expires_at timestamptz NOT NULL`, `last_reauthenticated_at timestamptz NULL`, `mfa_status text NOT NULL`, `authorization_policy_version_id uuid NULL`, `offline_valid_until timestamptz NULL`, `revoked_at timestamptz NULL`, `revoked_by_actor_type text NULL`, `revoked_by_actor_id uuid NULL`, `revocation_reason text NULL`, `created_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: PK; unique `(tenant_id,id)`; FK User; FKs `(user_id,tenant_membership_id)` y `(tenant_id,tenant_membership_id)`; FK Policy; tenant/membership ambos nulos o presentes; expiry posterior; offline no posterior a expiry; revocación coherente; MFA `NOT_REQUIRED|PENDING|SATISFIED`; `CHECK (device_id IS NULL)` en 001. Índices parciales de Foundation por usuario y membership. La migración que introduzca Device elimina el check y agrega FK tenant-aware de manera atómica antes de permitir sesiones de terminal.

### 4.12 `identity.session_refresh_tokens`

Columnas: `id uuid PK`, `session_id uuid NOT NULL`, `token_family_id uuid NOT NULL`, `parent_token_id uuid NULL`, `token_hash text NOT NULL`, `issued_at timestamptz NOT NULL`, `expires_at timestamptz NOT NULL`, `consumed_at timestamptz NULL`, `replacement_token_id uuid NULL`, `revoked_at timestamptz NULL`, `revocation_reason text NULL`, `reuse_detected_at timestamptz NULL`, `retained_until timestamptz NULL`.

Constraints: PK UUID v7 para id y family; FK Session; self-FK parent/replacement NO ACTION; unique token hash; unique parcial parent y replacement; timestamps/estado coherentes; índice `(session_id,token_family_id,expires_at)`. Consumo/rotación usa lock y una transacción; reutilización crea SecurityEvent y revoca según política.

### 4.13 `identity.security_events`

Columnas: `id uuid PK`, `user_id uuid NULL`, `session_id uuid NULL`, `tenant_id uuid NULL`, `device_id uuid NULL`, `event_code text NOT NULL`, `result text NOT NULL`, `reason_code text NULL`, `ip_address inet NULL`, `evidence_checksum text NULL`, `correlation_id uuid NOT NULL`, `occurred_at timestamptz NOT NULL`, `server_recorded_at timestamptz NOT NULL`.

Constraints: PK UUID v7; FK User/Session; FK `(tenant_id,session_id)` cuando tenant existe; evidence checksum hexadecimal lowercase de 64 caracteres cuando existe; `server_recorded_at >= occurred_at`; `CHECK (device_id IS NULL)` en 001. Append-only mediante trigger y revocación de UPDATE/DELETE/TRUNCATE. RLS protege filas tenant-scoped; la policy separada de `pos_platform_app` admite eventos pre-contexto con tenant nulo. Índices `(user_id,occurred_at DESC)`, `(tenant_id,occurred_at DESC)` y `(event_code,server_recorded_at DESC)`.

### 4.14 `tenancy.onboarding_operations`

Columnas: `id uuid PK`, `actor_type text NOT NULL`, `actor_id uuid NOT NULL`, `idempotency_key text NOT NULL`, `request_checksum text NOT NULL`, `correlation_id uuid NOT NULL`, `tenant_id uuid NULL`, `company_id uuid NULL`, `branch_id uuid NULL`, `owner_user_id uuid NULL`, `tenant_membership_id uuid NULL`, `status text NOT NULL`, `reason_code text NULL`, `license_reference text NULL`, `requested_plan text NULL`, `effective_plan text NULL`, `pricing_policy_version text NULL`, `tax_policy_version text NULL`, `rounding_policy_version text NULL`, `authorization_policy_version_id uuid NULL`, `required_action text NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `completed_at timestamptz NULL`, `cancelled_at timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`.

Constraints: PK UUID v7; unique `(actor_type,actor_id,idempotency_key)`; request checksum hexadecimal lowercase de 64 caracteres; FKs simples a Tenant/User/Policy; FKs compuestas a Company, Branch y Membership cuando los resultados existen; unique parcial para cada identidad resultado; estados exactos `PENDING|IN_PROGRESS|READY_FOR_LICENSE|READY_FOR_ACTIVATION|COMPLETED|FAILED|CANCELLED|REVIEW_REQUIRED`; checks de estado/resultado/timestamps; índice `(status,updated_at,id)`. No RLS porque nace pre-tenant; solo `pos_platform_app` obtiene DML.

### 4.15 `sync.sync_operations` — perfil central de 001

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `company_id uuid NULL`, `branch_id uuid NULL`, `source_kind text NOT NULL`, `device_id uuid NULL`, `installation_id uuid NULL`, `session_id uuid NULL`, `actor_type text NOT NULL`, `actor_id uuid NULL`, `aggregate_type text NOT NULL`, `aggregate_id uuid NOT NULL`, `operation_type text NOT NULL`, `idempotency_key text NOT NULL`, `expected_version bigint NULL`, `authority_policy text NOT NULL`, `parent_operation_id uuid NULL`, `causation_id uuid NULL`, `correlation_id uuid NOT NULL`, `schema_version integer NOT NULL`, `payload jsonb NOT NULL`, `payload_checksum bytea NOT NULL`, `sync_status text NOT NULL`, `occurred_at_local timestamptz NULL`, `recorded_at_local timestamptz NULL`, `received_at_server timestamptz NULL`, `committed_at_server timestamptz NULL`, `version bigint NOT NULL DEFAULT 1`.

En 001 se restringen: `source_kind='CENTRAL_SERVICE'`; `device_id`, `installation_id`, `occurred_at_local` y `recorded_at_local` son nulos. Company/Branch y Session siguen opcionales y tenant-aware.

PK `id`; unique `(tenant_id,id)` y `(tenant_id,operation_type,idempotency_key)`; FKs Tenant, Company, Branch, Session y self parent/causation; checks scope, UUID v7, schema/version, tiempos y payload/checksum. `authority_policy` admite exactamente `LOCAL_AUTHORITATIVE_UNTIL_SYNC|SERVER_AUTHORITATIVE|APPEND_ONLY_SHARED|CENTRAL_REVIEW_REQUIRED|EXTERNAL_PROVIDER_AUTHORITATIVE|DERIVED_PROJECTION`. `sync_status` admite exactamente `LOCAL_PENDING|READY_TO_SYNC|SYNCING|SERVER_ACCEPTED|SERVER_REJECTED|CONFLICT|WAITING_FOR_DEPENDENCY|RETRY_SCHEDULED|REVIEW_REQUIRED|DEAD_LETTER|ARCHIVED`, aunque el perfil central 001 solo puede transitar por los estados compatibles con origen central. Trigger de inmutabilidad impide cambiar tenant, origen, aggregate, operation type, idempotency, payload, checksum, schema, parent, cause o correlation; solo estado técnico, tiempos centrales y version pueden avanzar. Índices `sync_operations_tenant_identity_idx` y `sync_operations_tenant_status_committed_idx`.

No se crea candidate key con Device en 001 porque Device no existe. El corte Device/Sync posterior elimina los checks nulos y agrega las candidate keys/FKs R2-A antes de admitir `LOCAL_DEVICE`.

### 4.16 `sync.outbox_entries` — perfil central de 001

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `operation_id uuid NOT NULL`, `device_id uuid NULL`, `local_sequence bigint NULL`, `operation_type text NOT NULL`, `schema_version integer NOT NULL`, `payload_checksum bytea NOT NULL`, `correlation_id uuid NOT NULL`, `causation_id uuid NULL`, `sync_status text NOT NULL`, `created_at timestamptz NOT NULL`, `available_at timestamptz NOT NULL`, `attempt_count integer NOT NULL DEFAULT 0`, `last_attempt_at timestamptz NULL`, `next_attempt_at timestamptz NULL`, `last_error_code text NULL`, `acknowledged_at timestamptz NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL DEFAULT 1`.

En 001 `device_id` y `local_sequence` son nulos por check. Constraints: UUID v7; unique global `operation_id`; unique `(tenant_id,id)` y `(tenant_id,operation_id,id)`; FK `(tenant_id,operation_id)`; `sync_status` usa el mismo check canónico de Operation; schema/version/checksum/ACK/timestamps coherentes; attempts `>=0`; trigger verifica que metadata duplicada coincide con Operation y que no existe payload/idempotency/aggregate. Índices `outbox_tenant_status_available_idx(tenant_id,sync_status,available_at,id)` y parcial `outbox_retry_pending_idx(next_attempt_at,id)`.

La unicidad garantiza como máximo una Outbox; el caso de uso y la transacción garantizan que toda Operation entregable tenga exactamente una.

### 4.17 `audit.audit_events`

Columnas obligatorias: `id uuid PK`, `actor_type text NOT NULL`, `action_code text NOT NULL`, `resource_type text NOT NULL`, `correlation_id uuid NOT NULL`, `schema_version integer NOT NULL`, `reported_at timestamptz NOT NULL`, `server_recorded_at timestamptz NOT NULL`, `result text NOT NULL`, `payload_checksum text NOT NULL`.

Columnas opcionales: `tenant_id uuid`, `company_id uuid`, `branch_id uuid`, `actor_id uuid`, `session_id uuid`, `device_id uuid`, `resource_id uuid`, `operation_id uuid`, `causation_id uuid`, `reason_code text`, `reason_detail text`, `previous_value jsonb`, `new_value jsonb`, `reviewer_actor_type text`, `reviewer_actor_id uuid`, `approver_actor_type text`, `approver_actor_id uuid`, `evidence_reference text`, `evidence_checksum text`.

`payload_checksum` y `evidence_checksum` son hexadecimal lowercase de 64 caracteres; snapshots son `jsonb` allowlisted. FKs: Session global; `(tenant_id,session_id)`, Company, Branch y Operation tenant-aware. En 001 `CHECK (device_id IS NULL)` evita referencia libre. Checks prueban scopes, pares reviewer/approver, schema version, checksums y timestamps; validación de snapshots/secretos permanece también en adapter.

RLS permite a runtime solo filas cuyo `tenant_id` coincide; las filas pre-tenant/plataforma no son visibles al runtime común. Trigger bloquea UPDATE/DELETE y trigger statement-level bloquea TRUNCATE. Índices exactos: `audit_tenant_recorded_idx`, `audit_tenant_resource_recorded_idx`, parcial `audit_tenant_actor_recorded_idx`, parcial `audit_operation_recorded_idx` y `audit_correlation_recorded_idx` según las columnas definidas en Foundation.

## 5. Índices estructurales

Además de PK/UNIQUE ya listados, 001 crea únicamente los índices de lookup, FK y trabajo mencionados por cada tabla. Toda FK hija obtiene índice con sus columnas líderes salvo que una PK/UNIQUE ya lo cubra. No hay índices JSON, GIN, particionado, índices analíticos ni tuning especulativo.

La implementación futura debe conservar los nombres declarados en este manifiesto cuando aparecen y aplicar el patrón `<tabla>_<columnas>_{fk|uq|ck|idx}` para los constraints restantes sin colisión entre schemas.

## 6. RLS, roles y grants

### 6.1 Roles cluster-level

| Role | Attributes | Use |
|---|---|---|
| `pos_schema_owner` | `NOLOGIN`, no superuser, no BYPASSRLS | propietario de schemas/tablas |
| `pos_migrator` | login administrado, no superuser, no BYPASSRLS, puede `SET ROLE pos_schema_owner` solo en pipeline autorizado | migraciones |
| `pos_app` | login administrado, no owner, no superuser, no BYPASSRLS | API tenant-aware |
| `pos_worker` | login administrado, no owner, no superuser, no BYPASSRLS | un tenant por transacción |
| `pos_platform_app` | login administrado separado, no owner, no superuser, no BYPASSRLS | onboarding/identidad de plataforma |
| `pos_platform_admin` | rol separado, BYPASSRLS, solo SELECT explícito, sin DML ni DDL | inspección global auditada |
| `pos_reporting` | NOLOGIN en 001, sin grants de datasets | reservado para proyecciones futuras |

Roles se crean/validan por infraestructura antes de la transacción de 001 porque son objetos del cluster y su restore es separado. `postgres` nunca es runtime. `pos_platform_admin` reproduce únicamente el patrón read-only demostrado por PHY-G14 y no se concede a app/worker.

### 6.2 Tablas protegidas

`tenancy.tenants`, `organization.companies`, `organization.branches`, `tenancy.tenant_memberships`, `authorization.user_role_assignments`, `identity.security_events`, `sync.sync_operations`, `sync.outbox_entries` y `audit.audit_events` reciben `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`.

Las tablas de tenant usan `USING/WITH CHECK` por tenant; Tenant compara `id`, las demás `tenant_id`. Audit y SecurityEvent usan esa política para filas tenant-scoped. Solo `pos_platform_app` recibe policy adicional para insertar/leer eventos pre-contexto con `tenant_id IS NULL`; no obtiene acceso global a filas tenant. Ninguna policy autoriza tenant nulo al runtime común. Cada request/worker abre transacción, ejecuta `SET LOCAL app.tenant_id = <uuid validado por servidor>` y luego accede; commit/rollback limpia el contexto.

Nombre exacto de cada policy tenant: `<table>_tenant_isolation`; aplica a `pos_app,pos_worker,pos_platform_app` con la misma expresión en `USING` y `WITH CHECK`. Las policies adicionales son `security_events_platform_context` y `audit_events_platform_context`, solo para `pos_platform_app`, con `tenant_id IS NULL`. No existe policy para `pos_platform_admin`: su acceso read-only usa el atributo cluster BYPASSRLS ya aislado y auditado.

### 6.3 Grants

- PUBLIC: sin CREATE en schemas y sin privilegios de tables/functions.
- `pos_schema_owner`: ownership; no login runtime.
- `pos_migrator`: USAGE solo para inspección y `SET ROLE pos_schema_owner` durante el job autorizado; ningún tráfico de negocio.
- `pos_app`: SELECT en User sin tablas de verificadores/factores/tokens; SELECT en Tenant/Company/Branch/Membership y catálogos Authorization; SELECT/INSERT/UPDATE en UserRoleAssignment bajo RLS; SELECT en Session para revocación/validación; SELECT/INSERT en SyncOperation y Outbox; UPDATE de SyncOperation limitado a `sync_status,received_at_server,committed_at_server,version`; UPDATE de Outbox limitado a `sync_status,attempt_count,last_attempt_at,next_attempt_at,last_error_code,acknowledged_at,updated_at,version`; SELECT/INSERT en AuditEvent y SecurityEvent.
- `pos_worker`: SELECT en Tenant/Company/Branch/Membership, catálogos Authorization y Assignment; SELECT en SyncOperation/Outbox; las mismas columnas UPDATE técnicas de Sync/Outbox que `pos_app`; SELECT/INSERT en AuditEvent y SecurityEvent; sin UserCredential, MfaFactor, SessionRefreshToken ni OnboardingOperation.
- `pos_platform_app`: SELECT/INSERT/UPDATE en User, UserCredential, MfaFactor, Session y SessionRefreshToken; SELECT/INSERT en SecurityEvent; SELECT/INSERT/UPDATE en OnboardingOperation; SELECT/INSERT/UPDATE bajo RLS en Tenant/Company/Branch/Membership/Assignment; SELECT en catálogos Authorization; SELECT/INSERT y UPDATE técnico en SyncOperation/Outbox; SELECT/INSERT en AuditEvent. No DELETE/TRUNCATE.
- `pos_platform_admin`: BYPASSRLS y SELECT por columna sobre User, Tenant, Company, Branch, Membership, catálogos Authorization, Assignment, todas las columnas de Session, SecurityEvent, OnboardingOperation y Outbox; en SyncOperation excluye `payload`; en AuditEvent excluye `previous_value,new_value,reason_detail,evidence_reference`; no recibe ningún privilegio sobre UserCredential, MfaFactor o SessionRefreshToken. Sin INSERT, UPDATE, DELETE, TRUNCATE, EXECUTE mutante ni ownership.
- `pos_reporting`: sin grants en 001.

`platform.current_tenant_id()` recibe EXECUTE únicamente para `pos_app,pos_worker,pos_platform_app`; `platform.is_uuid_v7(uuid)` recibe EXECUTE para esos runtimes y el owner. Ninguna función es SECURITY DEFINER.

Allowlist UPDATE adicional: User no permite cambiar `id,created_at`; Credential no permite `id,user_id,credential_type,verifier,created_at` salvo que una rotación autorizada inserte un nuevo registro y retire el anterior; MFA no permite `id,user_id,factor_type,enrolled_at`; Session no permite `id,user_id,authenticated_at,created_at`; RefreshToken nunca actualiza `id,session_id,token_family_id,parent_token_id,token_hash,issued_at,expires_at`; Onboarding nunca actualiza `id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,created_at`. Triggers/inmutabilidad y repositorios aplican además estas fronteras.

AuditEvent y SecurityEvent tienen UPDATE, DELETE y TRUNCATE revocados a todos los runtimes aun si otro grant futuro es amplio. Los catálogos Role/Permission/Grant/Policy no reciben DML runtime en 001; el futuro paquete de autorización usa un job administrativo versionado distinto de la migration.

RLS no reemplaza FKs, validación de autorización ni repositorios cerrados. La implementación traduce esta allowlist literalmente a grants de tabla/columna; nunca se usa `GRANT ALL`.

## 7. Seeds

Migration 001 inserta **cero filas de dominio**. No existen todavía códigos normativos completos para un paquete mínimo de roles/permisos/policy que pueda sembrarse sin inventar. El OWNER conceptual no concede permisos por sí mismo.

Solo el runner registra su propia ejecución en el ledger. Roles físicos no son seed de tabla. Tenant, usuarios, contraseñas, demo, capabilities, roles de negocio, permissions y policy versions no se siembran. Antes de ejecutar onboarding real deberá aprobarse y versionarse un paquete técnico de autorización separado; eso es prerrequisito del vertical, no contenido silencioso de 001.

## 8. OUT OF FIRST MIGRATION

### 8.1 PostgreSQL excluido

- schemas/tablas `devices.*` y `licensing.*`, incluidos Device, Installation, DeviceKey, License, FeatureEntitlement, LicenseActivation, revocaciones, gracia, trust keys y requests/responses;
- `authorization.offline_authorization_snapshots`;
- `sync.inbox_entries`, `sync.sync_checkpoints`, Conflict, Review, DeadLetter y Action;
- todo Catalog, Pricing, Tax, Inventory, Purchasing, Cash, Sales, Payments y Fiscal/Electronic Invoicing;
- configuración de dominio, soporte, reporting materializado, notificaciones y hardware;
- datos, views de compatibilidad y tablas de correspondencia del legado;
- funciones/procedimientos de negocio, repositories y seeds comerciales.

Motivo: ninguno es dependencia física inevitable del control plane central de 001. Inbox/Checkpoint requieren recepción/dispositivo; DeviceKey/licensing/offline requieren el PoC criptográfico; los dominios comerciales pertenecen a verticales posteriores.

### 8.2 SQLite excluido

Todas las tablas locales de Foundation, Device/Licensing, Authorization snapshot, Sync, Audit y negocio quedan fuera. En particular no se crean Inbox local genérica, User/Credential/Session/Membership editables, Device/Installation/Key, License/Activation, Operation/Outbox/Checkpoint ni snapshots Tenant/Company/Branch.

La ausencia es deliberada: sin instalación/clave/licencia verificadas y sin un hecho local autorizado, persistir esas filas produciría una autoridad offline falsa. Un corte posterior creará el conjunto local completo y atómico; no se habilitan columnas huérfanas en 001.

## 9. Contraparte SQLite exacta

`001_local_migration_control` configura y verifica `PRAGMA foreign_keys=ON`, solicita WAL y confirma que el modo efectivo es `wal`; no cambia `synchronous` sin decisión operativa del runtime certificado.

Crea únicamente `target_migration_executions` con columnas: `execution_id TEXT PK CHECK UUIDv7`, `migration_id TEXT NOT NULL`, `dialect TEXT NOT NULL CHECK='SQLITE'`, `manifest_version INTEGER NOT NULL CHECK>=1`, `checksum BLOB NOT NULL CHECK length=32`, `status TEXT NOT NULL CHECK STARTED|APPLIED|FAILED|ROLLED_BACK`, `started_at TEXT RFC3339 UTC`, `finished_at TEXT NULL`, `runner_version TEXT NOT NULL`, `error_code TEXT NULL`; checks terminales equivalentes y unique parcial por migration aplicada.

No hay decimal en este corte. Cuando exista, seguirá TEXT canónico; no se crea REAL. SQLite es un dialecto separado y no copia schemas, roles, RLS, Inbox ni tipos PostgreSQL.

## 10. Orden exacto de creación

### 10.1 PostgreSQL forward

1. Preflight: versión PostgreSQL 16, conexión segura, backup cuando aplique y ausencia de objeto objetivo incompatible.
2. Infraestructura crea/verifica roles cluster-level; si atributos o memberships difieren, detener.
3. Bootstrap crea/verifica ledger y registra `STARTED` con checksum del artefacto inmutable.
4. Iniciar transacción de 001 y `SET LOCAL ROLE pos_schema_owner` mediante migrator.
5. Crear schemas en orden: `platform`, `identity`, `tenancy`, `organization`, `authorization`, `sync`, `audit` cuando no existan bajo esta history.
6. Crear `platform.current_tenant_id()`.
7. Crear tablas en el orden 10–29 del manifiesto.
8. Crear PK/UNIQUE/CHECK inline.
9. Agregar FK no self en el orden de dependencias; luego self-FK de tokens y operaciones. Ninguna es DEFERRABLE.
10. Crear índices estructurales.
11. Crear funciones/triggers de append-only, truncate, inmutabilidad Sync y coherencia Operation/Outbox.
12. Habilitar RLS, crear policies y después FORCE RLS.
13. Revocar PUBLIC, aplicar grants allowlist y revocaciones explícitas de historia/secretos.
14. Ejecutar introspección dentro de la transacción; cualquier diferencia aborta.
15. Commit único de objetos database-local.
16. En conexión runtime separada ejecutar smoke fail-closed/RLS/grants.
17. Marcar ledger `APPLIED` únicamente después del commit y smoke obligatorio; si smoke falla, estado `FAILED` y recovery controlado, nunca éxito parcial.

Los roles/ledger son puntos de recuperación externos; schemas a grants forman una transacción PostgreSQL. No hay seed.

### 10.2 SQLite forward

1. Preflight versión/runtime, archivo correcto y ausencia de writers.
2. Abrir POS Local Service, activar `foreign_keys=ON`, solicitar/verificar WAL.
3. Crear ledger si no existe y registrar STARTED.
4. `BEGIN IMMEDIATE`; crear/validar estructura exacta del ledger e índices.
5. Introspección mediante `sqlite_schema`, `PRAGMA table_info/index_list/foreign_key_list`.
6. Commit; cerrar y reabrir; volver a verificar pragmas y ledger.
7. Marcar `APPLIED`. No se crean tablas de dominio.

## 11. Versioning y manejo de fallos

El identificador y checksum son inmutables. Un `migration_id` aplicado con checksum distinto detiene el proceso; nunca se “corrige” history. `manifest_version=1` corresponde a este documento. Reintentar un FAILED crea otro `execution_id`; no modifica la evidencia anterior. STARTED sin terminal tras crash requiere inspección y reconciliación antes de reintentar.

Una futura implementación Kysely debe adaptar su metadata interna a estos invariantes o mantenerla además del ledger; no cambia nombres, orden ni objetos de dominio para acomodar el ORM.

## 12. Convivencia con legado

LEGACY continúa en FastAPI + SQLAlchemy + Alembic y conserva `backend/alembic/versions/001_initial_schema.py`. TARGET usa histories PostgreSQL/SQLite independientes. Ningún runner objetivo descubre, marca o modifica revisiones Alembic; Alembic no administra schemas objetivo.

001 es schema-only. Clasificación de datos heredados:

- User: `transformed` por job posterior con normalización/dedup aprobadas;
- rol heredado: `transformed` solo mediante mapping aprobado a Membership/Assignment;
- tenant/company/branch: creados por mapping explícito, nunca tenant global inventado;
- auditoría heredada: `evidence only` sanitizada cuando sea verificable;
- datos demo/credenciales demo: `discarded demo`;
- ambigüedad, duplicados y huérfanos: `quarantined`;
- Sync history inexistente: `unsupported`, no se inventa;
- dominios comerciales: migrados en jobs/cortes posteriores, no en 001.

No hay dual-write implícito entre LEGACY y TARGET. La convivencia es por despliegues/rutas explícitas hasta que cada vertical tenga importación, reconciliación y cutover aprobados.

## 13. Política de data migration

Schema migration y data migration/import job son procesos distintos, con artefactos, checksum, permisos, auditoría, retry y rollback separados. El `up` de 001 no lee tablas legacy ni carga usuarios. Un import futuro debe declarar source snapshot, mapping, conteos, cuarentena, correspondencia ID y reconciliación antes de cutover.

## 14. Rollback, backup y recovery

### 14.1 Tres conceptos separados

A. `down/schema rollback`: solo para fresh install/test sin datos de dominio; revierte en orden inverso Audit → Outbox → Operation → Onboarding → Security/Session/Auth → Membership/Organization/Tenant/User, luego funciones/schemas si quedaron vacíos. No elimina roles cluster ni ledger.

B. `data rollback`: no pertenece a 001. Un import futuro define compensación/cuarentena; down no recupera datos eliminados.

C. restore: restaura backup validado y roles globales por canal separado. Es obligatorio cuando un upgrade toca una base con datos; no se inventan RPO/RTO.

### 14.2 Irreversibilidad

En instalación nueva y vacía no hay paso de datos irreversible. Una vez exista cualquier fila de dominio, down destructivo queda prohibido fuera de entorno efímero: se usa migración forward correctiva o restore. Roles preexistentes, credenciales, secrets y datos legacy nunca se eliminan por down.

### 14.3 Failure recovery

| Failure point | Detection | Required response |
|---|---|---|
| roles/preflight | atributos/ownership inesperados | stop antes de STARTED; intervención infra |
| schema/table/FK/index/policy/grant/trigger | error o introspección distinta | rollback completo de transacción PostgreSQL |
| commit incierto | conexión perdida/estado STARTED | inspeccionar catálogo y ledger; no rerun ciego |
| smoke runtime | acceso permitido/denegado incorrecto | marcar FAILED, bloquear tráfico, down solo si vacío o restore |
| SQLite pragma/schema | valor/introspección distinta | rollback, cerrar writer y conservar archivo previo |
| SQLite reopen | WAL/history no durable | FAILED; restaurar copia segura o intervención |
| ledger checksum mismatch | mismo id, bytes distintos | stop permanente hasta revisión; nunca overwrite |

No existe estado migration success parcial.

## 15. Backup previo

Fresh install vacío no requiere backup de datos, pero conserva manifest/checksum/log. Todo upgrade posterior o ejecución sobre base con datos exige backup compatible, dump de roles separado, prueba de restore y ventana de cambio. SQLite exige backup API/WAL-safe con POS Local Service detenido o checkpoint coordinado. Los valores de RPO/RTO permanecen fuera de R4.

## 16. Verification plan de implementación futura

### PostgreSQL fresh

1. ejecutar up con rol migrator;
2. introspectar schemas, tablas, columnas, tipos, defaults, PK/UNIQUE/CHECK/FK e índices;
3. confirmar owner distinto de app/worker;
4. confirmar ENABLE+FORCE y policies en nueve tablas;
5. probar tenant A/B, contexto ausente/inválido, insert/update/delete y reuse de pool;
6. probar grants/columnas sensibles y append-only/truncate;
7. probar onboarding completo, fallo inyectado e idempotencia/checksum;
8. probar Operation/Outbox 1:1 y payload inmutable;
9. dump/restore database y roles separados;
10. down únicamente en base fixture vacía y confirmar que legacy/roles/ledger sobreviven.

### SQLite fresh

1. ejecutar up sobre archivo nuevo;
2. verificar `foreign_keys=1`, journal `wal`, tabla/índices/checks del ledger;
3. cerrar/reabrir y confirmar history/checksum;
4. inyectar crash entre STARTED/commit y reconciliar;
5. backup/reopen;
6. confirmar ausencia de todas las tablas locales excluidas.

Upgrade simulation empieza cuando exista una versión TARGET anterior. El legado Alembic se valida en un entorno separado; no se presenta como upgrade desde 001 target.

## 17. Impacto del PoC criptográfico y estados de bloques

El PoC de firma/canonicalización/storage seguro no bloquea R4 ni el esquema central 001 porque ninguna tabla que persista clave pública, firma, payload firmado, license, activation o autorización offline entra en el corte. Sí bloquea cualquier migración posterior que introduzca DeviceKey, License, FeatureEntitlement, LicenseActivation, trusted keys, activation artifacts u offline snapshot. No se permite escribir `device_id` no nulo ni aceptar `LOCAL_DEVICE` antes de ese corte.

- Foundation: `APPROVED_FOR_MIGRATION_DESIGN`; R3 y R4 satisfacen evidencia/orden, pero implementación y revisión transversal siguen pendientes.
- Device/Licensing: `IN_REVIEW`; faltan auditoría final del bloque y PoC criptográfico.
- Catalog: `IN_REVIEW` y fuera de 001; siguen pendientes pruebas completas de equivalencia/ciclos y auditoría columna por columna.

Ningún `SEC-G01..SEC-G10` cambia de `PLANNED / NOT_EVALUATED`.

## 18. Riesgos y condiciones GO

Riesgos residuales:

1. el paquete normativo de roles/permisos inicial aún no está aprobado; 001 deja catálogos vacíos;
2. login operacional POS permanece bloqueado por Device/Licensing/crypto;
3. grants por columna y repositories deben verificarse en implementación, no inferirse de RLS;
4. el ledger debe integrarse con Kysely sin dos fuentes de éxito divergentes;
5. down es destructivo después de datos y no sustituye restore;
6. roles cluster-level requieren automatización/backup separados;
7. los checks temporales `device_id IS NULL` y perfil central Sync deben retirarse únicamente en el corte criptográfico completo.

R4 no encontró contradicción material nueva: acota el primer corte usando estados de onboarding y dependencias ya aprobados. Antes de GO aún se requiere revisión transversal final independiente de TECH-002 que verifique este manifiesto contra todos los bloques, apruebe el paquete inicial de Authorization, cierre el tratamiento de roles/grants en el adaptador y autorice expresamente escribir la migración.

**TECH-002 = IN_PROGRESS**

**First migration = NO-GO**
