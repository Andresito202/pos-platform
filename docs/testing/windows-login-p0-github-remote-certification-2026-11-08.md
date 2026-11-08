# P0 Windows — Enlace seguro entre GitHub Actions y laboratorio comercial

Fecha: 2026-11-08. Rama: `feat/p0-windows-login-install-readiness`. Alcance: DEV-003, BUSINESS, SCM↔Electron, MFA, RBAC/RLS, revocación. **No es una certificación**.

## Diagnóstico verificado

- `Andresito202/pos-platform` es un repositorio **público**. No conectar sin controles un runner persistente que tenga acceso a Central, PostgreSQL, claves privadas, material DPAPI o credenciales BUSINESS.
- El workflow `.github/workflows/windows-login-p0-validation.yml` acredita contratos aislados y publica explícitamente `COMMERCIAL_LOGIN_CERTIFIED=NO`, `CENTRAL_DEV003_REAL_ENROLLMENT=NOT_TESTED`, `HUMAN_MFA_LOGIN=NOT_TESTED`.
- `.github/workflows/windows-scm-native-artifact-lab.yml` ejecuta pruebas de SCM/DPAPI en Windows desechable, pero declara `G2_REAL_SCM_BUSINESS_SESSION=NOT_TESTED`.
- `tools/operators/windows-login-lab-commercial-readiness.mts` comprueba la base del laboratorio en solo lectura; no crea credenciales, enrolamientos ni sesiones.
- `tools/operators/windows-login-lab-commercial-provision.mts` exige el contexto Windows Server 2022 autorizado, custodia ACL y archivos legítimos; no es una herramienta para fabricar un enrollment.

## Separación obligatoria de entornos

1. **CI público:** conservar GitHub-hosted `windows-2022` / Ubuntu para compilar, probar contratos y probar el canal Windows con identidades efímeras. Sin secretos comerciales ni acceso al almacenamiento del laboratorio.
2. **Laboratorio privado:** conservar Central, PostgreSQL, el SCM real, los archivos de provisión y los factores humanos bajo la autoridad del operador. Un agente de ejecución, si se instala, debe vivir en infraestructura desechable/aislada, sin compartir usuario, volumen ni custodio de secretos con el SCM/DB de negocio.
3. **Enlace seguro:** preferir un controlador privado de despliegue que extraiga un commit SHA aprobado y publique **solo un recibo redactado y firmado**, en lugar de ejecutar workflows del repositorio público dentro de la máquina con claves. No exponer RDP, puerto PostgreSQL 55433 ni `auth.camacho-pos.local:8443` a Internet.
4. No usar `pull_request_target`, scripts de PR no confiables con secretos, runner persistente en la VM de SCM, TLS deshabilitado, cuenta SYSTEM para pruebas de usuario BUSINESS o alteración de ACL para forzar el handshake.
5. La habilitación de un entorno privado, la inscripción del agente y el transporte de la evidencia requieren acciones administrativas de GitHub y acceso a la infraestructura que el conector de repositorio **no proporciona**. No declarar dicha habilitación como realizada.

## Secuencia de ejecución autorizada en el laboratorio

1. Seleccionar y fijar el SHA revisado del PR #99 y conservar `git rev-parse HEAD`; mantener el PR en Draft. No usar código de otros PR ni cambios no revisados.
2. Comprobar certificado TLS, origen `https://auth.camacho-pos.local:8443` y PostgreSQL `camacho_windows_login_lab` con rol `pos_platform_app`, `sslmode=verify-full`, sin publicar contraseñas.
3. Validar la provisión con la herramienta canónica y un candidato administrado previamente protegido; la opción `--publish` es **una acción separada** posterior a validación y aprobación. No crear UUID/usuarios o claves de prueba para hacer pasar el gate comercial.
4. Ejecutar el inspector de preparación con un operador Windows autorizado; reportar exclusivamente `blockers`, `status`, referencia al SHA y hash de la evidencia, nunca archivos protegidos.
5. Exigir `deviceRegistry.status=ACTIVE`, `scopeMatches=true`, `keyMatches=true`, `activeCredentials>0`, UUIDv7 compatible, contexto humano activo y metadatos SCM vinculados; incluso `PREREQUISITES_PRESENT_UNCERTIFIED` **no** certifica la sesión.
6. Probar el mismo servicio real bajo SCM virtual y Electron en sesión de escritorio por su transporte nativo, con identidad de proceso y canal atestados. Rechazar si se usa el launcher de misma cuenta como sustituto.
7. Completar login BUSINESS real con contraseña + WebAuthn UV, PKCE/código de uso único, DeviceProof, SSA/SAS verificadas, rol/tenant/company/branch auténticos. La intervención humana del titular del factor no puede reemplazarse por un fixture.
8. Ejecutar allow/deny RBAC+RLS para las identidades realmente provisionadas, segundo usuario Windows, replay, refresh, expiración, logout, revocación del dispositivo y pérdida de conectividad. Guardar auditoría de Central y receptor sin tokens ni PII.
9. Consolidar recibos por SHA y por escenario con resultado, actor responsable, timestamp y procedencia. Rechazar recibos incompletos, sin firma confiable, de otros commits o generados por fixtures; no aceptar un simple `success` de CI como prueba de E2E.
10. Solo después de revisión y aprobación explícita de los recibos: evaluar por separado la retirada del fail-closed `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`, el cierre de issue #98 y el cambio de estado del PR #99. No automatizar el levantamiento del bloqueo por presencia de archivos.

## Comandos de referencia (en laboratorio Windows autorizado)

```powershell
git status --short --branch
git rev-parse HEAD
# Sin mutaciones: los parámetros específicos del lab deben corresponder al runtime instalado
pnpm --filter @pos-platform/target-migrations exec node --import tsx tools/operators/windows-login-lab-commercial-readiness.mts --inspect --lab-root "C:\CamachoPosScmLab\<LAB_ID>"
```

**Nota de ejecución:** la invocación de ejemplo depende de la resolución de rutas del workspace; desde la raíz, también puede ejecutarse mediante `pnpm exec tsx tools/operators/windows-login-lab-commercial-readiness.mts --inspect --lab-root ...`. El identificador real del laboratorio se obtiene localmente; no reemplazarlo con uno inventado.

## Estado al redactar este documento

No se dispone desde el conector de GitHub de permisos para crear/configurar runners, environments o secrets ni de una sesión de escritorio remota autenticada. No se ejecutó inscripción DEV-003, provisión protegida, MFA humana ni sesión BUSINESS real. **COMMERCIAL_LOGIN_CERTIFIED=NO; bloqueo activo; PR #99 Draft.**
