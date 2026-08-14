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
