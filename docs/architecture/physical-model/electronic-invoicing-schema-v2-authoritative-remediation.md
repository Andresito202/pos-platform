# PHY-G12 — Electronic Invoicing physical model V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_MATERIALIZED`.

Este contrato físico V2 alinea Electronic Invoicing con la propuesta V7 integrada por PR #4 y con el cierre físico normativo de `docs/migration/sql003-authoritative-contract-remediation-index.md` §4. Reemplaza las cláusulas anteriores incompatibles sobre reprepare, idempotencia de attempts, ubicación de identidad provider y conservación de numeración.

No contiene DDL ni autoriza SQL003. Migrations 001/002 permanecen inmutables. Providers y security gates conservan sus estados actuales. Cuando una cláusula física no esté repetida aquí, el índice normativo prevalece; este overlay no puede interpretarse para introducir leases V1, provider identity sin integration scope ni namespaces de reuse de numeración.

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
  = una generación concreta de configuración + snapshots + payload
    + numeración + provider identity scoped
```

Un documento puede tener varias preparaciones históricas **solo antes de exposición externa**. Solo una generation es actual. Esto permite cambiar una configuración inválida sin crear una segunda identidad fiscal y sin sobrescribir la preparación anterior.

`preparation_generation` comienza en 1 y aumenta exactamente una vez por `REPREPARE_BEFORE_SUBMISSION` confirmado. Un retry técnico no la cambia.

No existe `current_preparation_id`. La futura migration 003 debe materializar dos constraint triggers table-local `DEFERRABLE INITIALLY DEFERRED` —uno sobre `ElectronicDocument` y otro sobre `FiscalDocumentPreparation`— que invocan el mismo validador de current generation al commit.

## 3. `ElectronicDocument`

Identidad candidata UUID v7. Campos conceptuales V2:

```text
id
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
authority_reference nullable
legal_identifier nullable
authority_status_raw nullable
uncertainty_reason nullable
original_electronic_document_id nullable
issued_at nullable
accepted_at nullable
rejected_at nullable
last_reconciled_at nullable
created_at
updated_at
version
```

**No se materializan en `ElectronicDocument` V2:**

```text
provider_document_id
provider_reference
provider_status_raw
```

Esos tres campos pertenecen a `FiscalDocumentPreparation`, donde existe `external_integration_id` y por tanto scope provider inequívoco.

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
2. `authority_reference` y `legal_identifier` son write-once con evidence autoritativa;
3. `authority_status_raw` es proyección sanitizada respaldada por evidence y no sustituye historia;
4. ACCEPTED no se reabre ni borra;
5. UNKNOWN_OUTCOME exige reconciliation/evidence y bloquea reprepare/retry ciego;
6. `preparation_generation` solo cambia mediante reprepare elegible y nunca decrementa;
7. correctivos son nuevos ElectronicDocument con otra identidad source y referencia al original;
8. successor/replacement por invalidación pre-submission no existe en migration003 v1;
9. candidate física adicional `(tenant_id,company_id,id,document_type)` permite demostrar que la preparation conserva el mismo document_type.

## 4. `FiscalDocumentPreparation`

Identidad UUID v7 y generation monotónica por documento.

Campos conceptuales:

```text
id
tenant_id
company_id
branch_id
electronic_document_id
document_type
preparation_generation
supersedes_preparation_id nullable
preparation_state
external_integration_id
fiscal_connection_id
fiscal_emission_configuration_id
emission_configuration_version_id
source_version
correction_source_reference nullable
currency_code
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
provider_document_id nullable
provider_reference nullable
provider_status_raw nullable
created_by_actor_id
frozen_at nullable
cancelled_at nullable
cancelled_by_actor_id nullable
cancellation_reason nullable
created_at
updated_at
version
```

Estados propios:

- `DRAFT`: material editable con CAS;
- `FROZEN`: payload/configuración congelados para READY/QUEUE/submission;
- `CANCELLED`: generación histórica invalidada antes de exposición, salvo enriquecimiento estricto de late evidence provider-specific.

Candidate keys/uniques normativos mínimos:

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

Reglas:

1. generation 1 no tiene supersedes; generation N>1 referencia exactamente N-1 del mismo documento;
2. DRAFT puede cambiar source_version, correction reference, importes/snapshots/payload allowlisted con CAS;
3. FROZEN no cambia material/configuración;
4. integration/connection/config/version/document/type/generation/lineage son inmutables para una fila;
5. CANCELLED conserva historia y no se reactiva;
6. external integration/connection/config/version pertenecen a la preparación, no al documento estable;
7. toda evidence/attempt/artifact/dispatch se liga a la generation exacta;
8. la generación actual es la que coincide con `ElectronicDocument.preparation_generation`;
9. `provider_document_id` y `provider_reference` son write-once cuando aparecen;
10. `provider_status_raw` es una proyección sanitizada técnicamente mutable solo por evidence append-only correlacionada;
11. cualquier provider identity/status en la current generation bloquea reprepare;
12. late evidence de una CANCELLED solo puede enriquecer provider fields de esa generation bajo `late_evidence_guard`; no cambia numeración, config, snapshots, payload, lifecycle ni lineage.

## 5. Integridad de current generation

La relación current no se resuelve con un pointer duplicado. Al commit debe probarse:

1. `ElectronicDocument.preparation_generation >= 1`;
2. existe exactamente una preparation con esa `(tenant_id,electronic_document_id,generation)`;
3. no existe una preparation con generation mayor;
4. current preparation coincide en tenant/company/branch/document_type;
5. N>1 tiene predecessor N-1;
6. document generation solo aumenta exactamente uno mediante el guard de reprepare.

Se materializan conceptualmente:

```text
electronic_documents_current_preparation_guard
  ON fiscal.electronic_documents

fiscal_document_preparations_current_generation_guard
  ON fiscal.fiscal_document_preparations

shared validator:
  validate_current_fiscal_preparation_invariant(tenant_id,electronic_document_id)
```

Ambos son PostgreSQL `AFTER ROW CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` y leen el estado final de la transacción.

## 6. Numeración por preparación

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

### No-reuse legal V1

Configuración, conexión, provider y document type **no abren un namespace nuevo** para reutilizar numeración durable. La defensa conservadora es a nivel de emisor:

```text
UNIQUE logical index over
(tenant_id, company_id, COALESCE(prefix,''), number)
WHERE number IS NOT NULL
```

Una fila CANCELLED sigue participando. `prefix` no nulo no puede ser vacío; NULL representa ausencia real. Si una futura norma demuestra namespaces legalmente independientes, requiere versión contractual y migration explícita.

Provider identity tiene namespace de integración:

```text
UNIQUE logical index over
(tenant_id, external_integration_id, provider_document_id)
WHERE provider_document_id IS NOT NULL
```

## 7. `FiscalSubmissionAttempt`

Owner único del intento técnico fiscal.

Campos V2 relevantes:

```text
id
tenant_id
company_id
external_integration_id
fiscal_connection_id
electronic_document_id
fiscal_document_preparation_id
preparation_generation
integration_dispatch_id
dispatch_class
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
created_at
version
```

`dispatch_class='FISCAL'`. `operation_type` físico v1: **solo `SUBMIT_DOCUMENT`**.

Estados: `CREATED|IN_PROGRESS|COMPLETED|FAILED|UNKNOWN_OUTCOME|CANCELLED`.

Transport: `NOT_SENT|SENT|RESPONSE_RECEIVED|UNKNOWN`.

Retry: `SAFE_RETRY|RECONCILE_REQUIRED|NON_RETRYABLE`.

Reglas:

1. attempt state != document legal state;
2. `started_at` significa inicio de ejecución, no ausencia/presencia de envío;
3. retry conserva document + preparation + dispatch + idempotency root + internal operation identity;
4. attempt_number aumenta por dispatch bajo lock;
5. `UNIQUE (tenant_id,integration_dispatch_id,attempt_number)`;
6. `UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number)`;
7. no existe unique por `(document,operation,idempotency_key)` porque la root se reutiliza en retries;
8. attempt root debe igualar dispatch root;
9. UNKNOWN_OUTCOME histórico no se reescribe;
10. attempt queda scoped físicamente a la preparation exacta mediante FK compuesta al candidate `...attempt_scope_uq`.

## 8. `IntegrationDispatch(FISCAL)` y root de submission

Root:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

Una preparation generation produce una intención dispatch. Un reprepare produce generation/root nuevas. Retry conserva root y crea otra ejecución.

Shape fiscal exacto:

```text
dispatch_class = FISCAL
resource_type = ELECTRONIC_DOCUMENT
internal_entity_type = ElectronicDocument
internal_entity_id = ElectronicDocument.id
fiscal_document_preparation_id = preparation.id
fiscal_preparation_generation = preparation.preparation_generation
payload_schema_version = preparation.canonical_payload_version
payload_checksum = preparation.canonical_payload_checksum
```

`internal_operation_id` es el UUID v7 `operation_id` estable del primer enqueue/submit aceptado que materializa el dispatch; no cambia en retry.

`FiscalSubmissionAttempt.request_checksum` puede representar la request provider-specific transformada y distingue ejecución técnica; no redefine root ni autoriza mutar el canonical payload.

## 9. Claim durable sin lease V1

Migration 003 V1 no agrega `lease_owner`, `lease_expires_at` ni reclaim por vencimiento.

Antes de HTTP la marca durable es una sola transacción:

```text
IntegrationDispatch.status = DISPATCHING
+ FiscalSubmissionAttempt persistido para mismo dispatch/generation
+ FiscalSubmissionAttempt.status = IN_PROGRESS
+ CAS/versiones confirmadas
```

Primer intento:

```text
QUEUED -> DISPATCHING
```

Retry seguro ya autorizado:

```text
RETRY_SCHEDULED -> DISPATCHING
```

Un crash con attempt IN_PROGRESS entra a recovery/reconciliation fail-closed. El tiempo no prueba no-envío.

## 10. Artifacts y evidencia

`FiscalArtifact` referencia obligatoriamente:

- electronic document;
- fiscal document preparation;
- preparation generation;
- attempt cuando aplique.

Artifacts son insert-only. La existencia de cualquier artifact para una generation demuestra evidencia y bloquea reprepare de esa generation.

La distribución externa es:

- provider document/reference/status -> preparation scoped por integration;
- authority reference/legal identifier/authority status -> document legal estable;
- artifacts/receipts/reconciliation -> historia append-only exacta de generation.

Ninguna proyección raw sustituye evidence durable.

## 11. Reconciliation

`FiscalReconciliation` conserva sus estados separados y añade scope físico explícito:

- `DOCUMENT`: document + preparation_generation obligatorios y resolución exacta a la preparation;
- `CONNECTION`: document/generation NULL.

Migration003 v1 no materializa outbound status query. Reconciliation v1 consume:

- respuesta síncrona durable;
- webhook validado;
- artifacts/evidence ya recibidos;
- evidencia manual/autoridad revisada.

Un `DOCUMENT/RUNNING` sobre la generation actual bloquea reprepare. Un `CONNECTION/RUNNING` de la misma conexión bloquea conservadoramente.

Un `FiscalReconciliationItem` liga su evidencia a `fiscal_document_preparation_id + preparation_generation`. Evidencia tardía siempre afecta la generación histórica indicada, nunca la generación actual por timestamp.

## 12. Incidents

`FiscalIncident` conserva lifecycle `OPEN|IN_REVIEW|RESOLVED|ARCHIVED`. Cuando referencia documento y la causa es generation-specific, conserva `preparation_generation` y esa asociación es inmutable.

Un reprepare que no puede demostrar cero exposición falla cerrado y crea/relaciona incident/reconciliation según política; no fuerza otro documento.

Late evidence que revela posible efecto en una generation histórica mientras existe otra generation current produce cuarentena del documento y, cuando corresponda, incidente multi-generation.

## 13. `REPREPARE_BEFORE_SUBMISSION`

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
- dispatch ausente o exactamente QUEUED, sin marca `DISPATCHING` ni attempt;
- cero artifacts;
- cero receipt fiscal ya correlacionado en cualquier processing status;
- cero receipt general ya determinísticamente correlacionable mediante selector provider/adapter versionado;
- candidato potencialmente aplicable pero ambiguo -> fail-closed;
- cero reconciliation aplicable RUNNING;
- cero provider identity/status en current preparation;
- cero authority/legal identity en document;
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

## 14. Fence y concurrencia

Fence lógico:

```text
(tenant_id, electronic_document_id, preparation_generation)
```

Orden suffix:

```text
ElectronicDocument
-> FiscalDocumentPreparation
-> IntegrationDispatch
-> ExternalWebhookReceipt correlacionado/candidato bloqueado cuando aplique
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

Worker persiste `DISPATCHING + attempt IN_PROGRESS` antes de HTTP. Webhook correlacionable toma el mismo fence antes de fijar linkage. Correlación tardía se liga a la generación histórica del dispatch.

## 15. Webhook cross-boundary

No se crea webhook fiscal paralelo. Migration003 extiende `ExternalWebhookReceipt` con referencias fiscales write-once según `fiscal-integration-fence-schema.md`.

Todo receipt ya correlacionado bloquea reprepare independientemente de `processing_status`. `RECEIVED|PENDING|PROCESSING|PROCESSED|RETRY_SCHEDULED|DEAD_LETTER|REJECTED` nunca significan “cero exposición”.

Un receipt general ya determinísticamente correlacionable también bloquea: bajo el mismo fence se fija su linkage fiscal y el reprepare falla. Un candidato ambiguo falla cerrado. Solo un receipt genuinamente no relacionable todavía puede permanecer general; correlación posterior activa la regla de late evidence histórica.

## 16. RLS, grants y mutabilidad

Todas las tablas fiscales usan RLS `ENABLE/FORCE`, scope tenant derivado de contexto y `DENY BY DEFAULT`.

`FiscalDocumentPreparation`:

- `pos_app`: SELECT/INSERT y UPDATE allowlisted de DRAFT/numbering/state bajo guards;
- `pos_worker`: SELECT y UPDATE técnico allowlisted;
- `pos_platform_app`: SELECT contextual;
- `pos_platform_admin`: SELECT por columnas;
- reporting/PUBLIC: none.

En una preparation `CANCELLED`, el late-evidence guard reduce efectivamente el UPDATE del worker a:

```text
provider_document_id
provider_reference
provider_status_raw
updated_at
version
```

solo con evidence correlacionada a esa generation. Numeración, configuración, snapshots, payload, lifecycle y lineage siguen inmutables.

Los campos fiscales nuevos de `IntegrationDispatch` son INSERT/SELECT para `pos_app`, SELECT para worker/platform/admin y jamás UPDATE después de INSERT. Los campos fiscales de receipt son write-once NULL->set completo por el correlator autorizado.

Los column grants no sustituyen guards old/new, CAS ni locks.

## 17. Query/retrieve diferidos y local-first

Los puertos conceptuales `DocumentStatusQueryPort` y `DocumentArtifactPort` pueden existir como arquitectura futura, pero migration003 v1 no materializa `QUERY_DOCUMENT_STATUS` ni `RETRIEVE_ARTIFACT` como attempts/dispatches.

Antes de activarlos se exige contrato separado con capability, provider evidence, root, marca durable previa a HTTP, rate limiting, UNKNOWN_OUTCOME, permisos y pruebas. V1 no presupone lease temporal.

PostgreSQL central es autoridad de acceptance externa y evidence. SQLite migration003 sigue `NONE`.

El POS local puede conservar operación/snapshot/outbox conforme a contratos existentes, pero no replica estas diez tablas ni inventa ACCEPTED/REJECTED. Una futura identidad fiscal offline requiere migration SQLite separada.

## 18. Seguridad y tenancy

- todas las tablas fiscales tenant-scoped;
- FKs tenant/company-aware y `ON DELETE NO ACTION`;
- RLS FORCE;
- tenant request no es autoridad;
- cross-company/integration/generation falla;
- secrets fuera de tablas/logs/eventos;
- pos_app no escribe resultados provider/authority finales fuera de sus casos de uso autorizados;
- pos_worker no cambia identidad/preparation/configuración;
- platform admin read-only;
- artifacts/items no UPDATE/DELETE runtime;
- provider IDs siempre quedan scoped a `FiscalDocumentPreparation.external_integration_id`.

`SEC-G01..SEC-G10` siguen `PLANNED / NOT_EVALUATED` hasta evidencia ejecutable.

## 19. Pruebas de contrato mínimas

- create/replay vs DRAFT edit;
- document + preparation1 same transaction;
- current generation inexistente/futura falla al commit;
- reprepare DRAFT/READY/QUEUED;
- dispatch first-claim race y retry-claim race;
- `DISPATCHING + IN_PROGRESS` durable antes de HTTP;
- crash IN_PROGRESS no habilita resend por tiempo;
- general webhook ya determinísticamente correlacionable bloquea aunque no tenga linkage fiscal;
- webhook candidate ambiguo fail-closed;
- reconciliation race;
- late evidence -> historical generation + quarantine;
- same root/internal_operation_id across retries;
- root cambia solo por preparation generation;
- provider identity queda en preparation, authority/legal identity en document;
- numbering history no overwrite/no reuse aun con cambio config/connection/provider;
- cross-tenant/company/integration/generation;
- UNKNOWN_OUTCOME fail-closed;
- query/retrieve absent from v1;
- migrations 001/002 unchanged;
- MAT-003 solo prerequisite/readiness;
- SQLite 003 absent;
- provider/security statuses unchanged.

## 20. Gate

Este modelo debe recibir review independiente junto con el manifest V2, UC-EINV-001 V2, contrato de fence e índice normativo. Solo un `AUTHORITATIVE_CONTRACT_REVIEW = PASS` puede habilitar una tarea posterior de SQL/descriptor 003.

No se infiere autorización de DDL, provider productivo ni merge de una futura implementación desde este documento.
