# TARGET migration 001 harness

Harness mínimo y aislado para materializar y verificar `001_central_foundation` y `001_local_migration_control`.

- `platform.target_migration_executions` es la única autoridad de history.
- Kysely se usa solo para conexión, ejecución SQL y transacciones.
- No se usa `Migrator` ni metadata Kysely.
- PostgreSQL de prueba usa `postgres:16.14` en `127.0.0.1:55432` y almacenamiento efímero.
- SQLite crea únicamente el ledger local y verifica WAL/foreign keys tras reopen.

Ejecución reproducible desde la raíz:

```powershell
pnpm install --frozen-lockfile
docker compose -f tools/target-migrations/compose.yaml up -d --wait
pnpm typecheck
pnpm test:migrations
docker compose -f tools/target-migrations/compose.yaml down
```

Las pruebas no modifican LEGACY ni la evidencia histórica de R3/PHY-G14.

## Contrato documental para la evolución 002

El código actual continúa implementando únicamente migration 001. La futura materialización 002 deberá evolucionarlo mediante descriptors por migration, sin modificar los bytes SQL ni la semántica pública de 001:

- descriptor: migration ID, dependencies, manifest version, up/down artifacts, checksum derivado, schemas/tables/policies/constraints/indexes owned, required extensions y expected ledger state;
- validators scoped: 001 valida solo ownership 001 y 002 solo ownership 002; ninguna consulta global de `pg_policies` u otro catálogo se compara contra la lista de una sola migration;
- ledger: 002 exige 001 APPLIED; checksum mismatch falla cerrado; STARTED/body committed se recupera por introspección exacta;
- lock: advisory lock PostgreSQL global, no mutex de proceso ni lock independiente por migration;
- down dependencies: down 001 se rechaza con 002 STARTED incompatible/APPLIED; una futura 003 bloqueará down 002;
- `btree_gist`: dependencia compartida introspectada o instalada por bootstrap administrativo antes del body; runtime nunca instala y down 002 nunca elimina;
- SQLite: no descriptor, artifact ni ledger entry 002.

Cuando se autorice código deberán extenderse `shared.ts`, `contract.ts`, `postgres.ts`, `postgres-introspection.ts`, `postgres-smoke.ts`, `tests/postgres-migration.test.ts`, `index.ts`, CLI y evidence. Hasta entonces `applyPostgres001`, `downPostgres001` y `validatePostgresCatalog` conservan exactamente su comportamiento materializado; este README no declara soporte 002 implementado.
