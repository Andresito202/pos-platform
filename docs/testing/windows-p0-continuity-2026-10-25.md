# Continuidad P0 Windows desde ceb10463 — 2026-10-25

Windows NT 10.0.19045 real, `C:\Proyectos\pos-platform`; rama activa
`feat/android-commercial-runtime`. HEAD inicial local/remoto
`ceb1046322387e6884c6e386822b3e0fd3e6330f`. Sólo `oracleJdk-27` sin rastrear,
conservado y excluido. PR #96 draft; sin merge ni cambios visuales/hardware.
Se continúa el candidato probado; no se repite su suite completa de 63 casos.

## Materialización

| Pieza / archivos principales | Cambio y límite |
| --- | --- |
| Service `security/authorization-trust-lifecycle.ts`, `main.ts` | Puerto interno privilegiado vinculado a instalación/dispositivo, arranque, refresh explícito, lectura viva y destrucción de custodia. Main lo instancia antes de Commercial y entrega su mapa vivo. Sin adapter confiable permanece vacío; no hay config de raíz productiva inventada ni instalación de JSON desde main/React |
| `session-trust-refresh-component.ts`, `isolated-authorization-trust-fetcher.ts`, host E2E | Reutiliza planificador SSA permitiendo resolver vivo sin mapa cacheado adicional. Conserva sus llamadores anteriores. AbortSignal cancela HTTPS y evita instalar después de cancelar. Stop invalida lecturas antes de esperar/destruir; cancela incluso durante bootstrap. Valida binding en cada lectura/refresh |
| Central `isolated-authorization-snapshot-issuer.ts` | Perfil adicional explícito DEC011_SQL_REHEARSAL, limitado por guard existente a DB temporal: reserva sobre `authorization.snapshot_sequences`, auditoría y última relectura en la transacción existente. No cambia el perfil anterior ni crea otro productor |
| `proposals/sas_sources_read_lock.{up,down}.sql` | Función sin argumentos, sólo LOCK de cuatro tablas fijas en SHARE, owner existente pos_schema_owner, search_path pg_catalog, PUBLIC revocado, EXECUTE sólo Central. Sin lectura definer, SQL dinámico, UPDATE RBAC ni bypass RLS. Caller conserva sus filtros/RLS/validaciones |
| `tools/target-migrations/src/postgres-sas-proposal.ts` | Preparación para runner con hashes de cuatro artefactos, inputs de esquema y smoke de catálogo/owner/FORCE RLS/grants/cuerpo exacto del definer. No registra MigrationDescriptor, número, predecesores aprobados, CLI ni apply productivo |
| DeviceTrust `commercial-possession-candidate.ts` | Vector versionado POS-COMMERCIAL-POSSESSION-LAB-V2: digest SHA-256 de dominio + JSON canónico que incorpora bytes V1 existentes, token hash, origen, audiencia, cliente, tenant/install/device y tipo de token. Firma Ed25519/frescura verificables. No altera V1, no publica signer genérico ni selecciona header o formato de access/refresh |

El digest V2 cabe en `DeviceIdentity.signChallenge` ya custodiado por Service.
El helper de verificación sólo acredita **firma/frescura**: no consume nonce,
no comprueba una familia refresh en PostgreSQL y no concede permisos.
La futura autoridad debe derivar su contexto del registro/DeviceTrust/token
verificados y consumir replay en el owner 012. No se monta en ningún endpoint.

El transporte administrativo para **instalar/aprobar una raíz** todavía requiere
definir su principal autorizado y operación cerrada. No se añadió a IPC una
operación capaz de aceptar raíces del renderer. El puerto implementado es una
dependencia interna de composición, no una autorización por objeto serializado.
DEC011_LAB_CANDIDATE_1 sigue fuera del bootstrap productivo. El host aislado sí
compone adapter real → HTTPS → DPAPI → lifecycle → verificador SAS → permisos.

## SQL: seguridad y coste comprobados

La función adquiere SHARE sobre roles, permissions, role_permission_grants y
user_role_assignments en orden fijo. Es incompatible con RowExclusive de los
writers ordinarios: cubre UPDATE/DELETE **e INSERT de filas nuevas**, no sólo
emisores que cooperen con un advisory lock. Se retiene hasta COMMIT/ROLLBACK,
incluyendo reserva/firma/auditoría. Revalidaciones de identidad/dispositivo y
sucursal permanecen en el emisor anterior; la lectura de asignaciones usa RLS
del caller, sin FOR SHARE que requiera UPDATE en roles/permisos/grants.

Se observaron ambas direcciones: revocación que ya posee el lock → el emisor
espera y ve RETIRED; lector dentro de su transacción → INSERT nuevo espera
hasta su commit. Replay no reserva; dos pruebas frescas reservan secuencias
distintas. Fallo de auditoría revierte contador y una prueba nueva comienza
en 1; la prueba consumida sigue quemada. Una repetición no devuelve permisos
ni un snapshot previo como si fuese una nueva autorización.

**Coste pendiente de aprobación:** SHARE es global para esas tablas y puede
retrasar escrituras de otros tenants. La prueba no mide capacidad de producción.
El timeout de lock de 5000 ms es dependencia **sólo del fixture**; no un SLA.
Deadlocks/timeout deben provocar rollback, no retry ciego del mismo nonce.
No se promete ausencia de deadlocks entre todas las transacciones posibles.
La alternativa de protocolo por scope exigiría modificar/coordinarlos **todos**
los writers canónicos; no se implementó una segunda arquitectura en paralelo.

Los tests quitan UPDATE RBAC al rol runtime durante el ensayo y restauran sólo
los privilegios anteriores de su fixture aislado. Ninguna base comercial recibe
DDL ni grants. Los dos borradores conservan guard de nombre de base desechable.
El runner existente sigue cerrado: la preparación no finge APPLIED productivo.

## Evidencia ejecutada

[Resumen de ejecución y hashes](windows-p0-evidence-2026-10-25.json), originales
en `artifacts/windows-p0/2026-10-25/`. **31 casos focalizados distintos PASS,
0 FAIL**, más **16 de arquitectura PASS**. Repeticiones de seis casos del
lifecycle no se suman al total. Las omisiones por filtro constan en el JSON.

| Ejecución | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Service: lifecycle SAS + scheduler afectado + main real/reinicio | 7 | 0 | 0 |
| Central: nuevo perfil SQL real | 6 | 0 | 169 |
| Runner: prerequisite DDL/ledger + preparación/smoke nuevos | 2 | 0 | 8 |
| DeviceTrust: vectores V2/firma/frescura/confusiones | 14 | 0 | 0 |
| HTTPS: cancelación real y preservación del store | 1 | 0 | 34 |
| Electron: custodia Service con bootstrap/lifecycle SAS | 1 | 0 | 174 |

TypeScript Service/Central/DeviceTrust/target-migrations, build Electron y
artefacto Service win32-x64 aprobados; arquitectura y política locales.
Artefacto Service: SHA-256
`45ed8edcd1c96da7b3723039de2cbd4cd41d23e718408506c659c3b92ac68466`,
1.235.248 bytes. No se instala ni despliega por construirlo.
No se repiten las suites MFA/contraseña/comercio ni contratos no modificados.
Las comprobaciones de contrato nuevas son los vectores V2 y el plan/catálogo SQL.

Comandos focalizados:

```powershell
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/authorization-trust-lifecycle.test.ts tests/session-trust-refresh-component.test.ts tests/session-bootstrap-main-runtime.test.ts --testTimeout=30000 --no-file-parallelism
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/authorization-trust-candidate.test.ts -t 'real HTTPS' --testTimeout=30000
pnpm --filter @pos-platform/device-trust exec vitest run tests/commercial-possession-candidate.test.ts
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'SAS SQL rehearsal:'
pnpm --filter @pos-platform/target-migrations exec vitest run tests/sas-sequence-proposal-physical.test.ts -t 'rolls back DDL|runner preparation'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'central SAS: Electron.*custody=true'
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-local-service build:artifact
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/central-authority --filter @pos-platform/device-trust --filter @pos-platform/target-migrations run typecheck
pnpm architecture:check
pnpm ci:repository-policy
```

PostgreSQL está en tmpfs local: sólo bases aleatorias del laboratorio. SQLite
usa directorios temporales y conserva su bloqueo de writer. La recuperación del
main real y el E2E se ejecutan por cambios directos de su composición, no como
una nueva auditoría del login. Chromium usa autenticador virtual, no una persona.
La cancelación y los nuevos límites se verifican sin relajar validadores.

## Aprobación única pendiente, en orden de ejecución

Esta tabla precisa la [solicitud única vigente](android-commercial-approval-proposal-2026-10-22.md),
sin aprobarla por esta publicación ni introducir un segundo backlog.

| Decisión necesaria | Propuesta concreta y siguiente implementación condicionada |
| --- | --- |
| SAS productivo / seguridad + custodio | Ratificar campos/firma completa y política de historial del candidato; definir formato productivo y procedimiento, no renombrar el LAB. Identificar raíz pública/huella, issuer/authority/env auténticos y mínimo de generación. Aprobar quién puede provisionar/reemplazar raíz por canal privilegiado, binding local, renovación/retención/backup/rotación de raíz y cadencia. Después implementar ese adapter y operación administrativa cerrada sobre el lifecycle probado; no aceptar roots de React |
| SQL / DB + Authorization | Aprobar o rechazar el lock global como coste de disponibilidad; owner, EXECUTE, timeout/transacciones y reintentos. Asignar número/predecesores aprobados del runner, incluir ambos artefactos/hashes/smoke y conservar down del contador sólo vacío. Después registrar descriptor y aplicación con protocolo/ledger existentes, sin UPDATE RBAC general |
| D3 / Identity + seguridad | Aprobar construcción de posesión versionada (o especificar el estándar alternativo), gramática/header, audiencia/origen y access-hash. El vector LAB no es DPoP ni wire productivo. Ratificar formato/firma del access y familia refresh en identity.session_refresh_tokens: cliente/credencial/install/device inmutables, ruta de renovación cerrada, nonce 012, rotación/auditoría/reuse-revoca-familia, credencial rotada cancela familia. No backfill inferido ni tablas paralelas. Aprobar custodia/recuperación DPAPI, logout y destrucción de referencias, absolutos/inactividad/MFA/abuso durable. Después implementar la transacción/transportes afectados; los helpers de firma no la sustituyen |
| Entorno / propietario + operador | Designar responsable de servidor/DNS/TLS/DB/custodia y entorno; aportar URL HTTPS, RP, registro Windows/callback exactos y metadata pública verificada. Usar infra/central-authority/runtime.env.example y los preflights existentes. Proveer DEV-003 auténtico y persona/membresía/grants autorizados. Secretos sólo mediante gestor/canal de despliegue, nunca chat/Git/React |
| Certificación / operador + persona real | Con el entorno y contratos aprobados: instalación del Service, enrolamiento, MFA físico, sesión BUSINESS, SSA/SAS, permisos/dashboard, renovación, revocación, offline sin gracia y logout. Ejecutar CI del HEAD exacto cuando se restablezca; PR #96 sigue draft y no se integra a main |

Inspección focalizada de infraestructura: configuración y readiness existen;
`commercial_auth` sigue NOT_ACTIVATED. No apareció un servicio Windows registrado
con nombre Camacho/PosPlatform. Eso no prueba inexistencia de una Central externa:
el entorno y su operador continúan **sin confirmar por el propietario**.
Sin esos datos no se inventan dominio, TLS, claves, activación o usuarios.
Offline: SAS/trust vencidos deniegan; reconexión exige verificación/refresh antes
de operar; ninguna gracia nueva. Android no bloquea este incremento Windows.
