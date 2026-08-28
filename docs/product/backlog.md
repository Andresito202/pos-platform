# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente normativa del **estado vigente del trabajo** de POS Platform: prioridad, dependencia, bloqueo, trabajo activo y orden inmediato.

No funciona como diario histórico exhaustivo. La cronología detallada permanece trazable en Git, commits, PRs y workflows. Un snapshot histórico no puede contradecir la cola actual.

Última reconciliación normativa: 2026-08-28.

## Jerarquía relacionada

- Estado y orden de trabajo: este backlog.
- Arquitectura/decisiones: `docs/adr/`.
- Módulos y ownership: `docs/architecture/module-map.md` + `docs/architecture/data-ownership.md`.
- Ramas/PR/merge: `docs/governance/repository-governance.md`.
- CI vigente: `docs/testing/target-foundation-ci-gate.md`.
- Seguridad: `docs/security/security-gates.md`.
- Migrations: manifests y tooling aprobados bajo `docs/migration/` y `tools/target-migrations/`.
- Remediación contractual vigente de INT-006: `docs/migration/sql003-authoritative-contract-remediation-index.md` y su bundle V2.

Si una fuente vigente contradice otra, la transición afectada se bloquea hasta reconciliación. No se elige una interpretación arbitraria.

## Estados

| Estado | Significado |
|---|---|
| `DONE` | Alcance cerrado con evidencia verificable del nivel declarado. |
| `IN_PROGRESS` | Trabajo principal activo y delimitado. |
| `READY` | Dependencias y alcance suficientes para iniciar, pero no activo. |
| `BLOCKED` | Trabajo válido detenido por un impedimento explícito. |
| `PLANNED` | Trabajo aceptado aún no preparado/iniciado. |
| `DEFERRED` | Trabajo válido aplazado a otra fase. |
| `OUT_OF_SCOPE` | Excluido deliberadamente del alcance vigente. |

Los niveles `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`, `CANONICALLY_APPLIED` y `PRODUCTION_READY` no son equivalentes.

## Baseline canónico

### Integrado en `main`

- Fase 0 documental: `DONE`.
- PR #2: `MERGED / CLOSED`; fundación TARGET integrada.
- PR #3: `MERGED / CLOSED`; runtime/documentación legacy retirados del árbol TARGET.
- Migration 001: `MATERIALIZED / TESTED / IMMUTABLE`.
- Migration 002 External Integrations: `MATERIALIZED / TESTED / IMMUTABLE`, PostgreSQL central, dispatch físico `NON_FISCAL`.
- MAT-003 preflight tooling: `MATERIALIZED / REVIEWED`.
- canonical-role-readiness tooling: `MATERIALIZED / REVIEWED`.
- canonical-role readiness: `APPLIED / REVIEWED` solo en `LOCAL_CANONICAL_INTEGRATION`.
- MAT-003 preflight canónico: `EXECUTED / PASS / REVIEWED`, read-only, cero mutaciones durables.
- PR #5: `MERGED / CLOSED`; supply-chain baseline + gobernanza detectiva de `main` integrados.
- PR #6: `MERGED / CLOSED`; fuentes canónicas reconciliadas.
- PR #7: `MERGED / CLOSED`; `Camacho POS Colombia` adoptado como nombre comercial con clearance oficial todavía pendiente.
- PR #8: `MERGED / CLOSED`; gobernanza detectiva de pushes a `main` endurecida para validar todo el rango de primer padre y fuentes de estado reconciliadas.
- PR #4: `MERGED / CLOSED`; propuesta V7 de reconciliación SQL003 integrada con `PROPOSAL_REVIEW = PASS`.
- PR #9: `MERGED / CLOSED`; remediación contractual autoritativa V2 integrada con `AUTHORITATIVE_CONTRACT_REVIEW = PASS`.
- PR #10: `MERGED / CLOSED`; reconciliación post-merge de INT-006 integrada.
- PR #11: `MERGED / CLOSED`; INT-007 / SQL003 V2 integrado con Gate A `PASS / FROZEN` y Gate B `PASS / CLOSED`.
- HEAD exacto integrado de PR #11: `39c56d030954f3bef20b84f773e4a4f76766a06b`; Codex exact-head: `Didn't find any major issues`; 48/48 review threads resueltos.
- Merge commit canónico: `8676caef419d70732f74489a413ae7fda2c49d0c`.
- Run post-merge #159 `33142409080`: `COMPLETED / SUCCESS`, incluidos `Main push governance`, repository/secret policy, dependency inventory, TypeScript, SQLite, PostgreSQL 16.14 migrations 001/002/003, Modelo A, MAT-003 preflight y role-readiness.
- Artifact post-merge exact-head: `int-007-gate-b-8676caef419d70732f74489a413ae7fda2c49d0c`.

La evidencia de SHA anterior es commit-scoped; el HEAD vigente de `main` siempre se consulta en GitHub antes de cualquier integración.

### No materializado / no aprobado como producto

- NestJS/Fastify runtime: `ABSENT / NOT_MATERIALIZED`.
- Electron/React/Vite: `ABSENT / NOT_MATERIALIZED`.
- POS Local Service: `ABSENT / NOT_MATERIALIZED`.
- Nx foundation y límites de packages: `INTEGRATED / TESTED` por ARCH-003 / PR #12; las aplicaciones runtime continúan `ABSENT / NOT_MATERIALIZED`.
- SQL 003 DDL + descriptor 003: `INTEGRATED / GATES_CLOSED / PHYSICALLY_VALIDATED_IN_POSTGRESQL_16_14`; apply→introspection/smoke→down→exact-002→reapply y Modelo A pasan; SQLite 003 permanece `NONE`.
- schema/migration 003 en un entorno compartido o productivo: `NOT_DEPLOYED`; INT-007 cerró el artefacto de repositorio y su evidencia CI, no un despliegue productivo.
- bundle autoritativo V2 de INT-006: `INTEGRATED / REVIEWED` por PR #9; la autorización separada para iniciar diseño/materialización SQL003 fue otorgada el 2026-08-26 y queda acotada a INT-007.
- SIIGO/FACTUS/ALEGRA adapters reales: `DESIGNED / NOT_EVALUATED`.
- infraestructura productiva/piloto: pendiente.
- hardware certificado: todos los modelos continúan sin certificación productiva.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

## Gobernanza de `main`

`main` es la única rama canónica.

Branch protection preventiva nativa no está disponible para el repositorio privado con el plan GitHub vigente. GitHub reporta `protected: false` y sin required status checks.

Control compensatorio integrado:

- PR hacia `main` -> CI commit-scoped;
- push a `main` -> CI completo + `Main push governance`;
- merge permitido por política: merge commit normal mediante PR;
- direct push, squash y rebase -> violación detectada por workflow;
- el guard revisa el rango completo de primer padre introducido por cada push;
- gate exacto y post-merge: `docs/governance/repository-governance.md`.

Este control es detectivo, no preventivo.

## Ramas persistentes no canónicas

| Rama | Estado | Decisión |
|---|---|---|
| `architecture/foundation` | `INTEGRATED / HISTORICAL` | Eliminar cuando exista operación de borrado de ref autorizada/disponible. No reutilizar. |
| `architecture/physical-model` | `INTEGRATED / HISTORICAL` | PR #2 ya integrada; no reutilizar. |
| `cleanup/pure-pos-platform-20260825` | `INTEGRATED / HISTORICAL` | PR #3 ya integrada; no reutilizar. |
| `ci/supply-chain-baseline-20260826` | `INTEGRATED / HISTORICAL` | PR #5 ya integrada; no reutilizar. |
| `docs/canonical-state-reconciliation-20260826` | `INTEGRATED / HISTORICAL` | PR #6 ya integrada; no reutilizar. |
| `docs/camacho-pos-colombia-branding-20260826` | `INTEGRATED / HISTORICAL` | PR #7 ya integrada; no reutilizar. |
| `audit/main-governance-reconciliation-20260826` | `INTEGRATED / HISTORICAL` | PR #8 ya integrada; no reutilizar. |
| `brand/canonical-identity-assets-20260826` | `REDUNDANT_REF / NO_UNIQUE_COMMITS` | Idéntica a un baseline ya integrado; eliminar de forma segura cuando la operación de borrado de refs esté autorizada/disponible. |
| `design/sql003-contract-reconciliation-20260826` | `INTEGRATED / HISTORICAL` | PR #4 integrada; proposal V7 cerrada. No reutilizar para remediación autoritativa. |
| `docs/sql003-authoritative-contract-remediation-20260826` | `INTEGRATED / HISTORICAL` | PR #9 integrada; bundle V2 autoritativo cerrado. No reutilizar para SQL/descriptor 003. |
| `feat/sql003-v2-materialization-20260826` | `INTEGRATED / HISTORICAL` | PR #11 integrada; INT-007 cerrado. No reutilizar para ARCH-003 ni para runtime/providers. |
| `architecture/executable-boundaries-20260828` | `INTEGRATED / HISTORICAL` | PR #12 integrada; ARCH-003 cerrado. No reutilizar para TECH-003. |
| `tech/tech003-executable-contracts-20260828` | `INTEGRATED / HISTORICAL` | PR #14 integrada; TECH-003 cerrado. No reutilizar para TECH-004 ni runtime. |
| `tech/tech004-quality-supply-chain-20260828` | `IN_PROGRESS` | TECH-004; calidad, SAST, supply chain y evidencia de release. Primer slice sin runtime. |
| `wip/sql003-contract-gap-20260825` | `HISTORICAL_WIP / NOT_INTEGRABLE` | No merge/cherry-pick completo; retirar solo después de reconciliación autoritativa revisada y trazabilidad demostrada. |

Las ramas temporales de una PR pasan a `INTEGRATED` tras el merge y no se reutilizan, aunque GitHub conserve físicamente el ref.

## Flujo oficial de trabajo

`PLANNED -> READY -> IN_PROGRESS -> DONE`

con `BLOCKED`, `DEFERRED` y `OUT_OF_SCOPE` como estados explícitos.

Reglas:

1. Debe existir un solo trabajo principal `IN_PROGRESS`, salvo excepción documentada.
2. Un trabajo bloqueado no cuenta como línea principal activa, pero conserva causa y condición de desbloqueo.
3. No se abre otra rama para el mismo objetivo.
4. No se marca `DONE` por documentación si el criterio exige implementación.
5. Todo merge a `main` sigue el gate de gobernanza.
6. Cada cambio que altere estado/orden actualiza este backlog en el mismo PR.
7. No se usan estados locales históricos (`CLEAN`, upstream 0/0, Docker, PostgreSQL) como hechos presentes.
8. Un documento V2 abreviado nunca sustituye destructivamente contratos históricos ricos; las remediaciones usan overlays/versionado o reemplazo completo verificable sin pérdida.

## Trabajo principal actual

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `IN_PROGRESS`

Rama activa: `tech/tech004-quality-supply-chain-20260828`.

Primer slice autorizado: controles estáticos y de supply chain que pueden ejecutarse sin runtime productivo. CodeQL/SAST, hardening del inventory y el gate de vulnerabilidades de dependencias están materializados y ejecutados en la rama activa. SBOM, licencias completas y provenance permanecen sin materializar. No autoriza todavía NestJS, Electron, POS Local Service, named pipes, provider adapters ni despliegue productivo.

Los controles que dependen de aplicaciones/runtime — lint de apps, E2E, packaging, firma/release y promoción — permanecen pendientes hasta que existan artefactos ejecutables reales.

## Último bloque cerrado

### TECH-003 — contratos ejecutables compartidos

Estado: `DONE / INTEGRATED`.

PR #14 fue integrada desde exact HEAD `d37512634c823f16f71928671c46aaccc7f04d3c` como merge commit `148a6546657afed528d3da37b263134a944c09be`. CI exact-head #187 / run `33165786730` fue `SUCCESS`; CI post-merge #188 / run `33165957857` fue `SUCCESS`, incluida gobernanza de main, repository policy/dependency inventory, 57/57 contratos con 5/5 compatibilidad cruzada, TypeScript, SQLite, PostgreSQL 16.14 y MAT-003.

TECH-003 no implementa runtime, autenticación criptográfica productiva, providers ni producción.

## Bloque cerrado anterior

### ARCH-003 — límites ejecutables de módulos / Nx

Estado: `DONE / INTEGRATED`.

PR #12 fue integrada como `bc55851c7045105473d546667dce72718638a8b9`; CI post-merge #170 / run `33145497682` fue `SUCCESS`, incluida gobernanza de main, repository policy, ARCH-003 boundary gate, TypeScript, SQLite y PostgreSQL 16.14.

## Bloque cerrado anterior

### INT-007 — materialización SQL/descriptor 003 sobre bundle V2

Prioridad: `P0`

Estado: `DONE / INTEGRATED`

Baseline y autorización:

- rama: `feat/sql003-v2-materialization-20260826`;
- base exacta: `main@b28ca8850acc6b97385c80627a9d64b7ea607a42`;
- INT-006: `DONE`;
- bundle V2: `INTEGRATED / REVIEWED`;
- autorización separada para iniciar diseño/materialización SQL003: `GRANTED 2026-08-26`.
- Gate A contract remediation commit: `c0df539eb52d370fbfd0902a3df0d1ec94332398`; semantic dispatch checksum, credential binding pinning y definición física de catálogo remediados; evidencia exact-head CI/Codex todavía requerida antes de Gate B.
- Gate A exhaustiveness hardening: definitions must cover exact set equality for every advertised constraint/index/guard/policy; semantic FISCAL fields are explicitly NOT NULL by CHECK semantics; normative one-IN_PROGRESS and one-FISCAL-dispatch indexes are required.
- Gate A local-numbering hardening: `AUTHORIZED_RANGE|LOCAL_CONTINGENCY` require non-null start/end/cursor before numeric comparisons so PostgreSQL CHECK three-valued logic cannot admit unusable configurations.
- Gate A function/transition hardening: all fiscal functions referenced by guards/policies/checks require canonical SQL definitions; migration 003 must validate `integration_dispatches_dispatch_class_003_ck` before retiring 002, and down must validate restored 002 before retiring 003.
- Gate A preparation-scope hardening: preparation INSERT revalida bajo lock document generation/type, configuration `PUBLISHED` + vigencia + branch, connection vigencia e `ExternalIntegration=ACTIVE`; no basta una FK histórica.
- Gate A reprepare-closure hardening: deferred current-generation validator requires predecessor preparation `CANCELLED`, any historical FISCAL dispatch `CANCELLED`, and no predecessor numbering left `RESERVED` before commit.
- Gate A published-config hardening: published fiscal configuration material is immutable; only local numbering cursor/exhaustion plus row-version/timestamp may advance, and terminal versions cannot be rewritten.
- Gate A branch hardening: preparation branch must equal ElectronicDocument branch at INSERT and deferred current-generation validation.
- Gate A late-evidence hardening: CANCELLED remote PENDING_EXTERNAL may resolve only to CONSUMED|UNKNOWN_OUTCOME with admissible generation-scoped evidence; local numbering history remains immutable.
- Gate A webhook fence hardening: VERIFIED auth+replay correlation acquires document→preparation→dispatch fence; provider-specific general-receipt selector remains an explicit versioned external contract with tenant/integration-only matching forbidden.
- Gate A claim hardening: PostgreSQL revalidates ACTIVE integration, adapter/declaration/capability, credential binding, connection/config and document/preparation/dispatch; FISCAL_EMISSION_SNAPSHOT_V2 external material must be compared fail-closed by the command under the same fence.
- Gate A claim lock-order hardening: ProviderCapabilityDeclaration→ProviderAdapterVersion→ExternalIntegration→IntegrationCapability→credential binding→FiscalConnection/config/version→document/preparation/dispatch; current capability rows are locked, not merely counted.
- Gate A configuration-selection hardening: preparation and claim re-resolve effective BRANCH>COMPANY version under locked FiscalConnection coordinator; publication after freeze cannot silently leave an obsolete company-wide snapshot eligible.
- Gate A preparation lock-order hardening: preparation now locks Declaration→Adapter→ExternalIntegration→IntegrationCapability→FiscalConnection→Config/Version before ElectronicDocument/predecessor; caller must not pre-lock a successor and the FiscalConnection coordinator precedes the BRANCH/COMPANY candidate scan.
- Gate A declaration lock-mode hardening: ProviderCapabilityDeclaration is consumed with `FOR UPDATE` in preparation and claim, matching downgrade serialization.
- Gate A claim caller-order hardening: attempt trigger is defense-in-depth only; claim command must own the canonical upstream prefix before Document/Dispatch state mutation and attempt INSERT, with commit before HTTP.
- Gate A post-claim evidence hardening: live integration/capability/connection/config eligibility is revalidated only when entering `IN_PROGRESS`; response/evidence persistence after durable claim validates immutable root scope and cannot be blocked by later downgrade/expiry.
- Gate A late-evidence authorization hardening: any mutation of a CANCELLED historical preparation requires durable `VERIFIED_LATE_REMOTE_EVIDENCE_V1` comparator output; late numbering additionally binds `numbering_resolution_reason` to the exact lowercase SHA-256 comparator evidence checksum.
- Gate A late-evidence value binding: comparator `expected_state_reference` must equal the canonical JSON array of the exact late mutation values (prefix, number, numbering_state, provider_document_id/reference/status); a valid evidence checksum cannot authorize different values.
- Gate A webhook privilege boundary: historical quarantine runs with invoker privileges; no `SECURITY DEFINER` widening is introduced. An ingress role unable to quarantine fails closed and must defer fiscal linkage to the authorized `pos_worker` correlator.
- Gate A historical quarantine hardening: accepted late historical evidence and historical webhook correlation quarantine the current pre-terminal generation to `UNKNOWN_OUTCOME` in the same transaction; current QUEUED dispatch remains durable but unclaimable.
- Gate A webhook timing hardening: fiscal correlation guard is AFTER-write validation/quarantine under invoker privileges; canonical lock acquisition remains a caller precondition and no privilege widening is introduced.
- Gate A receipt-update transition hardening: 003 creates `external_webhook_receipts_update_guard_003` with the exact 002 lifecycle allowlist plus the five fiscal linkage fields before dropping the narrower 002 guard; down restores 002 first, so there is no permissive window.
- Gate A receipt lock-order hardening: `external_webhook_receipts_fiscal_correlation_guard` fires only on INSERT or UPDATE OF the five fiscal linkage columns. Ordinary 002 processing-status updates bypass the fiscal fence and cannot acquire receipt-before-document locks.
- Gate A publication-coordinator hardening: DRAFT→PUBLISHED takes `FiscalConnection FOR UPDATE`; publication command must acquire that coordinator before updating the version so BRANCH>COMPANY selection and publication share the same phantom fence.
- Gate A webhook-ingress privilege hardening: migration003 converts inherited table-wide `pos_platform_app INSERT` into base-column INSERT only; the five fiscal linkage columns are NULL at ingress and `pos_worker` is the sole fiscal linkage writer under the canonical fence.
- Gate A dispatch-ingress privilege hardening (self-found during Gate B preparation): migration002 also gives `pos_platform_app` table-wide INSERT on `integration_dispatches`; 003 must convert it to exact base-002-column INSERT so the four fiscal extension columns remain inaccessible while non-fiscal platform dispatch creation remains available.
- Gate A webhook lock-order clarification: receipt trigger is revalidation only; correlator command must lock document→preparation→dispatch before mutating/inserting the receipt linkage.
- Gate A connection hardening: FiscalConnection closure is CAS-versioned and irreversible; a closed connection cannot be reopened, extended or rewritten.
- Gate A closure record: `DONE / FROZEN`; the historical pending/remediation-candidate checkpoints are superseded by exact-head CI #98 and Codex closure on `c297d465cbfb9349f53d3f2e368034dddb9ca545`. Gate B is the only active INT-007 gate.

Alcance autorizado:

- Gate A: descriptor 003, catálogo esperado, constantes/exports y tests estáticos del contrato materializable; incluye definiciones físicas verificables, checksum semántico por dispatch y credential binding generation por attempt;
- Gate B: SQL PostgreSQL 003 up/down, runner apply/down, introspection, smoke, grants/RLS/guards y pruebas funcionales/concurrencia del target de diez tablas;
- preservar migrations 001/002 byte-for-byte;
- mantener SQLite migration 003 en `NONE`;
- usar exclusivamente Modelo A y `SUBMIT_DOCUMENT` físico V1.

No alcance:

- adapters SIIGO/FACTUS/ALEGRA;
- HTTP/credenciales/sandbox provider;
- runtime NestJS/Electron;
- promoción de `SEC-G01..SEC-G10`;
- query/retrieve físico V1;
- merge de la rama sin gate posterior separado.

INT-007 no se considera `DONE` por crear el descriptor ni por producir SQL estático. Requiere DDL ejecutable, validación de catálogo, apply/down, regresión 001/002, CI exact-head y revisión independiente.

Checkpoint final 2026-08-28:

- Gate A: `PASS / FROZEN`.
- Gate B: `PASS / CLOSED`.
- INT-007: `DONE / INTEGRATED`.
- Exact implementation HEAD: `39c56d030954f3bef20b84f773e4a4f76766a06b`.
- CI exact-head #158 / run `33141808515`: `SUCCESS`.
- Codex exact-head: `Didn't find any major issues`; review threads `48/48 RESOLVED`.
- PR #11: `MERGED / CLOSED`.
- Merge commit: `8676caef419d70732f74489a413ae7fda2c49d0c`.
- CI post-merge #159 / run `33142409080`: `SUCCESS`; main governance, repository policy/dependency inventory, TypeScript, SQLite, PostgreSQL 16.14 y tooling MAT-003 verdes.
- Artifact post-merge: `int-007-gate-b-8676caef419d70732f74489a413ae7fda2c49d0c`.
- Providers, HTTP/credenciales/sandbox, runtime, hardware, producción y `SEC-G01..SEC-G10` permanecen fuera del cierre de INT-007.

### INT-006 — remediación contractual autoritativa de migration 003

Prioridad: `P0`

Estado: `DONE`

Baseline habilitante:

- PR #4 `MERGED / CLOSED`;
- propuesta `PROPOSAL_V7 / MODEL_A_SELECTED`;
- CI V7 `SUCCESS`;
- revisión independiente V7 `PASS`;
- PR #9 `MERGED / CLOSED` sobre HEAD exacto `655b824fee296a7bececa113bbb9dd0d0ca84a93`;
- `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
- Codex final sobre `655b824fee`: sin major issues;
- post-merge #64 `SUCCESS` en `main@be986884cd21aae11f84e64a56158705197325d0`.

Resultado cerrado:

- reconciliar fuentes autoritativas sin perder detalle histórico;
- seleccionar Modelo A exclusivamente;
- materializar documentalmente `preparation_generation` y una representación append-only de cada preparación;
- separar create/replay, edición DRAFT, reprepare y retry;
- mantener root provider-facing estable por dispatch/generation;
- limitar V1 a `SUBMIT_DOCUMENT`;
- definir fence común frente a worker/webhook/reconciliation;
- preservar numeración histórica sin reuse;
- mantener SQL003/descriptor003 ausentes; su diseño/materialización exige autorización separada posterior.

Bundle autoritativo integrado:

- `docs/migration/sql003-authoritative-contract-remediation-index.md`;
- `docs/migration/sql003-authoritative-contract-codex-resolution.md`;
- `docs/migration/third-target-migration-manifest-v2-authoritative-remediation.md`;
- `docs/architecture/physical-model/electronic-invoicing-schema-v2-authoritative-remediation.md`;
- `docs/architecture/physical-model/fiscal-integration-fence-schema.md`;
- `docs/architecture/electronic-invoicing-v2-authoritative-remediation.md`;
- `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle-v2-authoritative-remediation.md`.

Gate de cierre de esta línea:

1. commit atómico y diff documental delimitado;
2. CI commit-scoped `SUCCESS`;
3. revisión independiente del HEAD exacto;
4. cero BLOCKER/HIGH/MEDIUM abiertos;
5. `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
6. integración a `main` solo mediante autorización separada y gate de merge vigente.

Cierre verificado: los seis criterios se cumplieron; PR #9 fue integrada y el run post-merge #64 cerró `SUCCESS`.

Ese cierre **no** materializa SQL003; únicamente habilita una tarea posterior separada para diseñarlo.

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `IN_PROGRESS`

Rama activa: `tech/tech004-quality-supply-chain-20260828`.

Baseline ya materializado:

- gate TARGET en PR y push a `main`;
- Nx + límites ejecutables de dependencias integrados por ARCH-003;
- typecheck del tooling actual;
- SQLite migrations/regresiones actuales;
- PostgreSQL 001/002 + MAT-003 tooling;
- repository policy;
- scanner baseline de secretos trackeados;
- frozen lockfile;
- dependency/license inventory;
- artifact obligatorio;
- Actions fijadas por SHA;
- `persist-credentials: false`;
- regresión ejecutable del rango de primer padre de `main`;
- gobernanza detectiva de push a `main`.

Pendiente cuando se retome como línea activa:

- lint del runtime/aplicaciones;
- CodeQL/SAST + Bloque 1 hardening: `59d5b57110138236e056ca93c969b0a208f2c293`, TARGET #200 y CodeQL #11 SUCCESS; SARIF 0 results, workspace inventory tests PASS;
- vulnerability scanning con piso high/critical materializado y ejecutado en Bloque 2; checkpoint 691b5051599c735f393c13d3dad8d67bcde8af01, TARGET #201 y CodeQL #12 SUCCESS, audit 0 advisories;
- SBOM estándar y firmado;
- compatibilidad legal de licencias completa;
- provenance/attestations;
- firma de releases;
- runtime/E2E tests;
- controles de release/promoción.

TECH-004 no está `DONE`. La línea está activa desde `main@148a6546657afed528d3da37b263134a944c09be`. Primero materializa controles estáticos/supply-chain independientes de runtime; los gates de runtime/E2E/release se incorporan cuando existan artefactos ejecutables reales.

## Orden inmediato obligatorio

1. Mantener **INT-007**, **ARCH-003** y **TECH-003** `DONE / INTEGRATED`; no reabrirlos salvo defecto reproducible o decisión versionada nueva.
2. **TECH-004** es la única línea principal activa: endurecer CI/calidad/supply chain sin inventar runtime para satisfacer un gate.
3. Primer slice TECH-004: SAST/CodeQL, política de vulnerabilidades y evidencia SBOM/licencias/provenance que puedan evaluarse sobre el repositorio actual.
4. El primer esqueleto de runtime conforme a ADR-005/DEC-010 se inicia solo como tarea separada y sobre el baseline de calidad vigente; al existir apps se extiende TECH-004 con lint/E2E/release gates.
5. La limpieza de ramas históricas es mantenimiento separado; no mezclarla con TECH-004.

No se inicia NestJS/Electron “por avanzar” dentro del commit de transición de TECH-004.

## Gate SQL003

### INT-007 / materialización 003

Estado de materialización: `DONE / INTEGRATED / NOT_DEPLOYED_TO_PRODUCTION`.

PR #9 fue revisada, integrada y validada post-merge; PR #10 reconcilió el backlog y el run #67 validó el nuevo `main`. Los requisitos técnicos/documentales 1–5 del gate estaban cumplidos y la autorización explícita y separada del punto 6 fue otorgada el 2026-08-26. La ejecución queda limitada a INT-007 y no autoriza providers, runtime ni promoción de seguridad.

Decisiones cerradas y consolidadas en el bundle autoritativo integrado:

- Modelo A exclusivamente;
- `REPREPARE_BEFORE_SUBMISSION` solo pre-exposure;
- `FiscalDocumentPreparation` como representación durable por generation;
- dispatch anterior cancelado atómicamente;
- numeración histórica no reutilizable;
- retry con root estable y attempts append-only;
- `SUBMIT_DOCUMENT` como único operation type físico V1;
- query/retrieve diferidos y fail-closed;
- fence worker/webhook/reconciliation por documento/generation.

Condición para desbloquear una **tarea posterior de materialización**:

1. bundle V2 completo — `PASS`;
2. CI exact-head de PR #9 — `PASS`;
3. review independiente del HEAD exacto — `PASS`;
4. `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
5. integración documental + post-merge #64 — `PASS`;
6. autorización separada para iniciar diseño/materialización SQL003 — `PASS / GRANTED 2026-08-26`.

Autorizado exclusivamente dentro de INT-007:

- descriptor 003 y catálogo esperado;
- SQL PostgreSQL 003 up/down;
- runner/apply/down 003;
- schema fiscal y extensiones 003 de tablas `integrations`;
- introspection/smoke/tests necesarios para demostrar el target.

Continúa no autorizado:

- adapters provider y llamadas HTTP;
- credenciales/sandbox;
- promoción de security gates;
- runtime;
- query/retrieve físico V1;
- merge/cherry-pick completo del WIP histórico.

## Backlog por épica

### Arquitectura

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| ARCH-001 | P0 | DONE | Monolito modular, monorepo, local-first y single codebase definidos. |
| ARCH-002 | P0 | DONE | Contexto, tenancy, deployment y ownership definidos. |
| ARCH-003 | P0 | DONE | PR #12 integrada; Nx + límites ejecutables 13/13 PASS y post-merge #170 SUCCESS. |
| ARCH-004 | P0 | DONE | Contratos renderer/Electron/local/API/hardware/providers definidos; extensión fiscal V2 de INT-006 integrada y revisada, sin runtime. |
| ARCH-005 | P0 | DONE | Stack objetivo cerrado en ADR-005. |

### Seguridad

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| SEC-001 | P0 | DONE | Modelo de seguridad, roles y permisos documentados. |
| SEC-002 | P0 | DONE | Permisos atómicos, ABAC, SoD y pruebas negativas definidas. |
| SEC-003 | P0 | PLANNED | Implementar tenant isolation, sesiones, MFA y reautenticación. |
| SEC-004 | P0 | DONE | Secretos, claves, firma y soporte JIT definidos. |
| SEC-G01 | P0 | PLANNED | Tenant Isolation — NOT_EVALUATED. |
| SEC-G02 | P0 | PLANNED | Authentication & Session — NOT_EVALUATED. |
| SEC-G03 | P0 | PLANNED | Authorization RBAC/ABAC — NOT_EVALUATED. |
| SEC-G04 | P0 | PLANNED | Device Trust & License — NOT_EVALUATED. |
| SEC-G05 | P0 | PLANNED | Local-first Integrity/Replay — NOT_EVALUATED. |
| SEC-G06 | P0 | PLANNED | Audit & Anti-Fraud — NOT_EVALUATED. |
| SEC-G07 | P0 | PLANNED | Secrets & Cryptography — NOT_EVALUATED. |
| SEC-G08 | P0 | PLANNED | API/Webhook/Input Security — NOT_EVALUATED. |
| SEC-G09 | P0 | PLANNED | Infra/Supply Chain/Backup — NOT_EVALUATED. |
| SEC-G10 | P0 | PLANNED | Security Release Gate — NOT_EVALUATED. |

### Catálogo

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CAT-001 | P0 | DONE | Producto, identificadores, variantes, presentaciones y conversiones definidos. |
| CAT-002 | P1 | READY | Persistencia física alineada con DEC-004/TECH-002; preparar implementación futura. |
| CAT-003 | P1 | PLANNED | Implementar Catalog multiempresa. |
| CAT-004 | P3 | DEFERRED | Especialización droguería. |

### Precios / promociones / impuestos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PRICE-001 | P0 | DONE | Programación/resolución de precios definida. |
| PRICE-002 | P0 | DONE | `PRICING_PIPELINE_V1` y orden definitivo cerrados. |
| PRICE-003 | P1 | PLANNED | Implementar versiones/vigencias/snapshots offline. |
| PROMO-001 | P0 | DONE | Creación/aplicación de promociones definida. |
| PROMO-002 | P1 | PLANNED | Persistencia de reglas/contadores idempotentes. |
| PROMO-003 | P1 | PLANNED | Motor determinista de promociones. |
| TAX-001 | P0 | DONE | Resolución/cambios tributarios definidos. |
| TAX-002 | P0 | DONE | Redondeo total pagadero definido. |
| TAX-003 | P0 | DONE | Precisión/residuos/conciliación y rounding final cerrados. |
| TAX-004 | P1 | PLANNED | Implementar Electronic Invoicing tras INT-006/TECH-003/gates. |
| UC-EINV-001 | P1 | DONE | Contrato funcional base documentado; overlay V2 autoritativo integrado por INT-006, sin runtime. |

### Integraciones externas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INT-001 | P0 | DONE | Contrato provider-neutral y ownership cerrados. |
| INT-002 | P0 | DONE | Manifest migration 002 cerrado. |
| INT-003 | P0 | DONE | Migration 002 materializada/tested/immutable. |
| INT-004 | P1 | PLANNED | Adapters SIIGO/FACTUS/ALEGRA reales; no mocks como evidencia. |
| INT-005 | P2 | PLANNED | Evaluar HKA/Odoo sin adapters ficticios. |
| INT-006 | P0 | DONE | Remediación contractual autoritativa V2 integrada/revisada por PR #9; contrato cerrado. |
| INT-007 | P0 | DONE | Gate A PASS/FROZEN; Gate B PASS/CLOSED; PR #11 MERGED/CLOSED; post-merge #159 SUCCESS sobre `main@8676caef419d70732f74489a413ae7fda2c49d0c`. |

### Pagos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PAY-000 | P0 | DONE | Lifecycle conceptual de pagos. |
| UC-PAY-001 | P0 | DONE | Pago individual. |
| UC-PAY-002 | P0 | DONE | Pago mixto/fallo parcial. |
| UC-PAY-003 | P0 | DONE | Transferencia manual/QR. |
| UC-PAY-004 | P0 | DONE | Refund/reversal. |
| UC-PAY-005 | P0 | DONE | Settlement/reconciliation. |
| PAY-007 | P0 | DONE | Máquinas de estado separadas y autoridad cerrada. |
| PAY-008 | P1 | PLANNED | Persistencia física de pagos. |
| PAY-009 | P1 | PLANNED | Implementación/concurrencia/idempotencia/permisos/recovery. |

### Caja

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CASH-001 | P0 | DONE | Apertura definida. |
| CASH-002 | P0 | DONE | Cierre/diferencia definidos. |
| CASH-003 | P0 | DONE | Movimientos, retiros, arqueos y compensaciones definidos. |
| CASH-004 | P1 | PLANNED | Implementar caja por terminal/turno. |

### Ventas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SALES-001 | P0 | DONE | Confirmación atómica/idempotente definida. |
| SALES-002 | P0 | DONE | Suspensión/recuperación/cancelación/devolución/reimpresión. |
| SALES-003 | P1 | PLANNED | Implementar pipeline comercial/snapshots. |

### Compras / proveedores

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PUR-001 | P1 | PLANNED | Definir PurchaseOrder/SupplierReturn sin contaminar GoodsReceipt. |
| PUR-002 | P1 | PLANNED | Implementar capacidades de compra/proveedor separadas de Payment de cobros. |

### Inventario

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INV-001 | P0 | DONE | GoodsReceipt definido. |
| INV-002 | P0 | DONE | Movimientos/reservas/ajustes/lotes/traslados/concurrencia definidos. |
| INV-003 | P1 | PLANNED | Implementar movimientos como fuente y saldos como proyección. |

### Clientes / crédito

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CUST-001 | P1 | PLANNED | Alta/edición/búsqueda/privacidad. |
| CUST-002 | P1 | PLANNED | Cuenta/cupo/mora/abonos; depende de DEC-005. |
| CUST-003 | P2 | PLANNED | Implementación auditable. |

### Domicilios

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| DEL-001 | P3 | DEFERRED | Pedido/preparación/asignación/recaudo/PIN/incidencias. |
| DEL-002 | P3 | DEFERRED | App domiciliario/GPS limitado. |
| DEL-003 | P3 | OUT_OF_SCOPE | No forma parte del primer núcleo Fase 1. |

### Onboarding

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| ONB-001 | P0 | DONE | Inicialización tenant/company/branch/owner definida. |
| ONB-002 | P0 | PLANNED | Bootstrap transaccional/idempotente/auditable. |
| ONB-003 | P2 | PLANNED | Importación masiva/migración asistida. |

### Licencias / dispositivos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| LIC-001 | P0 | DONE | Validación HYBRID/LOCAL_PERPETUAL. |
| LIC-002 | P0 | DONE | Lifecycle contractual-operativo cerrado. |
| LIC-003 | P1 | PLANNED | Implementar entitlements/límites/dispositivos. |
| DEV-001 | P0 | DONE | Lifecycle dispositivo. |
| DEV-002 | P0 | DONE | Identidad segura + licencia. |
| DEV-003 | P1 | PLANNED | Simuladores/adapters hardware; certificación requiere equipos reales. |

### Sincronización

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SYNC-001 | P0 | DONE | Operation/outbox/inbox/idempotencia/checkpoint definidos. |
| SYNC-002 | P0 | DONE | Configuración offline versionada por dominio. |
| SYNC-003 | P0 | DONE | Conflictos/retry/recovery/dead letter/clock definidos. |
| SYNC-004 | P1 | PLANNED | Venta offline real sin duplicación/pérdida. |

### Reporting

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| REP-001 | P1 | PLANNED | Reportes por rol. |
| REP-002 | P2 | PLANNED | Proyecciones/procesamiento async sin source-of-truth paralelo. |
| REP-003 | P2 | PLANNED | Exportación/privacidad/métricas. |

### UX

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| UX-001 | P1 | DONE | Navegación inicial/decisiones UX. |
| UX-002 | P1 | PLANNED | Flujos POS venta/pago/offline/hardware. |
| UX-003 | P1 | PLANNED | Design system accesible/resoluciones/touch. |
| UX-004 | P2 | PLANNED | Usabilidad por rol/tipo de comercio. |

### Diseño técnico

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| TECH-001 | P0 | DONE | Modelo conceptual y ownership. |
| TECH-002 | P0 | DONE | Modelo físico base + migrations 001/002/materialización revisada. |
| TECH-003 | P0 | DONE | PR #14 integrada; 57/57 contratos + 5/5 compatibilidad cruzada, CI exact-head #187 y post-merge #188 SUCCESS. |
| TECH-004 | P0 | IN_PROGRESS | Rama `tech/tech004-quality-supply-chain-20260828`; primer slice estático de SAST/vulnerabilidades/SBOM/licencias/provenance. |
| TECH-005 | P1 | PLANNED | Observabilidad/backups/restore/update/rollback. |
| TECH-006 | P1 | PLANNED | Fixtures multi-tenant/concurrencia/recovery. |

## Decisiones

### Cerradas P0

- DEC-001: taxonomía de estados de pagos.
- DEC-002: compensación de pagos.
- DEC-003: pricing pipeline.
- DEC-004: Product/Variant/Presentation.
- DEC-006: rounding policy.
- DEC-007: autoridad local-first.
- DEC-008: device trust/license activation.
- DEC-009: baseline operacional productivo.
- DEC-010: runtime POS.

### Pendiente

| ID | Pri | Estado | Bloquea |
|---|---|---|---|
| DEC-005 | P1 | DEFERRED | Crédito offline: CUST-002/PAY-009. |

## Hitos

| Hito | Estado | Criterio vigente |
|---|---|---|
| Fase 0 | DONE | Fundación documental/decisiones P0 cerradas. |
| F1.1 Esqueleto modular y contratos | IN_PROGRESS | ARCH-003 y TECH-003 DONE; esqueleto runtime aún pendiente y no se mezcla con el primer slice estático de TECH-004. |
| F1.2 Modelo físico/migrations | DONE | TECH-002 e INT-006 cerrados; migrations 001/002 inmutables; SQL003 integrado por PR #11 con Gate A/B PASS y post-merge #159 SUCCESS. Despliegue productivo no iniciado. |
| F1.3 Seguridad/identidad | PLANNED | SEC gates con evidencia runtime real. |
| F1.4 CI/calidad | IN_PROGRESS | baseline vigente PASS; pipeline integral depende de runtime/apps y permanece incompleto. |
| F1.5 Primer corte vertical | PLANNED | Onboarding mínimo autenticado/auditado/idempotente. |
| F1.6 Base local-first | PLANNED | Operation/outbox/sync real sin duplicación. |

## Riesgos abiertos

| ID | Sev | Riesgo | Cierre |
|---|---|---|---|
| R-001 | Alta | Confundir docs/tooling con runtime. | Claims por nivel + evidencia ejecutable. |
| R-003 | Alta | Pagos externos sin atomicidad distribuida. | Idempotencia/UNKNOWN_OUTCOME/compensación/reconciliation. |
| R-004 | Alta | Tenant isolation no probado en runtime. | SEC-003 + SEC-G01 real. |
| R-005 | Alta | Local-first aún no implementado extremo a extremo. | SYNC-004 y suites SQLite/PostgreSQL. |
| R-006 | Alta | Sobre-modelado físico de dominios pendientes. | Manifests/reviews aditivos; no DDL especulativo. |
| R-007 | Media | Pricing documentado, runtime pendiente. | Implementación determinista + tests. |
| R-008 | Media | RPO/RTO/volumen sin benchmark. | TECH-005 + medición. |
| R-009 | Media | Hardware sin validación real. | DEV-003 + LAB_VALIDATED/CERTIFIED. |
| R-010 | Alta | Una materialización SQL003 futura puede derivar del bundle autoritativo o perder historia contractual/numeración. | Bundle V2 integrado + índice de precedencia + CI/review exact-head obligatorios para cualquier tarea SQL003. |
| R-011 | Alta | Runtime objetivo ausente. | ARCH-003/TECH-003 -> esqueleto -> gates. |
| R-012 | Media | Firma/keys/support definidos pero no implementados. | SEC-004 materializado + pruebas. |
| R-013 | Alta | `main` sin branch protection preventiva por limitación de plan. | Control detectivo vigente; habilitar protección cuando plan lo permita. |
| R-014 | Media | Drift documental puede reabrir pasos ya cerrados. | Fuente vigente compacta + reconciliación obligatoria en el mismo PR. |

## Trazabilidad histórica

La historia detallada anterior a esta reconciliación no se elimina: permanece en el historial Git de `docs/product/backlog.md`, commits, PRs y workflows.

Los hitos que sustentan el baseline actual incluyen, entre otros:

- migration 001 materializada desde el corte autorizado de TECH-002;
- migration 002 External Integrations materializada y mantenida inmutable;
- MAT-003 preflight/readiness revisados;
- cleanup legacy integrado por PR #3;
- fundación TARGET integrada por PR #2;
- supply-chain/governance integrada por PR #5;
- reconciliación canónica por PR #6;
- identidad comercial por PR #7;
- hardening de gobernanza por PR #8;
- propuesta SQL003 V7 integrada por PR #4;
- run post-merge #54 PASS sobre `bdc0f96323069de821e975737f19961fd16c3ccf`;
- remediación contractual autoritativa V2 integrada por PR #9 con `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
- run post-merge #64 PASS sobre `be986884cd21aae11f84e64a56158705197325d0`.

El registro histórico sirve como evidencia, no como cola de trabajo vigente.

## Regla de cierre

Una tarea no está cerrada hasta que:

1. el artefacto existe;
2. cumple alcance y criterios;
3. las validaciones reales aplicables pasan;
4. el diff fue revisado;
5. el backlog refleja el estado nuevo;
6. branch/PR/merge quedan reconciliados conforme a governance;
7. no queda una rama activa sin objetivo o condición de bloqueo;
8. no se deja una fuente normativa contando un estado incompatible;
9. ninguna remediación reduce o elimina silenciosamente detalle contractual previamente aprobado.
- Gate B SQL003 materialization: IN_PROGRESS from final Gate A baseline `126762479cfdd184d282688b5e86ff04fa38c56a`; first atomic slice freezes generated PostgreSQL 003 up/down artifacts from the closed catalog with byte-parity tests. Runner/introspection/smoke remain pending in the next slice.

- Gate B MAT-003 transition: preflight remains read-only and still requires fiscal schema ABSENT + ledger003=0, but its repository test now recognizes the authorized PostgreSQL 003 up/down artifacts as PRESENT_UNAPPLIED; SQLite003 remains NONE.

- Gate B role-readiness transition: lifecycle v2 already reports repository SQL003 as PRESENT_UNAPPLIED when both PostgreSQL artifacts exist; its current-state test now matches that truthful governance value while keeping migration_003_ledger_entries=0 and fiscal_schema=ABSENT.

- Gate B P1 remediation: canonical preparation/claim row locks now receive only column-scoped UPDATE on immutable identity sentinels where PostgreSQL requires an UPDATE privilege; no SECURITY DEFINER or business-column widening is introduced, and down revokes all predecessor-table sentinel grants.

- Gate B P1 remediation: pos_worker historical CANCELLED-preparation RLS no longer calls a helper that re-queries fiscal_document_preparations under FORCE RLS; the policy now evaluates durable external/correlated evidence directly, including VERIFIED_LATE_REMOTE_EVIDENCE_V1 comparator output.

- Gate B self-review hardening: fiscal_connections.id is now explicitly covered by guard_connection_scope identity immutability, making the worker's id-only row-lock sentinel incapable of legitimate mutation while still satisfying PostgreSQL row-lock privilege requirements.

- Gate B Codex remediation: renamed the 003 fiscal receipt/dispatch index to external_webhook_receipts_fiscal_dispatch_fk_idx so migration002 external_webhook_receipts_integration_fk_idx remains untouched on apply/down.

- Gate B Codex remediation: pos_app reprepare receipt fencing now has id-only UPDATE sentinel privilege on integrations.external_webhook_receipts; the existing 002/003 update guards still reject id mutation and down revokes the sentinel.

- Gate B CI remediation: descriptor function-reference coverage now includes function-to-function calls while excluding each function's own CREATE declaration, so nested helper dependencies remain enforced after policy refactors.

- Gate B runner slice: runner 003 apply/down materialized with MAT-003 prerequisite, global migration lock, exact 001/002 checksum verification, artifact/repository-commit ledger binding, durable apply receipt, exact catalog introspection, minimal real-role smoke, guarded fresh/test-only down and exact-002 restoration validation. Exact-head CI/Codex evidence remains pending; Gate B is not PASS.

- Gate B runner CI #101 remediation: la primera ejecución física detectó una incompatibilidad de validación, no de DDL: `validatePostgresCatalog()` conserva correctamente la precondición histórica 001 que prohíbe `electronic_documents` antes de 003. Introspection 003 deja ese validador inmutable y valida el baseline 001 por schemas/tablas/columnas exactas dentro de su propio scope. Evidencia exact-head nueva requerida.

- Gate B runner CI #102 remediation: descriptor y SQL003 contienen el mismo conjunto de 16 policies; introspection se endurece para comparar identidad exacta `schema.table|policy` derivada de `exactPolicyDefinitions`, en vez de una lista de nombres sin scope. Gate B continúa `NO_PASS` hasta evidencia física verde.

- Gate B runner CI #103 remediation: el commit anterior introdujo escapes literales de backticks al serializar el bloque TypeScript por API. Se corrige únicamente esa sintaxis; la regla de comparación exacta `schema.table|policy` no cambia. Evidencia exact-head nueva requerida.

- Gate B runner CI #104 remediation: el parser de policy conservó `\\s` dentro de un regex literal y por ello buscaba una barra invertida real. Se corrige a `\s` sin cambiar el contrato ni el DDL. Evidencia exact-head nueva requerida.

- Gate B runner CI #105 physical finding: PostgreSQL truncó `fiscal_emission_configuration_versions_platform_tenant_isolation` (64 bytes) por `NAMEDATALEN-1=63`. Auditoría de 283 identificadores confirmó que es el único exceso. Se renombra a `fiscal_emission_configuration_versions_platform_tenant_select` (61) y se agrega regresión ejecutable `<=63`; no cambia semántica RLS ni Modelo A.

- Gate B runner CI #106 diagnostic: el límite de identificadores ya pasó, pero introspection reportó divergencia de columnas en `identity.users` pese a que SQL003/MAT-003 no alteran esa tabla. Se mantiene fail-closed y se amplía el error para capturar `actual` vs `expected` antes de decidir remediación.

- Gate B runner CI #107 finding: `actual=[]` confirmó que no había drift de `identity.users`; `information_schema.columns` ocultaba columnas por visibilidad del rol efectivo. Introspection 003 migra sus comprobaciones físicas de columnas a `pg_attribute/pg_class/pg_namespace`, igual que el validator 001, manteniendo comparación exacta y sin depender de grants.

- Gate B runner CI #108 finding: la siguiente capa falló en la matriz de grants porque `information_schema.column_privileges` también depende de visibilidad del rol efectivo. Introspection 003 pasa a reconstruir privilegios efectivos desde `pg_class.relacl` + `pg_attribute.attacl` mediante `aclexplode`, siguiendo el patrón ya probado en migration 002; la matriz esperada permanece intacta.

- Gate B runner CI #109 diagnostic: la matriz ACL ya pasó y el flujo alcanzó `finishApplied`, pero el UPDATE final del ledger recibió `42501 permission denied`. SQL003 no cambia roles de sesión; se añade `verifyRuntime()` post-smoke para capturar `session_user/current_user` exactos antes de cualquier remediación de permisos.

- Gate B runner CI #110 finding: post-smoke se observó `session_user=pos_migrator/current_user=pos_migrator`; `pos_migrator` es deliberadamente `NOINHERIT`, por lo que no puede cerrar el ledger. SQL003 no modifica membresías. El runner reestablece explícitamente `SET ROLE pos_schema_owner` tras el smoke, vuelve a verificar identidad y solo entonces finaliza `APPLIED`; no se conceden privilegios directos nuevos.

- Gate B runner CI #111 finding: apply inicial y down-guard ya pasan; el único fallo restante era idempotencia porque MAT-003 histórico exige pre-003/cero ledger y se invocaba también para `ALREADY_APPLIED` y reapply tras `ROLLED_BACK`. El runner resuelve primero `APPLIED`/`STARTED+target-003` bajo lock; MAT-003 mantiene modo cero-historial estricto por defecto y el reapply usa un modo explícito que admite únicamente historial exacto `ROLLED_BACK`, con fiscal ausente y revalidación completa bajo lock antes de mutar.

- Gate B runner CI #112 remediation: el query de historial state-aware ordenaba por `started_at/execution_id`, columnas no incluidas en el grant SELECT mínimo de MAT-003; eso produjo `42501` y `PREFLIGHT_EXECUTION_FAILED`. Se mantiene least-privilege y se ordena solo por `migration_id/status`, sin ampliar permisos.

- Gate B Codex exact-head review on `89507451f58dffe5db14852d35443668c8dac79e` validated the apply/down state-machine races and committed-down crash gap as real. Remediation: apply DDL transaction SHARE-locks all MAT-003 blocker relations and revalidates blockers before SQL003; down SHARE-locks all fiscal/dependent history relations before zero-history count and holds them through rollback DDL commit; exact-002 pre-003 plus receipt-bound APPLIED is reconciled to ROLLED_BACK. No 001/002/runtime/provider scope change. Fresh exact-head CI + review required.

- Gate B Codex semantic-introspection/ACL findings on `89507451...` confirmed: validator compared several 003 objects only by identity and ignored non-SELECT/INSERT/UPDATE runtime fiscal privileges. Remediation now compares constraint/index/trigger/policy definitions, function bodies, and rejects any runtime fiscal table/column privilege outside the contract. Runner test tampers an RLS policy and grants DELETE on immutable fiscal evidence to prove fail-closed detection. Fresh exact-head CI + Codex required.

- Gate B CI #115 diagnostic: semantic introspection reached PostgreSQL physical runner; first mismatch is canonical rendering of `electronic_documents_authority_identity_ck`. Error output is expanded with normalized actual/expected before changing normalization; no semantic check is removed.

- Gate B CI #116 confirmed PostgreSQL canonical CHECK rendering adds structural parentheses. To avoid weakening boolean precedence, semantic catalog fingerprint derivation now captures physical constraints/indexes/triggers/policies/functions and is surfaced through the existing real mismatch for pinning; no artificial failure is introduced.

- Gate B CI #117 derived PostgreSQL 16.14 physical semantic fingerprint `3d479eb5166e274b4d5d528af9ed901920282e0cb7c05db6922c5bcc6f82b86a`. It is now pinned in POSTGRES_003_DESCRIPTOR. Physical introspection enforces exact object identity plus this aggregate fingerprint over pg_constraint/index/trigger/policy/function semantics; human-readable exact definitions remain in the descriptor, avoiding unsafe source-vs-pretty normalization. Policy tampering remains an executable negative test. ACL validation stays separate and exhaustive.

- Gate B CI #118 typecheck finding was mechanical: the simplification edit accidentally nested validator code inside semanticCatalogFingerprint and removed the exported validator. Rebuilt postgres-003-introspection.ts from stable `89507451...`, then reapplied only the pinned fingerprint assertion and exhaustive fiscal ACL rejection. No contract/security relaxation.

- Gate B Codex exact-head review on `305a23d008967d64ff092aa3d762ed5c58026e60` found 2 valid P1 gaps: semantic fingerprint omitted `pg_trigger.tgenabled`, and fiscal ACL validation omitted `aclexplode.is_grantable`. Remediation adds trigger enablement to the physical fingerprint, rejects any grant option on runtime fiscal table/column privileges, and adds negative tests for disabled immutable guard and WITH GRANT OPTION. New physical fingerprint must be derived on PostgreSQL 16.14 and pinned before closure.

- Gate B CI #120 derived the new PostgreSQL 16.14 physical semantic fingerprint after adding trigger `tgenabled`: `9ed9957213c823c721a01dc3542fbf4b9d78cb5b809c11b3343ce5d02e57c4aa`. Descriptor pin updated; next exact-head CI must exercise trigger-disable and grant-option negative tests.

- Gate B Codex exact-head review on `68c30a7cfa4aa3149a1ba6426a277af9b7ad4aa3` found 3 valid P1 validator gaps: physical column metadata was not fingerprinted, required fiscal function EXECUTE ACLs were not fingerprinted/validated, and integration-extension grants omitted `is_grantable`. Remediation fingerprints complete fiscal + 003 integration column metadata and function `proacl`, rejects grant options on integration-extension ACLs, and adds negative tests for DROP NOT NULL, REVOKE EXECUTE, and WITH GRANT OPTION. A new PostgreSQL 16.14 physical fingerprint must be derived and pinned before closure.

- Gate B CI #122 derived PostgreSQL 16.14 physical semantic fingerprint after adding complete fiscal/integration column metadata and fiscal function `proacl`: `873b344acc299e2df800cd0c1c0a7bef47f48ffde4578cec4fc49008898b4f00`. Descriptor pin updated. Next exact-head CI must exercise DROP NOT NULL, REVOKE EXECUTE and integration WITH GRANT OPTION negative tests.

- Gate B CI #123 reached all new tamper tests but exposed a false-positive source: raw `pg_proc.proacl` array ordering changes after revoke/regrant even when effective EXECUTE semantics are restored. Function ACL fingerprinting is now canonicalized through `aclexplode`, ordered by function identity, grantee, privilege and `is_grantable`; raw proacl representation is removed from the hash. New physical fingerprint required.

- Gate B CI #124 derived the canonical PostgreSQL 16.14 fingerprint after normalizing fiscal function ACLs through ordered `aclexplode`: `51785625647046ba81b7189a9e3c48187d95441fa852b94b0887a785864a33d3`. Descriptor pin updated. Next exact-head CI is the closure run for column metadata, function EXECUTE ACL and integration grant-option coverage.

- Gate B CI #125 isolated function ACL hashing as representation-sensitive after exact revoke/regrant restoration. Function bodies/attributes remain in the semantic fingerprint; runtime EXECUTE ACLs are now validated separately against descriptor-owned exact grants (`safe_external_text`, `has_correlated_generation_evidence` -> pos_app,pos_worker), PUBLIC remains prohibited, and runtime EXECUTE grant options are rejected. Function ACLs are removed from the global hash; new stable fingerprint required.

- Gate B CI #127 derived the stable PostgreSQL 16.14 physical catalog fingerprint after removing runtime function ACLs from the global hash and validating them separately: `3628b68a2c9a74aa8397d08419e3c7ab8e2f38b8242ba45a0a692db7728114e6`. Descriptor pin updated. Next exact-head CI is the closure run for all validator findings.

- Gate B CI #128 proved the global physical fingerprint is still non-deterministic across fresh equivalent databases (`3628...` vs `3109...`). No new pin is accepted. Diagnostic instrumentation now reports per-component SHA-256 for columns, constraints, indexes, triggers, policies and functions so the unstable component can be isolated via repeated execution of the same exact HEAD.

- Gate B fingerprint stability was rechecked on exact HEAD `411c3690926990ddd078e6970fe16ad961694978` with two independent reruns of the same PostgreSQL job. Both produced identical aggregate SHA `3628b68a2c9a74aa8397d08419e3c7ab8e2f38b8242ba45a0a692db7728114e6` and identical per-table column hashes plus identical constraint/index/trigger/policy/function hashes. Descriptor pin restored to that exact-head repeated baseline; next CI is closure evidence, not diagnostic pinning.

- Gate B CI #132 isolated the remaining column-fingerprint divergence to predecessor-owned columns on `integrations.integration_dispatches` and `integrations.external_webhook_receipts`; all ten fiscal table column hashes were identical across both physical variants. SQL003 introspection now fingerprints all `fiscal.*` column metadata plus only the 003-owned extension columns on those two integrations tables. Predecessor-owned integration columns remain governed by exact 001/002 validation and are no longer mixed into the 003 semantic hash.

- Gate B CI #136 closure evidence: PostgreSQL 16.14 completed apply, exact semantic introspection, negative tamper checks, no-op, guarded down, exact-002 restoration and reapply on `158317182e6c604904bf84ec9e2a680313f1b177`. The semantic fingerprint normalizes physical ordinals only for 003-owned columns added to predecessor `integrations` tables, because down/reapply legitimately assigns new `attnum` values while all contract metadata remains exact. Gate B remains `NO_PASS` until fresh independent exact-head review and thread reconciliation.

- Gate B CI #141 remediation evidence: exact-head `f8fe93bf8d4a224ae52c265dcdf947177e0e64c0` closes the three P1 findings from review of `22123a9e...`: no-op validation now fingerprints complete `integrations` semantics, all non-owner fiscal ACL grantees must be contract-listed, and owned index fingerprints include `indisvalid/indisready/indislive`. Executable negative tests tamper an untouched 002 policy, grant DELETE to an unlisted role and invalidate an owned index; all fail closed, restoration succeeds, and apply/no-op/down/exact-002/reapply remain green. Gate B remains `NO_PASS` until independent review of the final documentation SHA.

- Gate B CI #144 additional ACL/RLS evidence: exact-head `62cdea1d6fe6e8e25b19b6e82b16d577c130ada6` closes the three P1 findings from review of `af24046c...`: all predecessor integration tables have exact owner/ENABLE RLS/FORCE RLS state, PUBLIC is rejected at both fiscal table and column ACL levels, and fiscal schema ACLs require the exact non-grantable USAGE matrix with no PUBLIC or unlisted grantees. Negative tamper tests disable integration RLS, grant a fiscal column to PUBLIC and revoke pos_app schema USAGE; all fail closed and exact restoration plus the full physical cycle remain green. Gate B remains `NO_PASS` until independent review of the final documentation SHA.

- Gate B runner/introspection slice closure: `PASS` for SQL003 code HEAD `9c486780594b5ad903ce9f6f749a2ee3fb788d1b`. Evidence: PostgreSQL 16.14 CI #145 / run `33123036689` SUCCESS, 45/45 then-current review threads resolved, and Codex exact-head result `Didn't find any major issues` on the same SHA. Gate B global remains `IN_PROGRESS / NO_PASS` because Modelo A functional and concurrency suites are still `NOT_MATERIALIZED`; PR #11 remains DRAFT and merge is not authorized.

- Gate B checkpoint reconciliation after documentation review: the operational runner/introspection slice is closed with physical evidence, but this does not promote the whole Gate B. Remaining blockers are the executable Modelo A functional suite and the required concurrency races (claim/retry/reprepare/webhook/reconciliation/publication). No merge or next-scope work is authorized.

- Gate B Modelo A materialization: commit `fa2097fc23445e4ba6edea678c0789656f041212` introduced the executable functional/concurrency suite without product SQL remediation first. CI #149 exposed physical defects instead of masking them.
- Gate B demonstrated remediations: reprepare historical-dispatch cancellation and webhook ingress ACL were corrected; SQL003 now replaces the inherited 002 webhook insert guard that reads nonexistent `NEW.status` with a `processing_status`-aware 003 guard while preserving exact 002 on down.
- Gate B CI #154 on `415315873b4978a584451124fa0b642bb13f5a37` reached 159/160 tests and 6/7 Modelo A; the sole late-webhook failure proved `pos_worker` RLS could not SELECT the current DRAFT preparation during historical-generation quarantine.
- Gate B RLS remediation: `pos_worker` now has tenant-scoped SELECT on preparations while UPDATE remains separately restricted to FROZEN or admissible historical-evidence rows. No SECURITY DEFINER and no write-surface widening.
- Gate B implementation validation: CI #156 / run `33130461450` on `89d8c5fa9697fd28ecd6685c0824caf73340f489` is SUCCESS. Typecheck, SQLite, PostgreSQL 001/002/003, physical runner apply/introspection/down/exact-002/reapply, 7/7 Modelo A, MAT-003 preflight and role-readiness all pass. Gate B remains a closure candidate until the final documentation/evidence HEAD receives fresh exact-head CI and independent review.


- INT-007 final exact-head closure: `39c56d030954f3bef20b84f773e4a4f76766a06b`, CI #158 / run `33141808515` SUCCESS, Modelo A concurrent race coverage PASS, Codex exact-head without major issues, 48/48 threads resolved.
- INT-007 integration closure: PR #11 MERGED/CLOSED as merge commit `8676caef419d70732f74489a413ae7fda2c49d0c`; post-merge CI #159 / run `33142409080` SUCCESS including main governance and exact-head Gate B artifact. INT-007 is DONE; no provider/runtime/production authorization is inferred.


- ARCH-003 final closure: PR #12 MERGED/CLOSED; exact implementation HEAD `003c44622d1eeb5f5846b211df45626ac256bf2f`, CI #169 SUCCESS with 13/13 boundary regressions and TARGET evidence; merge commit `bc55851c7045105473d546667dce72718638a8b9`; post-merge #170 SUCCESS.
- TECH-003 started from canonical `main@bc55851c7045105473d546667dce72718638a8b9` on `tech/tech003-executable-contracts-20260828`; first slice is limited to common executable contracts and does not authorize runtime.


- TECH-003 common-contract slice: `bb9ed6be77be136b4f68c661a9621d3ea5f34b0a`, CI #171 / run `33146168057` SUCCESS. Common Zod envelopes/errors/versioning/idempotency are executable; contracts 14/14 PASS and TARGET regressions remain green.
- TECH-003 handshake slice: materializes DEC-010 Desktop↔Local-Service compatibility snapshot, exact handshake outcomes and deterministic protocol-window negotiation; no named-pipe/Electron/service runtime is created.


- TECH-003 IPC + Sync implementation baseline: `169659d5a37d2d3d83e2190231defe752de29439`; subsequent hardening fixed checkpoint/result durability and canonical UUID/UTC handling.
- TECH-003 Sync review remediation: contiguous local sequences are mandatory; local operations preserve `installation_id`; response correspondence accepts duplicate-free partial subsets; checkpoints stop before conflict/review/dead-letter/retry/waiting outcomes even when their technical result is durable.
- Next authorized TECH-003 slice after exact-head validation of this remediation: central HTTP contracts only; no NestJS controllers or runtime.


- TECH-003 Sync closure candidate: `e42293d9afee0ccc1e5033dcd88d75d9f71959f1`, CI #177 / run `33162848651` SUCCESS; six review threads reconciled and resolved.
- TECH-003 Block 3 materialization: central-device HTTP transport contracts add verified-principal binding, request/response header-envelope correspondence, configurable measured byte limits, canonical HTTP error mapping, cursor pagination, idempotency header binding and coherent 429/Retry-After/rate-limit metadata. No NestJS/runtime/auth cryptography is implemented.


- TECH-003 Block 3 senior hardening after CI #178: raw HTTP headers are not modeled as a closed Zod object; only an extracted allowlisted `contract_headers` subset is schema-validated. This avoids rejecting legitimate transport/proxy/security headers while preserving strict application-header binding. Cursor page responses now enforce the endpoint max item count, and Retry-After derivation parses the canonical error fail-closed.

- TECH-003 Block 4 compatibility gate: IPC, Sync and HTTP now publish an explicit representation matrix and executable cross-boundary regressions for versioning, request/correlation identity, operation/idempotency identity, canonical UUID/UTC handling and UNKNOWN_OUTCOME. Sync deliberately retains its durable result vocabulary instead of importing HTTP error categories or inventing UNKNOWN_OUTCOME.
- TECH-003 closure order: final exact-head CI + evidence, senior review, zero open threads, then separate merge authorization. TECH-004 runtime work must start from the resulting canonical main in a new branch/PR; it is not mixed into PR #14.


- TECH-003 final closure: exact HEAD `d37512634c823f16f71928671c46aaccc7f04d3c`, CI #187 / run `33165786730` SUCCESS, 57/57 contracts with 5/5 cross-boundary compatibility, zero open review threads, PR #14 MERGED/CLOSED as `148a6546657afed528d3da37b263134a944c09be`.
- TECH-003 post-merge closure: CI #188 / run `33165957857` SUCCESS on exact `main@148a6546657afed528d3da37b263134a944c09be`, including main governance, repository policy/dependency inventory and full TARGET validation.
- TECH-004 started from canonical `main@148a6546657afed528d3da37b263134a944c09be` on `tech/tech004-quality-supply-chain-20260828`. Initial scope is static quality/supply-chain controls only; runtime/E2E/release-dependent gates remain deferred until executable apps exist.

- TECH-004 CodeQL slice: `5ff292fbf0497748efce5d48d763990b0e0e4763`, TARGET #199 and CodeQL #10 SUCCESS, SARIF retained, 0 open threads. Final run scanned 48/48 TypeScript, 6/6 JavaScript and 2/2 workflows and exposed one non-blocking `js/file-system-race` in repository-policy tooling; Block 1 remediates it instead of suppressing it.

- TECH-004 CodeQL upload limitation remains explicit: GitHub Code Scanning is unavailable for this private repository configuration, so the workflow uses `upload: never`, local fail-closed SARIF evaluation and exact-head artifact retention. This limitation does not disable CodeQL analysis.


- TECH-004 Block 1 hardening candidate: repository-policy tracked files are opened with O_NOFOLLOW and consumed through the same descriptor to eliminate the CodeQL TOCTOU finding; dependency inventory now auto-discovers root/apps/packages/tools manifests using the same helper as repository policy and records direct dependency scopes by workspace/manifest/section. New Node regression tests cover discovery, direct classification and invalid-manifest fail-closed behavior. Fresh TARGET + CodeQL exact-head evidence required before Block 2.


- TECH-004 Block 1 closure: `59d5b57110138236e056ca93c969b0a208f2c293`; TARGET #200 / run `33169811042` SUCCESS and CodeQL #11 / run `33169811007` SUCCESS. CodeQL scanned 48/48 TypeScript, 9/9 JavaScript and 2/2 workflows with 0 SARIF results; TOCTOU remediation is demonstrated, dependency inventory discovery/tests are green, and 0 review threads were open at checkpoint.
- TECH-004 Block 2 closure checkpoint: 691b5051599c735f393c13d3dad8d67bcde8af01; TARGET #201 / run 33170295302 SUCCESS and CodeQL #12 / run 33170295301 SUCCESS. Dependency inventory observed 194 packages, 11 direct and 10 workspace manifests with 0 license review findings. Vulnerability audit returned 0 advisories, 0 triage findings and 0 accepted exceptions; raw/evaluation artifact dependency-vulnerability-audit-691b5051599c735f393c13d3dad8d67bcde8af01 was emitted. CodeQL scanned 48/48 TypeScript, 12/12 JavaScript and 2/2 workflows with 0 SARIF results.

- TECH-004 Blocks 1-2 documentation closure: this commit only reconciles evidence/status after both executable gates passed. Because HEAD changes, TARGET, CodeQL and dependency vulnerability audit must execute again on the documentation HEAD before Blocks 1-2 are treated as final stable baseline. Next technical block remains SBOM; no runtime scope is authorized.

- TECH-004 Block 2 registry-source hardening: senior review found that inheriting registry configuration could redirect advisory lookup and weaken the meaning of a green audit. The gate now pins `https://registry.npmjs.org/` explicitly and has an executable regression proving `--ignore-registry-errors` is absent. Fresh TARGET + CodeQL + audit evidence is required on the new HEAD.
