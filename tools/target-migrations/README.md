# TARGET migration harness

Harness aislado para materializar y verificar `001_central_foundation`, `001_local_migration_control` y `002_external_integrations_foundation`.

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

## Migration 002

Migration 002 está implementada mediante descriptors por migration, sin modificar los bytes SQL ni la semántica pública de 001:

- descriptor: migration ID, dependencies, manifest version, up/down artifacts, checksum derivado, schemas/tables/policies/constraints/indexes owned, required extensions y expected ledger state;
- validators scoped: 001 valida solo ownership 001 y 002 solo ownership 002; ninguna consulta global de `pg_policies` u otro catálogo se compara contra la lista de una sola migration;
- ledger: 002 exige 001 APPLIED; checksum mismatch falla cerrado; STARTED/body committed se recupera por introspección exacta;
- lock: advisory lock PostgreSQL global, no mutex de proceso ni lock independiente por migration;
- down dependencies: down 001 se rechaza con 002 STARTED incompatible/APPLIED; una futura 003 bloqueará down 002;
- `btree_gist`: dependencia compartida introspectada o instalada por bootstrap administrativo antes del body; runtime nunca instala y down 002 nunca elimina;
- SQLite: no descriptor, artifact ni ledger entry 002;
- API: `applyPostgres002`, `downPostgres002` y `validatePostgres002Catalog`;
- artifacts: `sql/postgres/002_external_integrations_foundation.{up,down}.sql`;
- tests: `postgres-002-migration.test.ts`, además de la suite 001 inmutable.

`btree_gist` se introspecta bajo el lock global antes de crear el schema 002; si falta se instala con `SET LOCAL ROLE pos_schema_owner`, siempre que el servicio lo permita. Down 002 conserva la extensión. Los validators 001/002 inspeccionan únicamente su ownership y los wrappers públicos 001 permanecen compatibles.
