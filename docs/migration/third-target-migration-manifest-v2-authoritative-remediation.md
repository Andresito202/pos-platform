# INT-006 — manifest autoritativo de migration 003 Fiscal / Electronic Invoicing

## 1. Estado, autoridad y límite

Estado: `FISCAL-003-MANIFEST-V2 / AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento reemplaza como contrato vigente de migration 003 las decisiones físicas incompatibles del manifest histórico anterior. El historial Git conserva íntegramente las revisiones y remediaciones previas; no se reutilizan como autoridad cuando contradicen este V2.

Base contractual de esta remediación:

- PR #4 integrada en `main` mediante `bdc0f96323069de821e975737f19961fd16c3ccf`;
- propuesta V7 revisada e integrada con `PROPOSAL_REVIEW = PASS`;
- Modelo A seleccionado exclusivamente: reprepare preservando el mismo `ElectronicDocument` y únicamente antes de exposición externa;
- successor/replacement excluido de migration 003 v1;
- cierre físico normativo concentrado en `sql003-authoritative-contract-remediation-index.md` §4.

Este manifest sigue siendo `MANIFEST-ONLY`. No contiene DDL, SQL, descriptor ejecutable, cambios al runner, adapters, HTTP, credenciales, seeds ni evidencia real de proveedor. Su review no autoriza materialización. SQL 003, descriptor 003 y schema fiscal continúan ausentes hasta un gate posterior explícito.

Migrations 001 y 002 permanecen `MATERIALIZED / TESTED / IMMUTABLE`. Migration 003 es aditiva sobre 002 y puede extender objetos de `integrations` únicamente mediante objetos/columnas/constraints owned por 003; nunca modifica bytes históricos de SQL 001/002.

Cuando este manifest no repita una precisión física, prevalece el índice normativo. Este documento no puede interpretarse para:

- reintroducir `lease_owner`, `lease_expires_at` o reclaim temporal en V1;
- dejar provider identity sin `external_integration_id` scope;
- permitir reuse de numeración cambiando config/connection/provider/document type;
- ignorar receipts generales ya determinísticamente correlacionables;
- convertir `MAT-003 PASS` en validación del target fiscal de diez tablas.

## 2. Decisiones no negociables

1. `ElectronicDocument` es la única identidad fiscal lógica.
2. `logical_operation_key` se calcula con identidad estable y nunca cambia.
3. Una edición permitida de la misma preparation DRAFT no es CREATE/replay nuevo.
4. `REPREPARE_BEFORE_SUBMISSION` conserva el mismo documento, incrementa `preparation_generation` exactamente una vez y crea una nueva `FiscalDocumentPreparation`.
5. Reprepare solo existe para `DRAFT|READY|QUEUED` y solo con prueba durable de cero exposición externa.
6. Cualquier `FiscalSubmissionAttempt`, marca durable `DISPATCHING + IN_PROGRESS`, receipt ya correlacionado, receipt general ya determinísticamente correlacionable, candidato ambiguo, artifact, identidad externa, `UNKNOWN_OUTCOME` o evidence incierta bloquea reprepare.
7. Un dispatch `QUEUED` elegible se cancela en la misma transacción del reprepare; nunca se reutiliza.
8. La numeración de una generation anterior nunca se sobrescribe ni vuelve al pool. La historia queda en su `FiscalDocumentPreparation`.
9. Retry técnico no es reprepare: conserva documento, preparation, dispatch, internal operation identity, idempotency root y numeración; crea otro attempt.
10. Migration 003 v1 materializa exclusivamente `SUBMIT_DOCUMENT`. `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen `DESIGNED / NOT_MATERIALIZED / FAIL_CLOSED`.
11. `UNKNOWN_OUTCOME` permanece histórico y bloquea repetición ciega.
12. SQLite 003 permanece `NONE`.
13. Ningún provider ni `SEC-G01..SEC-G10` cambia de estado por este contrato.
14. `ElectronicDocument.preparation_generation` es la única autoridad de current generation; no existe `current_preparation_id` duplicado.
15. `provider_document_id`, `provider_reference`, `provider_status_raw` pertenecen a `FiscalDocumentPreparation`, no a `ElectronicDocument`.
16. `authority_reference`, `legal_identifier`, `authority_status_raw`, `uncertainty_reason` y timestamps legales pertenecen al `ElectronicDocument` estable.
17. `IntegrationDispatch(FISCAL)` usa identidad provider-neutral cerrada; un adapter/request no elige libremente resource/internal entity/root/generation.
18. Dispatch `SUCCEEDED` significa finalización técnica; no equivale por sí solo a `ElectronicDocument.ACCEPTED`.

## 3. Identidades e idempotencia

### 3.1 Identidad lógica del documento

Serialización versionada y sin ambigüedad:

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

No participan:

- `source_version`;
- `correction_source_reference`;
- branch;
- importes;
- snapshots;
- configuración;
- payload checksum;
- prefix/number;
- provider/authority/legal IDs;
- estados;
- timestamps.

`branch_id` se valida como scope, pero no entra mientras `source_id` sea globalmente estable dentro del contrato. Un source futuro sin esa garantía exige nueva versión de identidad.

Para correctivos, `source_id` identifica la operación correctiva estable y `original_electronic_document_id` participa en la key. `correction_source_reference` es material de preparation, no identidad.

Reglas CREATE/replay:

- misma key + mismo material al crear/preparar: resolución idempotente al mismo documento;
- intento de segunda fila con misma key + material incompatible: `CONFLICT`;
- UPDATE autorizado de la preparation DRAFT actual: puede cambiar material allowlisted con CAS y recalcular checksum;
- desde `READY` la preparation queda FROZEN; para cambiar configuración/material se requiere reprepare elegible.

### 3.2 Root provider-facing de submission

Cada preparation tiene exactamente una intención provider-facing `SUBMIT_DOCUMENT`:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

El checksum no forma parte de la root. Repetir la misma root con checksum/schema/generation incompatible es `CONFLICT`.

Para todo retry de esa preparation:

```text
FiscalSubmissionAttempt.idempotency_key
== IntegrationDispatch.idempotency_key
```

`attempt_number`, attempt `id`, `request_id` y `request_checksum` identifican la ejecución técnica; no cambian la intención externa.

### 3.3 Identidad interna del dispatch fiscal

Todo `IntegrationDispatch(FISCAL)` V1 usa:

```text
dispatch_class = FISCAL
resource_type = ELECTRONIC_DOCUMENT
internal_entity_type = ElectronicDocument
internal_entity_id = ElectronicDocument.id
fiscal_document_preparation_id = FiscalDocumentPreparation.id
fiscal_preparation_generation = FiscalDocumentPreparation.preparation_generation
payload_schema_version = FiscalDocumentPreparation.canonical_payload_version
payload_checksum = FiscalDocumentPreparation.canonical_payload_checksum
```

`internal_operation_id` es el UUID v7 `operation_id` estable del **primer enqueue/submit aceptado** que materializa ese dispatch para esa generation.

No es:

- attempt id;
- attempt number;
- request id;
- correlation id;
- reprepare command id;
- provider operation/document id;
- timestamp;
- payload hash.

Replay same root+checksum conserva el mismo dispatch/internal_operation_id. Reprepare+reenqueue produce nueva generation, nueva root, nuevo dispatch y nuevo internal_operation_id. Retry conserva todos.

## 4. Alcance físico exacto

Migration 003 materializará **diez tablas fiscales**:

1. `fiscal.fiscal_connections`;
2. `fiscal.fiscal_emission_configurations`;
3. `fiscal.fiscal_emission_configuration_versions`;
4. `fiscal.electronic_documents`;
5. `fiscal.fiscal_document_preparations`;
6. `fiscal.fiscal_submission_attempts`;
7. `fiscal.fiscal_artifacts`;
8. `fiscal.fiscal_reconciliations`;
9. `fiscal.fiscal_incidents`;
10. `fiscal.fiscal_reconciliation_items`.

La décima tabla no es un segundo documento ni un status history genérico. Es la representación durable de cada preparation del mismo `ElectronicDocument`, necesaria para conservar configuración, payload, provider scope y numeración entre reprepares sin overwrite.

Extensiones owned por 003 sobre `integrations`:

- capability/candidate/constraint fiscal previsto para `DEBIT_NOTES`;
- transición final de `IntegrationDispatch.dispatch_class`;
- vínculo de `IntegrationDispatch` con preparation/generation fiscal;
- correlación fiscal write-once de `ExternalWebhookReceipt` con document, preparation, generation y dispatch.

No se materializan tablas de TaxIdentity, FiscalCertificate, NumberingRange, webhook fiscal paralelo, provider-specific metadata genérica ni blobs fiscales PostgreSQL.

## 5. Convenciones comunes

- PostgreSQL 16.14 target de validación actual;
- schema `fiscal`;
- owner `pos_schema_owner`;
- PUBLIC revocado;
- UUID v7 para PK;
- `tenant_id NOT NULL`;
- FKs tenant/company-aware y `ON DELETE NO ACTION`;
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en las diez tablas;
- no enums nativos PostgreSQL; estados cerrados usan `text + CHECK`;
- checksums SHA-256 lowercase 64 hex;
- dinero `numeric(19,6)`;
- tiempo `timestamptz`;
- moneda `char(3)` uppercase;
- sin `GRANT ALL`, hard delete runtime ni cascade destructivo;
- `btree_gist` sigue dependencia compartida preexistente/non-destructive;
- transiciones usan CAS/version; timestamps nunca deciden concurrencia;
- secrets, tokens, private keys y payloads fiscales completos permanecen fuera de tablas de negocio.

## 6. Matriz física

### 6.1 `fiscal.fiscal_connections`

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

Corporativa, sin `branch_id`. Vigencia, integration y capability determinan elegibilidad. Provider, environment, credential y health permanecen en External Integrations.

Candidate keys mínimas:

```text
(tenant_id,id)
(tenant_id,company_id,id)
(tenant_id,company_id,external_integration_id,id)
```

Exclusion temporal por tenant/company/integration impide perfiles solapados conforme al baseline preservado.

### 6.2 `fiscal.fiscal_emission_configurations`

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

`scope_type = COMPANY|BRANCH`; COMPANY exige branch NULL, BRANCH exige branch real. BRANCH vigente precede COMPANY y la ambigüedad falla cerrado.

### 6.3 `fiscal.fiscal_emission_configuration_versions`

Conserva el contrato previo de configuración publicada, incluyendo:

```text
id
tenant_id
company_id
branch_id
scope_type
fiscal_connection_id
external_integration_id
fiscal_emission_configuration_id
document_type
version_number
status
issuer_tax_id_normalized_snapshot
issuer_legal_name_snapshot
authorization_reference
numbering_policy_code
prefix
number_range_start
number_range_end
next_number_value
numbering_exhausted_at
provider_numbering_reference
certificate_reference
contingency_policy_reference
fiscal_capabilities_snapshot_reference
fiscal_capabilities_snapshot_checksum
configuration_schema_version
configuration_checksum
valid_from
valid_until
published_at
supersedes_version_id
created_by_actor_id
published_by_actor_id
created_at
updated_at
row_version
```

Estados: `DRAFT|PUBLISHED|SUPERSEDED|REVOKED`.

El material publicado es inmutable excepto cursor/agotamiento de numeración bajo lock. `numbering_policy_code`:

```text
PROVIDER_ASSIGNED
AUTHORITY_ASSIGNED
AUTHORIZED_RANGE
LOCAL_CONTINGENCY
```

La selection BRANCH/COMPANY y compatibilidad de document_type se revalidan bajo lock conforme al index §4.2.

### 6.4 `fiscal.electronic_documents`

`ElectronicDocument` contiene **identidad estable y lifecycle legal**, no la copia mutable de cada preparation:

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
source_type text NOT NULL
source_id uuid NOT NULL
document_type text NOT NULL
logical_operation_key text NOT NULL
status text NOT NULL
internal_reference text NOT NULL
preparation_generation bigint NOT NULL DEFAULT 1
authority_reference text NULL
legal_identifier text NULL
authority_status_raw text NULL
uncertainty_reason text NULL
original_electronic_document_id uuid NULL
issued_at timestamptz NULL
accepted_at timestamptz NULL
rejected_at timestamptz NULL
last_reconciled_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

No materializa:

```text
provider_document_id
provider_reference
provider_status_raw
```

Estados:

```text
DRAFT
READY
QUEUED
SUBMITTING
ACCEPTED
REJECTED
UNKNOWN_OUTCOME
CONTINGENCY
VOIDED_BEFORE_SUBMISSION
```

Constraints/candidates relevantes:

```text
UNIQUE (tenant_id,company_id,logical_operation_key)
UNIQUE (tenant_id,company_id,id,document_type)
preparation_generation >= 1
```

Identidad/scope/source/type/logical key/original son inmutables. Authority/legal identity es write-once/evidence-backed. `preparation_generation` solo aumenta exactamente uno mediante `REPREPARE_BEFORE_SUBMISSION`; retries no la cambian.

### 6.5 `fiscal.fiscal_document_preparations`

Owner de material, configuración, provider scope y numeración **por generation**:

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
electronic_document_id uuid NOT NULL
document_type text NOT NULL
preparation_generation bigint NOT NULL
supersedes_preparation_id uuid NULL
preparation_state text NOT NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
fiscal_emission_configuration_id uuid NOT NULL
emission_configuration_version_id uuid NOT NULL
source_version bigint NOT NULL
correction_source_reference text NULL
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
numbering_mode text NOT NULL
numbering_state text NOT NULL
prefix text NULL
number text NULL
number_reserved_at timestamptz NULL
number_consumed_at timestamptz NULL
number_burned_at timestamptz NULL
numbering_resolution_reason text NULL
provider_document_id text NULL
provider_reference text NULL
provider_status_raw text NULL
created_by_actor_id uuid NOT NULL
frozen_at timestamptz NULL
cancelled_at timestamptz NULL
cancelled_by_actor_id uuid NULL
cancellation_reason text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

`preparation_state`:

```text
DRAFT
FROZEN
CANCELLED
```

Candidate keys/uniques normativos:

```text
UNIQUE (tenant_id,id)
UNIQUE (tenant_id,company_id,id)
UNIQUE (tenant_id,electronic_document_id,id)
UNIQUE (tenant_id,electronic_document_id,preparation_generation)
UNIQUE (tenant_id,company_id,external_integration_id,
        electronic_document_id,preparation_generation,id)
UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,
        electronic_document_id,preparation_generation,id)
```

FKs exactas y guard de supersession se rigen por el índice §4.2:

- document/type fuerte;
- Branch tenant/company-aware;
- fiscal connection scoped;
- emission configuration version scoped por integration/connection/config/document_type;
- self-FK `(tenant_id,electronic_document_id,supersedes_preparation_id)`;
- actor FKs a `identity.users(id)`.

Reglas:

- generation 1 -> no supersedes;
- generation N>1 -> predecessor exactamente N-1 del mismo document;
- material cambia solo mientras DRAFT y document DRAFT;
- FROZEN es inmutable salvo lifecycle técnico/numbering permitido y cancelación elegible;
- CANCELLED es histórico; solo provider late-evidence fields pueden enriquecerse bajo guard;
- integration/connection/config/version/document/type/generation/lineage nunca se reescriben en una fila;
- una asignación local durable nunca se borra;
- `CONSUMED|UNKNOWN_OUTCOME|BURNED` preexistente hace reprepare inelegible;
- remote sin número puede conservar PENDING_EXTERNAL al cancelar sin inventar número;
- provider document/reference son write-once;
- provider status raw es sanitizado/evidence-backed y no sustituye evidence history.

### 6.5.1 No-reuse legal conservador V1

Queda eliminada cualquier formulación que abra namespace por configuration, connection, provider o document type.

La identidad física conservadora es:

```text
CREATE UNIQUE INDEX fiscal_document_preparations_legal_number_uq
ON fiscal.fiscal_document_preparations (
  tenant_id,
  company_id,
  COALESCE(prefix, ''),
  number
)
WHERE number IS NOT NULL;
```

La preparation participa aunque esté CANCELLED o su numbering_state sea `RELEASED_WITHOUT_REUSE|BURNED`.

`prefix` no nulo nunca es string vacío. NULL significa ausencia real. `number` conserva la forma canónica del contrato legal/provider; no se reinterpretan ceros arbitrariamente.

Si una futura norma demostrada permite namespaces legalmente independientes, requiere versión contractual y migration explícita. V1 falla conservadoramente.

Provider identity conserva namespace de integration:

```text
CREATE UNIQUE INDEX fiscal_document_preparations_provider_document_uq
ON fiscal.fiscal_document_preparations (
  tenant_id,
  external_integration_id,
  provider_document_id
)
WHERE provider_document_id IS NOT NULL;
```

### 6.6 `fiscal.fiscal_submission_attempts`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
electronic_document_id uuid NOT NULL
fiscal_document_preparation_id uuid NOT NULL
preparation_generation bigint NOT NULL
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

Estados:

```text
CREATED
IN_PROGRESS
COMPLETED
FAILED
UNKNOWN_OUTCOME
CANCELLED
```

`operation_type` v1 es exactamente `SUBMIT_DOCUMENT`.

Unicidades:

```text
UNIQUE (tenant_id,integration_dispatch_id,attempt_number)
UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)
```

Queda eliminada la antigua uniqueness `(tenant_id,electronic_document_id,operation_type,idempotency_key)`, porque impedía retries con root estable.

Un guard verifica:

- root attempt = root dispatch;
- scope tenant/company/integration/connection/document/preparation/generation coherente;
- operation_type exacto;
- attempt_number monotónico bajo lock;
- request/checksum identity inmutable después de INSERT;
- solo un attempt IN_PROGRESS reclamado a la vez por dispatch.

Timestamps:

- CREATED: started/completed NULL;
- IN_PROGRESS fija `started_at` una vez;
- COMPLETED/FAILED/UNKNOWN_OUTCOME exigen completed_at;
- CANCELLED desde CREATED puede mantener started_at NULL.

`started_at` nunca prueba no-envío.

Transport:

```text
NOT_SENT
SENT
RESPONSE_RECEIVED
UNKNOWN
```

Retry classification:

```text
SAFE_RETRY
RECONCILE_REQUIRED
NON_RETRYABLE
```

`SAFE_RETRY` exige evidence durable/conclusiva; HTTP code, timeout o excepción aislados nunca bastan.

`request_checksum` puede representar request provider-specific transformada y distingue ejecución técnica, pero no autoriza cambiar canonical payload/root.

### 6.7 `fiscal.fiscal_artifacts`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
external_integration_id uuid NOT NULL
electronic_document_id uuid NOT NULL
fiscal_document_preparation_id uuid NOT NULL
preparation_generation bigint NOT NULL
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

Insert-only. Cualquier artifact correlacionado demuestra evidence de la generation y bloquea reprepare de esa generation.

Artifact reference no sustituye provider identity scoped ni authority/legal identity del document.

### 6.8 `fiscal.fiscal_reconciliations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
external_integration_id uuid NOT NULL
fiscal_connection_id uuid NOT NULL
scope_type text NOT NULL
electronic_document_id uuid NULL
preparation_generation bigint NULL
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

`scope_type = DOCUMENT|CONNECTION`.

- DOCUMENT exige document+generation y resolución exacta a preparation;
- CONNECTION prohíbe document/generation.

Migration 003 v1 no autoriza HTTP de query/status. Reconciliation v1 incorpora respuesta síncrona ya recibida, webhook validado, evidencia manual/authority y artifacts existentes.

Un reconciliation DOCUMENT RUNNING de current generation bloquea reprepare. Un reconciliation CONNECTION RUNNING de la misma connection bloquea conservadoramente.

### 6.9 `fiscal.fiscal_incidents`

Conserva el contrato previo y agrega `preparation_generation bigint NULL` cuando existe `electronic_document_id` y la causa es generation-specific.

Estados:

```text
OPEN
IN_REVIEW
RESOLVED
ARCHIVED
```

Generation asociada no cambia después del INSERT. Un conflicto multi-generation por late evidence abre/relaciona incident según policy.

### 6.10 `fiscal.fiscal_reconciliation_items`

Conserva comparación append-only y agrega:

```text
fiscal_document_preparation_id uuid NOT NULL
preparation_generation bigint NOT NULL
```

La evidence observada queda ligada a la generation histórica exacta y nunca se reasigna a current por timestamp.

## 7. Integridad de current preparation

No se materializa un `current_preparation_id` duplicado.

Migration 003 deberá crear dos constraint triggers table-local:

```text
electronic_documents_current_preparation_guard
  ON fiscal.electronic_documents

fiscal_document_preparations_current_generation_guard
  ON fiscal.fiscal_document_preparations
```

Ambos son `AFTER ROW / DEFERRABLE INITIALLY DEFERRED` e invocan:

```text
validate_current_fiscal_preparation_invariant(tenant_id,electronic_document_id)
```

Al commit debe probarse:

1. document generation >=1;
2. exactamente una preparation con generation=current;
3. ninguna preparation con generation>current;
4. current preparation coincide en tenant/company/branch/document_type;
5. N>1 conserva predecessor N-1;
6. document generation no decrementa y solo aumenta uno por reprepare.

Documento + preparation1 nacen en una transacción. Reprepare old cancel + N→N+1 + new preparation también ocurre en una transacción. No se usa repair eventual como sustituto.

## 8. Extensión 003 sobre External Integrations

El contrato exacto está en `physical-model/fiscal-integration-fence-schema.md` y en index §4.9/§4.11/§4.12.

### 8.1 IntegrationDispatch

Migration 003 agrega, solo para `FISCAL`:

```text
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
```

FISCAL exige ambos y el shape de §3.3. NON_FISCAL exige ambos NULL.

La FK scoped demuestra que dispatch, document y preparation pertenecen a tenant/company/integration/generation coherentes.

El payload schema/checksum del dispatch fiscal corresponde exactamente al canonical payload de la preparation FROZEN.

### 8.2 ExternalWebhookReceipt

Migration 003 agrega correlación fiscal write-once:

```text
fiscal_electronic_document_id uuid NULL
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
fiscal_integration_dispatch_id uuid NULL
fiscal_correlated_at timestamptz NULL
```

Para correlación fiscal, el conjunto es all-or-none y las FKs scoped apuntan al dispatch/preparation históricos. Una vez fijado no puede cambiar de document ni generation.

Todo receipt ya correlacionado bloquea reprepare sin importar processing_status.

Un receipt general 002 ya determinísticamente correlacionable también bloquea: el correlator/reprepare debe fijar el linkage write-once bajo el mismo fence antes de permitir generation+1.

Un candidato potencialmente perteneciente al dispatch pero ambiguo/incompleto hace fallar cerrado la prueba de cero exposición.

Solo un receipt genuinamente no correlacionable todavía puede permanecer general. Correlación posterior queda ligada a la generation histórica y activa cuarentena si current cambió.

## 9. Fence canónico de preparation

El fence no es una tabla adicional. Se implementa como protocolo de locks sobre `ElectronicDocument`, `FiscalDocumentPreparation` y dependencias, validando `preparation_generation`.

Orden universal aplicable:

```text
ProviderCapabilityDeclaration
-> ProviderAdapterVersion
-> ExternalIntegration
-> IntegrationCapability
-> FiscalConnection
-> FiscalEmissionConfiguration
-> FiscalEmissionConfigurationVersion / numbering owner
-> ElectronicDocument
-> FiscalDocumentPreparation
-> IntegrationDispatch
-> ExternalWebhookReceipt correlacionado/candidato bloqueado cuando aplique
-> FiscalSubmissionAttempt
-> FiscalReconciliation
-> FiscalIncident
-> FiscalReconciliationItem
```

Dentro de un mismo nivel, UUID/código ascendente. Cuando reprepare cambia integration/configuration, bloquea old+new resources del mismo nivel en orden ascendente antes de avanzar al siguiente nivel.

Ningún HTTP ocurre mientras se mantienen locks.

## 10. Marca durable previa a HTTP y lifecycle del dispatch

Migration 003 V1 **no inventa lease temporal**.

La marca durable previa a HTTP es:

```text
IntegrationDispatch.status = DISPATCHING
+ FiscalSubmissionAttempt persistido para mismo dispatch/generation
+ FiscalSubmissionAttempt.status = IN_PROGRESS
+ CAS/versiones confirmadas
```

### Primer attempt

```text
QUEUED
 -> [claim atómico + attempt #1 IN_PROGRESS]
DISPATCHING
```

### Retry seguro

Después de evidence suficiente para SAFE_RETRY:

```text
RETRY_SCHEDULED
 -> [claim atómico + attempt #N IN_PROGRESS]
DISPATCHING
```

Retry no vuelve a QUEUED.

`attempt_number = max(existing)+1` solo se calcula/verifica bajo lock del dispatch y nunca se reutiliza.

Un crash con attempt IN_PROGRESS entra a recovery/reconciliation fail-closed. Timestamp/next_attempt_at no demuestran ausencia de efecto.

Estados agregados del dispatch conservan catálogo 002:

```text
QUEUED
DISPATCHING
SUCCEEDED
RETRY_SCHEDULED
UNKNOWN_OUTCOME
RECONCILIATION_REQUIRED
PERMANENT_FAILURE
DEAD_LETTER
CANCELLED
```

Semántica:

- `SUCCEEDED` = interacción provider-facing técnicamente concluida; no implica ACCEPTED;
- rechazo fiscal concluyente puede producir dispatch SUCCEEDED + document REJECTED;
- `RETRY_SCHEDULED` exige evidence SAFE_RETRY;
- posible efecto sin certeza -> UNKNOWN_OUTCOME/RECONCILIATION_REQUIRED;
- `CANCELLED` por reprepare solo desde QUEUED sin attempt/evidence;
- un dispatch que alguna vez tuvo attempt nunca vuelve a ser elegible para cancelación por reprepare.

## 11. `REPREPARE_BEFORE_SUBMISSION`

Es command de aplicación, no `operation_type` fiscal y no retry.

### 11.1 Estados permitidos

Solo:

```text
DRAFT
READY
QUEUED
```

Se rechaza en:

```text
SUBMITTING
ACCEPTED
REJECTED
UNKNOWN_OUTCOME
CONTINGENCY
VOIDED_BEFORE_SUBMISSION
```

### 11.2 Prueba durable de cero exposición

Bajo el fence debe cumplirse simultáneamente:

- current preparation coincide con document.preparation_generation;
- cero FiscalSubmissionAttempt para document/generation;
- dispatch ausente o exactamente QUEUED y nunca reclamado;
- cero provider identity/status en current preparation;
- cero authority/legal identity en document;
- cero artifacts para preparation;
- cero ExternalWebhookReceipt ya correlacionado a preparation en cualquier status;
- cero receipt general ya determinísticamente correlacionable al dispatch conforme a selector versionado;
- cero candidato potencialmente aplicable pero ambiguo/incompleto;
- cero reconciliation DOCUMENT RUNNING para document/generation;
- cero reconciliation CONNECTION RUNNING en connection afectada;
- cero transport/effect evidence;
- numbering_state no `CONSUMED|UNKNOWN_OUTCOME|BURNED` antes de iniciar;
- ninguna evidence externa/authority incierta.

Si cualquier prueba no es concluyente, falla cerrado y abre/relaciona incident/reconciliation; jamás presume no-envío.

### 11.3 Efecto atómico

1. Si existe dispatch QUEUED elegible, pasa a CANCELLED.
2. Si existe número reservado, preparation anterior conserva prefix/number y pasa a RELEASED_WITHOUT_REUSE/BURNED según policy, con razón/Audit; cursor jamás retrocede.
3. Preparation anterior pasa a CANCELLED, conservando historia.
4. ElectronicDocument.preparation_generation aumenta exactamente 1.
5. Se crea new FiscalDocumentPreparation DRAFT con supersedes a anterior.
6. Solo new preparation puede rebindear integration/connection/config/version tras revalidar chain old+new, BRANCH>COMPANY y capabilities.
7. Se regeneran snapshots/canonical payload/checksums.
8. Document vuelve DRAFT.
9. Deferred current-preparation invariant debe pasar al commit.
10. Audit/eventos conservan actor, motivo, old/new generation, correlation y causation.

Un cambio ordinario allowlisted de DRAFT no incrementa generation.

## 12. Late evidence y cuarentena cross-generation

Cuando receipt/artifact/provider/authority evidence se correlaciona a una generation menor que la current:

1. bloquear document y resources relevantes en orden canónico;
2. persistir evidence únicamente contra generation histórica;
3. no reactivar ni reescribir preparation histórica;
4. provider identity/status histórico puede enriquecerse solo bajo late-evidence guard y evidence append-only;
5. document current entra UNKNOWN_OUTCOME salvo evidence autoritativa suficiente para estado legal más fuerte;
6. current dispatch QUEUED permanece durable pero no puede reclamarse mientras document esté UNKNOWN_OUTCOME;
7. si current generation ya tiene attempt/claim durable, abrir/relacionar FiscalIncident multi-generation y no iniciar otro attempt;
8. nunca reasignar evidence a current por timestamp/status/conveniencia.

Si reconciliation autoritativa demuestra ausencia de efecto externo en todas las generations históricas cuestionadas, un command específico puede retirar quarantine sin reprepare ni cambiar generation, conforme al index §4.7.

Si historical evidence demuestra ACCEPTED/REJECTED u otro efecto, la generation posterior no puede emitirse; convergencia ocurre por reconciliation, no por selección de “la última”.

## 13. Numeración

El rango/cursor sigue owned por `FiscalEmissionConfigurationVersion`. La asignación concreta por document/generation vive en `FiscalDocumentPreparation`.

- PROVIDER_ASSIGNED/AUTHORITY_ASSIGNED: preparation inicia PENDING_EXTERNAL; sin número antes de evidence;
- AUTHORIZED_RANGE/LOCAL_CONTINGENCY: lock exacto del owner, asignación + avance cursor + preparation RESERVED en una transacción;
- al preparar exposición, reserva local pasa a CONSUMED conforme a policy antes de HTTP/representación externa;
- rollback antes del commit revierte reserva/cursor;
- después de reserva durable cancelada por reprepare, número queda RELEASED_WITHOUT_REUSE/BURNED, nunca vuelve al cursor;
- UNKNOWN_OUTCOME impide liberar, reprepare o nueva asignación automática;
- retry conserva same preparation/numeración;
- config/connection/provider/document type nunca habilitan reuse de un prefix/number durable en V1.

La historia ya no depende de sobrescribir columnas del document ni exclusivamente de Audit.

## 14. Capability y operation scope V1

Mapping documental:

```text
ELECTRONIC_SALES_INVOICE -> ELECTRONIC_INVOICING
CREDIT_NOTE -> CREDIT_NOTES
DEBIT_NOTE -> DEBIT_NOTES
SUPPORT_DOCUMENT -> SUPPORT_DOCUMENTS
SUPPORT_DOCUMENT_ADJUSTMENT -> SUPPORT_DOCUMENTS
```

La chain declaration/adapter/integration/capability/configuration se revalida bajo lock en prepare, freeze, enqueue, reprepare y worker claim.

`FiscalSubmissionAttempt.operation_type` solo acepta:

```text
SUBMIT_DOCUMENT
```

Quedan fuera:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

No se simulan con SUBMIT_DOCUMENT, no se materializan como dispatch fiscal y no se anuncian como provider support.

## 15. Downgrade y revalidación

Downgrade/retiro conserva prefijo de locks existente y bloquea operaciones nuevas. Documentos históricos no se reescriben.

Para documento no expuesto:

- DRAFT puede continuar solo si preparation sigue válida; si requiere otra chain, usa reprepare;
- READY/QUEUED invalidado queda bloqueado y solo vuelve a DRAFT mediante reprepare elegible;
- QUEUED exige dispatch todavía QUEUED/unclaimed y cancelación atómica;
- si existe attempt, DISPATCHING, receipt correlacionado/correlacionable/ambiguo, artifact, provider identity, authority/legal identity, UNKNOWN_OUTCOME o evidence incierta, reprepare está prohibido.

No existe successor/replacement automático en V1.

## 16. RLS, grants y guards

Las diez tablas reciben RLS FORCE. Exact column sets y policies de `FiscalDocumentPreparation` se rigen por index §4.6. Extensiones de tablas 002 se rigen por §4.9.

### 16.1 ElectronicDocument

`pos_app` puede INSERT identidad inicial y UPDATE lifecycle de preparación, incluido `preparation_generation`, solo mediante guards que demuestren protocolo reprepare. No escribe provider identity; authority/legal results solo por casos de uso/evidence autorizados.

`pos_worker` puede SELECT y actualizar lifecycle/evidence externa allowlisted; nunca cambia logical key, source, original document o generation.

### 16.2 FiscalDocumentPreparation

`pos_app` puede INSERT y editar material solo en DRAFT; puede freeze/cancel y finalizar numbering previo únicamente bajo guards/locks del command.

`pos_worker` puede SELECT FROZEN y actualizar numbering/provider evidence allowlisted; no cambia config, payload, generation ni material frozen.

En CANCELLED, worker queda efectivamente limitado por late-evidence guard a:

```text
provider_document_id
provider_reference
provider_status_raw
updated_at
version
```

con evidence correlacionada a esa generation. No puede modificar numbering/config/snapshots/payload/lifecycle/lineage.

### 16.3 FiscalSubmissionAttempt

Solo `pos_worker` inserta/actualiza lifecycle técnico. Identity/preparation/dispatch/operation/attempt number/request/root/checksum/correlation son inmutables después de INSERT.

### 16.4 Artifacts/items

Insert-only; no UPDATE/DELETE runtime.

### 16.5 Integrations extensions

Campos fiscales de dispatch/receipt son owned por 003, con grants mínimos y guards write-once/inmutabilidad. Una columna futura no recibe grant por default.

Guards mínimos consolidados incluyen:

```text
electronic_documents_reprepare_guard
electronic_documents_current_preparation_guard
fiscal_document_preparations_current_generation_guard
fiscal_document_preparations_insert_guard
fiscal_document_preparations_update_guard
fiscal_document_preparations_state_guard
fiscal_document_preparations_numbering_guard
fiscal_document_preparations_late_evidence_guard
fiscal_submission_attempts_root_guard
integration_dispatches_fiscal_preparation_guard
external_webhook_receipts_fiscal_correlation_guard
```

Los guards obtienen rol/contexto de forma no falsificable, usan CAS/locks y no confían en actor/scope enviado por request.

## 17. Candidate keys y constraints críticas

Además de PK/candidates tenant-aware:

```text
electronic_documents_logical_operation_uq
  UNIQUE (tenant_id,company_id,logical_operation_key)

electronic_documents_document_type_scope_uq
  UNIQUE (tenant_id,company_id,id,document_type)

fiscal_document_preparations_generation_uq
  UNIQUE (tenant_id,electronic_document_id,preparation_generation)

fiscal_document_preparations_legal_number_uq
  UNIQUE logical identity
  (tenant_id,company_id,COALESCE(prefix,''),number)
  WHERE number IS NOT NULL

fiscal_document_preparations_provider_document_uq
  UNIQUE (tenant_id,external_integration_id,provider_document_id)
  WHERE provider_document_id IS NOT NULL

fiscal_submission_attempts_dispatch_history_uq
  UNIQUE (tenant_id,integration_dispatch_id,attempt_number)

fiscal_submission_attempts_document_history_uq
  UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)
```

**No existe** `fiscal_submission_attempts_idempotency_uq` por root estable.

Dispatch fiscal referencia preparation exacta. Receipt correlacionado referencia preparation/dispatch exactos. Artifact/item referencia generation exacta. Relaciones cross-scope fallan cerrado.

La lista exacta de additional candidates/FKs y nombres normativos de preparation está en index §4.2-§4.3 y forma parte de este manifest por referencia normativa.

## 18. Apply order normativo

1. adquirir lock global y verificar 001/002 APPLIED + checksums/catalogs exactos;
2. ejecutar MAT-003 preflight histórico read-only completo;
3. cualquier blocker -> BLOCKED, cero mutaciones 003;
4. verificar `btree_gist` shared;
5. crear schema fiscal y revocar PUBLIC;
6. ampliar aditivamente DEBIT_NOTES/candidate/guards owned por 003 sin insertar datos;
7. crear connections/configurations/configuration_versions;
8. crear electronic_documents;
9. crear fiscal_document_preparations con candidates/FKs/numbering/provider identity/current-generation support;
10. crear attempts/artifacts/reconciliations/incidents/items;
11. extender integration_dispatches con vínculo preparation/generation manteniendo FISCAL todavía bloqueado por constraint 002;
12. extender external_webhook_receipts con correlación fiscal write-once;
13. instalar FKs/guards/constraint triggers/índices/RLS/policies/grants exactos;
14. ejecutar introspection/smoke pre-enable;
15. crear/validar constraint final 003 mientras 002 aún bloquea FISCAL;
16. retirar `integration_dispatches_dispatch_class_002_ck` como último cambio estructural;
17. commit;
18. smoke con roles reales y finalización ledger según descriptor futuro.

No existe commit intermedio con dispatch FISCAL sin preparation/attempt owner.

El descriptor futuro debe expresar el target consolidado de diez tablas; MAT-003 no sustituye esa introspection.

## 19. Down order y protección

Down 003 solo en fresh/test explícitamente autorizado, catálogo exacto, cero historia fiscal y cero dispatch/receipt correlation fiscal. Producción con historia queda bloqueada.

Orden:

1. lock y elegibilidad;
2. restaurar constraint exacto 002 y retirar guard/constraint final 003;
3. validar cero FISCAL rows/evidence dependiente;
4. retirar correlación fiscal de webhook y vínculo fiscal de dispatch;
5. revocar grants/policies/guards/constraint triggers/índices 003;
6. drop reconciliation_items;
7. incidents;
8. reconciliations;
9. artifacts;
10. submission_attempts;
11. document_preparations;
12. electronic_documents;
13. configuration_versions;
14. configurations;
15. connections;
16. retirar DEBIT_NOTES/candidate/guards owned por 003;
17. eliminar schema fiscal solo si queda vacío y owned por 003;
18. validar 001/002 intactas y registrar ROLLED_BACK sin borrar ledger history.

Nunca elimina `btree_gist`, objetos 001/002, Audit ni secrets/evidence externos.

## 20. Índices mínimos

Además de índices de FK y uniques:

- documents por tenant/company/source y por status de trabajo;
- preparations por document/generation, integration/connection y numbering legal;
- preparation supersedes/actor FKs;
- attempts por dispatch, document+generation y UNKNOWN_OUTCOME;
- attempts por provider operation cuando no null;
- artifacts por document+generation/type y attempt FK;
- reconciliations por status y document/generation/connection;
- incidents por estado/severity/document/generation;
- webhook fiscal correlation por `(tenant_id,company_id,fiscal_electronic_document_id,fiscal_preparation_generation)` parcial;
- webhook integration FK para receipts generales;
- dispatch fiscal preparation por `(tenant_id,company_id,internal_entity_id,fiscal_preparation_generation)` parcial;
- indexes necesarios para exact FKs de index §4.2/§4.9.

Índices adicionales requieren query path y validación post-materialización con `EXPLAIN (ANALYZE, BUFFERS)`; no se agregan por intuición.

## 21. Pruebas obligatorias antes de autorizar SQL

### 21.1 Contrato/create/current generation

1. CREATE/replay same key/same material idempotente;
2. segunda fila same key/different material = CONFLICT;
3. DRAFT edit autorizado no incrementa generation;
4. document sin preparation1 en misma transaction falla al commit;
5. document+preparation1 pasa independientemente del orden válido de statements;
6. document N->N+1 sin new preparation falla;
7. preparation N+1 sin avanzar document falla;
8. intento N->N+2 falla;
9. mutate/delete historical generation no puede dejar current invariant inválida.

### 21.2 Reprepare/fence

10. DRAFT reprepare elegible crea generation+1 y conserva document;
11. READY reprepare elegible crea generation+1;
12. QUEUED unclaimed se cancela atómicamente;
13. dispatch DISPATCHING bloquea;
14. cualquier attempt bloquea, incluso NOT_SENT/FAILED histórico;
15. UNKNOWN_OUTCOME bloquea;
16. provider identity/status current preparation bloquea;
17. authority/legal identity document bloquea;
18. artifact bloquea;
19. receipt correlacionado RECEIVED/PENDING/PROCESSING/PROCESSED/RETRY_SCHEDULED/DEAD_LETTER/REJECTED bloquea;
20. general receipt ya determinísticamente correlacionable pero sin linkage fiscal bloquea;
21. candidate receipt ambiguo/incompleto fail-closed;
22. receipt inequívocamente de otro dispatch no bloquea;
23. reconciliation RUNNING aplicable bloquea;
24. dos reprepares concurrentes producen un ganador;
25. correlator/webhook vs reprepare produce un ganador;
26. worker first claim vs reprepare produce un ganador;
27. old/new integrations se bloquean sin deadlock.

### 21.3 Idempotencia/retry/dispatch

28. FISCAL con resource_type distinto de ELECTRONIC_DOCUMENT falla;
29. internal entity que no resuelve document de preparation falla;
30. capability incompatible con document_type falla;
31. payload schema/checksum distinto de preparation FROZEN falla;
32. replay same root+checksum conserva dispatch/internal_operation_id;
33. reprepare+reenqueue produce nueva generation/root/dispatch/internal_operation_id;
34. mismo dispatch/generation admite attempts 1..N con same root;
35. duplicate attempt_number falla;
36. attempt root distinta a dispatch falla;
37. operation_type distinta de SUBMIT_DOCUMENT falla;
38. retry no incrementa generation ni cambia numeración;
39. RETRY_SCHEDULED no autoriza retry sin SAFE_RETRY evidence;
40. dos workers reclamando QUEUED producen un solo attempt IN_PROGRESS;
41. dos workers reclamando RETRY_SCHEDULED producen un solo attempt IN_PROGRESS;
42. crash IN_PROGRESS no habilita resend por timeout/lease inexistente;
43. UNKNOWN_OUTCOME histórico no se reescribe;
44. dispatch SUCCEEDED + document REJECTED es válido con rejection evidence concluyente;
45. ningún estado de dispatch por sí solo produce ACCEPTED/REJECTED.

### 21.4 Numeración

46. historial de generation anterior permanece consultable;
47. número RELEASED_WITHOUT_REUSE/BURNED no puede asignarse a otra generation/document;
48. cambiar config no permite reuse;
49. cambiar connection no permite reuse;
50. cambiar provider no permite reuse;
51. cambiar document type no permite reuse dentro del mismo emisor V1;
52. cursor no retrocede por reprepare;
53. asignación concurrente produce números distintos;
54. rollback previo al commit revierte cursor;
55. remote PENDING_EXTERNAL puede cancelarse sin inventar número;
56. CONSUMED/UNKNOWN_OUTCOME/BURNED preexistente bloquea reprepare.

### 21.5 Late evidence

57. receipt inicialmente genuinamente no correlacionable puede ser histórico después;
58. late correlation preserva old preparation_generation;
59. CANCELLED preparation late evidence no muta numbering/config/payload;
60. late provider identity se queda en historical preparation;
61. document current entra quarantine UNKNOWN_OUTCOME cuando aplica;
62. current QUEUED no se reclama durante quarantine;
63. current generation ya con attempt produce incident multi-generation y no otro attempt;
64. evidence nunca se reasigna por timestamp;
65. authoritative no-effect reconciliation puede resolver quarantine solo por command específico.

### 21.6 Scope/security

66. cross-tenant/company/integration/preparation rechazado;
67. provider_document_id duplicate dentro de same integration rechazado;
68. provider identity no existe en ElectronicDocument schema;
69. RLS FORCE para diez tablas;
70. worker no inserta document/preparation;
71. app no escribe attempt/provider result fuera de columns/guards autorizados;
72. admin read-only;
73. secrets ausentes de logs/tablas;
74. receipt fiscal fields write-once;
75. NON_FISCAL exige fiscal linkage NULL;
76. CANCELLED worker late-evidence update no toca numbering.

### 21.7 Regression/governance

77. migrations/validators 001 y 002 siguen PASS;
78. MAT-003 preflight sigue PASS/BLOCKED/FAIL fail-closed;
79. MAT-003 role-readiness sigue PASS/fail-closed;
80. MAT-003 PASS no se presenta como validation del target V2;
81. SQLite 003 sigue NONE;
82. providers y SEC-G mantienen estado;
83. query/retrieve no aparecen en catálogo físico V1;
84. enablement FISCAL sigue último cambio estructural;
85. down 003 con historia/evidence queda bloqueado;
86. no descriptor/checksum/ledger003 aparece antes de tarea autorizada.

## 22. Descriptor futuro

Solo después de `AUTHORITATIVE_CONTRACT_REVIEW = PASS` e integración documental autorizada podrá abrirse una tarea separada para diseñar/materializar descriptor 003 y SQL003.

El descriptor deberá declarar:

- diez tablas fiscales;
- exact columns/candidates/FKs/constraints/indexes/guards/policies/grants;
- extensions 003 sobre `integrations`;
- dependencies exactas 001/002;
- PostgreSQL version target;
- apply/down ownership;
- exact SQL hashes finalmente aprobados;
- introspection/catalog expectations;
- current-preparation constraint triggers;
- no-reuse legal conservador;
- no-lease V1 claim contract;
- webhook correlatable fence;
- MAT-003 como prerequisite, no target validation.

No se duplicarán listas divergentes entre descriptor, introspection y tests.

## 23. Alcance exacto de MAT-003

Los artefactos actuales MAT-003 se preservan sin modificación en esta remediación documental.

`MAT-003-PREFLIGHT` verifica, entre otros:

- PostgreSQL 16.14;
- read-only/repeatable-read;
- global migration lock;
- role/privileges requeridos;
- migrations 001/002 APPLIED con checksums exactos;
- catálogo 002 válido;
- fiscal schema absent;
- migration003 ledger absent;
- blockers históricos de DEBIT_NOTES y scopes relacionados.

`MAT-003 canonical-role-readiness` valida/provisiona controladamente `pos_platform_admin`, roles/ACL, hashes 001/002/provisioning y ausencia de SQL/descriptor/schema/ledger003.

Por tanto:

```text
MAT-003 PASS
  = prerequisite/readiness evidence
  != validation of V2 ten-table target
  != SQL003 review
  != descriptor003 validation
  != authorization to materialize
```

Future SQL/descriptor task debe agregar exact target introspection/catalog/grants/RLS/guard/apply/down/concurrency tests. No reutiliza MAT-003 PASS como prueba de ese target.

## 24. Estado de providers, seguridad y local-first

- SIIGO / FACTUS / ALEGRA: `DESIGNED / NOT_EVALUATED`;
- THE_FACTORY_HKA / ODOO: `FUTURE / NOT_IMPLEMENTED / NOT_EVALUATED`;
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`;
- SQLite migration 003: `NONE`;
- runtime fiscal: `NOT_MATERIALIZED`;
- SQL 003 / descriptor 003 / schema fiscal: `ABSENT`.

La ausencia de provider query v1 significa que un UNKNOWN_OUTCOME puede permanecer en review/manual evidence hasta que exista capability contract de consulta autorizado. Eso es deliberadamente fail-closed y no se reemplaza por retry ciego.

## 25. Gate siguiente

Esta remediación autoritativa debe recibir sobre un HEAD exacto:

1. diff limitado al bundle documental/backlog;
2. CI TARGET fresco `SUCCESS`;
3. migrations 001/002 y MAT-003 sin regresión, entendiendo MAT-003 con el alcance de §23;
4. SQL/descriptor/schema003 ausentes;
5. revisión independiente del bundle completo contra propuesta V7 y baseline preservado;
6. cero BLOCKER/HIGH/MEDIUM abiertos;
7. backlog/PR reconciliados;
8. `AUTHORITATIVE_CONTRACT_REVIEW = PASS`.

Solo ese PASS habilita dejar esta PR documental lista para el gate de integración. Merge requiere autorización separada del usuario y expected-head SHA fresco.

Incluso después de integrar esta remediación, SQL/descriptor003, provider adapters, security promotion y runtime son tareas posteriores separadas. Ninguna se autoautoriza por este manifest.
