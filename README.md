# Camacho POS Colombia

Camacho POS Colombia es una plataforma POS modular, multi-tenant y local-first diseñada para operación comercial real, trazabilidad fuerte y evolución controlada desde una sola base de código.

**Identidad de producto:** `Camacho POS Colombia` es el nombre comercial visible al cliente. `POS Platform`, `pos-platform` y los scopes técnicos `@pos-platform/*` se conservan como identificadores internos para mantener compatibilidad y trazabilidad. El registro empresarial y marcario del nombre comercial permanece pendiente de validación oficial en RUES/SIC y no se presenta como marca registrada.

## Estado real

Camacho POS Colombia está en **Fase 1 — fundación técnica ejecutable**.

Existe un núcleo comercial local que vende, cobra, cuadra caja y registra
adquirientes, con impuesto por línea; **no existe todavía una interfaz que un
cajero pueda usar para hacerlo**, ni plataforma central, ni administración de
usuarios y roles.

Las dos fuentes que mandan sobre esta sección, y que se actualizan en cada
bloque:

- [tablero de materialización](docs/governance/tablero-materializacion.md) —
  56 capacidades con su nivel y su evidencia;
- [auditoría de conformidad con el stack](docs/governance/stack-conformance-audit.md)
  — la lámina del stack objetivo contrastada punto por punto contra el árbol.

Este README resume; **si discrepa con ellos, mandan ellos**.

### Lo que ya está en `main` y probado

- **Servicio local POS** (`apps/pos-local-service`): lifecycle, SQLite/WAL con
  escritor único y backup/restore verificados en Windows, named pipe local
  autenticado (DPAPI + HMAC + anti-replay), identidad de dispositivo y licencia
  Ed25519, sync durable (outbox/inbox/checkpoint/dead-letter con backoff).
- **Sesión y autorización**: SSA firmada y revocable, snapshot de autorización
  firmado, y un motor de permisos **RBAC** puro que falla cerrado.
- **Núcleo comercial**: `Sales` (venta → `READY_FOR_PAYMENT`), `Cash`
  (apertura y cierre de turno), `Payments` (efectivo y transferencia, con la
  venta completándose en la **misma** transacción que cubre el importe),
  `Customers` (adquiriente fiscal) e **impuesto por línea** desde el catálogo.
- **Plano fiscal**: cinco puertos por capacidad, tablas de códigos DIAN con
  fuente verificada, y el adapter FACTUS con **dos de sus cinco puertos
  `SANDBOX_VERIFIED`** contra el proveedor real.
- **Escritorio Electron**: shell con preload allowlisted y renderer aislado.
- **CI**: validación TARGET (5 jobs, incluido un runner Windows y PostgreSQL
  16.14 real), CodeQL, SBOM, licencias, auditoría de vulnerabilidades
  fail-closed y gobernanza de merge de `main`.

### Lo que NO existe, dicho sin rodeos

- **Interfaz comercial.** El renderer son ~110 líneas y expone tres llamadas
  técnicas. Las trece operaciones comerciales tienen contrato, handler y prueba
  de extremo a extremo contra el canal, y **ninguna llega a una pantalla**.
- **Administración, roles y super-administrador.** Hay 14 roles y 126 permisos
  atómicos documentados, y **10 permisos implementados, ninguno de
  administración**. No hay tabla de roles, ni panel, ni forma de dar de alta un
  usuario o asignarle un rol desde el producto.
- **ABAC, MFA y reautenticación.** La matriz de permisos los exige de forma
  explícita para toda operación financiera y **no hay ninguno**.
- **Plataforma central.** `packages/database-postgres/src` está vacío: sin API,
  sin NestJS ni Fastify, sin inbox. Sin cliente HTTP saliente, ningún hecho
  comercial sale del dispositivo.
- **Catálogo real.** Sigue siendo `sandbox_catalog_*`, poblado sólo por
  pruebas. Sin Inventory ni Pricing.
- **Hardware.** Báscula, lector, impresora, cajón, datáfono y pantalla cliente:
  ni la abstracción existe.
- **Empaquetado y despliegue.** Sin instalador (`electron-builder` no está en el
  lockfile), sin Docker, sin infraestructura.
- **PWA**, **OpenTelemetry**, **Testcontainers**, **k6** y **linter**: cero
  declaraciones en el monorepo.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

**No existe una aplicación POS productiva completa en este repositorio.** Lo que
hay es un núcleo comercial local real, probado y alcanzable por su canal, sin
interfaz ni plataforma central.

## Fuente de verdad

- [Identidad de marca](docs/product/brand.md): nombre comercial, identificadores técnicos preservados y límites de claims.
- [Backlog maestro](docs/product/backlog.md): estado, prioridad, dependencias, bloqueos y orden inmediato.
- [Gobernanza del repositorio](docs/governance/repository-governance.md): ramas, PRs, merges y evidencia remota/local.
- [Índice documental](docs/README.md): jerarquía completa de fuentes.
- [Mapa de módulos](docs/architecture/module-map.md) y [ownership](docs/architecture/data-ownership.md): bounded contexts y propiedad.

Si dos fuentes normativas vigentes se contradicen, no se implementa una interpretación arbitraria: se reconcilian primero.

## Arquitectura objetivo

POS Platform utiliza una sola arquitectura TARGET:

Es el **objetivo**, no el estado. La conformidad real, punto por punto y con el
comando que la comprueba, está en
[stack-conformance-audit.md](docs/governance/stack-conformance-audit.md).

| Pieza | En `main` |
|---|---|
| monolito modular · TypeScript estricto · pnpm + Nx | ✅ |
| Zod para contratos runtime | ✅ |
| POS Local Service Node.js/TypeScript | ✅ (no hay host de servicio instalable) |
| SQLite/WAL local · Kysely con migrations por dialecto | ✅ |
| PostgreSQL 16 central | migraciones probadas contra 16.14; **sin instancia desplegada** |
| Electron + React + Vite | shell y renderer mínimo |
| Vitest | ✅ · **Playwright** config sin specs · **Testcontainers** y **k6** ausentes |
| API central NestJS con Fastify | ❌ ausente |
| OpenTelemetry | ❌ ausente |
| Docker e infraestructura | ❌ ausente |

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

Migration PostgreSQL 003 está integrada y sus gates de repositorio quedaron cerrados por INT-007 / PR #11. Esto acredita el artefacto, rollback, introspección y pruebas físicas en PostgreSQL 16.14; no acredita despliegue productivo, providers, credenciales, sandbox ni operación fiscal real.

- PR #4 y la remediación autoritativa posterior están `MERGED / CLOSED` como antecedentes contractuales.
- `wip/sql003-contract-gap-20260825` permanece como evidencia histórica `NOT_INTEGRABLE`.
- SQLite 003 continúa `NONE`; no se inventa equivalencia física entre dialectos.
- Todo cambio fiscal posterior conserva Modelo A, historia append-only y gates exact-head.

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
