# TECH-002B: esquema físico fundacional

## Estado y alcance

`IN_REVIEW` dentro de `TECH-002`.

Este documento diseña el bloque central que debe existir antes de catálogo, inventario, ventas o pagos:

1. tenancy y organización;
2. identidad y sesión;
3. autorización;
4. onboarding idempotente;
5. auditoría y outbox mínima de bootstrap.

No contiene DDL, no crea migraciones y no declara implementada ninguna capacidad. Sus fuentes normativas son `UC-ONB-001`, `UC-AUTH-001`, `SEC-002`, `SEC-004`, el modelo conceptual, ownership y las convenciones de `TECH-002A`.

Licencias, dispositivos e instalaciones se diseñan en el bloque siguiente. Por esa razón, las referencias opcionales desde sesión y onboarding se documentan aquí, pero sus FK se agregan únicamente cuando existan las tablas propietarias dentro del mismo corte de migración autorizado.

## Reglas del bloque

1. Todas las PK son UUID v7 generadas por aplicación.
2. Todo timestamp es `timestamptz` UTC.
3. Todo agregado mutable usa `version bigint NOT NULL DEFAULT 1 CHECK (version >= 1)`.
4. Los campos normalizados se calculan en aplicación mediante una función versionada y se vuelven a validar antes de persistir.
5. Ninguna FK tenant-scoped se valida solo por `id`: el padre expone `UNIQUE (tenant_id, id)` y el hijo usa FK compuesta cuando ambas tablas tienen tenant.
6. No hay `ON DELETE CASCADE` desde tenant, usuario, membership, rol, empresa o sucursal.
7. Los valores de estado aquí enumerados son la traducción mínima de los ciclos ya exigidos. Agregar otro estado requiere actualizar contrato, transición, migración y pruebas.
8. Una FK marcada `DIFERIDA AL BLOQUE PROPIETARIO` no se reemplaza por una relación sin control; impide autorizar una migración parcial que deje esa referencia permanentemente libre.

## Matriz de ubicación

| Agregado | PostgreSQL | SQLite productivo | Clase | Autoridad |
|---|---|---|---|---|
| Tenant, Company, Branch | tablas completas | snapshot mínimo versionado, definido con activación | `CENTRAL_MASTER_REPLICATED` | central |
| User, UserCredential, MfaFactor | tablas completas | no se replican | `CENTRAL_ONLY` | Identity central |
| Session, SessionRefreshToken | tablas completas | no se replican como tokens centrales | `CENTRAL_ONLY` | Identity central |
| Role, Permission, RolePermissionGrant, AuthorizationPolicyVersion | tablas completas | snapshot firmado/versionado, definido con autorización offline | `CENTRAL_MASTER_REPLICATED` | Authorization central |
| TenantMembership, UserRoleAssignment | tablas completas | solo snapshot efectivo mínimo, nunca tablas editables | `CENTRAL_MASTER_REPLICATED` | Tenancy/Authorization central |
| OnboardingOperation | tabla completa | no se replica | `CENTRAL_ONLY` | Tenancy central |
| SecurityEvent | tabla completa | eventos locales separados cuando corresponda | `DUAL_WITH_EXPLICIT_POLICY` | origen que confirma el evento |
| AuditEvent | tabla completa consolidada | `audit_events` append-only local | `LOCAL_AUTHORITATIVE_SYNCED` para evento local; central para evento central | origen del hecho |
| OutboxEntry | outbox central | `sync_outbox_entries` local | `DUAL_WITH_EXPLICIT_POLICY` | transacción que origina el evento |

SQLite no recibe hashes de contraseña, secretos MFA, access tokens ni refresh tokens. El acceso offline se resolverá mediante un snapshot limitado, firmado/versionado y revocable dentro del bloque Device/Licensing; no mediante una copia de las tablas centrales de identidad.

## Tenancy

### `tenancy.tenants`

Propietario: Tenants. Fuente: modelo conceptual y `UC-ONB-001`.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK UUID v7 |
| `name` | `text` | no | no vacío tras trim |
| `code` | `text` | sí | valor presentado |
| `code_normalized` | `text` | sí | ambos `code` nulos o ambos presentes |
| `status` | `text` | no | `ACTIVE`, `SUSPENDED` |
| `created_at` | `timestamptz` | no | instante de creación |
| `updated_at` | `timestamptz` | no | no anterior a `created_at` |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (id)` y PK en `id`;
- `UNIQUE (code_normalized) WHERE code_normalized IS NOT NULL`;
- `CHECK ((code IS NULL) = (code_normalized IS NULL))`;
- índice de operación por `(status, id)` solo si la consulta administrativa lo confirma.

No contiene `plan_id`, `deployment_mode` ni entitlements: Licensing conserva esa autoridad.

### `tenancy.tenant_memberships`

Propietario: Tenants. Fuente: `UC-ONB-001`, `SEC-002`.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `tenant_id` | `uuid` | no | FK `tenants.id`, RLS |
| `user_id` | `uuid` | no | FK `identity.users.id` |
| `membership_type` | `text` | no | `OWNER`, `ADMIN`, `MEMBER`, `SERVICE` |
| `status` | `text` | no | `PENDING`, `ACTIVE`, `SUSPENDED`, `REVOKED` |
| `is_primary` | `boolean` | no | default `false` |
| `created_by_actor_type` | `text` | no | `USER`, `PLATFORM_ACCOUNT` o `SYSTEM` según flujo autorizado |
| `created_by_actor_id` | `uuid` | sí | nulo únicamente para `SYSTEM` |
| `created_at` | `timestamptz` | no | creación |
| `activated_at` | `timestamptz` | sí | requerido al estar `ACTIVE` |
| `suspended_at` | `timestamptz` | sí | requerido al estar `SUSPENDED` |
| `revoked_at` | `timestamptz` | sí | requerido al estar `REVOKED` |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (tenant_id, id)` para FK tenant-scoped;
- `UNIQUE (user_id, id)` para que Session valide usuario y membership en una FK compuesta;
- una sola relación no revocada por `(tenant_id, user_id)`: índice unique parcial con `status <> 'REVOKED'`;
- máximo una membership primaria vigente por usuario: unique parcial `(user_id) WHERE is_primary AND status = 'ACTIVE'`;
- índice `(user_id, status, tenant_id)` para selección explícita de contexto;
- checks de coherencia entre estado y timestamp;
- la regla “al menos un OWNER activo” no cabe en un `CHECK`: se protege en el caso de uso con lock sobre el tenant, auditoría y prueba concurrente.

## Organización

### `organization.companies`

Propietario: Companies.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `tenant_id` | `uuid` | no | FK tenant, RLS |
| `legal_name` | `text` | sí | requerido cuando contrato fiscal/comercial lo exija |
| `trade_name` | `text` | no | `company_name` de onboarding, no vacío |
| `tax_id` | `text` | sí | valor presentado |
| `tax_id_normalized` | `text` | sí | acompaña a `tax_id` |
| `email` | `text` | sí | valor validado |
| `phone` | `text` | sí | valor presentado |
| `phone_normalized` | `text` | sí | acompaña a `phone` |
| `timezone` | `text` | no | identificador IANA validado |
| `currency_code` | `char(3)` | no | ISO 4217 uppercase |
| `status` | `text` | no | `ACTIVE`, `INACTIVE` |
| `created_at` | `timestamptz` | no | creación |
| `updated_at` | `timestamptz` | no | actualización |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (tenant_id, id)`;
- unique parcial `(tenant_id, tax_id_normalized) WHERE tax_id_normalized IS NOT NULL`;
- checks de pares original/normalizado;
- índice `(tenant_id, status, id)` para listado operativo;
- RLS por `tenant_id`.

### `organization.branches`

Propietario: Branches.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `tenant_id` | `uuid` | no | RLS |
| `company_id` | `uuid` | no | FK compuesta `(tenant_id, company_id)` |
| `name` | `text` | no | no vacío |
| `code` | `text` | sí | valor presentado |
| `code_normalized` | `text` | sí | acompaña a `code` |
| `address` | `text` | sí | dirección libre validada |
| `city` | `text` | sí | ciudad presentada |
| `latitude` | `numeric(9,6)` | sí | `[-90, 90]`, par con longitude |
| `longitude` | `numeric(9,6)` | sí | `[-180, 180]`, par con latitude |
| `timezone` | `text` | no | IANA; congela nuevas fechas de negocio |
| `status` | `text` | no | `ACTIVE`, `INACTIVE` |
| `created_at` | `timestamptz` | no | creación |
| `updated_at` | `timestamptz` | no | actualización |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, company_id, id)`;
- unique parcial `(tenant_id, company_id, code_normalized) WHERE code_normalized IS NOT NULL`;
- FK `(tenant_id, company_id) -> organization.companies(tenant_id, id)`;
- `CHECK ((latitude IS NULL) = (longitude IS NULL))` y rangos geográficos;
- índice `(tenant_id, company_id, status, id)`;
- RLS por `tenant_id`.

## Identidad

### `identity.users`

Propietario: Identity. La identidad es global y no contiene `tenant_id`.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `email` | `text` | no | valor presentado |
| `email_normalized` | `text` | no | identidad inicial global |
| `phone` | `text` | sí | valor presentado |
| `phone_normalized` | `text` | sí | acompaña a `phone` |
| `full_name` | `text` | no | no vacío |
| `status` | `text` | no | `ACTIVE`, `INACTIVE` |
| `created_at` | `timestamptz` | no | creación |
| `updated_at` | `timestamptz` | no | actualización |
| `version` | `bigint` | no | concurrencia optimista |

Constraints: unique global `email_normalized`, par phone original/normalizado y ningún borrado en cascada hacia memberships, sesiones o auditoría.

### `identity.user_credentials`

Propietario: Identity. Solo `PASSWORD` está respaldado hoy por `UC-AUTH-001`; otro tipo exige contrato propio.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `user_id` | `uuid` | no | FK user |
| `credential_type` | `text` | no | check inicial `PASSWORD` |
| `verifier` | `text` | no | hash con algoritmo/parámetros/salt; nunca secreto reversible |
| `status` | `text` | no | `ACTIVE`, `RETIRED`, `REVOKED` |
| `failed_attempt_count` | `integer` | no | default 0, `>= 0` |
| `locked_until` | `timestamptz` | sí | bloqueo temporal; no nuevo estado |
| `created_at` | `timestamptz` | no | creación |
| `rotated_at` | `timestamptz` | sí | retiro por rotación |
| `last_used_at` | `timestamptz` | sí | uso válido |
| `revoked_at` | `timestamptz` | sí | requerido si `REVOKED` |
| `retained_until` | `timestamptz` | sí | política de retención, no habilita uso |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- unique parcial `(user_id, credential_type) WHERE status = 'ACTIVE'`;
- índice `(user_id, status)`;
- `verifier` nunca se incluye en outbox, auditoría, logs o respuestas;
- rotación bloquea el conjunto del usuario y retira la anterior en la misma transacción.

### `identity.mfa_factors`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `user_id` | `uuid` | no | FK user |
| `factor_type` | `text` | no | código soportado por implementación aprobada |
| `secret_reference` | `text` | sí | referencia SEC-004, nunca secreto |
| `status` | `text` | no | `PENDING`, `ACTIVE`, `REVOKED` |
| `enrolled_at` | `timestamptz` | no | alta |
| `verified_at` | `timestamptz` | sí | requerido para `ACTIVE` |
| `last_used_at` | `timestamptz` | sí | verificación válida |
| `revoked_at` | `timestamptz` | sí | requerido para `REVOKED` |
| `retained_until` | `timestamptz` | sí | retención |
| `version` | `bigint` | no | concurrencia optimista |

Índice `(user_id, status, factor_type)`. No se define un método MFA concreto hasta que su implementación y recuperación tengan pruebas de seguridad.

### `identity.sessions`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `user_id` | `uuid` | no | FK user |
| `tenant_membership_id` | `uuid` | sí | contexto seleccionado, FK compuesta con `user_id` |
| `device_id` | `uuid` | sí | `DIFERIDA AL BLOQUE DEVICES` |
| `authenticated_at` | `timestamptz` | no | autenticación inicial |
| `expires_at` | `timestamptz` | no | posterior a autenticación |
| `last_reauthenticated_at` | `timestamptz` | sí | evidencia distinta de MFA |
| `mfa_status` | `text` | no | `NOT_REQUIRED`, `PENDING`, `SATISFIED` |
| `authorization_policy_version_id` | `uuid` | sí | FK política aplicada |
| `offline_valid_until` | `timestamptz` | sí | nunca posterior a `expires_at` |
| `revoked_at` | `timestamptz` | sí | revocación irreversible |
| `revoked_by_actor_type` | `text` | sí | `USER`, `PLATFORM_ACCOUNT` o `SYSTEM` |
| `revoked_by_actor_id` | `uuid` | sí | nulo únicamente si el tipo es `SYSTEM` |
| `revocation_reason` | `text` | sí | requerido si revocada |
| `created_at` | `timestamptz` | no | persistencia |
| `version` | `bigint` | no | concurrencia optimista |

Índices: `(user_id, expires_at) WHERE revoked_at IS NULL`, `(tenant_membership_id, expires_at) WHERE revoked_at IS NULL` y `(device_id, expires_at) WHERE device_id IS NOT NULL AND revoked_at IS NULL`.

La FK `(user_id, tenant_membership_id)` impide seleccionar una membership de otro usuario. La aplicación además exige que esté activa y evalúa su tenant dentro de la transacción.

### `identity.session_refresh_tokens`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `session_id` | `uuid` | no | FK session |
| `token_family_id` | `uuid` | no | identidad estable de familia |
| `parent_token_id` | `uuid` | sí | FK self |
| `token_hash` | `text` | no | hash no reversible, unique global |
| `issued_at` | `timestamptz` | no | emisión |
| `expires_at` | `timestamptz` | no | posterior a emisión |
| `consumed_at` | `timestamptz` | sí | uso único |
| `replacement_token_id` | `uuid` | sí | FK self, sucesor único |
| `revoked_at` | `timestamptz` | sí | invalidación |
| `revocation_reason` | `text` | sí | requerido si revocado |
| `reuse_detected_at` | `timestamptz` | sí | señal de replay |
| `retained_until` | `timestamptz` | sí | detección/retención |

Constraints e índices:

- `UNIQUE (token_hash)`, `UNIQUE (parent_token_id) WHERE parent_token_id IS NOT NULL` y `UNIQUE (replacement_token_id) WHERE replacement_token_id IS NOT NULL`;
- índice `(session_id, token_family_id, expires_at)`;
- consumo y creación del reemplazo ocurren en una transacción con lock de la fila presentada;
- un token con `consumed_at`, `revoked_at`, `reuse_detected_at` o expiración no emite sucesor;
- reutilización bloquea la familia, revoca sesión conforme a política y crea `SecurityEvent`.

### `identity.security_events`

Append-only; propietario Identity.

Columnas: `id uuid PK`, `user_id uuid NULL`, `session_id uuid NULL`, `tenant_id uuid NULL`, `device_id uuid NULL` (`DIFERIDA AL BLOQUE DEVICES`), `event_code text NOT NULL`, `result text NOT NULL`, `reason_code text NULL`, `ip_address inet NULL`, `evidence_checksum text NULL`, `correlation_id uuid NOT NULL`, `occurred_at timestamptz NOT NULL`, `server_recorded_at timestamptz NOT NULL`.

Índices: `(user_id, occurred_at DESC)`, `(tenant_id, occurred_at DESC)` y `(event_code, server_recorded_at DESC)`. No contiene credenciales, tokens, códigos MFA ni payload arbitrario.

## Autorización

### Catálogos globales

`authorization.roles`:

- `id uuid PK`;
- `code text NOT NULL`;
- `name text NOT NULL`;
- `scope_type text NOT NULL CHECK (scope_type IN ('PLATFORM','BUSINESS'))`;
- `version bigint NOT NULL CHECK (version >= 1)` como versión de definición, no lock mutable;
- `status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED'))`;
- `created_at timestamptz NOT NULL`;
- `retired_at timestamptz NULL`;
- `UNIQUE (code, version)`.

`authorization.permissions`:

- `id uuid PK`;
- `code text NOT NULL UNIQUE`;
- `module text NOT NULL`;
- `description text NOT NULL`;
- `status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED'))`;
- `created_at timestamptz NOT NULL`;
- `retired_at timestamptz NULL`.

Un rol o permiso usado se retira; no se edita ni elimina.

### `authorization.role_permission_grants`

Columnas: `id uuid PK`, `role_id uuid NOT NULL`, `permission_id uuid NOT NULL`, `grant_version bigint NOT NULL`, `status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED'))`, `valid_from timestamptz NOT NULL`, `valid_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`.

Constraints:

- `UNIQUE (role_id, permission_id, grant_version)`;
- rango válido `valid_until IS NULL OR valid_until > valid_from`;
- una versión publicada es inmutable;
- no se usa JSON para representar la relación.

### `authorization.authorization_policy_versions`

Columnas: `id uuid PK`, `code text NOT NULL`, `version bigint NOT NULL`, `ruleset_checksum text NOT NULL`, `status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED'))`, `effective_from timestamptz NOT NULL`, `effective_until timestamptz NULL`, `created_at timestamptz NOT NULL`, `retired_at timestamptz NULL`, `UNIQUE (code, version)`.

El registro identifica el ruleset backend exacto. No contiene un JSON ejecutable ni permite definir permisos desde datos. El despliegue falla cerrado si la versión activa no corresponde al checksum soportado por la aplicación.

### `authorization.user_role_assignments`

Propietario: Authorization. Tenant-scoped con RLS.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `tenant_id` | `uuid` | no | duplicado controlado para RLS; coincide con membership |
| `tenant_membership_id` | `uuid` | no | FK compuesta al tenant |
| `role_id` | `uuid` | no | FK role |
| `company_id` | `uuid` | sí | scope opcional, mismo tenant |
| `branch_id` | `uuid` | sí | scope opcional, exige company |
| `status` | `text` | no | `ACTIVE`, `REVOKED` |
| `valid_from` | `timestamptz` | no | vigencia |
| `valid_until` | `timestamptz` | sí | posterior a inicio |
| `created_at` | `timestamptz` | no | creación |
| `created_by_actor_type` | `text` | no | `USER`, `PLATFORM_ACCOUNT` o `SYSTEM` |
| `created_by_actor_id` | `uuid` | sí | nulo únicamente para `SYSTEM` |
| `revoked_at` | `timestamptz` | sí | requerido si revocada |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (tenant_id, id)`;
- FK `(tenant_id, tenant_membership_id)`;
- FK `(tenant_id, company_id)` cuando company exista;
- FK `(tenant_id, company_id, branch_id)` cuando branch exista;
- `CHECK (branch_id IS NULL OR company_id IS NOT NULL)`;
- unique parcial del grant vigente por `(tenant_membership_id, role_id, company_id, branch_id)` usando índices separados para scopes nulos, porque `NULL` no debe permitir duplicados silenciosos;
- índice de evaluación `(tenant_id, tenant_membership_id, status, valid_from, valid_until)`;
- RLS por `tenant_id`.

## Onboarding idempotente

### `tenancy.onboarding_operations`

Propietario: Tenants. `CENTRAL_ONLY`. Existe antes del tenant y por ello no aplica RLS basada exclusivamente en tenant; solo puertos administrativos autorizados pueden accederla.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | `onboarding_id`, PK |
| `actor_type` | `text` | no | `USER` o `PLATFORM_ACCOUNT`; onboarding exige actor autenticado |
| `actor_id` | `uuid` | no | identidad autenticada |
| `idempotency_key` | `text` | no | no secreta, longitud acotada por contrato API |
| `request_checksum` | `text` | no | checksum del request canónico |
| `correlation_id` | `uuid` | no | trazabilidad extremo a extremo |
| `tenant_id` | `uuid` | sí | resultado |
| `company_id` | `uuid` | sí | resultado |
| `branch_id` | `uuid` | sí | resultado |
| `owner_user_id` | `uuid` | sí | resultado |
| `tenant_membership_id` | `uuid` | sí | resultado |
| `status` | `text` | no | estados exactos de `UC-ONB-001` |
| `reason_code` | `text` | sí | error/decisión estable |
| `license_reference` | `text` | sí | referencia, no licencia ni secreto |
| `requested_plan` | `text` | sí | solicitud comercial |
| `effective_plan` | `text` | sí | respuesta de Licensing cuando exista |
| `pricing_policy_version` | `text` | sí | referencia de versión |
| `tax_policy_version` | `text` | sí | referencia de versión |
| `rounding_policy_version` | `text` | sí | referencia de versión |
| `authorization_policy_version_id` | `uuid` | sí | FK versión ABAC |
| `required_action` | `text` | sí | código estable |
| `created_at` | `timestamptz` | no | inicio |
| `updated_at` | `timestamptz` | no | última transición |
| `completed_at` | `timestamptz` | sí | solo `COMPLETED` |
| `cancelled_at` | `timestamptz` | sí | solo `CANCELLED` |
| `version` | `bigint` | no | concurrencia optimista |

Constraints e índices:

- `UNIQUE (actor_type, actor_id, idempotency_key)`;
- unique parcial `tenant_id`, `company_id`, `branch_id` y `tenant_membership_id` cuando presentes para impedir que dos onboardings reclamen el mismo resultado;
- checks de timestamps por estado;
- índice `(status, updated_at, id)` para recuperación de operaciones incompletas;
- la misma clave con checksum distinto retorna conflicto sin update.

## Auditoría y outbox del bootstrap

### `audit.audit_events`

Append-only. Columnas mínimas:

- `id uuid PK`;
- `tenant_id uuid NULL` porque el evento inicial puede preceder su creación;
- `company_id uuid NULL`;
- `branch_id uuid NULL`;
- `actor_type text NOT NULL`;
- `actor_id uuid NULL`;
- `session_id uuid NULL`;
- `device_id uuid NULL` con FK diferida a Devices;
- `action text NOT NULL`;
- `resource_type text NOT NULL`;
- `resource_id uuid NULL`;
- `correlation_id uuid NOT NULL`;
- `operation_id uuid NULL`;
- `reported_at timestamptz NOT NULL`;
- `server_recorded_at timestamptz NOT NULL`;
- `result text NOT NULL`;
- `reason_code text NULL`;
- `evidence_checksum text NULL`.

Índices: `(tenant_id, server_recorded_at DESC, id)`, `(tenant_id, resource_type, resource_id, server_recorded_at DESC)` y `(correlation_id, server_recorded_at, id)`. Los roles de aplicación reciben `INSERT` y `SELECT` autorizado, nunca `UPDATE` o `DELETE`.

### `sync.outbox_entries`

Payload de evento inmutable con metadata de entrega mutable; propietario Sync para transporte y creado por la transacción del módulo origen.

Columnas: `id uuid PK`, `tenant_id uuid NULL`, `origin_module text NOT NULL`, `aggregate_type text NOT NULL`, `aggregate_id uuid NOT NULL`, `event_type text NOT NULL`, `event_version integer NOT NULL CHECK (event_version >= 1)`, `payload jsonb NOT NULL`, `payload_checksum text NOT NULL`, `idempotency_key text NOT NULL`, `correlation_id uuid NOT NULL`, `occurred_at timestamptz NOT NULL`, `available_at timestamptz NOT NULL`, `published_at timestamptz NULL`, `attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`, `next_attempt_at timestamptz NULL`, `last_error_code text NULL`.

Constraints e índices:

- `UNIQUE (origin_module, idempotency_key, event_type)`;
- índice parcial `(available_at, id) WHERE published_at IS NULL AND next_attempt_at IS NULL`;
- índice parcial `(next_attempt_at, id) WHERE published_at IS NULL AND next_attempt_at IS NOT NULL`;
- el payload tiene schema versionado, checksum y allowlist; no contiene secretos;
- publicar no modifica el hecho de dominio; solo establece metadata de entrega de la outbox.

El modelo completo de inbox, reintentos, dead letter, conflictos y checkpoints se cierra en el bloque Sync. Esta tabla mínima existe aquí porque `UC-ONB-001` exige que la outbox se confirme en la misma transacción del bootstrap.

## Frontera transaccional de onboarding

Una única transacción PostgreSQL con aislamiento capaz de serializar la identidad lógica del onboarding ejecuta:

1. reservar o leer `onboarding_operations` por actor e idempotency key;
2. comparar `request_checksum`;
3. resolver o crear `identity.users` sin asumir pertenencia por coincidencia;
4. crear Tenant, Company y Branch;
5. crear membership OWNER;
6. crear asignación explícita del rol de negocio publicado;
7. asociar las versiones iniciales de política ya existentes;
8. persistir eventos de auditoría;
9. persistir outbox;
10. cerrar el resultado de onboarding;
11. commit único.

La emisión/activación de licencia y el registro/activación del dispositivo ocurren después en operaciones idempotentes separadas. No se simula una transacción distribuida.

## Pruebas físicas obligatorias antes de DDL

1. Dos solicitudes concurrentes con misma clave/checksum producen un solo resultado.
2. Misma clave con distinto checksum produce conflicto sin efectos adicionales.
3. Dos intentos concurrentes no crean el mismo correo normalizado ni identidad comercial duplicada.
4. No puede existir Branch cruzando tenant y Company.
5. No puede existir UserRoleAssignment cruzando tenant, membership, Company o Branch.
6. Revocar la última membership OWNER activa se rechaza bajo concurrencia.
7. Rotar refresh token concurrentemente produce un solo sucesor; el segundo uso dispara replay.
8. Revocar sesión invalida toda la familia de refresh tokens.
9. Ningún secreto o token utilizable aparece en DB de auditoría, outbox, logs o SQLite.
10. Roles de aplicación no actualizan ni eliminan AuditEvent.
11. RLS niega acceso cruzado y sin contexto en todas las tablas tenant-scoped.
12. Un fallo antes del commit no deja Tenant, Company, Branch, membership, assignment, audit u outbox parciales.

## Pendientes explícitos para el siguiente bloque

No son omisiones silenciosas ni autorización para improvisar:

1. materializar `devices.installations`, Device, DeviceKey y su relación con Activation/License;
2. agregar FK física de `identity.sessions.device_id`, `identity.security_events.device_id` y `audit.audit_events.device_id`;
3. definir el snapshot offline mínimo de identidad/autorización sin replicar credenciales centrales;
4. resolver la autoridad de estados de licencia y activación;
5. ejecutar el PoC RLS de `PHY-G14` antes de cualquier migración PostgreSQL.

## Gate del bloque

Este bloque pasa a `APPROVED_FOR_MIGRATION_DESIGN` solamente si:

- la revisión contra `UC-ONB-001`, `UC-AUTH-001`, `SEC-002` y `SEC-004` no encuentra campos o transiciones sin fuente;
- el bloque Device/Licensing cierra todas las FK diferidas;
- el PoC de RLS demuestra aislamiento y ausencia de fuga de contexto;
- la estrategia completa de migraciones define orden, rollback y convivencia con el esquema heredado.

Hasta entonces, el estado global de primera migración permanece `NO-GO`.
