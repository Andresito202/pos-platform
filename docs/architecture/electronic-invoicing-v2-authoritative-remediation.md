# Arquitectura de documentos electrónicos — V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / NOT_IMPLEMENTED`.

Este documento alinea la arquitectura funcional de Electronic Invoicing con el contrato V7 integrado por PR #4 y con el physical model V2. No declara habilitación DIAN, provider verificado, runtime fiscal, SQL003 ni readiness productivo.

## 1. Propósito

Camacho POS Colombia debe poder gestionar documentos electrónicos sin acoplar Sale, Tax, Payments o Inventory al contrato de un proveedor específico y sin duplicar efectos cuando existan retries, timeouts, webhooks o cambios de configuración antes del primer envío.

Principios:

- una venta y un documento electrónico son hechos diferentes;
- `ElectronicDocument` tiene identidad previa al primer envío;
- una configuración fiscal pertenece a una preparación, no redefine la identidad del documento;
- resultados externos son provider/authority evidence y nunca se infieren por timeout;
- retries, reprepare y corrective documents son operaciones distintas;
- local-first no convierte SQLite en autoridad de acceptance externa.

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

## 3. Separación estable: documento vs preparación

```text
ElectronicDocument
    identidad lógica estable
    lifecycle legal
    current preparation_generation
            |
            +--> FiscalDocumentPreparation #1
            |      config/snapshots/payload/numbering
            |
            +--> FiscalDocumentPreparation #2 ...
                   solo si hubo reprepare pre-submission
```

`ElectronicDocument` no cambia de identidad porque una integración/configuración queda inválida antes del envío.

Cada preparación conserva:

- integration/connection/config/version exactas;
- source version y correction material;
- importes y moneda;
- tax snapshot;
- fiscal emission snapshot;
- canonical payload y checksum;
- modalidad/estado de numeración;
- lineage y razón de cancelación.

Una preparación FROZEN no se edita. Un reprepare cancela históricamente la generación anterior y crea otra DRAFT.

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

Misma identidad en CREATE con mismo material resuelve al mismo documento. Intentar una segunda fila con material incompatible produce CONFLICT. Editar la preparación DRAFT actual mediante CAS no es un replay nuevo.

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

`READY` significa que la preparación actual está FROZEN. `QUEUED` significa que existe un dispatch fiscal para esa misma generation. `SUBMITTING` implica claim/attempt durable; no demuestra acceptance.

ACCEPTED no se borra ni reabre. REJECTED conserva evidence. UNKNOWN_OUTCOME obliga a fail-closed reconciliation/review y bloquea reprepare.

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

Una edición allowlisted antes del freeze usa CAS sobre la misma DRAFT y no incrementa generation.

## 7. Reprepare antes de submission

`REPREPARE_BEFORE_SUBMISSION` es un command explícito. No es retry y no es provider operation.

Se usa cuando la preparación actual queda inválida antes de exposición, por ejemplo por downgrade/retiro de integration/capability/configuración.

Permitido solo si document está `DRAFT|READY|QUEUED` y puede demostrarse durablemente cero exposición externa.

Prueba mínima:

- no attempts;
- no claim/lease;
- dispatch ausente o QUEUED no reclamado;
- no provider/authority/legal IDs;
- no artifact;
- no receipt fiscal correlacionado en ningún processing status;
- no reconciliation aplicable RUNNING;
- no transport/effect evidence;
- no UNKNOWN_OUTCOME;
- numeración no consumida/incierta/quemada antes de iniciar.

Efecto:

- cancelación atómica del dispatch QUEUED elegible;
- preservación de cualquier número durable como no reutilizable;
- preparation anterior CANCELLED;
- generation +1;
- nueva preparation DRAFT con lineage;
- rebind permitido solo en la nueva preparation;
- regeneración de snapshots/payload/checksum;
- document vuelve DRAFT.

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

El worker, antes de HTTP:

1. revalida capability/configuración;
2. toma fence document/preparation;
3. bloquea dispatch;
4. persiste claim/lease;
5. crea `FiscalSubmissionAttempt` y lo inicia;
6. commit;
7. ejecuta HTTP fuera de ACID.

El resultado se persiste después en otra transacción coherente.

## 9. Retry técnico

Retry conserva:

- ElectronicDocument;
- FiscalDocumentPreparation;
- preparation generation;
- IntegrationDispatch;
- idempotency root;
- numeración.

Crea otro `FiscalSubmissionAttempt` con attempt_number nuevo.

`started_at` solo prueba inicio técnico. Seguridad de retry depende de `transport_status` y evidencia externa.

Transport:

- NOT_SENT;
- SENT;
- RESPONSE_RECEIVED;
- UNKNOWN.

Un error HTTP/timeout/socket por sí solo nunca prueba ausencia de efecto.

## 10. Resultado incierto

Si pudo existir efecto externo sin respuesta concluyente:

- attempt -> UNKNOWN_OUTCOME;
- document -> UNKNOWN_OUTCOME cuando no existe certeza legal;
- no reprepare;
- no nueva numeración;
- no segundo documento;
- no retry ciego;
- se conserva evidence/incident/reconciliation.

Un attempt histórico UNKNOWN_OUTCOME nunca se reescribe aunque evidence posterior resuelva el document.

## 11. Webhooks

La recepción sigue en `ExternalWebhookReceipt`; no existe tabla webhook fiscal paralela.

Migration003 agrega linkage fiscal write-once a document/preparation/generation/dispatch. La mera existencia de un receipt correlacionado bloquea reprepare sin importar su processing status.

Webhook correlacionable y reprepare usan el mismo fence. Si el receipt se correlaciona después, se liga a la generation histórica del dispatch; nunca se mueve automáticamente a la actual.

## 12. Reconciliation V1

`FiscalReconciliation` puede aplicar:

- respuesta síncrona ya persistida;
- webhook validado;
- artifacts/evidence existentes;
- evidencia manual/autoridad revisada.

Migration003 v1 no materializa outbound query/status. Por eso `DocumentStatusQueryPort` permanece diseñado pero no autorizado físicamente.

Un reconciliation DOCUMENT RUNNING sobre current generation bloquea reprepare. Un reconciliation CONNECTION RUNNING en la misma conexión bloquea conservadoramente.

## 13. Operation catalog V1

Único operation_type físico:

```text
SUBMIT_DOCUMENT
```

Diferidos:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

No se simulan bajo otra operación. Para habilitarlos se requiere contrato separado con capability/provider evidence, idempotency, claim durable, rate limit, normalization, UNKNOWN_OUTCOME, security y tests.

## 14. Numeración

La configuración versionada posee rango/cursor. La preparación posee la asignación concreta de su generation.

- remote assigned: PENDING_EXTERNAL hasta evidence;
- authorized range/local contingency: asignación y avance cursor atómicos;
- rollback pre-commit revierte cursor;
- una reserva durable cancelada nunca se reutiliza;
- reprepare conserva la preparación anterior con RELEASED_WITHOUT_REUSE/BURNED según policy;
- retry conserva mismo número;
- UNKNOWN_OUTCOME bloquea release/nueva asignación.

## 15. Documentos correctivos

Credit/debit/support adjustment son ElectronicDocument nuevos con:

- source correctivo estable;
- original_electronic_document_id;
- capability propia;
- preparation/numeración propias.

No son successor/replacement del reprepare pre-submission.

## 16. Contingencia

Contingencia requiere configuración, permiso, evidencia y procedimiento previamente habilitados. No nace de un timeout individual.

Una vez existe exposición/representación externa, reprepare deja de ser elegible. Recuperación usa el mismo documento/preparación y reconciliation conforme a policy.

## 17. Provider neutrality

Factus, Siigo, Alegra y futuros providers implementan puertos separados. Un adapter no define entidades core ni puede anunciar capability sin evidencia.

Puertos conceptuales:

- `DocumentIssuancePort`: base de submission v1;
- `DocumentStatusQueryPort`: diseñado, no materializado en migration003 v1;
- `DocumentArtifactPort`: diseñado, retrieval remoto no materializado en v1;
- `NumberingRangePort`: solo donde exista capability real;
- `FiscalConfigurationValidationPort`.

SIIGO/FACTUS/ALEGRA permanecen `DESIGNED / NOT_EVALUATED` hasta pruebas reales.

## 18. Local-first

El núcleo comercial puede operar según modalidad sin provider fiscal cuando sea legal/contractualmente aplicable, pero la UI no afirma cumplimiento inexistente.

PostgreSQL central conserva authority fiscal externa. SQLite003 es NONE. Un futuro corte fiscal offline requiere diseño/migration local explícitos.

## 19. Seguridad

- tenant/company derivados y revalidados;
- no secrets en domain/logs/events;
- provider response sanitizada;
- storage references protegidas;
- RLS/column grants/guards como defensa adicional;
- reprepare, config changes, incident resolution y contingency auditados;
- renderer nunca posee secrets ni DB/hardware authority.

`SEC-G01..SEC-G10` permanecen NOT_EVALUATED hasta evidence runtime.

## 20. Pruebas arquitectónicas obligatorias

- idempotent create/replay;
- DRAFT mutation vs reprepare;
- READY/QUEUED reprepare;
- worker/webhook/reconciliation races;
- late evidence historical generation;
- retry root estable;
- numbering no reuse;
- UNKNOWN_OUTCOME fail-closed;
- cross-tenant/company/integration;
- provider capability downgrade;
- query/retrieve absent from physical v1;
- second adapter without core-domain changes.

## 21. Gate

La arquitectura V2 solo queda cerrada para materialización cuando el conjunto manifest V2 + physical model V2 + fence cross-boundary + UC-EINV-001 V2 recibe `AUTHORITATIVE_CONTRACT_REVIEW = PASS` en un HEAD exacto y CI verde. Ese gate todavía no equivale a SQL003 materializado.
