# SQL 003 contract-gap reconciliation proposal

## 1. Estado y autoridad

Estado: `PROPOSAL / NOT_AUTHORITATIVE / NOT_FOR_SQL_MATERIALIZATION`.

Este documento propone una reconciliación limitada para los tres findings contractuales `HIGH-001`, `HIGH-002` y `HIGH-003` preservados en `wip/sql003-contract-gap-20260825`.

No modifica ni sustituye todavía:

- `docs/migration/third-target-migration-manifest.md`;
- `docs/architecture/physical-model/electronic-invoicing-schema.md`;
- `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md`;
- `docs/architecture/integration-contracts.md`;
- migrations PostgreSQL 001/002;
- SQL, descriptor, runner o tests de migration 003.

La aprobación de esta propuesta requerirá revisión independiente. Solo después podrá existir una remediación autoritativa separada. Esta propuesta no autoriza crear, copiar, cherry-pickear, ejecutar ni aplicar SQL 003.

## 2. Baseline y relación con el WIP histórico

Baseline canónico de esta propuesta:

- `main`: `0110df5d2b7862d9faeb69b1e9fd7e0bc978a7a1`;
- PR #2: `MERGED / CLOSED`;
- migration 001: `MATERIALIZED / TESTED / IMMUTABLE`;
- migration 002: `MATERIALIZED / TESTED / IMMUTABLE`;
- `MAT-003-PREFLIGHT`: `EXECUTED / PASS / REVIEWED` en `LOCAL_CANONICAL_INTEGRATION`;
- SQL 003: `ABSENT` en `main`;
- descriptor 003: `ABSENT` en `main`;
- fiscal schema: `ABSENT`;
- ledger entry count de migration 003: `0`.

Checkpoint WIP de referencia:

- rama: `wip/sql003-contract-gap-20260825`;
- commit: `dd07f9d429df7b9a2c6dcacaffa39df737cffbbf`;
- merge-base histórico: `cb1dafdc987104a5fdc75034de833df157cbfe67`;
- relación frente al `main` actual: `DIVERGED`, `1 ahead / 17 behind`.

Consecuencia: el WIP no es una base de implementación. No se permite merge ni cherry-pick completo. Sus ocho archivos y sus hashes sirven únicamente como evidencia histórica para revisar decisiones y evitar pérdida de contexto.

## 3. Findings revalidados

### HIGH-001 — Identidad lógica dependiente de material mutable

El aggregate `ElectronicDocument` trata `logical_operation_key` como identidad fiscal única e inmutable. Al mismo tiempo, `correction_source_reference` pertenece al material que puede cambiar mientras el documento continúa `DRAFT`.

Una key lógica no puede depender de un valor que pueda cambiar después de crear la intención. Si lo hace, la misma intención podría producir raíces distintas según el instante de cálculo y romper deduplicación, numeración, replay y auditoría.

Resultado de esta propuesta: `VALID / REQUIRES CONTRACT RECONCILIATION`.

### HIGH-002 — Retry seguro confundido con `started_at IS NULL`

`FiscalSubmissionAttempt` se crea en `CREATED` y la interacción externa comienza al pasar a `IN_PROGRESS`. Un attempt que llega a `FAILED` ya inició ejecución y, por tanto, puede tener `started_at` no nulo.

Usar `started_at IS NULL` como prueba de que `FAILED` es reintentable hace inalcanzable el retry permitido y mezcla dos preguntas diferentes:

1. ¿el worker comenzó a ejecutar el attempt?;
2. ¿la petición pudo haber alcanzado al provider?

Resultado de esta propuesta: `VALID / REQUIRES TRANSPORT SEMANTICS`.

### HIGH-003 — Alcance de `operation_type` no cerrado

El contrato conceptual de `FiscalSubmissionAttempt` cubre emisión, consulta y recuperación de artefactos. Polling y reconciliation pueden incorporar evidencia externa sin reescribir attempts históricos. El candidato WIP proponía estrechar migration 003 a `SUBMIT_DOCUMENT` sin una decisión autoritativa equivalente.

Resultado de esta propuesta: `VALID / REQUIRES V1 OPERATION CATALOG`.

## 4. Decisión propuesta para HIGH-001

### 4.1 `logical_operation_key` v1

`logical_operation_key` se calcula una sola vez durante `PREPARE`, antes de cualquier HTTP, y permanece inmutable durante toda la vida del documento.

La entrada canónica v1 propuesta es:

```text
FISCAL_LOGICAL_OPERATION_V1
+ tenant_id
+ company_id
+ source_type
+ source_id
+ document_type
+ original_electronic_document_id | NULL
```

La serialización debe ser determinista, versionada y sin ambigüedades de delimitación. El valor persistido puede ser la representación canónica o su digest estable, siempre que el contrato de cálculo quede versionado y verificable.

### 4.2 Campos expresamente excluidos

No participan en `logical_operation_key`:

- `source_version`;
- `correction_source_reference`;
- importes;
- tax/fiscal snapshots y sus checksums;
- `canonical_payload_checksum`;
- versión de configuración fiscal;
- `branch_id`, porque `source_id` debe ser una identidad global estable y el scope tenant/company/branch se valida y congela por separado; si un source futuro usa identidad solo local a branch, este contrato deberá versionarse antes de admitirlo;
- prefijo o número fiscal;
- provider/authority/legal identifiers;
- estados;
- timestamps;
- correlation/causation IDs.

Razón: todos esos valores son material, evidencia, resolución o contexto operacional; no son la identidad primaria de la intención.

### 4.3 Correctivos

Para `CREDIT_NOTE`, `DEBIT_NOTE` y `SUPPORT_DOCUMENT_ADJUSTMENT`:

- `source_id` debe identificar el aggregate/operación correctiva estable que originó el documento;
- `original_electronic_document_id` participa en la key;
- `correction_source_reference` conserva contexto humano/operativo y puede ajustarse en `DRAFT`, pero no cambia la identidad lógica.

Una segunda corrección legítima requiere otro `source_id`/aggregate correctivo, no mutar una key ya creada.

### 4.4 Regla de idempotencia de documento

- misma `logical_operation_key` + mismo `canonical_payload_checksum`: resolución idempotente al mismo `ElectronicDocument`;
- misma `logical_operation_key` + checksum distinto: `CONFLICT`, nunca creación silenciosa de otro documento;
- un retry técnico nunca crea otro `ElectronicDocument`.

## 5. Decisión propuesta para HIGH-002

### 5.1 Semántica de timestamps

- `CREATED`: `started_at = NULL`, `completed_at = NULL`;
- `CREATED -> IN_PROGRESS`: fija `started_at` una sola vez;
- cualquier estado terminal alcanzado desde `IN_PROGRESS` conserva `started_at NOT NULL`;
- `completed_at` se fija al cerrar `COMPLETED`, `FAILED` o `UNKNOWN_OUTCOME`;
- `CANCELLED` desde `CREATED` puede conservar `started_at = NULL`.

`started_at` demuestra inicio del attempt, no ausencia de transmisión.

### 5.2 Estado normalizado de transporte

Para decidir retry se propone cerrar `transport_status` v1 a:

```text
NOT_SENT
SENT
RESPONSE_RECEIVED
UNKNOWN
```

Interpretación:

- `NOT_SENT`: existe evidencia local suficiente de que la petición no salió al transporte;
- `SENT`: la petición fue entregada al transporte y pudo llegar al provider;
- `RESPONSE_RECEIVED`: existe respuesta de transporte/provider;
- `UNKNOWN`: no puede probarse si fue transmitida.

No se deriva este dato de HTTP status, provider code o timeout por sí solos.

### 5.3 Clasificación de retry

Se propone cerrar `retry_classification` v1 a:

```text
SAFE_RETRY
RECONCILE_REQUIRED
NON_RETRYABLE
```

Reglas:

1. `FAILED + NOT_SENT + SAFE_RETRY` puede originar un nuevo attempt.
2. `FAILED` con cualquier evidencia de posible transmisión no es válido: debe clasificarse `UNKNOWN_OUTCOME` o un terminal no reintentable según evidencia.
3. `UNKNOWN_OUTCOME` siempre usa `RECONCILE_REQUIRED` y prohíbe retry ciego.
4. `COMPLETED` es histórico terminal y no se reintenta.
5. `CANCELLED` solo representa cancelación previa a completar y no se reescribe.

### 5.4 Retry como fila nueva

Un retry permitido:

- conserva el mismo `ElectronicDocument`;
- conserva el mismo `IntegrationDispatch` porque continúa siendo la misma intención central↔provider;
- conserva `operation_type`, que es constante dentro de ese dispatch;
- incrementa `attempt_number` como secuencia monotónica **por `IntegrationDispatch`**, bajo lock del dispatch/owner aplicable;
- crea una fila nueva `CREATED`;
- no modifica el attempt anterior.

`attempt_number` no se reinicia por `operation_type`. Como cada dispatch representa una sola intención externa y un solo `operation_type`, `UNIQUE (tenant_id,integration_dispatch_id,attempt_number)` es la autoridad física del orden de retries. Cualquier candidato que calcule `max(attempt_number)` por documento+operation sin serializar por dispatch deberá ser remediado y no puede reutilizarse a ciegas.

Para `SUBMIT_DOCUMENT`, un retry `SAFE_RETRY` debe conservar el mismo payload canónico y request checksum. Si el contenido cambia, deja de ser retry del mismo request.

### 5.5 Raíz de idempotencia vs key del attempt

Se separan dos conceptos:

**Raíz lógica del dispatch**

- `IntegrationDispatch.idempotency_key` representa una intención FISCAL estable central↔provider: submit, query o artifact retrieval, según el dispatch.
- Se conserva para todos los attempts técnicos de **ese** dispatch.
- Una consulta o recuperación posterior no reutiliza la raíz del dispatch de submit: crea su propio dispatch fiscal con identidad/idempotencia determinista para esa nueva intención externa.

**Idempotency key del attempt**

- `FiscalSubmissionAttempt.idempotency_key` identifica una ejecución técnica concreta y es determinista por:

```text
FISCAL_ATTEMPT_V1
+ IntegrationDispatch.idempotency_key
+ operation_type
+ attempt_number
```

- reejecutar la misma fila/attempt por recuperación local usa la misma key y checksum;
- crear un retry real dentro del mismo dispatch incrementa `attempt_number` y obtiene una nueva key;
- no se crea un nuevo attempt cuando existe `UNKNOWN_OUTCOME` hasta que reconciliation produzca evidencia suficiente para autorizar una nueva intención o un retry seguro.

Esta separación reconcilia la intención durable del dispatch con la unicidad física de attempts numerados y evita usar un mismo lifecycle de dispatch para submit, query y artifact recovery.

## 6. Decisión propuesta para HIGH-003

### 6.1 Catálogo físico `operation_type` v1

Migration 003 debería reconocer exactamente:

```text
SUBMIT_DOCUMENT
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

No se proponen más literales en esta fundación.

### 6.2 Significado

`SUBMIT_DOCUMENT`

- emite el `ElectronicDocument` ya preparado;
- aplica también a documentos correctivos porque `document_type` y `original_electronic_document_id` ya expresan esa semántica;
- no existe `SUBMIT_CREDIT_NOTE`, `SUBMIT_DEBIT_NOTE` ni operación provider-specific.

`QUERY_DOCUMENT_STATUS`

- representa polling/consulta explícita del mismo documento;
- puede ser solicitado por recovery/reconciliation;
- no modifica el attempt ni el dispatch de submit anterior;
- crea/reutiliza idempotentemente un dispatch fiscal propio de consulta según la identidad lógica de la consulta/ventana aprobada.

`RETRIEVE_ARTIFACT`

- recupera un artefacto externo del mismo documento cuando exista contrato de adapter aplicable;
- el resultado durable se materializa como `FiscalArtifact` append-only;
- no convierte el blob en columna PostgreSQL;
- crea/reutiliza idempotentemente un dispatch fiscal propio de recuperación según documento, tipo/referencia de artefacto y contrato versionado aplicable.

### 6.3 Operaciones que NO son `operation_type`

No se crean en v1:

- `RECONCILE`: `FiscalReconciliation` posee ese lifecycle y puede orquestar dispatches QUERY/RETRIEVE;
- `POLL`: polling es estrategia/scheduling de `QUERY_DOCUMENT_STATUS`;
- `WEBHOOK`: es evidencia inbound y replay-protected, no una interacción saliente;
- `CORRECT_DOCUMENT`: el correctivo es otro `ElectronicDocument` y usa `SUBMIT_DOCUMENT`;
- literales `SIIGO_*`, `FACTUS_*`, `ALEGRA_*` o equivalentes.

### 6.4 Dispatch y ownership

`IntegrationDispatch` materializa una intención central↔provider. Por tanto:

- cada `SUBMIT_DOCUMENT`, `QUERY_DOCUMENT_STATUS` o `RETRIEVE_ARTIFACT` usa un dispatch `FISCAL` propio de esa intención, todos referenciando el mismo `ElectronicDocument` cuando corresponda;
- un dispatch concreto conserva un único `operation_type` para todos sus `FiscalSubmissionAttempt`;
- los retries de esa intención son attempts numerados del mismo dispatch;
- query/retrieve posteriores no cambian el estado agregado ni la idempotency root del dispatch de submit;
- `FiscalSubmissionAttempt` continúa siendo el único owner técnico de attempts fiscales;
- `IntegrationDispatchAttempt` continúa reservado físicamente a `NON_FISCAL`.

La futura remediación autoritativa deberá definir las raíces idempotentes exactas de QUERY y RETRIEVE antes de SQL. Como mínimo deben incorporar el `ElectronicDocument`, el `operation_type` y la identidad lógica versionada de consulta/ventana o artefacto solicitado, sin timestamps de ejecución ni valores provider-specific mutables.

Permitir estos literales en el esquema no declara que un provider real soporte polling o recuperación. La creación de un dispatch QUERY/RETRIEVE exige capability/adapter/readiness aplicable; mientras esa evidencia no exista, la operación falla cerrado. Los adapters, capability/readiness de provider y HTTP siguen `NOT_EVALUATED` hasta sus gates separados.

## 7. Invariantes cruzados resultantes

La remediación autoritativa posterior deberá hacer verificables, como mínimo, estos invariantes:

1. `logical_operation_key` es inmutable y no depende de `correction_source_reference` ni de otro material DRAFT-mutable.
2. `correction_source_reference` puede cambiar en DRAFT sin alterar identidad.
3. `FAILED` nunca se considera reintentable por `started_at IS NULL`.
4. todo `UNKNOWN_OUTCOME` bloquea retry ciego.
5. un retry seguro crea otra fila, incrementa `attempt_number` monotónicamente por dispatch y conserva el historial.
6. cada `IntegrationDispatch` representa una sola intención central↔provider y conserva su propia idempotency root.
7. attempt key es ejecución-específica y determinista dentro de su dispatch.
8. `SUBMIT_DOCUMENT`, `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` son los únicos operation types v1.
9. submit, query y retrieve no comparten un lifecycle de dispatch; cada intención usa su dispatch fiscal idempotente.
10. polling y reconciliation pueden orquestar QUERY/RETRIEVE sin convertirse en owners de attempts; webhook sigue inbound y los correctivos siguen siendo nuevos documentos.
11. provider-specific behavior no se incorpora al dominio ni a migration 003.
12. migration 001/002 permanecen byte-for-byte inmutables.
13. SQLite 003 continúa `NONE`.
14. SQL 003 continúa `ABSENT` hasta autorización de materialización separada.

## 8. Impacto esperado de una futura remediación autoritativa

Si esta propuesta pasa revisión, el cambio siguiente deberá limitarse a reconciliar las fuentes autoritativas necesarias para que expresen exactamente las decisiones anteriores.

Ese cambio no debe crear todavía:

- `003_fiscal_electronic_invoicing_foundation.up.sql`;
- `003_fiscal_electronic_invoicing_foundation.down.sql`;
- `POSTGRES_003_DESCRIPTOR` ejecutable;
- tests que pretendan aprobar un SQL inexistente;
- provider adapters;
- HTTP;
- seeds;
- secrets;
- fiscal schema real.

Solo después de una revisión independiente `PASS` de la remediación autoritativa podrá abrirse un gate separado de planificación/materialización SQL 003.

## 9. Criterios de revisión independiente

La revisión debe responder explícitamente:

- ¿la key lógica usa únicamente identidad inmutable?;
- ¿dos correcciones legítimas pueden distinguirse sin material mutable?;
- ¿la semántica `FAILED`/`UNKNOWN_OUTCOME` evita doble envío?;
- ¿`started_at` conserva un significado único?;
- ¿dispatch idempotency y attempt idempotency están claramente separados?;
- ¿`attempt_number` es monotónico por dispatch y compatible con `UNIQUE (tenant_id,integration_dispatch_id,attempt_number)`?;
- ¿submit/query/retrieve usan dispatches separados por intención sin crear owners paralelos?;
- ¿el catálogo v1 cubre submit, query y artifact recovery sin sobrediseñar providers?;
- ¿reconciliation/webhook/correctivos conservan owners únicos?;
- ¿001/002, providers, security gates y SQLite permanecen sin promoción?;

Resultado esperado de esta etapa:

`PROPOSAL_REVIEW = PASS | PASS_WITH_REMEDIATION | FAIL`.

Ningún resultado distinto de `PASS` autoriza modificar las fuentes autoritativas.

## 10. Gate siguiente

Gate actual:

`FISCAL-003-CONTRACT-GAP-RECONCILIATION-PROPOSAL = MATERIALIZED / REQUIRES_INDEPENDENT_REVIEW`.

Gate siguiente, únicamente si esta propuesta obtiene `PASS`:

`FISCAL-003-CONTRACT-AUTHORITY-REMEDIATION`.

Ese gate será documental y separado. SQL 003 seguirá `ABSENT` hasta una autorización posterior específica de materialización.