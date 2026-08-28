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

El workflow separado `.github/workflows/codeql-sast.yml` analiza JavaScript/TypeScript en pull requests hacia `main`, pushes a `main`, ejecución manual y programación semanal. Usa `build-mode: none`, la suite `security-extended`, permisos mínimos por job y `github/codeql-action` fijada por SHA.

Su política de aceptación, excepciones y limitaciones está definida en `docs/security/codeql-sast-gate.md`. Un workflow verde no equivale a ausencia de vulnerabilidades ni cubre dependencias, DAST, runtime inexistente, SBOM, provenance o release.


### Repository policy and dependency inventory

Valida, entre otros:

- manifests propios `private`;
- `pnpm@9.15.0` fijado;
- dependencias directas con versiones exactas;
- lifecycle hooks prohibidos en manifests propios del baseline;
- workspace actualmente limitado a `tools/*`;
- lockfile esperado;
- ausencia de symlinks trackeados;
- ausencia de archivos sensibles trackeados;
- regresión de historia de `main`: acepta rango compuesto solo por merges válidos y rechaza un direct commit oculto antes de un merge;
- scanner de patrones de secretos de alta confianza sin imprimir el valor;
- instalación mediante `pnpm install --frozen-lockfile`;
- inventario de dependencias/licencias después de instalar;
- fallo cerrado ante package manifests instalados ilegibles o inválidos;
- evidencia obligatoria mediante artifact; `if-no-files-found: error`.

Este inventario no se presenta como SBOM CycloneDX/SPDX firmado ni como conclusión legal completa de compatibilidad de licencias.

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

`TECH-004 = IN_PROGRESS`

No se promueve por esta evidencia:

- branch protection preventiva nativa;
- `TECH-004 = DONE`;
- Nx de aplicaciones;
- lint del runtime;
- CodeQL/SAST sobre lenguajes o runtimes todavía no materializados;
- vulnerability scanning con política de severidad cerrada;
- SBOM firmado;
- provenance/attestations de build;
- firma de releases;
- runtime tests;
- release controls;
- `SEC-G07`, `SEC-G09` o `SEC-G10 = PASS`;
- NestJS/Fastify;
- Electron/React/Vite;
- POS Local Service;
- SQL/descriptor 003;
- SIIGO/FACTUS/ALEGRA evaluados;
- POS Platform `PRODUCTION_READY`.

## Regla commit-scoped

Un resultado `PASS` solo aplica al SHA validado. Cualquier commit nuevo en una rama de PR necesita su ejecución aplicable exitosa antes de integrarse.

Después de cada merge a `main`, el push workflow debe completar satisfactoriamente. Un fallo de `Main push governance` se considera violación de integración y debe investigarse antes de cualquier cambio posterior de producto.

## Relación con supply chain

`docs/testing/supply-chain-baseline-ci-gate.md` documenta el detalle del baseline de repository policy, secretos e inventario/licencias materializado por PR #5.

Este documento describe el gate TARGET completo actualmente visible y su relación con `main`; ambos deben mantenerse alineados en el mismo cambio cuando se modifique el workflow.
