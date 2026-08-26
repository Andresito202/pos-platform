# SQL 003 contract-gap reconciliation proposal

## 1. Estado, autoridad y límite

Estado: `PROPOSAL_V5 / NOT_AUTHORITATIVE / INT-006_BLOCKED / NOT_FOR_SQL_MATERIALIZATION`.

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

- `main`: `412f4ddb59c05371b2eb629ccf37b6de74efcc48`;
- PR #5: `MERGED / CLOSED`; supply-chain baseline y gobernanza detectiva integrados;
- PR #6: `MERGED / CLOSED`; estado canónico README/backlog/governance/CI/módulos reconciliado;
- post-merge run #42 `32934447498`: `COMPLETED / SUCCESS`;
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
- contra `main@412f4ddb...`: `DIVERGED / 1 ahead / 35 behind`;
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
- `external_integration_id`, `fiscal_connection_id`, `fiscal_emission_configuration_id` y `emission_configuration_version_id` quedan fuera de los UPDATE permitidos del documento y son tratados como referencias de identidad/scope congeladas;
- `logical_operation_key` es única por intención;
- `VOIDED_BEFORE_SUBMISSION` existe, pero no define una semántica de successor/replacement para completar después la misma obligación fiscal.

Hay dos casos distintos:

1. **misma cadena congelada vuelve a ser válida**: revalidar puede limitarse a comprobar nuevamente declaration/adapter/integration/capability/connection/config/version y permitir continuar sin mutar referencias;
2. **la cadena congelada queda permanentemente inválida o es reemplazada**: el contrato actual no define cómo completar la misma intención fiscal sin violar inmutabilidad o crear una segunda fila con la misma logical key.

Decisión: `REMEDIATE_AUTHORITATIVE_CONTRACT_BEFORE_SQL`.

La remediación autoritativa deberá escoger y cerrar **un solo modelo**, con pruebas negativas:

#### Modelo A — reprepare preservando identidad antes de exposición externa

Permitir que el mismo `ElectronicDocument` sea re-preparado únicamente cuando exista evidencia durable de **cero exposición externa**, definiendo explícitamente:

- estados desde los que puede reentrar a preparación;
- si `READY` puede volver a una fase mutable;
- tratamiento de un `QUEUED` cuyo dispatch aún no produjo transporte;
- campos de integration/connection/config/version que pueden rebindearse;
- regeneración de fiscal snapshot/payload/checksum;
- tratamiento de numeración reservada y huecos;
- cancelación histórica del dispatch anterior y creación de una nueva intención provider-facing cuando cambie `integration_id`;
- CAS, locks, Audit y eventos.

#### Modelo B — successor/replacement document

Mantener completamente inmutable el documento original y crear un successor explícito, definiendo:

- relación de reemplazo y motivo;
- cómo se conserva una sola intención fiscal activa;
- cómo cambia la uniqueness de `logical_operation_key` sin permitir duplicados;
- tratamiento de `VOIDED_BEFORE_SUBMISSION`;
- numeración, snapshots, Audit y dispatches;
- prohibición absoluta de successor si hubo exposición externa incierta.

Hasta elegir y revisar uno de estos modelos, cualquier SQL que materialice 003 podría dejar una obligación fiscal atrapada o permitir duplicidad. Por eso este finding es bloqueante.

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
```

`integration_id` es la FK canónica de `IntegrationDispatch` hacia `ExternalIntegration`.

La raíz identifica una intención central↔provider y permanece estable mientras se trate de la misma intención. El payload checksum se valida contra la raíz, pero no se incorpora para evitar que material diferente cree silenciosamente otra intención.

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
- incrementa `attempt_number`;
- crea una nueva fila `CREATED`;
- no modifica filas históricas.

Contenido distinto no es retry del mismo request.

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
4. desde `READY`, payload/checksum quedan congelados salvo que el modelo de reprepare futuro defina explícitamente una transición previa a exposición externa.
5. una invalidación pre-submission debe tener una ruta completa y no atrapada: reprepare del mismo documento o successor formal, pero no ambos implícitos.
6. jamás se rebindeará/reemplazará después de evidencia de envío o `UNKNOWN_OUTCOME`.
7. `started_at` solo indica inicio de attempt.
8. `transport_status` y `retry_classification` son dimensiones distintas.
9. HTTP/provider code aislado no autoriza retry.
10. `UNKNOWN_OUTCOME` bloquea retry ciego y permanece histórico.
11. `IntegrationDispatch.idempotency_key` es estable por intención submit.
12. `FiscalSubmissionAttempt.idempotency_key` conserva esa raíz dentro del mismo dispatch.
13. `attempt_number` es monotónico por dispatch y diferencia ejecuciones.
14. retries crean filas nuevas.
15. la uniqueness incompatible con raíz estable debe reconciliarse antes de SQL.
16. migration 003 v1 materializa únicamente `SUBMIT_DOCUMENT`.
17. query/retrieve quedan fuera hasta contrato posterior revisado.
18. `FiscalSubmissionAttempt` continúa único owner de attempts fiscales.
19. `IntegrationDispatchAttempt` continúa `NON_FISCAL`.
20. migrations 001/002 permanecen byte-for-byte inmutables.
21. SQLite 003 permanece `NONE`.
22. providers y `SEC-G` no cambian de estado.
23. SQL/descriptor/schema fiscal 003 permanecen ausentes hasta autorización separada.

## 9. Consecuencias para el WIP histórico

`dd07f9d...` no puede mergearse ni cherry-pickearse completo.

Una materialización futura debe revisar de cero:

- fórmula de `logical_operation_key`;
- create/replay vs DRAFT mutation;
- revalidación/reprepare/replacement pre-submission;
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
- ¿la propuesta detecta correctamente el dead-end de revalidación cuando la cadena congelada queda permanentemente inválida?;
- ¿los dos modelos permitidos para resolver HIGH-008 son suficientes y mutuamente explícitos, sin autorizar ambos a la vez por accidente?;
- ¿se prohíbe reprepare/replacement después de cualquier exposición externa o outcome incierto?;
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
/ INT-006_BLOCKED
/ REQUIRES_FRESH_CI
/ REQUIRES_INDEPENDENT_REVIEW
```

El siguiente gate sigue siendo exclusivamente documental. SQL 003, descriptor 003, schema `fiscal`, provider adapters y security-gate promotion permanecen fuera de alcance.