# Camacho POS Colombia (pos-platform)

Plataforma POS modular, multi-tenant, local-first para retail colombiano.
Identidad comercial: `Camacho POS Colombia`. Identificadores técnicos: `pos-platform`, `@pos-platform/*`.

## Regla de oro
Este repo distingue niveles de claim: `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`,
`CANONICALLY_APPLIED`, `PRODUCTION_READY`. NUNCA afirmes un nivel que no verificaste
realmente en este entorno. Si no ejecutaste el comando, no digas "PASS". Si no viste el
runtime, no digas "MATERIALIZED".

## Estado vigente (revisar docs/product/backlog.md para el estado real, esto puede quedar desactualizado)
- Fase 1 — fundación técnica ejecutable. `apps/` y `packages/` del TARGET ya existen (verificado 2026-09-01):
  `apps/pos-local-service`; `packages/{application,contracts,database-core,database-postgres,database-sqlite,domain,observability,testing}`.
- `main` es la única rama canónica. Sin branch protection nativa → toda integración es por
  PR + SHA esperado + CI del HEAD exacto + verificación post-merge (ver docs/governance/repository-governance.md).
- Migrations PostgreSQL 001/002/003: integradas con gates cerrados. SQLite 003: `NONE`.
- Un RT marcado `DONE` en el backlog referido a un PR (p.ej. "RT-005 = DONE ... en PR #19") describe el estado
  del trabajo en esa rama/PR, NO que ya está mergeado a `main`. Verificar merge real con
  `gh pr view <N> --json state,mergedAt` antes de asumir integración — no inferirlo del backlog.

## Arquitectura TARGET (única, no forks)
- Monolito modular, TypeScript estricto, pnpm workspaces + Nx.
- API central: NestJS con Fastify.
- Desktop POS: Electron + React + Vite.
- POS Local Service: Node.js/TypeScript como servicio de Windows — único writer de SQLite.
- PostgreSQL 16 central + SQLite/WAL local. Kysely con migrations físicas separadas por dialecto.
- Zod para contratos runtime (cuando TECH-003 se materialice).
- Vitest, Playwright, Testcontainers, k6 según nivel de prueba.

## Principios no negociables
- Un ID enviado por el cliente NO es autoridad; tenant/company/branch se derivan del contexto autorizado.
- Cada bounded context posee sus datos; nadie escribe directo en tablas de otro módulo.
- Local-first: una venta ordinaria autorizada no depende de Internet.
- Sin last-write-wins genérico. Operaciones críticas son idempotentes (checksum + causalidad).
- Hechos financieros/inventario/auditoría son append-only cuando el contrato exige historia.
- Providers (Factus, Siigo, datáfonos, hardware) se integran vía adapters, no definen el dominio.

## Fuentes de verdad (léelas antes de proponer cambios grandes)
- docs/product/brand.md · docs/product/backlog.md · docs/governance/repository-governance.md
- docs/README.md (índice) · docs/architecture/module-map.md · docs/architecture/data-ownership.md

## Comandos existentes
```
pnpm typecheck
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```
No inventes comandos que no estén en package.json/nx.json — verifica antes de sugerir uno nuevo.
