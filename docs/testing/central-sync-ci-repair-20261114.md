# Central Sync: reparación de preparación CI — 2026-11-14

Base: `c1bcfdbcb997e3119301e0cbd5100b657ce75561`. Rama: `cursor/commercial-design-review-0d11`, PR #106. Árbol inicial limpio. No se modifica el POS, sus contratos ni migraciones.

## Causa reproducida y corrección

Run 43605417845: aplicaba solo 001; `seedCentralScope` y el receptor requieren `identity.device_registry`, `device_credentials` y `device_authentication_events`, creadas por 004. El descriptor 004 exige 003 y el runner comprueba checksums APPLIED de 001/002/003. No era una tabla renombrada ni un contrato obsoleto.

El workflow también conservaba `pos_app`, sin los permisos DEVICE_TRUST de `pos_platform_app`, y puertos incompatibles con las comprobaciones de aislamiento del gate. Se reutiliza `central-sync-lab-migrate.ts` existente: 001, 002, role-readiness verificado, 003 con recibo durable, 004 con smoke físico de 132 aserciones ACL. Se conservan sus restricciones: PostgreSQL loopback 55436, HTTP loopback 18787 y opt-in explícito. Sin SQL nuevo, grants adicionales, fixtures nuevos ni relajación de controles. Se elimina el token estático obsoleto; la autenticación sigue siendo Ed25519. CI retiene también el log de migraciones.

TARGET 43605417819 presentaba dos fallos independientes observados en logs:
- Linux: `SSA_PHYSICAL_ONLY_LOCALHOST_55433`; el servicio estaba en 55432. Se alinea el servicio y POSTGRES_TEST_URL con 55433, conservando el guard de la prueba.
- Windows: timeout 5000 ms en la prueba del presupuesto global de contraseñas, después de 1030 PASS y 20 SKIP. Solo esa prueba recibe 30000 ms; permanecen los 40 scrypt reales, el reloj simulado, las aserciones y el rate limit productivo.

## Resultados locales observados

Entorno Linux, Node 24.22.1, pnpm 9.15.0, PostgreSQL 16.14 compilado del tarball oficial, SHA256 `f6d077142737920858ce958ccdb75c6ee137a63b5b0853c70693d401ac7e3471`. CI usa Node 22.19.0. PostgreSQL usa btree_gist original. Clúster desechable; se detuvo al terminar.

| Comando / control | Resultado |
| --- | --- |
| `pnpm --filter @pos-platform/target-migrations typecheck` | PASS |
| `pnpm --filter @pos-platform/target-migrations test:descriptor:004` | 3 PASS |
| `pnpm --filter @pos-platform/target-migrations test -- tests/postgres-003-descriptor.test.ts tests/postgres-003-artifact.test.ts` | 52 PASS |
| `pnpm --filter @pos-platform/device-trust test` | 37 PASS |
| `pnpm --filter @pos-platform/pos-local-service test -- src/security/local-operator-password-gate.test.ts` | 2 PASS |
| `POSTGRES_TEST_URL=postgres://postgres@127.0.0.1:55433/postgres pnpm --filter @pos-platform/database-postgres test` | 126 PASS, 0 SKIP |
| Migraciones 001–004, readiness y smoke ACL | PASS |
| Central Sync gate completo contra PostgreSQL 16.14 | VERIFIED, exit 0 |
| `pnpm ci:repository-policy` | PASS, 1496 archivos rastreados antes de añadir evidencia |
| `node --test tools/architecture/validate-boundaries.test.mjs` | 16 PASS |
| `node tools/architecture/validate-boundaries.mjs` | ARCH-003 PASS |
| `git diff --check` | PASS |

Se invocó pnpm mediante `corepack pnpm`. Los scripts CLI tsx no pudieron arrancar localmente por EPERM al crear su socket IPC Unix. Para ejecutar exactamente los mismos entrypoints sin modificar sus fuentes se usó `pnpm --filter @pos-platform/target-migrations exec node --import tsx src/<entrypoint>.ts`. El PostgreSQL local también usa solo TCP (`unix_socket_directories=''`). Todos los procesos de la integración se ejecutaron dentro de una misma invocación por el aislamiento de red del entorno. No se atribuye PASS local a los wrappers tsx; CI comprobará esos comandos originales.

Fallos intermedios de preparación local: PostgreSQL inicialmente sin contrib btree_gist (se compiló e instaló la extensión oficial); primera integración ampliada rechazó HTTP 8787 con `ISOLATED_SQLITE_GATE_LOOPBACK_ONLY`. Se alineó el workflow con 18787, sin alterar ese guard. La ejecución posterior terminó VERIFIED.

## Reproducción CI

Usar el workflow modificado con su contenedor PostgreSQL 16.14 vacío. Variables:

```sh
export POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:55436/postgres
export POSTGRES_TEST_URL=$POSTGRES_ADMIN_URL
export DATABASE_URL=postgres://pos_platform_app@127.0.0.1:55436/postgres
export CAMACHO_ISOLATED_SYNC_LAB=YES
export CENTRAL_SYNC_BASE_URL=http://127.0.0.1:18787
export CENTRAL_SYNC_BIND_HOST=127.0.0.1
export PORT=18787
export REPOSITORY_COMMIT=$(git rev-parse HEAD)
pnpm --filter @pos-platform/target-migrations exec tsx src/central-sync-lab-migrate.ts
pnpm --filter @pos-platform/target-migrations central-sync:start
# En otra consola del mismo entorno y con esas variables:
pnpm --filter @pos-platform/target-migrations central-sync:gate
```

## Estado remoto inicial y límites

En c1bcfdb: Central Sync FAIL y TARGET FAIL. CodeQL, Strix, D-3 Live Security E2E y G1.2 Live Session Bootstrap: success según API de Actions. No atribuir su éxito al nuevo commit; consultar sus propios runs tras publicar.

La evidencia adjunta reproduce el gate real y la suite PostgreSQL. No certifica Central productivo, login BUSINESS, SCM Windows, hardware ni las controversias 1–6. PR permanece Draft; sin merge ni rama nueva. Prompt 2 puede partir de esta corrección tras contrastar el gate remoto, conservando esos pendientes. Los resultados remotos finales se informarán con el SHA y sus URLs, sin inferirlos de esta ejecución local.
