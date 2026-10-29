# Camacho POS — P0 login/autorización, incremento de implementación (2026-10-29)

**Alcance exclusivo:** Windows Electron ↔ Local Service ↔ Central BUSINESS/GLOBAL;
MFA, PKCE, SSA/SAS y RBAC. No licencias, FACTUS Pay, pagos, ERP, infraestructura pública ni migraciones comerciales.

## Evidencia previa auténtica de Windows (rama PR #96; operador)

- Git: `feat/android-commercial-runtime` HEAD `913ea8cc6b24dfcd672f4f794e74b48ce3731c93`, limpio.
- WinSW `CamachoPOSLocalService` **NO REGISTRADO**. Ninguna variable comercial consultada presente en Process/User/Machine. Central `deployment:preflight`: configuración ausente; no certificación humana.
- `tests/service-descriptor.test.ts`: **11/11 PASS**, Vitest 4.1.11.
- `tests/channel.test.ts` + `tests/windows-dpapi.test.ts` + `tests/windows-commercial-runtime.test.ts`: **21/21 PASS**. Incluye DACL real de named pipe y DPAPI CurrentUser bajo la MISMA cuenta de operador. **NO** valida servicio SCM virtual ↔ Electron interactivo.
- Estas pruebas corresponden a PR #96 antes del presente delta. **No atribuirlas a PR #99**.

## Hallazgos con lectura de código

1. WinSW declarativo exige cuenta `NT SERVICE\CamachoPOSLocalService`.
2. `packages/local-channel/src/windows-production.ts` protege el secreto simétrico con `DPAPI CurrentUser`. La protección no se transfiere automáticamente de cuenta virtual a usuario interactivo.
3. La DACL del named pipe se restringe a `SYSTEM` y SID de sesión logon del **servidor** (`S-1-5-5-*`), no la del escritorio.
4. El escritorio anteriormente podía crear la clave/secreto al arrancar sin que Service hubiera iniciado. Eso creaba una autoridad de bootstrap ambigua. Ahora el escritorio es **solo lector**, y el Service el único responsable de crear la clave DPAPI de la sesión permitida.
5. Central BUSINESS/GLOBAL, WPA/FIDO, PKCE, SSA/SAS y grants ya están materializados en código, pero el propietario no ha configurado un entorno auténtico para iniciar las ceremonias.

## Código materializado en PR #99

- `packages/local-channel/src/windows-production.ts`: separación de **Service creador** y **Desktop lector**, verificación de existencia, ruta absoluta del Service, rechazo de enlaces a claves DPAPI, revisión de ACL al leer sin tomar posesión ni mutarla, continuidad de AES-GCM y DPAPI CurrentUser. **No** se cambió a LocalMachine, texto plano ni almacenamiento en React.
- `packages/local-channel/tests/windows-production.test.ts`: regresión Desktop no crea secretos en ausencia de Service; creación explícita de Service, coincidencia en misma identidad Windows, y rechazo temprano de IDs inválidos.
- `apps/pos-local-service/src/windows-service-descriptor.ts`: modo comercial SCM explícito fail-closed hasta disponer de canal de cuentas distintas con pruebas. No instalar servicio no interoperable.
- `apps/pos-local-service/tests/service-descriptor.test.ts`: prueba de rechazo de perfil e intención comercial.
- `apps/central-authority/src/central-login-preflight.ts` y CLI: informe de presencia, **solo lectura**, acotado a autenticación BUSINESS/GLOBAL y sin mezclar FACTUS/licencia; nunca certifica usuarios/DB/SSL externo.
- `tools/local/launch-windows.ps1`: `-RequireCommercialLogin` rechaza falta de archivos de provisión; advertencia actualizada de rutas Central.
- `tools/operators/windows-login-deployment-preflight.ps1`: inventario protegido sin valores secretos.
- `tools/operators/windows-login-final-checks.ps1`: batería focalizada de TypeScript/build/Vitest, **no ejecuta sin `-Run`**.

## Seguridad y límites (innegociables)

- No permisos `Everyone`/ `Authenticated Users` para el pipe.
- No exportar secreto ni clave privada a Electron renderer, preload o GitHub.
- No cambiar DPAPI CurrentUser a LocalMachine o guardar secretos planos para sortear diferencia de cuentas.
- No autenticar un usuario por UUID, contexto env, test fixture ni token sin MFA.
- No declarar que GLOBAL equivale a BUSINESS.
- No compartir sesiones o snapshots entre tenant/company/branch.
- No falsificar raíz SSA/SAS ni grant para abrir dashboard.
- No ejecutar GitHub Actions, tests finales, migraciones, instalación SCM ni tareas fuera del P0 en este incremento.

## Brecha arquitectónica sin cerrar

El **canal entre cuenta virtual SCM y usuario interactivo** aún carece de un procedimiento implementado y certificado de entrega de secreto o handshake autenticado con aislamiento por SID y revocación. El bloqueo no se elimina modificando la DACL ni cambiando DPAPI a un perfil más permisivo. Hasta entonces el inicio bajo **misma identidad** mediante proceso controlado (no instalado como SCM virtual) puede preservar las garantías originales si y sólo si los demás artefactos operativos auténticos están aprovisionados y validados.

## Certificación diferida al final

Cuando la implementación termine y exista identidad autorizada de Central, ejecutar bajo aprobación operatoria:

```powershell
pnpm --filter @pos-platform/central-authority run login:preflight
powershell.exe -NoProfile -File .\tools\operators\windows-login-deployment-preflight.ps1
powershell.exe -NoProfile -File .\tools\operators\windows-login-final-checks.ps1 -Run
```

El tercer comando solo cubre pruebas automatizadas y puede trabajar con fixtures/archivos temporales; **no certifica** una persona real, una identidad SCM separada, MFA físico ni TLS público. La aceptación final necesita ambos contextos Windows reales, clave/ACL efectiva, identidad D3, Global y Business independientes, refresh/logout/revocación, SAS/SSA firmados y RBAC en Central, y operaciones denegadas cuando corresponda.

**Estado: IMPLEMENTACIÓN PARCIAL EN PR #99, PRUEBAS DEL DELTA PENDIENTES, LOGIN COMERCIAL NO CERTIFICADO.**

## Incremento de hardening del 29 de octubre (posterior a la primera revisión)

**Implementado, aún no ejecutado ni certificado en Windows:**

- `apps/pos-local-service/src/security/windows-commercial-host-identity.ts`: atestación del token de Windows real del proceso mediante `WindowsIdentity.GetCurrent`, sin aceptar UID/SID del entorno, sin imprimir el usuario ni su SID. Exige una sesión interactiva o sesión remota interactiva reconocida por Windows, y rechaza identidades `NT SERVICE`, `NT AUTHORITY`, SYSTEM y cuentas no autenticadas. En `main.ts` se valida **antes** de abrir SQLite, DPAPI o el named pipe cuando hay aprovisionamiento BUSINESS comercial. Este guard no autentica al usuario BUSINESS/GLOBAL, y no habilita WinSW.
- `packages/local-channel/src/windows-production.ts`: envoltura AES-256-GCM del secreto de canal sometida a límites de tamaño y campos estrictos; IV de 12 bytes, etiqueta de 16 bytes, ciphertext de 32 bytes, Base64url canónico y control de autenticidad. El lector Desktop no genera ni reescribe datos y rechaza almacenamiento relativo. El archivo DPAPI se valida como archivo regular acotado; los fallos del helper Windows se convierten en códigos sin rutas/SID/secretos.
- Regresiones nuevas en `windows-commercial-host-identity.test.ts` y `windows-production.test.ts` para atestación, permisos, arranque sin secretos y manipulación de sobres cifrados; ejecución **reservada para la batería final**.
- `tools/operators/windows-login-deployment-preflight.ps1`: incluye elegibilidad del token del PowerShell actual, sin publicar nombre de usuario ni SID. Esa elegibilidad **no prueba** el token futuro del servicio.
- `tools/operators/windows-login-final-checks.ps1`: incluye las regresiones del token de Windows dentro de la futura batería unificada.

**Decisión de arquitectura:** conservar DPAPI CurrentUser y el SID de logon exige que Desktop y Service compartan cuenta/sesión, hasta implementar una autoridad de handoff real. Un servicio SCM virtual **no** puede recibir la clave por inferencia de env, copia de .dpapi, modificación de DACL o una cuenta global. DPAPI-NG `SID=` requiere AD y por tanto no puede asumirse disponible para un cliente Windows independiente: véase documentación de proveedor Microsoft/DPAPI-NG sobre protección por descriptor. Se deberá elegir y certificar un host/IPC apropiado **antes** de habilitar WinSW comercial. El código sigue fallando cerrado.

**Sin certificación:** los 32 PASS previos son de la rama PR #96, anteriores a estas modificaciones de PR #99. Todo delta actual necesita pruebas en la fase final. La issue P0 no se cierra y no se fusiona el PR.
