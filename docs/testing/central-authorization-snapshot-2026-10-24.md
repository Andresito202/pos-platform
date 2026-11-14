# Productor central SAS y recepción Windows — laboratorio aislado

Continuidad desde `09a370bcee8a16a24e15f205603fc9d5bad30cbd`, local/remoto
comprobados en `feat/android-commercial-runtime`, PR #96 draft. El HEAD de la
orden de reanudación (`b971e294`) ya había sido superado por el binding publicado.
Se conserva y termina el delta SAS existente; no se reconstruyen contraseña,
MFA, BUSINESS, callback, DeviceProof, reserva SSA ni canal Windows. El directorio
concurrente `docs/product/oracleJdk-27/` permanece intacto y fuera del commit.

## Implementación y límites

`IsolatedAuthorizationSnapshotIssuer` lee las tablas canónicas de PostgreSQL
`authorization.user_role_assignments`, `roles`, `role_permission_grants` y
`permissions`. Revalida access, BUSINESS, usuario, membresía, empresa, sucursal,
dispositivo y credencial. Exige DeviceProof fresca para la ruta exacta
`/v1/business-session/authorization`, usando el ledger 012 existente. El contexto
de sucursal procede de configuración confiable del host, validada en Central;
no del cuerpo de React ni de una suposición sobre DeviceRegistry.

Preserva asignaciones revocadas, roles retirados y permisos retirados; sin roles
produce una proyección vacía. El contrato DEC-011 admite una asignación por scope:
dos roles en el mismo scope se rechazan con
`SAS_ROLE_COMPOSITION_DECISION_REQUIRED`; varias versiones de un grant con el
mismo código se rechazan con `SAS_GRANT_VERSION_DECISION_REQUIRED`. No hay unión
silenciosa de roles ni selección arbitraria de versiones.

La transacción usa locks de elegibilidad y RBAC, serializa publicaciones por
usuario/instalación/dispositivo, reserva secuencia durable y audita
`AUTHORIZATION_SNAPSHOT_ISSUED`. Verifica de nuevo el checksum de fuentes antes
del commit. Fallos de auditoría o cambio de fuentes revierten contador y evento;
el nonce consumido por su owner no se restaura. La firma Ed25519 usa canonical
JSON y autoridad separada `AUTHORIZATION_SNAPSHOT`, con propósito, entorno,
estado ACTIVE, ventana y pareja de claves verificados.

La vigencia es dependencia explícita: el fixture usa 30 s y se acota por access,
BUSINESS, credencial, clave y próxima transición de asignación/grant. No es un
valor productivo aprobado. La revocación llega mediante una secuencia mayor;
sin comunicación, la exposición queda limitada al vencimiento del SAS anterior,
sin gracia offline, conforme a DEC-011. No se promete revocación instantánea offline.

**Sólo laboratorio:** el constructor exige conexión local aislada y cada emisión
comprueba el nombre aleatorio de la DB temporal antes de consumir la proof.
`authorization.snapshot_sequence_validation` existe únicamente en el fixture;
no es una migración productiva ni otro RBAC. Los privilegios UPDATE requeridos
por `FOR SHARE` en roles/permisos/grants se conceden sólo en esa DB desechable.
Su diseño productivo requiere revisión de owner/migración/privilegios.

Local Service reutiliza `SnapshotProvider`, adquisición, verificador y store
canónicos. El adaptador HTTPS exige NODE_ENV=test, loopback, CA explícita, TLS,
respuesta estricta y límites; no abre un endpoint productivo. El componente
reverifica la firma SAS, binding, reloj y estado/ventana de clave en cada uso.
Las claves SSA no conceden confianza SAS; sin provisión separada falla cerrado.
El runtime productivo aún no aprovisiona esa confianza ni instancia este proveedor.

## Recorrido observado

PostgreSQL 16.14 temporal en tmpfs `127.0.0.1:55433`, Electron Windows real,
Chromium con autenticador virtual CTAP2 y claves efímeras de laboratorio:

1. Main firma solicitud nativa → HTTPS → contraseña y WebAuthn → BUSINESS.
2. Confirmación de destino → callback loopback real → canje PKCE/DeviceProof.
3. Access verificado → DeviceProof → reserva 011/012 → SSA firmada ACTIVE.
4. Service solicita SAS por HTTPS; Central deriva sólo `AUDIT_EVENT_READ` de
   un rol/grant explícito del fixture en las tablas canónicas.
5. Recepción/verificación/persistencia SAS → capabilities → dashboard real.
   La consulta de auditoría responde FOUND; catálogo responde UNAUTHORIZED.
   No se conceden ventas, inventario ni métricas agregadas por entrar al dashboard.
6. Se revoca la asignación central y se adquiere secuencia 2: permisos vacíos,
   auditoría UNAUTHORIZED y renderer recargado muestra acceso denegado.

El handoff main→Service de credenciales usa el pipe/Node IPC privado del driver
de integración. No es un canal productivo nuevo ni expone secretos al preload o
React. El firmante efímero de main no sustituye enrolamiento/custodia reales.
No se autenticó un empleado humano ni se habilitó producción.

## Resultados y reproducción

Ejecuciones observadas el 23–24 de octubre; rutas de artefactos conservan la
fecha inicial del incremento `artifacts/auth-sas/2026-10-23/`:

| Validación | Resultado final |
| --- | --- |
| PostgreSQL + Electron, filtro `central SAS:` | 22 PASS, 0 FAIL, 145 omitidas por filtro |
| Recepción SAS, canal comercial, IPC y adquisición, secuencial | 95 PASS, 0 FAIL |
| Verificador SAS, archivo correcto `authorization-snapshot.test.ts` | 31 PASS, 0 FAIL |
| TypeScript contracts, database-postgres, Central, Local Service y desktop/renderer | exit 0 |
| Build completo Electron | exit 0 |
| Fronteras ARCH-003 y pruebas de su validador | PASS; 16/16 |
| Política del repositorio, incluyendo los archivos nuevos preparados | PASS; 1003 archivos rastreados |

Los 126 casos locales son 15 nuevos de recepción y 111 regresiones directamente
afectadas por la verificación/inyector de confianza. No se repitieron suites de
contraseña, MFA ni las suites comerciales ajenas al cambio.

Fallos conservados: DDL inicial sin comillas en `authorization` impidió arrancar
la suite; índices opcionales TypeScript se corrigieron. Reintento: 19 PASS y
1 FAIL por fixture que duplicaba una asignación del mismo rol contra un índice
único. Se corrigió usando dos roles diferentes, sin relajar el índice. Final:
22/22. Primera ejecución local ampliada: 124 PASS y 2 FAIL, ambos con diagnóstico
`STACK_TRACE_ERROR`; no se atribuye una causa no demostrada. Los dos casos pasan
focalizados (2 PASS/59 omitidos) y todos sus archivos pasan secuencialmente.
El primer comando secuencial escribió un nombre inexistente para el verificador;
por eso ejecutó 95 casos, complementados con los 31 del archivo correcto.

Preparar únicamente el PostgreSQL tmpfs y roles del procedimiento del
[binding nativo](native-business-binding-2026-10-23.md); nunca otra base. El fixture
crea y elimina su DB aleatoria, sin credenciales comerciales. Desde la raíz:

```powershell
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild src/native-business-login.ts --bundle --platform=node --format=esm --outfile=dist/native-browser-login-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild ../../packages/device-trust/src/request-proof.ts --bundle --platform=node --format=esm --outfile=dist/device-proof-lab-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/ssa-native-transport.ts --bundle --platform=node --format=esm --outfile=dist/ssa-native-transport-probe.mjs
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\auth-sas\2026-10-23\final'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'central SAS:' --reporter=json --outputFile='C:\Proyectos\pos-platform\artifacts\auth-sas\2026-10-23\central-sas-final-tests.json'
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/central-sas-reception.test.ts tests/commercial-ipc.test.ts tests/channel-commercial-vertical.test.ts tests/snapshot-acquisition.test.ts --no-file-parallelism
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/authorization-snapshot.test.ts
pnpm --filter @pos-platform/contracts --filter @pos-platform/database-postgres --filter @pos-platform/central-authority --filter @pos-platform/pos-local-service --filter @pos-platform/pos-desktop run typecheck
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
pnpm ci:repository-policy
```

Informes JSON, observaciones sin secretos y capturas dashboard/revocación quedan
en la ruta local anterior. Resumen y hashes publicados:
[evidencia de ejecución](central-authorization-snapshot-evidence-2026-10-24.json).

## Siguiente eslabón y decisiones pendientes

El productor SAS ya existe y el recorrido completo alcanza dashboard **en el
host aislado**. Siguen fuera del runtime productivo la provisión de confianza SAS,
proveedor HTTPS y entrega nativa desde custodia real. No es correcto volver a
describir el productor como inexistente ni el login humano como terminado.

La [única propuesta de aprobación](android-commercial-approval-proposal-2026-10-22.md)
consolida: despliegue HTTPS/RP/cliente y operador reales; DEV-003 con binding de
sucursal y claves verificadas; acceso/refresh, tiempos y abuso; custodia nativa
Windows; perfil y distribución de confianza SAS, secuencia durable y privilegios;
composición de roles/versiones cuando haya ambigüedad. SEC-004/DEC-025 siguen
siendo dependencias exclusivas de Android, sin bloquear este laboratorio Windows.
Después de aprobar/provisionar, conectar los adapters existentes a esa custodia y
al runtime, y repetir el recorrido con un empleado autorizado real. No usar
fixtures ni grants artificiales para esa validación.
