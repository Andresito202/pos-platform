# TARGET supply-chain baseline CI gate

## Estado y alcance

Este documento define el corte incremental de `TECH-004` que añade controles reproducibles de repositorio, secretos, visibilidad de dependencias/licencias y gobernanza compensatoria de `main` al workflow TARGET existente.

La existencia de este documento o de los scripts no declara por sí sola `CI = PASS`. El resultado aplicable siempre es el workflow commit-scoped del HEAD revisado.

Este corte **no** declara `TECH-004 = DONE` y **no** equivale a un security release gate, un SBOM estándar ni una revisión legal de licencias.

## Controles materializados

### 1. Repository policy

`tools/ci/validate-repository-policy.mjs` falla cerrado cuando detecta:

- un package del workspace que deje de ser `private`;
- cambio no revisado del package manager fijado `pnpm@9.15.0`;
- dependencias directas con rangos, URLs, git/file/link/workspace specifiers u otra versión no exacta;
- lifecycle scripts de instalación/publicación actualmente prohibidos en packages propios del repositorio;
- expansión del workspace fuera de `tools/*` sin un cambio explícito del contrato;
- lockfile distinto de la generación esperada `9.0`;
- symlinks trackeados o entradas trackeadas que no resuelvan a archivos regulares;
- archivos de credenciales/keys sensibles trackeados;
- patrones de secretos de alta confianza en archivos trackeados.

Rechazar symlinks evita que el scanner siga una ruta fuera del workspace del runner. El scanner nunca imprime el valor encontrado; solo ruta y clase del patrón.

Los lifecycle hooks pertenecientes a dependencias instaladas no se presentan como bloqueados por esta policy; este control se aplica a los manifests propios del workspace. El riesgo de scripts transitivos requiere controles de supply chain adicionales y permanece fuera de este corte.

### 2. Dependency/license inventory

`tools/ci/generate-dependency-inventory.mjs` se ejecuta únicamente después de `pnpm install --frozen-lockfile` y genera:

`artifacts/ci/dependency-inventory.json`

El inventario contiene package, versión, metadata de licencia declarada, relación directa/transitiva y el SHA revisado cuando está disponible.

El gate falla si:

- no puede observar paquetes instalados;
- encuentra un `package.json` instalado que no puede leerse o parsearse de forma válida;
- una dependencia no declara metadata de licencia;
- la metadata contiene una licencia de la lista restringida que exige revisión explícita.

La lista restringida es un control preventivo del proyecto, no una conclusión jurídica.

### 3. Trazabilidad del HEAD revisado

En eventos `pull_request`, GitHub expone un merge ref sintético como `GITHUB_SHA`. Ese SHA no se usa como identidad del código revisado.

El workflow define `REVIEWED_SHA` como el `pull_request.head.sha` real y usa ese valor para:

- hacer checkout explícito del source revisado en los jobs aplicables;
- registrar `sourceCommit` dentro del inventario;
- nombrar el artefacto de evidencia.

Los checkouts usan `persist-credentials: false`; los jobs no conservan la credencial Git después de obtener el source. En `push` o `workflow_dispatch`, `REVIEWED_SHA` cae a `github.sha`.

### 4. Actions fijadas por SHA

Las Actions de terceros usadas en este workflow permanecen fijadas por commit SHA y usan releases estables con runtime Node 24:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`);
- `pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86` (`v6.0.10`);
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`);
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (`v7.0.1`).

La versión de pnpm instalada por el workflow continúa siendo exactamente `9.15.0`; actualizar la Action que instala pnpm no cambia el package manager del proyecto.

### 5. Evidencia de CI

El workflow sube el inventario con la Action `upload-artifact` fijada por SHA indicada arriba.

La evidencia es obligatoria: `if-no-files-found: error` evita que un run quede verde sin producir `artifacts/ci/dependency-inventory.json`.

El artefacto se nombra con el SHA revisado y tiene retención limitada. La evidencia relevante sigue siendo la ejecución GitHub Actions asociada al HEAD revisado.

### 6. Gobernanza compensatoria de `main`

El repositorio es privado y el plan actual no habilita branch protection/rulesets para este repositorio. Por tanto, el workflow **no** presenta este control como sustituto preventivo de una branch protection nativa.

Mientras esa limitación de plan exista:

- el trigger `push` canónico apunta a `main`, no a ramas históricas ya integradas;
- todo `push` a `main` ejecuta nuevamente la validación TARGET y supply-chain;
- el job `Main push governance` exige que el commit recibido en `main` tenga exactamente dos padres, haya sido creado por GitHub y corresponda al `merge_commit_sha` de una PR ya fusionada cuyo base sea `main`;
- un direct push, squash merge o rebase merge deja el workflow en fallo y exige remediación explícita;
- el método operativo autorizado para integrar permanece `merge` normal mediante PR y `expected_head_sha`.

Este control es **detectivo**, no preventivo: si alguien con permisos escribe directamente en `main`, GitHub ya habrá aceptado el commit antes de que Actions lo marque como incumplimiento. La protección preventiva real requiere GitHub Pro/Team/Enterprise para el repositorio privado o un cambio deliberado de visibilidad; POS Platform no debe hacerse público únicamente para obtener esta función.

## Controles deliberadamente pendientes

Este corte no materializa todavía:

- branch protection nativa mientras el plan actual no la habilite para el repositorio privado;
- Nx;
- lint del runtime/aplicaciones, porque el runtime TARGET sigue ausente;
- CodeQL u otro SAST completo;
- dependency vulnerability scanning con una política de severidad cerrada;
- secret scanning de plataforma/proveedor como sustituto del scanner local;
- SBOM CycloneDX/SPDX estándar y firmado;
- política legal completa de compatibilidad de licencias;
- provenance/attestations de build;
- firma de releases;
- runtime tests;
- release controls;
- `SEC-G07`, `SEC-G09` o `SEC-G10 = PASS`.

Por tanto `TECH-004` debe continuar `IN_PROGRESS` después de este corte aunque todos sus checks pasen.

## Invariantes

1. No se añaden dependencias para implementar este gate.
2. `pnpm-lock.yaml` permanece byte-for-byte sin cambios en este corte.
3. migrations 001/002 no se modifican.
4. SQL/descriptor 003 no se materializan.
5. El gate no promueve providers, runtime, infraestructura productiva ni security gates.
6. Un cambio posterior en el HEAD requiere una nueva ejecución aplicable antes de afirmar `PASS`.
7. La gobernanza compensatoria no autoriza direct pushes a `main`; únicamente los detecta después del hecho.
