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

## Candidate MAT-003-PREFLIGHT

`src/postgres-003-preflight.ts` materializa el preflight histórico aprobado como inspección explícita sobre 001+002, sin descriptor ni SQL 003. Reutiliza checksums, ledger y `validatePostgres002Catalog` del harness en la misma conexión y transacción. Toda la evaluación ocurre en una única transacción `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`; verifica ambos settings en runtime y siempre termina con `ROLLBACK`, incluso para `PASS` y `BLOCKED`.

Comando desde la raíz:

```powershell
pnpm preflight:migration:003
```

`POSTGRES_PREFLIGHT_URL` es obligatorio, explícito y no tiene valor predeterminado. Un valor ausente, vacío o malformado produce `FAIL`/exit `1` antes de intentar conexión; la URL y sus credenciales nunca se imprimen. El rol de la URL debe ser `LOGIN NOSUPERUSER BYPASSRLS`, tener `USAGE` en `platform` e `integrations` y `SELECT` únicamente sobre las columnas consumidas del ledger, ExternalIntegration, capability, dispatch, attempt, mapping y ownership. El catálogo se valida por `pg_catalog` contra los artifacts/descriptors aprobados, sin ampliar lectura de datos sensibles. La implementación solo valida este contrato: nunca crea/altera roles, concede privilegios, usa `SET ROLE` ni desactiva RLS. `pos_platform_admin` permanece `NOT_READY` mientras falten esos permisos operacionales.

Inmediatamente después de `BEGIN`, como primer statement de base de datos, el preflight intenta sin espera `pg_try_advisory_xact_lock(hashtextextended('pos-platform:target-migrations:global:v1',0))`; solo tras adquirirlo valida transacción, rol, privilegios, predecessors y catálogo. Es el mismo lock global del harness y serializa únicamente ejecutores que participan en ese protocolo; no pretende bloquear escrituras arbitrarias de aplicaciones. El snapshot estable `REPEATABLE READ` se establece al entrar en la sección protegida y cubre todas las lecturas posteriores. La liberación ocurre automáticamente con el `ROLLBACK`.

La matriz final contiene cinco blockers: capability `DEBIT_NOTES`, dispatch `NON_FISCAL/DEBIT_NOTES`, attempt por FK discriminada, mapping por igualdad completa de `tenant_id/company_id/integration_id/resource_type/internal_entity_type/internal_entity_id` y ownership exclusivamente por `IntegrationCapability.ownership_policy_id` en el mismo scope. `MAT003_AFFECTED_SCOPE_INTEGRITY` es la sexta comprobación y una condición de confianza: un count no cero produce `FAIL`, no `BLOCKED`. Declaraciones y configuraciones globales de provider están fuera; no se inspeccionan nombres ni JSON para inferir historia.

La salida es JSON determinista con `preflight_id`, versión, estado del predecessor y cada `check_id/count/status`, más evidencia limitada a 100 IDs/scopes ordenados; el count siempre es completo y `evidence_truncated` indica truncamiento. Exit codes: `0=PASS`, `2=BLOCKED`, `1=FAIL`. `pnpm` puede añadir texto de lifecycle alrededor de stdout; consumidores que necesiten JSON puro deben invocar el CLI subyacente.

Pruebas dedicadas:

```powershell
pnpm --filter @pos-platform/target-migrations test:preflight:003
```

Esta materialización es candidata a revisión independiente. No ejecuta por sí sola el gate de gobernanza, no reconcilia datos, no crea objetos 003 y no cambia el estado vigente `MAT-003-PREFLIGHT = BLOCKED / NOT EXECUTED`.
