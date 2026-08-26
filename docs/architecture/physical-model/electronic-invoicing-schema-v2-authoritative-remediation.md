# PHY-G12 — Electronic Invoicing physical model V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_MATERIALIZED`.

Este contrato físico V2 alinea Electronic Invoicing con la propuesta V7 integrada por PR #4. Reemplaza las cláusulas anteriores incompatibles sobre reprepare, idempotencia de attempts y conservación de numeración. El historial Git conserva el contrato anterior como evidencia, pero este V2 es la referencia vigente para la futura migration 003.

No contiene DDL ni autoriza SQL003. Migrations 001/002 permanecen inmutables. Providers y security gates conservan sus estados actuales.

## 1. Ownership

`Electronic Invoicing` posee:

- `FiscalConnection`;
- `FiscalEmissionConfiguration` + versiones;
- `ElectronicDocument`;
- `FiscalDocumentPreparation`;
- `FiscalSubmissionAttempt`;
- `FiscalArtifact`;
- `FiscalIncident`;
- `FiscalReconciliation` + items;
- numeración aplicada a una preparación;
- evidencia y lifecycle fiscal.

`External Integrations` conserva `ExternalIntegration`, capabilities generales, routing, `IntegrationDispatch`, webhook receipt, credenciales referenciadas, rate limits y provider evidence. La extensión física que liga dispatch/receipt a una preparación está en `fiscal-integration-fence-schema.md` y es owned por migration 003 sin transferir ownership.

Tax continúa siendo owner del cálculo tributario. Sales/Payments/Inventory/Cash conservan ownership independiente.

## 2. Separación de identidad y preparación

La decisión central V2 es:

```text
ElectronicDocument
  = identidad lógica + lifecycle legal estable

FiscalDocumentPreparation
  = una generación concreta de configuración + snapshots + payload + numeración
```

Un documento puede tener varias preparaciones históricas **solo antes de exposición externa**. Solo una generation es actual. Esto permite cambiar una configuración inválida sin crear una segunda identidad fiscal y sin sobrescribir la preparación anterior.

`preparation_generation` comienza en 1 y aumenta exactamente una vez por `REPREPARE_BEFORE_SUBMISSION` confirmado. Un retry técnico no la cambia.

## 3. `ElectronicDocument`

Identidad candidata UUID v7. Campos conceptuales V2:

```text
electronic_document_id
tenant_id
company_id
branch_id
source_type
source_id
document_type
logical_operation_key
status
internal_reference
preparation_generation
provider_document_id nullable
provider_reference nullable
authority_reference nullable
legal_identifier nullable
provider_status_raw nullable
authority_status_raw nullable
uncertainty_reason nullable
original_electronic_document_id nullable
issued_at nullable
accepted_at nullable
rejected_at nullable
last_reconciled_at nullable
version
created_at
updated_at
```

`logical_operation_key`:

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

No usa source version, correction reference, configuración, importes, snapshots, checksum, numeración ni external IDs.

Estados:

- `DRAFT`;
- `READY`;
- `QUEUED`;
- `SUBMITTING`;
- `ACCEPTED`;
- `REJECTED`;
- `UNKNOWN_OUTCOME`;
- `CONTINGENCY`;
- `VOIDED_BEFORE_SUBMISSION`.

Reglas:

1. identidad/scope/source/type/logical key/original son inmutables;
2. external/provider/legal IDs son write-once;
3. ACCEPTED no se reabre ni borra;
4. UNKNOWN_OUTCOME exige reconciliation/evidence y bloquea reprepare;
5. `preparation_generation` solo cambia mediante reprepare elegible;
6. correctivos son nuevos ElectronicDocument con otra identidad source y referencia al original;
7. successor/replacement por invalidación pre-submission no existe en migration003 v1.

## 4. `FiscalDocumentPreparation`

Identidad candidata UUID v7 y generation monotónica por documento.

Campos conceptuales:

```text
fiscal_document_preparation_id
tenant_id
company_id
branch_id
electronic_document_id
preparation_generation
supersedes_preparation_id nullable
preparation_state
external_integration_id
fiscal_connection_id
fiscal_emission_configuration_id
emission_configuration_version_id
source_version
correction_source_reference nullable
currency
subtotal_amount
discount_amount
tax_amount
total_amount
tax_snapshot_reference
tax_snapshot_checksum
fiscal_emission_snapshot_reference
fiscal_emission_snapshot_checksum
canonical_payload_version
canonical_payload_checksum
numbering_mode
numbering_state
prefix nullable
number nullable
number_reserved_at nullable
number_consumed_at nullable
number_burned_at nullable
numbering_resolution_reason nullable
created_by_actor_id
frozen_at nullable
cancelled_at nullable
cancelled_by_actor_id nullable
cancellation_reason nullable
version
created_at
updated_at
```

Estados propios:

- `DRAFT`: material editable con CAS;
- `FROZEN`: payload/configuración congelados para READY/QUEUE/submission;
- `CANCELLED`: generación histórica invalidada antes de exposición.

Reglas:

1. `UNIQUE (tenant_id,electronic_document_id,preparation_generation)`;
2. generation 1 no tiene supersedes; generation N>1 referencia N-1 del mismo documento;
3. DRAFT puede cambiar source_version, correction reference, importes/snapshots/payload allowlisted;
4. FROZEN no cambia material/configuración;
5. CANCELLED es histórico e inmutable;
6. external integration/connection/config/version pertenecen a la preparación, no al documento estable;
7. toda evidence/attempt/artifact/dispatch se liga a la generation exacta;
8. la generación actual es la que coincide con `ElectronicDocument.preparation_generation`.

## 5. Numeración por preparación

La versión de configuración posee el rango/cursor. `FiscalDocumentPreparation` posee la asignación concreta de su generation.

Estados de numeración:

- `NOT_APPLICABLE`;
- `PENDING_EXTERNAL`;
- `RESERVED`;
- `CONSUMED`;
- `UNKNOWN_OUTCOME`;
- `RELEASED_WITHOUT_REUSE`;
- `BURNED`.

Principios:

- provider/authority assigned inicia sin número local;
- rango autorizado/contingencia asigna bajo lock de la versión y avanza cursor atómicamente;
- rollback antes del commit revierte reserva/cursor;
- después de una reserva durable, el par prefix/number jamás vuelve al pool;
- reprepare puede finalizar la generación anterior como RELEASED_WITHOUT_REUSE/BURNED según policy, preservando número y Audit;
- CONSUMED/UNKNOWN_OUTCOME/BURNED preexistente bloquea reprepare;
- retry usa la misma generación/número;
- ninguna columna del documento sobrescribe una numeración histórica.

## 6. `FiscalSubmissionAttempt`

Owner único del intento técnico fiscal.

Campos V2 relevantes:

```text
fiscal_submission_attempt_id
tenant_id
company_id
external_integration_id
fiscal_connection_id
electronic_document_id
fiscal_document_preparation_id
preparation_generation
integration_dispatch_id
operation_type
attempt_number
status
transport_status
normalized_result nullable
request_id
idempotency_key
request_checksum
provider_operation_id nullable
provider_correlation_reference nullable
provider_response_reference nullable
http_status nullable
provider_code_raw nullable
retry_classification nullable
error_code nullable
retry_after_at nullable
started_at nullable
completed_at nullable
correlation_id
causation_id nullable
version
created_at
```

`operation_type` físico v1: **solo `SUBMIT_DOCUMENT`**.

Estados: `CREATED|IN_PROGRESS|COMPLETED|FAILED|UNKNOWN_OUTCOME|CANCELLED`.

Transport: `NOT_SENT|SENT|RESPONSE_RECEIVED|UNKNOWN`.

Retry: `SAFE_RETRY|RECONCILE_REQUIRED|NON_RETRYABLE`.

Reglas:

1. attempt state != document legal state;
2. started_at significa inicio de ejecución, no ausencia/presencia de envío;
3. retry conserva document + preparation + dispatch + idempotency root;
4. attempt_number aumenta por dispatch bajo lock;
5. `UNIQUE (tenant_id,integration_dispatch_id,attempt_number)`;
6. `UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)`;
7. no existe unique por `(document,operation,idempotency_key)` porque la root se reutiliza en retries;
8. attempt root debe igualar dispatch root;
9. UNKNOWN_OUTCOME histórico no se reescribe.

## 7. Root de submission

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

Una preparation generation produce una intención dispatch. Un reprepare produce una generación/root nueva. Retry conserva root y crea otra ejecución.

`IntegrationDispatch.payload_checksum` debe corresponder al canonical payload checksum FROZEN. `FiscalSubmissionAttempt.request_checksum` puede representar el request provider-specific transformado y no redefine la root.

## 8. Artifacts y evidencia

`FiscalArtifact` referencia obligatoriamente:

- electronic document;
- fiscal document preparation;
- preparation generation;
- attempt cuando aplique.

Artifacts son insert-only. La existencia de cualquier artifact para la generation actual demuestra evidencia y bloquea reprepare.

`provider_document_id`, authority reference y legal identifier permanecen en ElectronicDocument porque, por definición, ninguna generación posterior puede crearse después de exposición. Solo la generación finalmente expuesta puede producirlos.

## 9. Reconciliation

`FiscalReconciliation` conserva sus estados separados y añade scope físico explícito:

- `DOCUMENT`: document + preparation_generation obligatorios;
- `CONNECTION`: document/generation NULL.

Migration003 v1 no materializa outbound status query. Reconciliation v1 consume:

- respuesta síncrona durable;
- webhook validado;
- artifacts/evidence ya recibidos;
- evidencia manual/autoridad revisada.

Un `DOCUMENT/RUNNING` sobre la generation actual bloquea reprepare. Un `CONNECTION/RUNNING` de la misma conexión bloquea conservadoramente.

Un `FiscalReconciliationItem` liga su evidencia a `fiscal_document_preparation_id + preparation_generation`. Evidencia tardía siempre afecta la generación histórica indicada, nunca la generación actual por timestamp.

## 10. Incidents

`FiscalIncident` conserva lifecycle `OPEN|IN_REVIEW|RESOLVED|ARCHIVED`. Cuando referencia documento, puede conservar `preparation_generation` para precisar qué generación originó la incidencia. Esa asociación es inmutable.

Un reprepare que no puede demostrar cero exposición falla cerrado y crea/relaciona incident/reconciliation según política; no fuerza otro documento.

## 11. `REPREPARE_BEFORE_SUBMISSION`

Command independiente de retry y operation_type.

Entrada mínima:

```text
electronic_document_id
expected_document_version
expected_preparation_generation
new integration/connection/config/version selection
reason
actor
correlation_id
causation_id
```

Estados permitidos del documento: `DRAFT|READY|QUEUED`.

Estados prohibidos: `SUBMITTING|ACCEPTED|REJECTED|UNKNOWN_OUTCOME|CONTINGENCY|VOIDED_BEFORE_SUBMISSION`.

Prueba bajo fence:

- current preparation/generation exactas;
- cero attempts;
- dispatch ausente o QUEUED sin claim;
- cero artifacts;
- cero receipt correlacionable en cualquier processing status;
- cero reconciliation aplicable RUNNING;
- cero provider/authority/legal IDs;
- cero transport/external effect evidence;
- numbering no CONSUMED/UNKNOWN_OUTCOME/BURNED antes del command.

Efecto atómico:

1. cancela dispatch QUEUED elegible;
2. cierra numeración anterior sin reuse si aplica;
3. cancela la preparación histórica;
4. incrementa document preparation_generation;
5. crea nueva preparación DRAFT con lineage;
6. revalida y rebind de integration/connection/config/version solo en la nueva preparación;
7. regenera snapshots/payload/checksum;
8. document vuelve DRAFT;
9. Audit/evento.

No existe fallback successor/replacement en V1.

## 12. Fence y concurrencia

Fence lógico:

```text
(tenant_id, electronic_document_id, preparation_generation)
```

Orden suffix:

```text
ElectronicDocument
-> FiscalDocumentPreparation
-> IntegrationDispatch
-> ExternalWebhookReceipt correlacionado
-> FiscalSubmissionAttempt
-> FiscalReconciliation
-> FiscalIncident
-> FiscalReconciliationItem
```

Operaciones que consumen capability/configuración usan primero el prefijo universal:

```text
ProviderCapabilityDeclaration
-> ProviderAdapterVersion
-> ExternalIntegration
-> IntegrationCapability
-> FiscalConnection
-> FiscalEmissionConfiguration
-> FiscalEmissionConfigurationVersion
```

Old/new resources del mismo nivel se toman en orden ascendente. HTTP siempre fuera de transaction.

Worker persiste claim/attempt antes de HTTP. Webhook correlacionable toma el fence antes de fijar linkage. Correlación tardía se liga a la generación histórica del dispatch.

## 13. Webhook cross-boundary

No se crea webhook fiscal paralelo. Migration003 extiende `ExternalWebhookReceipt` con referencias fiscales write-once según `fiscal-integration-fence-schema.md`.

Todo receipt correlacionado bloquea reprepare independientemente de `processing_status`. RECEIVED/PENDING/PROCESSING no son “cero exposición”. REJECTED/DEAD_LETTER tampoco demuestran ausencia del efecto externo.

## 14. Query/retrieve diferidos

Los puertos conceptuales `DocumentStatusQueryPort` y `DocumentArtifactPort` pueden existir como arquitectura futura, pero migration003 v1 no materializa `QUERY_DOCUMENT_STATUS` ni `RETRIEVE_ARTIFACT` como attempts/dispatches.

Antes de activarlos se exige contrato separado con capability, provider evidence, root, claim durable, rate limiting, UNKNOWN_OUTCOME, permisos y pruebas.

## 15. Seguridad y tenancy

- todas las tablas fiscales tenant-scoped;
- FKs tenant/company-aware;
- RLS FORCE;
- tenant request no es autoridad;
- cross-company/integration/generation falla;
- secrets fuera de tablas/logs/eventos;
- pos_app no escribe resultados provider;
- pos_worker no cambia identidad/preparation/configuración;
- platform admin read-only;
- artifacts/items no UPDATE/DELETE runtime.

SEC-G01..SEC-G10 siguen `PLANNED / NOT_EVALUATED` hasta evidencia ejecutable.

## 16. Local-first

PostgreSQL central es autoridad de acceptance externa y evidence. SQLite migration003 sigue `NONE`.

El POS local puede conservar operación/snapshot/outbox conforme a contratos existentes, pero no replica estas diez tablas ni inventa ACCEPTED/REJECTED. Una futura identidad fiscal offline requiere migration SQLite separada.

## 17. Pruebas de contrato mínimas

- create/replay vs DRAFT edit;
- reprepare DRAFT/READY/QUEUED;
- dispatch claim race;
- webhook pending race;
- reconciliation race;
- late evidence -> historical generation;
- same root across retries;
- root changes only by preparation generation;
- numbering history no overwrite/no reuse;
- cross-tenant/company/integration generation;
- UNKNOWN_OUTCOME fail-closed;
- query/retrieve absent from v1;
- migrations 001/002 unchanged;
- SQLite 003 absent;
- provider/security statuses unchanged.

## 18. Gate

Este modelo debe recibir review independiente junto con el manifest V2, UC-EINV-001 V2 y el contrato de fence. Solo un `AUTHORITATIVE_CONTRACT_REVIEW = PASS` puede habilitar una tarea posterior de SQL/descriptor 003. No se infiere autorización de DDL desde este documento.
