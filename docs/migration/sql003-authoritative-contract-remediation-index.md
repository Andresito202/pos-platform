# INT-006 — índice y cierre físico de remediación contractual autoritativa V2

## Estado

`AUTHORITATIVE_REMEDIATION_BUNDLE_V2 / INTERNAL_AUDIT_REMEDIATED / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento define cómo interpretar el bundle documental de remediación de INT-006 sin destruir ni truncar contratos históricos ya cerrados y cierra las invariantes físicas nuevas que no existían en el baseline de nueve tablas. La propuesta V7 fue integrada por PR #4 y obtuvo `PROPOSAL_REVIEW = PASS`; ese PASS autorizó únicamente esta remediación documental separada.

Hasta que este bundle reciba CI commit-scoped y revisión independiente satisfactoria, permanece candidato. SQL 003, descriptor 003, schema fiscal, runner/apply/down 003 y providers continúan prohibidos.

Las firmas que usan sintaxis parecida a `CREATE UNIQUE INDEX` dentro de este documento son **notación normativa de diseño**, no un artefacto SQL ejecutable: no existe archivo `.sql` 003, descriptor 003, checksum 003, ledger entry 003 ni autorización de DDL. La materialización posterior deberá traducir el contrato revisado a SQL separado y volver a pasar su propio gate.

## 1. Regla de preservación y precedencia

Los documentos históricos existentes permanecen íntegros en Git y siguen siendo autoridad para toda cláusula **no modificada** por este bundle. No se sustituyen por versiones abreviadas porque ello perdería detalle previamente cerrado sobre grants, RLS, sanitización, preflight MAT-003, constraints, lifecycle, apply/down, provider states, pruebas y seguridad.

Cuando una cláusula histórica contradiga expresamente una decisión V2 listada aquí, prevalece el overlay V2 correspondiente. Para las materias cerradas en §4 —integridad relacional de `FiscalDocumentPreparation`, ownership de identidades provider, no-reuse de numeración, grants/RLS de columnas nuevas, claim durable, receipts correlacionados/correlacionables, identidad del dispatch fiscal, current-preparation integrity y evidencia tardía cross-generation— **§4 tiene precedencia sobre cualquier frase incompatible de los demás overlays V2**.

Si no puede determinarse con certeza si existe contradicción, la interpretación falla cerrado y SQL 003 permanece bloqueado.

## 2. Bundle V2

| Área | Baseline histórico preservado | Overlay V2 candidato | Temas que el overlay puede sustituir |
|---|---|---|---|
| Manifest migration 003 | `third-target-migration-manifest.md` | `third-target-migration-manifest-v2-authoritative-remediation.md` | Modelo A, décima tabla `FiscalDocumentPreparation`, preparation generation, reprepare, retry root, operation scope v1, fence, vínculos por generation, apply/down afectados |
| Physical model fiscal | `../architecture/physical-model/electronic-invoicing-schema.md` | `../architecture/physical-model/electronic-invoicing-schema-v2-authoritative-remediation.md` | separación `ElectronicDocument`/`FiscalDocumentPreparation`, numeración histórica, attempts, reconciliation por generation, fence |
| Arquitectura fiscal | `../architecture/electronic-invoicing.md` | `../architecture/electronic-invoicing-v2-authoritative-remediation.md` | semántica de prepare/reprepare/retry, UNKNOWN_OUTCOME, operation catalog v1, provider neutrality asociada |
| Caso de uso | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle-v2-authoritative-remediation.md` | flujo `REPREPARE_BEFORE_SUBMISSION`, claim durable, retries, webhook/reconciliation y numeración por generation |
| Frontera External Integrations | `../architecture/physical-model/external-integrations-schema.md` + `../architecture/integration-contracts.md` | `../architecture/physical-model/fiscal-integration-fence-schema.md` | extensiones owned por migration 003 sobre dispatch/receipt para vincular preparación/generation y serializar evidencia |
| Cierre físico nuevo | todos los anteriores | **§4 de este índice** | candidates/FKs, current-preparation invariant, grants/RLS, field ownership provider-specific, no-reuse legal, correlatable-receipt fence, dispatch identity/lifecycle, late-evidence quarantine y claim durable |

## 3. Cláusulas V2 que sustituyen expresamente el baseline

Solo las siguientes familias cambian autoridad respecto del contrato histórico:

1. `ElectronicDocument` deja de ser owner de material/configuración/numeración mutable por preparación y conserva identidad lógica + lifecycle legal estable.
2. Migration 003 pasa de nueve a **diez tablas fiscales** por la incorporación de `fiscal.fiscal_document_preparations`.
3. `preparation_generation` inicia en 1, cambia exclusivamente mediante `REPREPARE_BEFORE_SUBMISSION` y nunca durante retries.
4. El material de cada generación —integration, connection, config/version, source version, snapshots, canonical payload/checksum y numeración— queda en `FiscalDocumentPreparation` y conserva historia append-only.
5. `REPREPARE_BEFORE_SUBMISSION` solo existe en `DRAFT|READY|QUEUED` y exige prueba durable de cero exposición bajo un fence común.
6. Cualquier attempt/claim, artifact, receipt fiscal ya correlacionado **o determinísticamente correlacionable en ese momento**, identidad externa, `UNKNOWN_OUTCOME`, transport/effect evidence o reconciliation aplicable en vuelo bloquea reprepare.
7. Un dispatch `QUEUED` elegible se cancela en la misma transacción del reprepare; no se reutiliza para la nueva generation.
8. Numeración durable de una generación cancelada nunca vuelve al pool; permanece `RELEASED_WITHOUT_REUSE|BURNED` según policy y Audit.
9. Retry conserva documento + preparación + generation + dispatch + idempotency root y crea otro attempt.
10. Se elimina como requisito contractual la uniqueness por `(tenant,electronic_document,operation_type,idempotency_key)` que impedía retries válidos con root estable.
11. Migration 003 v1 materializa exclusivamente `SUBMIT_DOCUMENT`; `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen diseñados pero no materializados.
12. `IntegrationDispatch` fiscal y `ExternalWebhookReceipt` correlacionado reciben extensiones owned por 003 que fijan preparación/generation histórica.
13. La correlación webhook es write-once; todo receipt fiscal correlacionado y todo receipt general que ya pueda resolverse determinísticamente al dispatch/generation bajo §4.11 bloquean reprepare independientemente de `processing_status`.
14. `FiscalArtifact`, reconciliation/item e incident cuando aplique deben conservar la generation histórica correspondiente.
15. El orden de locks incorpora `FiscalDocumentPreparation` y el receipt correlacionado dentro del suffix fiscal; HTTP sigue siempre fuera de la transacción.
16. El dispatch fiscal V1 usa una identidad interna estable y provider-neutral cerrada en §4.12; ningún adapter/request elige `resource_type`, `internal_entity_type`, `internal_operation_id`, generation ni canonical payload identity.
17. `ElectronicDocument.preparation_generation` no es un pointer confiado únicamente a la aplicación: §4.13 exige una invariante diferida de commit que impide current generation ausente o generation futura durable.

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

La FK circular “documento actual -> preparación actual” **no** se materializa como una segunda columna `current_preparation_id`. La integridad de esa relación se cierra mediante §4.13 para mantener una sola autoridad de generación y evitar dual-write de pointers.

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
electronic_documents_current_preparation_guard
fiscal_submission_attempts_root_guard
integration_dispatches_fiscal_preparation_guard
external_webhook_receipts_fiscal_correlation_guard
```

Los guards obtienen rol/contexto de forma no falsificable, usan CAS/locks y no confían en actor/scope enviados por request. `electronic_documents_current_preparation_guard` tiene la semántica diferida cerrada en §4.13 y no se sustituye por una comprobación best-effort de aplicación.

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

Para una fila `CANCELLED`, `fiscal_document_preparations_late_evidence_guard` reduce de forma efectiva el UPDATE del worker a:

```text
provider_document_id,provider_reference,provider_status_raw,updated_at,version
```

bajo evidencia correlacionada de esa generation. Aunque el grant general `U_WORKER` incluya columnas de numeración necesarias para una preparación `FROZEN`, en `CANCELLED` el guard rechaza cualquier cambio a `numbering_state`, prefix/number/timestamps, configuración, snapshots, payload, lifecycle o lineage. Column grant amplio + guard estricto no se interpreta como permiso para mutar historia cancelada.

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

El claim guard del worker exige para el **primer** intento:

```text
ElectronicDocument.status = 'QUEUED'
AND dispatch.status = 'QUEUED'
AND dispatch/preparation generation = ElectronicDocument.preparation_generation
AND preparation.preparation_state = 'FROZEN'
```

Los retries seguros usan las precondiciones distintas de §4.12; nunca vuelven el dispatch a `QUEUED`. En ambos casos `ElectronicDocument.status='UNKNOWN_OUTCOME'` bloquea el claim.

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

### 4.11 Receipt general correlacionable vs receipt todavía no correlacionable

V7 bloquea reprepare ante un `ExternalWebhookReceipt` **correlacionable**, no únicamente después de que las columnas fiscales ya hayan sido fijadas. Por tanto la prueba de cero exposición distingue dos casos y no permite una ventana entre recepción y linkage.

Un receipt general 002 es **determinísticamente correlacionable** cuando el contrato versionado del provider/adapter puede resolverlo a un único `IntegrationDispatch` fiscal mediante campos durables allowlisted ya persistidos —por ejemplo correlation/request/provider operation references autorizadas por ese contrato— sin leer secretos, sin inferir por timestamps y sin heurística ambigua. Una coincidencia por tenant/integration solamente nunca basta.

Antes de confirmar `REPREPARE_BEFORE_SUBMISSION`, bajo el mismo prefijo/suffix de locks y después de bloquear documento/preparación/dispatch esperados:

1. se consultan los receipts ya correlacionados de la generation y estos bloquean inmediatamente;
2. se evalúan receipts generales candidatos del mismo tenant/company/integration usando exclusivamente el selector determinista versionado aplicable;
3. si un candidato resuelve de forma inequívoca al dispatch/document/preparation histórica o actual, se bloquea el receipt, se fija la correlación fiscal write-once en esa misma transacción y el reprepare falla por evidencia externa;
4. si el selector demuestra inequívocamente que el receipt corresponde a otro dispatch, no bloquea este documento;
5. si existe un candidato que el contrato clasifica como potencialmente perteneciente al dispatch pero la resolución queda ambigua/incompleta, la prueba de cero exposición falla cerrado; no se cancela el dispatch ni se incrementa generation hasta resolver la ambigüedad mediante incident/reconciliation;
6. únicamente un receipt que **genuinamente no puede relacionarse todavía con este dispatch según ningún selector autorizado** puede permanecer general y no bloquear este documento en ese instante. Si evidencia posterior lo hace correlacionable, se aplica §4.7 y la generation actual entra en cuarentena; esa ruta no convierte el reprepare anterior en una prueba de “no receipt”, solo gestiona evidencia que era materialmente irresoluble en aquel momento.

El correlator y reprepare usan el mismo orden de locks. Si ambos compiten por un receipt determinísticamente correlacionable, solo uno puede ganar: correlación primero bloquea reprepare; reprepare solo puede confirmar si al revalidar inmediatamente antes del commit sigue sin existir receipt correlacionado/correlacionable, attempt/claim, artifact, identity o evidencia aplicable.

Pruebas contractuales adicionales obligatorias antes de SQL:

- receipt general ya determinísticamente correlacionable pero aún sin linkage fiscal bloquea reprepare;
- receipt candidato ambiguo fail-closed no permite generation+1;
- receipt inequívocamente de otro dispatch no bloquea;
- receipt genuinamente no correlacionable permite continuar solo si todo el resto de la prueba de cero exposición pasa, y una correlación posterior activa la cuarentena histórica de §4.7;
- correlator vs reprepare concurrentes producen un solo ganador bajo el mismo fence.

### 4.12 Identidad y lifecycle exactos del `IntegrationDispatch(FISCAL)` V1

Migration 002 ya exige columnas no-null de routing/identidad aunque inicialmente solo materialice `NON_FISCAL`. Al habilitar FISCAL, 003 no permite que el adapter, el payload del request o cada attempt inventen su semántica.

Para todo dispatch fiscal V1:

```text
dispatch_class = 'FISCAL'
resource_type = 'ELECTRONIC_DOCUMENT'
internal_entity_type = 'ElectronicDocument'
internal_entity_id = ElectronicDocument.id
fiscal_document_preparation_id = current FiscalDocumentPreparation.id al crear el dispatch
fiscal_preparation_generation = FiscalDocumentPreparation.preparation_generation
payload_schema_version = FiscalDocumentPreparation.canonical_payload_version
payload_checksum = FiscalDocumentPreparation.canonical_payload_checksum
operation_type efectivo del owner fiscal = 'SUBMIT_DOCUMENT'
```

`resource_type='ELECTRONIC_DOCUMENT'` es un código canónico interno owned por 003 para la familia de recurso; **no** es el `document_type`, no es un código de Factus/Siigo/Alegra y no afirma capability del provider. El subtipo fiscal sigue únicamente en `FiscalDocumentPreparation.document_type` y determina `capability_code` con el mapping ya aprobado:

- `ELECTRONIC_SALES_INVOICE -> ELECTRONIC_INVOICING`;
- `CREDIT_NOTE -> CREDIT_NOTES`;
- `DEBIT_NOTE -> DEBIT_NOTES`;
- `SUPPORT_DOCUMENT|SUPPORT_DOCUMENT_ADJUSTMENT -> SUPPORT_DOCUMENTS`.

Cuando una `ResourceOwnershipPolicy` sea aplicable a esta frontera, la identidad canónica es `resource_type='ELECTRONIC_DOCUMENT'` + `operation_scope='SUBMIT_DOCUMENT'`; el resultado legal/fiscal puede ser provider-authoritative sin transferir ownership de Sale, Payment, Tax, Product o Inventory.

#### `internal_operation_id`

`internal_operation_id` es el `operation_id` UUID v7 del **primer command de enqueue/submit aceptado** que materializa el dispatch de esa preparation generation. Se genera/deriva por la aplicación antes del INSERT, se audita y queda inmutable durante toda la vida del dispatch.

No es:

- `FiscalSubmissionAttempt.id`;
- `attempt_number`;
- `request_id`;
- `correlation_id`;
- `REPREPARE_BEFORE_SUBMISSION` command id;
- provider operation/document id;
- timestamp ni hash del payload.

Un replay del mismo enqueue con igual root+checksum resuelve al dispatch existente y **no reescribe** `internal_operation_id`, aunque llegue con otro `request_id`. Si una segunda invocación representa otra intención pero produce la misma root, la root canónica sigue deduplicando la única intención provider-facing de esa generation; Audit puede conservar la causalidad adicional sin mutar el dispatch. Mismo root con checksum/schema/generation incompatibles es `CONFLICT`.

Un reprepare confirmado crea otra generation. El enqueue posterior es otro command lógico, por tanto crea otro `internal_operation_id`, otro dispatch y otra root. Un retry técnico jamás cambia `internal_operation_id` ni crea otro dispatch.

#### Lifecycle técnico del mismo dispatch

La primera ejecución usa:

```text
QUEUED
  -> [claim atómico + attempt #1 IN_PROGRESS]
DISPATCHING
```

Un retry seguro no regresa el dispatch a `QUEUED`. Después de un attempt que tenga evidencia suficiente para `SAFE_RETRY`, el owner fiscal puede pasar el mismo dispatch a:

```text
RETRY_SCHEDULED
```

con `next_attempt_at` y clasificación coherentes. Cuando el retry sea elegible, bajo el mismo fence y lock del dispatch:

```text
RETRY_SCHEDULED
  -> [claim atómico + attempt #N IN_PROGRESS]
DISPATCHING
```

El `attempt_number` nuevo es `max(existing attempt_number)+1` calculado bajo lock del dispatch y nunca se reutiliza. El nuevo attempt conserva exactamente document/preparation/generation/dispatch/idempotency root/internal operation identity y numeración.

Resultados agregados del dispatch:

- respuesta/evidencia concluyente que completa la intención provider-facing -> `SUCCEEDED`; esto significa **completitud técnica del dispatch**, no implica por sí solo `ElectronicDocument.ACCEPTED`: un rechazo fiscal autoritativo puede coexistir con dispatch `SUCCEEDED` y documento `REJECTED`;
- evidencia durable de no efecto + retry permitido -> `RETRY_SCHEDULED`;
- posibilidad de efecto sin certeza -> `UNKNOWN_OUTCOME` o `RECONCILIATION_REQUIRED` conforme a evidencia, y el documento entra `UNKNOWN_OUTCOME` cuando no existe certeza legal;
- fallo terminal conocido sin autorización de retry -> `PERMANENT_FAILURE|DEAD_LETTER` conforme a policy, con incident/reconciliation cuando corresponda; esos estados tampoco inventan un resultado legal del documento;
- `CANCELLED` por reprepare solo es legal desde `QUEUED` sin claim/attempt/evidence conforme a la prueba de cero exposición. Un dispatch que alguna vez tuvo attempt no vuelve a ser elegible para cancelación por reprepare.

`ElectronicDocument` permanece fuera del conjunto pre-submission tan pronto existe el primer claim/attempt; los retries posteriores no reabren `DRAFT|READY|QUEUED` para permitir reprepare. La ausencia de un estado legal final se resuelve mediante attempt evidence/reconciliation/incident, no degradando el fence.

El guard de dispatch fiscal valida en INSERT y en cada claim:

- scope tenant/company/integration y preparación exactos;
- document/preparation/generation actuales cuando se inicia el primer attempt;
- preparación `FROZEN`;
- capability derivada del `document_type` vigente y supported bajo la cadena ya bloqueada;
- `resource_type`, internal entity, operation identity, payload schema/checksum y root según este contrato;
- ningún claim concurrente existente;
- `ElectronicDocument.status='QUEUED'` para primer claim;
- para retry: mismo documento/preparación/generation, documento no `UNKNOWN_OUTCOME|ACCEPTED|REJECTED|VOIDED_BEFORE_SUBMISSION`, dispatch `RETRY_SCHEDULED`, retry due y último outcome/evidence autorizando `SAFE_RETRY`.

No se usa `next_attempt_at` ni el paso del tiempo como prueba de no efecto. Solo agenda un retry que ya fue autorizado por evidence/classification.

Pruebas adicionales obligatorias antes de SQL:

- FISCAL con `resource_type` distinto de `ELECTRONIC_DOCUMENT` falla;
- `internal_entity_type/id` que no resuelven al documento de la preparation fallan;
- payload schema/checksum distintos de la preparation FROZEN fallan;
- capability incompatible con `document_type` falla;
- replay same root+checksum conserva el mismo dispatch e `internal_operation_id`;
- reprepare+reenqueue produce nueva generation, nuevo dispatch, nueva root y nuevo `internal_operation_id`;
- retry conserva todos esos identificadores y solo incrementa `attempt_number`;
- dos workers reclamando QUEUED o RETRY_SCHEDULED producen un solo attempt IN_PROGRESS;
- `RETRY_SCHEDULED` no autoriza retry si la evidencia no clasifica `SAFE_RETRY`;
- dispatch `SUCCEEDED` + documento `REJECTED` es una combinación válida cuando existe rechazo fiscal concluyente;
- ningún estado de dispatch por sí solo produce ACCEPTED/REJECTED.

### 4.13 Invariante diferida de preparación actual

`ElectronicDocument.preparation_generation` es la única autoridad para identificar la generation actual; no se agrega un `current_preparation_id` duplicado. Para impedir que ese número apunte a una fila inexistente o que exista una “future preparation” durable, 003 define el constraint trigger normativo:

```text
electronic_documents_current_preparation_guard
```

Semántica:

- `CONSTRAINT TRIGGER` de PostgreSQL;
- `DEFERRABLE INITIALLY DEFERRED` porque create/reprepare requieren varios statements dentro de una sola transacción;
- se evalúa al cierre de la transacción sobre todo `ElectronicDocument` insertado o cuya `preparation_generation` cambió y sobre las preparaciones insertadas/cambiadas del mismo documento;
- no sustituye las FKs NOT DEFERRABLE de §4.2.

Al commit debe demostrar simultáneamente:

1. `ElectronicDocument.preparation_generation >= 1`;
2. existe **exactamente una** `FiscalDocumentPreparation` con `(tenant_id,electronic_document_id,preparation_generation)` igual al valor actual del documento;
3. no existe ninguna preparación del documento con `preparation_generation > ElectronicDocument.preparation_generation`;
4. la preparación actual pertenece al mismo tenant/company/branch/document_type conforme a las FKs/guards ya definidos;
5. la cadena de supersession de generation N>1 conserva predecessor N-1; combinada con la ausencia de hard delete runtime, no puede existir un salto durable en el historial;
6. `preparation_generation` del documento no decrementa y solo aumenta exactamente en uno por el guard de `REPREPARE_BEFORE_SUBMISSION`.

La creación inicial de `ElectronicDocument` y `FiscalDocumentPreparation generation=1` ocurre en la **misma transacción**. Es legal que, dentro de esa transacción aún no confirmada, un statement exista antes que el otro; si la preparación 1 no queda creada, el commit falla y toda la transacción revierte.

El reprepare también es una única transacción: cancela dispatch/numbering/preparation anterior bajo el fence, cambia el documento de N a N+1 y crea la nueva preparación N+1 DRAFT con lineage. El orden interno de statements puede elegirse para respetar guards/FKs, pero el constraint diferido prohíbe confirmar un documento apuntando a una generation inexistente o una nueva preparación sin que el documento avance a ella.

No se usa un job posterior, reconciliación eventual ni “repair on startup” como sustituto de esta invariante transaccional.

Pruebas obligatorias antes de SQL:

- INSERT documento sin preparation 1 en la misma transacción falla al commit;
- documento + preparation 1 en la misma transacción pasa;
- UPDATE generation N->N+1 sin crear preparation N+1 falla al commit;
- INSERT preparation N+1 sin avanzar documento falla al commit;
- reprepare completo old cancel + N->N+1 + new preparation pasa atómicamente;
- intento N->N+2 falla;
- rollback de cualquier statement de reprepare deja documento/generation/preparación anterior intactos;
- late evidence UPDATE sobre preparation histórica no altera la resolución de current generation.

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