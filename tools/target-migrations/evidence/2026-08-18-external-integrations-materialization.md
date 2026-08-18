# Evidencia MAT-002-MATERIALIZATION

Fecha: 2026-08-18
Migration: `002_external_integrations_foundation`
Resultado: `PASS`

## Alcance materializado

- PostgreSQL 16, schema `integrations`, owner `pos_schema_owner`.
- 16 tablas exactas y cero seed rows.
- 12 tablas con RLS `ENABLE/FORCE`.
- Dispatch y attempts físicamente limitados a `NON_FISCAL`.
- SQLite scope `NONE`.
- Migration 003 ausente.
- Sin adapters, credenciales reales ni llamadas provider.

## Ejecución reproducible

```powershell
pnpm typecheck
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```

Resultados de esta corrida:

- TypeScript: PASS.
- SQLite: `12/12` PASS.
- PostgreSQL: `96/96` PASS (`54/54` migration 001 + `42/42` migration 002).
- Introspection 001 después de 002: PASS.
- Introspection 002: PASS.
- Smoke con `pos_app`, `pos_worker`, `pos_platform_app` y `pos_platform_admin`: PASS.
- Concurrent up 002: una aplicación y un no-op bajo advisory lock global.
- Concurrent up 002/down 001: una operación serializada y la incompatible rechazada.
- Recovery STARTED/body committed, checksum mismatch y body rollback: PASS.
- Down 001 con 002 aplicada: rechazado.
- Down/repeated down 002: PASS; conserva 001 y `btree_gist`.
- `btree_gist`: rutas `INSTALLED_BY_MIGRATION_PREREQUISITE` y `PREEXISTING` verificadas.

## Integridad de migration 001

- UP SHA-256: `7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507`.
- DOWN SHA-256: `383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7`.
- Blobs iguales al commit materializador `255d813`.

## Límites de la evidencia

Esta evidencia valida materialización, catálogo, roles, RLS, grants, constraints y recovery en PostgreSQL 16. No implementa ni verifica providers, OAuth/HTTP, schemas Zod provider-specific, deployment productivo ni security gates completos. `SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.
