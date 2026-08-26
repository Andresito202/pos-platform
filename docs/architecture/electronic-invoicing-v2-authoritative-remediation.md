# Arquitectura de documentos electrónicos — V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_IMPLEMENTED`.

Este documento alinea la arquitectura funcional de Electronic Invoicing con el contrato V7 integrado por PR #4 y con el cierre físico normativo de `docs/migration/sql003-authoritative-contract-remediation-index.md`. No declara habilitación DIAN, provider verificado, runtime fiscal, SQL003 ni readiness productivo.

Ante cualquier detalle físico no repetido aquí, el índice de remediación y su §4 prevalecen. Este documento no puede interpretarse de forma que reintroduzca leases V1, identidad provider sin scope, reuse de numeración ni una ventana entre receipt recibido y correlación fiscal determinista.

## 1. Propósito

Camacho POS Colombia debe poder gestionar documentos electrónicos sin acoplar Sale, Tax, Payments o Inventory al contrato de un proveedor específico y sin duplicar efectos cuando existan retries, timeouts, webhooks o cambios de configuración antes del primer envío.

Principios:

- una venta y un documento electrónico son hechos diferentes;
- `ElectronicDocument` tiene identidad previa al primer envío;
- una configuración fiscal pertenece a una preparación, no redefine la identidad del documento;
- resultados externos son provider/authority evidence y nunca se infieren por timeout;
- retries, reprepare y corrective documents son operaciones distintas;
- local-first no convierte SQLite en autoridad de acceptance externa;
- la ausencia de evidencia concluyente nunca se transforma en permiso para repetir un efecto externo.

## 2. Ownership

Electronic Invoicing posee:

- perfil/configuración fiscal de emisión;
- `ElectronicDocument`;
- `FiscalDocumentPreparation`;
- submission attempts;
- numeración aplicada;
- artifacts;
- incidents;
- reconciliation;
- contingencia fiscal.

External Integrations posee provider registry, account/integration, adapter version, credentials referenciadas, capabilities generales, routing/dispatch, rate limits y webhook receipt.

Tax produce el snapshot tributario; Electronic Invoicing lo consume sin recalcularlo. Sales/Payments/Cash/Inventory conservan su autoridad.

La distribución de identidad externa es deliberada:

- `ElectronicDocument` conserva `authority_reference`, `legal_identifier`, `authority_status_raw`, `uncertainty_reason` y timestamps legales;
- `FiscalDocumentPreparation` conserva `provider_document_id`, `provider_reference` y `provider_status_raw`, porque allí existe el `external_integration_id` que da scope físico inequívoco a esos valores.

## 3. Separación estable: documento vs preparación

```text
ElectronicDocument
    identidad lógica estable
    lifecycle legal
    current preparation_generation
            |
            +--> FiscalDocumentPreparation #1
            |      config/snapshots/payload/numbering/provider scope
            |
            +--> FiscalDocumentPreparation #2 ...
                   solo si hubo reprepare pre-submission
```

`ElectronicDocument` no cambia de identidad porque una integración/configuración quede inválida antes del envío.

Cada preparación conserva:

- integration/connection/config/version exactas;
- source version y correction material;
- importes y moneda;
- tax snapshot;
- fiscal emission snapshot;
- canonical payload y checksum;
- modalidad/estado de numeración;
- provider identity/status scoped cuando aparezcan;
- lineage y razón de cancelación.

Una preparación FROZEN no se edita. Un reprepare cancela históricamente la generación anterior y crea otra DRAFT.

`ElectronicDocument.preparation_generation` es la única autoridad de generation actual. No existe un segundo `current_preparation_id`; la futura materialización debe garantizar al commit que la preparation current existe exactamente una vez y que no hay generaciones futuras durables.

## 4. Identidad lógica

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

`source_version`, `correction_source_reference`, configuración, importes, checksums, branch, prefix/number y external IDs no participan.

Misma identidad en CREATE con mismo material resuelve al mismo documento. Intentar una segunda fila con material incompatible produce `CONFLICT`. Editar la preparación DRAFT actual mediante CAS no es un replay nuevo.

## 5. Lifecycle del documento

Estados persistentes:

- `DRAFT`;
- `READY`;
- `QUEUED`;
- `SUBMITTING`;
- `ACCEPTED`;
- `REJECTED`;
- `UNKNOWN_OUTCOME`;
- `CONTINGENCY`;
- `VOIDED_BEFORE_SUBMISSION`.

`READY` significa que la preparación actual está FROZEN. `QUEUED` significa que existe un dispatch fiscal para esa misma generation. `SUBMITTING` implica marca durable previa a HTTP: dispatch `DISPATCHING` + `FiscalSubmissionAttempt` `IN_PROGRESS`; no demuestra acceptance.

ACCEPTED no se borra ni reabre. REJECTED conserva evidence. UNKNOWN_OUTCOME obliga a fail-closed reconciliation/review y bloquea reprepare y retry ciego.

## 6. Preparación ordinaria

1. validar source/scope y logical identity;
2. resolver capabilities y precedencia BRANCH > COMPANY;
3. seleccionar connection/config/version vigente;
4. crear o resolver ElectronicDocument;
5. crear preparation generation 1 DRAFT si no existe;
6. congelar source version, snapshots, importes y canonical payload;
7. resolver numeración aplicable;
8. validar checksum/material;
9. cambiar preparation a FROZEN y document a READY en la frontera transaccional correspondiente;
10. Audit/evento.

La creación inicial de documento y preparation generation 1 pertenece a una única transacción. Una edición allowlisted antes del freeze usa CAS sobre la misma DRAFT y no incrementa generation.

## 7. Reprepare antes de submission

`REPREPARE_BEFORE_SUBMISSION` es un command explícito. No es retry, no es provider operation y no crea successor/replacement.

Se usa cuando la preparación actual queda inválida antes de exposición, por ejemplo por downgrade/retiro de integration/capability/configuración.

Permitido solo si document está `DRAFT|READY|QUEUED` y puede demostrarse durablemente cero exposición externa.

Prueba mínima bajo el fence común:

- no `FiscalSubmissionAttempt` de la generation;
- no marca durable de claim (`IntegrationDispatch.DISPATCHING` + attempt `IN_PROGRESS`);
- dispatch ausente o exactamente `QUEUED` sin attempt;
- no provider identity/status en la preparación actual;
- no authority/legal identity en el documento;
- no artifact;
- no receipt fiscal ya correlacionado en ningún `processing_status`;
- no receipt general 002 que, según un selector provider/adapter versionado y allowlisted, sea ya determinísticamente correlacionable con el dispatch/document/preparation;
- si existe un candidato potencialmente relacionado pero ambiguo, la prueba falla cerrado hasta resolverlo;
- no reconciliation aplicable RUNNING;
- no transport/effect evidence;
- no UNKNOWN_OUTCOME;
- numeración no `CONSUMED|UNKNOWN_OUTCOME|BURNED` antes de iniciar.

Efecto atómico:

- cancelación del dispatch QUEUED elegible;
- preservación de cualquier número durable como no reutilizable;
- preparation anterior `CANCELLED`;
- generation +1;
- nueva preparation DRAFT con lineage;
- rebind permitido solo en la nueva preparation;
- regeneración de snapshots/payload/checksum;
- document vuelve DRAFT;
- Audit/evento.

No existe successor/replacement automático en migration003 v1.

## 8. Enqueue y submission

READY -> QUEUED crea un `IntegrationDispatch(FISCAL)` ligado a document + preparation + generation.

Root:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

Identidad interna V1 del dispatch:

```text
dispatch_class = FISCAL
resource_type = ELECTRONIC_DOCUMENT
internal_entity_type = ElectronicDocument
internal_entity_id = ElectronicDocument.id
payload_schema_version = FiscalDocumentPreparation.canonical_payload_version
payload_checksum = FiscalDocumentPreparation.canonical_payload_checksum
```

`internal_operation_id` es el `operation_id` estable del primer enqueue/submit aceptado que materializa ese dispatch para la generation. Retry no lo cambia.

Antes de cualquier HTTP, el worker ejecuta una transición atómica:

1. revalida capability/configuración;
2. toma fence document/preparation;
3. bloquea dispatch;
4. revalida document current generation + preparation FROZEN;
5. cambia `IntegrationDispatch.status` de `QUEUED` o `RETRY_SCHEDULED` permitido a `DISPATCHING`;
6. crea el `FiscalSubmissionAttempt` del mismo dispatch/generation/root y lo deja `IN_PROGRESS`;
7. confirma CAS/versiones y commit;
8. solo después ejecuta HTTP fuera de ACID.

V1 no materializa `lease_owner`, `lease_expires_at` ni reclaim por tiempo. Un crash con attempt `IN_PROGRESS` entra a recovery/reconciliation fail-closed; un timestamp no autoriza reenviar.

## 9. Retry técnico

Retry conserva:

- ElectronicDocument;
- FiscalDocumentPreparation;
- preparation generation;
- IntegrationDispatch;
- `internal_operation_id`;
- idempotency root;
- numeración.

Crea otro `FiscalSubmissionAttempt` con `attempt_number` nuevo bajo lock del mismo dispatch.

El primer claim usa `QUEUED -> DISPATCHING`. Un retry ya autorizado por evidencia usa `RETRY_SCHEDULED -> DISPATCHING`; nunca vuelve a `QUEUED`.

`started_at` solo prueba inicio técnico. Seguridad de retry depende de `transport_status` y evidencia externa.

Transport:

- `NOT_SENT`;
- `SENT`;
- `RESPONSE_RECEIVED`;
- `UNKNOWN`.

Retry classification:

- `SAFE_RETRY`;
- `RECONCILE_REQUIRED`;
- `NON_RETRYABLE`.

Un error HTTP/timeout/socket por sí solo nunca prueba ausencia de efecto. `next_attempt_at` agenda un retry ya autorizado; el paso del tiempo no crea esa autorización.

## 10. Resultado incierto

Si pudo existir efecto externo sin respuesta concluyente:

- attempt -> UNKNOWN_OUTCOME;
- document -> UNKNOWN_OUTCOME cuando no existe certeza legal;
- dispatch -> UNKNOWN_OUTCOME o RECONCILIATION_REQUIRED según evidence;
- no reprepare;
- no nueva numeración;
- no segundo documento;
- no retry ciego;
- se conserva evidence/incident/reconciliation.

Un attempt histórico UNKNOWN_OUTCOME nunca se reescribe aunque evidence posterior resuelva el document.

El estado `SUCCEEDED` del dispatch significa completitud técnica de la intención provider-facing, no aceptación fiscal. Un rechazo fiscal concluyente puede producir dispatch `SUCCEEDED` y document `REJECTED`.

## 11. Webhooks

La recepción sigue en `ExternalWebhookReceipt`; no existe tabla webhook fiscal paralela.

Migration003 agrega linkage fiscal write-once a document/preparation/generation/dispatch. La mera existencia de un receipt correlacionado bloquea reprepare sin importar su processing status.

Si un receipt general ya recibido puede resolverse determinísticamente a un único dispatch fiscal mediante el selector versionado permitido, reprepare debe bloquearlo, fijar la correlación write-once bajo el mismo fence y fallar por evidencia externa. Si el candidato es potencialmente aplicable pero ambiguo, el reprepare falla cerrado sin incrementar generation.

Solo un receipt genuinamente no correlacionable todavía puede permanecer general. Si evidencia posterior permite correlacionarlo y la generation ya cambió, queda ligado a la generation histórica y activa la cuarentena cross-generation; nunca se mueve automáticamente a la actual.

## 12. Evidencia tardía cross-generation

Si después de un reprepare aparece evidence correlacionada con una preparation histórica:

1. se conserva exclusivamente en esa generation;
2. una preparación `CANCELLED` no se reactiva ni cambia configuración/payload/numeración;
3. provider identity/status histórico solo puede enriquecerse de forma write-once/sanitizada y respaldada por evidence append-only;
4. el documento actual entra fail-closed a `UNKNOWN_OUTCOME` salvo evidencia autoritativa suficiente para un estado legal más fuerte;
5. un dispatch current aún QUEUED no puede reclamarse mientras el documento esté UNKNOWN_OUTCOME;
6. si current generation ya tenía claim/attempt, se abre/relaciona incidente multi-generation y no se inicia otro attempt.

No se selecciona una generation por timestamp o por ser “la última”.

## 13. Reconciliation V1

`FiscalReconciliation` puede aplicar:

- respuesta síncrona ya persistida;
- webhook validado;
- artifacts/evidence existentes;
- evidencia manual/autoridad revisada.

Migration003 v1 no materializa outbound query/status. Por eso `DocumentStatusQueryPort` permanece diseñado pero no autorizado físicamente.

Un reconciliation DOCUMENT RUNNING sobre current generation bloquea reprepare. Un reconciliation CONNECTION RUNNING en la misma conexión bloquea conservadoramente.

## 14. Operation catalog V1

Único operation_type físico:

```text
SUBMIT_DOCUMENT
```

Diferidos:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

No se simulan bajo otra operación. Para habilitarlos se requiere contrato separado con capability/provider evidence, idempotency, marca durable previa a HTTP, rate limit, normalization, UNKNOWN_OUTCOME, security y tests. Una futura estrategia de lease tendría que definirse allí explícitamente; V1 no la presume.

## 15. Numeración

La configuración versionada posee rango/cursor. La preparación posee la asignación concreta de su generation.

- remote assigned: PENDING_EXTERNAL hasta evidence;
- authorized range/local contingency: asignación y avance cursor atómicos;
- rollback pre-commit revierte cursor;
- una reserva durable cancelada nunca se reutiliza;
- reprepare conserva la preparación anterior con RELEASED_WITHOUT_REUSE/BURNED según policy;
- retry conserva mismo número;
- UNKNOWN_OUTCOME bloquea release/nueva asignación.

V1 aplica defensa conservadora de no-reuse a nivel de emisor: configuration, connection, provider o document type no abren por sí solos un namespace para reutilizar un `prefix/number` durable.

## 16. Documentos correctivos

Credit/debit/support adjustment son ElectronicDocument nuevos con:

- source correctivo estable;
- original_electronic_document_id;
- capability propia;
- preparation/numeración propias.

No son successor/replacement del reprepare pre-submission.

## 17. Contingencia

Contingencia requiere configuración, permiso, evidencia y procedimiento previamente habilitados. No nace de un timeout individual.

Una vez existe exposición/representación externa, reprepare deja de ser elegible. Recuperación usa el mismo documento/preparación y reconciliation conforme a policy.

## 18. Provider neutrality

Factus, Siigo, Alegra y futuros providers implementan puertos separados. Un adapter no define entidades core ni puede anunciar capability sin evidencia.

Puertos conceptuales:

- `DocumentIssuancePort`: base de submission v1;
- `DocumentStatusQueryPort`: diseñado, no materializado en migration003 v1;
- `DocumentArtifactPort`: diseñado, retrieval remoto no materializado en v1;
- `NumberingRangePort`: solo donde exista capability real;
- `FiscalConfigurationValidationPort`.

SIIGO/FACTUS/ALEGRA permanecen `DESIGNED / NOT_EVALUATED` hasta pruebas reales.

## 19. Local-first

El núcleo comercial puede operar según modalidad sin provider fiscal cuando sea legal/contractualmente aplicable, pero la UI no afirma cumplimiento inexistente.

PostgreSQL central conserva authority fiscal externa. SQLite003 es NONE. Un futuro corte fiscal offline requiere diseño/migration local explícitos.

## 20. Seguridad

- tenant/company derivados y revalidados;
- no secrets en domain/logs/events;
- provider response sanitizada;
- storage references protegidas;
- RLS/column grants/guards como defensa adicional;
- reprepare, config changes, incident resolution y contingency auditados;
- renderer nunca posee secrets ni DB/hardware authority;
- provider-specific identity se mantiene scoped a la preparation/integration;
- columns 003 siguen DENY BY DEFAULT hasta grant explícito.

`SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED` hasta evidence runtime.

## 21. Pruebas arquitectónicas obligatorias

- idempotent create/replay;
- DRAFT mutation vs reprepare;
- READY/QUEUED reprepare;
- current preparation invariant al commit;
- worker/webhook/reconciliation races;
- general receipt ya determinísticamente correlacionable bloquea antes del linkage fiscal;
- candidato webhook ambiguo falla cerrado;
- late evidence historical generation -> quarantine;
- retry root e internal_operation_id estables;
- QUEUED y RETRY_SCHEDULED claim concurrente con un solo attempt IN_PROGRESS;
- numbering no reuse incluso si cambia config/connection/provider;
- UNKNOWN_OUTCOME fail-closed;
- cross-tenant/company/integration/generation;
- provider capability downgrade;
- query/retrieve absent from physical v1;
- second adapter without core-domain changes;
- MAT-003 entendido solo como prerequisite/readiness y no como validación del target de diez tablas.

## 22. Gate

La arquitectura V2 solo queda cerrada para materialización cuando el conjunto manifest V2 + physical model V2 + fence cross-boundary + UC-EINV-001 V2 + índice normativo recibe `AUTHORITATIVE_CONTRACT_REVIEW = PASS` en un HEAD exacto y CI verde.

Ese gate todavía no equivale a SQL003 materializado, descriptor003 aprobado, provider verificado ni autorización de merge de una futura implementación.
