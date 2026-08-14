# TECH-002B: esquema físico fundacional

## Estado y alcance

`APPROVED_FOR_MIGRATION_DESIGN` para el scope exacto de migration 001 definido por R4 y corregido normativamente por R5. La revisión transversal final #2 autoriza implementar ese scope (`GO_AUTHORIZED`), pero este documento no contiene DDL ni declara la migración implementada.

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
| OutboxEntry | sobre central cuando la operación se origina centralmente | `sync_outbox_entries` cuando se origina localmente | `DUAL_WITH_EXPLICIT_POLICY` | nodo/transacción que origina la operación; entrega y ACK según `DEC-007` |

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
- `UNIQUE (tenant_id, user_id, id, membership_type)` para que Onboarding valide en una sola FK tenant, propietario, membership y tipo `OWNER`;
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
| `tenant_id` | `uuid` | sí | contexto tenant seleccionado; nulo antes de seleccionarlo |
| `tenant_membership_id` | `uuid` | sí | contexto seleccionado, FK compuesta con `user_id` |
| `device_id` | `uuid` | sí | Device del mismo tenant cuando existe contexto |
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

Candidate keys, FKs e índices:

- `UNIQUE (tenant_id, id)` habilita referencias tenant-aware desde Sync/Audit; la PK global en `id` permanece canónica;
- FK `(user_id, tenant_membership_id)` impide seleccionar una membership de otro usuario;
- FK `(tenant_id, tenant_membership_id)` verifica el tenant seleccionado;
- FK `(tenant_id, device_id)` a Devices cuando Device exista;
- `CHECK ((tenant_id IS NULL) = (tenant_membership_id IS NULL))` y `CHECK (device_id IS NULL OR tenant_id IS NOT NULL)`;
- índices `(user_id, expires_at) WHERE revoked_at IS NULL`, `(tenant_id, tenant_membership_id, expires_at) WHERE tenant_membership_id IS NOT NULL AND revoked_at IS NULL` y `(tenant_id, device_id, expires_at) WHERE device_id IS NOT NULL AND revoked_at IS NULL`.

La aplicación además exige membership activa y Device permitido dentro de la misma transacción. Una sesión pre-contexto no puede originar una operación tenant-scoped ni vincular Device.

Session es una entidad global de Identity que puede adquirir contexto tenant; no es una tabla libre para el runtime común. PostgreSQL aplica `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`:

- `sessions_tenant_context` es `FOR SELECT TO pos_app` y exige `tenant_id` no nulo igual al contexto validado de la transacción; nunca expone sesiones pre-contexto;
- `sessions_identity_select`, `sessions_identity_insert` y `sessions_identity_update`, solo para `pos_platform_app`, separan SELECT/INSERT/UPDATE global para login pre-contexto, selección de contexto, refresh lookup y revocación; no existe policy DELETE;
- `pos_worker` no recibe grants; `pos_app` no actualiza Session; RefreshToken solo es accesible por `pos_platform_app`;
- el path administrativo global es `pos_platform_admin`, read-only, explícito y auditado; ningún runtime es owner, superuser o BYPASSRLS.

La frontera anterior requiere prueba física sobre el DDL real: tenant A/B, tenant nulo, contexto inválido, reuse de pool, login pre-contexto, refresh/revocation y ausencia de lookup global desde `pos_app`/worker. El PoC previo de PHY-G14 demuestra el patrón, no esta tabla concreta.

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

Columnas: `id uuid PK`, `user_id uuid NULL`, `session_id uuid NULL`, `tenant_id uuid NULL`, `device_id uuid NULL`, `event_code text NOT NULL`, `result text NOT NULL`, `reason_code text NULL`, `ip_address inet NULL`, `evidence_checksum text NULL`, `correlation_id uuid NOT NULL`, `occurred_at timestamptz NOT NULL`, `server_recorded_at timestamptz NOT NULL`.

FK global `session_id -> sessions(id)` cuando exista, FK `(tenant_id, session_id)` para evento con contexto y FK `(tenant_id, device_id)` cuando Device exista; `CHECK (device_id IS NULL OR tenant_id IS NOT NULL)`. Así Session y Device presentes en contexto corresponden físicamente al mismo tenant, mientras una señal pre-contexto aún puede referenciar su Session global. Las referencias históricas usan `NO ACTION` y ninguna revocación borra el evento. Índices: `(user_id, occurred_at DESC)`, `(tenant_id, occurred_at DESC)` y `(event_code, server_recorded_at DESC)`. No contiene credenciales, tokens, códigos MFA ni payload arbitrario.

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
| `owner_membership_type` | `text` generado | no | constante física `OWNER`, no segunda fuente de autoridad |
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
- FK `(tenant_id, owner_user_id, tenant_membership_id, owner_membership_type) -> tenancy.tenant_memberships(tenant_id, user_id, id, membership_type)`; la membership referenciada es la única autoridad de pertenencia/tipo;
- el grupo `(tenant_id, company_id, branch_id, tenant_membership_id)` es todo nulo o todo presente; `owner_user_id` puede resolverse antes del grupo, pero es obligatorio cuando este existe;
- `READY_FOR_LICENSE`, `READY_FOR_ACTIVATION` y `COMPLETED` exigen grupo y owner completos; `PENDING` no admite grupo estructural;
- unique parcial `tenant_id`, `company_id`, `branch_id` y `tenant_membership_id` cuando presentes para impedir que dos onboardings reclamen el mismo resultado;
- checks de timestamps por estado;
- índice `(status, updated_at, id)` para recuperación de operaciones incompletas;
- la misma clave con checksum distinto retorna conflicto sin update.

## Auditoría y outbox del bootstrap

### `audit.audit_events`

Append-only. La fila es evidencia acotada de una acción, no un contenedor de payloads arbitrarios.

Columnas obligatorias:

- `id uuid PK`;
- `actor_type text NOT NULL`;
- `action_code text NOT NULL`;
- `resource_type text NOT NULL`;
- `resource_reference_kind text NOT NULL` con valores `INSTANCE`, `SYSTEM` o `BATCH`;
- `correlation_id uuid NOT NULL`;
- `schema_version integer NOT NULL CHECK (schema_version >= 1)`;
- `reported_at timestamptz NOT NULL`;
- `server_recorded_at timestamptz NOT NULL`;
- `result text NOT NULL`;
- `payload_checksum text NOT NULL`.

Columnas opcionales por contexto:

- `tenant_id uuid NULL` solo para evento de plataforma o bootstrap previo a crear Tenant;
- `company_id uuid NULL` y `branch_id uuid NULL` con scope tenant-aware cuando existan;
- `actor_id uuid NULL`, permitido nulo para proceso identificado por `actor_type`;
- `session_id uuid NULL`;
- `device_id uuid NULL` con FK tenant-aware a Devices cuando exista;
- `resource_id uuid NULL`;
- `operation_id uuid NULL`;
- `causation_id uuid NULL`;
- `reason_code text NULL`;
- `reason_detail text NULL` sanitizado;
- `previous_value jsonb NULL`;
- `new_value jsonb NULL`;
- `reviewer_actor_type text NULL` y `reviewer_actor_id uuid NULL`;
- `approver_actor_type text NULL` y `approver_actor_id uuid NULL`;
- `evidence_reference text NULL` y `evidence_checksum text NULL`.

Reglas condicionales:

1. `INSTANCE` representa una única fila estable y exige `resource_id`; incluye onboarding/configuration publication una vez existe su fila.
2. `SYSTEM` representa un hecho global o pre-recurso sin una instancia persistida y exige `resource_id NULL`.
3. `BATCH` representa un conjunto, exige `resource_id NULL` y `operation_id NOT NULL`; Operation identifica el trabajo, no se usa UUID ficticio.
4. Login, MFA y replay ordinarios pertenecen a SecurityEvent; AuditEvent solo los registra cuando existe una acción administrativa distinta, usando `INSTANCE` sobre User/Session.
5. Todo evento tenant-scoped exige `tenant_id`; Company, Branch, actor, recurso, operación y dispositivo deben pertenecer al mismo tenant cuando existan.
6. `operation_id` es obligatorio para una operación idempotente/sincronizable y `causation_id` cuando existe causa conocida distinta.
7. Motivo es obligatorio para override, rechazo, aprobación, reapertura, compensación o acción administrativa crítica.
8. Reviewer/approver se exigen cuando la política aplicable requiere revisión, aprobación o segregación; sus pares tipo/id son ambos presentes o ambos ausentes.
9. `previous_value`/`new_value` son snapshots limitados, con schema conocido, allowlist y redacción. No duplican el agregado completo si basta una referencia, diff acotado o checksum.
10. Nunca contienen passwords, tokens, secretos MFA, PAN, CVV, claves privadas, certificados utilizables, blobs completos de proveedor ni payload fiscal innecesario.
11. `payload_checksum` cubre la representación canónica del evento sanitizado; no demuestra por sí solo autenticidad criptográfica.
12. Los roles operacionales no reciben `UPDATE`, `DELETE` ni `TRUNCATE`; correcciones generan otro AuditEvent causalmente relacionado.

FK global `session_id -> sessions(id)` y FKs tenant-aware `(tenant_id, company_id)`, `(tenant_id, company_id, branch_id)`, `(tenant_id, device_id)`, `(tenant_id, session_id)` y `(tenant_id, operation_id)` cuando cada referencia tenant-scoped exista. Checks exigen `tenant_id` para Company, Branch, Device u Operation; un evento de plataforma/bootstrap sin Tenant solo puede conservar Session pre-contexto y referencias globales permitidas. Todas usan `NO ACTION`; retirar actor, Device u Operation no borra auditoría.

Índices candidatos justificados: `(tenant_id, server_recorded_at DESC, id)`, `(tenant_id, resource_type, resource_id, server_recorded_at DESC)`, `(tenant_id, actor_type, actor_id, server_recorded_at DESC)` cuando actor exista, `(operation_id, server_recorded_at, id)` cuando operación exista y `(correlation_id, server_recorded_at, id)`. No se indexan snapshots JSON ni campos sensibles por conveniencia.

### `sync.outbox_entries`

Sobre persistente de entrega y retry; propietario Sync para transporte y creado por la misma transacción que `SyncOperation` y el hecho del módulo origen. `SyncOperation` conserva intención, payload canónico, checksum, identidad e idempotencia. Outbox no duplica ese payload ni decide el resultado de negocio.

Columnas: `id uuid PK`, `tenant_id uuid NOT NULL`, `operation_id uuid NOT NULL`, `device_id uuid NULL`, `local_sequence bigint NULL`, `operation_type text NOT NULL`, `schema_version integer NOT NULL CHECK (schema_version >= 1)`, `payload_checksum bytea NOT NULL`, `correlation_id uuid NOT NULL`, `causation_id uuid NULL`, `sync_status text NOT NULL`, `created_at timestamptz NOT NULL`, `available_at timestamptz NOT NULL`, `attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`, `last_attempt_at timestamptz NULL`, `next_attempt_at timestamptz NULL`, `last_error_code text NULL`, `acknowledged_at timestamptz NULL`, `updated_at timestamptz NOT NULL`, `version bigint NOT NULL`.

Constraints e índices:

- `UNIQUE (operation_id)`, `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, operation_id, id)` garantizan una sola OutboxEntry autoritativa por operación y habilitan referencias tenant-aware;
- FK tenant-aware `(tenant_id, operation_id)` a `SyncOperation`; se materializa en el corte conjunto y no se permite una Outbox productiva huérfana;
- FK `(tenant_id, device_id, operation_id)` a la candidate key de `SyncOperation` cuando el origen sea local, para que Outbox y Operation compartan Device;
- check `device_id` y `local_sequence` ambos presentes para origen local o ambos ausentes para origen central;
- unique parcial `(tenant_id, device_id, local_sequence) WHERE device_id IS NOT NULL`;
- `operation_type`, `schema_version`, `payload_checksum`, correlación y causalidad coinciden con `SyncOperation`; checksum distinto es conflicto y no update;
- toda `SyncOperation` originada que requiere entrega crea exactamente una OutboxEntry en la misma transacción; `UNIQUE (operation_id)` impide duplicarla y el caso de uso impide omitirla;
- `sync_status` reutiliza los estados canónicos de `DEC-007`; `acknowledged_at` solo existe con resultado receptor confirmado;
- índice `(tenant_id, device_id, sync_status, available_at, local_sequence)` para trabajo local elegible;
- índice parcial `(next_attempt_at, id) WHERE next_attempt_at IS NOT NULL AND acknowledged_at IS NULL`;
- retry actualiza metadata sobre la misma fila y nunca crea otra intención, operación o payload;
- ACK perdido se resuelve consultando Inbox por `operation_id`/checksum y completa la misma OutboxEntry;
- Outbox no contiene `idempotency_key`, aggregate fields ni payload de negocio duplicados: los resuelve desde `SyncOperation`;
- Outbox no resuelve conflictos de dominio; Inbox deduplica/retorna resultado y SyncDeadLetter trata agotamiento o error permanente.

El contrato completo de Operation, Outbox, Inbox, checkpoints, conflictos, reviews y dead letter se cierra documentalmente en `sync-base-schema.md`. Esta tabla se conserva aquí porque `UC-ONB-001` exige que operación, hecho de negocio y sobre de entrega compartan transacción.

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
9. persistir `SyncOperation` y su única `OutboxEntry` en la misma transacción;
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
13. AuditEvent rechaza update/delete operacional, snapshot no permitido, secreto y scope cross-tenant.
14. AuditEvent conserva correlation/causation, schema y checksum y exige reviewer/approver según política.
15. Una operación produce una sola OutboxEntry y una secuencia local no se repite por tenant/dispositivo.
16. Mismo `operation_id`/checksum reutiliza Outbox; checksum distinto produce conflicto sin mutación.
17. Retry conserva operation/outbox y solo actualiza metadata de entrega.
18. ACK perdido consulta Inbox y no crea otro efecto ni otra OutboxEntry.
19. Outbox sin operación, con tenant distinto o con device/sequence parcialmente nulos se rechaza.
20. Outbox no contiene otra copia autoritativa del payload ni resuelve conflictos de dominio.

## Estado de condiciones de salida

| Condición | Clasificación vigente | Evidencia o trabajo restante |
|---|---|---|
| modelo Device, Installation, DeviceKey, License y Activation | satisfecha documentalmente | `device-licensing-schema.md`; su gate físico continúa `IN_REVIEW` |
| snapshot offline sin credenciales centrales | satisfecha documentalmente | `authorization.offline_authorization_snapshots` en el bloque Device/Licensing |
| autoridad de estados de licencia/activación | satisfecha documentalmente | `DEC-008`, casos de uso y modelo conceptual |
| PoC RLS PostgreSQL 16 | satisfecha con evidencia ejecutable | `poc/rls/`, 30 PASS / 0 FAIL |
| FK desde Session, SecurityEvent y AuditEvent hacia Device | diferida de forma cerrada por R4 | migration 001 exige `device_id IS NULL`; el corte criptográfico posterior agrega las FK antes de admitir Device |
| FK 1:1 OutboxEntry/SyncOperation y diseño completo de Sync | satisfecha con evidencia parcial ejecutable | `sync-base-schema.md` y R3; 001 admite únicamente origen central |
| revisión columna por columna y pruebas de ambos dialectos | satisfecha para diseño de 001 | R2-A/R2-B y R3; la implementación futura repite introspección y tests sobre DDL real |
| orden, rollback, convivencia y manifiesto de primera migración | satisfecha documentalmente tras R5 | `docs/migration/first-target-migration-manifest.md`; bootstrap, autoridad y máquina de estados cerrados |
| ownership Onboarding, Session RLS y referencia AuditEvent | satisfechas documentalmente tras R5 | FK OWNER compuesta, policies Session y `resource_reference_kind`; falta prueba del DDL real |

Estas clasificaciones no autorizan DDL ni permiten omitir una condición trasladada.

## Gate del bloque

Foundation queda `APPROVED_FOR_MIGRATION_DESIGN` únicamente para el scope 001 porque R2-A/R2-B/R3/R4/R5 satisfacen:

- la revisión contra `UC-ONB-001`, `UC-AUTH-001`, `SEC-002` y `SEC-004` no encuentra campos o transiciones sin fuente;
- las relaciones tenant-aware de Foundation, Device/Licensing y Sync permanecen alineadas sin FK libre;
- el PoC de RLS demuestra aislamiento y ausencia de fuga de contexto;
- la estrategia completa de migraciones define orden, rollback y convivencia con el esquema heredado.

Persisten como condiciones de implementación: paquete inicial de Authorization aprobado, grants por columna/repositories y pruebas del DDL real —incluidas Session y las constraints R5—. La revisión transversal final #2 quedó satisfecha; la primera migración está `GO_AUTHORIZED` únicamente para su implementación.
