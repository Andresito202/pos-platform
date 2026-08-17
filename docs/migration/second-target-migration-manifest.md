# INT-002 — manifiesto exacto de migration 002 External Integrations

## 1. Propósito, estado y autoridad

Estado de INT-002: `PASS` documental sujeto a revisión final del diff.

Este documento es la autoridad de alcance para la futura migration PostgreSQL `002_external_integrations_foundation`. Es `MANIFEST-ONLY`: no contiene DDL, código Kysely, adapters, clientes HTTP, mocks, credenciales ni evidencia de proveedor. Tampoco autoriza materializar la migration; esa autorización corresponde a una tarea posterior.

La migration es aditiva sobre `001_central_foundation`, que permanece materializada e inmutable. Materializa únicamente el bounded context `External Integrations` en el schema central `integrations`. No crea contraparte SQLite y no crea, altera ni anticipa tablas del bounded context `Fiscal / Electronic Invoicing`.

Fuentes normativas:

- [contrato físico de External Integrations](../architecture/physical-model/external-integrations-schema.md);
- [matriz de providers](../architecture/provider-integration-matrix.md);
- [contratos de integración](../architecture/integration-contracts.md);
- [propiedad de datos](../architecture/data-ownership.md);
- [convenciones físicas](../architecture/physical-model/physical-conventions.md);
- [trazabilidad](../architecture/physical-model/traceability.md);
- [gestión de secretos](../security/secret-key-and-support-management.md);
- [security gates](../security/security-gates.md);
- [manifest de migration 001](first-target-migration-manifest.md);
- `DEC-007` y `ADR-005`.

Reglas de interpretación: `DOCUMENTADO != IMPLEMENTADO`, `MANIFEST != SQL`, `IMPLEMENTADO != VERIFICADO`, `VERIFICADO != CERTIFICADO` y `MOCK != INTEGRACIÓN REAL`.

## 2. Clasificación y límites del corte

| Cambio | Clasificación | Decisión |
|---|---|---|
| schema `integrations` y sus 16 tablas | `NEW` | ningún equivalente existe en migration 001 ni en TARGET |
| FKs hacia Tenant, Company y Branch de 001 | `EXTENSION` | se agregan relaciones desde objetos nuevos; no se altera ninguna tabla 001 |
| uso de roles, helper UUID v7, RLS y ledger existentes | `EXTENSION` | se consumen contratos materializados sin modificarlos |
| `dispatch_class` limitado temporalmente a `NON_FISCAL` | `RECONCILIATION` | materializa progresivamente INT-001 según `GOV-INT-SPLIT` |
| inclusión de `integrations` en la lista general de schemas | `RECONCILIATION` | corrige una omisión documental anterior a INT-001; ownership no cambia |

No existe `REPLACEMENT` ni `DEPRECATED`. El flujo aprobado permanece:

```text
001 CENTRAL FOUNDATION
  -> 002 EXTERNAL INTEGRATIONS FOUNDATION (`NON_FISCAL` únicamente)
  -> 003 FISCAL / ELECTRONIC INVOICING FOUNDATION
  -> runtime provider adapters
  -> real provider verification
```

Quedan expresamente fuera de 002: `FiscalConnection`, `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalArtifact`, `FiscalIncident`, `FiscalReconciliation`, sus items, numeración fiscal, certificados fiscales y estado legal. No se crean placeholders ni FKs a tablas fiscales inexistentes.

## 3. Decisión de persistencia

Los 16 conceptos candidatos son persistentes porque el contrato cerrado les asigna tabla, lifecycle, unicidad, evidencia o referencia durable. Ninguno se reduce a DTO runtime ni a catálogo compilado.

| Order | Table | Razón de persistencia |
|---:|---|---|
| 1 | `provider_registry` | identidad estable y retiro controlado de providers |
| 2 | `provider_adapter_versions` | separación durable entre implementación y verificación |
| 3 | `provider_capability_declarations` | declaración versionada por adapter, sin activar cuentas |
| 4 | `provider_platform_configurations` | configuración global no secreta, versionada por ambiente |
| 5 | `external_integrations` | cuenta/conexión general tenant/company-scoped |
| 6 | `integration_credential_bindings` | metadata de referencias opacas y rotación |
| 7 | `resource_ownership_policies` | autoridad central↔provider por recurso/operación |
| 8 | `integration_capabilities` | capability efectiva por conexión/configuración |
| 9 | `integration_discovery_runs` | ejecución remota idempotente y auditable |
| 10 | `integration_discovery_items` | resultado sanitizado revisable por ejecución |
| 11 | `external_reference_mappings` | identidad externa neutral sin contaminar core |
| 12 | `integration_dispatches` | intención durable central↔provider y reconciliación |
| 13 | `integration_dispatch_attempts` | historial técnico exclusivamente no fiscal |
| 14 | `external_webhook_receipts` | recepción, deduplicación y anti-replay durables |
| 15 | `provider_rate_limit_policies` | contrato/configuración versionada por scope |
| 16 | `provider_verification_evidence` | evidencia inmutable y promoción verificable |

No se materializan tokens de acceso, refresh tokens, payloads provider brutos, estado de circuit breaker, locks de worker ni cachés: son secretos o estado runtime efímero. Los catálogos de códigos siguen como `text` con `CHECK` o publicación administrada; no se crean enums PostgreSQL.

## 4. Convenciones comunes

- PostgreSQL 16, schema `integrations`, owner `pos_schema_owner`; Kysely será solo executor.
- PK `id uuid` generado por aplicación, UUID v7 y `platform.is_uuid_v7(id)`, salvo los nombres globales explícitos `provider_id` y `provider_adapter_version_id` cerrados por INT-001.
- Timestamps `timestamptz` UTC; checksums `text` hexadecimal lowercase de 64 caracteres.
- Texto obligatorio rechaza `btrim(value) = ''`; códigos extensibles usan uppercase estable cuando corresponda.
- FKs usan `NO ACTION`, nunca cascade. Historia se retira, revoca o archiva.
- Toda tabla tenant-scoped expone `UNIQUE (tenant_id,id)` y `UNIQUE (tenant_id,company_id,id)` cuando la requieren dependientes.
- Toda relación tenant/company usa FK compuesta; RLS no sustituye integridad relacional.
- Tablas tenant-scoped: `ENABLE ROW LEVEL SECURITY`, policy tenant y después `FORCE ROW LEVEL SECURITY`.
- `version bigint NOT NULL DEFAULT 1` se usa en agregados mutables; hechos append-only y definiciones inmutables no inventan optimistic concurrency.
- JSONB solo conserva metadata/configuración allowlisted, schema-versioned, sanitizada y sin secretos.
- Los nombres de constraints siguen `<table>_<columns>_{fk|uq|ck|idx}`; los nombres explícitos de este manifest son normativos.

## 5. Matriz física por tabla

Cada ficha cubre las 33 dimensiones obligatorias. `—` significa que el concepto no aplica, no que quede sin decidir.

### 5.1 `integrations.provider_registry`

- **1–6:** table `provider_registry`; schema `integrations`; owner `External Integrations`; catálogo global controlado de providers; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `provider_id`; UUID v7; `tenant_id` —; `company_id` —; `branch_id` —; NOT NULL `provider_code,display_name,integration_class,status,created_at,updated_at,version`.
- **13–18:** nullable `official_reference_uri`; candidate key `provider_code`; UNIQUE `provider_registry_provider_code_uq`; CHECK código `^[A-Z][A-Z0-9_]{1,63}$`, class `ERP_ACCOUNTING|ELECTRONIC_DOCUMENT_PROVIDER|HYBRID|OTHER_REVIEW_REQUIRED`, status `ACTIVE|RETIRED|BLOCKED`, timestamps/version; FKs —; dependencias 001 `platform.is_uuid_v7` y roles.
- **19–24:** dependencia 002 —; delete `NO ACTION` lógico mediante retiro; update solo metadata/status con CAS de `version`; inmutables `provider_id,provider_code,created_at`; optimistic concurrency por `version`; índices PK, unique code y `provider_registry_status_code_idx(status,provider_code)`.
- **25–29:** parciales —; RLS no aplica por ser global; policies —; `pos_app/pos_worker` SELECT, `pos_platform_app` SELECT y publicación administrativa autorizada, admin SELECT, migrator/owner según baseline; sensibles: URI y metadata operativa, no secretos.
- **30–33:** Audit obligatorio para alta/bloqueo/retiro; retención mientras exista cualquier referencia, sin hard delete; publicación y Audit en una transacción; rollback fresh elimina la tabla solo después de dependientes.

### 5.2 `integrations.provider_adapter_versions`

- **1–6:** `provider_adapter_versions`; `integrations`; `External Integrations`; versión concreta de adapter y estados separados; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `provider_adapter_version_id`; UUID v7; scopes tenant/company/branch —; NOT NULL `provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at`.
- **13–18:** nullable `released_at,retired_at`; candidate keys `(provider_id,provider_adapter_version_id)` y `(provider_id,adapter_code,adapter_version)`; UNIQUE para ambas; CHECK textos no vacíos, `contract_version>=1`, implementation `DESIGNED|IMPLEMENTED`, verification `NOT_EVALUATED|MOCK_TESTED|SANDBOX_VERIFIED|PRODUCTION_VERIFIED|CERTIFIED`, coherencia retiro/release; FK `provider_id -> provider_registry`; depende de roles/helper 001.
- **19–24:** depende de ProviderRegistry; delete `NO ACTION`; una versión publicada no se edita, retiro controlado; inmutables todos salvo transición de estados/timestamps bajo caso de uso; optimistic concurrency —, transición serializada por row lock y evidencia; índices unique y `provider_adapter_versions_provider_status_idx(provider_id,implementation_status,verification_status)`.
- **25–29:** parcial `provider_adapter_versions_released_idx(provider_id,released_at DESC) WHERE retired_at IS NULL`; sin RLS; sin policies; SELECT runtimes, mutación solo `pos_platform_app` autorizado y owner; sensible `official` metadata indirecta, sin secretos.
- **30–33:** Audit y vínculo causal a evidencia al promover verificación; retención permanente si fue referenciada; inserción/retiro y promoción con `ProviderVerificationEvidence` en una transacción, sin FK circular latest; rollback fresh inverso.

### 5.3 `integrations.provider_capability_declarations`

- **1–6:** `provider_capability_declarations`; `integrations`; `External Integrations`; capability declarada por versión de adapter, no activación de empresa; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; scopes tenant/company/branch —; NOT NULL `provider_id,provider_adapter_version_id,capability_code,support_status,created_at,version`.
- **13–18:** nullable `official_reference_uri,verified_at`; candidate `(provider_adapter_version_id,capability_code)`; UNIQUE homónimo; CHECK capability uppercase estable, support `SUPPORTED|UNSUPPORTED|UNVERIFIED`, `verified_at` solo con evidencia aplicable, version/timestamps; FK compuesta `(provider_id,provider_adapter_version_id)` al adapter; dependencias 001 helper/roles.
- **19–24:** depende de adapter; delete `NO ACTION`; actualización de status/fuente con CAS, nunca activa IntegrationCapability; inmutables identidad, provider, adapter, capability, created_at; optimistic `version`; índices unique y `provider_capability_declarations_provider_capability_idx(provider_id,capability_code,support_status)`.
- **25–29:** parciales —; sin RLS/policies; runtimes SELECT, publicación `pos_platform_app`, admin SELECT; sensibles URI/evidencia metadata, no payload ni secreto.
- **30–33:** Audit para cambio de soporte/fuente; retención mientras adapter exista; declaración y Audit atómicos; rollback fresh tras dependientes tenant.

### 5.4 `integrations.provider_platform_configurations`

- **1–6:** `provider_platform_configurations`; `integrations`; `External Integrations`; configuración global de plataforma por provider/ambiente, nunca credencial del cliente; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; scopes tenant/company/branch —; NOT NULL `provider_id,environment,configuration_type,configuration_schema_version,configuration_payload,status,valid_from,created_at,updated_at,version`.
- **13–18:** nullable `valid_until`; candidate `(provider_id,environment,configuration_type,configuration_schema_version)`; UNIQUE homónimo; CHECK environment/type uppercase, schema/version positivos, status `DRAFT|PUBLISHED|RETIRED`, vigencia/timestamps y JSON object; FK ProviderRegistry; dependencias 001 helper/roles.
- **19–24:** depende de ProviderRegistry; delete `NO ACTION`; DRAFT mutable con CAS, PUBLISHED inmutable y reemplazado por nueva versión, RETIRED solo cierra vigencia; inmutables id/provider/environment/type/schema version/created_at tras publish; optimistic `version`; índices unique y `provider_platform_configurations_lookup_idx(provider_id,environment,configuration_type,status,valid_from DESC)`.
- **25–29:** parcial `provider_platform_configurations_current_idx(provider_id,environment,configuration_type,valid_from DESC) WHERE status='PUBLISHED' AND valid_until IS NULL`; sin RLS/policies; worker SELECT published, platform app publicación, app solo metadata sin payload, admin SELECT allowlisted; sensible `configuration_payload`, obligatorio allowlist y sin secretos.
- **30–33:** Audit con checksum/snapshot sanitizado; retención de versiones publicadas; publish/retiro + Audit atómico; rollback fresh inverso. Siigo `Partner-Id` podrá publicarse después como `SYSTEM_REFERENCE_DATA/CONFIGURATION`, nunca se siembra en 002.

### 5.5 `integrations.external_integrations`

- **1–6:** `external_integrations`; `integrations`; `External Integrations`; cuenta/conexión general tenant/company-scoped; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; `tenant_id NOT NULL`; `company_id NOT NULL`; `branch_id NULL`; NOT NULL `provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at,version`.
- **13–18:** nullable `branch_id,credential_binding_id,provider_account_reference,last_health_check_at,last_success_at,last_failure_at,activated_at,disabled_at`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,id,provider_adapter_version_id)`; UNIQUE para las tres más uniques activas por scope/account; CHECK environment/código, status `CREATED|CREDENTIALS_CONFIGURED|AUTHENTICATED|DISCOVERING|DISCOVERY_COMPLETE|MAPPING_REQUIRED|READY_FOR_REVIEW|ACTIVE|DEGRADED|DISABLED|CREDENTIAL_ROTATION_REQUIRED|ERROR`, timestamps, branch scope y version; FKs tenant-aware a Company/Branch, compuesta Provider+Adapter y binding activo agregada tras crear bindings; guards `external_integrations_provider_snapshot_guard` y `external_integrations_active_credential_guard` verifican respectivamente código congelado y binding `ACTIVE` de la misma integración; dependencias 001 Company/Branch/helper/roles/Audit.
- **19–24:** depende de registry/adapter y luego binding; delete `NO ACTION`; transiciones lifecycle/health/config con CAS, disable en vez de delete; inmutables id/scope/provider/environment/account identity validada/created_at salvo caso de reconfiguración que crea otra integración; optimistic `version`; índices lookup tenant/company/status/provider, provider/environment/status, health vencido y FK branch/adapter.
- **25–29:** dos uniques parciales para account activa: company-wide cuando `branch_id IS NULL` y branch-specific cuando no nulo, ambos solo con `provider_account_reference IS NOT NULL AND status <> 'DISABLED'`; RLS ENABLE/FORCE; policy `external_integrations_tenant_isolation`; app y worker SELECT, app INSERT/UPDATE por permisos, platform app bajo contexto, worker solo columnas health/status técnico allowlisted, admin SELECT sin credential reference; sensibles account reference, health y binding pointer.
- **30–33:** Audit configure/test/review/activate/disable/rotate/revalidate sin valores; retención por toda la historia dependiente; creación metadata + Audit atómica, HTTP fuera, binding se activa en transacción posterior; rollback fresh solo después de todos los dependientes.

### 5.6 `integrations.integration_credential_bindings`

- **1–6:** `integration_credential_bindings`; `integrations`; `External Integrations`; metadata de una referencia opaca generacional; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,credential_reference,credential_kind,generation,status,created_at,version`.
- **13–18:** nullable `activated_at,rotation_due_at,superseded_at,revoked_at`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,integration_id,id)`, `(tenant_id,integration_id,generation)`; UNIQUE las cuatro; CHECK generation/version positivos, reference/kind no vacíos, status `PENDING|ACTIVE|SUPERSEDED|REVOKED` y timestamps coherentes; FK tenant/company/integration; dependencias 001 Company indirecta/helper/Audit.
- **19–24:** depende de ExternalIntegration; delete `NO ACTION`; solo transiciones de lifecycle con CAS, rotación inserta fila nueva; inmutables id/scope/integration/reference/kind/generation/created_at; optimistic `version`; índices por integration/status y rotation_due.
- **25–29:** unique parcial `integration_credential_bindings_active_uq(tenant_id,integration_id) WHERE status='ACTIVE'`; RLS ENABLE/FORCE; policy tenant; app ve metadata redacted y solicita operaciones por puerto, worker puede SELECT `credential_reference` para resolver el secreto, platform app gestiona bajo contexto, admin no recibe esa columna; sensible `credential_reference` aunque no sea el secreto.
- **30–33:** Audit registra referencia identificadora sanitizada, actor, motivo y resultado; retención de generaciones retiradas según política de seguridad y dependencias; insertar/probar fuera de ACID/activar binding/reapuntar integración/retirar anterior se separa, siendo la activación final una transacción; rollback fresh después de eliminar FK activa desde ExternalIntegration.

### 5.7 `integrations.resource_ownership_policies`

- **1–6:** `resource_ownership_policies`; `integrations`; `External Integrations`; autoridad central↔provider por recurso/operación; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,resource_type,operation_scope,authority_type,policy_version,status,effective_from,created_at`.
- **13–18:** nullable `conflict_policy_code,effective_until`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,integration_id,id)`, `(tenant_id,integration_id,resource_type,operation_scope,policy_version)`; UNIQUE todas; CHECK authority exacta, bidirectional exige conflict code y las demás lo prohíben, policy_version positivo, status `DRAFT|PUBLISHED|RETIRED`, vigencia; FK Integration; dependencias 001 helper/Audit.
- **19–24:** depende de ExternalIntegration; delete `NO ACTION`; published inmutable, cambio semántico crea versión; inmutables scope/integration/resource/operation/policy version/created_at; optimistic concurrency por identidad+policy_version y row lock de publicación, sin columna paralela; índices lookup por integration/resource/status.
- **25–29:** unique parcial de policy vigente por `(tenant_id,integration_id,resource_type,operation_scope) WHERE status='PUBLISHED' AND effective_until IS NULL`; RLS ENABLE/FORCE; policy tenant; app configura/revisa, worker SELECT, platform app bajo contexto, admin SELECT; sensible conflict policy y vigencias, sin secretos.
- **30–33:** Audit publicación/retiro; retención histórica; publicación + cierre prospectivo anterior + Audit atómicos; rollback fresh antes de ExternalIntegration.

### 5.8 `integrations.integration_capabilities`

- **1–6:** `integration_capabilities`; `integrations`; `External Integrations`; capability efectiva por conexión/configuración; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,capability_code,support_status,configuration_version,effective_from,created_at,version`.
- **13–18:** nullable `ownership_policy_id,effective_until,source_reference_uri,verified_at`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,integration_id,capability_code,configuration_version)`; UNIQUE; CHECK código uppercase, support `SUPPORTED|UNSUPPORTED|UNVERIFIED|DISABLED`, configuration/version positivos y vigencia; FK Integration y FK compuesta ownership dentro de misma integración; dependencias 001 helper/Audit.
- **19–24:** depende de ExternalIntegration y ResourceOwnershipPolicy; delete `NO ACTION`; retiro cierra vigencia, no reescribe historia; inmutables id/scope/integration/capability/configuration version/created_at; optimistic `version`; índices capability lookup y ownership FK.
- **25–29:** parcial de capability efectiva por `(tenant_id,integration_id,capability_code,effective_from DESC) WHERE support_status='SUPPORTED' AND effective_until IS NULL`; RLS ENABLE/FORCE; policy tenant; app configura, worker SELECT, platform app contextual, admin SELECT; sensible fuente/verification metadata, no secretos.
- **30–33:** Audit assignment/review/disable; retención histórica; assignment + ownership + Audit atómicos, activar integración valida conjunto en misma transacción; rollback fresh antes de ownership/integration.

### 5.9 `integrations.integration_discovery_runs`

- **1–6:** `integration_discovery_runs`; `integrations`; `External Integrations`; ejecución idempotente de discovery; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,provider_adapter_version_id,discovery_type,status,idempotency_key,request_checksum,correlation_id,created_at,updated_at,version`.
- **13–18:** nullable `started_at,completed_at,item_count,reviewed_item_count,error_code,evidence_reference`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,integration_id,id)`, `(tenant_id,integration_id,idempotency_key)`; UNIQUE; CHECK status `CREATED|RUNNING|COMPLETED|PARTIAL|FAILED|CANCELLED`, checksum, counts no negativos, timestamps/version; FK compuesta a Integration+AdapterVersion; dependencias 001 helper/Audit.
- **19–24:** depende de ExternalIntegration/Adapter; delete `NO ACTION`; transición monotónica con CAS; inmutables scope/integration/adapter/type/idempotency/checksum/correlation/created_at; optimistic `version`; índices worker por status/created y review por integration/completed.
- **25–29:** parcial `integration_discovery_runs_work_idx(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING')`; RLS ENABLE/FORCE; policy tenant; app inicia/revisa, worker ejecuta y actualiza lifecycle, platform app contextual, admin SELECT sin evidence reference; sensibles evidence/error metadata sanitizada.
- **30–33:** Audit start/result/review; retención según evidencia y mappings derivados; crear run atómico, HTTP fuera, persistir items+resultado final en transacción por lote idempotente; rollback fresh después de items.

### 5.10 `integrations.integration_discovery_items`

- **1–6:** `integration_discovery_items`; `integrations`; `External Integrations`; resultado sanitizado y revisable por run; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,discovery_run_id,resource_type,external_id,provider_checksum,review_status,metadata_schema_version,provider_metadata,created_at,updated_at,version`.
- **13–18:** nullable `external_code,display_reference,proposed_internal_entity_type,proposed_internal_entity_id`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,discovery_run_id,resource_type,external_id)`; UNIQUE; CHECK checksum, JSON object/schema version, proposed internal pair y review `PENDING|PROPOSED|ACCEPTED|REJECTED|CONFLICT`; FK compuesta tenant/company/integration/run; dependencias 001 helper/Audit.
- **19–24:** depende de DiscoveryRun; delete `NO ACTION`; review con CAS, resultado provider no se reescribe; inmutables run/resource/external identity/checksum/provider metadata/created_at; optimistic `version`; índices review queue y lookup externo.
- **25–29:** parciales pendientes/conflict por integration/status; RLS ENABLE/FORCE; policy tenant; app review, worker insert y lectura, platform app contextual, admin SELECT sin metadata/evidence sensible; sensibles display/metadata y propuestas, siempre sanitizadas.
- **30–33:** Audit de review/mapping; retención al menos mientras mapping/evidencia dependa; lote de items y counters del run en transacción, HTTP fuera; rollback fresh antes del run.

### 5.11 `integrations.external_reference_mappings`

- **1–6:** `external_reference_mappings`; `integrations`; `External Integrations`; mapping neutral internal↔external; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,resource_type,internal_entity_type,internal_entity_id,external_id,mapping_status,provider_metadata_schema_version,provider_metadata,created_at,updated_at,version`.
- **13–18:** nullable `external_code,verified_at,verified_by_actor_id,supersedes_mapping_id`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)` y self-scope; UNIQUE vigentes mediante índices parciales interno/externo; CHECK status `PROPOSED|VERIFIED|ACTIVE|CONFLICT|STALE|RETIRED`, verification actor/time, JSON/schema/version; FK Integration, self tenant-aware y reviewer global a `identity.users`; referencias internas polimórficas se validan por puerto propietario; dependencias 001 User/helper/Audit.
- **19–24:** depende de Integration y opcionalmente Discovery por causalidad, no FK obligatoria; delete `NO ACTION`; retiro/reemplazo explícitos con CAS, conflicto nunca overwrite; inmutables scope/integration/resource/internal identity/external identity/created_at; optimistic `version`; índices lookup interno, externo y status.
- **25–29:** uniques parciales `external_reference_mappings_internal_current_uq` y `..._external_current_uq` para filas no `RETIRED`; índice parcial pending/stale; RLS ENABLE/FORCE; policy tenant; app map/review, worker SELECT, platform app contextual, admin SELECT sin metadata completa; sensibles identidades externas y metadata.
- **30–33:** Audit map/verify/conflict/retire/replace; mappings retirados e historia no se eliminan; retirar anterior+insertar reemplazo+self-link+Audit atómicos; rollback fresh antes de Integration.

### 5.12 `integrations.integration_dispatches`

- **1–6:** `integration_dispatches`; `integrations`; `External Integrations`; intención/routing/reconciliación central↔provider exclusivamente no fiscal en 002; `NEW` con `RECONCILIATION` del discriminador temporal; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,created_at,updated_at,version`.
- **13–18:** nullable `provider_request_reference,retry_classification,next_attempt_at,last_reconciled_at,causation_id`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,id,dispatch_class)`, `(tenant_id,company_id,id,dispatch_class)`, `(tenant_id,integration_id,idempotency_key)`; UNIQUE todas; CHECK UUIDs/checksum/schema/version, status `QUEUED|DISPATCHING|SUCCEEDED|RETRY_SCHEDULED|UNKNOWN_OUTCOME|RECONCILIATION_REQUIRED|PERMANENT_FAILURE|DEAD_LETTER|CANCELLED`, idempotency no vacía y constraint temporal 002 descrito en §8; FK Integration; internal refs tipadas se validan por puerto propietario; dependencias 001 helper/Audit y causalidad opcional con Sync sin FK polimórfica.
- **19–24:** depende de Integration/capability validada en servidor; delete `NO ACTION`; solo lifecycle técnico/reconciliación con CAS; inmutables identidad/scope/routing/internal refs/idempotency/payload schema+checksum/correlation/causation/created_at; optimistic `version`; índices worker status/next attempt, reconciliation, internal reference y correlation.
- **25–29:** parciales work/reconciliation por estados; RLS ENABLE/FORCE; policy tenant; app enqueue/read, worker SELECT y UPDATE técnico allowlisted, platform app contextual, admin SELECT sin request reference sensible; sensibles referencias/provider diagnostics, nunca payload/secreto.
- **30–33:** Audit enqueue/cancel/dead-letter/review; retención por attempts/reconciliación y políticas; enqueue de intención + evento/Audit en transacción central, HTTP siempre posterior y fuera de ACID; rollback fresh después de attempts.

### 5.13 `integrations.integration_dispatch_attempts`

- **1–6:** `integration_dispatch_attempts`; `integrations`; `External Integrations`; historial técnico autoritativo de dispatch no fiscal; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL; branch —; NOT NULL `integration_dispatch_id,dispatch_class,attempt_number,status,request_id,started_at,created_at,version`.
- **13–18:** nullable `transport_status,http_status,provider_operation_reference,provider_response_reference,retry_after_at,finished_at,diagnostic_reference`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,integration_dispatch_id,attempt_number)`; UNIQUE; CHECK `dispatch_class='NON_FISCAL'`, attempt/version positivos, status `CREATED|IN_PROGRESS|SUCCEEDED|FAILED|UNKNOWN_OUTCOME|CANCELLED`, HTTP 100..599 y timestamps; FK discriminada `(tenant_id,company_id,integration_dispatch_id,dispatch_class)`; dependencias 001 helper/Audit.
- **19–24:** depende de Dispatch; delete `NO ACTION`; lifecycle monotónico con CAS, outcome histórico no se reescribe; inmutables scope/dispatch/class/attempt number/request id/started/created; optimistic `version`; índices attempt history, provider operation y unknown outcome.
- **25–29:** parciales `..._unknown_outcome_idx` y retry-after pendiente; RLS ENABLE/FORCE; policy tenant; app read, worker INSERT/UPDATE técnico, platform app contextual, admin SELECT sin diagnostic reference; sensibles referencias externas/diagnóstico sanitizado.
- **30–33:** Audit solo eventos críticos/review, no copia respuestas; retención con dispatch; reserva de attempt number bajo lock del dispatch y creación atómica, HTTP fuera, resultado en transacción posterior idempotente; rollback fresh antes de Dispatch.

### 5.14 `integrations.external_webhook_receipts`

- **1–6:** `external_webhook_receipts`; `integrations`; `External Integrations`; recepción durable, dedup y anti-replay antes de procesar; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company NOT NULL derivados; branch —; NOT NULL `integration_id,deduplication_key,received_at,payload_schema_version,payload_checksum,authentication_verification_result,replay_verification_result,processing_status,attempt_count,correlation_id,created_at,version`.
- **13–18:** nullable `provider_event_id,payload_evidence_reference,next_attempt_at,last_error_code,processed_at`; candidates `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,integration_id,deduplication_key)`; UNIQUE; CHECK checksum/schema/version, attempt nonnegative, auth `VERIFIED|FAILED|UNSUPPORTED_BY_PROVIDER|UNVERIFIED_CONTRACT`, replay igual catálogo, processing `RECEIVED|REJECTED|PENDING|PROCESSING|PROCESSED|RETRY_SCHEDULED|DEAD_LETTER` y timestamps; FK Integration; dependencias 001 helper/Audit.
- **19–24:** depende de Integration; delete `NO ACTION`; receipt identity/payload evidence append-only y solo lifecycle técnico con CAS; inmutables scope/integration/provider event/dedup/received/payload identity/auth+replay result/correlation/created; optimistic `version` para processing; índices processing queue, provider event lookup, received retention.
- **25–29:** parciales retry/dead-letter; RLS ENABLE/FORCE; policy tenant; endpoint inserta mediante `pos_platform_app`/puerto aislado con tenant derivado, worker procesa, app consulta autorizada, admin SELECT sin evidence reference; sensibles evidence ref/event IDs/checksum, nunca payload bruto.
- **30–33:** Audit de rechazo, replay, dead letter y resolución; archivo/retención según contrato y evidencia, no borrado cascada; insert+dedup es una transacción antes de ACK, processing posterior; rollback fresh antes de Integration.

### 5.15 `integrations.provider_rate_limit_policies`

- **1–6:** `provider_rate_limit_policies`; `integrations`; `External Integrations`; límites externos versionados y precedencia por scope; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; `tenant_id/company_id` nullable según scope; branch —; NOT NULL `provider_id,endpoint_class,retry_after_mode,backoff_policy_code,status,valid_from,version`.
- **13–18:** nullable `tenant_id,company_id,integration_id,request_limit,window_seconds,concurrency_limit,cooldown_seconds,source_reference_uri,valid_until,last_rate_limit_event_at`; candidates `(provider_id,endpoint_class,version)`, `(provider_id,tenant_id,endpoint_class,version)`, `(provider_id,tenant_id,company_id,endpoint_class,version)` o `(provider_id,tenant_id,company_id,integration_id,endpoint_class,version)` según scope; UNIQUE mediante cuatro índices parciales; CHECK shape provider/tenant/company/integration, límites positivos, retry mode `PROVIDER_HEADER_DRIVEN|FIXED_WINDOW|UNVERIFIED`, status `DRAFT|PUBLISHED|RETIRED`, vigencia/version; FK Provider, Company tenant-aware e Integration cuando aplique; dependencias 001 Company/helper/roles.
- **19–24:** depende de Provider e Integration opcional; delete `NO ACTION`; límites publicados se reemplazan por versión nueva, solo observación `last_rate_limit_event_at` puede avanzar técnicamente; inmutables scope/endpoint/valores contractuales/version/valid_from tras publish; optimistic concurrency por business `version` y row lock; índices lookup de precedencia y evento reciente.
- **25–29:** cuatro uniques parciales para provider default, tenant, company e integration; RLS ENABLE/FORCE por ser tabla mixta; policies `provider_rate_limit_policies_tenant_select`, `..._tenant_write` y `..._platform_global` separan filas globales; worker SELECT global+tenant y UPDATE solo last event, app SELECT/config tenant, platform app publica global/contextual, admin read-only; sensible fuente/estado contractual, sin secretos.
- **30–33:** Audit publish/replace/rate-limit incident; retención de versiones; publicación/retiro+Audit atómico, headers efectivos se aplican runtime fuera de esa transacción; rollback fresh antes de Provider/Integration.

### 5.16 `integrations.provider_verification_evidence`

- **1–6:** `provider_verification_evidence`; `integrations`; `External Integrations`; metadata inmutable y referencia protegida de evidencia; `NEW`; `CENTRAL_ONLY`.
- **7–12:** PK `id`; UUID v7; tenant/company nullable solo junto con integration; branch —; NOT NULL `provider_id,provider_adapter_version_id,environment,evidence_level,test_suite_version,source_commit,executed_at,result,evidence_reference,evidence_checksum,created_at`.
- **13–18:** nullable `tenant_id,company_id,integration_id,authorized_account_reference,reviewed_by_actor_id,reviewed_at,expires_at`; candidates `(provider_id,id)` y `(tenant_id,id)` solo para filas tenant mediante unique parcial; UNIQUE global `(provider_adapter_version_id,environment,test_suite_version,source_commit,executed_at)` donde integration es nula y UNIQUE tenant `(tenant_id,integration_id,provider_adapter_version_id,environment,test_suite_version,source_commit,executed_at)` donde existe integration; CHECK scope global/integration, level `DOCUMENTED|IMPLEMENTED|MOCK_TESTED|SANDBOX_VERIFIED|PRODUCTION_VERIFIED|CERTIFIED`, result `PASS|FAIL|BLOCKED`, checksum/review/expiry; FKs Provider+Adapter, reviewer global a `identity.users` y, si existe, Integration+Adapter compuesta; dependencias 001 User/helper/roles/Audit.
- **19–24:** depende de Provider/Adapter/Integration opcional; delete `NO ACTION`; append-only, review/promoción se expresa con nueva evidencia o campos de review completados una vez; inmutables identidad, scope, ejecución, resultado, reference/checksum/created; optimistic concurrency —; índices por adapter/level/result/executed, integration/environment y expiry.
- **25–29:** parciales pendientes de review y expiración; RLS ENABLE/FORCE por tabla mixta; policies tenant y global platform separadas; app solo estado resumido, worker no DML, platform app INSERT/review, admin SELECT excluyendo account/evidence reference; sensibles account/evidence reference/checksum.
- **30–33:** Audit de registro/review/promoción; retención inmutable conforme a certificación/seguridad; insertar/revisar evidencia y promover AdapterVersion en una transacción, pero la ejecución real ocurrió fuera; rollback fresh antes de Adapter/Provider.

## 6. Plan exacto de FKs

Todas las FKs son `NOT DEFERRABLE`, `NO ACTION` y reciben índice hijo salvo cobertura por UNIQUE/índice ya declarado.

| Child | FK columns | Parent candidate key |
|---|---|---|
| adapter versions | `provider_id` | `provider_registry(provider_id)` |
| capability declarations | `(provider_id,provider_adapter_version_id)` | adapter `(provider_id,provider_adapter_version_id)` |
| platform configurations | `provider_id` | provider `id` |
| external integrations | `(tenant_id,company_id)` | Company `(tenant_id,id)` |
| external integrations | `(tenant_id,company_id,branch_id)` | Branch `(tenant_id,company_id,id)` |
| external integrations | `(provider_id,provider_adapter_version_id)` | adapter `(provider_id,provider_adapter_version_id)` |
| credential bindings | `(tenant_id,company_id,integration_id)` | integration `(tenant_id,company_id,id)` |
| external integrations, FK agregada después | `(tenant_id,company_id,id,credential_binding_id)` | binding `(tenant_id,company_id,integration_id,id)` |
| ownership/capability/run/mapping/dispatch/webhook | `(tenant_id,company_id,integration_id)` | integration `(tenant_id,company_id,id)` |
| capability | `(tenant_id,company_id,integration_id,ownership_policy_id)` | ownership `(tenant_id,company_id,integration_id,id)` |
| discovery run/evidence | `(tenant_id,company_id,integration_id,provider_adapter_version_id)` | integration key equivalente |
| discovery item | `(tenant_id,company_id,integration_id,discovery_run_id)` | run key equivalente |
| mapping supersession | `(tenant_id,company_id,supersedes_mapping_id)` | mapping `(tenant_id,company_id,id)` |
| mapping reviewer | `verified_by_actor_id` | `identity.users(id)` |
| dispatch attempt | `(tenant_id,company_id,integration_dispatch_id,dispatch_class)` | dispatch discriminada equivalente |
| rate policy | Company/Integration según shape | candidate keys 001/002 correspondientes |
| evidence | `(provider_id,provider_adapter_version_id)` y, si tenant, Integration+Adapter | adapter/integration correspondientes |
| evidence reviewer | `reviewed_by_actor_id` | `identity.users(id)` |

Las referencias polimórficas `internal_entity_type/internal_entity_id`, `internal_operation_id` y actores no reciben FK genérica que acople todos los dominios. El puerto propietario valida existencia, tenant/company y tipo antes de persistir; RLS no convierte esa validación en opcional.

## 7. UNIQUE, mapping y reemplazo

Los UNIQUE estructurales están en las fichas. Reglas adicionales:

1. `ExternalReferenceMapping` usa dos uniques parciales para filas no `RETIRED`: una identidad interna no puede apuntar a dos externas y una externa no puede apuntar a dos internas dentro de la misma integración/resource.
2. Un conflicto no inserta una segunda asociación incompatible: marca/revisa la fila vigente como `CONFLICT` bajo optimistic lock.
3. Reemplazar exige retirar la fila anterior y crear otra con `supersedes_mapping_id`; las dos acciones y Audit son atómicas.
4. `external_code` no es unique salvo futura migration específica respaldada por contrato oficial del provider/resource.
5. Provider/account scope siempre incluye `integration_id`; no existen `siigo_id`, `factus_id`, `alegra_id` ni equivalentes en core.

## 8. CHECK temporal que deshabilita FISCAL

Migration 002 debe crear un constraint nombrado y auditable:

```text
integration_dispatches_dispatch_class_002_ck
```

Semántica exacta:

```text
dispatch_class = 'NON_FISCAL'
AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS')
AND internal_entity_type <> 'ElectronicDocument'
```

Esto impide físicamente todo dispatch fiscal y evita reclasificar una operación fiscal como no fiscal. La FK discriminada permanente de `IntegrationDispatchAttempt` agrega su propio `CHECK (dispatch_class='NON_FISCAL')` y apunta a la candidate key del dispatch que incluye el discriminador.

Migration 003 será la única autorizada para reemplazar `integration_dispatches_dispatch_class_002_ck` por el constraint final `FISCAL|NON_FISCAL`, y deberá hacerlo en la misma transacción que cree `FiscalSubmissionAttempt` y su FK discriminada `FISCAL`. Si cualquiera falla, 003 completa rollback y FISCAL continúa deshabilitado.

## 9. RLS, policies y roles

Doce tablas tenant o mixed-scoped reciben ENABLE/FORCE: `external_integrations`, `integration_credential_bindings`, `resource_ownership_policies`, `integration_capabilities`, `integration_discovery_runs`, `integration_discovery_items`, `external_reference_mappings`, `integration_dispatches`, `integration_dispatch_attempts`, `external_webhook_receipts`, `provider_rate_limit_policies` y `provider_verification_evidence`. Las cuatro tablas globales no entran. La implementación debe fallar si el conteo no coincide: son **12 tablas protegidas**.

Las diez tablas puramente tenant-scoped usan `<table>_tenant_isolation` para `pos_app,pos_worker,pos_platform_app`, con `USING/WITH CHECK (tenant_id = platform.current_tenant_id())`. `provider_rate_limit_policies` y `provider_verification_evidence` son mixed-scoped: runtime tenant ve su tenant y, por SELECT separado, defaults/evidencia global allowlisted; solo `pos_platform_app` puede escribir filas globales. Tenant nulo nunca autoriza DML del runtime común.

| Role | Acceso conceptual 002 |
|---|---|
| `pos_schema_owner` | owner; DDL y grants durante migration, no runtime |
| `pos_migrator` | `SET ROLE pos_schema_owner` solo en pipeline autorizado; sin negocio |
| `pos_app` | lectura tenant; configure/discover/map/review/activate mediante grants por tabla/columna y autorización backend; sin secret reference ni UPDATE técnico de worker |
| `pos_worker` | lectura de configuración publicada, resolución controlada de credential reference, insert/update técnico de runs/dispatch/attempts/webhooks/rate event; un tenant por transacción |
| `pos_platform_app` | publicación global y rutas webhook/plataforma separadas; usa tenant context para filas tenant |
| `pos_platform_admin` | BYPASSRLS read-only por columnas, sin DML/DDL y sin referencias sensibles |
| `pos_reporting` | sin grants en 002 |

PUBLIC no recibe CREATE/USAGE/DML; no se usa `GRANT ALL`. UPDATE se concede por columnas y triggers protegen identidad, scope, idempotencia, checksums y evidence append-only.

## 10. Índices y query paths

Solo se crean los índices enumerados en las fichas o necesarios para soportar FKs no cubiertas. Cada uno responde a: tenant/RLS, FK, lifecycle de integración, rotación, discovery/review, mapping lookup, dispatch worker, unknown outcome/reconciliation, webhook dedup/retry, precedencia de rate limit o evidence review/expiry. No hay GIN/JSON, particionado ni índices especulativos. PK/UNIQUE ya cubiertos no se duplican.

Índices de acceso no cubiertos por PK/UNIQUE:

| Index | Columns / predicate | Query path |
|---|---|---|
| `provider_registry_status_code_idx` | `(status,provider_code)` | catálogo activo |
| `provider_adapter_versions_provider_status_idx` | `(provider_id,implementation_status,verification_status)` | adapter elegible |
| `provider_adapter_versions_released_idx` | `(provider_id,released_at DESC) WHERE retired_at IS NULL` | versión vigente |
| `provider_capability_declarations_provider_capability_idx` | `(provider_id,capability_code,support_status)` | soporte declarado |
| `provider_platform_configurations_lookup_idx` | `(provider_id,environment,configuration_type,status,valid_from DESC)` | resolver configuración |
| `provider_platform_configurations_current_idx` | `(provider_id,environment,configuration_type,valid_from DESC) WHERE status='PUBLISHED' AND valid_until IS NULL` | publicación vigente |
| `external_integrations_tenant_status_provider_idx` | `(tenant_id,company_id,status,provider_id,id)` | UI/RLS y lifecycle |
| `external_integrations_provider_environment_status_idx` | `(provider_id,environment,status,id)` | operación por adapter |
| `external_integrations_branch_fk_idx` | `(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL` | soporte FK Branch |
| `external_integrations_health_idx` | `(tenant_id,company_id,last_health_check_at,id) WHERE status IN ('ACTIVE','DEGRADED')` | health vencido |
| `integration_credential_bindings_integration_status_idx` | `(tenant_id,integration_id,status,generation DESC)` | binding activo/historia |
| `integration_credential_bindings_rotation_idx` | `(rotation_due_at,tenant_id,integration_id) WHERE status='ACTIVE' AND rotation_due_at IS NOT NULL` | rotación requerida |
| `resource_ownership_policies_lookup_idx` | `(tenant_id,integration_id,resource_type,operation_scope,status,effective_from DESC)` | resolver autoridad |
| `integration_capabilities_lookup_idx` | `(tenant_id,integration_id,capability_code,support_status,effective_from DESC)` | capability efectiva |
| `integration_capabilities_ownership_fk_idx` | `(tenant_id,company_id,integration_id,ownership_policy_id) WHERE ownership_policy_id IS NOT NULL` | soporte FK ownership |
| `integration_discovery_runs_work_idx` | `(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING')` | worker discovery |
| `integration_discovery_runs_review_idx` | `(tenant_id,integration_id,completed_at DESC,id) WHERE status IN ('COMPLETED','PARTIAL')` | review |
| `integration_discovery_items_review_idx` | `(tenant_id,integration_id,review_status,created_at,id)` | cola de review |
| `integration_discovery_items_external_idx` | `(tenant_id,integration_id,resource_type,external_id)` | lookup externo |
| `external_reference_mappings_internal_idx` | `(tenant_id,integration_id,internal_entity_type,internal_entity_id,resource_type)` | internal→external |
| `external_reference_mappings_external_idx` | `(tenant_id,integration_id,resource_type,external_id)` | external→internal |
| `external_reference_mappings_status_idx` | `(tenant_id,integration_id,mapping_status,updated_at,id)` | pending/stale/conflict |
| `integration_dispatches_work_idx` | `(tenant_id,status,next_attempt_at,created_at,id) WHERE status IN ('QUEUED','RETRY_SCHEDULED')` | claim del worker |
| `integration_dispatches_reconciliation_idx` | `(tenant_id,status,last_reconciled_at,id) WHERE status IN ('UNKNOWN_OUTCOME','RECONCILIATION_REQUIRED')` | reconciliación |
| `integration_dispatches_internal_idx` | `(tenant_id,internal_entity_type,internal_entity_id,created_at DESC)` | causalidad por entidad |
| `integration_dispatches_correlation_idx` | `(tenant_id,correlation_id,created_at,id)` | trazabilidad |
| `integration_dispatch_attempts_history_idx` | `(tenant_id,integration_dispatch_id,attempt_number)` | historial del dispatch |
| `integration_dispatch_attempts_provider_operation_idx` | `(tenant_id,provider_operation_reference) WHERE provider_operation_reference IS NOT NULL` | reconciliación provider |
| `integration_dispatch_attempts_unknown_idx` | `(tenant_id,started_at,id) WHERE status='UNKNOWN_OUTCOME'` | outcome incierto |
| `external_webhook_receipts_work_idx` | `(tenant_id,processing_status,next_attempt_at,received_at,id) WHERE processing_status IN ('RECEIVED','PENDING','RETRY_SCHEDULED')` | worker webhook |
| `external_webhook_receipts_provider_event_idx` | `(tenant_id,integration_id,provider_event_id) WHERE provider_event_id IS NOT NULL` | dedup/diagnóstico |
| `external_webhook_receipts_received_idx` | `(tenant_id,received_at,id)` | retención/archivo |
| `provider_rate_limit_policies_lookup_idx` | `(provider_id,tenant_id,company_id,integration_id,endpoint_class,status,valid_from DESC)` | precedencia explícita |
| `provider_rate_limit_policies_event_idx` | `(last_rate_limit_event_at DESC,provider_id) WHERE last_rate_limit_event_at IS NOT NULL` | incidentes 429 |
| `provider_verification_evidence_adapter_idx` | `(provider_adapter_version_id,evidence_level,result,executed_at DESC)` | promoción/verificación |
| `provider_verification_evidence_integration_idx` | `(tenant_id,integration_id,environment,executed_at DESC) WHERE integration_id IS NOT NULL` | evidencia por cuenta |
| `provider_verification_evidence_expiry_idx` | `(expires_at,provider_adapter_version_id) WHERE expires_at IS NOT NULL` | revalidación |

Los índices UNIQUE parciales ya declarados para conexión activa, binding activo, policy/capability vigente, mapping vigente, scopes de rate limit e identidad de evidence son constraints de integridad y no se duplican aquí.

## 11. Fronteras transaccionales

| Operación | Frontera ACID PostgreSQL |
|---|---|
| crear integración | metadata inicial + Audit; sin auth HTTP |
| rotar credencial | binding nuevo PENDING; prueba HTTP fuera; activación/repoint/retiro anterior + Audit atómicos |
| asignar capability/ownership | policy publicada + assignment + Audit, o rollback total |
| activar mapping | retirar/reemplazar cuando aplique + mapping activo + Audit |
| enqueue dispatch | intención immutable/idempotency/checksum + Audit/evento causal; HTTP posterior |
| transición dispatch/attempt | row lock/CAS, outcome y próximo trabajo; nunca distributed transaction |
| webhook receipt | insert/dedup antes de ACK; procesamiento en transacción posterior |
| verification evidence | insert/review + promoción de adapter version; ejecución provider ocurrió fuera |

Provider HTTP nunca participa en una transacción ACID PostgreSQL. Timeout ambiguo produce `UNKNOWN_OUTCOME`/reconciliación con la misma identidad, no un segundo efecto.

## 12. Orden topológico exacto de creación

1. Preflight: ledger 001 `APPLIED`, checksum/catalog exactos, PostgreSQL 16, roles/helpers y ausencia de `integrations` divergente.
2. Crear schema `integrations` bajo `pos_schema_owner`; revocar PUBLIC.
3. `provider_registry`.
4. `provider_adapter_versions` y su candidate key `(provider_id,provider_adapter_version_id)`.
5. `provider_capability_declarations`.
6. `provider_platform_configurations`.
7. `external_integrations` sin la FK de `credential_binding_id`, que nace nullable.
8. `integration_credential_bindings`.
9. Agregar FK compuesta del binding activo desde `external_integrations`.
10. Crear los guards de provider snapshot/binding activo después de que ambas tablas existan.
11. `resource_ownership_policies`.
12. `integration_capabilities`.
13. `integration_discovery_runs`.
14. `integration_discovery_items`.
15. `external_reference_mappings`; agregar self-FK después de crear su candidate key.
16. `integration_dispatches` con constraint temporal 002.
17. `integration_dispatch_attempts` y FK discriminada `NON_FISCAL`.
18. `external_webhook_receipts`.
19. `provider_rate_limit_policies`.
20. `provider_verification_evidence`.
21. Crear índices no inline, guards restantes de inmutabilidad/append-only, RLS, policies, FORCE RLS y grants.
22. Introspección exacta dentro de la transacción; commit body; smoke mediante conexiones reales; ledger pasa a `APPLIED` solo según la máquina normativa de 001.

## 13. SQLite scope

**MIGRATION 002 SQLITE SCOPE = NONE.**

No se crea migration SQLite, tabla, columna, índice, trigger, seed ni ledger entry 002 local. Las 16 tablas son autoridad central y contienen account identity, secret references, discovery remoto, health, mappings, dispatch, webhook/rate-limit/evidence que el POS no necesita para completar checkout local. No se crea simetría artificial PostgreSQL↔SQLite.

Provider credentials/tokens permanecen central-only. El flujo local continúa `SyncOperation -> Outbox -> central`; la indisponibilidad HTTP de un provider no invalida el commit local.

## 14. Seeds y reference data

Migration 002 inserta **cero filas**.

- Códigos de provider/capability y configuraciones globales son `SYSTEM_REFERENCE_DATA` o `CONFIGURATION`, pero requieren publicación administrativa versionada y, para activación, adapter/evidencia posteriores.
- `ExternalIntegration`, bindings, cuentas, mappings y policies tenant son `USER_DATA/CONFIGURATION` creados por casos de uso.
- Credenciales, access/refresh tokens y evidencia ficticia están prohibidos.
- SIIGO/FACTUS/ALEGRA no se activan ni se promueven por migration. HKA/ODOO tampoco se insertan como adapters futuros ficticios.

## 15. Rollback y recovery

El down técnico solo es admisible en base fresh/test sin datos 002 y con catálogo exacto. Orden inverso:

1. revocar grants, policies/RLS y eliminar guards/índices;
2. evidence, rate policies, webhook receipts, dispatch attempts, dispatches;
3. mappings, discovery items/runs, capabilities, ownership policies;
4. eliminar FK de binding activo; credential bindings; external integrations;
5. platform configurations, capability declarations, adapter versions, provider registry;
6. schema `integrations` solo si queda vacío;
7. verificar que todo objeto 001 conserva definición/hash y registrar `ROLLED_BACK` en el ledger sin borrar history.

Con datos reales, DROP destructivo queda prohibido: se usa forward migration o restore autorizado. 002 no toca ni elimina objetos 001, roles cluster, ledger, secretos externos ni evidencia de proveedores.

## 16. Verification plan posterior a materialización

La futura implementación deberá probar al menos:

1. catálogo exacto de 16 tablas, columnas, checks, FKs, uniques, índices, owner y grants;
2. cero alteraciones de tablas/bytes 001 y cero tablas fiscales;
3. rechazo físico de `FISCAL`, capability fiscal y `ElectronicDocument` en dispatch;
4. FK discriminada de attempts acepta solo `NON_FISCAL` y rechaza cross-tenant/company;
5. RLS tenant A/B, contexto ausente/inválido, account swapping y reuse de pool;
6. roles sin ownership/superuser/BYPASSRLS indebido y admin read-only por columnas;
7. credential references/tokens ausentes de SQLite, Sync/Outbox/Audit, logs, errores, fixtures y backups;
8. idempotency key duplicada con mismo checksum y conflicto con checksum distinto;
9. mapping internal/external uniqueness, conflicto, retiro y replacement;
10. discovery sanitizado y review/mapping tenant-aware;
11. webhook dedup, callback cross-tenant, replay/auth states sin inventar firmas;
12. rate-limit precedence, 429/header-driven, aislamiento por cuenta y valores no hard-coded;
13. evidence levels separados, mocks sin promoción real y expiración/review;
14. timeout ambiguo, reconciliación y dead-letter sin doble efecto;
15. append-only/inmutabilidad, Audit sanitizado y rollback fresh/reapply;
16. dump/restore PostgreSQL y roles separados.

Estas pruebas mapearán `SEC-G01`, `SEC-G03`, `SEC-G05`, `SEC-G06`, `SEC-G07`, `SEC-G08`, `SEC-G09` y `SEC-G10`, pero todos permanecen `PLANNED / NOT_EVALUATED` hasta ejecución real.

## 17. Compatibilidad y riesgos residuales

- INT-001, ownership de FiscalSubmissionAttempt, `DEC-007`, `ADR-005`, TECH-002 y migration 001 permanecen intactos.
- No se agregan flags ni IDs de provider a Product, Sale, Inventory, Company, Customer, Payment o Tax; todos los verticales comerciales conservan el mismo core capability-driven.
- SIIGO, FACTUS y ALEGRA permanecen `DESIGNED / NOT_EVALUATED`; HKA y ODOO, `FUTURE / NOT_IMPLEMENTED / NOT_EVALUATED`.
- El mecanismo concreto de secret manager, adapters, endpoints, schemas provider-specific, permisos de aplicación y suite PostgreSQL todavía debe implementarse y verificarse.
- Migration 003 sigue siendo obligatoria antes de cualquier dispatch fiscal; 002 por sí sola no implementa facturación electrónica.

## 18. Decisión

El manifest es completo, aditivo y no presenta contradicción HIGH/CRITICAL ni necesidad de replacement/deprecation.

**INT-002 = APPROVED_FOR_COMMIT**

Esto autoriza únicamente comprometer este diseño documental. No autoriza escribir SQL, materializar migration 002, iniciar INT-003, implementar adapters ni declarar providers verificados.
