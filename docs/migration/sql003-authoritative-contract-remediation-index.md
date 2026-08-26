# INT-006 — índice y cierre físico de remediación contractual autoritativa V2

## Estado

`AUTHORITATIVE_REMEDIATION_BUNDLE_V2 / INTERNAL_AUDIT_REMEDIATED / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento define cómo interpretar el bundle documental de remediación de INT-006 sin destruir ni truncar contratos históricos ya cerrados y cierra las invariantes físicas nuevas que no existían en el baseline de nueve tablas. La propuesta V7 fue integrada por PR #4 y obtuvo `PROPOSAL_REVIEW = PASS`; ese PASS autorizó únicamente esta remediación documental separada.

Hasta que este bundle reciba CI commit-scoped y revisión independiente satisfactoria, permanece candidato. SQL 003, descriptor 003, schema fiscal, runner/apply/down 003 y providers continúan prohibidos.

## 1. Regla de preservación y precedencia

Los documentos históricos existentes permanecen íntegros en Git y siguen siendo autoridad para toda cláusula **no modificada** por este bundle. No se sustituyen por versiones abreviadas porque ello perdería detalle previamente cerrado sobre grants, RLS, sanitización, preflight MAT-003, constraints, lifecycle, apply/down, provider states, pruebas y seguridad.

Cuando una cláusula histórica contradiga expresamente una decisión V2 listada aquí, prevalece el overlay V2 correspondiente. Para las materias cerradas en §4 —integridad relacional de `FiscalDocumentPreparation`, ownership de identidades provider, no-reuse de numeración, grants/RLS de columnas nuevas, claim durable y evidencia tardía cross-generation— **§4 tiene precedencia sobre cualquier frase incompatible de los demás overlays V2**.

Si no puede determinarse con certeza si existe contradicción, la interpretación falla cerrado y SQL 003 permanece bloqueado.

## 2. Bundle V2

| Área | Baseline histórico preservado | Overlay V2 candidato | Temas que el overlay puede sustituir |
|---|---|---|---|
| Manifest migration 003 | `third-target-migration-manifest.md` | `third-target-migration-manifest-v2-authoritative-remediation.md` | Modelo A, décima tabla `FiscalDocumentPreparation`, preparation generation, reprepare, retry root, operation scope v1, fence, vínculos por generation, apply/down afectados |
| Physical model fiscal | `../architecture/physical-model/electronic-invoicing-schema.md` | `../architecture/physical-model/electronic-invoicing-schema-v2-authoritative-remediation.md` | separación `ElectronicDocument`/`FiscalDocumentPreparation`, numeración histórica, attempts, reconciliation por generation, fence |
| Arquitectura fiscal | `../architecture/electronic-invoicing.md` | `../architecture/electronic-invoicing-v2-authoritative-remediation.md` | semántica de prepare/reprepare/retry, UNKNOWN_OUTCOME, operation catalog v1, provider neutrality asociada |
| Caso de uso | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle-v2-authoritative-remediation.md` | flujo `REPREPARE_BEFORE_SUBMISSION`, claim durable, retries, webhook/reconciliation y numeración por generation |
| Frontera External Integrations | `../architecture/physical-model/external-integrations-schema.md` + `../architecture/integration-contracts.md` | `../architecture/physical-model/fiscal-integration-fence-schema.md` | extensiones owned por migration 003 sobre dispatch/receipt para vincular preparación/generation y serializar evidencia |
| Cierre físico nuevo | todos los anteriores | **§4 de este índice** | candidates/FKs, grants/RLS, field ownership provider-specific, no-reuse legal, late-evidence quarantine y claim durable |

## 3. Cláusulas V2 que sustituyen expresamente el baseline

Solo las siguientes familias cambian autoridad respecto del contrato histórico:

1. `ElectronicDocument` deja de ser owner de material/configuración/numeración mutable por preparación y conserva identidad lógica + lifecycle legal estable.
2. Migration 003 pasa de nueve a **diez tablas fiscales** por la incorporación de `fiscal.fiscal_document_preparations`.
3. `preparation_generation` inicia en 1, cambia exclusivamente mediante `REPREPARE_BEFORE_SUBMISSION` y nunca durante retries.
4. El material de cada generación —integration, connection, config/version, source version, snapshots, canonical payload/checksum y numeración— queda en `FiscalDocumentPreparation` y conserva historia append-only.
5. `REPREPARE_BEFORE_SUBMISSION` solo existe en `DRAFT|READY|QUEUED` y exige prueba durable de cero exposición bajo un fence común.
6. Cualquier attempt/claim, artifact, receipt fiscal correlacionado, identidad externa, `UNKNOWN_OUTCOME`, transport/effect evidence o reconciliation aplicable en vuelo bloquea reprepare.
7. Un dispatch `QUEUED` elegible se cancela en la misma transacción del reprepare; no se reutiliza para la nueva generation.
8. Numeración durable de una generación cancelada nunca vuelve al pool; permanece `RELEASED_WITHOUT_REUSE|BURNED` según policy y Audit.
9. Retry conserva documento + preparación + generation + dispatch + idempotency root y crea otro attempt.
10. Se elimina como requisito contractual la uniqueness por `(tenant,electronic_document,operation_type,idempotency_key)` que impedía retries válidos con root estable.
11. Migration 003 v1 materializa exclusivamente `SUBMIT_DOCUMENT`; `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen diseñados pero no materializados.
12. `IntegrationDispatch` fiscal y `ExternalWebhookReceipt` correlacionado reciben extensiones owned por 003 que fijan preparación/generation histórica.
13. La correlación webhook es write-once y todo receipt fiscal correlacionado bloquea reprepare independientemente de su `processing_status`.
14. `FiscalArtifact`, reconciliation/item e incident cuando aplique deben conservar la generation histórica correspondiente.
15. El orden de locks incorpora `FiscalDocumentPreparation` y el receipt correlacionado dentro del suffix fiscal; HTTP sigue siempre fuera de la transacción.

## 4. Cierre físico normativo V2

### 4.1 Distribución final de identidad y evidencia provider-specific

`ElectronicDocument` conserva las columnas de identidad/lifecycle legal V2, incluyendo `authority_reference`, `authority_status_raw`, `legal_identifier`, `uncertainty_reason` y timestamps legales. **No materializa en V2** `provider_document_id`, `provider_reference` ni `provider_status_raw`.

Esas tres columnas provider-specific pertenecen a la preparación porque solo allí existe el `external_integration_id` que les da scope físico inequívoco:

```text
fiscal.fiscal_document_preparations
  ...
  document_type text NOT NULL
  provider_document_id text NULL
  provider_reference text NULL
  provider_status_raw text NULL
```

Esto sustituye cualquier listado V2 anterior que todavía mostrara esas columnas en `ElectronicDocument`.

Reglas:

- `provider_document_id` y `provider_reference` son write-once cuando aparecen;
- `provider_status_raw` es una proyección sanitizada técnicamente mutable solo con evidencia append-only correlacionada; nunca sustituye artifacts/receipts/reconciliation history;
- cualquier provider identity/status presente en la generación actual bloquea reprepare;
- evidence tardía de una generación cancelada puede enriquecer únicamente esa preparación histórica conforme a §4.7; nunca se copia a la actual.

`ElectronicDocument` agrega como candidate key física:

```text
UNIQUE (tenant_id, company_id, id, document_type)
```

para que la preparación demuestre físicamente que su `document_type` coincide con el documento estable.

### 4.2 Candidate keys y FKs exactas de `FiscalDocumentPreparation`

Además de PK UUID v7 y conventions comunes, se materializan exactamente estas candidates/uniques:

```text
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, company_id, id)
UNIQUE (tenant_id, electronic_document_id, id)
UNIQUE (tenant_id, electronic_document_id, preparation_generation)
UNIQUE (tenant_id, company_id, external_integration_id,
        electronic_document_id, preparation_generation, id)
UNIQUE (tenant_id, company_id, external_integration_id, fiscal_connection_id,
        electronic_document_id, preparation_generation, id)
```

Nombres normativos:

```text
fiscal_document_preparations_tenant_id_id_uq
fiscal_document_preparations_tenant_company_id_id_uq
fiscal_document_preparations_document_id_uq
fiscal_document_preparations_generation_uq
fiscal_document_preparations_dispatch_scope_uq
fiscal_document_preparations_attempt_scope_uq
```

FKs `NOT DEFERRABLE / ON DELETE NO ACTION`:

```text
(tenant_id, company_id, electronic_document_id, document_type)
 -> fiscal.electronic_documents(tenant_id, company_id, id, document_type)

(tenant_id, company_id, branch_id)
 -> organization.branches(tenant_id, company_id, id)

(tenant_id, company_id, external_integration_id, fiscal_connection_id)
 -> fiscal.fiscal_connections(tenant_id, company_id, external_integration_id, id)

(tenant_id, company_id, external_integration_id, fiscal_connection_id,
 fiscal_emission_configuration_id, emission_configuration_version_id, document_type)
 -> fiscal.fiscal_emission_configuration_versions(
      tenant_id, company_id, external_integration_id, fiscal_connection_id,
      fiscal_emission_configuration_id, id, document_type)

(tenant_id, electronic_document_id, supersedes_preparation_id)
 -> fiscal.fiscal_document_preparations(tenant_id, electronic_document_id, id)
```

Actor FKs `created_by_actor_id` y `cancelled_by_actor_id` apuntan a `identity.users(id)`; cancelled actor usa MATCH SIMPLE cuando NULL. El guard de supersession exige:

- generation 1 -> `supersedes_preparation_id IS NULL`;
- generation N>1 -> predecessor obligatorio del mismo documento con generation exactamente `N-1`;
- no salto, ciclo, cross-document o cross-tenant.

La compatibilidad BRANCH/COMPANY de la configuration version se revalida bajo lock y el guard exige `version.branch_id IS NULL OR version.branch_id = preparation.branch_id`, preservando la precedencia normativa existente.

### 4.3 Constraints/guards exactos nuevos

Nombres normativos mínimos:

```text
fiscal_document_preparations_id_v7_ck
fiscal_document_preparations_document_fk
fiscal_document_preparations_branch_fk
fiscal_document_preparations_connection_fk
fiscal_document_preparations_configuration_version_fk
fiscal_document_preparations_supersedes_fk
fiscal_document_preparations_created_by_fk
fiscal_document_preparations_cancelled_by_fk
fiscal_document_preparations_state_ck
fiscal_document_preparations_generation_ck
fiscal_document_preparations_checksum_ck
fiscal_document_preparations_amounts_ck
fiscal_document_preparations_numbering_ck
fiscal_document_preparations_lifecycle_ck
fiscal_document_preparations_provider_identity_ck
fiscal_document_preparations_version_ck
fiscal_document_preparations_legal_number_uq
fiscal_document_preparations_provider_document_uq
```

Guards:

```text
fiscal_document_preparations_insert_guard
fiscal_document_preparations_update_guard
fiscal_document_preparations_state_guard
fiscal_document_preparations_numbering_guard
fiscal_document_preparations_late_evidence_guard
electronic_documents_reprepare_guard
fiscal_submission_attempts_root_guard
integration_dispatches_fiscal_preparation_guard
external_webhook_receipts_fiscal_correlation_guard
```

Los guards obtienen rol/contexto de forma no falsificable, usan CAS/locks y no confían en actor/scope enviados por request.

### 4.4 No-reuse legal: identidad física conservadora V1

La frase “unique por company/config/type/prefix/number” de otros overlays V2 queda sustituida. Configuración, conexión, provider y document type **no pueden abrir un namespace nuevo** para reutilizar una numeración ya asociada durablemente.

V1 usa una defensa conservadora a nivel emisor:

```text
CREATE UNIQUE INDEX fiscal_document_preparations_legal_number_uq
ON fiscal.fiscal_document_preparations (
  tenant_id,
  company_id,
  COALESCE(prefix, ''),
  number
)
WHERE number IS NOT NULL;
```

La fila participa aunque `preparation_state='CANCELLED'` y aunque `numbering_state='RELEASED_WITHOUT_REUSE'|'BURNED'`. `prefix` no nulo debe cumplir la canonicalización/sanitización normativa y nunca puede ser string vacío; NULL representa ausencia real. `number` se persiste en la forma canónica definida por la fuente legal/provider contract, sin reinterpretar arbitrariamente ceros o formato.

Esta regla implementa literalmente el no-reuse de `prefix/number` dentro de tenant+company incluso si cambia config, connection o provider. Si una futura norma demostrada exige namespaces legalmente distintos que permitan solape, deberá versionarse el contrato y migrarse explícitamente; V1 no lo supone.

Provider identity conserva namespace de integración:

```text
CREATE UNIQUE INDEX fiscal_document_preparations_provider_document_uq
ON fiscal.fiscal_document_preparations (
  tenant_id,
  external_integration_id,
  provider_document_id
)
WHERE provider_document_id IS NOT NULL;
```

### 4.5 Formas iniciales y mutabilidad de la preparación

INSERT común por `pos_app`:

- `preparation_state='DRAFT'`;
- generation >=1 y lineage coherente;
- configuración/connection/integration/document/type ya revalidados;
- provider fields NULL;
- `frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason` NULL;
- remote numbering -> `PENDING_EXTERNAL`, prefix/number/timestamps NULL;
- local authorized/contingency puede nacer `RESERVED` únicamente dentro del lock/avance de cursor normativo.

Después del INSERT, integration/connection/config/version/document/type/generation/lineage son inmutables para esa preparación. Si cambian, se usa reprepare y otra fila/generation.

Mientras DRAFT, `pos_app` puede modificar con CAS únicamente material allowlisted de source/snapshots/importes/payload y ejecutar la asignación local de numeración bajo el lock exacto. Freeze fija `FROZEN` + `frozen_at`. Reprepare puede cambiar `FROZEN|DRAFT -> CANCELLED` solo bajo el fence completo y fijar actor/razón.

`CANCELLED` mantiene material/configuración/numeración inmutables. La única excepción es **evidencia externa tardía write-once/sanitizada** conforme a §4.7; esa excepción nunca permite reactivar la preparación ni cambiar número/configuración/payload.

### 4.6 Matriz exacta de grants/RLS para `FiscalDocumentPreparation`

RLS:

- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`;
- `fiscal_document_preparations_app_tenant_isolation`: `pos_app`, SELECT/INSERT/UPDATE, tenant actual con `USING/WITH CHECK`;
- `fiscal_document_preparations_platform_tenant_select`: `pos_platform_app`, SELECT tenant actual;
- `fiscal_document_preparations_worker_frozen`: `pos_worker`, SELECT/UPDATE únicamente filas tenant-scoped `FROZEN` conforme a column grants/guards;
- `fiscal_document_preparations_worker_historical_evidence`: `pos_worker`, SELECT y únicamente evidence update sobre `CANCELLED` cuando existe receipt/artifact/reconciliation correlacionado a esa misma generation;
- `pos_platform_admin` conserva BYPASSRLS pero solo SELECT por columnas;
- `pos_reporting` y PUBLIC: sin grants.

Column sets literales:

`S_APP_WORKER` = todas las columnas de la tabla.

`I_APP`:

```text
id,tenant_id,company_id,branch_id,electronic_document_id,document_type,
preparation_generation,supersedes_preparation_id,preparation_state,
external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,
emission_configuration_version_id,source_version,correction_source_reference,
currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,
tax_snapshot_reference,tax_snapshot_checksum,
fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,
canonical_payload_version,canonical_payload_checksum,
numbering_mode,numbering_state,prefix,number,number_reserved_at,
created_by_actor_id,created_at,updated_at,version
```

`U_APP_DRAFT`:

```text
source_version,correction_source_reference,currency_code,subtotal_amount,
discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,
fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,
canonical_payload_version,canonical_payload_checksum,updated_at,version
```

`U_APP_NUMBERING`:

```text
numbering_state,prefix,number,number_reserved_at,number_consumed_at,
number_burned_at,numbering_resolution_reason,updated_at,version
```

`U_APP_STATE`:

```text
preparation_state,frozen_at,cancelled_at,cancelled_by_actor_id,
cancellation_reason,updated_at,version
```

`U_WORKER`:

```text
numbering_state,prefix,number,number_reserved_at,number_consumed_at,
number_burned_at,numbering_resolution_reason,
provider_document_id,provider_reference,provider_status_raw,updated_at,version
```

`S_PLATFORM`/`S_ADMIN` excluyen referencias/checksums de tax/fiscal snapshots y `canonical_payload_checksum`, pero pueden leer identidad, scope, configuración IDs, importes, canonical payload version, numeración, provider IDs/status, lifecycle, actores y timestamps.

Matriz:

| Tabla | `pos_app` | `pos_worker` | `pos_platform_app` | `pos_platform_admin` |
|---|---|---|---|---|
| `fiscal_document_preparations` | `S{S_APP_WORKER}, I{I_APP}, U{U_APP_DRAFT ∪ U_APP_NUMBERING ∪ U_APP_STATE}` | `S{S_APP_WORKER}, U{U_WORKER}` bajo policies/guards | `S{S_PLATFORM}` | `S{S_ADMIN}` |

Ningún rol runtime recibe DELETE/TRUNCATE/ownership. Los column grants por sí solos no autorizan transición: state/numbering/late-evidence guards verifican OLD→NEW, lock, generation actual/histórica y permiso de aplicación.

### 4.7 Evidencia tardía después de reprepare: cuarentena cross-generation

La V7 exige que evidencia tardía quede ligada exclusivamente a su generation histórica. Eso **no** significa que la generation actual pueda seguir enviándose sin evaluación.

Cuando un receipt/artifact/provider/authority evidence se correlaciona a una preparation generation menor que `ElectronicDocument.preparation_generation`:

1. se bloquea `ElectronicDocument` y todas las preparaciones/dispatches relevantes del mismo nivel en el orden canónico;
2. la evidencia se persiste únicamente contra la generación histórica exacta;
3. la preparación histórica no se reactiva ni se reescribe; provider identity/status solo puede enriquecerse bajo `late_evidence_guard` y siempre respaldado por evidence append-only;
4. el `ElectronicDocument` entra fail-closed a `UNKNOWN_OUTCOME` salvo que la misma transacción tenga evidencia autoritativa suficiente para una transición legal más fuerte;
5. un dispatch de la generation actual que siga `QUEUED` permanece durable pero **no puede ser reclamado** mientras el documento esté `UNKNOWN_OUTCOME`; no se cancela solo por la cuarentena para no destruir su root si posteriormente se demuestra ausencia de efecto histórico;
6. si la generation actual ya tiene claim/attempt, se abre `FiscalIncident` de conflicto multi-generation, se marca la orquestación como reconciliation-required conforme al lifecycle existente y no se inicia ningún attempt adicional;
7. ningún evidence histórico se reasigna a la generation actual por timestamp, estado “actual” o conveniencia.

El claim guard del worker exige siempre:

```text
ElectronicDocument.status = 'QUEUED'
AND dispatch.status = 'QUEUED'
AND dispatch/preparation generation = ElectronicDocument.preparation_generation
AND preparation.preparation_state = 'FROZEN'
```

por lo que `UNKNOWN_OUTCOME` congela cualquier dispatch actual aún no reclamado.

Si una reconciliation posterior demuestra de forma autoritativa **ausencia de efecto externo en todas las generaciones históricas cuestionadas**, un comando de resolución específico puede retirar la cuarentena sin reprepare ni cambiar generation:

- current preparation `DRAFT` -> document `DRAFT`;
- current preparation `FROZEN` sin dispatch -> document `READY`;
- current preparation `FROZEN` con el mismo dispatch actual todavía `QUEUED` y sin attempt -> document `QUEUED`.

La resolución exige evidence reference/checksum, reviewer/actor, reason, CAS y Audit. Si existe cualquier attempt/claim en la generation actual, no se aplica este resume automático.

Si la evidencia histórica demuestra `ACCEPTED|REJECTED` u otro efecto externo, la generation posterior no puede emitirse: se conserva, se cancela solo cuando el fence pruebe que no tuvo exposición propia, y el documento converge mediante reconciliation al resultado autoritativo correspondiente. Si existen efectos potenciales en más de una generation, queda `UNKNOWN_OUTCOME` + incidente hasta resolver todas las evidencias; nunca se elige una por “última”.

### 4.8 Claim durable V1 sin inventar una lease paralela

El baseline 002 no materializa columnas de lease en `IntegrationDispatch`. Migration 003 V1 no inventará `lease_owner/lease_expires_at` sin contrato de recovery.

La marca durable previa a HTTP exigida por V7 es la combinación atómica:

```text
IntegrationDispatch.status = 'DISPATCHING'
+ FiscalSubmissionAttempt persistido para el mismo dispatch/generation
+ FiscalSubmissionAttempt.status = 'IN_PROGRESS'
+ CAS/versiones confirmadas
```

El commit ocurre antes del HTTP. Esa combinación es suficiente para que reprepare falle y para que otro worker no cree un segundo intento concurrente. Un crash con attempt `IN_PROGRESS` no se “expira” por timestamp para reenviar: entra al recovery/reconciliation fail-closed. Si una futura estrategia requiere lease temporal/reclaim, deberá versionar explícitamente el contrato antes de añadir columnas o semantics de expiración.

### 4.9 Grants exactos para extensiones 003 de tablas 002

Los nuevos campos **no heredan automáticamente** los column grants de migration 002. DENY BY DEFAULT se conserva.

`integrations.integration_dispatches` nuevos campos:

```text
fiscal_document_preparation_id
fiscal_preparation_generation
```

Grants 003:

- `pos_app`: SELECT + INSERT; nunca UPDATE;
- `pos_worker`: SELECT; nunca UPDATE;
- `pos_platform_app`: SELECT contextual; sin INSERT/UPDATE de estas columnas, por lo que no puede fabricar un dispatch FISCAL fuera del command fiscal;
- `pos_platform_admin`: SELECT read-only;
- reporting/PUBLIC: none.

El guard exige valores en INSERT FISCAL, NULL en NON_FISCAL y los hace inmutables después.

`integrations.external_webhook_receipts` nuevos campos:

```text
fiscal_electronic_document_id
fiscal_document_preparation_id
fiscal_preparation_generation
fiscal_integration_dispatch_id
fiscal_correlated_at
```

Grants 003:

- `pos_app`: SELECT únicamente, necesario para la prueba de reprepare; sin INSERT/UPDATE;
- `pos_worker`: SELECT + UPDATE únicamente para correlación tardía NULL→set completo una vez bajo guard;
- `pos_platform_app`: SELECT + INSERT únicamente por endpoint webhook aislado; sin UPDATE de correlación;
- `pos_platform_admin`: SELECT read-only;
- reporting/PUBLIC: none.

`external_webhook_receipts_fiscal_correlation_guard` exige transición all-null → all-non-null una sola vez, FKs scoped exactas y `fiscal_correlated_at` fijado en la misma transición. Una vez correlacionado, ningún rol puede rebindear document/preparation/generation/dispatch.

### 4.10 Ajustes de relaciones dependientes

`FiscalSubmissionAttempt` usa FK scoped hacia `fiscal_document_preparations_attempt_scope_uq`; `FiscalArtifact` y el dispatch usan `...dispatch_scope_uq`. Reconciliation/item/incident que incluyan document+generation deben disponer de FK o guard scoped que resuelva exactamente la preparación histórica y nunca una generation por timestamp.

`FiscalReconciliation` DOCUMENT exige document+generation y resolución exacta a la preparación; CONNECTION los prohíbe. Un item conserva `fiscal_document_preparation_id + preparation_generation`. Un incident con documento conserva generation cuando la causa sea generation-specific.

Toda colección de preparaciones/attempts/receipts/items adquirida en una misma transacción se bloquea por UUID ascendente dentro de su nivel.

## 5. Cláusulas históricas preservadas

Salvo contradicción expresa con §3–§4, permanecen vigentes y deben trasladarse a cualquier SQL futuro:

- tenant/company-aware FKs, UUID v7, `ON DELETE NO ACTION` y RLS FORCE;
- matriz de roles/grants y `DENY BY DEFAULT`;
- sanitización, límites de texto y protección contra secretos;
- `btree_gist` como dependencia compartida no destructiva;
- lifecycle de connection/configuration/version e inmutabilidad publicada;
- preflight histórico `DEBIT_NOTES` y su matriz física exacta;
- invariantes y hashes de migrations 001/002;
- transición FISCAL como último cambio estructural del apply 003;
- down 003 restringido a fresh/test sin historia fiscal;
- MAT-003 preflight/readiness existentes;
- provider states y ausencia de claims productivos;
- `SEC-G01..SEC-G10 = PLANNED / NOT_EVALUATED`;
- SQLite migration 003 = `NONE`;
- tests negativos y regresiones históricas no afectados por V2.

Una futura materialización deberá construir una especificación consolidada completa. No podrá tomar únicamente los overlays V2 e ignorar el baseline preservado.

## 6. Relación con PR #4 y WIP histórico

PR #4 está `MERGED / CLOSED` y su propuesta V7 es evidencia de diseño, no SQL. El WIP `wip/sql003-contract-gap-20260825@dd07f9d429df7b9a2c6dcacaffa39df737cffbbf` sigue `HISTORICAL_WIP / NOT_INTEGRABLE`; no se mergea ni cherry-pickea como conjunto.

Los overlays V2 absorben las decisiones contractuales necesarias sin reutilizar SQL/runner/tests preliminares del WIP.

## 7. Gate de esta remediación

Para declarar el bundle autoritativo cerrado se requiere sobre un HEAD exacto:

1. diff limitado al bundle documental/backlog;
2. CI TARGET completo `SUCCESS`;
3. migrations 001/002 y MAT-003 sin regresión;
4. SQL/descriptor/schema 003 ausentes;
5. revisión independiente del conjunto V2 y de §4;
6. cero BLOCKER/HIGH/MEDIUM abiertos;
7. backlog y PR reconciliados.

Solo entonces podrá declararse:

`AUTHORITATIVE_CONTRACT_REVIEW = PASS`.

Ese PASS habilitará una **tarea posterior y separada** para diseñar/materializar SQL y descriptor 003. No constituye autorización automática de DDL ni de merge de esa tarea futura.
