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

`POSTGRES_PREFLIGHT_URL` es obligatorio, explícito y no tiene valor predeterminado. Un valor ausente, vacío o malformado produce `FAIL`/exit `1` antes de intentar conexión; la URL y sus credenciales nunca se imprimen. El rol de la URL debe ser `LOGIN NOSUPERUSER BYPASSRLS`, tener `USAGE` en `platform` e `integrations` y `SELECT` únicamente sobre las columnas consumidas del ledger, ExternalIntegration, capability, dispatch, attempt, mapping y ownership. El catálogo se valida por `pg_catalog` contra los artifacts/descriptors aprobados, sin ampliar lectura de datos sensibles. La implementación solo valida este contrato: nunca crea/altera roles, concede privilegios, usa `SET ROLE` ni desactiva RLS. En `local-canonical-integration`, `pos_platform_admin` quedó `READY` mediante el lifecycle separado de role readiness; otros targets deben demostrar su propio estado explícitamente.

Inmediatamente después de `BEGIN`, como primer statement de base de datos, el preflight intenta sin espera `pg_try_advisory_xact_lock(hashtextextended('pos-platform:target-migrations:global:v1',0))`; solo tras adquirirlo valida transacción, rol, privilegios, predecessors y catálogo. Es el mismo lock global del harness y serializa únicamente ejecutores que participan en ese protocolo; no pretende bloquear escrituras arbitrarias de aplicaciones. El snapshot estable `REPEATABLE READ` se establece al entrar en la sección protegida y cubre todas las lecturas posteriores. La liberación ocurre automáticamente con el `ROLLBACK`.

La matriz final contiene cinco blockers: capability `DEBIT_NOTES`, dispatch `NON_FISCAL/DEBIT_NOTES`, attempt por FK discriminada, mapping por igualdad completa de `tenant_id/company_id/integration_id/resource_type/internal_entity_type/internal_entity_id` y ownership exclusivamente por `IntegrationCapability.ownership_policy_id` en el mismo scope. `MAT003_AFFECTED_SCOPE_INTEGRITY` es la sexta comprobación y una condición de confianza: un count no cero produce `FAIL`, no `BLOCKED`. Declaraciones y configuraciones globales de provider están fuera; no se inspeccionan nombres ni JSON para inferir historia.

La salida es JSON determinista con `preflight_id`, versión, estado del predecessor y cada `check_id/count/status`, más evidencia limitada a 100 IDs/scopes ordenados; el count siempre es completo y `evidence_truncated` indica truncamiento. Exit codes: `0=PASS`, `2=BLOCKED`, `1=FAIL`. `pnpm` puede añadir texto de lifecycle alrededor de stdout; consumidores que necesiten JSON puro deben invocar el CLI subyacente.

Pruebas dedicadas:

```powershell
pnpm --filter @pos-platform/target-migrations test:preflight:003
```

Esta materialización no ejecuta por sí sola el gate de gobernanza, no reconcilia datos ni crea objetos 003. Su tooling está materializado/revisado; de forma separada, la ejecución canónica y su revisión independiente en `local-canonical-integration` cerraron `PASS`, por lo que `MAT-003-PREFLIGHT = EXECUTED / PASS / REVIEWED`. SQL/descriptor 003 permanecen ausentes.

## MAT-003 preflight canonical-role readiness

El mecanismo operacional concede exclusivamente `USAGE` sobre `platform` y `SELECT (migration_id, status, checksum)` sobre `platform.target_migration_executions` a `pos_platform_admin`. Usa una sesión explícita `pos_migrator`, `SET LOCAL ROLE pos_schema_owner` dentro de la transacción y el lock global `pos-platform:target-migrations:global:v1`. No crea SQL ni descriptor 003 y no ejecuta el preflight canónico.

Comandos disponibles:

```powershell
pnpm role-readiness:migration:003:check
pnpm role-readiness:migration:003:apply
pnpm role-readiness:migration:003:revert
```

Todos exigen `POSTGRES_ROLE_READINESS_PROVISIONING_URL`, `POSTGRES_ROLE_READINESS_VERIFICATION_URL`, `POSTGRES_ROLE_READINESS_ENVIRONMENT_ID`, `POSTGRES_ROLE_READINESS_EXPECTED_DATABASE` y `ROLE_READINESS_REPOSITORY_COMMIT`. `apply` exige además `ROLE_READINESS_RECEIPT_OUTPUT_PATH`; `revert` exige `ROLE_READINESS_RECEIPT_PATH`. No hay rutas predeterminadas, búsqueda de “último recibo” ni reutilización de la credencial de provisioning como prueba del rol de ejecución.

El recibo JSON de lifecycle v1 solo se emite para `MISSING -> APPLY -> READY`. Se publica mediante creación exclusiva (`open(..., "wx")`), escritura completa, `fsync` y cierre; un destino existente nunca se sobrescribe. Esta estrategia es deliberadamente fail-closed y no afirma atomicidad portable. Un archivo parcial o corrupto falla el parseo/contrato/hash estricto. SHA-256 prueba integridad determinista del contenido bajo custodia confiable, no autoría ni firma criptográfica.

La custodia posterior corresponde al operador, job de despliegue o sistema de artifacts. Debe conservarse mientras el delta permanezca activo o pueda requerirse reversión automática. Si el commit de base de datos termina pero falla la verificación/publicación del recibo, el resultado es `APPLIED_WITHOUT_DURABLE_RECEIPT`: los grants permanecen, no hay compensación ni reconstrucción, y la reversión automática queda inhabilitada hasta revisión manual. Un recibo perdido tiene el mismo efecto.

El artifact `down.sql` es únicamente la inversa formal versionada y hasheada. No es un comando operacional soportado; solo lo ejecuta `revert` después de `VALID_FOR_REVERSAL`, con recibo explícito, contrato/artifacts compatibles y estado actual exacto. La ejecución canónica posterior del preflight fue exclusivamente read-only y no utilizó este artifact.

La revisión final corrigió el contrato operacional de `check`: `MISSING` y `READY` son diagnósticos exitosos; `PARTIAL` produce `FAIL/PARTIAL_STATE` y `UNEXPECTED` produce `FAIL/UNEXPECTED_STATE`. El postcheck mediante conexión fresca acepta únicamente el `READY` esperado después de apply o el `MISSING` esperado después de revert; cualquier estado diferente falla cerrado. La materialización/revisión del tooling están en `PASS`; adicionalmente, la aplicación y revisión independiente en `local-canonical-integration` están `PASS`, por lo que canonical-role readiness queda `APPLIED / REVIEWED`. El preflight canónico y su revisión posterior también cerraron `PASS`, con cinco blockers y trust invariant en count `0`, cero mutaciones durables y un LOW conocido/no bloqueante en el orden diagnóstico.
