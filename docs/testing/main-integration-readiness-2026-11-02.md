# Candidato de integración a main — 2026-11-02

## Decisión

**NO-GO para fusionar ahora.** PR #99 continúa Draft. No se ejecutaron Actions, merges, cambios de base de PR ni operaciones administrativas en Windows 10. La ampliación de seguridad se trabaja después de este incremento; esta evaluación no la sustituye.

Candidato de c?digo publicado: `0b5cf5b93178bf43399e089e74ec3b49c2f3b96f`.

El punto de partida fue `a0fbd42ba960f5f04fed965428c0df8b945af7a2`. Los resultados distinguen expresamente ejecución automatizada en el host interactivo, infraestructura PostgreSQL y ejecución SCM entre identidades. No hay certificación humana ni productiva.

## Historia y ruta recomendada

Refs actualizadas mediante fetch y comparadas sin cambiar de rama:

| Línea | SHA | Relación verificada |
|---|---|---|
| main | `591ad4c19df9c8e36f451e9c243dda8b47dc7e51` | Ancestro de Android y P0 |
| Android / PR #96 | `913ea8cc6b24dfcd672f4f794e74b48ce3731c93` | 869 commits sobre main; 746 archivos, +53519/-1707 |
| P0 / PR #99 inicial | `a0fbd42ba960f5f04fed965428c0df8b945af7a2` | 254 sobre Android; 140 archivos, +23641/-203 |
| P0 respecto a main | mismo SHA | 1123 commits; 861 archivos, +77111/-1861 |

Las tres líneas no tienen divergencia en estas comparaciones. PR #99 apunta a Android; PR #96 apunta a la predecesora de laboratorio de PR #92; las cuatro PR #92/#93/#96/#99 siguen abiertas y Draft. Los conteos anteriores son de la fotografía inicial, no del candidato posterior.

**Recomendación:** revisión por componentes y una integración conjunta de la cadena existente, mediante PR #99 eventualmente dirigida a main, sólo después de resolver los gates y con autorización del propietario. No retargetear ni fusionar en esta sesión. Evita integrar primero estados históricos sin su endurecimiento posterior y repetir tres ciclos completos de validación. Preserva todos los commits; no hacer cherry-pick masivo ni implementar otra línea. Si se prefieren bloques, conservar la cadena #92 → #96 → #99 y validar cada HEAD exacto; no aprobar por herencia los estados intermedios.

PR #93 no debe fusionarse completa: el handler y el contrato de evento FACTUS Pay actuales son idénticos a sus equivalentes de esa PR, mientras el repositorio PostgreSQL y la migración evolucionaron. Su antigua `009_factus_pay_webhook_inbox` corresponde hoy a `018_factus_pay_webhook_inbox`, registrada por `tools/target-migrations/src/postgres-commercial-runner.ts`; la 009 actual pertenece a WebAuthn. Una fusión histórica completa reintroduciría el conflicto. La evidencia compara contenido, no supone equivalencia por nombres de commits.

## Correcciones mínimas del candidato

| Archivo | Defecto observado / corrección |
|---|---|
| `packages/local-channel/src/index.ts` | TS2724: el operador importa recuperación DPAPI pública ya implementada pero no exportada. Se exporta `recoverWindowsHandoffReceiverPublic`; no entrega claves privadas ni agrega operaciones de firma. |
| `packages/local-channel/tests/windows-handoff.test.ts` | La prueba usa ahora el export público para impedir regresión del montaje. |
| `packages/contracts/tests/permission-codes.test.ts` | Inventario anterior omitía el permiso GLOBAL existente `LICENSE_PLAN_MANAGE`. |
| `apps/pos-local-service/tests/permission-catalog.test.ts` | Se conserva la separación GLOBAL/POS y se prueba explícitamente que administración GLOBAL no sea permiso POS local. No se alteraron roles ni grants. |
| `packages/database-sqlite/tests/user-audit-migration.test.ts` | Fixture reconstruido como v7 conservaba tres tablas v18 y hacía fallar ocho casos. Sólo se corrige la base temporal de la prueba; no las migraciones ni bases operativas. |
| `apps/pos-desktop/tests/ipc-allowlist.test.ts`, `preload-api.test.ts` | Inventarios desactualizados omitían la operación existente `license.offers.list`. No se amplía la superficie productiva. |
| `apps/pos-desktop/tests/renderer/App.test.tsx` | El doble de Service carecía de esa operación; disparaba correctamente la denegación del canal y desmontaba el shell. Se completa el doble sin precios ni permisos fabricados para producto. |
| `tools/ci/session-trust-anchor.test.mjs` | El test textual fallaba con CRLF Windows. Se normalizan saltos sólo en la aserción; PEM, DER, fingerprint y raíz conservados. |
| `apps/pos-desktop/e2e/boot.spec.ts`, `real-channel.spec.ts` | El arnés heredaba `ELECTRON_RUN_AS_NODE=1` y dos expectativas precedían a la denegación canónica sin sesión. Se filtra esa variable sólo al lanzar Electron; Windows deja de recibir `--no-sandbox`. Se comprueba la denegación actual antes de activar la SSA del arnés y ejecutar ventas. No cambia producto ni autorización. |

## Ejecuciones locales y límites

Node 22.19.0, pnpm 9.15.0, Windows 10 interactivo sin elevación. Los comandos se ejecutaron mediante Corepack instalado, sin instalar dependencias. Se retiraron del entorno de los hijos las variables operativas de Central, proveedores y POS para no activar opt-ins o credenciales reales.

Selección inicial: Vitest serial (`exec vitest run <archivos> --no-file-parallelism --maxWorkers=1 --reporter=json`), por cada paquete de la tabla. Se excluyeron **26 archivos** con dependencias directas de PostgreSQL; listado exacto en el recibo. Además hubo 18 casos pending en las suites seleccionadas. No se cuentan como PASS.

| Paquete | PASS inicial | FAIL inicial | Pending |
|---|---:|---:|---:|
| contracts | 297 | 1 | 0 |
| domain | 47 | 0 | 0 |
| application | 16 | 0 | 0 |
| database-sqlite | 50 | 8 | 0 |
| observability | 4 | 0 | 0 |
| device-trust | 37 | 0 | 0 |
| local-channel | 50 | 0 | 1 |
| database-postgres, unitarias/repositorios | 96 | 0 | 0 |
| fiscal-adapters, sin proveedor auténtico | 173 | 0 | 2 |
| central-authority, sin PostgreSQL | 183 | 0 | 0 |
| pos-local-service | 957 | 1 | 15 |
| pos-desktop | 246 | 3 | 0 |
| target-migrations, selección sin PostgreSQL | 102 | 0 | 0 |
| **Total inicial, casos únicos de esa ejecución** | **2258** | **13** | **18** |

Se conservaron los fallos iniciales. Después de las correcciones se repitieron únicamente los archivos afectados:

| Comando focalizado (prefijo `pnpm --filter <paquete> exec vitest run`) | Resultado |
|---|---|
| contracts: `tests/permission-codes.test.ts` | 2 PASS |
| database-sqlite: `tests/user-audit-migration.test.ts` | 26 PASS |
| pos-local-service: `tests/permission-catalog.test.ts` | 3 PASS, incluye una nueva negativa |
| pos-desktop: `tests/ipc-allowlist.test.ts tests/preload-api.test.ts tests/renderer/App.test.tsx` | 36 PASS |
| local-channel: `tests/windows-handoff.test.ts` | 24 PASS; DPAPI de la identidad interactiva, no entre cuentas SCM |
| `node --test tools/ci/session-trust-anchor.test.mjs` | 1 PASS |

Estas repeticiones **no se suman** al total inicial. Los otros tests Node de SARIF, Android LAB y operadores SCM habían dado 27 PASS y un fallo del ancla; se corrigió y repitió sólo ese fallo. Los tests Android son fixtures criptográficos, no hardware.

`pnpm --recursive --workspace-concurrency=1 --if-present run typecheck`: FAIL inicial por el export; **PASS final**. Desktop `build`, Service `build:artifact`, `pnpm architecture:check`, `pnpm ci:repository-policy` y `pnpm ci:supply-chain-tests`: PASS. Builds, arquitectura y política repetidos después del cambio de export: PASS. No se modificaron lockfile, raíces, `oracleJdk-27/`, módulos comerciales ni diseño.

Electron real: primera ejecución **5 PASS / 2 FAIL / 7 omitidas**; los dos arranques fallaron porque esta consola hereda `ELECTRON_RUN_AS_NODE=1`. Al retirarla sólo del hijo, los dos archivos revelaron expectativas antiguas: **4 PASS / 5 FAIL**, incluidos tres fallos derivados porque no había ocurrido la activación previa. Se corrigieron los tests según la denegación canónica vigente. Ejecución final `pnpm --filter @pos-platform/pos-desktop exec playwright test --config e2e/playwright.config.ts boot.spec.ts real-channel.spec.ts --retries=0 --reporter=json`: **9 PASS / 0 FAIL / 0 SKIP**, 12.22 segundos, sin `--no-sandbox` en Windows y con la variable problemática todavía heredada por el runner para verificar el filtro. Los cinco PASS originales de los otros archivos no se repitieron. TypeScript Desktop volvió a pasar después de estas correcciones del arnés.

Se observaron arranque compilado, aislamiento renderer, named pipe autenticado, SQLite temporal, ventas/cierre/transferencia/catálogo y rechazo fiscal según el arnés. Usa SSA y permisos de prueba ya existentes y proveedor fiscal fake: **no acredita una identidad comercial, SCM, MFA humano, pago bancario ni FACTUS**. Los resultados fallidos se conservan; no se suman las repeticiones.

## Bloqueos físicos y de infraestructura

`Get-VM -Name CamachoPOS-SCM-Lab` devolvió **Access denied** desde esta consola del host. Sin PSSession, no se ejecutaron SCM, ACL operativas, enrolamiento, manifiestos ni Node/Electron entre SERVICE y DESKTOP en la VM. No se alteró Hyper-V ni seguridad del host. El bloqueo `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` permanece intacto.

Docker no dispone de daemon accesible. Se encontró PostgreSQL nativo **16.11**, incompatible con el **16.14** que exigen los gates canónicos; no se sustituyó la versión ni se conectaron bases persistentes. No había listener en 55432/55433/55435 al sondeo TCP; 55435 reservado permanece sin uso. Las integraciones PostgreSQL, RLS y concurrencia que lo necesitan están **BLOCKED**, no aprobadas por tests de repositorios.

La única invocación consolidada para Windows Server 2022 está en [el procedimiento existente](windows-scm-operator-fixes-2026-11-02.md#única-invocación-delegada-windows-server-2022-powershell-elevado). Empieza con `Clear-Host`, verifica rama/árbol limpio y actualiza sólo por FF; usa el orquestador revisado y conserva evidencia parcial. No ejecutarla en Windows 10. No se inicia MFA humano en esta fase.

## Seguridad de dependencias: gate real FAIL

`pnpm ci:vulnerability-audit` consultó el registro oficial y terminó exit 1: 35 advisories, **11 incidencias high bloqueantes**, ninguna excepción aceptada. Incluye `follow-redirects`, `vite`, `zod`, `electron` y `undici`. No equivale a 11 CVE distintos ni prueba explotación de cada ruta. No se cambiaron excepciones ni se ocultaron resultados.

Fuentes primarias verificadas: [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Electron GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9), [follow-redirects GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8). El informe del evaluador incluye las restantes referencias oficiales. Hace falta actualización compatible y regresión antes de GO; no actualizar indiscriminadamente todo el lockfile dentro de la corrección SCM.

## GO/NO-GO por componente

| Componente | Decisión de integración actual | Evidencia / condición pendiente |
|---|---|---|
| Correcciones acotadas del candidato | GO para publicar en la rama Draft | Tests focalizados, tipos y builds; no equivale a GO a main |
| Offline, SQLite, outbox, ventas y roles | NO-GO a main todavía | Suites locales ejecutadas; falta regresión física PostgreSQL/sync del conjunto y revisión de 1123 commits |
| Central, BUSINESS, GLOBAL, MFA/PKCE y RLS | NO-GO | Tests sin PostgreSQL disponibles; integración persistente actual y provisión auténtica pendientes |
| Windows SCM/DPAPI entre identidades | NO-GO | VM no accesible; gate conservado |
| Licencias y pagos | NO-GO productivo | Pruebas aisladas no acreditan políticas, claves, cobros ni FACTUS auténticos |
| Electron | NO-GO comercial | E2E aislado no demuestra SCM ni login humano |
| Android/hardware/Linux | NO-GO físico/productivo | No se ejecutó certificación en esos destinos |
| Cadena de suministro | NO-GO | Auditoría real FAIL, sin excepciones nuevas |
| CI del candidato / post-merge | PENDIENTE | Cero workflows lanzados; no hay verde atribuible al HEAD candidato |

## Actions: medición histórica y ahorro propuesto

Se leyeron metadatos y jobs, sin ejecutar workflows. Dos muestras exitosas por workflow cuando existían:

| Workflow | Fecha de muestras | Minutos reales sumados de jobs por run | Redondeo ascendente por job, sin ponderar SO |
|---|---|---:|---:|
| Foundation TARGET | 2026-09-14 | 8.00–8.03 | 10 |
| Central Sync | 2026-10-07 | 1.00–1.13 | 1–2 |
| CodeQL | 2026-10-07 | 2.87–3.25 | 3–4 |
| D3 Live | 2026-10-05 | 1.55 | 2 |
| G1.2 | 2026-10-07 | 2.40–2.53 | 3 |
| Strix | 2026-10-07 | 0.10–0.13 | 1, **escaneo omitido** |

Referencia conjunta histórica sin un escaneo Strix efectivo: **15.82–16.50 minutos brutos**, aproximadamente **19–21 minutos redondeados por job**, sin ponderación de Windows ni consumo monetario. Es una envolvente de muestras antiguas, no una ejecución conjunta observada ni una predicción del candidato actual. El API de billing devolvió ceros: no prueba gratuidad y no permite estimar dinero/cuota sin plan y facturación. No existen muestras comparables para algunos workflows de host/SCM ni para Foundation post-merge; no se inventa duración. Strix había omitido `Install Strix` y `Run Strix`; su workflow verde **no acredita pentest** ni permite estimar un análisis real o consumo LLM.

No se modificaron workflows. Propuestas para aprobación posterior:

1. Preparar un único HEAD conjunto revisado, evitando tres ciclos sobre PR ancestrales; conservar validación del HEAD exacto y gobernanza post-merge.
2. Ya existen caché pnpm por lockfile y cancelación de ejecuciones obsoletas. Conservarlas; nunca cachear custodia, datos o secretos. Cualquier caché de addon debe separar SO/ABI/compiler/lockfile/fuentes y verificar hashes.
3. Mapear y retirar sólo duplicaciones demostradas del mismo SO, por ejemplo onboarding PostgreSQL repetido por selección global y explícita; mantener regresión independiente Windows/Linux.
4. Ejecutar gates deterministas baratos antes de PG/Electron; medir ahorro después de aplicar, sin omitir controles obligatorios.
5. Corregir cobertura antes del merge: D3 usa `POSTGRES_ADMIN_URL` pero las suites comerciales actuales exigen `POSTGRES_TEST_URL`; Foundation enumera migraciones antiguas y no acredita 008–023; `test:runtime` no ejecuta explícitamente la suite de `local-channel`. Ampliar cobertura puede incrementar consumo: no presentar el ahorro histórico como garantía.

## Evidencia conservada

Recibo compacto versionado: `docs/testing/evidence/main-integration-readiness-2026-11-02.json`. Logs completos locales bajo `artifacts/integration-candidate/2026-11-02/`, incluidos resultados iniciales y corregidos, selección excluida, diffs de ramas, historial de Actions y errores. El recibo publica hashes y conteos; no custodia privada ni datos de clientes. Las restricciones de infraestructura y los FAIL iniciales se conservan expresamente.
