# Camacho POS Colombia

Camacho POS Colombia es una plataforma POS modular, multi-tenant y local-first diseñada para operación comercial real, trazabilidad fuerte y evolución controlada desde una sola base de código.

**Identidad de producto:** `Camacho POS Colombia` es el nombre comercial visible al cliente. `POS Platform`, `pos-platform` y los scopes técnicos `@pos-platform/*` se conservan como identificadores internos para mantener compatibilidad y trazabilidad. El registro empresarial y marcario del nombre comercial permanece pendiente de validación oficial en RUES/SIC y no se presenta como marca registrada.

## Estado real

Camacho POS Colombia está en **Fase 1 — fundación técnica ejecutable**.

La Fase 0 documental está cerrada. La fundación física y de tooling existe, pero el runtime de aplicación todavía no está materializado.

Estado vigente:

- `main` es la única rama canónica;
- migrations PostgreSQL 001/002: `MATERIALIZED / TESTED / IMMUTABLE`;
- SQLite actual: control/migration tooling materializado; runtime local completo pendiente;
- External Integrations foundation: materializada en migration 002, central, `NON_FISCAL`;
- MAT-003 preflight y canonical-role-readiness tooling: materializados/revisados;
- canonical-role readiness: `APPLIED / REVIEWED` únicamente en `LOCAL_CANONICAL_INTEGRATION`;
- MAT-003 preflight canónico: `EXECUTED / PASS / REVIEWED`, read-only, cero mutaciones durables;
- SQL/descriptor 003 y schema fiscal 003: `ABSENT`;
- migration 003: `NOT_MATERIALIZED`;
- SIIGO/FACTUS/ALEGRA: `DESIGNED / NOT_EVALUATED`;
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`;
- NestJS/Fastify, Electron/React/Vite y POS Local Service: `ABSENT / NOT_MATERIALIZED`;
- infraestructura productiva, piloto y hardware certificado: pendientes.

**No existe una aplicación POS productiva completa en este repositorio todavía.** Documentación, migrations, PoC, CI y tooling no se presentan como runtime terminado.

## Integraciones recientes de `main`

- PR #2 integró la fundación TARGET y PR #3 retiró el runtime legacy.
- PR #5 integró el baseline de supply chain y la gobernanza detectiva de `main`.
- PR #6 reconcilió el estado canónico y PR #7 adoptó `Camacho POS Colombia` como nombre comercial, sin renombrar identificadores técnicos.
- El merge de PR #7 quedó en `940107f8cc0976c130dd4f274928b2df248473f4`.
- El run post-merge #47 (`32937793013`) terminó `SUCCESS`, incluidos:
  - `Repository policy and dependency inventory = SUCCESS`;
  - `TypeScript, SQLite and PostgreSQL 16.14 = SUCCESS`;
  - `Main push governance = SUCCESS`.

La evidencia anterior es histórica y commit-scoped. El SHA vigente de `main` siempre se consulta en GitHub; no se infiere desde este README.

## Fuente de verdad

- [Identidad de marca](docs/product/brand.md): nombre comercial, identificadores técnicos preservados y límites de claims.
- [Backlog maestro](docs/product/backlog.md): estado, prioridad, dependencias, bloqueos y orden inmediato.
- [Gobernanza del repositorio](docs/governance/repository-governance.md): ramas, PRs, merges y evidencia remota/local.
- [Índice documental](docs/README.md): jerarquía completa de fuentes.
- [Mapa de módulos](docs/architecture/module-map.md) y [ownership](docs/architecture/data-ownership.md): bounded contexts y propiedad.

Si dos fuentes normativas vigentes se contradicen, no se implementa una interpretación arbitraria: se reconcilian primero.

## Arquitectura objetivo

POS Platform utiliza una sola arquitectura TARGET:

- monolito modular;
- TypeScript estricto;
- pnpm workspaces + Nx cuando se materialice el runtime;
- API central NestJS con Fastify;
- Electron + React + Vite para el POS de escritorio;
- POS Local Service Node.js/TypeScript como servicio de Windows;
- PostgreSQL 16 central;
- SQLite/WAL local;
- Kysely con migrations físicas separadas por dialecto;
- Zod para contratos runtime cuando TECH-003 se materialice;
- Vitest, Playwright, Testcontainers y k6 según el nivel de prueba;
- OpenTelemetry para observabilidad futura;
- Docker e infraestructura central pagada para entornos con datos reales.

La PWA puede existir como laboratorio o capacidad web central; no es la autoridad productiva de caja, hardware o SQLite local.

## Principios

- **Una sola base de código:** no existen forks por tipo de comercio ni una arquitectura paralela para `LOCAL_PERPETUAL`.
- **Ownership explícito:** cada bounded context posee sus reglas y datos; no escribe directamente tablas internas de otro módulo.
- **Multi-tenancy por diseño:** tenant/company/branch se derivan y validan desde contexto autorizado; un ID enviado por cliente no constituye autoridad.
- **Local-first:** una venta ordinaria autorizada no depende de Internet para confirmarse.
- **Único writer SQLite:** el POS Local Service será el único proceso escritor de la base local.
- **Idempotencia:** operaciones críticas conservan identidad, checksum, causalidad y evidencia de retry.
- **Sin last-write-wins genérico:** el reloj local no decide autoridad global.
- **Append-only/compensación:** hechos financieros, inventario y auditoría no se corrigen mediante sobrescritura destructiva cuando el contrato exige historia.
- **Providers neutrales:** Factus, Siigo, datáfonos o hardware se integran mediante adapters; no definen el dominio canónico.
- **Claims verificables:** `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`, `CANONICALLY_APPLIED` y `PRODUCTION_READY` son niveles distintos.

## Módulos

La granularidad canónica está en [module-map.md](docs/architecture/module-map.md).

Fundación:

- Identity, Tenants, Companies, Branches, Authorization, Devices, Licensing, Audit, Sync.

Núcleo comercial:

- Catalog, Pricing, Tax, Inventory, Purchasing, Suppliers, Sales, Payments, Cash Register, Customers, Reporting.

Operación extendida:

- Orders, Delivery, Couriers, Notifications, Hardware, Support, Subscriptions, External Integrations, Electronic Invoicing.

`Categories`, `Product Codes`, `Units` y `Lots` son subcapacidades de owners existentes; no bounded contexts paralelos.

## Runtime objetivo

```text
Renderer React
    |
    | preload allowlisted
    v
Electron main
    |
    | canal local autenticado/versionado
    v
POS Local Service
    |-- dominio y casos de uso locales
    |-- SQLite/WAL
    |-- outbox/sync
    |-- impresión
    |-- hardware
    |-- backup/restore
    |-- dispositivo/licencia
    `-- actualización/diagnóstico
```

El renderer no abre SQLite, no ejecuta reglas financieras y no accede directamente a hardware o secretos.

## Estructura actual

```text
pos-platform/
|-- .github/workflows/             # CI TARGET vigente
|-- docs/                          # fuentes normativas y evidencia documental
|-- poc/                           # laboratorios aislados, no runtime
|-- tools/ci/                      # repository/supply-chain policy
|-- tools/target-migrations/       # migrations 001/002 + tooling MAT-003
|-- package.json
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
`-- tsconfig.base.json
```

`apps/` y `packages/` de la arquitectura objetivo todavía no existen.

## CI vigente

El gate actual está documentado en:

- [TARGET foundation CI](docs/testing/target-foundation-ci-gate.md);
- [Supply-chain baseline](docs/testing/supply-chain-baseline-ci-gate.md).

El workflow corre en PRs hacia `main`, pushes a `main` y dispatch manual. Es commit-scoped.

El control `Main push governance` es **detectivo**, no branch protection preventiva.

## Branch protection

El repositorio es privado y el plan GitHub vigente no habilita branch protection/rulesets preventivos para este caso. GitHub reporta `main` sin protección nativa.

Mientras esa limitación exista, el proyecto exige merge normal mediante PR, SHA esperado, CI del HEAD exacto y verificación post-merge. Véase [repository-governance.md](docs/governance/repository-governance.md).

No se hará público el repositorio únicamente para obtener protección de ramas.

## SQL003 / facturación electrónica

Migration 003 está bloqueada antes de materialización.

- PR #4 contiene una propuesta de reconciliación contractual y permanece draft/bloqueada por revisión independiente no disponible por cuota.
- `wip/sql003-contract-gap-20260825` es evidencia histórica y `NOT_INTEGRABLE`.
- Un manifest fiscal documental anterior no autoriza escribir SQL mientras existan contract gaps abiertos.
- No se integrará ni cherry-pickeará completo el WIP histórico.

## Desarrollo local

El repositorio permite validar el tooling TARGET existente, pero no iniciar el producto completo extremo a extremo.

Comandos existentes incluyen, entre otros:

```powershell
pnpm typecheck
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```

La validez de un comando y su resultado se reportan solo cuando se ejecutan realmente en el entorno correspondiente.

GitHub remoto no demuestra `git status`, Docker, PostgreSQL ni procesos del equipo local. Sin verificación local actual, esos estados son `NOT_EVALUATED / REQUIRES_LOCAL_VERIFICATION`.

## Próximo trabajo

La cola exacta y sus gates están en [docs/product/backlog.md](docs/product/backlog.md). No se salta directamente al runtime mientras existan reconciliaciones/gates previos vigentes.
