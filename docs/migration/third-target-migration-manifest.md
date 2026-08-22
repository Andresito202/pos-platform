# INT-006 — manifiesto de migration 003 Fiscal / Electronic Invoicing

## 1. Propósito, estado y autoridad

Estado de `FISCAL-003-MANIFEST`: `PASS`. La primera remediación cerró M-01..M-06/L-01..L-02; `FISCAL-003-MANIFEST-REVIEW-2` terminó `PASS_WITH_REMEDIATION`, la segunda remediación cerró MED-01..MED-03 y `FISCAL-003-MANIFEST-REMEDIATION-3` reconcilió MED-01 sobre la transición histórica de `DEBIT_NOTES`. `FISCAL-003-MANIFEST-REVIEW-4` detectó B-01/L-01; `FISCAL-003-MANIFEST-REMEDIATION-4` resolvió ambos y `FISCAL-003-MANIFEST-REVIEW-5` confirmó sus áreas técnicas, pero falló por M-01 de gobernanza. `FISCAL-003-MANIFEST-REMEDIATION-5` reconcilió M-01 y `FISCAL-003-MANIFEST-REVIEW-6 = PASS` cerró la revisión con BLOCKER/HIGH/MEDIUM/LOW en cero. El ID formal existente para este trabajo es `INT-006`; fue introducido por la decisión de split 002/003 y no se reasigna.

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
| capability `DEBIT_NOTES` | `EXTENSION` | 003 amplía de forma aditiva declaraciones, capacidades efectivas y allowlists; no modifica SQL 002 ni declara soporte de provider |
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
external_integration_id uuid NOT NULL
electronic_invoicing_capability_id uuid NOT NULL
capability_code text NOT NULL DEFAULT 'ELECTRONIC_INVOICING'
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

`capability_code` queda fijo en `ELECTRONIC_INVOICING`. La connection es **corporativa y nunca tiene `branch_id`**. Provider, environment, account, adapter, credential, health y capability general no se copian. El estado efectivo es una proyección de vigencia, integración `ACTIVE|DEGRADED`, capability `SUPPORTED`, declaración vigente y configuración publicada; `REVALIDATION_REQUIRED` es una proyección cuando la declaración/capability deja de ser efectiva, no una columna ni un lifecycle duplicado.

Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)` y `(tenant_id,company_id,external_integration_id,id)`. Una exclusion constraint NOT DEFERRABLE impide solapamiento `[valid_from,valid_until)` por `(tenant_id,company_id,external_integration_id)`. El scope de sede pertenece exclusivamente a configuración/documento.

### 5.2 `fiscal.fiscal_emission_configurations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
scope_type text NOT NULL
fiscal_connection_id uuid NOT NULL
external_integration_id uuid NOT NULL
document_type text NOT NULL
created_at timestamptz NOT NULL
```

Es la identidad estable, no una versión ni un key-value global. `scope_type` es `COMPANY|BRANCH`; `COMPANY` exige `branch_id IS NULL` y `BRANCH` exige `branch_id IS NOT NULL`. Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)` y `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id,document_type,scope_type)`. La FK de versión usa esta última clave sin nullable; un guard físico compara además `OLD/NEW branch_id` con la configuración, evitando que NULL desactive una FK compuesta. Dos uniques parciales impiden conflicto: `(tenant_id,company_id,fiscal_connection_id,document_type) WHERE scope_type='COMPANY'` y `(tenant_id,company_id,branch_id,fiscal_connection_id,document_type) WHERE scope_type='BRANCH'`. Puede existir una configuración company-wide y configuraciones por sede para el mismo tipo; para un documento, la branch-specific vigente tiene precedencia y la company-wide solo es fallback. Dos candidatas del mismo nivel, solapamiento publicado en una identidad o más de una candidata efectiva producen conflicto fail-closed. El catálogo físico inicial es `ELECTRONIC_SALES_INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`, `SUPPORT_DOCUMENT` y `SUPPORT_DOCUMENT_ADJUSTMENT`; migration no inserta filas ni afirma que todo provider soporte cada tipo.

### 5.3 `fiscal.fiscal_emission_configuration_versions`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
scope_type text NOT NULL
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
next_number_value bigint NULL
numbering_exhausted_at timestamptz NULL
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

Estados exactos: `DRAFT`, `PUBLISHED`, `SUPERSEDED`, `REVOKED`. `SCHEDULED`, `CURRENT` y `EXPIRED` son proyecciones. Scope se fija por FK compuesta no-nullable y branch debe ser idéntica a la configuración mediante guard físico más FK independiente a Branch. Candidate key `(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type)`, `UNIQUE (tenant_id,fiscal_emission_configuration_id,version_number)` y self-FK scoped `(tenant_id,company_id,fiscal_emission_configuration_id,supersedes_version_id)` lineal. Una exclusion constraint NOT DEFERRABLE sobre `(tenant_id,company_id,fiscal_emission_configuration_id,tstzrange(valid_from,valid_until,'[)')) WHERE status='PUBLISHED'` impide solapamiento.

`numbering_policy_code` admite las modalidades normativas `PROVIDER_ASSIGNED`, `AUTHORITY_ASSIGNED`, `AUTHORIZED_RANGE` y `LOCAL_CONTINGENCY`; cualquier código adicional exige contrato versionado. En las dos modalidades remotas, rango, cursor y agotamiento son NULL. En las dos modalidades con asignación local, rango y `next_number_value` son obligatorios, `0 < start <= next <= end + 1`, y `numbering_exhausted_at` solo existe cuando `next=end+1`. El material publicado es inmutable salvo el cursor operacional `next_number_value`, `numbering_exhausted_at`, `updated_at` y `row_version`, modificables exclusivamente por el guard de asignación bajo lock. No se usa una sequence PostgreSQL como sustituto legal. `certificate_reference` es opaca. El checksum publicado incluye la fuente/rango inicial, pero excluye cursor, agotamiento y timestamps operacionales para no reescribir la versión legal.

### 5.4 `fiscal.electronic_documents`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
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
numbering_mode text NOT NULL
numbering_state text NOT NULL
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
number_reserved_at timestamptz NULL
number_consumed_at timestamptz NULL
number_burned_at timestamptz NULL
numbering_resolution_reason text NULL
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

#### 5.4.1 Protocolo normativo de numeración

`ElectronicDocument` es la reserva durable del número para una identidad lógica; la versión de configuración es el owner del rango/cursor. `numbering_state` admite `NOT_APPLICABLE`, `PENDING_EXTERNAL`, `RESERVED`, `CONSUMED`, `UNKNOWN_OUTCOME`, `RELEASED_WITHOUT_REUSE` y `BURNED`. Nunca se reasigna a otro `logical_operation_key` un par prefix/number que haya quedado durablemente asociado, incluso si fue liberado administrativamente.

| Modalidad | Reserva/asignación | Confirmación/consumo | Liberación, huecos y cancelación |
|---|---|---|---|
| `PROVIDER_ASSIGNED` | El command de preparación ejecutado por `pos_app` crea primero el documento `DRAFT` con `numbering_state='PENDING_EXTERNAL'`; no toca cursor local y toda identidad/evidencia externa inicia NULL. El provider asigna después y `pos_worker` persiste únicamente número/referencias write-once permitidas. | Evidencia verificable del provider/autoridad confirma `CONSUMED`. | Antes de transmitir no hay número que liberar. Timeout tras envío queda `UNKNOWN_OUTCOME`; reconciliation confirma consumo/rechazo, nunca crea documento, identidad lógica o número alterno. |
| `AUTHORITY_ASSIGNED` | El command de preparación ejecutado por `pos_app` crea primero el documento `DRAFT` con `numbering_state='PENDING_EXTERNAL'`; no toca cursor local y toda identidad/evidencia externa inicia NULL. La autoridad asigna después y `pos_worker` persiste únicamente resultado autorizado. | Evidencia autoritativa confirma `CONSUMED`. | Antes de solicitar no hay número local. Outcome incierto no se libera ni genera una segunda solicitud automática; reconciliation consulta el mismo documento lógico. |
| `AUTHORIZED_RANGE` | El comando fiscal bloquea la declaración y cadena de capability y luego la versión exacta `FOR UPDATE`; toma `next_number_value`, crea/actualiza el mismo documento lógico a `RESERVED` y avanza el cursor dentro de la misma transacción. | Antes de cualquier HTTP, la reserva durable se marca `CONSUMED` y se crea el attempt/dispatch coherente; desde ese commit el número no vuelve al pool. | Rollback previo al commit revierte documento y cursor. Cancelación tras reserva durable produce `RELEASED_WITHOUT_REUSE` o `BURNED` según política legal, con razón/Audit; el cursor no retrocede. Huecos se conservan como evidencia. |
| `LOCAL_CONTINGENCY` | Igual lock y asignación atómica que `AUTHORIZED_RANGE`, pero solo si la versión publicada habilita contingencia y existe evidencia de activación. | Se considera consumido al emitir localmente el artefacto legal o, como máximo, antes de exponerlo fuera de la transacción. Posterior envío usa el mismo documento/número. | Nunca se reutiliza. Cancelación/anulación exige evidencia y, si corresponde, documento correctivo; reconciliation converge el mismo documento. |

Orden transaccional de asignación local: (1) resolver por branch con precedencia cerrada; (2) adquirir locks canónicos de capability de §7.1; (3) bloquear versión/rango; (4) verificar vigencia, modalidad, rango y `next_number_value <= end`; (5) verificar `logical_operation_key`/checksum; (6) asignar prefix/number y `RESERVED` al mismo documento; (7) incrementar cursor y marcar agotamiento si alcanza `end+1`; (8) Audit/evento; (9) commit. Dos transacciones concurrentes serializan sobre la misma versión. Al agotarse el rango, no hay rollover implícito: se bloquea nueva emisión hasta publicar/seleccionar otra versión autorizada.

Un retry técnico siempre crea otro `FiscalSubmissionAttempt` con el mismo `ElectronicDocument`, número, dispatch lógico e idempotency root. `UNKNOWN_OUTCOME` bloquea release, reutilización, replacement automático y nueva asignación. Solo reconciliation con evidencia autoritativa puede confirmar `CONSUMED`, `BURNED` o ausencia de exposición; aun en esta última, `RELEASED_WITHOUT_REUSE` conserva el hueco. Un reemplazo/correctivo es un nuevo documento lógico explícito que referencia el original y obtiene numeración conforme a su propio tipo/capability.

Matriz de actor para el flujo remoto: `pos_app` crea el aggregate y snapshots con la forma inicial de §11.1, enlaza el `IntegrationDispatch(FISCAL)` al pasar `READY->QUEUED` y nunca escribe resultados provider/authority; `pos_worker` no recibe `INSERT` sobre `electronic_documents`, consume el dispatch, inserta `FiscalSubmissionAttempt`, ejecuta HTTP fuera de ACID y actualiza solo evidencia técnica/legal enumerada; `pos_platform_app` no recibe DML fiscal; `pos_platform_admin` permanece read-only. El documento existe antes de toda llamada remota. Importar un documento externo, si se aprueba en el futuro, será un comando/migration separado y no una variante del INSERT normal.

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
| connection | `(tenant_id,company_id,external_integration_id)` | `integrations.external_integrations(tenant_id,company_id,id)` | integración general exacta |
| connection | `(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code)` | candidate 003 de `integration_capabilities` | capability `ELECTRONIC_INVOICING` perteneciente a la integración |
| stable config | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | connection candidate | mismo perfil/integration corporativo |
| stable config | `(tenant_id,company_id,branch_id)` cuando `scope_type='BRANCH'` | `organization.branches(tenant_id,company_id,id)` | sede real; CHECK `COMPANY↔NULL`, `BRANCH↔NOT NULL` |
| config version | `(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,document_type,scope_type)` | stable config candidate | misma identidad, tipo y scope; guard físico exige branch idéntica |
| config version | `(tenant_id,company_id,branch_id)` cuando no NULL | `organization.branches(tenant_id,company_id,id)` | defensa física adicional de sede |
| config version | actors | `identity.users(id)` | actor global autenticado |
| config version | scoped `supersedes_version_id` | versión anterior | no supersession cross-scope/config |
| document | `(tenant_id,company_id,branch_id)` | Branch | branch operativa obligatoria y real |
| document | `(tenant_id,company_id,external_integration_id,fiscal_connection_id)` | connection candidate | mismo profile/integration |
| document | versión scoped sin imponer igualdad de branch | version candidate | versión publicada exacta; guard físico exige `version.branch_id IS NULL OR version.branch_id=document.branch_id` y precedencia branch-first |
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
| `fiscal_connections` | `fiscal_connections_tenant_company_integration_id_uq`, `fiscal_connections_company_fk`, `fiscal_connections_integration_fk`, `fiscal_connections_capability_fk`, `fiscal_connections_capability_ck`, `fiscal_connections_validity_ck`, `fiscal_connections_version_ck`, `fiscal_connections_company_validity_excl` |
| `fiscal_emission_configurations` | `fiscal_emission_configurations_scope_uq`, `fiscal_emission_configurations_company_scope_uq`, `fiscal_emission_configurations_branch_scope_uq`, `fiscal_emission_configurations_connection_fk`, `fiscal_emission_configurations_branch_fk`, `fiscal_emission_configurations_scope_ck`, `fiscal_emission_configurations_document_type_ck` |
| `fiscal_emission_configuration_versions` | `fiscal_emission_configuration_versions_scope_uq`, `fiscal_emission_configuration_versions_number_uq`, `fiscal_emission_configuration_versions_configuration_fk`, `fiscal_emission_configuration_versions_branch_fk`, `fiscal_emission_configuration_versions_supersedes_fk`, `fiscal_emission_configuration_versions_created_by_fk`, `fiscal_emission_configuration_versions_published_by_fk`, `fiscal_emission_configuration_versions_scope_ck`, `fiscal_emission_configuration_versions_status_ck`, `fiscal_emission_configuration_versions_numbering_ck`, `fiscal_emission_configuration_versions_checksum_ck`, `fiscal_emission_configuration_versions_publication_ck`, `fiscal_emission_configuration_versions_validity_ck`, `fiscal_emission_configuration_versions_published_validity_excl` |
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
fiscal_connections_capability_guard
fiscal_emission_configurations_scope_guard
fiscal_emission_configuration_versions_update_guard
fiscal_emission_configuration_versions_state_guard
fiscal_emission_configuration_versions_numbering_guard
electronic_documents_insert_guard
electronic_documents_update_guard
electronic_documents_state_guard
electronic_documents_evidence_guard
electronic_documents_numbering_guard
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
provider_capability_declarations_fiscal_downgrade_guard
```

Las funciones que los soporten pertenecen a `pos_schema_owner`, fijan `search_path=pg_catalog,fiscal,integrations` sólo cuando requieren ambos schemas y no confían en el search path de sesión. Introspection compara nombre, evento, timing, tabla, función y definición material.

## 7. Capability gate, downgrade y transición discriminada

Migration 003 incorpora `DEBIT_NOTES` como capability extensible aditiva en `ProviderCapabilityDeclaration`, `IntegrationCapability`, allowlists, guards e introspection owned por 003. No edita SQL 002, no inserta declaraciones/capabilities y no afirma soporte de ningún provider. La cadena obligatoria para activar una conexión, publicar/seleccionar configuración, crear un documento o encolar dispatch fiscal es:

```text
ProviderCapabilityDeclaration(SUPPORTED)
  -> IntegrationCapability(SUPPORTED y efectiva)
  -> FiscalConnection vigente
  -> FiscalEmissionConfigurationVersion(PUBLISHED y efectiva)
  -> ElectronicDocument
  -> IntegrationDispatch(FISCAL)
  -> FiscalSubmissionAttempt(FISCAL)
```

No hay flags en Company. Cada operación nueva revalida la declaración de la versión exacta del adapter y la capability efectiva bajo el orden de locks de §7.1; no basta un snapshot ni una fila histórica `IntegrationCapability`. Un trigger de connection valida capability base `ELECTRONIC_INVOICING`; un trigger de document valida tipo contra configuración, declaración, capability y snapshot; el guard 003 de dispatch repite el gate fail-closed justo antes de insertar/activar el dispatch.

Mapping inicial document type → capability: `ELECTRONIC_SALES_INVOICE -> ELECTRONIC_INVOICING`, `CREDIT_NOTE -> CREDIT_NOTES`, `DEBIT_NOTE -> DEBIT_NOTES`, `SUPPORT_DOCUMENT|SUPPORT_DOCUMENT_ADJUSTMENT -> SUPPORT_DOCUMENTS`. Una nota débito falla si `DEBIT_NOTES` no está declarada `SUPPORTED` por la versión exacta del adapter y configurada `SUPPORTED`/efectiva para la integración. La capability base de la connection no sustituye el gate por tipo.

El constraint final 003 de `integrations.integration_dispatches` exige exactamente:

```text
(dispatch_class='FISCAL'
 AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS')
 AND internal_entity_type='ElectronicDocument')
OR
(dispatch_class='NON_FISCAL'
 AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS')
 AND internal_entity_type<>'ElectronicDocument')
```

Una capability fiscal futura exige migration explícita antes de uso. Un trigger 003 sobre dispatch `FISCAL` valida que `internal_entity_id` identifique un `ElectronicDocument` del mismo tenant/company/integration y que su tipo sea compatible con la capability. La FK discriminada de `FiscalSubmissionAttempt` exige `FISCAL`; la FK y check existentes de `IntegrationDispatchAttempt` continúan exigiendo `NON_FISCAL`.

### 7.1 Orden canónico universal de locks

Toda activación, downgrade/retiro, creación/publicación/selección de configuración, resolución de precedencia branch/company, preparación documental, asignación de número, enqueue, reserva/finalización de attempt, webhook/polling aplicado, reconciliation e incident resolution adquiere únicamente las filas aplicables y siempre en este orden; dentro de cada nivel usa UUID/código ascendente:

```text
ProviderCapabilityDeclaration
-> ProviderAdapterVersion
-> ExternalIntegration
-> IntegrationCapability
-> FiscalConnection
-> FiscalEmissionConfiguration
-> FiscalEmissionConfigurationVersion / numbering owner
-> ElectronicDocument
-> IntegrationDispatch
-> FiscalSubmissionAttempt
-> FiscalReconciliation
-> FiscalIncident
-> FiscalReconciliationItem
```

La declaración se bloquea primero `FOR UPDATE` tanto al consumir como al degradar para serializar el último gate con el downgrade. Una operación puede omitir predecessors que no consume, pero nunca adquirirlos después de un successor ni invertir dos niveles. Las colecciones de attempts/items/incidents se bloquean por UUID ascendente. HTTP, discovery y consulta a autoridad ocurren fuera de la transacción.

Publicar/seleccionar configuración usa `READ COMMITTED` y bloquea primero la cadena de capability y después la misma `FiscalConnection FOR UPDATE`, que funciona como coordinator row de `(tenant,company,integration,connection)`. Solo después consulta/crea y bloquea configuraciones COMPANY/BRANCH en orden `(document_type,scope_type,branch_id NULLS FIRST,id)` y sus versiones. Como todo create/publish/select toma ese coordinator antes de consultar candidatos, la ausencia de una configuración BRANCH también queda serializada: no hay phantom entre fallback COMPANY y publicación BRANCH. La exclusion constraint sigue impidiendo dos versiones PUBLISHED solapadas dentro de una identidad.

Preparar documento bloquea declaration/adapter/integration/capability/connection, vuelve a consultar candidatos después del lock, elige BRANCH si existe una versión PUBLISHED efectiva y solo entonces hace fallback COMPANY; bloquea configuración/versión seleccionadas y congela su referencia en `ElectronicDocument`. Una publicación concurrente committeada antes del coordinator es visible; si espera detrás de la preparación, solo afecta documentos posteriores. El resultado es determinístico.

Reconciliation aplicada, webhook validado, polling y finalización worker bloquean `ElectronicDocument -> IntegrationDispatch -> FiscalSubmissionAttempt(s) -> FiscalReconciliation -> FiscalIncident -> FiscalReconciliationItem(s)`. Todos revalidan `version`/estado bajo CAS, de modo que una sola transición legal gana; los demás incorporan evidencia idempotente o detectan estado ya convergido. Una reconciliation puramente histórica puede omitir la cadena de capability y comenzar en `ElectronicDocument`; una consulta externa nueva debe tomar la cadena completa y disponer de capability de consulta vigente. Omitir predecessors no autoriza invertir el orden.

### 7.2 Downgrade/retiro consistente

Un cambio de declaración `SUPPORTED -> UNSUPPORTED|UNVERIFIED`, o retiro/bloqueo de la versión del adapter, bloquea primero la declaración y versión. Desde ese lock, toda nueva operación fiscal espera; al commit revalida y falla. En la misma transacción se bloquean en orden las `IntegrationCapability` afectadas y se cierran en `effective_until=now` o pasan a `UNSUPPORTED|UNVERIFIED|DISABLED` según el motivo permitido por 002; después se bloquean sus conexiones/configuraciones activas para auditar la proyección `REVALIDATION_REQUIRED`. No se añade status duplicado a `FiscalConnection`.

El guard inverso `provider_capability_declarations_fiscal_downgrade_guard` impide confirmar el downgrade si alguna capability efectiva afectada no fue degradada/cerrada en esa transacción. El guard de connection/document/dispatch consulta nuevamente declaración + capability bajo lock, por lo que una fila efectiva obsoleta nunca basta para crear una operación nueva. Activación y upgrade recorren el mismo orden y exigen declaración `SUPPORTED`, adapter habilitado y evidencia aprobada.

El downgrade impide nuevas activaciones, publicaciones seleccionables, documentos, asignaciones legales y dispatches para la capability retirada. DRAFT/READY/QUEUED no transmitidos quedan bloqueados y requieren revalidación o cancelación explícita. No borra ni altera documentos emitidos, identificadores legales, números quemados, attempts, artifacts, snapshots o Audit. La lectura histórica y reconciliation local siguen permitidas; una consulta externa de reconciliation requiere una capability de consulta vigente explícita o evidencia manual/autoridad, nunca un bypass de la capability de emisión retirada. Un documento correctivo posterior requiere sus capabilities vigentes propias.

Downgrade y publicación toman exactamente el mismo prefijo de locks. Si el downgrade obtiene primero la declaración, publicación espera y falla al revalidar; si publicación confirma primero, el downgrade posterior degrada/cierra capability y bloquea operaciones nuevas sin reescribir la versión ya publicada. Downgrade y reconciliation histórica no compiten por capability cuando esta última solo aplica evidencia durable: reconciliation comienza en el suffix documental y conserva historia; si necesita tráfico externo, toma el prefijo completo y falla cerrado sin capability de consulta.

### 7.3 Preflight de transición `DEBIT_NOTES` (MED-01)

Antes de crear o alterar cualquier constraint, `apply 003` debe adquirir el lock de migration, verificar que 002 esté `APPLIED` con catálogo y checksums exactos, y ejecutar un preflight de datos fail-closed. El preflight inspecciona, como mínimo:

- `IntegrationCapability`/`integration_capabilities` con `capability_code='DEBIT_NOTES'`, incluyendo tenant, company e integration;
- `IntegrationDispatch` con `dispatch_class='NON_FISCAL'` y `capability_code='DEBIT_NOTES'`, incluyendo dispatch ID, tenant, company e integration;
- mappings, ownership policies, configuraciones o referencias que asocien `DEBIT_NOTES` con un recurso no fiscal o carezcan del owner fiscal requerido.

Una fila `DEBIT_NOTES` heredada de 002 se considera incompatible con el modelo final 003 salvo que exista evidencia de una reconciliación separada que haya demostrado ownership fiscal, scope tenant/company, `ElectronicDocument`, evidencia, numeración/legal identity cuando corresponda y auditoría. La mera existencia de una capability sin dispatch no autoriza una mutación automática: queda inventariada y bloquea `apply 003` hasta ser reconciliada o retirada por un procedimiento separado. No se exponen secretos ni payloads; el reporte usa únicamente counts, IDs y scope.

Si el count incompatible es mayor que cero, el preflight termina `BLOCKED` antes de crear schema, tablas, capabilities, guards, RLS, grants o constraints. No modifica filas y no convierte `NON_FISCAL` en `FISCAL`. Cada caso se clasifica como: (A) operación realmente no fiscal mal etiquetada; (B) operación fiscal histórica incompleta; (C) dato de prueba; o (D) dato inválido/corrupto. La reconciliación es una tarea separada y requiere owner fiscal verificable, documento real, scope correcto, evidencia y auditoría; nunca inventa `ElectronicDocument`, `FiscalSubmissionAttempt`, CUFE/CUDE, número legal, resultado provider/authority ni evidencia.

Si el count incompatible es cero, el resultado es `PASS` y esta condición queda registrada como precondition obligatoria de `apply 003` y de `verify 003`. Solo entonces puede continuar la habilitación fiscal.

## 8. Orden atómico de habilitación FISCAL

Dentro de una única transacción PostgreSQL y bajo el lock global:

1. adquirir el lock de migration y verificar dependencia 002 `APPLIED`, catálogo y checksums;
2. ejecutar el preflight incompatible `DEBIT_NOTES/NON_FISCAL` de §7.3;
3. si el count es mayor que cero, detenerse `BLOCKED` sin mutación;
4. si el count es cero, conservar activo `integration_dispatches_dispatch_class_002_ck`;
5. crear schema `fiscal`, tablas, candidate keys, FKs, checks, índices, guards, RLS, policies y grants;
6. crear `ElectronicDocument` y sus invariantes;
7. crear `FiscalSubmissionAttempt` como único owner técnico;
8. instalar su FK discriminada `FISCAL` hacia `IntegrationDispatch`;
9. instalar y validar el guard de dispatch fiscal hacia `ElectronicDocument`;
10. crear la capability fiscal `DEBIT_NOTES` y validar candidate keys/FKs sin insertar declaraciones, capabilities operativas ni datos de provider;
11. ejecutar introspection exacta y validaciones de catálogo todavía con FISCAL bloqueado;
12. crear el constraint final 003 como `NOT VALID` y validarlo mientras 002 todavía bloquea toda fila fiscal;
13. eliminar `integration_dispatches_dispatch_class_002_ck` y dejar válido el constraint final 003 como **último cambio estructural**;
14. commit; smoke posterior y ledger `APPLIED` según el protocolo descriptor-driven.

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

Todo texto externo se valida antes de persistir. Se normaliza Unicode NFC, se recortan extremos y se rechazan vacío/solo whitespace, NUL, CR/LF/TAB, controles Unicode `Cc/Cf`, secuencias de escape y contenido que coincida con la denylist de secretos (`authorization`, `bearer`, `api[_-]?key`, `client[_-]?secret`, private key, token/JWT o credencial). `provider_status_raw`, `authority_status_raw`, `provider_code_raw`, códigos de incidente/discrepancia/reconciliation y `error_code` admiten texto provider-specific —nunca enum global— hasta 256 bytes UTF-8; whitespace interno se colapsa a un espacio. Identificadores legales/provider/authority/request/operation/correlation admiten hasta 512 bytes y, cuando son identificadores opacos, solo letras Unicode normalizadas, números y `._:/+@#=-`; referencias URI/storage/evidence/snapshot admiten hasta 2048 bytes y deben satisfacer su scheme/allowlist. Razones sanitizadas admiten 1024 bytes. NULL representa ausencia; string vacío no. Audit/log registra categoría, longitud, hash y resultado de validación, nunca el valor raw, storage reference ni contenido rechazado. Canonicalización ocurre antes de checksum/idempotencia.

## 10. RLS y policies

Exactamente las nueve tablas 003 reciben `ENABLE ROW LEVEL SECURITY` y después `FORCE ROW LEVEL SECURITY`. Ocho tablas usan policy `<table>_tenant_isolation` para `pos_app,pos_worker,pos_platform_app`; cada operación autorizada aplica:

```text
USING     (tenant_id = platform.current_tenant_id())
WITH CHECK (tenant_id = platform.current_tenant_id())
```

`fiscal_emission_configuration_versions` separa cuatro policies permisivas y no incluye al worker en una policy tenant-only: (a) `..._app_tenant_isolation` para `pos_app` con `USING/WITH CHECK` tenant; (b) `..._platform_tenant_isolation` para `pos_platform_app` con `USING` tenant y sin DML; (c) `..._worker_published_history` solo `SELECT` para `pos_worker`, con `USING tenant AND status='PUBLISHED'`, o `status IN ('SUPERSEDED','REVOKED')` únicamente cuando un `ElectronicDocument` del mismo tenant referencia esa versión; (d) `..._worker_numbering_update` solo `UPDATE`, con `USING/WITH CHECK tenant AND status='PUBLISHED'`, mientras el grant y guard limitan el cambio al cursor operacional. Reconciliation accede a histórico mediante el documento/item scoped; no habilita lectura de versiones huérfanas. `DRAFT` jamás es visible al worker. Los column grants siguen siendo una frontera independiente.

La ausencia o invalidez de `app.tenant_id` falla cerrado mediante el helper 001. `pos_platform_admin` conserva su `BYPASSRLS` de inspección, pero solo recibe SELECT por columnas. `pos_reporting` y PUBLIC no reciben acceso. Workers usan `SET LOCAL` por tenant/transacción y las pruebas reutilizan conexiones entre tenants para demostrar ausencia de fuga.

## 11. Matriz normativa de grants por columnas

`pos_migrator` ejecuta únicamente artifacts autorizados mediante ownership temporal/controlado; `pos_schema_owner` posee objetos y no atiende tráfico. Ningún runtime recibe ownership, DDL, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` o `GRANT ALL`. Los siguientes conjuntos son listas literales cerradas que el SQL deberá expandir en grants por columna; una columna futura no pertenece a ninguno y queda **DENY BY DEFAULT**.

| Tabla | Rol | Operación | Conjunto exacto de columnas |
|---|---|---|---|
| `fiscal_connections` | `pos_app` | SELECT, INSERT | `id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version` |
|  | `pos_app` | UPDATE | `valid_until,updated_at,version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,external_integration_id,capability_code,valid_from,valid_until,created_at,updated_at,version` |
| `fiscal_emission_configurations` | `pos_app` | SELECT, INSERT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at` |
| `fiscal_emission_configuration_versions` | `pos_app` | SELECT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version` |
|  | `pos_app` | INSERT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,supersedes_version_id,created_by_actor_id,created_at,updated_at,row_version` |
|  | `pos_app` | UPDATE | `issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,status,published_at,published_by_actor_id,updated_at,row_version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version` |
|  | `pos_worker` | UPDATE | `next_number_value,numbering_exhausted_at,updated_at,row_version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,configuration_schema_version,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version` |
| `electronic_documents` | `pos_app` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version` |
|  | `pos_app` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,original_electronic_document_id,correction_source_reference,created_at,updated_at,version` |
|  | `pos_app` | UPDATE | `source_version,status,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,correction_source_reference,updated_at,version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version` |
|  | `pos_worker` | UPDATE | `status,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,issued_at,accepted_at,rejected_at,last_reconciled_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,canonical_payload_version,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version` |
| `fiscal_submission_attempts` | `pos_app` | SELECT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,request_checksum,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version` |
|  | `pos_worker` | INSERT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,request_id,idempotency_key,request_checksum,correlation_id,causation_id,created_at,version` |
|  | `pos_worker` | UPDATE | `status,transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version` |
| `fiscal_artifacts` | `pos_app` | SELECT | `id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at` |
|  | `pos_worker` | SELECT, INSERT | `id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,storage_reference,checksum_algorithm,checksum,size_bytes,provider_reference,authority_reference,retention_policy_reference,immutable_evidence,created_at` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at` |
| `fiscal_reconciliations` | `pos_app` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_app` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_app` | UPDATE | `status,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,closed_at,updated_at,version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_worker` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_worker` | UPDATE | `status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_at,closed_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version` |
| `fiscal_incidents` | `pos_app` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_app` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_app` | UPDATE | `status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version` |
|  | `pos_worker` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_worker` | INSERT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version` |
| `fiscal_reconciliation_items` | `pos_app` | SELECT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at` |
|  | `pos_worker` | SELECT, INSERT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,evidence_reference,fiscal_incident_id,created_at` |
|  | `pos_platform_app,pos_platform_admin` | SELECT | `id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at` |

Ausencia de fila significa ausencia de grant: `pos_platform_app` no recibe DML fiscal; `pos_platform_admin` tampoco. Los guards comparan `OLD/NEW` y rechazan cambios de identidad/scope/tenant/company/branch, provider/integration/connection, versión seleccionada, source/checksums congelados, identificadores legales y numeración write-once. Solo permiten las columnas enumeradas arriba para DRAFT antes de READY, cursor bajo lock, lifecycle documental/attempt allowlisted, estados raw sanitizados, review/reconciliation autorizados y artifacts/items insert-only. Un rol con UPDATE parcial no puede evadir el set mediante trigger, view o columna futura.

Matriz old/new normativa:

| Tabla | Enforcement `OLD -> NEW` |
|---|---|
| `fiscal_connections` | identidad/tenant/company/integration/capability/`valid_from` inmutables; solo cierre monotónico de `valid_until` con CAS, sin reabrir tras uso fiscal |
| `fiscal_emission_configurations` | insert-only; tenant/company/branch/scope/connection/integration/type no cambian |
| `fiscal_emission_configuration_versions` | en `DRAFT` solo columnas UPDATE enumeradas; tras publicar, material/checksum/scope/actores de creación inmutables; publicación/revocación/supersession cerradas; excepción operacional exclusiva para cursor/agotamiento bajo numbering lock y avance exacto |
| `electronic_documents` | identidad/scope/integration/connection/config/version/source/type/logical key/original inmutables; material fiscal cambia solo en `DRAFT`; desde `READY` queda congelado; número e identificadores externos pasan de NULL a valor una vez y nunca cambian; lifecycle y evidence timestamps deben ser coherentes y CAS |
| `fiscal_submission_attempts` | identidad/scope/document/dispatch/class/operation/attempt/request/idempotency/checksum/correlation/created inmutables; solo lifecycle técnico y resultado enumerados, terminal/`UNKNOWN_OUTCOME` históricos no se reescriben |
| `fiscal_artifacts` | no UPDATE; referencia/checksum/tipo/scope insert-only |
| `fiscal_reconciliations` | identidad/scope/snapshots esperados/actor inicial/correlation inmutables; observación técnica y review/cierre usan columnas/roles separados, transición allowlisted y CAS |
| `fiscal_incidents` | identidad/scope/recursos/tipo/severity/summary/evidence/correlation inmutables; únicamente assignment/resolution/archive allowlisted con actor/razón/CAS |
| `fiscal_reconciliation_items` | no UPDATE; comparación, evidence y vínculo a incident insert-only |

Los guards obtienen el rol efectivo de forma no falsificable, no confían en columnas actor controladas por request y ejecutan Audit en la misma transacción cuando el contrato lo exige.

### 11.1 Formas iniciales normativas y enforcement físico

Un grant de columna autoriza participar en el INSERT, no presembrar resultados futuros. Las formas siguientes son exhaustivas; cualquier combinación distinta falla físicamente:

| Tabla | Forma inicial exacta del INSERT común | Enforcement físico |
|---|---|---|
| `fiscal_emission_configuration_versions` | `status='DRAFT'`; `published_at,published_by_actor_id,numbering_exhausted_at=NULL`. Para `PROVIDER_ASSIGNED|AUTHORITY_ASSIGNED`, rango/cursor son NULL; para `AUTHORIZED_RANGE|LOCAL_CONTINGENCY`, `number_range_start/end` existen y `next_number_value=number_range_start`. `supersedes_version_id` puede apuntar a la versión anterior, pero no la supersede hasta el command de publicación. No existen columnas `superseded_at/revoked_at`; esos hechos viven en status, actor/Audit y nueva versión. | CHECK de shape modalidad/rango/cursor/publicación + `fiscal_emission_configuration_versions_state_guard`; INSERT común solo `DRAFT`. Publicar/revocar/superseder es UPDATE command separado, autorizado y auditado. |
| `electronic_documents` | Siempre `status='DRAFT'`. Remoto: `numbering_mode IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED')`, `numbering_state='PENDING_EXTERNAL'` y `prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,issued_at,accepted_at,rejected_at,last_reconciled_at` son NULL. Rango/contingencia: el mismo INSERT puede quedar `numbering_state='RESERVED'` solo dentro de la transacción de §5.4.1, con prefix/number/reserved_at presentes y campos de consumo/resultado externo NULL; de otro modo falla. | `electronic_documents_status_ck`, `external_identity_ck`, `timestamps_ck` y `electronic_documents_insert_guard/numbering_guard`; el guard verifica rol `pos_app`, modalidad, lock/cursor y ausencia de evidencia terminal. No existe importación externa mediante este INSERT. |
| `fiscal_submission_attempts` | `status='CREATED'`; `transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at=NULL`. Request/idempotency/checksum, attempt number, correlation y scope son obligatorios. No contiene identidades legales del documento. | CHECK `status/result/timestamps` + `fiscal_submission_attempts_insert_guard`; este exige exactamente CREATED y terminales NULL. Resultado/HTTP solo llegan mediante UPDATE worker allowlisted después de `IN_PROGRESS`. |
| `fiscal_reconciliations` | `status='CREATED'`; scope/expected snapshots, checksum, actor inicial, correlation y timestamps de fila presentes; `observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at=NULL`. | `fiscal_reconciliations_lifecycle_ck` + insert guard; observación worker y review/cierre app se separan por grants/guards. No se permite reconciliation preiniciada, preobservada o resuelta. |
| `fiscal_incidents` | `status='OPEN'`; identidad/scope/tipo/severity/summary/evidence/correlation presentes; `assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at=NULL`. | `fiscal_incidents_resolution_ck/lifecycle_ck` + insert guard; assignment/review/resolution/archive solo mediante UPDATE command autorizado. No se permite incidente preasignado o resuelto. |

`fiscal_connections` y `fiscal_emission_configurations` no tienen resultado terminal insertable. `fiscal_artifacts` y `fiscal_reconciliation_items` son hechos completos append-only: todas sus columnas de evidencia obligatorias se validan al INSERT y nunca se actualizan. Ningún otro INSERT puede presembrar lifecycle futuro.

La responsabilidad se divide así: CHECK expresa combinaciones intrafila independientemente del rol; insert guard verifica role, OLD inexistente, contexto, locks y relaciones cross-row; column-level GRANT limita quién puede suministrar cada columna; application command deriva actor/scope confiables y solicita la transición, pero no sustituye enforcement SQL. Las pruebas ejecutan INSERT directo con roles reales para demostrar que cada campo terminal prohibido falla aun sin pasar por aplicación.

`pos_platform_app` no recibe DML fiscal. La aplicación separa `CONFIGURE`, `PUBLISH`, `PREPARE`, `ISSUE`, `RETRY`, `RECONCILE`, `ATTACH_ARTIFACT`, `REVIEW`, `RESOLVE`, `CLOSE` y `REOPEN`; el rol físico no sustituye permisos, reautenticación, MFA o segregación.

## 12. Índices exactos no cubiertos por PK/UNIQUE

| Índice | Columnas / predicado | Query path |
|---|---|---|
| `fiscal_connections_scope_effective_idx` | `(tenant_id,company_id,external_integration_id,valid_from DESC)` | resolver perfil vigente |
| `fiscal_connections_capability_fk_idx` | `(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code)` | FK capability |
| `fiscal_emission_configurations_branch_fk_idx` | `(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL` | FK Branch y lookup branch-specific |
| `fiscal_emission_configuration_versions_lookup_idx` | `(tenant_id,company_id,fiscal_emission_configuration_id,status,valid_from DESC)` | resolver versión |
| `fiscal_emission_configuration_versions_supersedes_idx` | scoped supersession WHERE non-null | self-FK |
| `electronic_documents_source_idx` | `(tenant_id,company_id,source_type,source_id,created_at DESC)` | origen comercial |
| `electronic_documents_work_idx` | `(tenant_id,status,created_at,id) WHERE status IN ('READY','QUEUED','SUBMITTING')` | cola/lifecycle |
| `electronic_documents_uncertain_idx` | `(tenant_id,last_reconciled_at,id) WHERE status='UNKNOWN_OUTCOME'` | reconciliación |
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

`fiscal_emission_configurations_connection_idx` se retira de 003 porque sus columnas quedan cubiertas por los uniques parciales de scope; `electronic_documents_connection_idx` se retira porque la candidate key `(tenant_id,company_id,external_integration_id,fiscal_connection_id,id)` cubre su prefijo. No se crean índices especulativos: si el SQL materializado muestra un query path no cubierto, se registra `POST-MATERIALIZATION PERFORMANCE VALIDATION` con `EXPLAIN (ANALYZE, BUFFERS)` y volumen representativo antes de agregar otra migration. No hay GIN, índices JSON, índice independiente de `retry_after_at`, índice por cada status ni índices provider-specific.

## 13. Fronteras transaccionales

| Operación | Frontera ACID PostgreSQL |
|---|---|
| crear connection | connection + validación Integration/capability + Audit; ningún HTTP |
| crear/publicar config | locks universales hasta connection coordinator; resolver/lock COMPANY+BRANCH y versión; shape/publicación/exclusión + Audit; validación remota ocurrió fuera |
| preparar document | locks canónicos + source/branch/predecencia validados + snapshots separados + asignación local atómica cuando aplique + DRAFT/READY + Audit/evento |
| enqueue FISCAL | `READY->QUEUED` + IntegrationDispatch FISCAL idempotente + Audit/evento en una transacción |
| reservar attempt | lock/CAS document+dispatch, nuevo attempt `CREATED->IN_PROGRESS`, document `SUBMITTING`, commit; HTTP después |
| provider HTTP | siempre fuera de transacción PostgreSQL |
| persistir resultado | attempt terminal + document/dispatch coherentes + artifact references + Audit/eventos en una transacción |
| persistir authority status | evidencia validada + document transition + artifact/incident cuando aplique + Audit |
| attach artifact | upload fuera; insert append-only de referencia/checksum y Audit dentro |
| reconcile UNKNOWN_OUTCOME | crear claim siguiendo suffix canónico; query HTTP fuera; aplicar document/dispatch/attempt/reconciliation/incident/items en orden universal y CAS idempotente |
| capability downgrade | locks canónicos; declaración + capabilities efectivas degradadas/cerradas + conexiones proyectadas REVALIDATION_REQUIRED + Audit; cero HTTP |

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

1. adquirir el lock global no mutante; verificar PostgreSQL 16, ledger 001/002 `APPLIED`, checksums/catalogs exactos y SQL 003 ausente.
2. ejecutar completo el preflight histórico read-only de §7.3: consultar, contar, clasificar y reportar de forma sanitizada todas las incompatibilidades obligatorias, sin reparar ni transformar datos.
3. evaluar todos los counts bloqueantes: si cualquiera es mayor que cero, terminar `BLOCKED` con **cero mutaciones 003** y remitir los casos al flujo de reconciliación separado ya aprobado; si todos son cero, registrar únicamente la precondition de apply satisfecha y autorizar el inicio de la fase de mutación, sin declarar la migration aprobada o aplicada.
4. verificar `btree_gist` PREEXISTING y operator classes; no reinstalar ni cambiar owner.
5. crear schema `fiscal`, owner y revocación PUBLIC; esta es la primera mutación 003 permitida.
6. ampliar aditivamente `DEBIT_NOTES`, agregar candidate key 003 y guard inverso de downgrade sobre objetos `integrations` owned por 003.
7. `fiscal_connections`.
8. `fiscal_emission_configurations`.
9. `fiscal_emission_configuration_versions`, self-FK y exclusion temporal.
10. `electronic_documents`, self-FK correctiva y uniques parciales.
11. `fiscal_submission_attempts` y FK discriminada `FISCAL`.
12. `fiscal_artifacts`.
13. `fiscal_reconciliations`.
14. `fiscal_incidents`.
15. `fiscal_reconciliation_items`.
16. índices, guards, RLS/policies/FORCE y grants exactos.
17. guard fiscal sobre IntegrationDispatch, introspection y smoke pre-enable.
18. reemplazo atómico final del constraint 002 por el constraint 003 según §8.
19. commit body, smoke con roles reales y finalización ledger.

Los pasos 1–4 son precondiciones no mutantes. Antes de completar satisfactoriamente el paso 3 quedan prohibidos `CREATE SCHEMA/TABLE/TYPE`, inserciones o transformaciones fiscales, cambios de capability, RLS, grants/revokes, constraints, dispatches, mappings y ownership de provider o fiscal. No existe otro orden normativo alternativo para `apply 003`.

## 16. Down order y dependency protection

Down 002 se rechaza si 003 está `STARTED` incompatible o `APPLIED`. Down 003 solo se permite en fresh/test con flag/guard explícito, catálogo exacto, cero filas en las nueve tablas, cero dispatches `FISCAL`, cero filas `FISCAL/DEBIT_NOTES` y cero declaraciones/capabilities `DEBIT_NOTES` creadas bajo el contrato 003; nunca en una base con historia fiscal. Un down destructivo no convierte automáticamente dispatches fiscales `DEBIT_NOTES` en `NON_FISCAL`; cualquier fila fiscal o capability heredada no reconciliada bloquea el down.

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
13. retirar guard/catálogo aditivo `DEBIT_NOTES` y candidate key 003 después de retirar todos los dependientes fiscales;
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
| `owned_policies` | `<table>_tenant_isolation` para ocho tablas; cuatro policies role-specific de `fiscal_emission_configuration_versions` definidas en §10 |
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
- dos asignaciones concurrentes sobre el mismo rango producen números distintos; agotamiento bloquea sin rollover; rollback antes del commit revierte cursor; fallo tras aceptación externa/`UNKNOWN_OUTCOME` nunca libera; retry del mismo documento conserva número; cancelación registra hueco sin reuse; contingencia usa el rango/modo publicado;
- branch de otra compañía/tenant rechazada por FK; company-wide y branch-specific válidas; branch-specific precede; candidatas conflictivas fallan cerrado; config/version mismatch rechazado;
- worker no lee `DRAFT`, sí `PUBLISHED`, y solo lee `SUPERSEDED|REVOKED` si un documento histórico tenant-scoped la referencia;
- prueba negativa para cada rol y cada categoría de columna INSERT/SELECT/UPDATE; columna futura/desconocida carece de grant por defecto;
- `DEBIT_NOTE` se rechaza sin declaración y capability efectiva `DEBIT_NOTES`, y solo se acepta con ambas `SUPPORTED` bajo lock;
- downgrade concurrente serializa sobre declaración, invalida/cierra capability activa, bloquea documento/dispatch nuevos, conserva lectura histórica y no produce deadlock bajo el orden canónico;
- `pos_worker` no puede INSERT `ElectronicDocument`; `pos_app` crea remoto `DRAFT/PENDING_EXTERNAL`, worker completa resultado y `UNKNOWN_OUTCOME` conserva el mismo documento;
- config version no puede INSERT `PUBLISHED|SUPERSEDED|REVOKED` ni publication fields; document remoto no puede INSERT número/CUFE-CUDE/referencias/status terminales; attempt no puede INSERT HTTP/result/completed; reconciliation no puede INSERT observación/resolución; incident no puede INSERT assignment/resolución/archive;
- publicación COMPANY vs BRANCH y publicación vs preparación producen precedencia determinística sin phantom; publicación vs downgrade sigue el mismo prefijo y falla/revalida según quién commit primero;
- reconciliation vs webhook, worker completion y downgrade converge una sola transición legal, conserva attempts/número/documento y no deadlockea; cada colección respeta UUID ascendente;
- range shape/prefix/cursor y numbering policy inválidos rechazados; no sequence legal local;
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
- `POST-MATERIALIZATION PERFORMANCE VALIDATION` usa EXPLAIN antes de añadir índices retirados;
- raw status/reference oversized, controles, secreto aparente y vacío/whitespace-only son rechazados; canonicalización/checksum son estables.
- una base 002 sin filas incompatibles `DEBIT_NOTES` permite que el preflight 003 pase;
- una capability `DEBIT_NOTES` sin dispatch bloquea hasta reconciliación explícita, sin mutación automática;
- un dispatch `NON_FISCAL/DEBIT_NOTES` bloquea `apply 003` antes de cualquier schema mutation;
- un fallo del preflight no modifica filas y reporta solo count, IDs y tenant/company/integration;
- una vez reconciliados los datos por procedimiento separado, el preflight puede pasar y 003 sigue usando únicamente el camino FISCAL;
- `IntegrationDispatchAttempt` rechaza FISCAL/DEBIT_NOTES y `FiscalSubmissionAttempt` acepta únicamente FISCAL/DEBIT_NOTES;
- down 003 con datos fiscales `DEBIT_NOTES` queda `BLOCKED`, salvo base fresh/test vacía;
- los hashes de 001/002 se verifican después de cada bloqueo o rollback.

Mocks no cuentan como provider integration. No se reportará PostgreSQL 003 como evidencia hasta materializar y ejecutar este plan.

## 19. Seeds, security gates y provider states

Migration 003 tendrá **cero seeds**. No insertará providers, capabilities, configuraciones, rangos, NIT, CUFE/CUDE, documentos, evidence ni cuentas.

Evidencia futura podrá contribuir parcialmente a `SEC-G01`, `SEC-G03`, `SEC-G05`, `SEC-G06`, `SEC-G07`, `SEC-G08`, `SEC-G09` y `SEC-G10`, pero ningún gate cambia de `PLANNED / NOT_EVALUATED` por manifest o migration.

Estados conservados:

- SIIGO, FACTUS, ALEGRA: `DESIGNED / NOT_EVALUATED`;
- THE_FACTORY_HKA, ODOO: `FUTURE / NOT_IMPLEMENTED / NOT_EVALUATED`.

No hay adapter, HTTP, auth, sandbox, producción, certificado DIAN ni validación normativa en 003 foundation.

## 20. Decisión y siguiente gate

El ownership fiscal es inequívoco, no duplica 002 y `ElectronicDocument` conserva solo identidad/snapshot/source/totales/identificadores/configuración/lifecycle fiscales, sin line items de Sale. Las nueve tablas siguen justificadas. M-01..M-06 y MED-01..MED-03 quedan resueltos; L-01/L-02 reconciliados. `FISCAL-003-MANIFEST-REMEDIATION-3` resuelve MED-01 mediante preflight fail-closed, zero-row path y reconciliación separada sin invención de datos. FK/RLS/grants/guards, initial row shapes, numeración, orden universal, capability downgrade, habilitación FISCAL y rollback no abren ventanas huérfanas; SQLite queda fuera y descriptor/tests están cerrados.

**FISCAL-003-MANIFEST = PASS**

**FISCAL-003-MANIFEST-REMEDIATION-3 = PASS**

**FISCAL-003-MANIFEST-REMEDIATION-4 = PASS**

**FISCAL-003-MANIFEST-REVIEW-5 = FAIL** por M-01 de gobernanza; B-01 y L-01 permanecen resueltos.

**FISCAL-003-MANIFEST-REMEDIATION-5 = PASS**

**FISCAL-003-MANIFEST-REVIEW-6 = PASS** con BLOCKER/HIGH/MEDIUM/LOW en cero; B-01, el único orden APPLY fail-closed, MED-01, la transición de constraint, down/rollback, consistencia de gobernanza y no regresión de providers/seguridad permanecen `PASS`. No se requiere REVIEW-7 por sincronización de gate.

**POSTGRES_MIGRATION_TESTS = PASS (96/96)** en PostgreSQL 16.14, endpoint temporal `127.0.0.1:55432`, mediante `pnpm test:migrations:postgres`; pasaron 2/2 archivos en 25.05 s. Los hashes 001/002 permanecieron inmutables, no quedaron bases de prueba residuales y el contenedor/red efímeros fueron retirados con el puerto liberado.

**MAT-003-PREFLIGHT = BLOCKED** por `APPROVED_EXECUTABLE_PREFLIGHT_NOT_MATERIALIZED`. El repositorio conserva el contrato conceptual y el orden fail-closed de §7.3/§15, pero todavía no contiene comando, query set aprobado, runner TypeScript, package script, integración de harness ni descriptor 003 ejecutables. El intento se detuvo sin iniciar PostgreSQL, inventar consultas o modificar datos.

**Siguiente tarea autorizada: `MAT-003-PREFLIGHT-MATERIALIZATION`.** Su único alcance es materializar el contrato ya aprobado como artefacto ejecutable, revisable y read-only. La decisión SQL/TypeScript/extensión del runner se tomará en esa tarea después de inspeccionar el tooling, favoreciendo reutilizar el harness existente, mínimo código, una fuente de verdad y sin framework paralelo.

Criterios de aceptación: un comando explícito del repositorio sobre PostgreSQL 16.14; ejecución anterior a cualquier mutación 003 con read-only verificable; cobertura completa de capabilities, dispatches, mappings, ownership, configuración y scope tenant/company aprobados; counts bloqueantes y reporte sanitizado; resultados distintos `PASS|BLOCKED|FAIL`; cualquier count mayor que cero produce `BLOCKED` y cero mutaciones 003. No reconcilia, no convierte `NON_FISCAL -> FISCAL`, no fabrica evidencia fiscal/provider, no crea SQL 003 y no modifica migrations 001/002.

**SQL 003 = ABSENT**; migration 003 no está materializada. `MAT-003-PREFLIGHT-MATERIALIZATION` no autoriza ejecutar el preflight, crear/aplicar SQL 003 ni implementar funcionalidad.
