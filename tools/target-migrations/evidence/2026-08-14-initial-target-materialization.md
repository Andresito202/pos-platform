# Initial TARGET materialization evidence

Date: 2026-08-14

Branch at preflight: `architecture/physical-model`

HEAD at preflight: `68db8ea`

## Reproduction

From the repository root:

```powershell
pnpm install --frozen-lockfile
docker compose -f tools/target-migrations/compose.yaml up -d --wait
pnpm typecheck
pnpm test:migrations
docker compose -f tools/target-migrations/compose.yaml down
```

The Compose database is isolated, binds only `127.0.0.1:55432`, and uses an
ephemeral `tmpfs`. The test suite creates and removes only databases whose names
start with `target_migration_`.

## Verified result

| Check | Result |
|---|---|
| Reproducible install | PASS (`pnpm install --frozen-lockfile`) |
| Node.js | `v22.19.0` |
| pnpm | `9.15.0` |
| TypeScript strict typecheck | PASS |
| PostgreSQL server | `16.14 (Debian 16.14-1.pgdg13+1)` |
| PostgreSQL migration tests | PASS, 54/54 |
| SQLite runtime | `3.53.4` |
| SQLite migration tests | PASS, 12/12 |
| Combined migration tests | PASS, 66/66 |
| PostgreSQL expected/actual tables | 20/20 (ledger plus 19 contract tables) |
| PostgreSQL ENABLE + FORCE RLS | 10/10 |
| PostgreSQL real-role smoke assertions | 22/22 |
| PostgreSQL ledger outcome | `APPLIED`, body and smoke timestamps present |
| SQLite scope | one ledger table only |
| SQLite WAL / foreign keys | `wal` / `1`, including reopen |

The PostgreSQL suite covers fresh bootstrap/up, repeat no-op, immutable checksum
rejection, exact schema/table/column introspection, UUID v7 checks, composite
tenant-aware FKs, RLS and FORCE RLS, tenant isolation, Session paths and grants,
Onboarding OWNER FK, Audit append-only/reference rules, Sync/Outbox coherence,
runtime role properties, lifecycle, transactional failure, abandoned STARTED,
committed-body reconciliation, safe retry, and guarded down.

The SQLite suite covers fresh creation, exact single-table scope, WAL,
connection-scoped foreign keys, close/reopen, checksum rejection, repeat no-op,
abandoned STARTED recovery, excluded domain/commercial tables, and absence of a
down operation.

## Scope and safety scans

- No prohibited commercial table definition exists in migration 001.
- No Kysely `Migrator` or parallel Kysely history/lock table is created.
- PostgreSQL phase 0 rejects existing Kysely migration metadata before STARTED.
- No credential, token, API, JWT, payment, fiscal, or private-key secret is
  persisted or committed; `verifier`, hashes, checksums, and opaque references
  are the only approved representations.
- No application runtime or artifact outside the approved TARGET migration scope
  is modified.
- `docs/security/security-gates.md` is not modified; SEC-G01..SEC-G10 remain
  `PLANNED / NOT_EVALUATED`.
- Historical R3 and PHY-G14 evidence is not modified or regenerated.

This evidence validates only initial TARGET migration materialization. It does
not declare Fase 1 complete and does not turn TARGET into a complete executable
POS product.
