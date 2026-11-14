# Preparación de certificación del login comercial

Fecha de cierre de esta revisión: **2026-11-03, America/Bogota**. Se conserva el nombre solicitado para el informe del 2 de noviembre.

## A. Estado ejecutivo

**El login humano Windows SCM no está certificado ni habilitado para producción.** Hay implementación y pruebas de componentes; no hay evidencia actual de la cadena completa bajo las dos identidades Windows del entorno objetivo.

- Repositorio revisado: `Andresito202/pos-platform`, rama `feat/p0-windows-login-install-readiness`, PR #99 Draft / issue #98.
- HEAD inspeccionado: `b41f36b92a373c1ac1a8d909deaef8a8a502617b`; local/remoto coincidentes tras actualizar referencias, divergencia 0/0. Árbol limpio al comenzar y al reanudar esta revisión.
- Código de las pruebas conservadas: `3abc72efbf7883d8c3341496956f59c4e725619d`. Su diferencia con el HEAD inspeccionado contiene exclusivamente los dos documentos de cierre de seguridad; no hay diferencia de código. Esta revisión no ejecutó de nuevo las suites.
- Se inspeccionaron fuentes, contratos, pruebas, JSON originales y scripts operativos. El informe anterior no se tomó como prueba suficiente: se contrastaron las huellas de los 13 reportes de regresión y los archivos fuente registrados.
- Acceso desde esta consola a `CamachoPOS-SCM-Lab`: **BLOCKED, Hyper-V Access denied**. No se modificó Windows 10 para eludirlo. No hay evidencia física nueva de la VM disponible para esta revisión.
- PostgreSQL nativo disponible: **16.11**, no el **16.14** requerido por el gate canónico. No se sustituyó la versión ni se intervinieron bases persistentes.

### Métricas y límites

El denominador es exactamente las 20 etapas de la sección B. No se calcula un porcentaje de finalización del POS ni de certificación productiva.

| Medida | Resultado | Criterio reproducible |
|---|---|---|
| Mecanismo implementado por componente | **19/20 = 95 %**, más una etapa parcial | Existe owner, contrato y mecanismo del componente. Se excluye la etapa 2: el arranque comercial SCM permanece detenido por un gate incondicional. Este porcentaje no significa 19 etapas conectadas en el despliegue objetivo. |
| Alguna cobertura automatizada ejecutada | **20/20 = 100 % de presencia de cobertura** | Cada fila tiene al menos una prueba PASS de componente, contrato, orquestación o denegación. Se admiten dobles, identificados en la matriz. No equivale a cobertura completa de la etapa: en 2 se prueba el rechazo; en 11 la orquestación, no la transacción PostgreSQL; en 20 el contrato, no una ceremonia GLOBAL real. |
| Etapas certificadas en el recorrido objetivo SCM + Central + persona | **0/20 acreditadas** | No existe ejecución observada de esa cadena en el entorno objetivo. El arranque de Electron y algunas operaciones interactivas sí se ejecutaron físicamente en el host; no se trasladan como certificación SCM. |
| Cadena humana completa | **BLOCKED** | Se detiene antes de cargar la provisión SCM y no se ha verificado provisión operativa de Central/dispositivo/persona. |

La columna «Implementación» de B evalúa el mecanismo, no disponibilidad productiva. Todas las filas siguen pendientes de certificación de la cadena objetivo. No hay fundamento para afirmar que falta reescribir contraseña, MFA, PKCE, DPAPI, SSA/SAS o access/refresh.

### Contraste de las pruebas declaradas

Fuentes: [recibo versionado](evidence/security-27-closure-2026-11-02.json), JSON originales en `artifacts/security-27/2026-11-02/`, fuentes actuales y comparación Git entre SHA de código y HEAD. Los artefactos locales no sustituyen evidencia versionada si se trasladan a otra máquina; conservarlos con sus hashes.

| Afirmación | Resultado comprobado | Alcance y exclusiones |
|---|---|---|
| 2.283 PASS / 18 SKIP | **Confirmado**, 2.301 casos únicos, 0 FAIL finales | 13 reportes; se sustituye el archivo Wompi anterior por su ejecución final de 8 casos, sin sumar reejecuciones superpuestas. No son 2.283 pruebas de login. Incluyen contratos comerciales, ventas, fiscal, SQLite, catálogo, caché, etc. |
| PostgreSQL | **No certificado en esta regresión** | 96 PASS del paquete PostgreSQL son pruebas de repositorios con dobles. **25 archivos dependientes de PostgreSQL se excluyeron**: no cuentan como PASS ni se ocultan dentro de los 18 SKIP. Incluyen contraseña persistida, MFA inicial, creación BUSINESS, consumo nativo y composición Central física. Lista exacta en `finalRegression.excludedPostgresFiles`. |
| 14/14 Electron E2E | **Confirmado**, Electron 44.9.1 | `electron-patched.json`: 5 arranque/aislamiento con Service de prueba; 1 caché; 1 custodia de credencial de prueba en Electron; 4 canal real con SQLite temporal, SSA/permisos de prueba y adaptador fiscal falso; 3 arranque sin sesión/pérdida de Service. Ninguno demuestra contraseña → MFA humano → Central → SCM → dashboard. |
| TypeScript / builds / arquitectura | **PASS conservado** | Logs `typecheck.log`, `central-typecheck.log`, `desktop-build.log`, `service-build.log`, `architecture.log`. Compilación y reglas no prueban provisión ni identidad física. |
| Dependencias | **0 altas, 0 críticas, 1 moderada** en el snapshot conservado | `artifacts/ci/dependency-vulnerability-evaluation.json`, SHA de código `3abc72ef…`; moderada `minimatch 10.2.5`, `GHSA-g3hv-75wg-m249`. Gate PASS; salida bruta de audit 1 por la moderada, no «cero vulnerabilidades». No se repitió auditoría de red. |
| Política / SBOM / inventario | **PASS conservado** | `sha-bound-checks.json`, cinco comandos con exit 0. No constituye un escaneo exhaustivo SAST/DAST ni certificación comercial. |

Las ejecuciones conservadas corresponden al 2 de noviembre en Bogotá; por ejemplo Electron comenzó `2026-11-03T02:53:18.181Z`. Para todas las pruebas citadas debajo, **S** significa SHA de código `3abc72efbf7883d8c3341496956f59c4e725619d`, código idéntico al HEAD auditado; **R** significa su reporte original de regresión del 2 de noviembre. No se atribuyen ejecuciones nuevas a este informe.

## B. Matriz de 20 etapas

Abreviaturas de rutas: **CA** = `apps/central-authority`; **LS** = `apps/pos-local-service`; **ED** = `apps/pos-desktop`; **LC** = `packages/local-channel`; **CT** = `packages/contracts`; **PG** = `packages/database-postgres`. Los archivos de pruebas están bajo `tests/` del owner, salvo `ED/e2e/`. «NO» en certificación se refiere a la cadena SCM comercial objetivo.

| Etapa | Implementación | Prueba | Certificación | Evidencia | Pendiente |
|---|---|---|---|---|---|
| 1. Inicio Electron | IMPLEMENTADO: `ED/src/production-entry.ts:main`, `start.ts:startPosDesktop`, `main.ts:bootstrap`. Contrato: handoff Windows y canal autenticado. Depende de build y provisión. | PASS S/R: `main.test.ts`, `window-security.test.ts`; `boot.spec.ts` 5 PASS y `unauthenticated-startup.spec.ts` 3 PASS reales. | NO; proceso Electron interactivo observado, sin login SCM. | Preload aislado; sin Node en renderer; entrada productiva deniega sin sesión. | Conectar al Service objetivo. Riesgo: tomar la ventana abierta por una sesión autenticada. Cierre: arranque GUI contra el Service real con evidencia de identidad. |
| 2. Inicio/conexión SCM | **PARCIAL/BLOQUEADO**: `LS/src/main.ts` invoca `assertWindowsScmCommercialCertification()` antes de leer provisión; `security/windows-commercial-host-identity.ts:29` lanza siempre. Contrato: handoff y decisión de cierre de certificación externa. | PASS S/R: `windows-commercial-host-identity.test.ts` exige conservar el gate; `ED/tests/scm-channel-start.test.ts` usa canal inyectado. Prueba física no ejecutada. | NO. | No basta instalar/provisionar: el entrypoint comercial aún rechaza SCM. | G1 real y revisión explícita posterior del gate con evidencia. Riesgo: habilitar un transporte no probado entre identidades. No quitar el gate durante esta auditoría. |
| 3. Identidades SERVICE/DESKTOP | IMPLEMENTADO en adapter: `LC/src/windows-native-pipe.ts:WindowsNativePipeAdapter`, `LS/src/channel/windows-scm-transport.ts`. Contrato: `CT/src/windows-channel-handoff.ts`. Depende de SID, logon, sesión y addon nativo fijados. | PASS S/R: `windows-native-pipe.test.ts` 7, con binding nativo inyectado; `windows-commercial-host-identity.test.ts` inspecciona además el token interactivo real. | NO entre cuentas objetivo. | Revalidación de peer antes de adoptar handles; no prueba de cuenta virtual contra Desktop real disponible. | Ejecutar ambos lados dentro de Server 2022 y conservar atestación OS. Riesgo: confusión de SID/sesión o confiar en JSON sin identidad OS. |
| 4. DPAPI y ACL | IMPLEMENTADO: `LS/src/security/local-security-component.ts:start`, `LC/src/windows-handoff.ts`, `windows-production.ts`. Contrato: custodia por rol y handoff firmado. | PASS S/R: `windows-production.test.ts` 7; `native-custody.spec.ts` 1. Enrollment operator condicionado no ejecutado. | NO para custodia cruzada SCM. | DPAPI CurrentUser interactivo y custodia de prueba Electron no equivalen a DPAPI de la cuenta virtual. | Recuperar material existente bajo cada rol, probar ACL negativas sin borrar/rotar claves. Riesgo: custodia legible por otra identidad o regeneración accidental. |
| 5. Named pipes/handshake | IMPLEMENTADO: `LS/src/channel/local-channel-component.ts:startAttempt`, `LC/src/windows-native-pipe.ts`; contrato de canal autenticado, replay y handoff. | PASS S/R: LC y `ED/e2e/real-channel.spec.ts` 4 casos; físico SCM condicionado sin PASS. | NO SCM; pipe interactivo real observado. | `windows-scm-physical.test.ts` existe pero la suite no acredita ejecución SERVICE/DESKTOP. | G1: manifiestos, hash del addon, peer real, handshake y rechazo del peer incorrecto. Riesgo: reproducir sólo mocks y adjudicar autenticación OS. |
| 6. Enrollment/DeviceProof | IMPLEMENTADO: `packages/device-trust/src/enrollment.ts:CentralDeviceCredentialIssuer.issue`, `request-proof.ts:verifyDeviceRequestAuthorization`; proveedor comercial en LS. Contratos: DEV-003 y DeviceProof por operación. | PASS S/R: paquete device-trust 37; `commercial-binding-prerequisite.test.ts`, `isolated-commercial-binding-adapter.test.ts`. Persistencia/replay física Central excluida. | NO DEV-003 operativo acreditado. | Firma, propósito, correlación y tenant se verifican; los fixtures no son un dispositivo enrolado operativo. | Registro auténtico y prueba de posesión bajo custodia real. Riesgo: confundir ID suministrado con confianza o reutilizar proof. |
| 7. HTTPS Central | IMPLEMENTADO: `CA/src/main.ts` crea servidor TLS ≥1.2; `central-commercial-runtime.ts:prepareCentralCommercialRuntime`; transporte HTTPS de LS. Contratos: provisión comercial y origen confiable. | PASS S/R: contratos/transportes; `authorization-https-provider.test.ts`. Composición física Central/PG excluida. | NO endpoint operativo verificado. | Variables de provisión/TLS ausentes en esta consola; no prueba inexistencia en otra sesión/VM. | Origen real del laboratorio, certificado confiable y configuración validada. Riesgo: aceptar TLS deshabilitado o RP/origen distinto. No se requiere contratar VPS para un laboratorio correctamente confiado. |
| 8. Contraseña | IMPLEMENTADO: `CA/src/platform-password-verifier.ts` y `business-initial-mfa-flow.ts:begin`; repositorio canónico. Contrato de credencial persistida y verificación confiable. | PASS S/R: `platform-password-verifier.test.ts` 5. `stored-password-verification-physical.test.ts` excluido por PG. | NO persona/credencial operativa. | Verificador existente; no se reconstruyó ni se repitió la suite histórica de Argon2id. | Usuario real aprovisionado y prueba correcta/incorrecta contra Central temporal. Riesgo: considerar un userId o un mock como contraseña verificada. |
| 9. WebAuthn UV | IMPLEMENTADO: `CA/src/platform-webauthn-assertion-verifier.ts` exige `requireUserVerification: true`; `BusinessInitialMfaFlow.complete`. Contratos de challenge y factor. | PASS S/R: `platform-webauthn-assertion-verifier.test.ts` 8, firmas EC auténticas generadas por software, rechazos de firma/RP/origen/contador. Transacción MFA PG excluida. | NO autenticador humano físico. | UV exigida por verificador; software criptográfico no certifica presencia/UV de una persona. | Enrolar autenticador físico bajo RP/origen aprobado y probar UV, replay y rechazo. Riesgo: equiparar bandera de fixture con verificación humana. |
| 10. PKCE/callback nativo | IMPLEMENTADO: `CA/src/native-authorization-code-exchange.ts:exchange`, `native-authorization-callback.ts:inspectNativeAuthorizationCallback`; `ED/src/native-business-login.ts:beginNativeBusinessLogin`. Contrato: cliente registrado, redirect exacto, S256/state y DeviceProof fresca. | PASS S/R: `native-business-login.test.ts` 11, `native-commercial-service-login.test.ts` 9 y tests de callback/exchange. Persistencia nativa PG excluida. | NO ceremonia conectada a SCM. | Main recibe activación, renderer no invoca begin/complete/commit; pruebas incluyen dobles del Service. | Recorrer navegador HTTPS → loopback → canje del código de un uso con dispositivo real. Riesgo: replay, sustitución de credencial o confusión de tenant. |
| 11. Sesión BUSINESS | IMPLEMENTADO: `CA/src/business-session-authority.ts:create`; `PG/src/business-session-creation-transaction.ts:create`. Contrato: evidencia MFA interna de un uso, políticas explícitas, `identity.sessions`, device_id NULL. | PASS S/R **sólo orquestación**: `business-login-coordinator.test.ts`; prueba `business-session-authority-physical.test.ts` excluida. | NO transacción real actual/persona. | Código BEGIN/revalidación/INSERT/auditoría/COMMIT y rollback inspeccionado; no se infiere ejecución del SQL. | PostgreSQL 16.14 temporal y ceremonia real; concurrencia/rollback de la composición afectada. Riesgo: sesión creada pese a credencial rotada o membresía revocada. |
| 12. SSA | IMPLEMENTADO: `CA/src/central-session-assertion-issuer.ts:CentralSessionAssertionIssuer.issue`; `LS/src/security/session-assertion-verifier.ts:verify`. Contratos `session-assertion.ts`, `session-trust.ts`; secuencias 011/012. | PASS S/R: issuer 30, verifier 51; repositorios de secuencia con dobles. | NO emisor operativo → Service SCM. | Firma y binding probados por componente; reserva monotónica persistente no acreditada en esta regresión. | Firmante y raíz auténticos, secuencia persistente y entrega al Service. Riesgo: replay/rollback de secuencia o trust root no autorizada. |
| 13. SAS | IMPLEMENTADO: `CA/src/isolated-authorization-snapshot-issuer.ts:issue` es el owner reutilizado por runtime; `LS/src/security/authorization-snapshot-verifier.ts:verify`, coordinator. Contratos authorization-snapshot/trust; secuencia y bloqueo RBAC. | PASS S/R: `authorization-snapshot.test.ts` 31, store 21, HTTPS/trust. PG físico no ejecutado. | NO snapshot real del empleado. | Se descarga y verifica SAS firmado; «isolated» en nombre no demuestra que esté ausente del montaje. | Provisión raíz/firma y snapshot derivado de RBAC real; medir timeout/bloqueo aprobado. Riesgo: permisos obsoletos o snapshot de otra empresa. |
| 14. RBAC | IMPLEMENTADO: `LS/src/commercial/commercial-component.ts:verifyNativeAuthorization`; capacidades del Service y autorización de dominio. Contratos `authorization.ts` y matriz de permisos. | PASS S/R: dominio 47, suites comercial IPC/canal y snapshot. | NO roles humanos contra Central. | Backend decide; ausencia de SAS/grant deniega. La prueba con permisos de fixture no certifica una asignación humana. | Aprovisionar roles con alcance y probar cajero/supervisor/admin y negativos entre sucursales. Riesgo: elevación o ámbito cruzado. |
| 15. Módulos autorizados | IMPLEMENTADO: `ED/renderer/src/hooks/useAuthorizationCapabilities.ts:useAuthorizationCapabilities`; App consume capacidades. Contrato: `authorization.capabilities.get`, `session.recover`. | PASS S/R: `session-recovery.test.tsx` 15 con fixtures, App/preload/allowlist; E2E deniega sin sesión. | NO dashboard de persona. | ACTIVE por sí solo no concede permisos; tras recovery se vuelve a consultar backend. | Comprobar módulos visibles y operaciones denegadas con permisos reales. Riesgo: pantalla habilitada por estado local o permisos obsoletos. |
| 16. Cajero → ventas | IMPLEMENTADO: App/SalePanel → transporte comercial → handlers de ventas del Service; contrato IPC comercial y permiso de venta. | PASS S/R: `SalePanel.test.tsx`, canal comercial; `real-channel.spec.ts` ejecuta venta con SQLite temporal y SSA/grants de prueba. | NO cajero legítimo autenticado. | Efecto real en SQLite de laboratorio, sin identidad humana ni Central. | Login real con rol cajero y venta exclusivamente en base temporal. Riesgo: afirmar login comercial por una venta con autorización de fixture. |
| 17. Renovación/expiración | IMPLEMENTADO: `LS/src/security/native-commercial-coordinator.ts:renewAuthorization`, `renewIfDue`; `windows-commercial-runtime.ts:start`. Contratos access/refresh V2, posesión y SSA/SAS. | PASS S/R: runtime 7; suites sesión/trust/snapshot. No recorrido actual PG+SCM de familia refresh. | NO renovación operativa de persona. | Refresh anterior se consume localmente antes de red; ambigüedad exige nuevo login, no replay automático. | Red real de laboratorio, expiración y reutilización contra persistencia Central. Riesgo: familia reutilizada, ventana de validez mal provisionada o renovación ambigua. |
| 18. Logout/revocación | IMPLEMENTADO: coordinator `logout`, `clearCredentials`; `CommercialComponent.closeNativeSession`; cierre de conexiones de LocalChannelComponent. Contrato revoke V2 y lifecycle de sesión. | PASS S/R: `native-session-close-lifecycle.test.ts` 4, `commercial-account.test.ts` 6 y suites canal/runtime. | NO revocación Central/SCM física. | Tombstone local antes de red; `SIGNED_OUT_LOCAL` **no significa** revocación remota confirmada. | Evidenciar cierre local inmediato, cancelación y revocación de familia en Central; comprobar fallo de red separado. Riesgo: reportar revocación remota sin respuesta verificable. |
| 19. Recuperación/fallos | IMPLEMENTADO: coordinator `release/stop`, runtime `handle/recovered/release/stop`; `ED/src/start.ts` reemplaza canal sólo en transiciones explícitas. Contratos recovery, custodia, leases. | PASS S/R: recovery 15, SCM-start con dobles; E2E de reinicio sin sesión y pérdida del Service. | NO recuperación positiva SCM/usuario. | Pruebas negativas reales no demuestran restauración de una sesión humana vigente tras reinicio. | Reiniciar Service/GUI conservando custodia; red caída, lease vencido y no repetición de mutaciones. Riesgo: permisos viejos o doble operación al reconectar. |
| 20. BUSINESS/GLOBAL | IMPLEMENTADO: `CA/src/global-administration-sessions.ts:complete/authorize/close`, runtime y handlers separados. Contrato `CT/src/central-administration.ts`, sesiones GLOBAL sin tenant/membresía y MFA. | PASS S/R: `platform-administration-session.test.ts` y validaciones HTTP/contratos; no ceremonia GLOBAL humana acreditada. | NO dos sesiones humanas independientes. | Contrato prohíbe elevar BUSINESS a GLOBAL; tabla identity.sessions canónica compartida con separación de tipo. | Probar cookie/origen/CSRF y roles de plataforma con cuenta autorizada; rechazar BUSINESS en transporte GLOBAL. Riesgo: elevación entre superficies. |

La cobertura parcial de 11 y 20 se cuenta únicamente en «presencia de cobertura». No es una declaración de persistencia ni autorización GLOBAL probadas físicamente. Las filas 2–20 tienen bloqueos de certificación propios o heredados; la existencia de código no los resuelve.

## C. Bloqueos reales por dependencia

1. **Acceso al Windows Server objetivo y estado de custodia desconocido en esta consola.** Hyper-V deniega acceso. Las rutas del laboratorio no existen en el host; ello no prueba que falten dentro de la VM. Se necesita ejecución dentro de Server 2022, sin tocar seguridad del host.
2. **G1 SERVICE/DESKTOP no acreditado y gate comercial incondicional.** El código falla antes de cargar el handoff. G1 PASS no retira automáticamente el gate: hará falta un cambio mínimo revisado, autorizado por evidencia y probado contra el entrypoint comercial. Esta es una dependencia de código pendiente, no sólo un dato de despliegue.
3. **Central y persistencia del entorno objetivo no verificados.** En esta consola faltan las referencias de despliegue, base, provisión comercial/GLOBAL, TLS, trust SSA/SAS y provisión Windows. No se buscaron secretos ni se extrapoló esta ausencia al resto de equipos. Falta PostgreSQL 16.14 aislado y comprobar migraciones/roles/RLS sobre ese entorno; no hay justificación para rehacer SQL ya aprobado.
4. **Confianza operativa y DEV-003 sin evidencia auténtica disponible.** Operador debe aportar referencias no secretas: origen HTTPS/RP, ubicación de provisiones, identidad empresa/sucursal/instalación/dispositivo y responsable; certificados/raíces/credenciales se provisionan por custodia aprobada, nunca por chat. Parámetros deben estar explícitos y autorizados; no se inventan vigencias.
5. **G2 y cadena de autorización no ejecutados físicamente juntos.** Faltan leases por conexión, autorización por operación, expiración, cancelación, logout, revocación y recuperación sobre la composición real SCM/Central. Los tests aislados siguen válidos en su alcance.
6. **Ceremonia humana no realizada.** Cuenta autorizada, contraseña, autenticador físico con UV, roles y datos temporales. Sin esto no se certifican login, dashboard ni separación GLOBAL/BUSINESS de persona real.
7. **Integración/distribución/producción son decisiones posteriores.** No hay CI del HEAD exacto ni autorización de merge. No se reabre certificación externa gratuita, firma pública, Store ni MSIX. No se ejecutaron Actions.

## D. Orden mínimo para llegar al login funcional

1. Ejecutar **una inspección de readiness dentro de la VM** sobre el SHA auditado. Identificar qué material ya existe antes de cualquier provisión.
2. Si A–D están completos, ejecutar el orquestador físico existente. Si hay provisión parcial, conservarla y resolver el diagnóstico específico; no borrar DPAPI, reinstalar ni regenerar raíces. No repetir suites generales.
3. Con resultados G1 y revisión del riesgo entre identidades, preparar un incremento mínimo posterior que haga utilizable el entrypoint comercial SCM manteniendo validaciones. Esta auditoría no lo implementa ni lo aprueba por inferencia.
4. Provisionar/reutilizar Central HTTPS de laboratorio y PostgreSQL 16.14 aislado; ejecutar preflights existentes y pruebas físicas de persistencia/composición que quedaron excluidas. Usar un entorno confiable local no exige comprar dominio/VPS; tampoco permite falsear identidad o desactivar TLS.
5. Validar G2 sobre las mismas identidades, provisiones, SHA y base temporal; capturar positivos y negativos sin mutaciones comerciales reales.
6. Sólo entonces realizar ceremonia humana y recorrido de permisos/dashboard/renovación/logout. Registrar por separado BUSINESS y GLOBAL, sesión local cerrada y revocación remota confirmada.
7. Revisar GO de integración con pruebas del candidato exacto y autorización correspondiente. PR #99 permanece Draft mientras no se cumplan sus criterios.

## E. Pruebas físicas necesarias

### E1. Próximo paso: inventario dentro de Windows Server 2022

Ejecutar en PowerShell **dentro de `CamachoPOS-SCM-Lab`**, sobre la copia existente; no en Windows 10. No instala, inicia servicios ni crea custodia. Si la VM tiene otro SHA, conservar su árbol y reconciliar antes de atribuir resultados al SHA auditado.

```powershell
Clear-Host
Set-Location -LiteralPath 'C:\CamachoLab\pos-platform'
whoami.exe /user
git status --short
$testedSha = (git rev-parse HEAD).Trim()
Write-Output ('TESTED_SHA=' + $testedSha)
if ($testedSha -ne 'b41f36b92a373c1ac1a8d909deaef8a8a502617b') { throw 'SHA_DISTINTO_RECONCILIAR_SIN_DESCARTAR_CAMBIOS' }
& .\tools\operators\windows-scm-five-stage.ps1 -LabRoot 'C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046'
```

Esperado: estado A–E, identidad del operador y SHA. **Sin `-RunPhysical`, exit 2 y `D_PHYSICAL_NODE_ELECTRON=NOT_EXECUTED` son intencionales**; no equivalen a una prueba física fallida. Conservar salida íntegra sin secretos. E comprueba presencia/preflight, no autenticación real. El script conserva `HUMAN_LOGIN_READY=NO` y gate activo.

### E2. G1: canal y custodia entre identidades reales

Precondiciones: E1 A–D válidos; servicio WinSW existente y detenido, cuenta `NT SERVICE\CamachoPOSLocalService`, manifiestos firmados y pareados, addon fijado por hash, custodia previa bajo ambas identidades, comando de prueba del Service ya configurado y consola administrativa dentro de la VM autorizada. Revisar el estado parcial antes de usar cualquier provisioner.

```powershell
Clear-Host
Set-Location -LiteralPath 'C:\CamachoLab\pos-platform'
whoami.exe /user
git rev-parse HEAD
& .\tools\operators\windows-scm-five-stage.ps1 -LabRoot 'C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046' -RunPhysical
```

Ejecuta `windows-scm-physical-one-shot.ps1`, que exige resultados nuevos por ronda, ambos peers reales y cero skips. La ronda Electron es **Electron ejecutando Node**, no la GUI comercial/main/preload completa. Esperado: `D_PHYSICAL_NODE_ELECTRON=PASS`, reportes SERVICE y DESKTOP con exactamente 1 PASS y 0 FAIL/pending por ronda, hashes de artefactos y atestación OS de SID/logon/sesión/parentesco SCM. Las rutas de resultados las comunica el orquestador bajo `<LabRoot>\results`; no reutilizar un JSON viejo como resultado nuevo.

E puede permanecer bloqueado aun con D PASS. Un JSON válido solo no prueba identidad del proceso: conservar también atestación OS. El script detiene el servicio si lo inició; no borra claves ni retira el gate. **No certifica BUSINESS ni G2 completo.**

El provisioner `windows-scm-lab-provision.ps1` no es una reparación idempotente: rechaza material parcial/existente con `PARTIAL_ENROLLMENT_REQUIRES_REVIEW` o `PARTIAL_ENROLLMENT_REPORT_REQUIRES_REVIEW`. No volver a ejecutarlo a ciegas ni eliminar archivos para hacerlo pasar. Su configuración de logging de laboratorio puede quedar apuntando a results; no afirmar restauración total de XML sin inspección.

### E3. Central: preflight separado de certificación

Sólo en el proceso que ya tenga configuradas las referencias de provisión auténtica y base temporal. Comandos existentes, no migran ni crean una identidad:

```powershell
Clear-Host
Set-Location -LiteralPath 'C:\CamachoLab\pos-platform'
whoami.exe /user
git rev-parse HEAD
pnpm --filter @pos-platform/central-authority deployment:preflight
pnpm --filter @pos-platform/central-authority login:preflight
```

Preflights PASS son condiciones de entrada, **no** prueba de sesión BUSINESS. No imprimir variables ni archivos de credenciales. Verificar versión real de PostgreSQL, TLS confiable/hostname/RP/origen, claves públicas autorizadas, estado de usuario/membresía/factor/dispositivo, secuencias y permisos con los verificadores existentes. Ejecutar después únicamente las suites físicas excluidas pertinentes sobre esa base temporal, conservando comandos, conexión no secreta, versión, SHA, reportes y rollback. No usar bases comerciales ni reemplazar 16.14 por 16.11.

### E4. G2 y ceremonia humana

No existe un comando único observado que certifique todo este recorrido; no se inventa. Deben ejecutarse la GUI y el Service comerciales reales una vez resuelto el gate conforme a evidencia, no un runner con autorización sintética.

| Prueba | Resultado requerido | Evidencia y participación |
|---|---|---|
| Lease/peer y autorización por operación | Peer correcto autorizado; rol/SID/sesión/credencial/tenant incorrectos rechazados antes del efecto. | Identidad OS de ambos procesos, correlación, auditoría y ausencia de escritura en rechazo. Automatizable en VM. |
| Caducidad/replay/revocación | Lease/token/código vencido o reutilizado rechazado; refresh rotado y familia revocada según contrato. | Estado persistido y eventos sin tokens; pruebas físicas PostgreSQL y Service. Automatizable con políticas explícitas. |
| Cancelación/pérdida de red/canal | Pendientes cancelados, sin commit tardío ni repetición de mutación; permisos retirados cuando no verificables. | Eventos y estado temporal antes/después. Automatizable. |
| Reinicio/custodia | Recupera material existente bajo su identidad; otra cuenta no puede descifrar; no fabrica sesión ni regenera claves. | Huellas públicas/ACL, resultados bajo ambos roles y cierre correcto. Automatizable tras provisión. |
| Persona BUSINESS | Contraseña correcta → UV físico → sesión BUSINESS → DeviceProof/PKCE → SSA/SAS → sólo módulos autorizados. Incorrecta y factor inválido denegados. | Persona autorizada opera navegador y autenticador; referencias de auditoría y capturas sin secretos. **Requiere humano.** |
| Cajero/supervisor/admin | Venta temporal permitida sólo al rol/ámbito; administración y sucursal ajenas denegadas. | Identidades/roles reales de laboratorio y efecto verificable; no grants de fixture. Humano para aceptación de pantallas. |
| Renovación/logout | Renovación verificable; cierre local inmediato; revocación Central confirmada por separado; reinicio no restaura sesión cerrada. | Auditoría de familia/sesión, credenciales temporales destruidas, canal cerrado. |
| GLOBAL | Ceremonia separada con MFA y autorización PLATFORM; BUSINESS nunca eleva ni sustituye GLOBAL. | Cookie/origen/CSRF y decisión backend, sin registrar cookie ni contraseña. Humano para ceremonia. |

Por fase conservar: comando/acción exacta, SHA, identidad efectiva, versión OS/runtime/PG, inicio/fin, PASS/FAIL/BLOCKED/SKIP, reportes originales y hashes, corrección si procede y bloqueo residual. No publicar contraseñas, tokens, cookies, claves privadas ni contenido DPAPI. Evidencia de pagos/hardware no es requisito ni resultado de esta misión.

## F. Decisión GO/NO-GO

| Destino | Decisión | Condición verificable |
|---|---|---|
| Laboratorio de componentes | **GO limitado** | Código y evidencia existentes permiten continuar pruebas focalizadas; no repetir suites generales. |
| Laboratorio físico SCM/Central desde esta consola | **NO-GO actualmente** | Sin acceso a VM; falta evidencia de G1/provisión y PostgreSQL canónico. E1 puede ejecutarlo el operador dentro de la VM. |
| Ceremonia humana comercial Windows | **NO-GO** | Gate incondicional, G1/G2 y provisión/roles/RP/TLS sin acreditar juntos. |
| Integración a main | **NO-GO** | No merge autorizado ni CI del candidato exacto; permanece revisión de bloqueos y evidencia objetivo. Este informe no sustituye gates de gobernanza. |
| Distribución comercial | **NO-GO** | Instalación, custodia entre identidades y cadena comercial no acreditadas. No se exige reabrir firma/certificación externa cerrada. |
| Producción | **NO-GO** | Sin ceremonia humana ni evidencia del entorno productivo objetivo y políticas operativas efectivamente provisionadas. |

## G. Próxima acción exacta

**Ejecutar únicamente E1 dentro de Windows Server 2022 `CamachoPOS-SCM-Lab` y conservar su salida con identidad y SHA.** Es la acción mínima para conocer el estado real existente sin destruir custodia, reinstalar, modificar Windows 10 ni repetir lo ya probado. Después se selecciona la corrección concreta indicada por A–E; todavía no se inicia login humano.

---

Cambios de esta misión: únicamente este informe. Sin modificación de lógica, contratos, diseño, seguridad, migraciones, datos, QR Nequi ni `oracleJdk-27/`. Sin nuevas suites, pagos, hardware, Actions o merge. El estado de producción sigue bloqueado.
