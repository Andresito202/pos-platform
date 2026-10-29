# Camacho POS — cierre P0 de login sin acceso permanente a Windows

Fecha de corte: 2026-10-29 · PR #99 (Draft) · issue #98 · rama `feat/p0-windows-login-install-readiness`

## Evidencia física del operador — ya obtenida

La máquina Windows ejecutó **realmente** sobre `camacho_pos_preprod` (PostgreSQL 16.14, TLS `verify-full`, rol migrador separado):

- MAT003: `READY_WITH_RECEIPT`, permisos mínimos permanentes, recibo validado.
- PostgreSQL 003: `APPLIED_WITH_RECEIPT`, preflight PASS, catálogo y ledger verificados.
- PostgreSQL 004: `APPLIED_WITH_SMOKE_VERIFIED`, 132 comprobaciones de cuatro roles. Falló un verificador externo por ACL `42501`; se recuperó el recibo **sin aplicar otra vez 004 ni elevar permisos**.
- PostgreSQL 005: `APPLIED`, catálogo RLS y ledger verificados, 17 comprobaciones de aislamiento real por actor, recibo íntegro.
- 001 y 002 verificados como predecesoras exactas por las herramientas anteriores.
- No reutilizar las pruebas de descriptor 004 (3/3) ni 005 (2/2) como prueba de autenticación humana.

**NO** reaplicar MAT003 ni 003/004/005. Este registro no concede autenticación ni acceso al panel.

## Matriz fiel al repositorio — qué existe en código y qué falta

| Frontera | Código disponible | Pendiente antes de operación real |
|---|---|---|
| Central BUSINESS | `central-commercial-runtime.ts`, MFA WebAuthn UV, contraseña, PKCE, callback y DeviceProof; autoridad de sesión, refresh, SSA, SAS y RBAC | Migraciones/ledger 006–016, proveedor `pos_platform_app` de operación, configuración real, actor inscrito, HTTPS legítimo y claves SSA/SAS bajo custodia |
| Central GLOBAL | `global-administration-runtime.ts`, sesiones/MFA y roles de plataforma separados | Migración 021 y cadena actual de 017–020; provisionamiento real distinto de BUSINESS. No completar mediante grants, fixtures ni saltos de migraciones |
| Desktop Electron | `commercial-account.ts`, menús Cuenta, callback y sesión vía Service; no recibe tokens de acceso | Provisión coincidente con Service/Central, prueba de callback, recuperación, logout, reinicio y controles visibles/negados por rol |
| Local Service | `native-commercial-coordinator.ts`, DPAPI CurrentUser y canal autorizado; host comercial interactivo controlado | Claves/IDs de equipo reales y firmados, pruebas físicas de identidad/DPAPI/IPC y snapshot central |
| SCM WinSW | Contrato de handoff firmado + consumo único/candidato SQLite y denegación explícita del modo comercial no certificado | Integración del canal SCM↔Electron entre identidades, provisión firmante Service, SID cliente/servidor desde Windows, ACL restringida y revocación de canal; **no** habilitar por defecto |
| Sesión y autorización | SSA/SAS y permiso por `tenant/company/branch` en contratos y componentes | Prueba física con actor autorizado, denegación de otro rol/sucursal/empresa, expiración, revocación, refresh, anti-replay; no confiar en UI para autorizar |
| Base PostgreSQL | 001–005 aplicadas, certificados/recibos bajo LocalAppData, no en Git | 006, 007 y lote AUTHENTICATION 008–016; realizar solo en operación Windows controlada y después de scripts/checksums/gates listos |

## Dependencias SQL precisas (lectura de descriptores, no inferencia)

1. `006_licensing_foundation` sigue a 005. Aunque el objetivo es exclusivamente login, en el modelo **actual** 007 depende de 006; no se puede saltar 006 ni marcarla aplicada ficticiamente.
2. `007_password_recovery` sigue a 006. El runner comercial arranca a partir de 007.
3. El target `AUTHENTICATION` del `postgres-commercial-runner.ts` aplica **008–016**: plataforma/RBAC, retos y material WebAuthn, secuencias SSA, DeviceProof, sesiones de navegador, vínculo refresh, secuencias de autorización y código nativo BUSINESS.
4. GLOBAL actualmente exige `021_global_browser_administration`, cuyo descriptor sucede a 020. La cadena 017–020 incluye licencias/FACTUS/suscripciones; **no ejecutar esos módulos solo para desbloquear GLOBAL** sin una decisión y revisión arquitectónica del propietario. Puede prepararse un desacoplamiento de dependencias en un PR separado, pero no reescribir migraciones aprobadas sin análisis de datos y contratos.
5. Ninguna migración debe correrse mientras el PC está apagado; el trabajo sin PC es **preparación en Git**: auditoría y pruebas de código, runbooks, manifests, validaciones fail-closed y scripts de instalación revisados. No confundir con cambios físicos.

## Orden de trabajo sin el PC — sin mezclar otros frentes

1. Auditar diagramas y composición exacta Central↔Service↔Desktop: contratos de PKCE/DeviceProof, emisión y activación SSA, confianza SAS, expiración/refresh/logout, BUSINESS/GLOBAL y RBAC. No duplicar módulos existentes.
2. Preparar los gates no destructivos y scripts de aplicación 006/007/008–016 (con SHA, TLS, preflight, ledger, recibos y smoke verdaderos) de forma que el operador no deba copiar secretos ni ejecutar manualmente cada SQL; nunca habilitar un bypass de permisos.
3. Completar tests negativos y positivos focalizados sin ejecutarlos en Windows hasta la fase final: MFA/replay, PKCE/state, secuencias SSA/SAS, cancelación/logout, separación de tenant y GLOBAL.
4. Resolver **solo en código** la custodia y la política del handoff SCM, sin habilitarlo mientras no se prueben SID/DPAPI/DACL con dos contextos reales. El modo interactivo de un único usuario es un hito separado, no prueba de SCM.
5. Mantener una única batería final del PR #99 (`windows-login-final-checks.ps1 -Run` y runner de laboratorio aislado) y la ceremonia humana al final, con evidencia por commit y sin revelar secretos.

## Qué no se puede declarar completado sin una operación humana

- Aprovisionamiento aprobado de Central PREPRODUCTION con FQDN HTTPS y TLS verificable, actor humano con WebAuthn UV físico, registro de dispositivo y pertenencias efectivas, claves operativas SSA/SAS, backend de negocio bajo `pos_platform_app`.
- Migraciones 006–016 en **la misma** preproducción persistente, realizadas por el runner canónico con recibos y smoke. GLOBAL 021 requiere tratamiento independiente por su cadena de dependencias.
- Windows: prueba de mismo usuario interactivo, segundo usuario distinto y, si se habilita, SCM WinSW real; salida/entrada, reinicio, revocación y operación sin conexión sin privilegios inventados.
- La prueba final solo puede empezar con un árbol limpio, commit exacto y evidencia de que se trata de los mismos binarios, no de suites históricas.

## Política operacional

**El ordenador puede apagarse sin perder ninguna de las migraciones 001–005 confirmadas.** Conservar volumen Docker, certificados, `pgpass.conf`, recibos y trabajo local. Nunca `reset --hard`, `docker volume rm`, copiar secretos al repo, ni presentar una prueba virtual de MFA como acceso productivo.

**Estado documental:** 001–005 certificadas en preproducción; código de login avanzado, pero todavía no operativo/certificado con humano. El trabajo de código puede progresar durante sesiones activas con GitHub conectado; no afirmar trabajo autónomo continuo cuando la conversación esté cerrada.


## Incremento de código sin PC — cierre del lote SQL login (29-oct-2026)

Se materializó en la **misma rama** el tramo técnico necesario para preparar los esquemas restantes, sin modificar SQL existentes:

- tools/target-migrations/src/preprod-login-schema-gate.ts: modo --manifest (offline) y --inspect (read-only). Verifica 001–016, SHA256, recibo 005, rol/TLS y ausencia de 006–016. No aplica DDL.
- tools/target-migrations/src/preprod-login-foundation-apply.ts: modo explícito --apply-foundation-006-007. Usa exactamente una vez cada runner oficial existente 006/007, comprobación RLS forzada, propietario, ACL y recibo exclusivo SHA256.
- tools/target-migrations/src/preprod-login-authentication-apply.ts: modo explícito --apply-authentication-008-016. Usa una vez el runner comercial existente con target AUTHENTICATION, no pagos ni GLOBAL. Verifica ledger, checksum, RLS, ACL de tablas de confianza Central y recibo exclusivo SHA256.
- tools/target-migrations/tests/preprod-login-operator-gates.test.ts: cinco casos de regresión estructural que se ejecutarán con la batería final.

**Estado honesto: IMPLEMENTED / NOT YET TESTED.** El código está publicado y auditado estáticamente; no hay TypeScript/Vitest físicos de este incremento, DDL nueva en Windows ni persona autenticada. La máquina puede permanecer apagada.

### Último tramo manual, cuando vuelva el operador

1. Sin tocar datos: git pull --ff-only, tree limpio, typecheck target-migrations, vitest focalizado preprod-login-operator-gates.
2. Inspección read-only: pnpm --filter @pos-platform/target-migrations exec tsx src/preprod-login-schema-gate.ts --manifest; luego el mismo comando con --inspect. Debe comprobar la ausencia completa de 006–016.
3. Sólo tras aceptar el resultado y los artefactos: pnpm --filter @pos-platform/target-migrations exec tsx src/preprod-login-foundation-apply.ts --apply-foundation-006-007. Esto **modifica la DB**; si 006 aplica y 007 falla, detenerse sin reintentar.
4. Tras recibo/ledger 007 verificados: pnpm --filter @pos-platform/target-migrations exec tsx src/preprod-login-authentication-apply.ts --apply-authentication-008-016. Esto **modifica la DB**; en fallo parcial, detenerse y conciliar registros antes de cualquier acción.
5. Preflight de Central HTTPS, rol runtime pos_platform_app, provisión auténtica de identidades/device y raíces SSA/SAS. Ejecutar al final batería Windows+Central y E2E humano con MFA físico, PKCE, DeviceProof, refresh/logout/revocación, aislamiento GLOBAL/BUSINESS y autorización real.
6. El host interactivo del **mismo usuario Windows** es el primer hito. La interoperabilidad SCM WinSW con dos cuentas diferentes permanece bloqueada hasta que el handoff firmado y la revocación queden integrados y verificados físicamente.

**Regla:** no reejecutar MAT003 ni 003–005. No ejecutar los aplicadores nuevos durante el trabajo remoto ni declararlos certificados sin salida física real. No publicar secretos, no abrir acceso sin MFA, no saltarse RLS.

**Separación GLOBAL 021:** el descriptor y la ruta actual dependen de 017–020 (pagos/licencias), y el handler GLOBAL incorpora funciones de ofertas/suscripciones. No aplicar esa cadena sólo para desbloquear un login, ni reescribir la dependencia sin decisión de arquitectura/compatibilidad. BUSINESS se certifica como hito independiente.
