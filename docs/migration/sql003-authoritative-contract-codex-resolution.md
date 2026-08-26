# INT-006 — resolución normativa de revisión Codex para el contrato autoritativo V2

## 1. Estado, autoridad y precedencia

Estado: `CODEX_REVIEW_REMEDIATION / AUTHORITATIVE_CANDIDATE / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Esta resolución responde a la revisión independiente Codex del HEAD `72fd7ada099a0792593d5e9ffe86e1191d52f83f` de la PR #9 y cierra contractualmente los findings P1/P2 emitidos sobre el bundle V2. No contiene DDL, no crea SQL003 ni descriptor003, no modifica migrations 001/002, no activa providers, no usa credenciales y no promueve `SEC-G01..SEC-G10`.

Para las materias enumeradas en §2–§9, **este documento tiene precedencia normativa sobre cualquier frase incompatible del manifest V2, índice V2, physical model V2, arquitectura V2, UC-EINV-001 V2 y `fiscal-integration-fence-schema.md` presentes en esta misma PR**. Las demás cláusulas de esos documentos permanecen vigentes.

Una futura tarea SQL003 deberá consolidar estas decisiones en manifest/descriptor/introspection/tests ejecutables; no podrá seleccionar una versión anterior incompatible. Si una contradicción no puede resolverse con esta precedencia, el gate falla cerrado.

## 2. Webhook: receipt durable no equivale a evidence fiscal admisible

Codex finding P1/HIGH `3865775796`: **VALID / HIGH**.

Migration 002 conserva dimensiones separadas e inmutables al recibir un webhook:

```text
authentication_verification_result
replay_verification_result
processing_status
```

La admisibilidad fiscal se evalúa **antes** del selector/candidate scan y antes de crear linkage fiscal. `processing_status` nunca sustituye autenticación/replay.

### 2.1 Matriz V1

La dimensión de autenticación es admisible solo si ocurre exactamente una de estas rutas:

1. `authentication_verification_result = VERIFIED`; o
2. `authentication_verification_result = UNSUPPORTED_BY_PROVIDER` y existe un provider/adapter contract versionado, previamente verificado para ese ambiente, que declara expresamente la ausencia del mecanismo, define un criterio alternativo de autenticidad y demuestra durablemente que ese criterio se cumplió.

La dimensión de replay es admisible solo si ocurre exactamente una de estas rutas:

1. `replay_verification_result = VERIFIED`; o
2. `replay_verification_result = UNSUPPORTED_BY_PROVIDER` y existe un provider/adapter contract versionado, previamente verificado para ese ambiente, que declara expresamente la ausencia del mecanismo, define un criterio alternativo anti-replay/dedup y demuestra durablemente que ese criterio se cumplió.

**Ambas dimensiones deben ser admisibles simultáneamente.** Cualquier `FAILED` o `UNVERIFIED_CONTRACT` en cualquiera de las dos vuelve el receipt no admisible como evidence fiscal:

```text
authentication_verification_result = FAILED
replay_verification_result = FAILED
authentication_verification_result = UNVERIFIED_CONTRACT
replay_verification_result = UNVERIFIED_CONTRACT
```

Mientras providers permanezcan `NOT_EVALUATED`, ninguna ruta `UNSUPPORTED_BY_PROVIDER` se presume habilitada por documentación genérica; requiere la evidencia/provider-contract formal de la etapa de adapter correspondiente.

Un receipt no admisible:

- permanece durable para seguridad, rate limiting, diagnóstico y Audit;
- puede quedar `REJECTED` conforme al lifecycle 002;
- **no recibe linkage fiscal** por sí solo;
- no entra al conjunto de candidatos ambiguos que bloquean `REPREPARE_BEFORE_SUBMISSION`;
- no cambia `ElectronicDocument`, `FiscalDocumentPreparation`, numeración ni cuarentena fiscal;
- puede abrir/relacionar un incidente de seguridad separado sin adquirir autoridad fiscal.

Para un receipt **admisible**, el `processing_status` no reduce su fuerza de evidencia de recepción: si está ya correlacionado o es determinísticamente correlacionable mediante el selector versionado autorizado, bloquea reprepare aunque esté `RECEIVED|PENDING|PROCESSING|PROCESSED|RETRY_SCHEDULED|DEAD_LETTER|REJECTED`. `REJECTED` se interpreta junto con auth/replay y reason; el nombre del estado no convierte un spoof en evidence fiscal.

Correlator y reprepare aplican la admisibilidad antes del candidate scan y luego compiten bajo el mismo fence document/preparation/dispatch/receipt. Un receipt admisible ambiguo falla cerrado; uno no admisible no puede producir denial fiscal por ambigüedad.

### 2.2 Pruebas contractuales

- auth FAILED con IDs correlacionables no crea linkage, no bloquea reprepare y no activa cuarentena fiscal;
- replay FAILED se comporta igual;
- auth VERIFIED + replay VERIFIED, determinísticamente correlacionable, bloquea en cualquier processing status;
- `UNSUPPORTED_BY_PROVIDER` en auth o replay sin contract alternativo verificado no es evidence fiscal;
- `UNVERIFIED_CONTRACT` en cualquiera de las dimensiones falla cerrado para confiar en ese canal, pero no convierte payload no verificado en evidence del documento;
- carrera receipt admisible vs reprepare produce un solo ganador bajo el fence.

## 3. Identidad efectiva de integración/configuración congelada por preparation

Codex finding P1/HIGH `3865775806`: **NEEDS_REFINEMENT / HIGH**, cerrado con snapshot efectivo en vez de duplicar columnas mutables sin necesidad.

`FiscalDocumentPreparation.fiscal_emission_snapshot_reference/checksum` pasa a tener contenido mínimo normativo obligatorio. Al hacer `FROZEN`, el snapshot inmutable debe incluir, como mínimo:

```text
snapshot_contract = FISCAL_EMISSION_SNAPSHOT_V2
external_integration_id
provider_id
provider_adapter_version_id
environment
provider_account_reference_normalized | EXPLICITLY_ABSENT_BY_VERIFIED_CONTRACT
external_integration_configuration_version
integration_routing_material_schema_version
integration_routing_material_checksum
capability_code
integration_capability_id/version or equivalent effective identity
fiscal_connection_id
fiscal_emission_configuration_id
emission_configuration_version_id
```

`integration_routing_material_checksum` se calcula sobre el material **no secreto** efectivo que puede modificar account identity, endpoint/routing semántico o transformación provider-facing. El entero `ExternalIntegration.configuration_version` aislado no demuestra identidad efectiva y nunca sustituye este checksum.

El snapshot no almacena secretos, access tokens, refresh tokens ni credential material.

### 3.1 Revalidación V1 exacta

Antes de `READY`, enqueue y **cada claim/retry**, bajo el prefijo canónico de locks, se vuelve a resolver la integración efectiva y se compara con el snapshot congelado. V1 exige simultáneamente:

- misma `external_integration_id`;
- mismo provider/adapter/environment;
- misma identidad efectiva de cuenta;
- **`ExternalIntegration.configuration_version` exactamente igual a `external_integration_configuration_version` congelada**;
- mismo routing material schema/checksum;
- misma capability/config fiscal aplicable.

En V1, un cambio de `ExternalIntegration.configuration_version` es drift contractual aunque el checksum de routing resulte igual; la equivalencia entre revisiones distintas requeriría un contrato futuro explícito. El checksum es defense-in-depth para detectar drift material dentro de la revisión congelada y no una licencia para cambiar de revisión.

Drift antes de exposición externa hace fallar enqueue/claim y puede resolverse solo mediante `REPREPARE_BEFORE_SUBMISSION` si toda la prueba de cero exposición pasa. Drift después de cualquier exposure/attempt/evidence falla cerrado y usa reconciliation/incident; nunca muta la preparation histórica ni reutiliza su root.

Cambiar realmente a otra cuenta externa no recicla silenciosamente una identidad ya usada por historia/intenciones fiscales: requiere otra `ExternalIntegration` o una futura identidad de cuenta explícitamente versionada equivalente. La rotación de credenciales de **la misma cuenta** permanece permitida y no cambia la intención/root.

### 3.2 Pruebas contractuales

- account identity drift antes de READY/enqueue;
- account/routing drift entre enqueue y claim;
- drift entre attempts;
- rotation de credencial de la misma cuenta sin cambiar intención;
- `configuration_version` distinta bloquea V1 aunque el routing checksum coincida;
- routing checksum distinto con la misma revisión bloquea como integrity/semantic drift;
- post-exposure drift no habilita reprepare.

## 4. Request provider-specific: checksum semántico congelado por dispatch

Codex finding P1/HIGH `3865775813`: **VALID / HIGH**.

La futura extensión 003 de `integrations.integration_dispatches` agrega para filas `FISCAL`:

```text
fiscal_request_semantic_version integer NULL
fiscal_request_semantic_checksum text NULL
```

Reglas:

- FISCAL: ambos `NOT NULL` por constraint/guard 003;
- NON_FISCAL: ambos `NULL`;
- se fijan al crear el dispatch y son inmutables;
- `fiscal_request_semantic_version >= 1`;
- checksum SHA-256 lowercase 64 hex;
- los nuevos campos siguen DENY BY DEFAULT y los mismos grants de identidad fiscal del dispatch: `pos_app` INSERT/SELECT, worker SELECT, platform/admin SELECT según matriz; nunca UPDATE runtime.

El valor representa el material provider-facing **semántico, normalizado y versionado** producido de forma determinista antes de cualquier HTTP a partir del canonical payload y del snapshot efectivo congelado de §3. Incluye todo lo que pueda alterar el efecto externo: document/account identity, operation, numbering, importes/tax semantics, canonical payload meaning y routing semántico efectivo.

Solo se excluyen campos de envelope/transporte explícitamente allowlisted por la versión del contrato y que no cambian la intención, por ejemplo `request_id`, nonce/timestamp o firma cuando el provider los exige. Secrets/tokens nunca forman parte de tablas de negocio ni del material semántico persistido.

`FiscalSubmissionAttempt.request_checksum` queda definido normativamente como:

```text
request_checksum
== IntegrationDispatch.fiscal_request_semantic_checksum
```

para **todos** los attempts del mismo dispatch. `request_id`, attempt id y `attempt_number` distinguen ejecuciones; no alteran el checksum semántico.

Misma root con checksum semántico distinto es `CONFLICT / NOT_A_RETRY` y falla antes del HTTP. Si un adapter/provider no permite normalización determinista segura, `SAFE_RETRY` no se habilita hasta un contrato provider-specific revisado.

### 4.1 Pruebas contractuales

- retry con nonce/timestamp/request-id distinto pero semántica igual conserva checksum;
- total/account/numbering/routing/document distintos cambian checksum y bloquean retry;
- adapter transform-contract drift cambia version/checksum y no reutiliza la root;
- raw wire evidence, si se necesita, se guarda como evidencia separada; no redefine este checksum.

## 5. Eligibility de ExternalIntegration y credencial por claim

Codex finding P1/HIGH `3865775819`: **VALID / HIGH**.

V1 adopta una política conservadora y determinista: **solo `ExternalIntegration.status = ACTIVE` permite crear un nuevo dispatch FISCAL o ejecutar un claim que pueda conducir a HTTP**. `DEGRADED` conserva historia/diagnóstico, pero no es outbound-safe en V1 porque aún no existe una policy versionada de degradación que demuestre lo contrario. Una futura ampliación puede habilitar casos DEGRADED únicamente mediante contrato revisado explícito.

No son elegibles para nuevos efectos externos:

```text
CREATED
CREDENTIALS_CONFIGURED
AUTHENTICATED
DISCOVERING
DISCOVERY_COMPLETE
MAPPING_REQUIRED
READY_FOR_REVIEW
DEGRADED
DISABLED
CREDENTIAL_ROTATION_REQUIRED
ERROR
```

Antes de enqueue y antes de cada claim se bloquean/revalidan, en orden canónico:

- ProviderCapabilityDeclaration;
- ProviderAdapterVersion;
- ExternalIntegration;
- IntegrationCapability;
- el `IntegrationCredentialBinding` ACTIVE aplicable;
- FiscalConnection/config/version;
- document/preparation/dispatch.

Debe existir **exactamente un** `IntegrationCredentialBinding.status=ACTIVE` para esa integration. Una binding `PENDING|SUPERSEDED|REVOKED` nunca se usa para HTTP.

Cada `FiscalSubmissionAttempt` conserva como identidad técnica de la ejecución:

```text
credential_binding_id uuid NOT NULL
credential_binding_generation integer NOT NULL
```

La futura 003 exige FK directa al binding id y guard tenant/company/integration/generation-aware que demuestre que el binding seleccionado pertenecía a la misma ExternalIntegration y estaba ACTIVE durante el claim. No se persiste `credential_reference` ni ningún secreto.

Grants/immutability 003 de estos dos campos:

- `pos_worker`: INSERT + SELECT como parte de la identidad del attempt; nunca UPDATE después del INSERT;
- `pos_app`: SELECT mínimo cuando el caso de uso autorizado lo requiera; sin INSERT/UPDATE de attempts;
- `pos_platform_app`/`pos_platform_admin`: SELECT allowlisted conforme a la matriz del attempt; sin mutación;
- reporting/PUBLIC: none.

Los guards verifican que `credential_binding_generation` coincida con la binding referenciada y con la misma integration. Estos campos no forman parte de la idempotency root ni del semantic request checksum porque credential rotation same-account no cambia intención externa.

Credential rotation same-account puede hacer que retries posteriores usen otra binding/generation ACTIVE; esto no cambia root ni checksum semántico. Cada attempt conserva cuál generación utilizó.

El claim confirma estado/binding bajo lock y commit antes de HTTP. Al resolver el secreto inmediatamente antes de HTTP se revalida fail-closed que la binding pinneada siga habilitada para uso; si fue revocada/superseded o no puede resolverse, **no se ejecuta HTTP** y el attempt conserva evidence técnica `NOT_SENT`/failure conforme al contrato, sin convertir tiempo en autorización de retry.

### 5.1 Pruebas contractuales

- disable-vs-enqueue y disable-vs-claim;
- DEGRADED no genera nuevo efecto externo V1;
- rotation-required sin ACTIVE binding;
- exactamente una ACTIVE binding;
- PENDING nunca elegible;
- revocation después del claim y antes de resolver secret impide HTTP;
- retry con binding generation nueva de la misma cuenta conserva root/checksum semántico.

## 6. Claim durable: ElectronicDocument entra a SUBMITTING atómicamente

Codex finding P2/MEDIUM `3865775830`: **VALID / MEDIUM**.

El **primer claim** durable de una preparation es una sola transacción:

```text
ElectronicDocument.status: QUEUED -> SUBMITTING
IntegrationDispatch.status: QUEUED -> DISPATCHING
FiscalSubmissionAttempt: INSERT/transition -> IN_PROGRESS
attempt.idempotency_key = dispatch.idempotency_key
attempt.request_checksum = dispatch.fiscal_request_semantic_checksum
credential binding id/generation pinned
CAS/versiones confirmadas
COMMIT
```

Solo después del commit puede comenzar resolución final de secret/HTTP.

Si la transacción revierte, debe quedar `ElectronicDocument=QUEUED`, dispatch `QUEUED` y cero attempt IN_PROGRESS nuevo.

Un retry seguro no devuelve el documento a QUEUED/READY. El documento conserva `SUBMITTING` mientras el proceso de submission siga abierto; el mismo dispatch usa `RETRY_SCHEDULED -> DISPATCHING` y crea el siguiente attempt. Resultado legal concluyente mueve el documento a `ACCEPTED|REJECTED`; incertidumbre relevante lo mueve a `UNKNOWN_OUTCOME`.

La invariante se exige en ambos sentidos en la frontera de claim/recovery: un claim nuevo de current generation no puede confirmar `DISPATCHING + IN_PROGRESS` dejando el documento en QUEUED; `SUBMITTING` no puede ser utilizado para crear un nuevo primer attempt fuera del mismo dispatch/fence. Evidencia/reconciliation posterior puede elevar el documento a un estado más fuerte (`UNKNOWN_OUTCOME|ACCEPTED|REJECTED`) sin violar que el claim original fue durablemente SUBMITTING.

## 7. Late remote numbering en preparation CANCELLED

Codex finding P1/HIGH `3865775834`: **VALID / HIGH**.

La regla general se mantiene: una preparation `CANCELLED` es histórica y no cambia config, payload, generation, lineage ni lifecycle. Se introduce una única excepción evidence-backed para numeración remota tardía.

Es elegible solo cuando **todas** se cumplen:

```text
preparation_state = CANCELLED
numbering_mode IN (PROVIDER_ASSIGNED, AUTHORITY_ASSIGNED)
OLD.numbering_state = PENDING_EXTERNAL
OLD.prefix IS NULL
OLD.number IS NULL
```

y existe evidence externa fiscal **admisible según §2**, autenticada/validada conforme al provider contract, write-once y correlacionada exactamente a esa preparation/generation.

La transición puede fijar una sola vez:

```text
prefix
number
numbering_state -> CONSUMED | UNKNOWN_OUTCOME
number_consumed_at   # solo si evidence concluyente soporta ese momento
numbering_resolution_reason
provider_document_id/provider_reference/provider_status_raw cuando aplique
updated_at
version
```

Nunca fija/fabrica `number_reserved_at` local para una asignación remota. Si existe número/effect evidence pero no certeza suficiente para declarar consumo legal concluyente, el estado es `UNKNOWN_OUTCOME` y la evidencia queda para reconciliation.

`AUTHORIZED_RANGE|LOCAL_CONTINGENCY` y cualquier preparation que ya tuviera número durable antes de CANCELLED mantienen numeración absolutamente inmutable.

La asignación tardía participa inmediatamente del unique legal conservador `(tenant,company,COALESCE(prefix,''),number)`. Conflicto con otro documento/generation no sobrescribe nada: transaction rollback + `FiscalIncident`/reconciliation fail-closed. Replay same-value es idempotente; una segunda evidencia con número diferente para la misma generation es conflicto.

Toda numeración tardía cross-generation activa la cuarentena de la generation actual según el fence existente; nunca reactiva la preparation histórica ni mueve evidence a current.

## 8. Hardening adicional: exactamente una intención FISCAL por preparation

El candidato interno `5429487708` se cierra defense-in-depth aunque Codex no haya abierto finding independiente.

La futura 003 exige simultáneamente:

1. `integration_dispatches_fiscal_preparation_guard` recalcula la serialización/hash canónica `FISCAL_SUBMIT_DISPATCH_V1`; el request/adapter no puede suministrar una root arbitraria;
2. el unique 002 `(tenant_id,integration_id,idempotency_key)` continúa aplicando;
3. se agrega unique parcial owned por 003 para filas FISCAL:

```text
UNIQUE (tenant_id, fiscal_document_preparation_id)
WHERE dispatch_class = 'FISCAL'
```

La FK/guard demuestra además company/integration/document/generation correctos. Esto impide dos intents para una misma preparation incluso frente a un bug que intente fabricar otra key. Reprepare usa otra preparation/generation y por tanto puede crear su único dispatch nuevo.

## 9. Hardening adicional: máximo un attempt IN_PROGRESS por dispatch

El candidato interno `5429498943` también se cierra defense-in-depth.

Además del lock del dispatch, CAS, monotonic `attempt_number` y guard de claim, futura 003 agrega:

```text
CREATE UNIQUE INDEX fiscal_submission_attempts_one_in_progress_uq
ON fiscal.fiscal_submission_attempts (tenant_id, integration_dispatch_id)
WHERE status = 'IN_PROGRESS';
```

El INSERT/transición a IN_PROGRESS sucede dentro de la misma transacción del claim. Conflicto de unique revierte document/dispatch/attempt y no permite HTTP. Attempts históricos `COMPLETED|FAILED|UNKNOWN_OUTCOME|CANCELLED` no participan. Un `UNKNOWN_OUTCOME` no se libera por tiempo.

## 10. Reconciliación de grants y redacción LOW

La frase genérica `pos_worker no cambia identidad/preparation/configuración` queda sustituida por:

> `pos_worker` no cambia identidad lógica, tenant/company scope, integration/configuration identity, generation, lineage ni material frozen. Solo puede realizar mutaciones técnicas allowlisted de lifecycle/evidence/numbering bajo guards, locks, CAS y evidence aplicable; sobre una preparation CANCELLED únicamente las excepciones explícitas de late provider evidence y late remote numbering de §7.

Los column grants amplios necesarios para FROZEN no constituyen permiso sobre historia CANCELLED: los guards OLD->NEW aplican la matriz estricta.

## 11. Efecto sobre pruebas obligatorias

La futura suite SQL003/descriptor003 deberá añadir, como mínimo:

- spoof/replay FAILED no bloquea reprepare ni crea fiscal linkage;
- receipt admisible correlacionable sí bloquea en todo processing status;
- routing/account/config snapshot drift antes y después de exposure;
- exact `ExternalIntegration.configuration_version` freeze/revalidation;
- checksum semántico estable en retries y conflict ante drift;
- ACTIVE integration + exactamente una ACTIVE credential binding;
- DEGRADED/DISABLED/ROTATION_REQUIRED fail-closed para nuevo HTTP V1;
- credential binding id/generation pinning por attempt y grants inmutables;
- claim atómico `QUEUED -> SUBMITTING + DISPATCHING + IN_PROGRESS`;
- exactly-one fiscal dispatch por preparation;
- exactly-one IN_PROGRESS attempt por dispatch;
- late remote numbering write-once sobre CANCELLED remote PENDING_EXTERNAL;
- legal-number collision por late evidence -> incident/reconciliation;
- local numbering CANCELLED permanece inmutable.

## 12. Gate

Esta resolución **no convierte PR #9 en PASS**. Al cambiar el HEAD:

1. CI completo debe ejecutarse sobre el nuevo SHA;
2. los seis threads Codex deben quedar remediados/outdated/resueltos de forma verificable;
3. Codex debe revisar nuevamente el bundle completo, incluyendo esta resolución y los hardenings §8–§9;
4. cero BLOCKER/HIGH/MEDIUM abiertos;
5. backlog/PR deben reconciliarse al estado final;
6. solo entonces puede declararse `AUTHORITATIVE_CONTRACT_REVIEW = PASS` y pasar la PR de Draft a Ready para un gate de merge separado.

Incluso ese PASS no autoriza SQL003, descriptor003, provider adapters, Factus sandbox, runtime ni promoción de seguridad. Esas son tareas posteriores y separadas.