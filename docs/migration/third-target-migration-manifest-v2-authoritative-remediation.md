# INT-006 — manifest autoritativo de migration 003 Fiscal / Electronic Invoicing

## 1. Estado, autoridad y límite

Estado: `FISCAL-003-MANIFEST-V2 / AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento reemplaza como contrato vigente de migration 003 las decisiones físicas incompatibles del manifest histórico anterior. El historial Git conserva íntegramente las revisiones y remediaciones previas; no se reutilizan como autoridad cuando contradicen este V2.

Base contractual de esta remediación:

- PR #4 integrada en `main` mediante `bdc0f96323069de821e975737f19961fd16c3ccf`;
- propuesta V7 revisada sobre `c3ce923d16b0879264a43aa4b5830e19d57f7ad5`;
- `PROPOSAL_REVIEW = PASS`;
- Modelo A seleccionado exclusivamente: reprepare preservando el mismo `ElectronicDocument` y únicamente antes de exposición externa;
- successor/replacement excluido de migration 003 v1.

Este manifest sigue siendo `MANIFEST-ONLY`. No contiene DDL, SQL, descriptor ejecutable, cambios al runner, adapters, HTTP, credenciales, seeds ni evidencia real de proveedor. Su review no autoriza materialización. SQL 003, descriptor 003 y schema fiscal continúan ausentes hasta un gate posterior explícito.

Migrations 001 y 002 permanecen `MATERIALIZED / TESTED / IMMUTABLE`. Migration 003 es aditiva sobre 002 y puede extender objetos de `integrations` únicamente mediante objetos/columnas/constraints owned por 003; nunca modifica bytes históricos de SQL 001/002.

## 2. Decisiones no negociables

1. `ElectronicDocument` es la única identidad fiscal lógica.
2. `logical_operation_key` se calcula una vez con identidad estable y nunca cambia.
3. Una edición permitida de la misma preparación DRAFT no es un CREATE/replay nuevo.
4. `REPREPARE_BEFORE_SUBMISSION` conserva el mismo documento, incrementa `preparation_generation` exactamente una vez y crea una nueva `FiscalDocumentPreparation`.
5. Reprepare solo existe para `DRAFT|READY|QUEUED` y solo con prueba durable de cero exposición externa.
6. Cualquier `FiscalSubmissionAttempt`, claim externo, receipt correlacionable, artifact, identidad externa, `UNKNOWN_OUTCOME` o evidencia incierta bloquea reprepare.
7. Un dispatch `QUEUED` elegible se cancela en la misma transacción del reprepare; nunca se reutiliza.
8. La numeración de una generación anterior nunca se sobrescribe ni vuelve al pool. La historia queda en su `FiscalDocumentPreparation`.
9. Retry técnico no es reprepare: conserva documento, preparación, dispatch e idempotency root y crea un nuevo attempt.
10. Migration 003 v1 materializa exclusivamente `SUBMIT_DOCUMENT`. `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen `DESIGNED / NOT_MATERIALIZED / FAIL_CLOSED`.
11. `UNKNOWN_OUTCOME` permanece histórico y bloquea repetición ciega.
12. SQLite 003 permanece `NONE`.
13. Ningún provider ni `SEC-G01..SEC-G10` cambia de estado por este contrato.

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

No participan `source_version`, `correction_source_reference`, branch, importes, snapshots, configuración, payload checksum, prefix/number, provider/authority/legal IDs, estados o timestamps. `branch_id` se valida como scope, pero no entra mientras `source_id` sea globalmente estable dentro del contrato. Un source futuro sin esa garantía exige nueva versión de identidad.

Para correctivos, `source_id` identifica la operación correctiva estable y `original_electronic_document_id` participa en la key. `correction_source_reference` es material de preparación, no identidad.

Reglas CREATE/replay:

- misma key + mismo material al crear/preparar: resolución idempotente al mismo documento;
- intento de segunda fila con misma key + material incompatible: `CONFLICT`;
- UPDATE autorizado de la preparación DRAFT actual: puede cambiar material allowlisted con CAS y recalcular checksum;
- desde `READY` la preparación queda congelada; para cambiar configuración/material se requiere reprepare elegible.

### 3.2 Root provider-facing de submission

Cada preparación tiene exactamente una intención provider-facing `SUBMIT_DOCUMENT`:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

El checksum no forma parte de la root. Repetir la misma root con checksum distinto es `CONFLICT`.

Para todo retry de esa preparación:

```text
FiscalSubmissionAttempt.idempotency_key
== IntegrationDispatch.idempotency_key
```

`attempt_number`, `id`, `request_id` y `request_checksum` identifican la ejecución técnica, no una intención nueva.

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

La décima tabla no es un segundo documento ni un status history genérico. Es la representación durable de cada preparación del mismo `ElectronicDocument`, necesaria para conservar configuración, payload y numeración entre reprepares sin overwrite.

Extensiones owned por 003 sobre `integrations`:

- candidate/constraint fiscal de capabilities ya previsto para `DEBIT_NOTES`;
- transición final de `IntegrationDispatch.dispatch_class`;
- vínculo de `IntegrationDispatch` con la preparación fiscal;
- correlación fiscal write-once de `ExternalWebhookReceipt` con documento, preparación, generación y dispatch.

No se materializan tablas de TaxIdentity, FiscalCertificate, NumberingRange, webhook fiscal paralelo, provider-specific metadata ni blobs fiscales PostgreSQL.

## 5. Convenciones comunes

- PostgreSQL 16, schema `fiscal`, owner `pos_schema_owner`, PUBLIC revocado.
- UUID v7 para PK; `tenant_id NOT NULL`; FKs tenant/company-aware y `ON DELETE NO ACTION`.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en las diez tablas.
- No enums nativos PostgreSQL; estados cerrados usan `text + CHECK`.
- checksums SHA-256 lowercase 64 hex; dinero `numeric(19,6)`; tiempo `timestamptz`; moneda `char(3)` uppercase.
- Sin `GRANT ALL`, hard delete runtime ni cascade destructivo.
- `btree_gist` sigue dependencia compartida PREEXISTING/non-destructive.
- Todas las transiciones usan CAS/version; timestamps nunca deciden concurrencia.
- Secrets, tokens, private keys y payloads fiscales completos permanecen fuera de tablas de negocio.

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

Corporativa, sin `branch_id`. Vigencia, integración y capability determinan elegibilidad. Provider, environment, credential y health permanecen en External Integrations.

Candidate keys: `(tenant_id,id)`, `(tenant_id,company_id,id)`, `(tenant_id,company_id,external_integration_id,id)`. Exclusion temporal por tenant/company/integration impide perfiles solapados.

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
id, tenant_id, company_id, branch_id, scope_type
fiscal_connection_id, external_integration_id
fiscal_emission_configuration_id, document_type
version_number, status
issuer_tax_id_normalized_snapshot, issuer_legal_name_snapshot
authorization_reference
numbering_policy_code, prefix
number_range_start, number_range_end, next_number_value
numbering_exhausted_at, provider_numbering_reference
certificate_reference, contingency_policy_reference
fiscal_capabilities_snapshot_reference
fiscal_capabilities_snapshot_checksum
configuration_schema_version, configuration_checksum
valid_from, valid_until, published_at
supersedes_version_id
created_by_actor_id, published_by_actor_id
created_at, updated_at, row_version
```

Estados: `DRAFT|PUBLISHED|SUPERSEDED|REVOKED`. El material publicado es inmutable excepto cursor/agotamiento de numeración bajo lock. `numbering_policy_code`: `PROVIDER_ASSIGNED|AUTHORITY_ASSIGNED|AUTHORIZED_RANGE|LOCAL_CONTINGENCY`.

### 6.4 `fiscal.electronic_documents`

`ElectronicDocument` contiene **identidad estable y lifecycle legal**, no la copia mutable de cada preparación:

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
provider_document_id text NULL
provider_reference text NULL
authority_reference text NULL
legal_identifier text NULL
provider_status_raw text NULL
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

Estados: `DRAFT|READY|QUEUED|SUBMITTING|ACCEPTED|REJECTED|UNKNOWN_OUTCOME|CONTINGENCY|VOIDED_BEFORE_SUBMISSION`.

`UNIQUE (tenant_id,company_id,logical_operation_key)`. Identidades provider/authority/legal son write-once. `preparation_generation >= 1` y solo aumenta mediante `REPREPARE_BEFORE_SUBMISSION`; retries no la cambian.

### 6.5 `fiscal.fiscal_document_preparations`

Owner de material, configuración y numeración **por generación**:

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
electronic_document_id uuid NOT NULL
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
created_by_actor_id uuid NOT NULL
frozen_at timestamptz NULL
cancelled_at timestamptz NULL
cancelled_by_actor_id uuid NULL
cancellation_reason text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL DEFAULT 1
```

`preparation_state = DRAFT|FROZEN|CANCELLED`.

Unicidades/candidates mínimas:

- `UNIQUE (tenant_id,electronic_document_id,preparation_generation)`;
- candidate tenant/company/document/id;
- self-FK `supersedes_preparation_id` al generation anterior del mismo documento;
- unique parcial legal por company/config/type/prefix/number cuando exista, conservando filas CANCELLED para impedir reuse.

Reglas:

- solo la generación cuyo número coincide con `ElectronicDocument.preparation_generation` puede ser actual;
- material cambia solo mientras `preparation_state='DRAFT'` y documento `DRAFT`;
- `FROZEN` es inmutable salvo lifecycle de numeración write-once y cancelación permitida por reprepare;
- `CANCELLED` es histórico e inmutable;
- una asignación local durable nunca se borra; al reprepare pasa a `RELEASED_WITHOUT_REUSE|BURNED` según policy, con razón/Audit;
- `CONSUMED|UNKNOWN_OUTCOME` y un `BURNED` preexistente hacen el reprepare inelegible;
- para modalidad remota sin número, una preparación cancelada puede conservar `PENDING_EXTERNAL` sin inventar un número.

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

Estados: `CREATED|IN_PROGRESS|COMPLETED|FAILED|UNKNOWN_OUTCOME|CANCELLED`.

`operation_type` v1 es **exactamente `SUBMIT_DOCUMENT`**.

Unicidades:

- `UNIQUE (tenant_id,integration_dispatch_id,attempt_number)`;
- `UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)`.

Queda **eliminada** la antigua uniqueness `(tenant_id,electronic_document_id,operation_type,idempotency_key)`, porque impedía retries con root estable. Un guard verifica que la root del attempt sea exactamente la del dispatch y que documento/preparación/generation coincidan.

Timestamps:

- CREATED: started/completed NULL;
- IN_PROGRESS fija `started_at` una vez;
- COMPLETED/FAILED/UNKNOWN_OUTCOME exigen completed_at;
- CANCELLED desde CREATED puede mantener started_at NULL.

`started_at` nunca prueba no-envío.

Transport: `NOT_SENT|SENT|RESPONSE_RECEIVED|UNKNOWN`. Retry classification: `SAFE_RETRY|RECONCILE_REQUIRED|NON_RETRYABLE`. `SAFE_RETRY` exige evidencia durable/conclusiva; HTTP code, timeout o excepción aislados nunca bastan.

### 6.7 `fiscal.fiscal_artifacts`

Añade vínculo de generación:

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

Insert-only. Cualquier artifact correlacionado demuestra evidencia de la generación y bloquea reprepare de esa generación.

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

`scope_type = DOCUMENT|CONNECTION`. DOCUMENT exige documento+generation; CONNECTION los prohíbe. Estados conservan el catálogo previo.

Migration 003 v1 **no autoriza HTTP de query/status**. Reconciliation v1 incorpora respuesta síncrona ya recibida, webhook validado, evidencia manual/autoridad y artifacts existentes. Un futuro outbound query requiere contrato/capability/migration separados con claim durable antes de HTTP.

Un reconciliation DOCUMENT `RUNNING` de la generación actual bloquea reprepare. Un reconciliation CONNECTION `RUNNING` de la misma conexión bloquea conservadoramente mientras no exista un scope físico más estrecho.

### 6.9 `fiscal.fiscal_incidents`

Conserva el contrato previo y agrega `preparation_generation bigint NULL` cuando existe `electronic_document_id`. La generación no puede cambiar después del INSERT. Estados: `OPEN|IN_REVIEW|RESOLVED|ARCHIVED`.

### 6.10 `fiscal.fiscal_reconciliation_items`

Conserva comparación append-only y agrega:

```text
fiscal_document_preparation_id uuid NOT NULL
preparation_generation bigint NOT NULL
```

La evidencia observada queda ligada a la generación histórica exacta y nunca se reasigna a la preparación actual.

## 7. Extensión 003 sobre External Integrations

El contrato exacto está en `physical-model/fiscal-integration-fence-schema.md`.

### IntegrationDispatch

Migration 003 agrega, solo para `FISCAL`:

```text
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
```

FISCAL exige ambos y `internal_entity_type='ElectronicDocument'`; NON_FISCAL exige ambos NULL. La FK scoped demuestra que dispatch, documento y preparación pertenecen a tenant/company/integration/generation coherentes.

El `payload_checksum` del dispatch fiscal corresponde al canonical payload checksum de la preparación congelada. El root usa la fórmula de §3.2.

### ExternalWebhookReceipt

Migration 003 agrega correlación fiscal write-once:

```text
fiscal_electronic_document_id uuid NULL
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
fiscal_integration_dispatch_id uuid NULL
fiscal_correlated_at timestamptz NULL
```

Para una correlación fiscal, el conjunto es all-or-none y las FKs scoped apuntan al dispatch/preparación históricos. Una vez fijado no puede cambiar de documento ni generation.

**Todo receipt fiscal correlacionable bloquea reprepare sin importar `processing_status`**, incluso si aún no fue procesado o terminó rechazado/dead-letter. La existencia durable del receipt es evidencia externa; su estado de procesamiento no demuestra cero exposición.

## 8. Fence canónico de preparación

El fence no es una tabla adicional. Se implementa como protocolo de locks sobre el `ElectronicDocument` y la `FiscalDocumentPreparation` exacta, validando `preparation_generation`.

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
-> ExternalWebhookReceipt correlacionado
-> FiscalSubmissionAttempt
-> FiscalReconciliation
-> FiscalIncident
-> FiscalReconciliationItem
```

Dentro de un mismo nivel, UUID/código ascendente. Cuando un reprepare cambia integración/configuración, bloquea **todos los recursos old+new del mismo nivel en orden ascendente** antes de avanzar al siguiente nivel. Ningún actor invierte el orden.

HTTP ocurre siempre fuera de la transacción.

### Worker de submission

Antes de cualquier HTTP:

1. revalida capability/configuración;
2. bloquea documento y preparación esperada;
3. comprueba generation del dispatch;
4. reclama dispatch;
5. inserta `FiscalSubmissionAttempt` CREATED y lo lleva a IN_PROGRESS conforme al contrato;
6. persiste claim/lease durable;
7. commit;
8. solo entonces ejecuta HTTP.

Así, la existencia del attempt/claim hace fallar la prueba de cero exposición de un reprepare concurrente.

### Webhook

Si el webhook puede correlacionarse antes de persistir, toma el fence y se inserta ya ligado a documento/preparación/generation. Si llega no correlacionado, se conserva como receipt general 002; una correlación posterior toma el fence, resuelve el dispatch histórico y fija los campos fiscales write-once. Nunca se mueve un receipt de una generación histórica a la actual.

### Reconciliation/query

V1 no inicia query HTTP. Una reconciliation local/inbound usa el fence documental al aplicar evidencia. `QUERY_DOCUMENT_STATUS` y cualquier claim de consulta externa quedan fuera de V1; su futura materialización deberá demostrar claim durable antes de HTTP y compatibilidad con este mismo fence.

## 9. `REPREPARE_BEFORE_SUBMISSION`

Es un command de aplicación, no un `operation_type` fiscal y no un retry.

### 9.1 Estados permitidos

Solo `DRAFT|READY|QUEUED`.

Se rechaza en `SUBMITTING|ACCEPTED|REJECTED|UNKNOWN_OUTCOME|CONTINGENCY|VOIDED_BEFORE_SUBMISSION`.

### 9.2 Prueba durable de cero exposición

Bajo el fence, debe cumplirse simultáneamente:

- current preparation coincide con `ElectronicDocument.preparation_generation`;
- cero `FiscalSubmissionAttempt` para documento/generation;
- dispatch ausente o exactamente `QUEUED`, sin claim/lease y sin attempt;
- cero provider/authority/legal identifiers en el documento;
- cero artifacts para la preparación;
- cero `ExternalWebhookReceipt` correlacionado a esa preparación, en cualquier estado;
- cero reconciliation DOCUMENT RUNNING para documento/generation;
- cero reconciliation CONNECTION RUNNING en la conexión afectada;
- cero transport/effect evidence;
- `numbering_state` actual no es `CONSUMED|UNKNOWN_OUTCOME|BURNED` antes de iniciar el command;
- ninguna evidencia externa o de autoridad es incierta.

Si cualquier prueba no es concluyente, falla cerrado y abre/relaciona incident/reconciliation; jamás presume no-envío.

### 9.3 Efecto atómico

1. Si existe dispatch QUEUED elegible, pasa a `CANCELLED` en la misma transacción.
2. Si existe número reservado, la preparación anterior conserva prefix/number y pasa a `RELEASED_WITHOUT_REUSE|BURNED` según policy, con razón/Audit; el cursor jamás retrocede.
3. La preparación anterior pasa a `CANCELLED`, conservando todos sus campos históricos.
4. `ElectronicDocument.preparation_generation` aumenta exactamente en 1.
5. Se crea nueva `FiscalDocumentPreparation` DRAFT con `supersedes_preparation_id` a la anterior.
6. Solo esa nueva preparación puede rebindear `external_integration_id`, `fiscal_connection_id`, `fiscal_emission_configuration_id` y `emission_configuration_version_id` después de revalidar cadena old+new, precedencia BRANCH>COMPANY y capabilities.
7. Se regeneran snapshots, canonical payload y checksums en la nueva preparación.
8. El documento vuelve a `DRAFT`; luego el flujo ordinario valida/congela a READY.
9. `logical_operation_key`, tenant/company/branch, source identity, document type, original document y causalidad permanecen inmutables.
10. Audit/eventos conservan actor, motivo, old/new generation, correlation y causation.

Un cambio ordinario de material allowlisted de la preparación DRAFT **no** incrementa generation. Solo el command reprepare confirmado lo hace.

## 10. Numeración

El rango/cursor sigue owned por `FiscalEmissionConfigurationVersion`. La asignación concreta por documento/generation vive en `FiscalDocumentPreparation`.

- PROVIDER_ASSIGNED/AUTHORITY_ASSIGNED: preparación inicia `PENDING_EXTERNAL`; sin número antes de respuesta.
- AUTHORIZED_RANGE/LOCAL_CONTINGENCY: lock exacto del owner, asignación + avance cursor + preparación `RESERVED` en una transacción.
- al preparar exposición, reserva local pasa a `CONSUMED` conforme a política antes de HTTP o representación externa;
- rollback antes del commit revierte reserva/cursor;
- después de reserva durable cancelada por reprepare, el número queda `RELEASED_WITHOUT_REUSE|BURNED`, nunca vuelve al cursor;
- `UNKNOWN_OUTCOME` impide liberar, reprepare o nueva asignación automática;
- retry conserva la misma preparación y numeración.

La historia de numeración ya no depende de sobrescribir columnas del documento ni exclusivamente de Audit.

## 11. Capability y operation scope V1

El mapping documental sigue:

- ELECTRONIC_SALES_INVOICE -> ELECTRONIC_INVOICING;
- CREDIT_NOTE -> CREDIT_NOTES;
- DEBIT_NOTE -> DEBIT_NOTES;
- SUPPORT_DOCUMENT / SUPPORT_DOCUMENT_ADJUSTMENT -> SUPPORT_DOCUMENTS.

La cadena de declaración/adapter/integration/capability/configuración se revalida bajo lock en prepare, freeze, enqueue, reprepare y worker claim.

`FiscalSubmissionAttempt.operation_type` solo acepta `SUBMIT_DOCUMENT` en V1.

Quedan fuera:

- `QUERY_DOCUMENT_STATUS`;
- `RETRIEVE_ARTIFACT`.

No se simulan con `SUBMIT_DOCUMENT`, no se materializan como dispatch fiscal y no se anuncian como provider support.

## 12. Downgrade y revalidación

Downgrade/retiro conserva el prefijo de locks existente y bloquea operaciones nuevas. Documentos históricos no se reescriben.

Para un documento no expuesto:

- DRAFT puede continuar solo si la preparación sigue válida; si requiere otra cadena, usa `REPREPARE_BEFORE_SUBMISSION`;
- READY/QUEUED invalidado queda bloqueado y solo puede volver a DRAFT mediante reprepare elegible;
- QUEUED exige dispatch todavía QUEUED/unclaimed y cancelación atómica;
- si existe attempt, claim, receipt, artifact, external identity, UNKNOWN_OUTCOME o evidencia incierta, reprepare está prohibido.

No existe successor/replacement automático en V1.

## 13. RLS, grants y guards

Las diez tablas reciben RLS FORCE. `pos_platform_admin` permanece read-only; `pos_platform_app` no recibe DML fiscal; `pos_reporting` y PUBLIC no reciben acceso.

### ElectronicDocument

`pos_app` puede INSERT la identidad inicial y UPDATE lifecycle de preparación, incluido `preparation_generation`, **solo** mediante guards que demuestren el protocolo reprepare. No puede escribir identidades provider/authority/legal.

`pos_worker` puede SELECT y actualizar únicamente lifecycle/evidencia externa allowlisted; nunca cambia logical key, source, original document o generation.

### FiscalDocumentPreparation

`pos_app` puede INSERT y editar material solo en DRAFT; puede congelar/cancelar y finalizar numeración previa únicamente bajo guards/locks del command. No puede reescribir una generación CANCELLED.

`pos_worker` puede SELECT FROZEN y actualizar únicamente numeración/evidencia write-once requerida por el resultado externo; no cambia configuración, payload, generation ni material congelado.

### FiscalSubmissionAttempt

Solo `pos_worker` inserta y actualiza lifecycle técnico. Identidad, preparación, dispatch, operation, attempt number, request, root, checksum y correlation son inmutables.

### Artifacts/items

Insert-only; no UPDATE/DELETE runtime.

### Integrations extensions

Los campos fiscales de dispatch/receipt son owned por 003, con grants mínimos y guards write-once. Una columna futura no recibe grant por defecto.

Guards nuevos/cambiados mínimos:

```text
electronic_documents_reprepare_guard
fiscal_document_preparations_insert_guard
fiscal_document_preparations_update_guard
fiscal_document_preparations_state_guard
fiscal_document_preparations_numbering_guard
fiscal_submission_attempts_root_guard
integration_dispatches_fiscal_preparation_guard
external_webhook_receipts_fiscal_correlation_guard
```

Los guards existentes se reconcilian con esta lista y no pueden preservar reglas contradictorias del V1 histórico.

## 14. Candidate keys y constraints críticas

Además de PK/candidates tenant-aware:

- `electronic_documents_logical_operation_uq = UNIQUE (tenant_id,company_id,logical_operation_key)`;
- `fiscal_document_preparations_generation_uq = UNIQUE (tenant_id,electronic_document_id,preparation_generation)`;
- legal numbering unique cubre también preparaciones CANCELLED para impedir reuse;
- `fiscal_submission_attempts_dispatch_history_uq = UNIQUE (tenant_id,integration_dispatch_id,attempt_number)`;
- `fiscal_submission_attempts_document_history_uq = UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)`;
- **no existe** `fiscal_submission_attempts_idempotency_uq` por root estable;
- dispatch fiscal referencia preparación exacta;
- receipt correlacionado referencia preparación/dispatch exactos;
- artifact/item referencia preparation generation exacta.

Todas las relaciones cross-scope fallan cerrado.

## 15. Apply order normativo

1. lock global y verificar 001/002 APPLIED + checksums/catalogs exactos;
2. ejecutar MAT-003 preflight histórico read-only completo;
3. cualquier blocker -> `BLOCKED`, cero mutaciones 003;
4. verificar `btree_gist` shared;
5. crear schema `fiscal` y revocar PUBLIC;
6. ampliar aditivamente DEBIT_NOTES/candidate key/guards owned por 003 sin insertar datos;
7. crear connections/configurations/configuration_versions;
8. crear `electronic_documents`;
9. crear `fiscal_document_preparations` y constraints de generation/numeración;
10. crear attempts, artifacts, reconciliations, incidents e items;
11. extender `integration_dispatches` con vínculo de preparación y mantener FISCAL todavía bloqueado por constraint 002;
12. extender `external_webhook_receipts` con correlación fiscal write-once;
13. instalar FKs, guards, índices, RLS/policies y grants exactos;
14. ejecutar introspection/smoke pre-enable;
15. crear/validar constraint final 003 mientras 002 aún bloquea FISCAL;
16. retirar `integration_dispatches_dispatch_class_002_ck` como último cambio estructural;
17. commit;
18. smoke con roles reales y finalización ledger según descriptor futuro.

No existe commit intermedio con dispatch FISCAL sin preparación/attempt owner.

## 16. Down order y protección

Down 003 solo en fresh/test explícitamente autorizado, catálogo exacto, cero historia fiscal y cero dispatch/receipt correlation fiscal. Producción con historia queda bloqueada.

Orden:

1. lock y elegibilidad;
2. restaurar constraint exacto 002 y retirar guard/constraint final 003;
3. retirar correlación fiscal de webhook y vínculo fiscal de dispatch después de validar cero filas dependientes;
4. revocar grants/policies/guards/índices 003;
5. drop reconciliation_items;
6. incidents;
7. reconciliations;
8. artifacts;
9. submission_attempts;
10. document_preparations;
11. electronic_documents;
12. configuration_versions;
13. configurations;
14. connections;
15. retirar DEBIT_NOTES/candidate/guards owned por 003;
16. eliminar schema fiscal solo vacío;
17. validar 001/002 intactas y registrar ROLLED_BACK sin borrar ledger history.

Nunca elimina `btree_gist`, objetos 001/002, Audit ni secretos/evidence externos.

## 17. Índices mínimos

Además de índices de FK y uniques:

- documents por tenant/company/source y por status de trabajo;
- preparations por document/generation, integration/connection y numbering legal;
- attempts por dispatch, document+generation y UNKNOWN_OUTCOME;
- artifacts por document+generation/type;
- reconciliations por status y document/generation/connection;
- incidents por estado/severity/document/generation;
- webhook receipt correlation por `(tenant_id,company_id,fiscal_electronic_document_id,fiscal_preparation_generation)` parcial;
- dispatch fiscal preparation por `(tenant_id,company_id,internal_entity_id,fiscal_preparation_generation)` parcial.

Índices adicionales requieren query path y validación post-materialización con `EXPLAIN (ANALYZE, BUFFERS)`.

## 18. Pruebas obligatorias antes de autorizar SQL

### Contrato/reprepare

1. CREATE/replay same key/same material idempotente;
2. segunda fila same key/different material = CONFLICT;
3. DRAFT edit autorizado no incrementa generation;
4. READY reprepare elegible crea generation+1 y conserva documento;
5. QUEUED unclaimed se cancela atómicamente;
6. dispatch claimed bloquea;
7. cualquier attempt bloquea, incluso NOT_SENT/FAILED;
8. UNKNOWN_OUTCOME bloquea;
9. provider/authority/legal ID bloquea;
10. artifact bloquea;
11. receipt correlacionado RECEIVED/PENDING/PROCESSING/PROCESSED/RETRY_SCHEDULED/DEAD_LETTER/REJECTED bloquea;
12. reconciliation RUNNING aplicable bloquea;
13. dos reprepares concurrentes producen un ganador CAS;
14. webhook correlation vs reprepare produce un solo ganador y conserva generation histórica;
15. worker claim vs reprepare produce un solo ganador;
16. old/new integrations se bloquean en orden sin deadlock.

### Idempotencia/retry

17. mismo dispatch/generation admite attempts 1..N con la misma root;
18. duplicate attempt_number falla;
19. misma root + dispatch payload checksum diferente falla;
20. attempt root distinta a dispatch falla;
21. operation_type distinta de SUBMIT_DOCUMENT falla;
22. retry no incrementa generation ni cambia numeración;
23. UNKNOWN_OUTCOME histórico no se reescribe.

### Numeración

24. historial de generation anterior permanece consultable;
25. número RELEASED_WITHOUT_REUSE/BURNED no puede asignarse a otra generation/document;
26. cursor no retrocede por reprepare;
27. asignación concurrente produce números distintos;
28. rollback previo al commit revierte cursor;
29. remote PENDING_EXTERNAL puede cancelarse sin inventar número;
30. CONSUMED/UNKNOWN_OUTCOME/BURNED preexistente bloquea reprepare.

### Scope/security

31. cross-tenant/company/integration/preparation rechazado;
32. RLS FORCE para diez tablas;
33. worker no inserta documento/preparación;
34. app no escribe resultados provider/attempt;
35. admin read-only;
36. secrets ausentes de logs/tablas;
37. campos de correlación receipt son write-once;
38. receipt no correlacionado nunca se reasigna arbitrariamente.

### Regression

39. migrations/validators 001 y 002 siguen PASS;
40. MAT-003 preflight sigue PASS/BLOCKED/FAIL fail-closed;
41. SQLite 003 sigue NONE;
42. providers y SEC-G mantienen estado;
43. query/retrieve no aparecen en catálogo físico v1;
44. enablement FISCAL sigue siendo último cambio estructural;
45. down 003 con historia/evidence queda bloqueado.

## 19. Descriptor futuro

Solo después de review autoritativo PASS podrá diseñarse/materializarse un descriptor 003. Deberá declarar diez tablas fiscales y las extensiones 003 sobre `integrations`, dependencias exactas 002, owned constraints/indexes/guards/policies y hashes del SQL finalmente aprobado.

No se duplicarán listas divergentes entre descriptor, introspection y tests.

## 20. Estado de providers, seguridad y local-first

- SIIGO / FACTUS / ALEGRA: `DESIGNED / NOT_EVALUATED`;
- THE_FACTORY_HKA / ODOO: `FUTURE / NOT_IMPLEMENTED / NOT_EVALUATED`;
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`;
- SQLite migration 003: `NONE`;
- runtime fiscal: `NOT_MATERIALIZED`;
- SQL 003 / descriptor 003 / schema fiscal: `ABSENT`.

La ausencia de provider query v1 significa que un `UNKNOWN_OUTCOME` puede permanecer en revisión/manual evidence hasta que exista un capability contract de consulta autorizado. Eso es deliberadamente fail-closed y no se reemplaza por retry ciego.

## 21. Gate siguiente

Esta remediación autoritativa debe recibir:

1. CI fresco sobre su HEAD exacto;
2. revisión independiente contra la propuesta V7 y contratos 001/002;
3. cero BLOCKER/HIGH/MEDIUM abiertos;
4. reconciliación de backlog/PR.

Solo `AUTHORITATIVE_CONTRACT_REVIEW = PASS` habilita una tarea posterior y separada para **diseñar/materializar** SQL/descriptor 003. Ese PASS no será inferido ni autoasignado por este documento.
