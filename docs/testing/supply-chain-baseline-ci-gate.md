# Baseline CI de supply chain TARGET

## Estado y alcance

Este documento describe los controles de repository policy, secretos e inventario de dependencias/licencias incorporados por la PR #5 e integrados en `main`.

Estado:

`SUPPLY_CHAIN_BASELINE = MATERIALIZED / FAIL_CLOSED_HARDENED / INTEGRATED / CI_PASS`

No equivale a un security release gate completo, a un SBOM estándar firmado ni a una conclusión legal de licencias.

## Controles materializados

### Repository policy

`tools/ci/validate-repository-policy.mjs` falla cerrado cuando detecta:

- package propio no `private`;
- package manager raíz distinto de `pnpm@9.15.0`;
- dependencias directas con versiones no exactas o specifiers no admitidos;
- lifecycle scripts actualmente prohibidos en manifests propios;
- expansión del workspace fuera de los roots revisados `apps/*`, `packages/*`, `tools/*` sin reconciliar el contrato;
- lockfile fuera de la generación esperada;
- symlinks trackeados o entradas que no resuelven a archivos regulares;
- credenciales/keys sensibles trackeadas;
- patrones de secretos de alta confianza en archivos trackeados.

El scanner no imprime el valor sensible encontrado. Los archivos trackeados se abren con descriptor `O_NOFOLLOW`, se validan con `fstat` y se leen desde el mismo descriptor para evitar la carrera TOCTOU entre comprobar tipo y consumir contenido. Los lifecycle hooks de dependencias transitivas no se presentan falsamente como bloqueados por esta policy.

### Dependency/license inventory

`tools/ci/generate-dependency-inventory.mjs` se ejecuta después de `pnpm install --frozen-lockfile` y produce:

`artifacts/ci/dependency-inventory.json`

El gate falla si:

- no puede observar paquetes instalados;
- un `package.json` instalado no puede leerse o parsearse;
- una dependencia no declara metadata de licencia;
- la metadata contiene una licencia configurada como restringida y pendiente de revisión explícita.

La evidencia es obligatoria: `actions/upload-artifact` utiliza `if-no-files-found: error`.

El inventario comparte el mismo discovery de manifests que repository policy: `package.json` más hijos directos bajo `apps/*`, `packages/*` y `tools/*`. Cada dependencia directa registra workspace, manifest y sección declarativa; los `workspace:` internos no se confunden con paquetes externos instalados.

### Dependency vulnerability gate

TECH-004 ejecuta `pnpm audit --json --audit-level=low` sobre la instalación frozen y evalúa el reporte con `tools/ci/validate-dependency-audit.mjs`.

El piso ejecutable bloquea `high` y `critical`, conserva `moderate/low` para triage y no usa `--ignore-registry-errors`. Error del registry, JSON inválido, conteos inconsistentes, policy inválida o excepción vencida fallan cerrado.

La evidencia raw + evaluación normalizada se conserva en un artifact exact-head separado. La política y formato de excepciones están en `docs/security/dependency-vulnerability-gate.md`.

## Trazabilidad

El workflow utiliza el HEAD real de la PR como source revisado:

`REVIEWED_SHA = pull_request.head.sha || github.sha`

Los checkouts aplicables usan `persist-credentials: false`.

Las Actions permanecen fijadas por SHA. La versión de pnpm del proyecto permanece fijada de forma independiente.

## Evidencia de integración

HEAD final revisado de PR #5:

`19adc690a9277a18a8de214060cd890553f0842c`

Run pre-merge:

- `32932269946` (#39);
- `COMPLETED / SUCCESS`;
- repository policy/dependency inventory `SUCCESS`;
- TypeScript/SQLite/PostgreSQL `SUCCESS`.

PR #5 fue integrada mediante merge normal en:

`bfca119b27f9b4bf0a7b0541708161a2beb2833d`

Run post-merge `main`:

- `32933559784` (#40);
- `COMPLETED / SUCCESS`;
- repository policy/dependency inventory `SUCCESS`;
- TypeScript/SQLite/PostgreSQL `SUCCESS`;
- `Main push governance = SUCCESS`.

## Gobernanza de `main`

El mismo workflow escucha pushes a `main` y ejecuta el control detectivo descrito en `docs/governance/repository-governance.md`.

Branch protection preventiva nativa continúa no disponible con el plan actual del repositorio privado. No se describe el workflow como protección preventiva.

## Pendiente bajo TECH-004

Este baseline no completa:

- Nx y pipeline de aplicaciones TARGET;
- lint del runtime/aplicaciones;
- CodeQL/SAST materializado y ejecutado en TECH-004; el TOCTOU reportado por el primer SARIF fue remediado y CodeQL posterior quedó en 0 resultados;
- vulnerability scanning high/critical materializado y ejecutado; su evidencia es dinámica y debe refrescarse en el HEAD final;
- SBOM CycloneDX/SPDX firmado;
- política legal completa de compatibilidad de licencias;
- provenance/attestations;
- firma de releases;
- runtime tests;
- release controls;
- gates de infraestructura/backup/restore productivos.

Bloques SAST, hardening de inventory y vulnerabilidades no completan por sí solos TECH-004. SBOM, licencia completa, provenance y cierre integral siguen pendientes; por tanto `TECH-004` continúa `IN_PROGRESS`.

## Invariantes

1. Migrations PostgreSQL 001/002 permanecen inmutables.
2. SQL/descriptor 003 no se materializan por este gate.
3. El runtime TARGET no se materializa por este gate.
4. Un resultado CI siempre es commit-scoped.
5. Si cambia el workflow, este documento y `target-foundation-ci-gate.md` deben reconciliarse en el mismo cambio.
