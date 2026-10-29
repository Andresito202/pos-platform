# CAMACHO POS COLOMBIA — P0 Entrega de código para certificación física de login

**Fecha:** 2026-10-29. **Issue:** #98. **PR:** #99, `feat/p0-windows-login-install-readiness` (base PR #96).
**Ámbito único:** BUSINESS, GLOBAL, MFA/WebAuthn UV, sesión, SSA/SAS y permisos por rol, Electron ⇄ Local Service ⇄ Central.

## 0. Alcance y límites reales

Este documento **no acredita todavía un login humano**. El operador debe disponer de su Windows, un navegador/llave o autenticador físico compatible, un origen Central HTTPS autorizado y un rol/membership real activo. No pedir o publicar secretos, contraseñas, cookies, PIN, tokens o claves privadas en GitHub o ChatGPT.

**Decisión de host para estas pruebas:** invocar `tools/local/launch-windows.ps1 -RequireCommercialLogin` con usuario **interactivo autorizado**; Service y Electron se ejecutan en **la misma sesión Windows** y usan DPAPI CurrentUser + SID de logon. No es un Windows Service instalado por SCM. El descriptor WinSW virtual `NT SERVICE\CamachoPOSLocalService` continúa rechazando su uso comercial; **NO** presentar la prueba interactiva como prueba de compatibilidad SCM. No iniciar dos Local Services sobre la misma ruta SQLite.

## 1. Preparación inmutable de código

- Confirmar `git status --short --branch` limpio, sin borrar cambios ajenos. Para ejecutar las nuevas correcciones debe seleccionarse PR #99 en una rama local apropiada con revisión de `git diff` antes de cambiar rama; no usar `reset --hard` ni `clean -fd`.
- Verificar `git rev-parse HEAD` y conservar SHA exacto del artefacto de pruebas en el registro final. No asumir que el usuario ya tiene PR #99: su Windows sigue en PR #96 hasta sincronizar.
- Los 32 PASS de Windows anteriores al PR #99 **no cuentan como pruebas de este delta**.

## 2. Configuración legítima requerida (NUNCA generar valores simulados)

**Central (PREPRODUCTION o PRODUCTION, no LOCAL):**
- TLS privada/certificado y origen FQDN permitido + cadena confiable por Windows/navegador; no `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- PostgreSQL runtime `pos_platform_app` con RLS y verificación TLS; esquema/migraciones y rol de migrador separados.
- `CENTRAL_COMMERCIAL_PROVISION_FILE` y `CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE` con actores humanos y asignaciones reales.
- `D3_ISSUER_PRIVATE_KEY_FILE`, `D3_ENROLLMENT_TRANSPORT_TOKEN_FILE` bajo custodia administrativa.
- SSA: `SESSION_TRUST_ARTIFACT_FILE`, distribución local firmada o token de publicación según despliegue.
- SAS: `AUTHORIZATION_TRUST_ARTIFACT_FILE` y `AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE`, con raíces y tokens independientes.

**Windows (perfiles y archivos propiedad del instalador):**
- `POS_DATA_DIRECTORY` absoluta y única; `POS_INSTALLATION_ID`, `POS_DEVICE_ID`, `POS_TENANT_ID`, `POS_COMPANY_ID`, `POS_BRANCH_ID` inscritos/validados por Central (no UUID fixture).
- `POS_WINDOWS_COMMERCIAL_PROVISION_FILE` y `POS_WINDOWS_DESKTOP_COMMERCIAL_FILE` con mismo `clientId`, `redirectUri`, `authorizationOrigin`, `rp_id`, `webauthn_origin` y plataforma ELECTRON.
- `POS_CENTRAL_BASE_URL` HTTPS igual al origen registrado. `POS_AUTHORIZATION_TRUST_PROVISION_FILE`, `POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM`, `POS_SESSION_TRUST_ENVIRONMENT` y ruta SSA local o de transporte.
- Solo el Service crea el secreto AES-GCM protegido por DPAPI `CurrentUser`; Desktop lo lee. ACL de named pipe: SYSTEM y SID de logon exacto. No permisos Everyone/Users/Authenticated Users.

## 3. Batería automatizada **ANTES** de la ceremonia humana

Desde `C:\Proyectos\pos-platform`, usando la rama aprobada y sin cambios locales no guardados:

```powershell
powershell.exe -NoProfile -File .\tools\operators\windows-login-deployment-preflight.ps1
pnpm --filter @pos-platform/central-authority run login:preflight
powershell.exe -NoProfile -File .\tools\operators\windows-login-final-checks.ps1 -Run
```

La última línea ejecuta TypeScript, build y Vitest focalizados del canal, Service, Desktop y Central. Debe registrar **cada suite PASS sin skip inadvertido**. Si se ha provisionado una instancia PostgreSQL *de laboratorio aislada*, el operador puede autorizar **por separado**:

```powershell
powershell.exe -NoProfile -File .\tools\operators\windows-login-final-checks.ps1 -Run -IncludeIsolatedPostgres
```

Este modo **requiere** `POSTGRES_TEST_URL` y solo acepta host 127.0.0.1/localhost, puerto 55433. Las suites crean y eliminan **bases aleatorias de prueba**, NO usan el negocio ni otra DB persistente. Nunca pasar credenciales o URL a esta conversación; reportar códigos y resultados redactados.

## 4. Ejecución humana E2E — pasos de aceptación

Solo después de que el operador compruebe los artefactos reales y el entorno Central apropiado:

```powershell
powershell.exe -NoProfile -File .\tools\local\launch-windows.ps1 -CheckOnly -RequireCommercialLogin
powershell.exe -NoProfile -File .\tools\local\launch-windows.ps1 -RequireCommercialLogin
```

En el segundo comando **sí** se inicia el Service interactivo real y Electron. Capturar solo estados, sin tokens.

| Escenario | Resultado indispensable |
|---|---|
| Usuario BUSINESS auténtico | Inicio en navegador sistema, contraseña correcta + WebAuthn con verificación de usuario real |
| Contraseña incorrecta | No se emite desafío útil ni sesión; auditoría correcta |
| MFA rechazado, expirado o repetido | No hay sesión; contador/CAS y límite de intentos conservados |
| PKCE | `state`, código de un solo uso, callback loopback, DeviceProof; repetición y cliente incorrecto rechazados |
| Sesión | Refresh seguro, SSA firmada y vinculada a dispositivo, recuperación tras reinicio, sin fuga al renderer |
| SAS | Firma, generación y scopes autorizados; usuario/rol sin grants no abre funciones |
| BUSINESS vs GLOBAL | Separación real: rol tenant ≠ privilegio plataforma, sin promoción por cambio de URL/cookie |
| RBAC + RLS | OWNER/ADMIN/CAJERO/inventario solo acceden a sus permisos; otra empresa/sucursal siempre denegada |
| Revocación | Cierre sesión/navegador, revocar dispositivo, usuario, membresía, MFA o raíz: denegar en Service y Central |
| Offline y regreso | Sin infraestructura Central, no se concede nuevo login ni privilegios artificiales; recuperación usa solo sesiones válidas |
| Reinicio | DPAPI conserva custodia legítima, sin volver a generar identidad al iniciar Desktop |
| Segundo usuario Windows | No puede leer secreto, abrir canal autorizado ni heredar sesión de usuario anterior |
| Instrumentación | Logs sin contraseñas, tokens, material privado, cookies o SID completo |

**Criterio de firma:** cada fila con evidencia real, actor, fecha, SHA, resultado y aprobación explícita del operador. Una captura del dashboard NO demuestra SSA/SAS o RBAC. Fallo de un caso deja issue #98 abierta.

## 5. Impedimentos actuales que no deben disimularse

- No hay servicio `CamachoPOSLocalService` instalado en el Windows comprobado, ni variables locales comerciales/operativas en ese momento.
- No se ha entregado configuración Central HTTPS, usuario real con MFA físico, dispositivo DEV-003 o confianza SSA/SAS registrada para la certificación.
- **SCM virtual ↔ usuario interactivo sigue sin bridge cruzando identidades**, así que la certificación del login mediante WinSW no puede afirmarse. El host interactivo permite un ciclo físico inicial sin rebajar la custodia y sin dar por resuelto el SCM.
- Hasta cerrar esas dependencias y ejecutar pruebas integrales, el PR #99 seguirá **Draft** y la issue #98 **abierta**.

**Prohibiciones:** no eliminar MFA, no introducir fixture permanente, no persistir tokens sin OS-bound, no copiar key a GitHub, no desactivar RLS/TLS, no ejecutar `reset/clean` destructivo, no activar CI remoto, no trabajar en módulos ajenos al login.

## 6. Prevención de duplicidad de Service

El lanzador interactivo de login comercial rehúsa iniciar procesos si el SCM presenta `CamachoPOSLocalService` en `Running`, `StartPending` o `StopPending`. **No** detiene el servicio ni abre una segunda SQLite deliberadamente; el operador debe revisar primero la instalación y su estado. Sigue siendo necesario verificar manualmente que no haya otro proceso Local Service interactivo usando la misma identidad, porque un proceso suelto puede no figurar en el SCM. La ocupación de named pipe debe fallar cerrado.

## 7. Evidencia interna aislada anterior a la prueba humana

Los módulos exactos descargados del commit del PR #99 se verificaron con `git hash-object`:
- `windows-commercial-host-identity.ts`: blob `c4e2c29118ac6d033bd2697fa9fa9ca39e338392`. `tsc --strict --noEmit` PASS y 12 casos Node.js ejecutados PASS, con runner Windows inyectado (sin PowerShell/Win32 reales).
- `central-login-preflight.ts`: blob `f53dfd5c20f14294bc6807856d604e058d45f981`. `tsc --strict --noEmit` PASS y 12 casos Node.js ejecutados PASS, con módulo de certificación Central simulado (sin certificados, PostgreSQL ni red reales).

**24/24 internos aislados.** No es equivalente a compilar el monorepo, ejecutar todas las suites Vitest del PR #99 o certificar el entorno Windows. Los 32 PASS previos del propietario pertenecen a la base PR #96 y no se reutilizan como prueba de PR #99.
