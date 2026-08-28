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

### SPDX license compatibility

TECH-004 Bloque 4 evalúa todos los componentes third-party del CycloneDX SBOM con `tools/ci/validate-spdx-license.mjs`. El inventory instalado debe ser subconjunto del SBOM. Los componentes SBOM-only se consultan únicamente por nombre npm canónico + versión SemVer exacta contra `https://registry.npmjs.org`, sin redirects y con respuesta limitada a 1 MiB.

El parser distingue `AND`, `OR`, paréntesis y `WITH`. La policy produce únicamente `ALLOW / REVIEW_REQUIRED / DENY`; IDs desconocidos, metadata ausente o excepciones WITH no revisadas bloquean. El piso deny para AGPL/GPL/SSPL/BUSL/UNLICENSED no puede rebajarse por configuración.

La evidencia `license-compatibility-report.json` liga reviewed SHA y digests del SBOM, inventory y policy. Es una política de ingeniería/compliance, no un dictamen jurídico.

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

## Estado TECH-004 y alcance diferido

Materializado en el alcance estático de TECH-004:

- repository policy + secret baseline;
- CodeQL/SAST con findings remediados sin suppress;
- vulnerability gate high/critical;
- SBOM CycloneDX 1.6;
- compatibilidad SPDX;
- provenance hash-bound exact-head.

No completado por este baseline porque requiere runtime/release/infraestructura real:

- Nx/pipeline de aplicaciones runtime;
- lint y E2E del runtime;
- packaging y firma de releases;
- release promotion;
- infraestructura productiva, backup/restore y DR.

GitHub native Artifact Attestations permanece `BLOCKED_BY_PLATFORM` hasta demostrar el prerrequisito compatible de Enterprise Cloud. No se maquilla como PASS. TECH-004 quedó `DONE / INTEGRATED` mediante PR #15: merge `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`, TARGET post-merge #226 / run `33177520034` `SUCCESS`, CodeQL #37 / run `33177520014` `SUCCESS` y provenance manifest SHA-256 `311fb9827017ebfad109cfe2f809787233fc75a9364c6ea5d6e98bfdcd5b647b`.

## Invariantes

1. Migrations PostgreSQL 001/002 permanecen inmutables.
2. SQL/descriptor 003 no se materializan por este gate.
3. El runtime TARGET no se materializa por este gate.
4. Un resultado CI siempre es commit-scoped.
5. Si cambia el workflow, este documento y `target-foundation-ci-gate.md` deben reconciliarse en el mismo cambio.

### Provenance exact-head

El job `Provenance evidence` corre después de supply-chain y validación TARGET. Descarga los artifacts exact-head del mismo run, espera CodeQL del mismo SHA, liga IDs/digests de GitHub y valida hashes internos antes de emitir `provenance-manifest.json` + checksum.

La suite prueba determinismo, tamper, sustitución de metadata y artifact faltante. La policy completa está en `docs/security/provenance-attestations-gate.md`.
