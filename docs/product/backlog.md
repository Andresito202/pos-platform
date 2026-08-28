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
- PR #15: `MERGED / CLOSED`; TECH-004 CI, calidad y supply chain integrado.
- HEAD exacto de cierre TECH-004: `cc8aba3f8f873eab9ba7a5d93803870487eed810`; TARGET #225 / run `33176899684` y CodeQL #36 / run `33176899692` `SUCCESS`.
- Merge commit TECH-004: `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`, firma GitHub válida.
- Post-merge TARGET #226 / run `33177520034`: `SUCCESS`; CodeQL #37 / run `33177520014`: `SUCCESS`; Main push governance: `SUCCESS`.
- Post-merge supply chain: 194 packages / 11 direct / 10 workspaces, 0 advisories, SBOM 259 components / 259 relationships, SPDX 249 ALLOW / 0 REVIEW_REQUIRED / 0 DENY, SARIF 0 results.
- Post-merge provenance manifest SHA-256: `311fb9827017ebfad109cfe2f809787233fc75a9364c6ea5d6e98bfdcd5b647b`; GitHub native Artifact Attestation permanece `BLOCKED_BY_PLATFORM`, no PASS.

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
| `tech/tech004-quality-supply-chain-20260828` | `INTEGRATED / HISTORICAL` | PR #15 integrada; TECH-004 cerrado. No reutilizar para runtime. |
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

## Último bloque cerrado

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `DONE / INTEGRATED`

Rama histórica integrada: `tech/tech004-quality-supply-chain-20260828`.

PR #15 fue integrada desde exact HEAD `cc8aba3f8f873eab9ba7a5d93803870487eed810` como merge commit `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`. TARGET #225 y CodeQL #36 cerraron el gate pre-merge; post-merge TARGET #226 / run `33177520034` y CodeQL #37 / run `33177520014` finalizaron `SUCCESS`, incluido Main push governance y provenance exact-head.

El alcance cerrado incluye repository policy, CodeQL/SAST, vulnerability gate, CycloneDX 1.6, compatibilidad SPDX y provenance hash-bound. GitHub native Artifact Attestations permanece `BLOCKED_BY_PLATFORM`; no se representa como firma ni PASS.

Los controles que requieren aplicaciones/runtime — lint/E2E de apps, packaging, firma de releases y promoción — permanecen diferidos a la línea runtime separada.

## Bloque cerrado anterior

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

Estado: `DONE / INTEGRATED`

Rama histórica integrada: `tech/tech004-quality-supply-chain-20260828`.

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

Materializado en el alcance estático de TECH-004:

- CodeQL/SAST + hardening TOCTOU, con SARIF exact-head y política fail-closed;
- vulnerability scanning con piso high/critical, triage y excepciones temporales explícitas;
- SBOM CycloneDX 1.6 con grafo workspace + dependencias opcionales reportadas por pnpm;
- gate SPDX de compatibilidad de licencias sobre todo el universo third-party del SBOM;
- provenance hash-bound que enlaza TARGET, inventory, vulnerabilidades, SBOM, licencias y CodeQL;
- GitHub native Artifact Attestations registradas como `BLOCKED_BY_PLATFORM`, no como PASS.

Diferido hasta que existan artefactos runtime/release reales:

- lint del runtime/aplicaciones;
- firma de releases;
- runtime/E2E tests;
- packaging y controles de release/promoción.

TECH-004 quedó `DONE / INTEGRATED` mediante PR #15. El cierre exact-head fue `cc8aba3f8f873eab9ba7a5d93803870487eed810`; el merge canónico es `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`. TARGET #226 y CodeQL #37 post-merge quedaron `SUCCESS`, con provenance exact-head verde. Los gates de runtime/E2E/release se incorporarán en la línea runtime posterior cuando existan artefactos ejecutables reales.

## Runtime TARGET — roadmap normativo RT-000..RT-010

Esta tabla gobierna la materialización del runtime. **Estado normativo y presencia de código son dimensiones distintas**: un bloque puede tener código parcial y continuar `BLOCKED` o `IN_PROGRESS` hasta demostrar todos sus invariantes.

| ID | Pri | Estado | Materialización actual | Dependencias / criterio mínimo de cierre |
|---|---|---|---|---|
| RT-000 | P0 | DONE | `INTEGRATED` por PR #17 | Baseline runtime reconciliado sobre `main`; TARGET, CodeQL y main-push governance post-merge verdes. |
| RT-001 | P0 | IN_PROGRESS | POS Local Service + config/lifecycle/health/observability en PR #18; hardening activo | Base `RT-000`. Cierre exige config fail-closed, lifecycle/rollback/shutdown idempotente y acotado, manejo fatal, pruebas de proceso real y observabilidad con redacción, backpressure, buffering acotado y fallo de sink. |
| RT-002 | P0 | BLOCKED | SQLite/WAL/single-writer/migration ledger parcialmente materializados en PR #18 | No cierra antes de RT-001. Debe probar dos procesos escritores reales, crash del owner, stale-lock recovery, pre-migration backup + checkpoint, restore validado, falta de espacio/fallo de backup fail-closed, busy timeout efectivo, ledger inmutable e integrity/restart recovery. |
| RT-003 | P0 | BLOCKED | Framing/channel parcial en PR #18; gate semántico aún no satisfecho | No cierra antes de RT-001/002. Debe reutilizar TECH-003 como vocabulario canónico, realizar handshake + negociación min/max fail-closed, integrar client/server al proceso, deadlines/cancelación/backpressure/colas acotadas, demostrar restricción Windows/ACL y política de replay. RT-003 es `OS_RESTRICTED / PROTOCOL_VALIDATED`; autenticación criptográfica pertenece a RT-004. |
| RT-004 | P0 | BLOCKED | Device identity/licensing/clock parcial en PR #18 | No cierra antes de RT-001..003. Debe definir custodia OS-bound de la root key, `device_key_id` y lifecycle/rotate/revoke/replace, proof-of-possession, activación/audit trail, decisión efectiva de licencia, suspensión/revocación/límites/offline policy, signing-key rotation/revocation, autorización por capability y clock trusted obligatorio dentro de la frontera de verificación. |
| RT-005 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-001..004 cerrados. Outbox/inbox durable, idempotencia, checkpoints, retries y dead-letter/recovery. |
| RT-006 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-005. Primer vertical slice: request → auth → validation → SQLite transaction → outbox → response → restart → retry → audit. |
| RT-007 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-006. Electron main + secure preload + context isolation + sandbox + IPC allowlist; sin acceso directo renderer→SQLite/hardware/secrets. |
| RT-008 | P1 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-007. Renderer React mínimo y UX operativa sobre contratos permitidos. |
| RT-009 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-007/008. Windows Service/installer/signing/upgrade/downgrade/rollback/uninstall/recovery. |
| RT-010 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-001..009. Gate integral de crash/recovery, security, local-first, Windows, packaging y release. |

### Mapping de gates runtime

- `TECH-005` se materializa progresivamente mediante RT-001/002/005/009/010 para observabilidad, backup/restore, update y rollback; no puede marcarse DONE por pruebas unitarias aisladas.
- `TECH-006` se materializa mediante RT-002/005/006/010 para fixtures, multiproceso, concurrencia y recovery.
- `SEC-G04` y `SEC-G07` reciben evidencia candidata desde RT-004; permanecen `PLANNED / NOT_EVALUATED` hasta su gate independiente.
- `SEC-G05` recibe evidencia candidata desde RT-002/003/005; permanece `PLANNED / NOT_EVALUATED`.
- `SEC-G06` recibe evidencia candidata desde RT-004/006; permanece `PLANNED / NOT_EVALUATED`.
- `SEC-G09` y `SEC-G10` dependen además de RT-009/010 y de release/operación reales.
- Ningún RT promueve automáticamente `SEC-G01..SEC-G10`; cada promoción requiere evidencia y evaluación explícitas.

### Exclusiones de PR #18

PR #18 no autoriza RT-005+, Electron, renderer, negocio comercial, providers SIIGO/FACTUS/ALEGRA, producción, packaging final ni promoción automática de security gates. Mientras RT-001..004 no estén cerrados, la PR permanece `DRAFT / NOT_MERGE_AUTHORIZED`.

## Orden inmediato obligatorio

1. Mantener **INT-007**, **ARCH-003**, **TECH-003**, **TECH-004** y **RT-000** `DONE / INTEGRATED`; no reabrirlos salvo defecto reproducible o decisión versionada nueva.
2. La única línea principal activa es **RT-001 en PR #18** (`runtime/local-foundation-rt001-004-20260828`) sobre base canónica `main@35b9555af4c1bb3db951702dc41d66d24a9d8079`.
3. RT-002, RT-003 y RT-004 pueden conservar código parcial dentro de la misma PR, pero permanecen bloqueados para cierre hasta satisfacer dependencias y gates de la tabla RT.
4. **No iniciar RT-005** ni abrir otra rama mientras PR #18 no tenga TARGET + CodeQL exact-head verdes, backlog/PR reconciliados, revisión arquitectónica final y cero findings abiertos.
5. La evidencia CI debe describir exactamente lo probado; una suite `PASS` no equivale a cierre de RT ni a promoción de `SEC-G01..SEC-G10`.
6. Providers, producción, Electron/renderer posterior, packaging/release y limpieza de ramas históricas siguen en líneas separadas.

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
| TECH-004 | P0 | DONE | PR #15 integrada; SAST, vulnerabilidades, SBOM, licencias SPDX y provenance cerrados con evidencia exact-head y post-merge. |
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
