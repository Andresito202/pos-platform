# Gate CI de la fundación TARGET

## Propósito

Este documento es la fuente normativa para el alcance real del workflow `.github/workflows/target-foundation-validation.yml`.

El workflow valida únicamente la fundación ejecutable actualmente materializada. No declara que el pipeline integral, el runtime o el producto estén completos.

## Eventos

El workflow se ejecuta en:

- `pull_request` hacia `main`;
- `push` a `main`;
- `workflow_dispatch`.

La rama histórica `architecture/physical-model` ya no es trigger de `push`.

## Workflows y jobs vigentes

### CodeQL SAST

El workflow separado `.github/workflows/codeql-sast.yml` analiza JavaScript/TypeScript en pull requests hacia `main`, pushes a `main`, ejecución manual y programación semanal. Usa `build-mode: none`, la suite `security-extended`, permisos mínimos por job y `github/codeql-action` fijada por SHA. Como GitHub Code Scanning no está habilitado en este repositorio privado, no intenta publicar a su API: conserva SARIF commit-scoped, ejecuta un evaluador local probado y falla ante nivel `error` o `security-severity >= 7.0`.

Su política de aceptación, excepciones y limitaciones está definida en `docs/security/codeql-sast-gate.md`. Un workflow verde no equivale a ausencia de vulnerabilidades ni cubre dependencias, DAST, runtime inexistente, SBOM, provenance o release.


### Repository policy, dependency inventory and vulnerability audit

Valida, entre otros:

- manifests propios `private`;
- `pnpm@9.15.0` fijado;
- dependencias directas con versiones exactas;
- lifecycle hooks prohibidos en manifests propios del baseline;
- discovery compartido de manifests en root, `apps/*`, `packages/*` y `tools/*`;
- lockfile esperado;
- ausencia de symlinks trackeados;
- ausencia de archivos sensibles trackeados;
- regresión de historia de `main`: acepta rango compuesto solo por merges válidos y rechaza un direct commit oculto antes de un merge;
- scanner de patrones de secretos de alta confianza sin imprimir el valor;
- instalación mediante `pnpm install --frozen-lockfile`;
- inventario de dependencias/licencias después de instalar;
- fallo cerrado ante package manifests instalados ilegibles o inválidos;
- evidencia obligatoria mediante artifact; `if-no-files-found: error`.

El inventario plano no se presenta como conclusión legal completa de compatibilidad de licencias. El mismo job genera además un SBOM CycloneDX JSON 1.6 desde el grafo recursivo reportado por pnpm, valida cobertura/relaciones/SHA y publica su digest SHA-256. El SBOM puede contener nodos opcionales de otras plataformas además del inventory Linux instalado; ese inventory debe permanecer como subconjunto. El SBOM no es todavía una attestación firmada.

El mismo job ejecuta además el gate de vulnerabilidades de dependencias: captura `pnpm audit --json --audit-level=low`, bloquea high/critical sin excepción válida y falla cerrado ante error de fuente o evidencia incoherente. Moderate/low permanecen visibles para triage.

Después del SBOM ejecuta el gate SPDX de licencias. Cada componente third-party termina en `ALLOW`, `REVIEW_REQUIRED` o `DENY`; PASS exige cero review-required y cero deny. Componentes SBOM-only resuelven metadata exact-version desde el origin npm fijado y con egress restringido.

### TypeScript, SQLite and PostgreSQL 16.14

Valida:

- instalación locked;
- TypeScript typecheck del tooling TARGET existente;
- migration SQLite materializada y regresión de concurrencia;
- PostgreSQL migrations 001/002 y regresiones de rollback/concurrencia aplicables;
- MAT-003 preflight tooling;
- MAT-003 canonical-role-readiness tooling;
- PostgreSQL 16.14 efímero.

No valida un runtime NestJS/Electron inexistente.

### Main push governance

Se ejecuta únicamente cuando el evento es `push` a `main`.

Es un control detectivo. Usa `github.event.before` y `github.sha` para recorrer todo el rango introducido sobre la cadena de primer padre. Exige continuidad fast-forward y que cada commit introducido:

- tenga dos padres;
- sea un merge commit creado por GitHub;
- corresponda exactamente al `merge_commit_sha` de una PR fusionada hacia `main`.

Esto impide que un direct push quede oculto dentro del mismo evento cuyo HEAD final sea un merge válido. Por política del proyecto, direct push, squash merge y rebase merge no son rutas válidas de integración. Este job los marca como violación después del push; no reemplaza branch protection preventiva.

La política completa está en `docs/governance/repository-governance.md`.

## Trazabilidad del source

En eventos `pull_request`, `GITHUB_SHA` puede representar un merge ref sintético. Para que la evidencia identifique el código realmente revisado, el workflow usa:

`REVIEWED_SHA = pull_request.head.sha || github.sha`

Los jobs de validación hacen checkout explícito de ese SHA y usan `persist-credentials: false`.

Las GitHub Actions usadas por el workflow permanecen fijadas por commit SHA. La versión de pnpm del proyecto permanece fijada de forma independiente en `9.15.0`.

## Evidencia vigente

### Pre-merge PR #5

- HEAD: `19adc690a9277a18a8de214060cd890553f0842c`;
- run: `32932269946` (#39);
- resultado: `COMPLETED / SUCCESS`;
- repository policy/dependency inventory: `SUCCESS`;
- TypeScript/SQLite/PostgreSQL: `SUCCESS`;
- `Main push governance`: `SKIPPED`, correcto porque era evento de PR.

### Post-merge `main`

PR #5 se fusionó mediante merge normal en:

`bfca119b27f9b4bf0a7b0541708161a2beb2833d`

El push real a `main` produjo:

- run: `32933559784` (#40);
- event: `push`;
- head branch: `main`;
- head SHA: `bfca119b27f9b4bf0a7b0541708161a2beb2833d`;
- workflow: `COMPLETED / SUCCESS`;
- `Repository policy and dependency inventory = SUCCESS`;
- `TypeScript, SQLite and PostgreSQL 16.14 = SUCCESS`;
- `Main push governance = SUCCESS`.

Esta fue la primera evidencia post-merge de que el control detectivo reconoce correctamente una integración válida mediante PR y merge commit normal.

Evidencia canónica más reciente antes de este hardening:

- `main`: `940107f8cc0976c130dd4f274928b2df248473f4` (merge PR #7);
- run: `32937793013` (#47);
- workflow: `COMPLETED / SUCCESS`;
- repository policy/dependency inventory: `SUCCESS`;
- TypeScript/SQLite/PostgreSQL: `SUCCESS`;
- `Main push governance`: `SUCCESS`.

Este hardening solo se considera vigente para un SHA cuando su CI commit-scoped y la verificación post-merge aplicable constan `SUCCESS` en GitHub; la evidencia se consulta por SHA y no se infiere desde este documento.

## Interpretación

El estado correcto es:

`TARGET_FOUNDATION_CI = MATERIALIZED / EXECUTED / PASS`

`MAIN_PUSH_DETECTIVE_GOVERNANCE = MATERIALIZED / EXECUTED / PASS`

`TECH-004 = DONE / INTEGRATED`

No se promueve por esta evidencia:

- branch protection preventiva nativa;
- Nx de aplicaciones runtime;
- lint/E2E del runtime;
- GitHub native Artifact Attestations;
- firma/attestation de binarios o releases;
- packaging y release controls;
- `SEC-G07`, `SEC-G09` o `SEC-G10 = PASS`;
- NestJS/Fastify;
- Electron/React/Vite;
- POS Local Service;
- despliegue productivo de SQL/descriptor PostgreSQL 003 ni SQLite 003;
- SIIGO/FACTUS/ALEGRA evaluados;
- POS Platform `PRODUCTION_READY`.

## Regla commit-scoped

Un resultado `PASS` solo aplica al SHA validado. Cualquier commit nuevo en una rama de PR necesita su ejecución aplicable exitosa antes de integrarse.

Después de cada merge a `main`, el push workflow debe completar satisfactoriamente. Un fallo de `Main push governance` se considera violación de integración y debe investigarse antes de cualquier cambio posterior de producto.

## Relación con supply chain

`docs/testing/supply-chain-baseline-ci-gate.md` documenta el detalle del baseline de repository policy, secretos e inventario/licencias materializado por PR #5.

Este documento describe el gate TARGET completo actualmente visible y su relación con `main`; ambos deben mantenerse alineados en el mismo cambio cuando se modifique el workflow.

## TECH-004 — checkpoint Bloques 1 y 2

Bloque 1 cerró su checkpoint ejecutable en `59d5b57110138236e056ca93c969b0a208f2c293`: TARGET #200 y CodeQL #11 `SUCCESS`; el SARIF quedó en 0 resultados y el inventory compartido descubrió los manifests de root/apps/packages/tools.

Bloque 2 cerró su primer checkpoint ejecutable en `691b5051599c735f393c13d3dad8d67bcde8af01`: TARGET #201 y CodeQL #12 `SUCCESS`; el audit de dependencias produjo 0 advisories, 0 triage y 0 excepciones aceptadas. El artifact raw/evaluado es commit-scoped y no se reutiliza para otro HEAD.

Cualquier reconciliación documental posterior invalida estos SHA como evidencia final y requiere nuevas ejecuciones aplicables.


## TECH-004 — Bloque 3 SBOM

El Bloque 3 añade un SBOM CycloneDX JSON 1.6 determinista a `supply-chain-baseline`. El generador cruza `pnpm list --recursive --depth Infinity` con el discovery compartido de workspaces, conserva relaciones directas/transitivas, usa PURL npm, liga el documento al SHA revisado y al digest del lockfile, y emite un digest SHA-256 separado.

La política, límites y semántica normativa están en `docs/security/cyclonedx-sbom-gate.md`.

Cierre ejecutable de Bloque 3: `83ac7d75a77ee371a943fc6cc087e4934eeb1d47`, TARGET #213 y CodeQL #24 `SUCCESS`, artifact `cyclonedx-sbom-83ac7d75a77ee371a943fc6cc087e4934eeb1d47` presente.

## TECH-004 — Bloque 4 licencias SPDX

Checkpoint técnico `4c5d067c89bd9bd8a42b1f08bbdce61638a88fe9`: TARGET #217 / run `33174019861` y CodeQL #28 / run `33174019863` `SUCCESS`. El gate evaluó 249 componentes third-party: 194 desde inventory instalado y 55 desde metadata de versión exacta en npm; resultado 249 ALLOW / 0 REVIEW_REQUIRED / 0 DENY.

El lookup remoto se limita a nombres npm canónicos y SemVer exacto sobre `registry.npmjs.org`, sin redirects y con límite de respuesta de 1 MiB. CodeQL #28 terminó con 0 resultados después de ese hardening. Cualquier commit documental posterior exige evidencia fresca sobre el nuevo HEAD.

## TECH-004 — Bloque 5 provenance / attestations

Checkpoint técnico `39daf1a61798c82b6b8b4c360b173855bd415328`: TARGET #223 / run `33175944576`, CodeQL #34 / run `33175944559` y job `Provenance evidence` `SUCCESS`.

El manifest une seis artifacts exact-head (TARGET, inventory, vulnerability, SBOM, licenses y CodeQL SARIF), conserva sus artifact IDs/digests y workflow run IDs, verifica hashes internos y liga lockfile + tool/action versions. Manifest SHA-256: `845eeccb488172478fa866eddb39a168f93b11334ca66a098e35cb30feb2dd7b`.

GitHub native Artifact Attestation permanece `BLOCKED_BY_PLATFORM` porque el repositorio es privado y el prerrequisito de GitHub Enterprise Cloud no está establecido. No se añade `id-token: write` ni se presenta una firma inexistente.

Cierre final del Bloque 5: `4cc59bb464fb19a3e9f63eddacf1d95bf8da2796`, TARGET #224 / run `33176399945`, CodeQL #35 / run `33176399999` y `Provenance evidence` `SUCCESS`; manifest SHA-256 `9a2889ef2505025ae55d61e3d745160e8655e223a48a554c1ad8c167e2af3810`.

## TECH-004 — Bloques 6 y 7: cierre e integración

Bloque 6 cerró sobre exact HEAD `cc8aba3f8f873eab9ba7a5d93803870487eed810`:

- TARGET #225 / run `33176899684`: `SUCCESS`;
- CodeQL #36 / run `33176899692`: `SUCCESS`;
- vulnerability gate: 0 advisories / 0 triage / 0 exceptions;
- SBOM: 259 components / 10 workspaces / 259 relationships;
- SPDX: 249 ALLOW / 0 REVIEW_REQUIRED / 0 DENY;
- CodeQL: 48/48 TypeScript / 21/21 JavaScript / 2/2 workflows / 0 SARIF results;
- review threads: 0.

Bloque 7 integró PR #15 mediante merge normal en `main@cf8632c032d0cdd0e7e5c8cb21b532b35294218f`. La evidencia post-merge es:

- TARGET #226 / run `33177520034`: `COMPLETED / SUCCESS`;
- CodeQL #37 / run `33177520014`: `COMPLETED / SUCCESS`;
- Main push governance: `SUCCESS`;
- contratos 57/57, SQLite 13/13, PostgreSQL 001/002/003 160/160, MAT-003 preflight 18/18 y role-readiness 21/21;
- vulnerability gate: 0 advisories;
- SBOM SHA-256 interno: `abe30f51fd8ec61729d1f49083ee54d60ee71f4acf5028d1e7e62740c1e81f41`;
- license report SHA-256: `ae0811d3639d70c6a4867dfbb6c65691ed03912828893bca1d753ced6dec6d27`;
- CodeQL artifact digest: `sha256:44928ba30ad2e5d3da87655cce0c8d7fa51469e8a8745ecac7f1576780ddf499`;
- provenance manifest SHA-256: `311fb9827017ebfad109cfe2f809787233fc75a9364c6ea5d6e98bfdcd5b647b`;
- provenance artifact digest: `sha256:3c1d85153612c3f795c52627beb3764d04b74d15e4ff23d9a6c4c808c59bc165`.

GitHub native Artifact Attestation permanece `BLOCKED_BY_PLATFORM / PRIVATE_REPOSITORY_ENTERPRISE_CLOUD_PREREQUISITE_NOT_ESTABLISHED`; no se presenta como PASS ni firma. Runtime, packaging, firma de release, promoción y producción siguen fuera del cierre TECH-004.

`TECH-004 = DONE / INTEGRATED`.
