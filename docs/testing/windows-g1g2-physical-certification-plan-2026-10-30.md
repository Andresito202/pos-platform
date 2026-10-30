# Certificación física G1/G2 — Windows, 30-oct-2026

**Estado: NO CERTIFICADO.** Esta guía registra bloqueos y orden de ejecución. No autoriza ni automatiza cambios privilegiados. El gate `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` permanece cerrado.

## Evidencia del equipo operador (2026-10-30)

- Windows 10 Pro 19045, PowerShell de VS Code elevado confirmado con `net session`.
- Addon `camacho_windows_pipe.node` compilado en MSVC/Node 22.19.0; importación y siete exportaciones nativas comprobadas. Esto **no** prueba SCM.
- `PosLocalService` existente: RUNNING, cuenta `.\Usuario`, ejecutable WinSW en `apps/pos-local-service/.lab-state/service/pos-local-service.exe`; proceso hijo Node. Contiene SQLite `.db/.db-wal/.db-shm`, `.secret` y `.dpapi`. **Prohibido modificar, copiar parcialmente, reusar o detener como parte de esta certificación**.
- `CamachoPOSLocalService`: no registrado; `C:\ProgramData\CamachoPOS-G1G2-Lab`: inexistente.
- Hyper-V disabled, `vmms` ausente: no VM desechable preparada.
- WinSW v2.12.0 con hash del candidato `05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA`, **Authenticode NotSigned**. El validador `windows-winsw-readiness.ps1` requiere firma Valid, thumbprint aprobado, hash aprobado, versión y ACL/owner. El hash por sí solo NO pasa el gate.
- `windows-g1g2-lab-safety-preflight.ps1` ejecutado en Windows elevado: `WinSWAuthenticodeValid=False`, `CommercialScmCertified=False`, `HumanMfaCertified=False`.

## Decisiones requeridas antes de la instalación

1. **Entorno**: preferir VM Windows separada, restaurable y sin datos de clientes. Si se autoriza prueba en el host principal, documentar explícitamente el riesgo de coexistencia, puertos, procesos, rutas, rollback y restauración; no tratar dos directorios como aislamiento equivalente a VM.
2. **Wrapper autorizado**: proporcionar un WinSW v2.12.0 firmado con Authenticode mediante una cadena y un thumbprint corporativos aprobados, custodiando clave privada fuera del repositorio. Verificar `Get-AuthenticodeSignature` => `Valid` en el equipo destino, hash y ACL. La firma del commit/release GitHub NO es una firma del PE. No usar certificado autofirmado instalado silenciosamente en Trusted Root; no desactivar el gate. Si la organización carece de una cadena adecuada, la certificación comercial queda bloqueada hasta aprobar firma/host alternativo y revisar contrato.
3. **Runtime aislado**: binario WinSW, XML, Node y bundle inmutables/protegidos; directorio de datos nuevo, exclusivo de G1/G2. Servicio `CamachoPOSLocalService` con cuenta `NT SERVICE\CamachoPOSLocalService`. El SID exacto y el logon SID se deben obtener del Windows real; no copiar SID de otra máquina/logon.
4. **Material de confianza**: certificados/identidades del instalador autorizados, instalación y dispositivo genuinos, provision SERVICE/DESKTOP `WindowsScmHandoffProvisionSchema` versión 1, receptor DPAPI bajo Desktop y firmante DPAPI bajo cuenta del servicio, pins y hash del addon, vigencia y ACL reales. No imprimir ni comprometer claves privadas/secretos. La generación de provisiones debe seguir las funciones ya existentes, no archivos de ejemplo rellenados con IDs ficticios.

## Secuencia y criterios de aceptación

**Fase A — preparatoria, sin servicios:**

```powershell
Set-Location C:\Proyectos\pos-platform
git status --short --branch
git rev-parse HEAD
powershell.exe -NoProfile -File tools/operators/windows-g1g2-lab-safety-preflight.ps1
powershell.exe -NoProfile -File tools/operators/windows-winsw-readiness.ps1 -WinSWPath '<ruta binario firmado protegido>' -ExpectedSha256 '<SHA256 aprobado>' -ApprovedSignerThumbprint '<SHA1 del firmante aprobado>'
```

Se requiere `BinaryReviewReady=True` **y** revisión separada de la política de confianza. El runner nunca interpreta `ServiceRegistered` ni `BinaryReviewReady` como prueba de interop. En la máquina actual el preflight falla por firma y por certificación pendiente: es esperado.

**Fase B — operador de VM aprobada:** backup/snapshot previo, registrar manifiesto no sensible de instalación, revisar rutas y ACL, verificar servicios/puertos existentes; provisionar cuenta de servicio, descriptor, binarios y secrets con responsabilidades separadas, sin tocar `PosLocalService`. Solo después registrar servicio bajo SCM. Comprobar `sc.exe qc CamachoPOSLocalService`, `sc.exe queryex CamachoPOSLocalService`, token de Node hijo, identidad, SID, sesión y logs depurados. Si falla, revertir **solo** recursos nuevos de la VM, conservar evidencias.

**Fase C — transporte nativo:** ejecutar el test `apps/pos-local-service/tests/windows-scm-physical.test.ts` simultáneamente desde el proceso real bajo SCM y el proceso Desktop autorizado usando `CAMACHO_SCM_PHYSICAL_PROVISION` de cada rol. Consultar instrucciones de `docs/testing/windows-scm-g1-g2-materialization-2026-10-29.md`. Para cada rol **1 passed / 0 skipped**, comprobar PIN del firmante, SID/logon/session y hash addon, doble canal, lease SQLite, revocación antes de cierre, rechazo posterior y restablecimiento con lease nuevo; negativo de suplantación y reinicio. Repetir receptor usando Electron como host y luego aplicación Electron real; no sustituir el peer por mock.

**Fase D — regresión y funcional:**

```powershell
powershell.exe -NoProfile -File tools/operators/windows-login-final-checks.ps1 -Run
```

Registrar commit SHA, versiones, hashes, nombre de pruebas, PASS/FAIL/SKIP, tiempos y logs sanitizados. Cualquier skip en test físico bloquea certificación. `AUTO_CHECKS_PASSED` NO implica SCM real, HTTPS o MFA.

**Fase E — ceremonia humana (última):** HTTPS Central con confianza real, contraseña/WebAuthn UV, DeviceProof y PKCE, SAS/SSA firmadas, BUSINESS/GLOBAL separados, grants RBAC efectivos, refresh/reinicio/logout/revocación; fallar cerrado sin snapshot/grants.

## Política de cierre

No retirar `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`, no fusionar PR #99, no cerrar issue #98 ni publicar servicio comercial hasta evidencias físicas, de seguridad, humanas y de revisión. Los resultados de octubre 30 prueban inventario Windows y compilación nativa **únicamente**. La cuenta virtual y el SID del servicio no deben confundirse con un login interactivo ni con un hash de ejecutable.


## Decisión de producto 30-oct-2026 — sin compra de certificado de firma Windows

**Decisión expresa del propietario:** no presupuestar certificados comerciales Authenticode/OV/EV, HSM ni Azure Artifact Signing para permitir el funcionamiento del POS. La inversión prevista se limita inicialmente a dominio y VPS. Esto no renuncia a HTTPS confiable (puede obtenerse sin costo), integridad de artefactos, autenticación mutua del canal, ACL, DPAPI, aislamiento multiempresa o revisión de seguridad.

**Separar controles:**
- `WINSW_APPROVED_AUTHENTICODE_SIGNER_REQUIRED` es una **política local de distribución** que actualmente impide aprobar ese wrapper sin certificado. En un procedimiento de laboratorio explícito, puede utilizarse un ejecutable de procedencia y SHA aprobados sin considerarlo una distribución comercial; nunca falsear `BinaryReviewReady`, modificar trust stores en secreto ni reutilizar datos productivos.
- `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` protege la **seguridad del canal entre identidades**. Se conserva hasta probar SCM real, tokens, DPAPI, pins, leases, revocación, reinicios y Electron real. Eliminar firma de código no demuestra esas garantías.
- Antes de ofrecer Windows a clientes, evaluar y documentar una política de distribución **sin firma comercial** con hashes reproducibles, origen TLS, verificación local del artefacto, ACL sobre binarios y rutas, instalador explícito, advertencias SmartScreen y compatibilidad con políticas de ejecución del cliente. No prometer que todas las máquinas aceptarán software sin firma ni que los hashes sustituyen autenticación del editor. Una revisión de seguridad debe aprobar cualquier cambio al validador actual; prohibido hacer bypass silencioso.

**Capacidad objetivo:** más de 1.000 usuarios del ecosistema POS. NO equivale a 1.000 conexiones activas; modelar y medir empresas, sucursales, cajas, usuarios concurrentes, TPS, p95/p99, errores, conexiones PostgreSQL, colas offline, conflictos e idempotencia. No declarar capacidad certificada hasta superar pruebas de carga escalonadas, aislamiento multi-tenant y recuperación.

**Estado:** decisión registrada; no hay nuevo servicio instalado, no hay test físico SCM entre identidades y no existe certificación de 1.000 usuarios. El procedimiento comercial de WinSW firmado descrito arriba queda como **política heredada pendiente de revisión**, no como compra aprobada.
