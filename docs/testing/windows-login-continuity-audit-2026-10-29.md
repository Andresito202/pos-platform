# Login Windows–Central: auditoría consolidada de continuidad

Fecha: 29 de octubre de 2026. PR #99, issue #98. Rama única: `feat/p0-windows-login-install-readiness`. Runtime corregido: [`8d04ca157c49ce9c748722714c7eef7e5db182d8`](https://github.com/Andresito202/pos-platform/commit/8d04ca157c49ce9c748722714c7eef7e5db182d8). Base auditada: `29cb14b8f1f89ed2034c5502d1dd6d490e38f855`. Base PR #96: `913ea8cc6b24dfcd672f4f794e74b48ce3731c93`.

**Resultado: se corrigieron dos deficiencias comprobadas, sin reemplazar autenticación, canal ni runners. El login comercial completo sigue sin certificar y SCM todavía tiene integración de código pendiente. No queda solamente una prueba humana.** PR #99 y #96 deben seguir Draft; #98 permanece abierta.

## A. Comparación histórica y límites de atribución

Se consultaron PR #99, PR #96, issue #98, comparación completa y árbol remoto. Antes de publicar se volvió a comprobar HEAD. PR #96 conserva `913ea8cc…`; #99 tenía 132 commits, 67 archivos modificados y cero commits por detrás de esa base. GitHub informaba mergeable, pero no se ejecutó un merge local ni una integración a main.

Se recuperaron 991 archivos de texto de código, pruebas, configuración y herramientas. Antes del delta, se verificaron sus blobs SHA-1 Git: 989 coincidencias y los dos archivos del ledger modificados deliberadamente. Después se modificaron cuatro scripts de migración por errores de TypeScript reproducidos. No es una clonación autenticada ni demuestra el estado del checkout Windows. Las imágenes y buena parte de la documentación no forman parte de esa copia; los documentos de continuidad y gobernanza relevantes se leyeron mediante GitHub.

La autoría Git identifica al propietario; no identifica al asistente. El contexto conversacional recuperado describe varios relevos y contiene atribuciones incompatibles. El límite seguro de comparación es el contenido remoto por SHA:

| Etapa verificable | Diferencia efectiva |
|---|---|
| Base #96, `913ea8cc…` | Ya contiene composición comercial Central, contraseña/WebAuthn, BUSINESS, GLOBAL separado, PKCE, DeviceProof, access/refresh, SSA/SAS, permisos y ciclo de cuenta Electron. No se reimplementaron. |
| `f83ded28…` → `24d9dfa7…` | El contexto describe nueve archivos locales dejados por Codex y publicados por el propietario como candidato handoff. El commit conserva ese trabajo; no habilita SCM. |
| `6ce88249…`, `b59d551d…`, `556db179…` → `c5136fbf…` | Vinculación a token/logon/reloj Windows; firma Ed25519 sobre cápsula RSA-OAEP; pin externo; consumo único y revocación SQLite; pruebas y gates del candidato. |
| `c2eff0d3…` → `5d220c0a…` | Herramientas de roles, preflight, recibos, smoke y preparación 001–016 sobre los runners canónicos. No implica que 006–016 estén aplicadas. |
| `4f064be0…` → `e2065af1…` | Despacho BUSINESS esperado con await, contención de errores HTTPS y cierre/borrado de material del canal Electron. El contexto también atribuye este corte a Codex; no se usa esa atribución contradictoria para certificar autoría. |
| `f0cd66b0…` → `29cb14b8…` | Fallo cerrado al cargar provisión Desktop, hashes SQL fijados 005–016 y rechazo de origen Central inseguro en launcher. |
| `8d04ca15…`, esta misión | Reloj del Service en consumo de lease; seis regresiones; guardas y capturas de recibos para corregir siete errores de TypeScript. |

La lista completa de los 132 commits de entrada y sus fechas se conserva en el JSON de evidencia asociado. Esa lista es historia Git, no una atribución inventada a Codex o ChatGPT.

Pruebas anteriores: el documento de laboratorio registra 11 PASS sobre `d04c4ee088fb8a94276aa4b4c8a672c9220f9cc7`, MFA virtual y runner exit 0. Los 341 del operador, 32 de la base, 24 aislados y otros resultados comunicados mantienen su SHA/alcance históricos; **no se contabilizan como ejecución de este HEAD**. No se recuperaron los artefactos físicos del PC para verificar de nuevo sus hashes.

## B. Inventario técnico por frontera

IMPLEMENTADO significa código existente; no implica operación comercial ni certificación física.

| Componente / contrato | Estado comprobado y evidencia | Pendiente |
|---|---|---|
| Contraseña / Argon2id | Canónico en `business-initial-mfa-flow.ts` y contratos de verificador; composición en `central-commercial-runtime.ts`. Conservado. | Contraseña de actor aprobado y negativas contra Central auténtica. |
| WebAuthn / UV / MFA | Flujo existente, sesión y contexto durable; Central compila con biblioteca real del workspace. | Persona, autenticador físico, RP/origin y verificación UV legítimos. |
| BUSINESS | Central instancia las autoridades de MFA, sesión, navegador y credenciales; dispatch asíncrono endurecido existente. | Ejecución comercial autenticada con provisión y esquema vigentes. |
| GLOBAL | Runtime/ceremonia/cookies/roles de plataforma separados. No se convierte una membresía BUSINESS en privilegio GLOBAL. | Migración 021 y sus predecesoras, provisión y prueba humana separadas. |
| Cliente nativo / HTTPS / callback | Registro canónico y comparación Service/Desktop/Central; no habilita localhost comercial. | Registro real y cadena HTTPS confiable en cliente y navegador. |
| PKCE / código único / DeviceProof | Implementación previa preservada; pruebas seleccionadas Central de restricciones, callback y exchange pasan. | Recorrido completo con dispositivo inscrito y negativas por transporte real. |
| Access / refresh / revocación | Autoridad Central y `native-commercial-coordinator.ts` existentes; acceso del renderer mediado por Service. | Refresh, reinicios, logout offline/online y revocación con actores reales. |
| SSA / SAS / RBAC | Firmas, confianza, secuencias y autorización por contexto existentes; verificadores y negativas incluidos en pruebas ampliadas. | Raíces operativas distribuidas y permisos efectivos de empresa/sucursal/usuario. |
| Dashboard | La identidad SSA no concede permisos; se mantiene autorización efectiva mediante snapshot/grants. | Matriz positiva/negativa con datos de operación aprobados. |
| DPAPI CurrentUser / mismo logon | Service aprovisiona y Desktop consume; host interactivo y DACL de logon existentes. | Windows real, segundo usuario y recuperación tras reinicio. |
| SCM / WinSW multicuenta | Bloqueo en descriptor y arranque conservado. `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` sigue siendo correcto. | Integración nativa y certificación, descritas abajo. |
| Handoff RSA-OAEP + Ed25519 | Candidato existente autenticado por pin externo, receptor ligado a SID/logon/session y consumo único. Primitivas verificadas en Linux; casos Win32 omitidos. | Firmante operacional, autenticación de pares por handle y conexión al runtime. |
| SQLite lease/revocación | Autoridad canónica persistente, pruebas reales de cierre/reapertura y revocación. Se corrigió el consumo temporal. | Frontera IPC segura al único writer y terminación de canales activos. |
| Electron errores/secretos | Rutas existentes de startup, cierre y borrado conservadas; pruebas estructurales de seguridad y build comprobados. | Ejecutar Electron sobre el Windows del propietario y probar fallos reales. |

### Bloqueo SCM: verificación concreta de los diez puntos solicitados

1. **Firmante:** el sello exige clave privada suministrada; no existe aprovisionamiento operacional aprobado bajo la cuenta Service/DPAPI. No se generó una clave de operación.
2. **Identidad de pares:** `windows-handoff-native.ts` obtiene el token del proceso actual. Eso no autentica automáticamente al cliente/servidor remoto del pipe mediante su handle.
3. **Instancia SCM:** comprobar nombre/SID/contexto de proceso no acredita por sí solo que el peer sea la instancia SCM esperada. Falta esa vinculación operacional.
4. **Pipe:** el DACL actual se limita al logon del servidor. No ofrece un transporte multicuenta certificado; se mantuvo sin ampliar ACEs.
5. **Sesiones:** el perfil vincula receptor SID, logon SID y session ID, pero falta verificar ese binding sobre la conexión real del peer.
6. **Secreto:** la cápsula entrega una clave derivada por lease, nunca el master. La confidencialidad y autenticidad de la cápsula no sustituyen autenticación de transporte.
7. **Consumo:** SQLite conserva el recibo único; ahora vuelve a validar tiempo y revocación dentro de la transacción.
8. **Persistencia:** `SqliteWindowsHandoffLeaseAuthority` existe en el Service, pero no está conectado al canal SCM. No debe trasladarse SQLite a Electron.
9. **Canales activos:** revocar un lease impide nuevas comprobaciones; todavía falta conectar revocación/logout/cambio de cuenta con el cierre en caliente del canal SCM.
10. **Reinicio:** el ledger prueba persistencia de consumo/revocación. No demuestra custodia del firmante, autenticación SCM ni eliminación de secretos en una recuperación multicuenta.

Por esas dependencias de código y de Windows no se activó el handoff comercial. Habilitarlo ahora requeriría inventar confianza de instalación o aceptar claims del peer sin evidencia del kernel. Las carreras de inicialización, instancia duplicada, TOCTOU nativo, reinicio y limpieza parcial multicuenta siguen como casos obligatorios de aceptación; no se presentan como resueltos por pruebas criptográficas.

## C. Deficiencias verificadas y correcciones

### C1. Consumo de lease fuera de vigencia y limpieza con reloj del llamador

**Severidad:** alta para la integración futura del candidato; no se demostró explotación comercial porque SCM sigue bloqueado. Archivo: `apps/pos-local-service/src/channel/sqlite-replay-state.ts`, `SqliteWindowsHandoffLeaseAuthority.accept`.

**Contrato:** un lease solo puede consumirse una vez, dentro de su ventana, con revocación vigente y sin eliminar recibos aún válidos. La comprobación anterior en `assertActive` no basta después del trabajo nativo DPAPI.

**Evidencia:** cinco casos nuevos fallaron contra el código original: consumo en el instante exacto de expiración y después; retroceso de reloj; reloj inválido; poda de otro recibo aún vigente mediante un evaluatedAt adelantado. Un sexto caso, revocación desde otra autoridad entre autorización y consumo, ya pasaba y se preservó.

**Causa:** `accept` confiaba en `input.evaluatedAt`, no volvía a consultar el reloj del Service y no comprobaba otra vez la ventana.

**Cambio mínimo:** capturar authorizedAt al aprobar; consultar el reloj del Service dentro de la transacción; rechazar reloj inválido, retrocedido o fuera de ventana; evaluar revocación y limpieza con ese mismo instante. El intento consume el estado pending antes de ejecutar la transacción. Sin nuevo esquema ni protocolo.

**Regresión/riesgo:** un salto atrás del reloj ahora deniega consumo deliberadamente; no se añade gracia temporal. Las seis regresiones más las cuatro pruebas previas del ledger pasan sobre SQLite real. Esto no certifica la revocación de canales SCM ya abiertos.

### C2. Gate TypeScript de migraciones bloqueado

**Severidad:** media; bloquea la batería final y la preparación verificable de autenticación. `tsc -p tools/target-migrations/tsconfig.json` reprodujo siete TS18048 en cuatro archivos:

- `preprod-login-authentication-apply.ts`: descriptor possibly undefined y narrowing del recibo perdido dentro de función.
- `preprod-login-foundation-apply.ts`: referencia al payload validado fuera de su ámbito de narrowing.
- `preprod-login-schema-gate.ts`: fila 005 possibly undefined.
- `preprod-login-stage-status.ts`: fila 005 possibly undefined.

**Cambio mínimo:** rechazar descriptor/fila ausentes explícitamente; capturar array de migraciones e ID del predecesor después de validar el recibo. Se retiró la aserción no nula del array en la función. Los códigos de rechazo, checksums, runners, ACL, SQL y receipts no se sustituyeron.

**Prueba:** el mismo proyecto TypeScript falla antes y pasa después; las 17 pruebas no destructivas existentes del gate/contratos siguen pasando. No se ejercitó un apply físico ni se afirma que esas pruebas estáticas equivalgan a ejecutar DDL.

## D. Cambios publicados y ausencia de duplicación

Commit de implementación `8d04ca157c49ce9c748722714c7eef7e5db182d8`, hijo directo del HEAD observado. Se publicó con actualización fast-forward y expected SHA; GitHub confirmó exactamente seis archivos, sin divergencia:

1. Autoridad SQLite existente.
2. Su archivo de pruebas existente, seis casos nuevos.
3. Los cuatro scripts existentes enumerados en C2.

No se creó otro login, motor de migración, runner, autoridad de canal ni almacenamiento. No se modificó SQL, DPAPI scope, ACL de pipe, provisión, usuarios ni certificados. Mensaje `[skip ci]`; no se solicitó ejecutar Actions. La publicación documental posterior añade este informe, evidencia y enlace de backlog; no cambia el árbol de runtime probado.

## E. Pruebas reales de esta misión

Entorno remoto Linux, Node 24.22.1, TypeScript 6.0.3, Vitest 4.1.11, Zod 4.4.3 y better-sqlite3 13.0.3. Esto no sustituye el entorno Windows soportado. No hubo PostgreSQL operativo, Windows SCM, MFA humano ni PC del propietario.

Las dependencias se instalaron fuera del producto para verificar la copia de fuentes. npm rechazó inicialmente WebAuthn con 403; la resolución canónica posterior del workspace sí obtuvo la dependencia y permitió compilar Central. El wrapper de build pnpm intentó reconciliar dependencias y rechazó scripts de instalación; sus subetapas se ejecutaron directamente después. Los cambios incidentales locales a lock/workspace se restauraron byte a byte y no se publicaron.

| Ejecución | Resultado real | Alcance |
|---|---|---|
| Nuevas regresiones contra ledger original | 5 FAIL, 5 PASS | Reproducción antes de corregir; no ocultada. |
| Handoff + ledger + rechazo WinSW | 33 PASS, 0 FAIL, 4 omitidas | Criptografía y SQLite reales; cuatro casos exigen Windows. |
| Ampliada Service/canal/SSA/SAS/RBAC y guardas Central/Desktop | 199 PASS, 8 FAIL, 28 omitidas | Los ocho fallos son listen EPERM al crear sockets Unix; el transporte no quedó probado. Suite global NO PASS. |
| Central: preflight, registro, restricciones PKCE, callback/exchange, claves SSA y confianza | 79 PASS, 0 FAIL, 0 omitidas | Unitarias/lógica; no ceremonia humana ni E2E PostgreSQL. |
| Operadores migración y contratos 006/007/008 | 17 PASS, 0 FAIL, 0 omitidas | Sin DDL ni conexión a DB persistente. |
| Focalizada final después de correcciones | 50 PASS, 0 FAIL, 4 omitidas | Incluye las 17 anteriores; no sumar cifras. |
| Repetición del conjunto focalizado vinculada al commit publicado | 50 PASS, 0 FAIL, 4 omitidas | Se confirmó que sus seis blobs son los publicados en `8d04ca15…`. |
| Arquitectura | 16/16 PASS y ARCH-003 PASS | Validador canónico ejecutado directamente. |
| TypeScript completo de contratos, canal, SQLite, Service, Central, Desktop/main/renderer, target-migrations | PASS | Proyectos existentes, sin stubs de WebAuthn. |
| Build Desktop/main, entry bundles, preload y renderer | PASS con advertencia | Falta logo PNG en la copia de fuentes; Vite deja su ruta para runtime. No es aceptación visual de la instalación. |
| Política de repositorio | NO VERIFICADA | Intento falló porque la copia obtenida por API no tiene índice/historial Git. No se fabricó uno para anunciar PASS. |
| Runner Windows canónico / PostgreSQL aislado / E2E físico | NO EJECUTADOS | Requieren Windows, dependencias/puertos admitidos y/o PostgreSQL aislado. |

Artefacto: [JSON de evidencia, historial y resultados](evidence/windows-login-continuity-2026-10-29.json). Contiene SHA de fuentes, blobs cambiados, comandos, contadores, nombres y estados de casos, hashes de los JSON de Vitest y fallos ambientales. Los contadores se solapan y **no se suman**. Las pruebas estructurales de startup/dispatch no acreditan manejo real de HTTPS/Electron bajo fallo.

Comandos utilizados desde la copia de fuentes, con `node_modules/.bin` resolviendo las versiones indicadas:

```bash
node_modules/.bin/tsc -p packages/contracts/tsconfig.json
node_modules/.bin/tsc -p packages/local-channel/tsconfig.json
node_modules/.bin/tsc -p packages/database-sqlite/tsconfig.json
node_modules/.bin/tsc -p apps/pos-local-service/tsconfig.json
node_modules/.bin/tsc -p apps/central-authority/tsconfig.json
node_modules/.bin/tsc -p apps/pos-desktop/tsconfig.json
node_modules/.bin/tsc -p apps/pos-desktop/tsconfig.renderer.json
node_modules/.bin/tsc -p tools/target-migrations/tsconfig.json
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
```

El JSON conserva los selectores completos Vitest y las subetapas exactas del build. No se ejecutó el runner PowerShell como si Linux fuese Windows.

## F. Estado final del login

| Dimensión | Clasificación |
|---|---|
| Código global del login | INCOMPLETO para el objetivo multicuenta SCM; recorrido interactivo implementado, sin certificación comercial. |
| Integración Windows–Central | INCOMPLETA en operación real; composición previa preservada, sin nuevo E2E de transporte en este entorno. |
| Laboratorio | Histórico aprobado solo sobre `d04c4ee0…`; laboratorio integrado del HEAD actual PENDIENTE. |
| Windows SCM | PENDIENTE DE CÓDIGO, PROVISIÓN Y PRUEBAS. |
| BUSINESS | Implementado y con unitarias aprobadas; CERTIFICACIÓN PENDIENTE. |
| GLOBAL | Implementado por separado; CERTIFICACIÓN PENDIENTE y dependencia de esquema 021. |
| Certificación humana | PENDIENTE. |
| Producción | NO PREPARADO para habilitación. |

No puede afirmarse que todo el código esté cerrado y solo falte pulsar el autenticador. Sería incompatible con el estado del transporte SCM y de GLOBAL.

## G. Dependencias finales y procedimiento Windows

### Inventario de migraciones

- **Implementadas:** descriptores y runners canónicos 001–016, más el esquema GLOBAL 021 y su cadena. No se añadió ninguna migración.
- **Aplicadas históricamente según evidencia versionada del operador:** 001–005 en `camacho_pos_preprod`; 004 con 132 comprobaciones y 005 con 17. No se inspeccionó ahora esa DB y no deben reaplicarse por este informe.
- **006–016:** preparadas y verificadas estáticamente; no aplicadas por esta misión. Su estado actual debe leerse en el ledger real.
- **GLOBAL 021:** requiere atender la cadena 017–020. No se ejecutan licencias/FACTUS/suscripciones para resolverla de manera implícita. No se altera una migración aprobada ni se registra una aplicación ficticia.

### 1. Sin cambiar servicios ni bases: sincronizar e inventariar

Conservar primero cualquier cambio local. Los comandos siguientes suponen la rama correcta y un árbol limpio; si no se cumplen, detener la sincronización sin reset/clean/stash automático:

```powershell
Set-Location C:\Proyectos\pos-platform
git status --short --branch
git branch --show-current
git fetch origin feat/p0-windows-login-install-readiness
git log --oneline --left-right HEAD...origin/feat/p0-windows-login-install-readiness
git merge --ff-only origin/feat/p0-windows-login-install-readiness
git rev-parse HEAD
pnpm --filter @pos-platform/target-migrations exec tsx src/preprod-login-stage-status.ts
```

El último comando es de solo lectura, requiere los archivos protegidos ya existentes en LocalAppData y consulta la preproducción loopback 55435. Esperar `ALL_006_016_ABSENT`, `PARTIALLY_APPLIED`, `ALL_006_016_APPLIED` o `REQUIRES_MANUAL_RECONCILIATION`. Un estado parcial exige revisión; no repetir apply automáticamente. No enviar pgpass, claves, tokens ni URLs con credenciales al chat.

Las aplicaciones persistentes **no están autorizadas en esta misión**. Cuando exista autorización específica y respaldo verificado, los comandos canónicos preparados son `tsx src/preprod-login-foundation-apply.ts --apply-foundation-006-007` y, solo tras recibo/postchecks válidos, `tsx src/preprod-login-authentication-apply.ts --apply-authentication-008-016`, dentro de target-migrations. No se deben ejecutar por copiar este informe.

### 2. Batería automática canónica

```powershell
pnpm architecture:check
pnpm ci:repository-policy
powershell.exe -NoProfile -File tools/operators/windows-login-final-checks.ps1 -Run
```

Guardar SHA, versiones, comando, exit code, PASS/FAIL/omitidas y evidencia sanitizada por escenario. No ejecutar Actions. Para PostgreSQL, usar exclusivamente el contenedor tmpfs/binding ya autorizado por el [runbook de laboratorio](windows-login-local-lab-2026-10-29.md) y la opción del mismo runner `-Run -IncludeIsolatedPostgres -IsolatedLabOnly`. No apuntarlo a 55435 ni a una DB de negocio. El runner exige árbol limpio; preservar artefactos fuera de rutas rastreadas.

### 3. Ceremonia auténtica interactiva, cuando exista provisión legítima

```powershell
powershell.exe -NoProfile -File tools/operators/windows-login-deployment-preflight.ps1 -Interactive
pnpm --filter @pos-platform/central-authority run login:preflight
powershell.exe -NoProfile -File tools/local/launch-windows.ps1 -CheckOnly -RequireCommercialLogin
powershell.exe -NoProfile -File tools/local/launch-windows.ps1 -RequireCommercialLogin
```

Antes del último comando: HTTPS legítimo, roles/esquema operativos verificados, claves separadas SSA/SAS, dispositivo/persona/empresa/sucursal y membresía aprobados, Service y Desktop en la misma sesión Windows, sin otra instancia usando SQLite. La provisión no puede derivarse de fixtures. Si falta, el preflight debe denegar.

Evidencias obligatorias: contraseña incorrecta/correcta; UV físico aceptado/rechazado; PKCE alterado y código repetido; DeviceProof inválido; SSA/SAS manipuladas/caducadas/revocadas; usuario y tenant/sucursal ajenos denegados; dashboard sin grants cerrado; refresh y recuperación; logout online/offline; caída Central/PostgreSQL; doble callback y cierre inesperado. Cada una con resultado, correlación sin secretos y SHA.

GLOBAL requiere su propia sesión/MFA y permisos de plataforma; demostrar rechazo cruzado BUSINESS/GLOBAL. No ampliar permisos para hacer pasar la prueba.

### 4. SCM: condición de trabajo restante, no comando de instalación

Antes de solicitar instalar un servicio privilegiado se debe completar sobre el candidato existente: custodia DPAPI del firmante Service, provisión/pin aprobados, identificación de ambos extremos por handles/tokens y vinculación de la instancia SCM, derechos mínimos de pipe sin creación de instancias por usuarios no autorizados, consumo/revocación mediante el Service único writer y cierre de canales activos. Luego probar con Service real y dos cuentas/logons, caducidad durante DPAPI, replay, reinicio, fallo parcial e instancia duplicada.

No se entrega un comando install/start de WinSW porque el descriptor comercial debe continuar rechazándolo. El [runbook físico](windows-login-p0-physical-handoff-2026-10-29.md) y el [candidato firmado](windows-login-signed-handoff-candidate-2026-10-29.md) siguen vigentes con las precisiones de este informe.

No hubo merge, cierre de issue, contratación, creación de usuarios productivos, modificación de credenciales/certificados ni acceso a bases persistentes. La limitación de entorno no se convirtió en una afirmación de certificación.
