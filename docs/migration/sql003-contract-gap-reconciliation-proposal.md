# SQL 003 contract-gap reconciliation proposal

## 1. Estado y autoridad

Estado: `PROPOSAL_V4 / NOT_AUTHORITATIVE / INT-006_BLOCKED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento propone la reconciliación contractual previa a cualquier SQL 003. Sustituye dentro de esta rama las versiones anteriores de la propuesta, responde a los findings históricos `HIGH-001`, `HIGH-002` y `HIGH-003`, a las ambigüedades internas `INTERNAL-HIGH-004` e `INTERNAL-MEDIUM-005`, y registra los conflictos contractuales confirmados durante la auditoría canónica posterior a las PR #5 y #6.

No modifica ni sustituye todavía:

- `docs/migration/third-target-migration-manifest.md`;
- `docs/architecture/physical-model/electronic-invoicing-schema.md`;
- `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md`;
- `docs/architecture/physical-model/external-integrations-schema.md`;
- `docs/architecture/integration-contracts.md`;
- migrations PostgreSQL 001/002;
- SQL, descriptor, runner o tests de migration 003.

Esta propuesta requiere revisión independiente. Incluso un `PASS` autorizará solamente una remediación documental autoritativa separada. No autoriza crear, copiar, cherry-pickear, ejecutar ni aplicar SQL 003.

Mientras esta propuesta no obtenga `PROPOSAL_REVIEW=PASS` y la remediación autoritativa posterior no cierre los conflictos, `INT-006` permanece `BLOCKED` conforme al backlog canónico.

## 2. Baseline canónico

- `main`: `412f4ddb59c05371b2eb629ccf37b6de74efcc48`;
- PR #2: `MERGED / CLOSED`;
- PR #5: `MERGED / CLOSED`; supply-chain baseline y gobernanza detectiva de `main` integrados;
- PR #6: `MERGED / CLOSED`; reconciliación canónica de README/backlog/governance/CI/módulos integrada;
- run post-merge #42 (`32934447498`): `COMPLETED / SUCCESS`, incluido `Main push governance = SUCCESS`;
- migration 001: `MATERIALIZED / TESTED / IMMUTABLE`;
- migration 002: `MATERIALIZED / TESTED / IMMUTABLE`;
- `MAT-003-PREFLIGHT`: `EXECUTED / PASS / REVIEWED` en `LOCAL_CANONICAL_INTEGRATION`;
- SQL 003: `ABSENT` en `main`;
- descriptor 003: `ABSENT` en `main`;
- fiscal schema: `ABSENT`;
- ledger entry count de migration 003: `0`;
- SIIGO/FACTUS/ALEGRA: `DESIGNED / NOT_EVALUATED`;
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

Checkpoint WIP de referencia:

- rama: `wip/sql003-contract-gap-20260825`;
- commit: `dd07f9d429df7b9a2c6dcacaffa39df737cffbbf`;
- relación frente a `main@412f4ddb59c05371b2eb629ccf37b6de74efcc48`: `DIVERGED`, `1 ahead / 35 behind`;
- contiene SQL 003, cambios de runner/introspection/contract y tests preliminares no canónicos.

El WIP es `HISTORICAL_WIP / NOT_INTEGRABLE`: conserva evidencia para revisión, no es una base de implementación. No se permite merge ni cherry-pick completo.

## 3. Findings y decisión de alcance

### HIGH-001 — identidad lógica dependiente de material mutable

`ElectronicDocument.logical_operation_key` es identidad fiscal durable, pero el candidato WIP permitía que su fórmula dependiera de `correction_source_reference`, que puede cambiar durante `DRAFT`.

Decisión propuesta: `REMEDIATE`.

La identidad lógica debe usar solo identidad estable; material, snapshots, referencias humanas, resultados externos y timestamps quedan fuera de su fórmula.

### HIGH-002 — retry seguro confundido con `started_at IS NULL`

Un attempt pasa `CREATED -> IN_PROGRESS` antes de ejecutar la interacción. Un `FAILED` alcanzado desde `IN_PROGRESS` puede y normalmente debe conservar `started_at`.

Decisión propuesta: `REMEDIATE`.

`started_at` significa únicamente que comenzó la ejecución del attempt. La seguridad de retry se decide con evidencia de transporte/efecto externo y nunca por `started_at IS NULL`.

### HIGH-003 — alcance físico de `operation_type` no cerrado

El modelo conceptual contempla emisión, consulta y recuperación de artefactos, pero migration 003 aún no tiene contratos provider/capability suficientemente cerrados para automatizar consulta o recuperación externa de forma neutral.

Decisión propuesta: `NARROW_V1_EXPLICITLY`.

Migration 003 v1 materializará únicamente:

```text
SUBMIT_DOCUMENT
```

`QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen `DESIGNED / NOT_MATERIALIZED` y requieren contrato futuro independiente antes de añadirse al catálogo físico.

Esto no elimina las capacidades conceptuales. Únicamente evita afirmar en migration 003 una automatización cuyo capability gate/provider contract todavía no existe.

### INTERNAL-HIGH-004 — idempotencia del attempt podía cambiar en cada retry

Una versión anterior de esta propuesta derivaba `FiscalSubmissionAttempt.idempotency_key` de `attempt_number`. Eso puede producir una clave externa diferente para un retry de la misma intención y derrotar la deduplicación de un proveedor con idempotencia nativa.

Decisión propuesta: `REMEDIATE`.

La intención externa conserva una raíz de idempotencia estable por dispatch. El número de attempt identifica ejecución/historia, pero no cambia por sí mismo la raíz idempotente de la operación.

### INTERNAL-MEDIUM-005 — dispatches de submit/query/retrieve mezclaban alcance innecesario

La versión anterior separó dispatches por operación, pero esa complejidad deja de ser necesaria al cerrar migration 003 v1 como submit-only.

Decisión propuesta: `REMOVE_FROM_V1`.

Migration 003 v1 solo necesita el dispatch fiscal de `SUBMIT_DOCUMENT`. Query/retrieve tendrán su propio diseño de dispatch, capability e idempotencia cuando se autoricen en una migration/contrato posterior.

### CURRENT-HIGH-006 — constraint autoritativo incompatible con retry de raíz estable

El `third-target-migration-manifest.md` canónico exige actualmente, para `FiscalSubmissionAttempt`, una unicidad equivalente a:

```text
UNIQUE (tenant_id, electronic_document_id, operation_type, idempotency_key)
```

El mismo contrato también establece que un retry técnico crea una fila nueva. La propuesta corregida exige que los attempts del mismo dispatch conserven una raíz idempotente estable.

Esas reglas no pueden coexistir si el retry usa el mismo `electronic_document_id`, el mismo `operation_type` y la misma raíz idempotente: la segunda fila válida chocaría contra la unicidad autoritativa actual.

Decisión propuesta: `REMEDIATE_AUTHORITATIVE_CONTRACT_BEFORE_SQL`.

La futura remediación autoritativa deberá eliminar esta incompatibilidad sin debilitar:

- identidad única de cada ejecución;
- monotonicidad/uniqueness de `attempt_number` dentro del dispatch;
- conflicto explícito cuando una misma intención se presenta con contenido/checksum diferente;
- historia append-only de attempts;
- deduplicación provider-facing cuando el proveedor soporte idempotencia.

Esta propuesta no prescribe todavía un DDL sustituto. La forma física exacta debe ser revisada y aprobada en la remediación autoritativa antes de materializar migration 003.

### CURRENT-HIGH-007 — conflicto de checksum no distinguía creación/replay de mutación DRAFT autorizada

El manifest autoritativo define `ElectronicDocument` como `BUSINESS_MUTABLE` durante `DRAFT` y permite, con CAS/guards, actualizar material fiscal antes de `READY`, momento a partir del cual source, importes, snapshots y payload quedan congelados.

La versión anterior de esta propuesta decía de forma absoluta:

`misma logical_operation_key + checksum distinto = CONFLICT`.

Sin contexto, esa frase podía interpretarse como prohibición de una actualización legítima de la **misma fila DRAFT**, contradiciendo el lifecycle autoritativo.

Decisión propuesta: `REMEDIATE_PROPOSAL`.

La regla se separa así:

1. una repetición de CREATE/PREPARE no puede crear un segundo documento con la misma `logical_operation_key`;
2. mismo comando/idempotency intent + mismo checksum resuelve al mismo documento;
3. un replay o intento de crear otra fila con la misma key y material distinto produce `CONFLICT`;
4. una modificación explícita de la misma fila `DRAFT`, autorizada por el contrato vigente, con `expected_version`/CAS y guards aplicables, puede recalcular material/snapshots/checksum sin cambiar la `logical_operation_key`;
5. desde `READY`, el payload y su checksum quedan congelados y cualquier intento de mutarlos falla;
6. un retry técnico de transmisión nunca reabre mutabilidad DRAFT ni cambia el payload canónico.

Esta distinción no crea una segunda identidad ni autoriza cambios después de exposición fiscal. Mantiene un solo `ElectronicDocument` por intención lógica y respeta la mutabilidad controlada que ya existe en el manifest.

## 4. Identidad lógica de `ElectronicDocument`

### 4.1 Fórmula v1 propuesta

`logical_operation_key` se calcula una sola vez durante `PREPARE`, antes de cualquier HTTP, y permanece inmutable.

Entrada canónica:

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

La serialización debe ser determinista, versionada y sin ambigüedad de delimitación. La representación persistida puede ser canónica o un digest estable del material canónico.

### 4.2 Campos excluidos de identidad

No participan:

- `source_version`;
- `correction_source_reference`;
- importes;
- tax/fiscal snapshots y checksums;
- `canonical_payload_checksum`;
- configuración fiscal/versiones;
- `branch_id` mientras `source_id` conserve identidad global estable y el scope se valide por separado;
- prefijo/número fiscal;
- provider/authority/legal identifiers;
- estados;
- timestamps;
- correlation/causation IDs.

Si un source futuro no posee identidad global estable, el contrato deberá versionarse antes de admitirlo.

### 4.3 Correctivos

Para `CREDIT_NOTE`, `DEBIT_NOTE` y `SUPPORT_DOCUMENT_ADJUSTMENT`:

- `source_id` identifica el aggregate/operación correctiva estable;
- `original_electronic_document_id` participa en la identidad;
- `correction_source_reference` conserva contexto operativo pero no identidad.

Una corrección legítima adicional requiere otra identidad source/correctiva; no muta una key existente.

### 4.4 Conflicto de payload y edición DRAFT

La unicidad de `logical_operation_key` impide crear dos `ElectronicDocument` para la misma intención, pero no convierte la key en un bloqueo contra la mutabilidad DRAFT ya autorizada.

Reglas:

- CREATE/PREPARE repetido con la misma key y mismo material/checksum resuelve idempotentemente al mismo documento;
- CREATE/PREPARE repetido, replay o intento de segunda fila con la misma key y material/checksum diferente produce `CONFLICT`;
- una actualización explícita de la misma fila `DRAFT` puede cambiar únicamente el material permitido por el contrato autoritativo, bajo CAS/guards, y recalcula sus snapshots/checksum sin cambiar identidad;
- desde `READY`, source/material/snapshots/payload/checksum quedan congelados;
- un retry técnico nunca crea otro `ElectronicDocument` ni modifica su payload canónico.

La futura remediación autoritativa deberá precisar dónde se evalúa el conflicto create/replay y dónde aplica la transición DRAFT autorizada, sin depender de un trigger ambiguo que confunda ambos comandos.

## 5. Attempt, transporte y retry

### 5.1 Semántica de timestamps

- `CREATED`: `started_at=NULL`, `completed_at=NULL`;
- `CREATED -> IN_PROGRESS`: fija `started_at` una sola vez;
- terminal alcanzado desde `IN_PROGRESS`: conserva `started_at NOT NULL`;
- `COMPLETED|FAILED|UNKNOWN_OUTCOME`: fija `completed_at` al cerrar;
- `CANCELLED` desde `CREATED` puede conservar `started_at=NULL`.

`started_at` nunca prueba ausencia de envío.

### 5.2 Evidencia de transporte v1

`transport_status` propuesto:

```text
NOT_SENT
SENT
RESPONSE_RECEIVED
UNKNOWN
```

- `NOT_SENT`: evidencia local durable demuestra que la petición no salió al transporte;
- `SENT`: se entregó al transporte y pudo alcanzar al provider;
- `RESPONSE_RECEIVED`: existe respuesta verificable, cuyo significado de efecto depende del contrato del adapter/provider;
- `UNKNOWN`: no puede probarse transmisión o procesamiento.

HTTP status, provider code, timeout o excepción aislados no prueban ausencia de efecto.

### 5.3 Clasificación de retry v1

```text
SAFE_RETRY
RECONCILE_REQUIRED
NON_RETRYABLE
```

Reglas:

1. `FAILED + NOT_SENT + SAFE_RETRY` puede generar otro attempt con evidencia durable de no envío.
2. `FAILED + RESPONSE_RECEIVED + SAFE_RETRY` solo es válido si un contrato versionado y evidencia concreta demuestran ausencia inequívoca de efecto externo.
3. Un `4xx`, `5xx`, error de socket o código provider aislado no basta para `SAFE_RETRY`.
4. `SENT` o `UNKNOWN` sin evidencia de no efecto convergen fail-closed a `UNKNOWN_OUTCOME / RECONCILE_REQUIRED` o a un terminal no reintentable respaldado por evidencia.
5. `UNKNOWN_OUTCOME` nunca se reescribe para ocultar historia y bloquea retry ciego.
6. Si evidencia posterior demuestra ausencia inequívoca de procesamiento, se puede autorizar un attempt nuevo del mismo dispatch sin modificar el attempt incierto anterior.
7. `COMPLETED` es histórico terminal.
8. `CANCELLED` no se reutiliza como retry.

## 6. Idempotencia y numeración de attempts

### 6.1 `IntegrationDispatch` como intención estable

Para migration 003 v1 existe una intención externa fiscal por `SUBMIT_DOCUMENT`.

`IntegrationDispatch.idempotency_key` es la raíz estable de esa intención central↔provider. La misma raíz con payload checksum diferente produce conflicto, no otra intención.

Una fórmula normativa exacta deberá quedar cerrada en la remediación autoritativa, pero debe depender únicamente de identidad estable, como mínimo:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ operation_type=SUBMIT_DOCUMENT
```

`integration_id` es el nombre canónico de la FK usada por `IntegrationDispatch` hacia `ExternalIntegration` en el contrato físico de External Integrations.

El payload checksum se valida contra la raíz; no se incorpora a la raíz para evitar que contenido diferente cree silenciosamente otra intención.

### 6.2 `FiscalSubmissionAttempt.idempotency_key`

Para todos los retries del mismo dispatch submit:

```text
FiscalSubmissionAttempt.idempotency_key
== IntegrationDispatch.idempotency_key
```

La clave permanece estable entre attempts de la misma intención.

El adapter puede mapear esa raíz a la representación exigida por un provider, pero la representación provider-facing también debe permanecer estable para retries de la misma intención cuando el provider soporte idempotencia. Nunca cambia únicamente porque cambió `attempt_number`.

Si el provider no ofrece idempotencia nativa, la plataforma conserva igualmente su raíz interna; el retry continúa sujeto a las reglas fail-closed de evidencia de §5.

### 6.3 Identidad de ejecución del attempt

Un attempt concreto se identifica por:

- UUID v7 `id`;
- `integration_dispatch_id`;
- `attempt_number` monotónico;
- `request_id` estable de esa ejecución;
- `request_checksum`.

`attempt_number` aumenta bajo lock del mismo dispatch. La autoridad física de orden es:

```text
UNIQUE (tenant_id, integration_dispatch_id, attempt_number)
```

No se necesita crear una idempotency key nueva para distinguir attempts.

Cualquier candidato SQL que impida repetir la misma raíz idempotente entre attempts o derive la raíz de `attempt_number` queda `NOT_REUSABLE` y debe remediarse antes de materialización.

### 6.4 Retry como nueva fila

Un retry permitido:

- conserva `ElectronicDocument`;
- conserva `IntegrationDispatch`;
- conserva `operation_type='SUBMIT_DOCUMENT'`;
- conserva la raíz idempotente;
- conserva el mismo payload canónico/request checksum cuando representa exactamente la misma solicitud;
- incrementa `attempt_number`;
- crea nueva fila `CREATED`;
- no modifica la fila histórica anterior.

Si cambia el contenido de la solicitud, no es retry del mismo request y debe fallar por conflicto o seguir un flujo contractual nuevo explícito.

## 7. Alcance físico v1 de `operation_type`

Migration 003 v1 reconoce exactamente:

```text
SUBMIT_DOCUMENT
```

No reconoce todavía:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

### 7.1 Qué sigue funcionando sin automatizar query/retrieve

- respuesta síncrona del submit puede aportar estado y artefactos;
- webhook validado puede aportar evidencia inbound;
- `FiscalArtifact` puede persistir evidencia obtenida por el submit o inbound autorizado;
- `FiscalReconciliation` conserva discrepancias, evidencia manual/inbound, review y cierre;
- `UNKNOWN_OUTCOME` permanece visible y fail-closed cuando no exista una vía automática autorizada de consulta.

No se inventa éxito/rechazo ni se repite submit para suplir la ausencia de query.

### 7.2 Gate futuro para query/retrieve

Antes de materializar `QUERY_DOCUMENT_STATUS` o `RETRIEVE_ARTIFACT`, una tarea separada deberá definir y revisar:

- capability/provider declaration exacta;
- readiness mínima y evidencia requerida;
- dispatch intent e idempotency root;
- request/checksum contract;
- rate limits;
- resultado/normalización;
- interacción con `FiscalReconciliation`;
- artifacts/evidence;
- timeout/UNKNOWN_OUTCOME;
- permisos, auditoría y pruebas negativas;
- providers que realmente soportan cada operación.

Hasta entonces esas operaciones son `DESIGNED / NOT_MATERIALIZED / FAIL_CLOSED`.

## 8. Invariantes que deberá adoptar la remediación autoritativa

1. `logical_operation_key` usa solo identidad inmutable.
2. `correction_source_reference` no participa en identidad.
3. un create/replay con la misma key lógica y material distinto produce conflicto; una modificación autorizada de la misma fila DRAFT se rige por CAS/guards y no crea otra identidad.
4. desde `READY`, payload/checksum son inmutables.
5. `started_at` solo representa inicio del attempt.
6. `transport_status` y `retry_classification` tienen responsabilidades distintas.
7. código HTTP/provider aislado no autoriza retry.
8. `UNKNOWN_OUTCOME` bloquea retry ciego y permanece histórico.
9. `IntegrationDispatch.idempotency_key` es estable por intención submit.
10. `FiscalSubmissionAttempt.idempotency_key` conserva exactamente esa raíz dentro del mismo dispatch.
11. `attempt_number` identifica ejecución y es monotónico por dispatch.
12. retries crean filas nuevas sin cambiar la raíz idempotente.
13. el constraint autoritativo actual que impide repetir la raíz idempotente entre attempts debe quedar reconciliado antes de SQL.
14. migration 003 v1 usa únicamente `SUBMIT_DOCUMENT`.
15. query/retrieve quedan fuera hasta contrato posterior revisado.
16. `FiscalSubmissionAttempt` permanece único owner de attempts fiscales.
17. `IntegrationDispatchAttempt` permanece `NON_FISCAL`.
18. migrations 001/002 permanecen byte-for-byte inmutables.
19. SQLite 003 continúa `NONE`.
20. providers y `SEC-G` no cambian de estado por esta propuesta.
21. SQL/descriptor/schema fiscal 003 continúan ausentes hasta autorización separada.

## 9. Consecuencias para el candidato WIP

El checkpoint `dd07f9d...` no puede integrarse ni cherry-pickearse completo.

En particular, una futura materialización deberá revisar de cero contra este contrato:

- fórmula de `logical_operation_key`;
- manejo de create/replay vs actualización DRAFT;
- `operation_type` allowlist;
- `fiscal_submission_attempts_idempotency_uq` o cualquier constraint equivalente incompatible con raíz estable;
- guard de numeración de attempts;
- estados/guards de retry;
- request/idempotency/checksum;
- static tests que codifiquen esas decisiones.

La existencia del WIP no promueve SQL003 ni descriptor003 en `main`.

## 10. Criterios de revisión independiente

La revisión debe responder explícitamente:

- ¿la identidad lógica usa solo campos inmutables y distingue correctivos legítimos?;
- ¿la propuesta diferencia correctamente un create/replay conflictivo de una actualización válida de la misma fila DRAFT?;
- ¿desde READY el payload queda efectivamente congelado?;
- ¿`started_at` conserva un único significado?;
- ¿la semántica de transporte distingue no-envío, envío, respuesta e incertidumbre sin inferencias inseguras?;
- ¿`SAFE_RETRY` requiere evidencia suficiente de no efecto?;
- ¿un `UNKNOWN_OUTCOME` nunca se repite a ciegas?;
- ¿la raíz idempotente permanece estable entre retries del mismo dispatch?;
- ¿`attempt_number` diferencia ejecuciones sin cambiar la raíz provider-facing?;
- ¿el manifest autoritativo debe reconciliar su uniqueness para permitir retries válidos sin perder conflicto/checksum/orden?;
- ¿submit-only v1 es consistente con el estado real de providers/capabilities?;
- ¿query/retrieve quedan expresamente diferidos sin impedir evidencia inbound/manual?;
- ¿001/002, providers, security gates y SQLite permanecen sin promoción?;

Resultado permitido:

`PROPOSAL_REVIEW = PASS | PASS_WITH_REMEDIATION | FAIL`.

Solo `PASS` permite abrir la remediación autoritativa documental.

## 11. Gates

Gate actual:

`FISCAL-003-CONTRACT-GAP-RECONCILIATION-PROPOSAL = MATERIALIZED / INTERNAL_REVIEW_REMEDIATED / BASELINE_SYNCED / INT-006_BLOCKED / REQUIRES_FRESH_CI / REQUIRES_INDEPENDENT_REVIEW`.

Gate siguiente, únicamente después de `CI=PASS` y `PROPOSAL_REVIEW=PASS`:

`FISCAL-003-CONTRACT-AUTHORITY-REMEDIATION`.

Ese gate seguirá siendo exclusivamente documental. SQL 003, descriptor 003 y fiscal schema seguirán `ABSENT` hasta otra autorización específica.