# PHY-G12X — extensión fiscal de External Integrations y fence por preparación

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / MIGRATION_003_OWNED / REVIEW_REQUIRED / NO_SQL`.

Este contrato define únicamente la extensión que migration 003 necesita sobre objetos owned por `External Integrations` para enlazar una intención fiscal con una `FiscalDocumentPreparation` y serializar evidencia externa contra `REPREPARE_BEFORE_SUBMISSION`.

No reemplaza el contrato general `external-integrations-schema.md`, no modifica bytes de migration 002 y no transfiere ownership de `IntegrationDispatch` ni `ExternalWebhookReceipt` a Electronic Invoicing. Los campos, constraints, FKs, índices y guards descritos aquí son extensiones owned por descriptor 003 y se retiran exclusivamente con un down 003 elegible.

La interpretación física final se alinea con `docs/migration/sql003-authoritative-contract-remediation-index.md` §4: V1 no introduce leases temporales, todo receipt ya determinísticamente correlacionable participa en la prueba de cero exposición y la evidencia tardía permanece ligada a su generation histórica.

## 1. Frontera de ownership

`External Integrations` continúa siendo owner de:

- `IntegrationDispatch` como intención central→provider;
- routing, estado agregado, retry scheduling y payload checksum del dispatch;
- `ExternalWebhookReceipt` como recepción durable, deduplicación, autenticidad/replay y procesamiento del webhook.

`Electronic Invoicing` continúa siendo owner de:

- `ElectronicDocument`;
- `FiscalDocumentPreparation` y `preparation_generation`;
- `FiscalSubmissionAttempt`;
- artifacts, incidents y reconciliation fiscales;
- lifecycle legal y evidencia fiscal normalizada.

Migration 003 solo agrega referencias físicas cruzadas que demuestran a qué preparación histórica pertenece un dispatch/receipt fiscal.

## 2. Extensión de `integrations.integration_dispatches`

Columnas nuevas 003:

```text
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
```

Shape final:

- `dispatch_class='FISCAL'` exige ambas columnas NOT NULL;
- `dispatch_class='FISCAL'` exige `resource_type='ELECTRONIC_DOCUMENT'`;
- `dispatch_class='FISCAL'` exige `internal_entity_type='ElectronicDocument'`;
- capability fiscal debe ser la derivada allowlisted del `document_type` de la preparation;
- `dispatch_class='NON_FISCAL'` exige ambas columnas fiscales NULL;
- `fiscal_preparation_generation >= 1`;
- `internal_entity_id` debe ser exactamente el `ElectronicDocument.id` de la preparation;
- tenant/company/integration del dispatch deben coincidir con preparation y perfil fiscal;
- `payload_schema_version` y `payload_checksum` deben coincidir con el canonical payload FROZEN de esa preparation.

FK/candidate conceptual 003:

```text
(tenant_id,
 company_id,
 integration_id,
 internal_entity_id,
 fiscal_preparation_generation,
 fiscal_document_preparation_id)
 -> fiscal.fiscal_document_preparations(
      tenant_id,
      company_id,
      external_integration_id,
      electronic_document_id,
      preparation_generation,
      id)
```

La candidate key de destino se materializa en 003. La FK usa `ON DELETE NO ACTION`.

### Identidad y root fiscal

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

El checksum no forma parte de la root. Mismo root con checksum/schema/generation incompatibles falla `CONFLICT`.

`internal_operation_id` es el UUID v7 `operation_id` estable del primer enqueue/submit aceptado que materializa este dispatch. No es attempt id, attempt number, request id, correlation id, provider id ni reprepare command id.

Un reprepare crea otra generation y, por tanto, otro dispatch/root/internal_operation_id. Un retry no crea dispatch nuevo: conserva esa identidad y agrega otro `FiscalSubmissionAttempt`.

### Lifecycle y marca durable previa a HTTP

Un dispatch fiscal nace `QUEUED`.

V1 **no materializa** `lease_owner`, `lease_expires_at` ni reclaim automático por tiempo. La marca durable previa a HTTP es una transición atómica:

```text
IntegrationDispatch.status = 'DISPATCHING'
+ FiscalSubmissionAttempt persistido para el mismo dispatch/generation
+ FiscalSubmissionAttempt.status = 'IN_PROGRESS'
+ CAS/versiones confirmadas
```

Primer intento:

```text
QUEUED -> DISPATCHING
```

Retry seguro ya clasificado:

```text
RETRY_SCHEDULED -> DISPATCHING
```

Antes de HTTP, el worker:

1. revalida declaration/adapter/integration/capability/configuración;
2. toma el fence documento/preparation;
3. bloquea el dispatch;
4. verifica que la generation siga siendo la actual y FROZEN;
5. verifica que no exista otro attempt IN_PROGRESS/concurrente;
6. cambia el dispatch a `DISPATCHING` desde el estado permitido;
7. crea el nuevo `FiscalSubmissionAttempt` y lo deja `IN_PROGRESS` con attempt_number monotónico bajo lock;
8. commit;
9. solo después ejecuta HTTP.

Un dispatch `QUEUED` sin attempt puede ser cancelado atómicamente por reprepare. Cualquier attempt previo, estado distinto de QUEUED, evidencia o incertidumbre bloquea reprepare.

Un crash con attempt IN_PROGRESS no se “libera” por timestamp: entra a recovery/reconciliation fail-closed.

## 3. Extensión de `integrations.external_webhook_receipts`

Columnas nuevas 003:

```text
fiscal_electronic_document_id uuid NULL
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
fiscal_integration_dispatch_id uuid NULL
fiscal_correlated_at timestamptz NULL
```

Shape de correlación:

- sin correlación fiscal: las cinco columnas son NULL;
- con correlación fiscal: las cinco son NOT NULL;
- `fiscal_preparation_generation >= 1`;
- el dispatch debe ser `FISCAL`, corresponder al mismo tenant/company/integration/document/preparation/generation;
- `fiscal_correlated_at` se fija una vez;
- los IDs/generation son write-once y nunca pueden moverse a otra preparation.

FKs 003:

- receipt → `IntegrationDispatch` FISCAL scoped;
- receipt → `ElectronicDocument` scoped;
- receipt → `FiscalDocumentPreparation` scoped por generation.

### Regla de cero exposición

La mera existencia de un receipt fiscal ya correlacionado es evidencia externa y bloquea reprepare en cualquier `processing_status`.

No se condiciona a que esté `PROCESSED` ni a que haya aplicado un resultado. Esto incluye, conforme al catálogo 002 vigente:

```text
RECEIVED
REJECTED
PENDING
PROCESSING
PROCESSED
RETRY_SCHEDULED
DEAD_LETTER
```

El status del procesamiento explica qué hizo la plataforma con el webhook; no demuestra que el proveedor nunca recibió/procesó la intención.

Además, un receipt general 002 **ya determinísticamente correlacionable** también bloquea aunque las columnas fiscales sigan NULL en ese instante.

## 4. Receipt general correlacionable

Un receipt general es determinísticamente correlacionable cuando el contrato versionado del provider/adapter puede resolverlo a un único dispatch fiscal mediante campos durables allowlisted ya persistidos —por ejemplo correlation/request/provider-operation references autorizadas— sin leer secretos, sin inferir por timestamps y sin heurística ambigua.

Una coincidencia por tenant/integration solamente nunca basta.

Antes de confirmar reprepare:

1. se consultan los receipts ya correlacionados de la generation;
2. se evalúan receipts generales candidatos del mismo tenant/company/integration usando exclusivamente el selector versionado aplicable;
3. si un candidato resuelve inequívocamente al dispatch/document/preparation, se bloquea el receipt y se fija la correlación fiscal write-once en esa misma transacción; el reprepare falla por evidencia externa;
4. si el selector demuestra que corresponde inequívocamente a otro dispatch, no bloquea este documento;
5. si el candidato puede pertenecer al dispatch pero la resolución es ambigua/incompleta, la prueba de cero exposición falla cerrado sin cancelar dispatch ni incrementar generation;
6. solo un receipt que genuinamente todavía no puede relacionarse según ningún selector autorizado permanece general sin bloquear ese documento.

Correlator y reprepare respetan el mismo orden de locks. Solo uno puede confirmar primero; el segundo revalida el estado final bajo lock.

## 5. Ingesta correlacionable

Si el request permite resolver de forma determinista el dispatch/documento antes de persistir el linkage:

1. tenant/company/integration se derivan por la ruta/identidad de integración 002;
2. se resuelve el dispatch fiscal histórico;
3. se toma `ElectronicDocument -> FiscalDocumentPreparation -> IntegrationDispatch`;
4. se inserta el receipt y se fija el linkage fiscal write-once;
5. commit;
6. procesamiento posterior continúa idempotente.

Así, reprepare y llegada de evidence correlacionable no pueden ganar simultáneamente.

## 6. Ingesta inicialmente no correlacionable y late evidence

Un webhook que genuinamente no puede correlacionarse de forma segura se persiste como receipt general 002, sin inventar document/generation.

Si luego aparece evidencia suficiente para correlacionarlo:

1. se resuelve el dispatch histórico;
2. se toma el mismo fence;
3. se bloquea el receipt;
4. se fijan las columnas fiscales una sola vez;
5. la evidencia queda ligada a la generation histórica del dispatch, aunque el documento tenga otra generation current.

Una correlación tardía nunca cambia a “current generation” por conveniencia ni timestamp.

Si la generation correlacionada es menor que `ElectronicDocument.preparation_generation`:

- la preparation histórica no se reactiva;
- provider identity/status histórico solo puede enriquecerse bajo el guard correspondiente;
- el document current entra fail-closed a UNKNOWN_OUTCOME salvo evidencia autoritativa suficiente para un resultado más fuerte;
- un current dispatch QUEUED no puede reclamarse mientras el document esté UNKNOWN_OUTCOME;
- si current generation ya tenía attempt/claim durable, se abre/relaciona incidente multi-generation y no se inicia otro attempt.

## 7. Fence canónico

La clave lógica del fence es:

```text
(tenant_id, electronic_document_id, preparation_generation)
```

No se crea una tabla `fence`. La serialización se apoya en row locks/CAS sobre `ElectronicDocument`, `FiscalDocumentPreparation` y recursos relacionados.

Suffix de locks para evidencia fiscal:

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

Cuando una operación requiere capability/configuración usa antes el prefijo universal definido en el manifest 003. Dentro de cada nivel, UUID/código ascendente.

Ningún HTTP ocurre mientras se mantienen estos locks.

## 8. Reprepare vs receipt/worker

`REPREPARE_BEFORE_SUBMISSION` debe reconsultar bajo el mismo fence, inmediatamente antes del commit:

- version/status del ElectronicDocument;
- preparation_generation actual;
- estado de la preparation;
- dispatch status;
- attempts;
- artifacts;
- receipts ya correlacionados en todos sus estados;
- receipts generales candidatos conforme al selector determinista autorizado;
- reconciliations aplicables;
- provider identity/status en la preparation;
- authority/legal identities en el document;
- cualquier transport/effect evidence.

Solo con cero exposición cancela un dispatch QUEUED elegible, cancela la preparation histórica y confirma generation+1.

Races esperadas:

- webhook/correlator gana primero → receipt durable/correlacionado → reprepare falla;
- candidato ambiguo → reprepare falla cerrado;
- reprepare gana primero sobre un receipt genuinamente no correlacionable → old dispatch/preparation quedan cancelados; una correlación posterior se liga a la generation histórica y activa cuarentena;
- worker gana primero → `DISPATCHING + attempt IN_PROGRESS` durable → reprepare falla;
- reprepare gana primero → old dispatch CANCELLED → worker no puede reclamarlo.

## 9. Query/retrieve fuera de V1

Migration 003 v1 no materializa:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

Por tanto, este contrato no inventa dispatches o attempts para polling/query. Una futura capability de consulta deberá definir antes de HTTP:

- capability/provider declaration;
- root/idempotency propia;
- marca durable previa a HTTP y recovery explícito;
- vínculo document/preparation/generation;
- rate limit;
- result normalization;
- interacción con UNKNOWN_OUTCOME;
- permisos/auditoría;
- pruebas negativas;
- soporte real del provider.

Una futura estrategia puede introducir lease temporal solo mediante contrato versionado de recovery; V1 no la presume.

Hasta entonces, reconciliation v1 usa evidencia ya recibida, webhook validado, respuesta síncrona o evidencia manual/autoridad.

## 10. Constraints/guards/indexes 003

Nombres normativos mínimos/candidatos:

```text
integration_dispatches_fiscal_preparation_ck
integration_dispatches_fiscal_preparation_fk
integration_dispatches_fiscal_preparation_idx
integration_dispatches_fiscal_preparation_guard
external_webhook_receipts_fiscal_correlation_ck
external_webhook_receipts_fiscal_dispatch_fk
external_webhook_receipts_fiscal_document_fk
external_webhook_receipts_fiscal_preparation_fk
external_webhook_receipts_fiscal_correlation_idx
external_webhook_receipts_fiscal_correlation_guard
```

El guard de receipt permite únicamente all-null → all-non-null una vez para linkage fiscal y cambios normales 002 de processing lifecycle; prohíbe rebind de fiscal IDs/generation.

El guard de dispatch prohíbe modificar preparation/generation/routing/internal identity/root/schema/checksum después de insertar y valida el shape fiscal en creación y claim.

## 11. RLS/grants

Las nuevas columnas permanecen bajo la RLS tenant-aware de las tablas 002; 003 no crea una policy que amplíe visibilidad.

Column grants 003 son explícitos y no se heredan implícitamente:

### `integration_dispatches` nuevos campos

- `pos_app`: SELECT + INSERT; nunca UPDATE;
- `pos_worker`: SELECT; nunca UPDATE;
- `pos_platform_app`: SELECT contextual; no puede fabricar linkage fiscal;
- `pos_platform_admin`: SELECT read-only;
- reporting/PUBLIC: none.

### `external_webhook_receipts` nuevos campos

- `pos_app`: SELECT únicamente para prueba de reprepare;
- `pos_worker`: SELECT + UPDATE únicamente para correlación tardía NULL→set completo bajo guard;
- `pos_platform_app`: SELECT + INSERT por endpoint webhook aislado, sin UPDATE del linkage;
- `pos_platform_admin`: SELECT read-only;
- reporting/PUBLIC: none.

Una columna futura recibe `DENY BY DEFAULT` hasta grant explícito.

## 12. Apply/down ownership

Apply 003 agrega columnas/constraints/guards/indexes únicamente después de crear los owners fiscales necesarios y antes de habilitar FISCAL.

Down 003 elegible:

1. restaura primero el constraint 002 que bloquea FISCAL;
2. demuestra cero dispatch/receipt correlation fiscal e historia fiscal según gate fresh/test;
3. retira FKs/guards/indexes/columnas 003;
4. solo después elimina tablas fiscales dependientes.

002 permanece byte-for-byte inmutable. Down nunca elimina objetos 001/002 ni shared dependencies que no sean owned por 003.

## 13. Criterios de review

Debe demostrarse, como mínimo:

- receipt pendiente ya correlacionado vs reprepare serializa;
- receipt general determinísticamente correlacionable pero aún sin linkage fiscal bloquea;
- candidato ambiguo fail-closed;
- receipt inequívocamente de otro dispatch no bloquea;
- receipt PROCESSED/REJECTED/dead-letter también bloquea;
- correlación tardía queda en generation histórica y activa cuarentena cuando aplica;
- worker `DISPATCHING + attempt IN_PROGRESS` vs reprepare serializa;
- no lease/reclaim temporal existe en V1;
- same dispatch retries conservan root/internal_operation_id;
- different preparation genera root distinta;
- NON_FISCAL no admite columnas fiscales;
- cross-tenant/company/integration/generation falla;
- 001/002 validators siguen PASS;
- MAT-003 sigue siendo prerequisite/readiness, no validación del target 10-table;
- no SQL003/provider/security-state promotion.
