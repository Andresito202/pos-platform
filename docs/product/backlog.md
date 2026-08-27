# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente normativa del **estado vigente del trabajo** de POS Platform: prioridad, dependencia, bloqueo, trabajo activo y orden inmediato.

No funciona como diario histórico exhaustivo. La cronología detallada permanece trazable en Git, commits, PRs y workflows. Un snapshot histórico no puede contradecir la cola actual.

Última reconciliación normativa: 2026-08-26.

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
- HEAD canónico verificado después de PR #10: `b28ca8850acc6b97385c80627a9d64b7ea607a42`.
- Run post-merge #67 `33015503869`: `COMPLETED / SUCCESS`, incluidos `Main push governance`, repository/secret policy, dependency inventory, TypeScript, SQLite, PostgreSQL 16.14 migrations 001/002, MAT-003 preflight y role-readiness.

La evidencia de SHA anterior es commit-scoped; el HEAD vigente de `main` siempre se consulta en GitHub antes de cualquier integración.

### No materializado / no aprobado como producto

- NestJS/Fastify runtime: `ABSENT / NOT_MATERIALIZED`.
- Electron/React/Vite: `ABSENT / NOT_MATERIALIZED`.
- POS Local Service: `ABSENT / NOT_MATERIALIZED`.
- Nx de aplicaciones/packages: `ABSENT`.
- SQL 003 DDL: `ABSENT / GATE_B_PENDING` en el inicio de INT-007.
- descriptor 003: `MATERIALIZED_IN_BRANCH / GATE_A_REMEDIATION_REVIEW` en INT-007; no está integrado ni aplicado. CI #85 fue SUCCESS sobre el HEAD anterior, pero quedó superseded por cuatro P1 Codex exact-head y esta remediación requiere evidencia nueva.
- schema fiscal 003: `ABSENT / NOT_APPLIED`.
- migration 003: `IN_PROGRESS / NOT_APPLIED`.
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
| `feat/sql003-v2-materialization-20260826` | `IN_PROGRESS / NOT_INTEGRATED` | INT-007; rama nueva desde `main@b28ca8850acc6b97385c80627a9d64b7ea607a42`. No reutiliza el WIP histórico como implementación. |
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

### INT-007 — materialización SQL/descriptor 003 sobre bundle V2

Prioridad: `P0`

Estado: `IN_PROGRESS`

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
- Gate A historical quarantine hardening: accepted late historical evidence and historical webhook correlation quarantine the current pre-terminal generation to `UNKNOWN_OUTCOME` in the same transaction; current QUEUED dispatch remains durable but unclaimable.
- Gate A webhook timing hardening: fiscal correlation guard is AFTER-write validation/quarantine and `SECURITY DEFINER` for the narrowly validated cross-schema quarantine update; canonical lock acquisition remains a caller precondition.
- Gate A closure status for this commit: `REMEDIATION_CANDIDATE / NOT_CLOSED`; the four P1 findings from Codex review of `14d6cd9a43` remain open until fresh exact-head CI + Codex review pass. No Gate B files are started in this closure commit.
- Gate A webhook lock-order clarification: receipt trigger is revalidation only; correlator command must lock document→preparation→dispatch before mutating/inserting the receipt linkage.
- Gate A connection hardening: FiscalConnection closure is CAS-versioned and irreversible; a closed connection cannot be reopened, extended or rewritten.

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

Estado: `READY`

Baseline ya materializado:

- gate TARGET en PR y push a `main`;
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

- Nx cuando se materialicen apps/packages;
- lint del runtime/aplicaciones;
- CodeQL/SAST completo;
- vulnerability scanning con severidad/policy cerrada;
- SBOM estándar y firmado;
- compatibilidad legal de licencias completa;
- provenance/attestations;
- firma de releases;
- runtime/E2E tests;
- controles de release/promoción.

TECH-004 no está `DONE`; INT-006 ya cerró y TECH-004 permanece `READY` para retomarse cuando existan artefactos runtime que permitan ejecutar sus controles pendientes.

## Orden inmediato obligatorio

1. Completar **INT-007 Gate A**: descriptor 003 exacto para diez tablas, dependencias 001/002, extensiones 003, SQLite `NONE` y contrato V1 `SUBMIT_DOCUMENT`.
2. Completar **INT-007 Gate B**: SQL up/down, runner, introspection/smoke, RLS/grants/guards, apply/down y pruebas funcionales/concurrencia sin modificar bytes de 001/002.
3. Ejecutar CI exact-head y revisión independiente; cualquier nuevo HEAD invalida la evidencia previa.
4. Integrar INT-007 solo mediante autorización de merge separada y `expected_head_sha` fresco.
5. Retirar WIP SQL003 histórico solo cuando toda evidencia útil haya sido absorbida y sea demostrable que no se pierde trazabilidad.
6. **ARCH-003**: materializar reglas ejecutables de límites modulares/Nx sobre el mapa reconciliado.
7. **TECH-003**: materializar contratos Zod/API/IPC, errores, versionado, idempotencia y correlación.
8. Retomar TECH-004 a medida que existan runtime/apps y controles ejecutables pendientes.
9. Solo después iniciar el primer esqueleto de runtime conforme a ADR-005/DEC-010, sin saltar security/data gates.

No se inicia NestJS/Electron “por avanzar” mientras los gates anteriores sigan abiertos.

## Gate SQL003

### INT-007 / materialización 003

Estado de materialización: `IN_PROGRESS`.

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
| ARCH-003 | P0 | READY | Convertir límites en reglas ejecutables de módulos/Nx. TECH-002 está DONE y module-map queda reconciliado en este corte. |
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
| INT-007 | P0 | IN_PROGRESS | Materializar descriptor/SQL PostgreSQL 003 contra el bundle V2 integrado; Gate A descriptor, Gate B DDL/runner/tests. |

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
| TECH-003 | P0 | READY | Contratos Zod/API/IPC/error/idempotencia/versionado/correlación. |
| TECH-004 | P0 | READY | CI/calidad/supply chain: baseline materializado; controles de runtime/release pendientes. |
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
| F1.1 Esqueleto modular y contratos | PLANNED | ARCH-003 + TECH-003 + esqueleto aprobado. |
| F1.2 Modelo físico/migrations | IN_PROGRESS | TECH-002 e INT-006 DONE; 001/002 materializadas; SQL003 aún no materializada y sigue bajo gate separado. |
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