# INT-006 — manifiesto de migration 003 Fiscal / Electronic Invoicing

## 1. Propósito, estado y autoridad

Estado de `FISCAL-003-MANIFEST`: `PASS`, pendiente de revisión independiente. El ID formal existente para este trabajo es `INT-006`; fue introducido por la decisión de split 002/003 y no se reasigna.

Este documento es la autoridad de alcance para la futura migration PostgreSQL `003_fiscal_electronic_invoicing_foundation`. Es `MANIFEST-ONLY`: no contiene DDL, SQL, cambios al runner, adapters, HTTP, credenciales, seeds ni evidencia real de provider. Un PASS documental autoriza únicamente una revisión independiente; no autoriza materialización.

La migration será aditiva sobre `002_external_integrations_foundation`, que depende de `001_central_foundation`. Las migrations 001 y 002 permanecen materializadas, verificadas e inmutables. Migration 003 materializará exclusivamente ownership de `Electronic Invoicing` en el schema central `fiscal` y habilitará `IntegrationDispatch.FISCAL` como último cambio estructural de una única transacción.

Baseline de diseño verificado en `2f56bd81ec1432f4427aa78c58d78a4e78b36aeb`: 001 UP/DOWN SHA-256 `7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507` / `383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7`; 002 UP/DOWN SHA-256 `8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554` / `91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6`. SQL 003 y artifacts fiscales parciales estaban ausentes.

Fuentes normativas:

- [contrato físico de Electronic Invoicing](../architecture/physical-model/electronic-invoicing-schema.md);
- [arquitectura de documentos electrónicos](../architecture/electronic-invoicing.md);
- [UC-EINV-001](../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md);
- [contrato físico de External Integrations](../architecture/physical-model/external-integrations-schema.md);
- [manifest 002](second-target-migration-manifest.md);
- [configuraciones versionadas](../architecture/physical-model/domain-configuration-schema.md);
- [convenciones físicas](../architecture/physical-model/physical-conventions.md);
- [ownership](../architecture/data-ownership.md);
- [contratos de integración](../architecture/integration-contracts.md);
- [matriz de providers](../architecture/provider-integration-matrix.md);
- [security gates](../security/security-gates.md);
- [trazabilidad](../architecture/physical-model/traceability.md).

Reglas de interpretación: `MANIFEST != SQL`, `DOCUMENTED != IMPLEMENTED`, `IMPLEMENTED != VERIFIED`, `MOCK != INTEGRACIÓN REAL` y `FOUNDATION != CUMPLIMIENTO NORMATIVO`.

## 2. Clasificación y límites

| Cambio | Clasificación | Decisión |
|---|---|---|
| schema `fiscal` y nueve tablas | `NEW` | materializan owners fiscales ya aprobados, sin equivalente en 001/002 |
| FKs hacia 001/002 y descriptor dirigido `003 -> 002` | `EXTENSION` | consumen Company, Branch, User, ExternalIntegration, IntegrationCapability, IntegrationDispatch, ledger y roles existentes |
| constraint final de `IntegrationDispatch.dispatch_class` | `RECONCILIATION` | completa el rollout aprobado 002/003 sin editar bytes de 002 |
| candidate key adicional de `integration_capabilities` y guards fiscales sobre dispatch | `EXTENSION` | hacen verificable la capability y la referencia fiscal desde objetos 003 |
| alcance SQLite | `RECONCILIATION` | el contrato conceptual permite intención local futura, pero migration 003 no replica estado fiscal central ni crea schema local |

No existe `REPLACEMENT` ni `DEPRECATED`. Migration 003 no adquiere ownership de provider, account/environment, credential binding, capabilities generales, discovery, mappings, dispatch general, webhook general ni provider-wide configuration. Tampoco materializa Sales, Tax, Payments, Sync o Audit por segunda vez.

## 3. Decisión de persistencia y no sobre-modelado

| Concepto | Decisión 003 | Materialización / razón |
|---|---|---|
| `FiscalConnection` | `KEEP` | perfil durable company/integration-scoped con vigencia y capability fiscal |
| `FiscalEmissionConfiguration` | `KEEP` | identidad estable de configuración por conexión y tipo documental |
| `FiscalEmissionConfigurationVersion` | `KEEP` | versión publicable, inmutable, con autorización, numeración y referencias opacas |
| `ElectronicDocument` | `KEEP` | único documento fiscal canónico y aggregate de estado legal |
| `FiscalSubmissionAttempt` | `KEEP` | único owner del intento técnico fiscal |
| `FiscalArtifact` | `KEEP` | evidencia durable con lifecycle de retención e integridad propio |
| `FiscalIncident` | `KEEP` | situación revisable con lifecycle independiente |
| `FiscalReconciliation` | `KEEP` | ejecución durable y versionada de comparación externa |
| `FiscalReconciliationItem` | `KEEP` | detalle repetible por documento dentro de una conciliación; no agrega otra máquina de estados |
| `NumberingRange` | `EMBED` | autorización, prefijo, rango y reference viven estructurados en la versión de configuración; no existe lifecycle aprobado separado |
| `TaxIdentity` | `MERGE` | la identidad vigente pertenece a `organization.companies`; NIT/nombre usados se congelan como snapshot inmutable en la versión fiscal |
| `FiscalCertificate` | `EMBED` | solo `certificate_reference` opaca en la versión; la clave/certificado utilizable permanece en el secret/key manager |
| `AttachedDocument`, XML, PDF, respuesta provider/autoridad y payload firmado | `MERGE` | son tipos de `FiscalArtifact`, no tablas por formato |
| `FiscalStatusHistory` | `MERGE` | historia en attempts, artifacts, reconciliation, AuditEvent y eventos canónicos; no se duplica el estado actual en otra tabla |
| contingencia | `EMBED` | policy/reference en configuración, estado/evidencia en documento, incident/reconciliation y Audit; no hay agregado físico aprobado separado |
| webhook fiscal | `MERGE` | recepción/dedup/replay sigue en `integrations.external_webhook_receipts`; el caso de uso fiscal produce evidencia/incident/reconciliation |
| provider-specific metadata | `DEFER` | solo entrará mediante schema versionado/allowlisted futuro; no se crean columnas `siigo_*`, `factus_*` o `alegra_*` |

Resultado: **nueve tablas exactas**, cero tablas auxiliares especulativas y cero blobs fiscales en PostgreSQL.

## 4. Convenciones comunes

- PostgreSQL 16; schema `fiscal`; owner físico `pos_schema_owner`; PUBLIC revocado.
- Todas las tablas son `CENTRAL_ONLY`, tenant-scoped, con `tenant_id NOT NULL`, UUID v7, candidate keys compuestas, `ENABLE/FORCE RLS` y FKs `NO ACTION`.
- PK `id uuid`; checksums SHA-256 lowercase de 64 hex; tiempo `timestamptz`; dinero `numeric(19,6)` y moneda `char(3)` uppercase.
- No se crean enums nativos PostgreSQL. Los estados cerrados usan `text + CHECK`; códigos extensibles usan formato uppercase y allowlist de aplicación.
- No se almacena payload fiscal completo, XML, PDF, AttachedDocument, certificado, private key, token o credential. Solo referencias opacas, checksums y metadata estructurada mínima.
- Snapshots tributario y de emisión permanecen separados. Cada referencia lleva checksum o apunta a una versión inmutable verificable.
- No hay `ON DELETE CASCADE`, hard delete runtime ni `GRANT ALL`.
- `btree_gist` se reutiliza como dependencia compartida para vigencias; 003 no cambia su owner, no la reinstala si existe y nunca la elimina en down.
- Toda transición usa compare-and-swap mediante `version`; timestamps nunca resuelven concurrencia.

## 5. Matriz física exacta

### 5.1 `fiscal.fiscal_connections`

Columnas, en orden:

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
external_integration_id uuid NOT NULL
electronic_invoicing_capability_id uuid NOT NULL
capability_code text NOT NULL DEFAULT 'ELECTRONIC_INVOICING'
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

`capability_code` queda fijo en `ELECTRONIC_INVOICING`. Provider, environment, account, adapter, credential, health y capability general no se copian. El estado efectivo es una proyección de vigencia, integración `ACTIVE|DEGRADED`, capability `SUPPORTED`, configuración publicada y requisitos; no se crea un lifecycle duplicado.

Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)` y `(tenant_id,company_id,external_integration_id,id)`. Dos exclusion constraints NOT DEFERRABLE impiden solapamiento `[valid_from,valid_until)`: una por `(tenant_id,company_id,external_integration_id)` cuando `branch_id IS NULL` y otra que añade `branch_id` cuando no es NULL. Branch, si existe, pertenece a la misma Company.

### 5.2 `fiscal.fiscal_emission_configurations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
fiscal_connection_id uuid NOT NULL
external_integration_id uuid NOT NULL
document_type text NOT NULL
created_at timestamptz NOT NULL
```

Es la identidad estable, no una versión ni un key-value global. Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id,document_type)` y `UNIQUE (tenant_id,company_id,fiscal_connection_id,document_type)`. El catálogo físico inicial es `ELECTRONIC_SALES_INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`, `SUPPORT_DOCUMENT` y `SUPPORT_DOCUMENT_ADJUSTMENT`; migration no inserta filas ni afirma que todo provider soporte cada tipo. Un tipo adicional exige ampliar el contrato y sus capabilities antes de uso.

### 5.3 `fiscal.fiscal_emission_configuration_versions`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
fiscal_connection_id uuid NOT NULL
external_integration_id uuid NOT NULL
fiscal_emission_configuration_id uuid NOT NULL
document_type text NOT NULL
version_number bigint NOT NULL
status text NOT NULL
issuer_tax_id_normalized_snapshot text NOT NULL
issuer_legal_name_snapshot text NOT NULL
authorization_reference text NULL
numbering_policy_code text NOT NULL
prefix text NULL
number_range_start bigint NULL
number_range_end bigint NULL
provider_numbering_reference text NULL
certificate_reference text NULL
contingency_policy_reference text NULL
fiscal_capabilities_snapshot_reference text NOT NULL
fiscal_capabilities_snapshot_checksum text NOT NULL
configuration_schema_version integer NOT NULL
configuration_checksum text NOT NULL
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
published_at timestamptz NULL
supersedes_version_id uuid NULL
created_by_actor_id uuid NOT NULL
published_by_actor_id uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
row_version bigint NOT NULL DEFAULT 1
```

Estados exactos: `DRAFT`, `PUBLISHED`, `SUPERSEDED`, `REVOKED`. `SCHEDULED`, `CURRENT` y `EXPIRED` son proyecciones. Candidate key `(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type)`, `UNIQUE (tenant_id,fiscal_emission_configuration_id,version_number)` y self-FK scoped `(tenant_id,company_id,fiscal_emission_configuration_id,supersedes_version_id)` lineal. Una exclusion constraint NOT DEFERRABLE sobre `(tenant_id,company_id,fiscal_emission_configuration_id,tstzrange(valid_from,valid_until,'[)')) WHERE status='PUBLISHED'` impide solapamiento.

Los rangos son ambos NULL o ambos no NULL y, si existen, `0 < start <= end`. `numbering_policy_code` es código publicado/allowlisted, no una secuencia PostgreSQL que suplante numeración legal. `certificate_reference` es opaca. Checksum de configuración incluye identidad, versión, scope, NIT/nombre congelados, autorización, numeración, references, vigencia y schema; excluye timestamps de auditoría y secretos.

### 5.4 `fiscal.electronic_documents`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
fiscal_emission_configuration_id uuid NOT NULL
emission_configuration_version_id uuid NOT NULL
source_type text NOT NULL
source_id uuid NOT NULL
source_version bigint NOT NULL
document_type text NOT NULL
logical_operation_key text NOT NULL
status text NOT NULL
currency_code char(3) NOT NULL
subtotal_amount numeric(19,6) NOT NULL
discount_amount numeric(19,6) NOT NULL
tax_amount numeric(19,6) NOT NULL
total_amount numeric(19,6) NOT NULL
tax_snapshot_reference text NOT NULL
tax_snapshot_checksum text NOT NULL
fiscal_emission_snapshot_reference text NOT NULL
fiscal_emission_snapshot_checksum text NOT NULL
canonical_payload_version integer NOT NULL
canonical_payload_checksum text NOT NULL
internal_reference text NOT NULL
prefix text NULL
number text NULL
provider_document_id text NULL
provider_reference text NULL
authority_reference text NULL
legal_identifier text NULL
provider_status_raw text NULL
authority_status_raw text NULL
uncertainty_reason text NULL
original_electronic_document_id uuid NULL
correction_source_reference text NULL
issued_at timestamptz NULL
accepted_at timestamptz NULL
rejected_at timestamptz NULL
last_reconciled_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

Estados exactos: `DRAFT`, `READY`, `QUEUED`, `SUBMITTING`, `ACCEPTED`, `REJECTED`, `UNKNOWN_OUTCOME`, `CONTINGENCY`, `VOIDED_BEFORE_SUBMISSION`.

Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,external_integration_id,id)`, `(tenant_id,company_id,fiscal_connection_id,id)` y `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id)`. `UNIQUE (tenant_id,company_id,logical_operation_key)` define la intención fiscal; misma key con checksum diferente es conflicto. Uniques parciales protegen `(tenant_id,company_id,fiscal_connection_id,document_type,prefix,number)`, `(tenant_id,company_id,legal_identifier)` y `(tenant_id,external_integration_id,provider_document_id)` cuando los valores existen.

`source_type/source_id` es referencia polimórfica inmutable porque los aggregates source todavía no comparten una tabla física única; el caso de uso valida tenant/company/branch y congela snapshots. La self-FK del correctivo incluye tenant/company y prohíbe autorreferencia. `CREDIT_NOTE`, `DEBIT_NOTE` y `SUPPORT_DOCUMENT_ADJUSTMENT` exigen original y causa correctiva; los otros dos tipos los prohíben. Los importes son no negativos y deben coincidir con snapshots/checksum; SQL no inventa una ecuación universal que ignore redondeo, cargos, retenciones u otras dimensiones del payload canónico.

`status` es lifecycle de aplicación/documento; `FiscalSubmissionAttempt.status/transport_status` es lifecycle técnico; `provider_status_raw` y `authority_status_raw` conservan autoridades externas separadas. No se colapsan en un único status provider-specific.

### 5.5 `fiscal.fiscal_submission_attempts`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
electronic_document_id uuid NOT NULL
integration_dispatch_id uuid NOT NULL
dispatch_class text NOT NULL DEFAULT 'FISCAL'
operation_type text NOT NULL
attempt_number integer NOT NULL
status text NOT NULL
transport_status text NULL
normalized_result text NULL
request_id text NOT NULL
idempotency_key text NOT NULL
request_checksum text NOT NULL
provider_operation_id text NULL
provider_correlation_reference text NULL
provider_response_reference text NULL
http_status integer NULL
provider_code_raw text NULL
retry_classification text NULL
error_code text NULL
retry_after_at timestamptz NULL
started_at timestamptz NULL
completed_at timestamptz NULL
correlation_id uuid NOT NULL
causation_id uuid NULL
created_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

Estados exactos: `CREATED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `UNKNOWN_OUTCOME`, `CANCELLED`. `normalized_result` es NULL o `ACCEPTED|REJECTED`; nunca reemplaza `status`. `dispatch_class='FISCAL'` es constante física.

Candidate keys `(tenant_id,company_id,external_integration_id,electronic_document_id,id)` y `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id)`. Uniques: `(tenant_id,integration_dispatch_id,attempt_number)`, `(tenant_id,electronic_document_id,operation_type,attempt_number)` y `(tenant_id,electronic_document_id,operation_type,idempotency_key)`. Un retry crea fila nueva y mantiene documento/dispatch/intención. Un trigger bajo row lock asigna/verifica monotonicidad; no se usa `max()+1` sin lock.

Esta tabla es el único owner de attempt number, request/transporte, HTTP/provider response, `Retry-After`, referencias externas técnicas, timestamps, resultado técnico, incertidumbre y retry/reconciliation. `IntegrationDispatchAttempt` permanece exclusivamente `NON_FISCAL` y no recibe columnas nuevas.

### 5.6 `fiscal.fiscal_artifacts`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
external_integration_id uuid NOT NULL
electronic_document_id uuid NOT NULL
fiscal_submission_attempt_id uuid NULL
artifact_type text NOT NULL
media_type text NOT NULL
storage_reference text NOT NULL
checksum_algorithm text NOT NULL
checksum text NOT NULL
size_bytes bigint NULL
provider_reference text NULL
authority_reference text NULL
retention_policy_reference text NOT NULL
immutable_evidence boolean NOT NULL
created_at timestamptz NOT NULL
```

Append-only. `UNIQUE (tenant_id,electronic_document_id,artifact_type,checksum)`. El catálogo físico inicial es `XML`, `PDF`, `ATTACHED_DOCUMENT`, `AUTHORITY_RESPONSE`, `PROVIDER_RESPONSE`, `QR_DATA` y `SIGNED_PAYLOAD`; un tipo nuevo requiere contrato versionado. No se crean tablas por formato. El blob vive en object storage protegido. `storage_reference` nunca aparece en Audit/logs ni en lecturas administrativas generales.

### 5.7 `fiscal.fiscal_reconciliations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
scope_snapshot_reference text NOT NULL
scope_snapshot_checksum text NOT NULL
status text NOT NULL
expected_state_snapshot_reference text NOT NULL
observed_state_snapshot_reference text NULL
provider_evidence_reference text NULL
authority_evidence_reference text NULL
discrepancy_summary_code text NULL
started_by_actor_id uuid NOT NULL
reviewed_by_actor_id uuid NULL
closed_by_actor_id uuid NULL
resolution_reason text NULL
started_at timestamptz NULL
closed_at timestamptz NULL
correlation_id uuid NOT NULL
causation_id uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

Estados exactos: `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED`, `REOPENED`. Candidate key `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id)`. Scope y estados observados son referencias a snapshots sanitizados, no JSON libre ni una tabla de periodos. Reabrir incrementa versión y conserva la ejecución/ítems previos.

### 5.8 `fiscal.fiscal_incidents`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
electronic_document_id uuid NULL
fiscal_submission_attempt_id uuid NULL
fiscal_reconciliation_id uuid NULL
incident_type text NOT NULL
severity text NOT NULL
status text NOT NULL
summary_code text NOT NULL
evidence_reference text NOT NULL
assigned_reviewer_id uuid NULL
resolution_type text NULL
resolution_reason text NULL
resolved_by_actor_id uuid NULL
resolved_at timestamptz NULL
archived_at timestamptz NULL
correlation_id uuid NOT NULL
causation_id uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

Estados exactos: `OPEN`, `IN_REVIEW`, `RESOLVED`, `ARCHIVED`. Candidate key `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id)`. Tipo, severidad y resolución son dimensiones distintas. Puede existir por conexión/configuración sin documento, pero todos los recursos opcionales presentes deben coincidir en tenant/company/integration/connection. Archivar no borra evidencia.

### 5.9 `fiscal.fiscal_reconciliation_items`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
fiscal_reconciliation_id uuid NOT NULL
electronic_document_id uuid NOT NULL
expected_state_reference text NOT NULL
observed_state_reference text NOT NULL
evidence_checksum text NOT NULL
discrepancy_code text NULL
result_code text NOT NULL
evidence_reference text NOT NULL
fiscal_incident_id uuid NULL
created_at timestamptz NOT NULL
```

Append-only; `UNIQUE (tenant_id,fiscal_reconciliation_id,electronic_document_id)`. `result_code` es clasificación allowlisted, no lifecycle. El item no actualiza directamente el documento ni borra/reescribe evidencia.

## 6. Plan exacto de candidate keys y FKs

Todas las FKs usan `ON DELETE NO ACTION`; RLS nunca las sustituye.

| Origen | Columnas | Destino | Invariante |
|---|---|---|---|
| connection | `(tenant_id,company_id)` | `organization.companies(tenant_id,id)` | company scope |
| connection | `(tenant_id,company_id,branch_id)` | `organization.branches(tenant_id,company_id,id)` | branch opcional coherente |
| connection | `(tenant_id,company_id,external_integration_id)` | `integrations.external_integrations(tenant_id,company_id,id)` | integración general exacta |
| connection | `(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code)` | candidate 003 de `integration_capabilities` | capability `ELECTRONIC_INVOICING` perteneciente a la integración |
| stable config | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | connection candidate | mismo perfil/integration |
| config version | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,document_type)` | stable config candidate | misma identidad estable y tipo documental |
| config version | actors | `identity.users(id)` | actor global autenticado |
| config version | scoped `supersedes_version_id` | versión anterior | no supersession cross-scope/config |
| document | `(tenant_id,company_id,branch_id)` | Branch | branch opcional real |
| document | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | connection candidate | mismo profile/integration |
| document | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,document_type)` | version candidate | configuración publicada exacta |
| document | `(tenant_id,company_id,original_electronic_document_id)` | document candidate | correctivo mismo tenant/company |
| attempt | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id)` | document candidate | mismo documento/connection/integration |
| attempt | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | connection candidate | misma conexión |
| attempt | `(tenant_id,company_id,integration_dispatch_id,dispatch_class)` | `integrations.integration_dispatches(tenant_id,company_id,id,dispatch_class)` | FK discriminada `FISCAL` |
| artifact | document/attempt scoped | document/attempt candidates | evidencia no puede cruzar tenant/company/integration |
| reconciliation | connection/Branch/actors | owners correspondientes | scope y actores verificables |
| incident | connection y recursos opcionales scoped | owners correspondientes | ninguna combinación cruzada |
| reconciliation item | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,...)` hacia reconciliation/document/incident | owners correspondientes | item dentro de la misma ejecución, connection y cuenta |

Migration 003 agrega a `integrations.integration_capabilities` la candidate key `(tenant_id,company_id,integration_id,id,capability_code)`. No cambia bytes 002; el objeto nuevo es owned por descriptor 003 y down 003 lo elimina después de retirar dependientes.

Las referencias polimórficas `source_type/source_id`, snapshots, storage y evidence no reciben FK ficticia. Sus owners y validación tenant-aware se realizan por puertos/casos de uso; UUID, checksum, tipo y scope quedan inmutables.

### 6.1 Nombres normativos de constraints y guards

Toda tabla usa `<table>_id_v7_ck`, `<table>_tenant_id_id_uq` y, donde existe `company_id`, `<table>_tenant_company_id_id_uq`. Los nombres adicionales son cerrados:

| Tabla/alteración | Constraints normativos |
|---|---|
| `fiscal_connections` | `fiscal_connections_tenant_company_integration_id_uq`, `fiscal_connections_company_fk`, `fiscal_connections_branch_fk`, `fiscal_connections_integration_fk`, `fiscal_connections_capability_fk`, `fiscal_connections_capability_ck`, `fiscal_connections_validity_ck`, `fiscal_connections_version_ck`, `fiscal_connections_company_validity_excl`, `fiscal_connections_branch_validity_excl` |
| `fiscal_emission_configurations` | `fiscal_emission_configurations_scope_uq`, `fiscal_emission_configurations_identity_uq`, `fiscal_emission_configurations_connection_fk`, `fiscal_emission_configurations_document_type_ck` |
| `fiscal_emission_configuration_versions` | `fiscal_emission_configuration_versions_scope_uq`, `fiscal_emission_configuration_versions_number_uq`, `fiscal_emission_configuration_versions_configuration_fk`, `fiscal_emission_configuration_versions_supersedes_fk`, `fiscal_emission_configuration_versions_created_by_fk`, `fiscal_emission_configuration_versions_published_by_fk`, `fiscal_emission_configuration_versions_status_ck`, `fiscal_emission_configuration_versions_numbering_ck`, `fiscal_emission_configuration_versions_checksum_ck`, `fiscal_emission_configuration_versions_publication_ck`, `fiscal_emission_configuration_versions_validity_ck`, `fiscal_emission_configuration_versions_published_validity_excl` |
| `electronic_documents` | `electronic_documents_tenant_company_integration_id_uq`, `electronic_documents_tenant_company_connection_id_uq`, `electronic_documents_integration_connection_id_uq`, `electronic_documents_logical_operation_uq`, `electronic_documents_connection_fk`, `electronic_documents_branch_fk`, `electronic_documents_configuration_version_fk`, `electronic_documents_original_fk`, `electronic_documents_status_ck`, `electronic_documents_document_type_ck`, `electronic_documents_checksum_ck`, `electronic_documents_amounts_ck`, `electronic_documents_correction_ck`, `electronic_documents_external_identity_ck`, `electronic_documents_timestamps_ck`, `electronic_documents_version_ck`, más los uniques parciales `electronic_documents_legal_number_uq`, `electronic_documents_legal_identifier_uq`, `electronic_documents_provider_document_uq` |
| `fiscal_submission_attempts` | `fiscal_submission_attempts_document_scope_uq`, `fiscal_submission_attempts_connection_scope_uq`, `fiscal_submission_attempts_dispatch_history_uq`, `fiscal_submission_attempts_document_history_uq`, `fiscal_submission_attempts_idempotency_uq`, `fiscal_submission_attempts_document_fk`, `fiscal_submission_attempts_connection_fk`, `fiscal_submission_attempts_dispatch_fk`, `fiscal_submission_attempts_class_ck`, `fiscal_submission_attempts_status_ck`, `fiscal_submission_attempts_result_ck`, `fiscal_submission_attempts_checksum_ck`, `fiscal_submission_attempts_values_ck`, `fiscal_submission_attempts_timestamps_ck`, `fiscal_submission_attempts_version_ck` |
| `fiscal_artifacts` | `fiscal_artifacts_identity_uq`, `fiscal_artifacts_document_fk`, `fiscal_artifacts_attempt_fk`, `fiscal_artifacts_type_ck`, `fiscal_artifacts_checksum_ck`, `fiscal_artifacts_values_ck` |
| `fiscal_reconciliations` | `fiscal_reconciliations_scope_uq`, `fiscal_reconciliations_connection_fk`, `fiscal_reconciliations_branch_fk`, actor FKs sufijadas `_started_by_fk`, `_reviewed_by_fk`, `_closed_by_fk`, `fiscal_reconciliations_status_ck`, `fiscal_reconciliations_checksum_ck`, `fiscal_reconciliations_lifecycle_ck`, `fiscal_reconciliations_version_ck` |
| `fiscal_incidents` | `fiscal_incidents_scope_uq`, `fiscal_incidents_connection_fk`, `fiscal_incidents_branch_fk`, `fiscal_incidents_document_fk`, `fiscal_incidents_attempt_fk`, `fiscal_incidents_reconciliation_fk`, actor FKs sufijadas `_reviewer_fk`, `_resolved_by_fk`, `fiscal_incidents_status_ck`, `fiscal_incidents_resolution_ck`, `fiscal_incidents_lifecycle_ck`, `fiscal_incidents_version_ck` |
| `fiscal_reconciliation_items` | `fiscal_reconciliation_items_identity_uq`, `fiscal_reconciliation_items_reconciliation_fk`, `fiscal_reconciliation_items_document_fk`, `fiscal_reconciliation_items_incident_fk`, `fiscal_reconciliation_items_checksum_ck`, `fiscal_reconciliation_items_result_ck` |
| alteración 002 | `integration_capabilities_fiscal_scope_uq`; constraint final `integration_dispatches_dispatch_class_003_ck`; se retira/restaura únicamente `integration_dispatches_dispatch_class_002_ck` según apply/down |

Los guards/triggers exactos son:

```text
fiscal_connections_scope_guard
fiscal_emission_configuration_versions_update_guard
fiscal_emission_configuration_versions_state_guard
electronic_documents_insert_guard
electronic_documents_update_guard
electronic_documents_state_guard
electronic_documents_evidence_guard
fiscal_submission_attempts_insert_guard
fiscal_submission_attempts_update_guard
fiscal_submission_attempts_state_guard
fiscal_submission_attempts_number_guard
fiscal_artifacts_immutable_guard
fiscal_reconciliations_insert_guard
fiscal_reconciliations_update_guard
fiscal_reconciliations_state_guard
fiscal_incidents_insert_guard
fiscal_incidents_update_guard
fiscal_incidents_state_guard
fiscal_reconciliation_items_immutable_guard
integration_dispatches_fiscal_document_guard
```

Las funciones que los soporten pertenecen a `pos_schema_owner`, fijan `search_path=pg_catalog,fiscal,integrations` sólo cuando requieren ambos schemas y no confían en el search path de sesión. Introspection compara nombre, evento, timing, tabla, función y definición material.

## 7. Capability gate y transición discriminada

La cadena obligatoria para crear un documento/dispatch fiscal es:

```text
ProviderCapabilityDeclaration(SUPPORTED)
  -> IntegrationCapability(SUPPORTED y efectiva)
  -> FiscalConnection vigente
  -> FiscalEmissionConfigurationVersion(PUBLISHED y efectiva)
  -> ElectronicDocument
  -> IntegrationDispatch(FISCAL)
  -> FiscalSubmissionAttempt(FISCAL)
```

No hay flags en Company. Un trigger de connection valida capability `ELECTRONIC_INVOICING`; un trigger de document valida tipo contra configuración/capability y snapshot; el guard de dispatch 002 sigue validando una IntegrationCapability efectiva.

Mapping inicial document type → capability: `ELECTRONIC_SALES_INVOICE|DEBIT_NOTE -> ELECTRONIC_INVOICING`, `CREDIT_NOTE -> CREDIT_NOTES`, `SUPPORT_DOCUMENT|SUPPORT_DOCUMENT_ADJUSTMENT -> SUPPORT_DOCUMENTS`. La capability de cada documento debe estar `SUPPORTED` y efectiva en la misma integración; la capability base de la connection no sustituye este gate por tipo.

El constraint final 003 de `integrations.integration_dispatches` exige exactamente:

```text
(dispatch_class='FISCAL'
 AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS')
 AND internal_entity_type='ElectronicDocument')
OR
(dispatch_class='NON_FISCAL'
 AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS')
 AND internal_entity_type<>'ElectronicDocument')
```

Una capability fiscal futura exige migration explícita antes de uso. Un trigger 003 sobre dispatch `FISCAL` valida que `internal_entity_id` identifique un `ElectronicDocument` del mismo tenant/company/integration y que su tipo sea compatible con la capability. La FK discriminada de `FiscalSubmissionAttempt` exige `FISCAL`; la FK y check existentes de `IntegrationDispatchAttempt` continúan exigiendo `NON_FISCAL`.

## 8. Orden atómico de habilitación FISCAL

Dentro de una única transacción PostgreSQL y bajo el lock global:

1. conservar activo `integration_dispatches_dispatch_class_002_ck`;
2. crear schema `fiscal`, tablas, candidate keys, FKs, checks, índices, guards, RLS, policies y grants;
3. crear `ElectronicDocument` y sus invariantes;
4. crear `FiscalSubmissionAttempt` como único owner técnico;
5. instalar su FK discriminada `FISCAL` hacia `IntegrationDispatch`;
6. instalar y validar el guard de dispatch fiscal hacia `ElectronicDocument`;
7. ejecutar introspection exacta y validaciones de catálogo todavía con FISCAL bloqueado;
8. crear el constraint final 003 como `NOT VALID`, validarlo mientras 002 todavía bloquea toda fila fiscal;
9. eliminar `integration_dispatches_dispatch_class_002_ck` y dejar válido el constraint final 003 como **último cambio estructural**;
10. commit; smoke posterior y ledger `APPLIED` según el protocolo descriptor-driven.

No existe commit intermedio ni ventana con dispatch fiscal sin owner. Cualquier fallo revierte todo y conserva el constraint 002.

## 9. Estados, inmutabilidad y guards

Clasificación:

| Tabla / columnas | Clase |
|---|---|
| identities, tenant/company/integration, source, checksums, document type | `IMMUTABLE` |
| config version publicada, attempts terminados, artifacts, reconciliation items | `APPEND_ONLY` |
| draft config material, connection validity, document DRAFT/READY | `BUSINESS_MUTABLE` con CAS |
| attempt transport/result, document provider/authority evidence, reconciliation observation | `TECHNICAL_MUTABLE` con CAS y allowlist |
| review/resolution/publication/revocation | `PLATFORM_ADMINISTRATIVE` o comando fiscal privilegiado, siempre auditado |

Guards obligatorios:

- columnas permitidas old/new por tabla y rol físico; una tabla no recibe `UPDATE` amplio;
- initial status: config version `DRAFT`, document `DRAFT`, attempt `CREATED`, incident `OPEN`, reconciliation `CREATED`;
- versiones `PUBLISHED|SUPERSEDED|REVOKED` no cambian material, checksum, scope ni references; publicación/supersession/revocation registra actor y Audit;
- connection valida Integration/capability/vigencia y no duplica provider/environment/credentials;
- document `READY` congela source, importes, snapshots y payload; `QUEUED` exige dispatch fiscal en la misma transacción; `ACCEPTED|REJECTED` exige evidencia autoritativa; `ACCEPTED` es terminal salvo correctivo nuevo;
- prefix/number/provider/authority/legal identifiers son write-once; nunca se reasignan arbitrariamente;
- attempt number se reserva monotónicamente bajo lock; request/idempotency/checksum son inmutables; `UNKNOWN_OUTCOME` y terminales no se reescriben para ocultar historia;
- artifact e item son insert-only; ni runtime ni admin obtienen UPDATE/DELETE;
- incident y reconciliation aceptan únicamente las transiciones cerradas por PHY-G12, con actor/motivo requeridos para review/resolve/archive/close/reopen;
- cross-scope, capability ausente, configuración no efectiva, self-correction, checksum conflict y estado ilegal fallan cerrado.

## 10. RLS y policies

Exactamente las nueve tablas 003 reciben `ENABLE ROW LEVEL SECURITY`, una policy `<table>_tenant_isolation` para `pos_app,pos_worker,pos_platform_app` y después `FORCE ROW LEVEL SECURITY`.

```text
USING     (tenant_id = platform.current_tenant_id())
WITH CHECK (tenant_id = platform.current_tenant_id())
```

La ausencia o invalidez de `app.tenant_id` falla cerrado mediante el helper 001. `pos_platform_admin` conserva su `BYPASSRLS` de inspección, pero solo recibe SELECT por columnas. `pos_reporting` y PUBLIC no reciben acceso. Workers usan `SET LOCAL` por tenant/transacción y las pruebas reutilizan conexiones entre tenants para demostrar ausencia de fuga.

## 11. Matriz normativa de grants por columnas

`pos_migrator` ejecuta únicamente artifacts autorizados mediante ownership temporal/controlado; `pos_schema_owner` posee objetos y no atiende tráfico. Ningún runtime recibe ownership, DDL, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` o `GRANT ALL`. En la tabla siguiente, “todas” significa exactamente la lista cerrada de columnas de la ficha §5 correspondiente y debe expandirse como grant por columnas; nunca autoriza `GRANT ... ON TABLE` ni incluye automáticamente columnas futuras.

| Tabla | Rol | Operación | Columnas exactas / límite |
|---|---|---|---|
| `fiscal_connections` | `pos_app` | SELECT | todas salvo ninguna secreta; no hay credential/certificate |
|  | `pos_app` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version` |
|  | `pos_app` | UPDATE | `valid_until,updated_at,version` |
|  | `pos_worker` | SELECT | todas |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,capability_code,valid_from,valid_until,created_at,updated_at,version` |
| `fiscal_emission_configurations` | `pos_app` | SELECT, INSERT | todas las columnas |
|  | `pos_worker` | SELECT | todas |
|  | `pos_platform_app,pos_platform_admin` | SELECT | todas |
| `fiscal_emission_configuration_versions` | `pos_app` | SELECT | todas excepto `certificate_reference` |
|  | `pos_app` | INSERT | todas las columnas; guard exige `DRAFT`, actor y references opacas |
|  | `pos_app` | UPDATE | material DRAFT, `status,published_at,published_by_actor_id,updated_at,row_version`; guard separa publish/revoke/supersede |
|  | `pos_worker` | SELECT | versión publicada completa, incluida `certificate_reference` opaca |
|  | `pos_platform_app,pos_platform_admin` | SELECT | todas excepto `certificate_reference`, snapshot references y checksums |
| `electronic_documents` | `pos_app` | SELECT | todas |
|  | `pos_app` | INSERT | todas las columnas de identidad/source/snapshots/importes en estado `DRAFT`; external/legal evidence debe iniciar NULL |
|  | `pos_app` | UPDATE | material DRAFT, `status,updated_at,version`; solo `DRAFT->READY->QUEUED` o void pre-submit |
|  | `pos_worker` | SELECT | todas |
|  | `pos_worker` | UPDATE | `status,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,prefix,number,issued_at,accepted_at,rejected_at,last_reconciled_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | todas excepto snapshot references/checksums y `canonical_payload_checksum` |
| `fiscal_submission_attempts` | `pos_app` | SELECT | identidad, operation/attempt, estados/códigos/timestamps y correlation; excluye response references |
|  | `pos_worker` | SELECT, INSERT | todas |
|  | `pos_worker` | UPDATE | `status,transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | identidad/scope, operation/attempt, status/transport/normalized result, HTTP/error/timestamps/correlation; excluye request/response references y checksums |
| `fiscal_artifacts` | `pos_app` | SELECT | todas excepto `storage_reference`, provider/authority references |
|  | `pos_worker` | SELECT, INSERT | todas |
|  | `pos_platform_app,pos_platform_admin` | SELECT | identidad/scope, type/media/checksum/size/retention/immutable/created; sin storage/external references |
| `fiscal_reconciliations` | `pos_app` | SELECT | todas excepto evidence/snapshot references |
|  | `pos_app` | INSERT | identidad/scope, snapshot checksum, status, actor, correlation/causation y timestamps; initial `CREATED` |
|  | `pos_app` | UPDATE | `status,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,closed_at,updated_at,version` |
|  | `pos_worker` | SELECT, INSERT | todas |
|  | `pos_worker` | UPDATE | `status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_at,closed_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | identidad/scope/status/actors/timestamps/version; sin evidence/snapshot references |
| `fiscal_incidents` | `pos_app` | SELECT | todas excepto `evidence_reference` |
|  | `pos_app` | INSERT | todas; initial `OPEN` y evidence reference opaca |
|  | `pos_app` | UPDATE | `status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version` |
|  | `pos_worker` | SELECT, INSERT | todas; sin UPDATE de review/resolution |
|  | `pos_platform_app,pos_platform_admin` | SELECT | identidad/scope/type/severity/status/summary/assignment/resolution/timestamps/version; sin evidence reference |
| `fiscal_reconciliation_items` | `pos_app` | SELECT | todas excepto `evidence_reference` |
|  | `pos_worker` | SELECT, INSERT | todas |
|  | `pos_platform_app,pos_platform_admin` | SELECT | identidad/scope/result/discrepancy/checksum/incident/created; sin evidence reference |

`pos_platform_app` no recibe DML fiscal. La aplicación separa `CONFIGURE`, `PUBLISH`, `PREPARE`, `ISSUE`, `RETRY`, `RECONCILE`, `ATTACH_ARTIFACT`, `REVIEW`, `RESOLVE`, `CLOSE` y `REOPEN`; el rol físico no sustituye permisos, reautenticación, MFA o segregación.

## 12. Índices exactos no cubiertos por PK/UNIQUE

| Índice | Columnas / predicado | Query path |
|---|---|---|
| `fiscal_connections_scope_effective_idx` | `(tenant_id,company_id,external_integration_id,valid_from DESC)` | resolver perfil vigente |
| `fiscal_connections_branch_fk_idx` | `(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL` | FK Branch |
| `fiscal_connections_capability_fk_idx` | `(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code)` | FK capability |
| `fiscal_emission_configurations_connection_idx` | `(tenant_id,company_id,fiscal_connection_id,document_type)` | configuración por tipo |
| `fiscal_emission_configuration_versions_lookup_idx` | `(tenant_id,company_id,fiscal_emission_configuration_id,status,valid_from DESC)` | resolver versión |
| `fiscal_emission_configuration_versions_supersedes_idx` | scoped supersession WHERE non-null | self-FK |
| `electronic_documents_source_idx` | `(tenant_id,company_id,source_type,source_id,created_at DESC)` | origen comercial |
| `electronic_documents_work_idx` | `(tenant_id,status,created_at,id) WHERE status IN ('READY','QUEUED','SUBMITTING')` | cola/lifecycle |
| `electronic_documents_uncertain_idx` | `(tenant_id,last_reconciled_at,id) WHERE status='UNKNOWN_OUTCOME'` | reconciliación |
| `electronic_documents_connection_idx` | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | FKs/lookup |
| `electronic_documents_original_idx` | `(tenant_id,company_id,original_electronic_document_id) WHERE ... IS NOT NULL` | correctivos |
| `fiscal_submission_attempts_dispatch_fk_idx` | `(tenant_id,company_id,integration_dispatch_id,dispatch_class)` | FK discriminada |
| `fiscal_submission_attempts_document_idx` | `(tenant_id,company_id,external_integration_id,electronic_document_id,created_at DESC)` | historia por documento |
| `fiscal_submission_attempts_unknown_idx` | `(tenant_id,created_at,id) WHERE status='UNKNOWN_OUTCOME'` | outcome técnico incierto |
| `fiscal_submission_attempts_provider_operation_idx` | `(tenant_id,external_integration_id,provider_operation_id) WHERE ... IS NOT NULL` | consulta/reconciliación |
| `fiscal_artifacts_document_idx` | `(tenant_id,company_id,electronic_document_id,artifact_type,created_at)` | artefactos por documento |
| `fiscal_artifacts_attempt_fk_idx` | scoped attempt WHERE non-null | FK attempt |
| `fiscal_reconciliations_work_idx` | `(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','REOPENED')` | cola/review |
| `fiscal_reconciliations_connection_idx` | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,created_at DESC)` | scope |
| `fiscal_incidents_open_idx` | `(tenant_id,company_id,severity,created_at,id) WHERE status IN ('OPEN','IN_REVIEW')` | review |
| `fiscal_incidents_document_idx` | scoped document WHERE non-null | incidentes por documento |
| `fiscal_incidents_attempt_idx` | scoped attempt WHERE non-null | incidentes por attempt |
| `fiscal_incidents_reconciliation_idx` | scoped reconciliation WHERE non-null | incidentes por conciliación |
| `fiscal_reconciliation_items_document_idx` | `(tenant_id,company_id,electronic_document_id,created_at)` | historia de comparación |
| `fiscal_reconciliation_items_incident_idx` | scoped incident WHERE non-null | FK incident |

No hay GIN, índices JSON, índice independiente de `retry_after_at`, índice por cada status ni índices provider-specific. El scheduling sigue en `IntegrationDispatch.next_attempt_at`; `retry_after_at` es evidencia del attempt.

## 13. Fronteras transaccionales

| Operación | Frontera ACID PostgreSQL |
|---|---|
| crear connection | connection + validación Integration/capability + Audit; ningún HTTP |
| crear/publicar config | stable identity/version + exclusión temporal + Audit; validación remota ocurrió fuera |
| preparar document | source validado + snapshots separados + payload checksum + DRAFT/READY + Audit/evento |
| enqueue FISCAL | `READY->QUEUED` + IntegrationDispatch FISCAL idempotente + Audit/evento en una transacción |
| reservar attempt | lock/CAS document+dispatch, nuevo attempt `CREATED->IN_PROGRESS`, document `SUBMITTING`, commit; HTTP después |
| provider HTTP | siempre fuera de transacción PostgreSQL |
| persistir resultado | attempt terminal + document/dispatch coherentes + artifact references + Audit/eventos en una transacción |
| persistir authority status | evidencia validada + document transition + artifact/incident cuando aplique + Audit |
| attach artifact | upload fuera; insert append-only de referencia/checksum y Audit dentro |
| reconcile UNKNOWN_OUTCOME | crear reconciliation/claim dentro; query HTTP fuera; aplicar items/evidencia/document/dispatch en transacción posterior |

No hay distributed transaction ni retry ciego. Un timeout después de transmitir conserva document y attempt `UNKNOWN_OUTCOME`; polling, webhook validado o reconciliation resuelven el mismo documento sin reescribir el attempt histórico.

## 14. Local-first y SQLite

**MIGRATION 003 SQLITE SCOPE = NONE.**

No se crea artifact, ledger, tabla, índice, trigger, provider state, attempt, authority state, artifact o secret SQLite 003. Checkout local conserva la frontera aprobada:

```text
POS Local -> SyncOperation + Outbox -> Central
          -> ElectronicDocument -> IntegrationDispatch(FISCAL)
          -> FiscalSubmissionAttempt -> provider/authority
```

La información mínima local continúa en la operación comercial, receipt/snapshots y Sync/Outbox ya autorizados. Si una fase futura requiere identidad fiscal local, representación o contingencia, deberá diseñar una migration SQLite independiente y explícita; no copiará la base fiscal central ni hará del POS autoridad de aceptación.

## 15. Dependency graph y create order

```text
001_central_foundation
  -> 002_external_integrations_foundation
    -> 003_fiscal_electronic_invoicing_foundation
```

Orden topológico exacto:

1. lock global; PostgreSQL 16; ledger 001/002 `APPLIED` y checksums/catalogs exactos; SQL 003 ausente.
2. verificar `btree_gist` PREEXISTING y operator classes; no reinstalar ni cambiar owner.
3. crear schema `fiscal`, owner y revocación PUBLIC.
4. agregar candidate key 003 a `integrations.integration_capabilities`.
5. `fiscal_connections`.
6. `fiscal_emission_configurations`.
7. `fiscal_emission_configuration_versions`, self-FK y exclusion temporal.
8. `electronic_documents`, self-FK correctiva y uniques parciales.
9. `fiscal_submission_attempts` y FK discriminada `FISCAL`.
10. `fiscal_artifacts`.
11. `fiscal_reconciliations`.
12. `fiscal_incidents`.
13. `fiscal_reconciliation_items`.
14. índices, guards, RLS/policies/FORCE y grants exactos.
15. guard fiscal sobre IntegrationDispatch, introspection y smoke pre-enable.
16. reemplazo atómico final del constraint 002 por el constraint 003 según §8.
17. commit body, smoke con roles reales y finalización ledger.

## 16. Down order y dependency protection

Down 002 se rechaza si 003 está `STARTED` incompatible o `APPLIED`. Down 003 solo se permite en fresh/test con flag/guard explícito, catálogo exacto, cero filas en las nueve tablas y cero dispatches `FISCAL`; nunca en una base con historia fiscal.

Orden inverso seguro:

1. lock global y validación de elegibilidad/catálogo vacío;
2. restaurar atómicamente el constraint exacto `integration_dispatches_dispatch_class_002_ck` mientras los owners 003 todavía existen; retirar el constraint/guard final 003;
3. revocar grants y retirar policies/RLS/guards/índices 003;
4. `fiscal_reconciliation_items`;
5. `fiscal_incidents`;
6. `fiscal_reconciliations`;
7. `fiscal_artifacts`;
8. `fiscal_submission_attempts`;
9. `electronic_documents`;
10. `fiscal_emission_configuration_versions`;
11. `fiscal_emission_configurations`;
12. `fiscal_connections`;
13. retirar candidate key 003 de `integration_capabilities`;
14. eliminar schema `fiscal` solo si está vacío;
15. validar 001/002 exactas y registrar `ROLLED_BACK` sin borrar ledger history.

Down 003 no elimina `btree_gist`, roles, helpers, schema `integrations`, objetos 001/002, secrets externos, AuditEvent ni provider evidence.

## 17. Descriptor y tooling futuro

No se modifica tooling en esta tarea. El descriptor futuro será:

| Campo | Valor normativo |
|---|---|
| `migration_id` | `003_fiscal_electronic_invoicing_foundation` |
| `manifest_version` | `1` |
| `dependencies` | `002_external_integrations_foundation=APPLIED` con UP SHA-256 aprobado `8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554`; transitivamente 001 |
| `up_artifact` | `sql/postgres/003_fiscal_electronic_invoicing_foundation.up.sql` |
| `down_artifact` | `sql/postgres/003_fiscal_electronic_invoicing_foundation.down.sql` |
| `checksum` | derivado únicamente de bytes del UP efectivo |
| `owned_schemas` | `fiscal` |
| `owned_tables` | `fiscal.fiscal_connections`, `fiscal.fiscal_emission_configurations`, `fiscal.fiscal_emission_configuration_versions`, `fiscal.electronic_documents`, `fiscal.fiscal_submission_attempts`, `fiscal.fiscal_artifacts`, `fiscal.fiscal_reconciliations`, `fiscal.fiscal_incidents`, `fiscal.fiscal_reconciliation_items` |
| `owned_policies` | `<table>_tenant_isolation` para cada una de las nueve tablas anteriores |
| `owned_constraints` | constraints/candidates/FKs/checks/exclusion de tablas 003, candidate capability y constraint final dispatch 003 |
| `owned_indexes` | uniques parciales e índices de §12 |
| `required_extensions` | `btree_gist` shared, PREEXISTING/non-destructive |
| `expected_ledger_state` | `APPLIED` |

Validator 003 inspeccionará exclusivamente ownership 003, incluso constraints, índices y guards 003 derivados del artifact sobre schema `integrations`. Validators 001 y 002 deberán seguir PASS. El runner reutilizará `pos-platform:target-migrations:global:v1`, recovery `STARTED/APPLIED/FAILED/ROLLED_BACK`, crash after body commit, checksum mismatch, repeated up/down y catálogo parcial. No se duplicarán listas entre descriptor, introspection y tests.

## 18. Plan de pruebas para materialización futura

Como mínimo:

A. fresh `001 -> 002 -> 003`; B. validator 001 PASS; C. validator 002 PASS; D. validator 003 PASS; E. FISCAL imposible antes de 003; F. FISCAL permitido después; G. NON_FISCAL attempts siguen válidos; H. fiscal attempt rechaza dispatch NON_FISCAL; I. non-fiscal attempt rechaza dispatch FISCAL; J. connection cross-tenant rechazada; K. document cross-company rechazado; L. dispatch cross-integration rechazado; M. logical operation duplicada con mismo/diferente checksum; N. retry crea nuevo attempt monotónico; O. timeout produce UNKNOWN_OUTCOME; P. reconciliation resuelve el mismo document; Q. legal identifiers write-once; R. artifact tenant isolation; S. secret/certificate/storage references no visibles a roles no autorizados; T. missing/invalid tenant context fail closed; U. worker connection reuse sin fuga; V. down 002 rechazado con 003 aplicada; W. down 003 deja 002 intacta; X. hashes/blobs 001/002 intactos; Y. SQL 004 ausente; Z. provider/security states no promovidos.

Casos derivados adicionales:

- exactamente nueve tablas y nueve RLS ENABLE/FORCE;
- config publication sin overlap, self-supersession/cross-scope rechazadas y versión publicada inmutable;
- TaxIdentity no crea tabla; Company/snapshot coherentes;
- range shape/prefix y numbering policy inválidos rechazados; no secuencia legal local;
- branch mismatch, config/version mismatch y capability ausente/no efectiva rechazados;
- document totals/checksums/snapshots inválidos rechazados;
- correctivo self/cross-company rechazado; original aceptado permanece intacto;
- estado técnico no prueba legal status; raw provider y authority permanecen separados;
- ACCEPTED/REJECTED sin evidencia autoritativa rechazado;
- attempt result/status inconsistente, duplicate attempt number y retry concurrente rechazados;
- attempt UNKNOWN_OUTCOME histórico no reescrito;
- artifact insert-only, checksum/size/reference invalid y acceso storage restringido;
- incident/reconciliation transitions, actor/reason y append-only items;
- capability fiscal futura fuera de allowlist rechazada;
- enablement 003 falla/rollback antes de retirar constraint 002 en cada crash point;
- carreras up003/up003, up003/down002, down003/down002;
- btree_gist sigue presente después de down 003;
- roles reales `pos_app`, `pos_worker`, `pos_platform_app`, `pos_platform_admin`; worker sin business mutation, app sin technical mutation, admin read-only, reporting sin acceso;
- cero seeds, secretos, blobs, columnas provider-specific y artifacts SQLite 003.

Mocks no cuentan como provider integration. No se reportará PostgreSQL 003 como evidencia hasta materializar y ejecutar este plan.

## 19. Seeds, security gates y provider states

Migration 003 tendrá **cero seeds**. No insertará providers, capabilities, configuraciones, rangos, NIT, CUFE/CUDE, documentos, evidence ni cuentas.

Evidencia futura podrá contribuir parcialmente a `SEC-G01`, `SEC-G03`, `SEC-G05`, `SEC-G06`, `SEC-G07`, `SEC-G08`, `SEC-G09` y `SEC-G10`, pero ningún gate cambia de `PLANNED / NOT_EVALUATED` por manifest o migration.

Estados conservados:

- SIIGO, FACTUS, ALEGRA: `DESIGNED / NOT_EVALUATED`;
- THE_FACTORY_HKA, ODOO: `FUTURE / NOT_IMPLEMENTED / NOT_EVALUATED`.

No hay adapter, HTTP, auth, sandbox, producción, certificado DIAN ni validación normativa en 003 foundation.

## 20. Decisión y siguiente gate

El ownership fiscal es inequívoco, no duplica 002, las nueve tablas están justificadas, FK/RLS/grants/guards están definidos, la habilitación FISCAL y rollback no abren ventanas huérfanas, SQLite queda fuera y descriptor/tests están cerrados.

**FISCAL-003-MANIFEST = PASS**

**SQL 003 = NO-GO** hasta una revisión independiente completa del manifest y un preflight de materialización separado. La siguiente tarea exacta es `FISCAL-003-MANIFEST-REVIEW`; no debe escribir SQL.
