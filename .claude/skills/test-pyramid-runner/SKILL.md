---
name: test-pyramid-runner
description: Usar para decidir qué prueba corre en pos-platform según lo que cambió. Sólo lista herramientas que existen de verdad en el workspace.
---
# Qué se puede probar realmente

> **Corrección 2026-09-06.** La versión anterior mandaba usar **Testcontainers**
> y **k6**. Verificado contra los `package.json` del workspace: **cero
> declaraciones de ambos**. No existen. Un agente que siguiera ese skill
> intentaría correr herramientas ausentes y reportaría un fallo de entorno como
> si fuera del código.

## Herramientas que sí existen

| Nivel | Herramienta | Comando real |
|---|---|---|
| Contratos | Vitest | `pnpm test:contracts` |
| Dominio | Vitest | `pnpm test:domain` |
| Aplicación | Vitest | `pnpm test:application` |
| Puertos y adapters fiscales | Vitest | `pnpm test:fiscal-adapters` |
| Runtime local + SQLite real | Vitest + `better-sqlite3` | `pnpm test:runtime` |
| Migraciones SQLite | Vitest | `pnpm test:migrations:sqlite` |
| Migraciones PostgreSQL | Vitest + Kysely | `pnpm test:migrations:postgres` |
| Tipos | `tsc` | `pnpm typecheck` |
| Fronteras de módulo | Nx + validador propio | `pnpm architecture:check` |
| Secretos en archivos rastreados | script propio | `pnpm ci:repository-policy` |

## Estado real de lo demás

- **Playwright** está declarado y hay `apps/pos-desktop/e2e/playwright.config.ts`,
  pero **cero specs**. No digas «probado E2E»: no hay E2E.
- **Testcontainers**: no existe en el workspace.
- **k6**: no existe en el workspace.
- **Suite de sandbox fiscal**: existe, está apagada por defecto y **nunca corre
  en CI**. Sólo se ejecuta en la máquina del responsable con las cuatro
  variables `FACTUS_SANDBOX_*`. Produce `SANDBOX_VERIFIED`; un fake determinista
  sólo produce `MOCK_TESTED`.

## Regla

Corre el comando real y pega el resultado real. Si no lo corriste en este turno,
no digas `TESTED` (ver skill `claims-level-audit`): di qué falta ejecutar.
