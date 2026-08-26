# TARGET supply-chain baseline CI gate

## Estado y alcance

Este documento define el corte incremental de `TECH-004` que añade controles reproducibles de repositorio, secretos y visibilidad de dependencias/licencias al workflow TARGET existente.

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

- hacer checkout explícito del source revisado en ambos jobs;
- registrar `sourceCommit` dentro del inventario;
- nombrar el artefacto de evidencia.

Ambos checkouts usan `persist-credentials: false`; los jobs no conservan la credencial Git después de obtener el source. En `push` o `workflow_dispatch`, `REVIEWED_SHA` cae a `github.sha`.

### 4. Actions fijadas por SHA

Las Actions de terceros usadas en este workflow permanecen fijadas por commit SHA y se actualizaron a releases estables que declaran runtime Node 24:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`);
- `pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86` (`v6.0.10`);
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`);
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (`v7.0.1`).

La versión de pnpm instalada por el workflow continúa siendo exactamente `9.15.0`; actualizar la Action que instala pnpm no cambia el package manager del proyecto.

### 5. Evidencia de CI

El workflow sube el inventario con la Action `upload-artifact` fijada por SHA indicada arriba.

La evidencia es obligatoria: `if-no-files-found: error` evita que un run quede verde sin producir `artifacts/ci/dependency-inventory.json`.

El artefacto se nombra con el SHA revisado y tiene retención limitada. La evidencia relevante sigue siendo la ejecución GitHub Actions asociada al HEAD revisado.

## Controles deliberadamente pendientes

Este corte no materializa todavía:

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
