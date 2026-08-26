# SQL 003 contract-gap reconciliation proposal

## 1. Estado, autoridad y límite

Estado: `PROPOSAL_V7 / MODEL_A_SELECTED / NOT_AUTHORITATIVE / INT-006_BLOCKED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento es la propuesta contractual previa a cualquier materialización de PostgreSQL migration 003 Fiscal / Electronic Invoicing. Consolida los findings históricos y los conflictos detectados al contrastar el diseño contra el `main` canónico posterior a las PR #5 y #6.

No modifica ni sustituye todavía:

- `docs/migration/third-target-migration-manifest.md`;
- `docs/architecture/physical-model/electronic-invoicing-schema.md`;
- `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md`;
- `docs/architecture/physical-model/external-integrations-schema.md`;
- `docs/architecture/integration-contracts.md`;
- migrations PostgreSQL 001/002;
- SQL, descriptor, runner, apply/down, introspection o tests de migration 003;
- providers, credenciales, HTTP, capabilities reales o security gates.

Un `PROPOSAL_REVIEW=PASS` autoriza únicamente abrir una remediación documental autoritativa separada. Nunca autoriza SQL 003.

Mientras los conflictos de este documento no estén reconciliados en las fuentes autoritativas, `INT-006` permanece `BLOCKED`.

## 2. Baseline canónico

- `main`: `5d426f2c8ddff3094298f1c776ab67d2eed16ee1`;
- PR #5: `MERGED / CLOSED`; supply-chain baseline y gobernanza detectiva integrados;
- PR #6: `MERGED / CLOSED`; estado canónico README/backlog/governance/CI/módulos reconciliado;
- PR #7: `MERGED / CLOSED`; identidad comercial `Camacho POS Colombia` adoptada sin renombrar identificadores técnicos;
- PR #8: `MERGED / CLOSED`; control detectivo de `main` reforzado para validar todo el rango de primer padre;
- post-merge run #51 `32977942218`: `COMPLETED / SUCCESS`;
- migrations 001/002: `MATERIALIZED / TESTED / IMMUTABLE`;
- `MAT-003-PREFLIGHT`: `EXECUTED / PASS / REVIEWED` en su checkpoint canónico;
- SQL 003: `ABSENT`;
- descriptor 003: `ABSENT`;
- schema `fiscal`: `ABSENT`;
- ledger entry migration 003: `0`;
- SIIGO / FACTUS / ALEGRA: `DESIGNED / NOT_EVALUATED`;
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

WIP histórico de referencia:

- branch `wip/sql003-contract-gap-20260825`;
- commit `dd07f9d429df7b9a2c6dcacaffa39df737cffbbf`;
- contra `main@5d426f2c...`: `DIVERGED / 1 ahead / 41 behind`;
- contiene SQL/runner/introspection/tests preliminares no canónicos.

Clasificación: `HISTORICAL_WIP / NOT_INTEGRABLE / NOT_CHERRY_PICKABLE_AS_A_WHOLE`.

## 3. Findings contractuales

### HIGH-001 — identidad lógica dependiente de material mutable

Problema: el WIP podía derivar `ElectronicDocument.logical_operation_key` de `correction_source_reference`, mutable durante `DRAFT`.

Decisión: `REMEDIATE`.

`logical_operation_key` usa solo identidad estable. Material fiscal, snapshots, importes, referencias humanas, resultados externos y timestamps no participan.

### HIGH-002 — retry confundido con `started_at IS NULL`

Problema: un attempt entra a `IN_PROGRESS` antes del transporte; un `FAILED` legítimo puede conservar `started_at NOT NULL`.

Decisión: `REMEDIATE`.

`started_at` significa únicamente inicio de ejecución. La seguridad de retry se decide mediante evidencia de transporte y de efecto externo.

### HIGH-003 — catálogo físico de operaciones demasiado amplio

Problema: query/status y artifact retrieval existen conceptualmente, pero aún no tienen capability/provider contract suficiente para materialización neutral.

Decisión: `NARROW_V1_EXPLICITLY`.

Migration 003 v1 reconoce únicamente:

```text
SUBMIT_DOCUMENT
```

Quedan fuera de v1:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

Ambas permanecen `DESIGNED / NOT_MATERIALIZED / FAIL_CLOSED` hasta contrato independiente.

### INTERNAL-HIGH-004 — raíz idempotente cambiaba por attempt

Problema: una versión previa derivaba la idempotency key del `attempt_number`, pudiendo derrotar deduplicación provider-facing.

Decisión: `REMEDIATE`.

El dispatch mantiene una raíz idempotente estable. `attempt_number`, `id`, `request_id` y `request_checksum` distinguen ejecuciones; no cambian la intención externa.

### INTERNAL-MEDIUM-005 — complejidad innecesaria de dispatch query/retrieve

Problema: separar dispatches de operaciones no materializadas añadía diseño no necesario a v1.

Decisión: `REMOVE_FROM_V1`.

V1 modela únicamente el dispatch fiscal `SUBMIT_DOCUMENT`. Query/retrieve se diseñarán cuando sus capabilities sean autorizadas.

### CURRENT-HIGH-006 — uniqueness autoritativa impide retry con raíz estable

El manifest 003 exige actualmente:

```text
UNIQUE (
  tenant_id,
  electronic_document_id,
  operation_type,
  idempotency_key
)
```

El mismo contrato exige que un retry:

- conserve `ElectronicDocument`;
- conserve la intención/dispatch;
- conserve idempotencia;
- cree una nueva fila de `FiscalSubmissionAttempt`.

Con una raíz estable, una segunda fila válida colisionaría con esa uniqueness.

Decisión: `REMEDIATE_AUTHORITATIVE_CONTRACT_BEFORE_SQL`.

La remediación deberá conservar simultáneamente:

- `UNIQUE (tenant_id, integration_dispatch_id, attempt_number)` como orden de ejecución;
- historia append-only;
- una raíz idempotente estable por intención;
- conflicto si la misma intención aparece con contenido/checksum incompatible;
- deduplicación provider-facing cuando exista soporte real.

Esta propuesta no prescribe DDL sustituto.

### CURRENT-HIGH-007 — create/replay y mutación DRAFT estaban mezclados

El manifest permite que la misma fila `ElectronicDocument` cambie material fiscal durante `DRAFT` mediante CAS/guards y congela source/material/snapshots/payload al llegar a `READY`.

Por tanto, la regla correcta es:

1. CREATE/PREPARE repetido con misma key + mismo material resuelve al mismo documento;
2. replay o intento de segunda fila con misma key + material diferente produce `CONFLICT`;
3. UPDATE explícito de la misma fila `DRAFT`, autorizado por CAS/guards, puede recalcular material/snapshots/checksum sin cambiar identidad;
4. desde `READY` el payload/checksum quedan congelados;
5. un retry técnico nunca reabre DRAFT ni cambia el payload.

Decisión: `REMEDIATE_PROPOSAL`, ya incorporada en esta V5; la remediación autoritativa debe separar físicamente ambos comandos sin un guard ambiguo.

### CURRENT-HIGH-008 — revalidación pre-submission no tiene ruta completa

El manifest 003 establece simultáneamente que:

- downgrade/retiro bloquea documentos `DRAFT|READY|QUEUED` no transmitidos y exige `revalidación o cancelación explícita`;
- `external_integration_id`, `fiscal_connection_id`, `fiscal_emission_configuration_id` y `emission_configuration_version_id` quedan fuera de los UPDATE ordinarios del documento;
- `logical_operation_key` es única por intención;
- `VOIDED_BEFORE_SUBMISSION` no define por sí solo cómo completar después la misma obligación fiscal.

Decisión V7: `SELECT_MODEL_A / REMEDIATE_AUTHORITATIVE_CONTRACT_BEFORE_SQL`.

Migration 003 v1 adoptará exclusivamente **reprepare preservando el mismo `ElectronicDocument` antes de exposición externa**. El modelo successor/replacement queda fuera de v1 y no puede aparecer como fallback implícito.

La remediación autoritativa deberá cerrar estas reglas:

1. `REPREPARE_BEFORE_SUBMISSION` es un command de aplicación, no un `operation_type` fiscal ni un retry técnico.
2. Solo admite documento `DRAFT|READY|QUEUED`. `SUBMITTING|ACCEPTED|REJECTED|UNKNOWN_OUTCOME|CONTINGENCY|VOIDED_BEFORE_SUBMISSION` lo rechazan.
3. Debe probar durablemente **cero exposición externa** bajo un fence canónico común por `(tenant_id, electronic_document_id, preparation_generation)`: cero `FiscalSubmissionAttempt`; ningún dispatch reclamado o en `DISPATCHING`; cero provider/authority/legal identifiers, respuestas o artifacts; cero `ExternalWebhookReceipt` correlacionable en cualquier estado, incluidos `RECEIVED|PENDING|PROCESSING|APPLIED`; y cero `FiscalReconciliation` o consulta correlacionable `RUNNING` o con evidencia de transporte/efecto. Un receipt pendiente o una reconciliación/consulta en vuelo bloquean la operación, aunque todavía no hayan aplicado resultado.
4. Un `QUEUED` elegible exige que su dispatch siga `QUEUED`, sin attempt ni claim. Ese dispatch se cancela en la misma transacción antes de volver el documento a `DRAFT`. Si la prueba es incompleta, se falla cerrado y se abre reconciliation/incident; nunca se presume no envío.
5. `logical_operation_key`, tenant/company/branch, source identity, `document_type`, original document y causalidad permanecen inmutables.
6. El command puede rebindear exclusivamente `external_integration_id`, `fiscal_connection_id`, `fiscal_emission_configuration_id` y `emission_configuration_version_id`, tras revalidar declaration/adapter/integration/capability/connection/config/version y precedencia branch/company.
7. Fiscal snapshots, canonical payload y checksums se regeneran como una nueva **preparation generation**. La generación inicia en 1, aumenta exactamente una vez por reprepare confirmado y no cambia durante retries.
8. Cada generation crea una intención provider-facing propia. El dispatch anterior queda histórico/cancelado y el nuevo idempotency root incorpora `preparation_generation`; misma generation con checksum distinto sigue siendo conflicto.
9. Toda asignación legal durable previa conserva historia append-only y nunca se reutiliza. Si la re-preparación exige otra numeración, el contrato autoritativo debe preservar la asignación anterior como `RELEASED_WITHOUT_REUSE|BURNED`, con razón y Audit, antes de asignar otra. Sobrescribir la única evidencia de prefix/number queda prohibido; si no existe representación física capaz de conservar ambas asignaciones, la remediación debe detenerse antes de SQL.
10. `numbering_state='CONSUMED|UNKNOWN_OUTCOME|BURNED'`, cualquier identidad externa write-once o cualquier señal de exposición bloquean reprepare.
11. La operación completa usa CAS, locks canónicos, actor, motivo, correlation/causation IDs, Audit y eventos. Submission worker, ingestión/correlación de webhook y reconciliación/consulta deben participar en el mismo fence por documento/generación antes de reclamar trabajo, persistir un receipt correlacionado o iniciar cualquier HTTP; además dejan una marca durable de claim/lease antes de salir de la transacción. La inserción inicial de un receipt correlacionable y el paso de una reconciliation/query a `RUNNING` quedan así serializados contra reprepare.
12. Antes del commit, reprepare vuelve a validar bajo el mismo fence la versión del documento, `preparation_generation`, estado/claim del dispatch, attempts, transport evidence, receipts en todos sus estados y reconciliaciones/consultas en vuelo. Solo después cancela atómicamente el dispatch elegible e incrementa la generación. Toda carrera produce un solo ganador; los demás actores fallan, revalidan o conservan la evidencia contra la generación histórica, sin aplicarla a la nueva.

Esta selección resuelve la ambigüedad de modelo a nivel de propuesta, pero `CURRENT-HIGH-008` continúa bloqueando SQL hasta que las fuentes autoritativas definan la representación física de preparation generation, dispatch e historia de numeración y una revisión independiente concluya `PASS`.

## 4. Identidad lógica de `ElectronicDocument`

### 4.1 Fórmula v1 propuesta

Se calcula una sola vez y permanece inmutable:

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

La serialización debe ser determinista, versionada y sin ambigüedad de delimitación.

No participan:

- `source_version`;
- `correction_source_reference`;
- importes;
- snapshots/checksums;
- `canonical_payload_checksum`;
- configuración fiscal/versiones;
- `branch_id` mientras `source_id` sea globalmente estable y el scope se valide por separado;
- prefix/number;
- provider/authority/legal IDs;
- estados, timestamps o correlation/causation IDs.

Si un source futuro no posee identidad global estable, el contrato debe versionarse antes de admitirlo.

### 4.2 Correctivos

Para `CREDIT_NOTE`, `DEBIT_NOTE` y `SUPPORT_DOCUMENT_ADJUSTMENT`:

- `source_id` identifica la operación correctiva estable;
- `original_electronic_document_id` participa en identidad;
- `correction_source_reference` aporta contexto, no identidad.

Otra corrección legítima necesita otra identidad source/correctiva.

### 4.3 Create/replay vs edición DRAFT

- misma key + mismo material en CREATE/PREPARE: resolución idempotente;
- segunda fila/replay con misma key + material diferente: `CONFLICT`;
- misma fila `DRAFT`: solo material allowlisted, CAS/guards y checksum recalculado;
- desde `READY`: source/material/snapshots/payload/checksum inmutables.

## 5. Attempt, transporte y retry

### 5.1 Timestamps

```text
CREATED      -> started_at=NULL, completed_at=NULL
IN_PROGRESS  -> started_at fijado una vez
COMPLETED    -> completed_at requerido
FAILED       -> completed_at requerido
UNKNOWN_OUTCOME -> completed_at requerido
CANCELLED desde CREATED -> started_at puede permanecer NULL
```

`started_at` nunca prueba ausencia de envío.

### 5.2 Evidencia de transporte v1

```text
NOT_SENT
SENT
RESPONSE_RECEIVED
UNKNOWN
```

- `NOT_SENT`: evidencia local durable demuestra que no salió al transporte;
- `SENT`: llegó al transporte y pudo alcanzar al provider;
- `RESPONSE_RECEIVED`: existe respuesta verificable, cuyo efecto depende del adapter/provider contract;
- `UNKNOWN`: no puede demostrarse transmisión o procesamiento.

HTTP status, provider code, timeout o excepción aislados nunca prueban ausencia de efecto.

### 5.3 Retry classification

```text
SAFE_RETRY
RECONCILE_REQUIRED
NON_RETRYABLE
```

Reglas:

1. `FAILED + NOT_SENT + SAFE_RETRY` puede crear otro attempt si existe evidencia durable de no envío.
2. `FAILED + RESPONSE_RECEIVED + SAFE_RETRY` exige contrato versionado + evidencia inequívoca de no efecto.
3. `SENT|UNKNOWN` sin prueba de no efecto converge fail-closed a `UNKNOWN_OUTCOME / RECONCILE_REQUIRED` o terminal no reintentable respaldado por evidencia.
4. `UNKNOWN_OUTCOME` permanece histórico y bloquea retry ciego.
5. Evidencia posterior de ausencia inequívoca puede autorizar un nuevo attempt sin reescribir el intento incierto previo.
6. `COMPLETED` y `CANCELLED` no se reutilizan como nuevas ejecuciones.

## 6. Dispatch, idempotencia y attempt identity

### 6.1 Root de `IntegrationDispatch`

Para v1:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ operation_type=SUBMIT_DOCUMENT
+ preparation_generation
```

`integration_id` es la FK canónica de `IntegrationDispatch` hacia `ExternalIntegration`. `preparation_generation` inicia en 1 y solo aumenta mediante `REPREPARE_BEFORE_SUBMISSION` confirmado con cero exposición externa.

La raíz identifica una intención central↔provider para una generación preparada y permanece estable durante todos sus retries. El payload checksum se valida contra la raíz, pero no se incorpora. Misma raíz/generation con checksum distinto es conflicto; una nueva generation no es retry y exige un dispatch nuevo, dejando el anterior cancelado e histórico.

### 6.2 Root del attempt

Dentro del mismo dispatch:

```text
FiscalSubmissionAttempt.idempotency_key
== IntegrationDispatch.idempotency_key
```

La ejecución concreta se identifica mediante:

- UUID v7 `id`;
- `integration_dispatch_id`;
- `attempt_number`;
- `request_id`;
- `request_checksum`.

Orden autoritativo:

```text
UNIQUE (tenant_id, integration_dispatch_id, attempt_number)
```

### 6.3 Retry

Un retry permitido:

- conserva `ElectronicDocument`;
- conserva `IntegrationDispatch`;
- conserva `SUBMIT_DOCUMENT`;
- conserva raíz idempotente;
- conserva payload/request checksum si representa exactamente la misma solicitud;
- conserva `preparation_generation`;
- incrementa `attempt_number`;
- crea una nueva fila `CREATED`;
- no modifica filas históricas.

Contenido distinto no es retry del mismo request. Reprepare incrementa generation y crea otro dispatch únicamente bajo las reglas de cero exposición de CURRENT-HIGH-008.

## 7. Scope físico migration 003 v1

Único `operation_type` materializable:

```text
SUBMIT_DOCUMENT
```

`QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` requieren contrato futuro que cierre como mínimo:

- capability/provider declaration;
- readiness y evidencia;
- dispatch intent e idempotency root;
- request/checksum;
- rate limits;
- normalización;
- reconciliation;
- artifacts/evidence;
- timeout/UNKNOWN_OUTCOME;
- permisos, auditoría y pruebas negativas;
- providers que soporten realmente la operación.

La ausencia de query/retrieve automático no autoriza repetir submit. Respuesta síncrona, webhook validado, evidencia manual/authority y `FiscalReconciliation` pueden seguir aportando evidencia sin inventar resultados.

## 8. Invariantes para remediación autoritativa

1. `logical_operation_key` usa solo identidad estable.
2. `correction_source_reference` no participa.
3. create/replay conflictivo y UPDATE DRAFT son comandos distintos.
4. Model A es la única ruta v1 para invalidación permanente pre-submission; successor/replacement queda fuera.
5. reprepare solo admite `DRAFT|READY|QUEUED` con prueba durable de cero exposición y fence compartido por documento/generación.
6. un dispatch `QUEUED` elegible se cancela atómicamente antes de reabrir preparación.
7. logical identity/source/type permanecen inmutables; solo la cadena integration/connection/config/version puede rebindearse.
8. reprepare incrementa `preparation_generation`, regenera snapshots/payload/checksum y crea un dispatch nuevo.
9. cada asignación legal previa permanece append-only y nunca reutilizable; no se sobreescribe evidencia de numeración.
10. cualquier exposición, identidad externa, attempt, receipt correlacionable en cualquier estado, reconciliación/consulta en vuelo, `SUBMITTING` o `UNKNOWN_OUTCOME` bloquea reprepare.
11. `started_at` solo indica inicio de attempt.
12. `transport_status` y `retry_classification` son dimensiones distintas.
13. HTTP/provider code aislado no autoriza retry.
14. `UNKNOWN_OUTCOME` bloquea retry ciego y permanece histórico.
15. `IntegrationDispatch.idempotency_key` es estable por preparation generation.
16. `FiscalSubmissionAttempt.idempotency_key` conserva esa raíz dentro del mismo dispatch.
17. `attempt_number` es monotónico por dispatch y diferencia ejecuciones.
18. retries crean filas nuevas y nunca incrementan preparation generation.
19. la uniqueness incompatible con raíz estable debe reconciliarse antes de SQL.
20. migration 003 v1 materializa únicamente `SUBMIT_DOCUMENT`.
21. query/retrieve quedan fuera hasta contrato posterior revisado.
22. `FiscalSubmissionAttempt` continúa único owner de attempts fiscales.
23. `IntegrationDispatchAttempt` continúa `NON_FISCAL`.
24. migrations 001/002 permanecen byte-for-byte inmutables.
25. SQLite 003 permanece `NONE`.
26. providers y `SEC-G` no cambian de estado.
27. SQL/descriptor/schema fiscal 003 permanecen ausentes hasta autorización separada.
28. worker, webhook y reconciliation/query comparten el fence de documento/generación, persisten claim/lease antes de efectos externos y revalidan antes del commit.

## 9. Consecuencias para el WIP histórico

`dd07f9d...` no puede mergearse ni cherry-pickearse completo.

Una materialización futura debe revisar de cero:

- fórmula de `logical_operation_key`;
- create/replay vs DRAFT mutation;
- reprepare pre-submission, fence compartido con worker/webhook/reconciliation, preparation generation, dispatch cancelado y numeración histórica;
- `operation_type` allowlist;
- uniqueness/idempotency de `FiscalSubmissionAttempt`;
- attempt numbering bajo lock;
- transport/retry/UNKNOWN_OUTCOME;
- request/idempotency/checksum;
- guards, negative tests y static tests.

La existencia del WIP no promueve SQL003 ni descriptor003.

## 10. Criterios de revisión independiente

La revisión debe responder explícitamente:

- ¿la identidad lógica usa solo material estable y distingue correctivos legítimos?;
- ¿CREATE/replay se distingue de una mutación válida de la misma fila DRAFT?;
- ¿Model A queda seleccionado de forma única y successor/replacement excluido de v1?;
- ¿la prueba durable de cero exposición cubre document, dispatch, attempts, transport, receipts pendientes/aplicados, artifacts y reconciliation/query en vuelo bajo un fence compartido?;
- ¿preparation generation separa reprepare de retry y evita reutilizar una raíz con payload distinto?;
- ¿la numeración previa permanece append-only, no reutilizable y no puede perderse por overwrite?;
- ¿se prohíbe reprepare después de cualquier exposición externa o outcome incierto?;
- ¿`started_at` conserva un solo significado?;
- ¿transporte y retry fallan cerrado ante incertidumbre?;
- ¿la raíz idempotente permanece estable entre retries del mismo dispatch?;
- ¿la uniqueness autoritativa debe cambiar para que retries válidos sean materializables?;
- ¿submit-only v1 es coherente con capabilities/providers actuales?;
- ¿001/002, SQLite, providers y security gates permanecen sin promoción?;
- ¿existe otro BLOCKER/HIGH/MEDIUM contra manifest, PHY-G12, UC-EINV-001, External Integrations, integration contracts u ownership?

Resultado permitido:

```text
PROPOSAL_REVIEW = PASS | PASS_WITH_REMEDIATION | FAIL
```

Solo `PASS` permite abrir `FISCAL-003-CONTRACT-AUTHORITY-REMEDIATION`.

## 11. Gate actual

```text
FISCAL-003-CONTRACT-GAP-RECONCILIATION-PROPOSAL
= MATERIALIZED
/ INTERNAL_REVIEW_REMEDIATED
/ BASELINE_SYNCED
/ MODEL_A_SELECTED
/ INT-006_BLOCKED
/ REQUIRES_FRESH_CI
/ REQUIRES_INDEPENDENT_REVIEW
```

El siguiente gate sigue siendo exclusivamente documental. SQL 003, descriptor 003, schema `fiscal`, provider adapters y security-gate promotion permanecen fuera de alcance.
