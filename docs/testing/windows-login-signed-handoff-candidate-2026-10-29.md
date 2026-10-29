# P0 Windows — handoff firmado, consumo único y revocación (candidato aislado)

**Ámbito:** PR #99 / issue #98 / rama `feat/p0-windows-login-install-readiness`. Se continúa `f83ded28 → 24d9dfa7 → b59d551d` sin cambiar la arquitectura comercial ni el descriptor WinSW. La ruta de login interactivo sigue como estaba.

## Qué aporta el incremento

1. `WindowsChannelHandoffSchema` y la cápsula RSA-OAEP-SHA256 existente siguen intactas. No se comparte el secreto maestro del Service.
2. `sealSignedWindowsHandoffForCurrentService`: verifica token real del Service virtual, SID y sesión 0; firma la cápsula con clave Ed25519 privada **que debe suministrar la autoridad de instalación por custodia Service/DPAPI CurrentUser**. No crea una clave privada ni un perfil autorizado.
3. `verifySignedWindowsHandoffCandidate`: exige clave pública Ed25519 fijada *fuera de la cápsula* por el instalador, pin SHA-256, firma, hash de perfil, período de validez y contexto de instancia. Rechaza firmantes distintos, falsificación y alteraciones.
4. `consumeSignedWindowsHandoffForCurrentRecipient`: usa el receptor DPAPI del usuario/logon Windows reales, requiere una autoridad de revocación y un `LocalChannelReplayStateStore` sin valores por defecto. El consumo `sequence=1` del `leaseId` permite reutilizar el `SqliteReplayStateStore` duradero y existente **cuando el Service incorpore este contrato en su frontera de confianza**. En las pruebas unitarias puede usarse almacenamiento en memoria, pero no se acepta eso como prueba de durabilidad ni revocación entre procesos.
5. En fallos tras descifrar se limpia la clave temporal. Las APIs antiguas siguen disponibles para el arnés histórico, **no autorizan acceso comercial**.

## Lo que NO se ha hecho

- NO se activó SCM comercial: `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` permanece. No hubo cambios en `windows-service-descriptor.ts` ni en la DACL del named pipe.
- NO existe todavía un firmante operacional con material protegido bajo la cuenta `NT SERVICE\\CamachoPOSLocalService`, ni cadena de provisión firmada/aprobada.
- NO está cableada la autoridad de revocación confiable al Service, a su SQLite o al ciclo de vida del canal. La interfaz obliga a declararla, pero no demuestra revocación en caliente de canales ya abiertos.
- NO se certificó identidad del par mediante handle nativo de Windows en dos cuentas/logons. **No** agregar `FILE_GENERIC_WRITE`/Everyone al pipe: Windows comparte `FILE_APPEND_DATA` y `FILE_CREATE_PIPE_INSTANCE`; hay que negociar permisos mínimos y verificar el token real del cliente/servidor.
- NO se ha efectuado login humano BUSINESS ni GLOBAL contra Central provisionada.

## Comprobaciones para el operador Windows

Tras `git pull --ff-only`, en el mismo equipo con SHA exacta y sin cambios rastreados:

```powershell
pnpm --filter @pos-platform/contracts typecheck
pnpm --filter @pos-platform/local-channel typecheck
pnpm --filter @pos-platform/local-channel exec vitest run tests/windows-handoff.test.ts --no-file-parallelism
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/windows-winsw-readiness.test.ts --no-file-parallelism
```

Reportar resultados reales por SHA. La batería anterior **21+3 PASS y dos typechecks** corresponde al commit `b59d551d`; no se atribuye al nuevo incremento. Las **341** pruebas anteriores y **11** del laboratorio se mantienen como registros históricos; no se suman a la ejecución actual ni se reejecutan sin razón.

## Gates restantes para declarar login P0 certificado

- **G1 — Service/transport:** provisión real de firmante en custodia DPAPI Service, autoridad persistente de consumo/revocación, protección de sesiones activas; SID del cliente/servidor probado por Windows y ACL de pipe que no permita crear instancias no autorizadas. Prueba positiva y negativa con dos cuentas logon diferentes; requiere entorno Windows elevado y WinSW aprobado. No liberar SCM comercial antes.
- **G2 — Central auténtica:** PostgreSQL operativo aislado de fixtures, HTTPS legítimo, raíces SSA/SAS operativas y distribución, registro de dispositivo, pertenencias/roles reales y MFA humano. Puede prepararse en PC sin comprar VPS, pero no se sustituye con certificados ficticios de laboratorio.
- **G3 — Ceremonias y aceptación:** BUSINESS y GLOBAL por separado, contraseña + MFA físico + callback PKCE, SSA/SAS, RBAC/RLS, revocación, recuperación tras reinicio, usuario/tenant ajenos denegados y evidencia sin secretos. Al terminar G1–G3, repetir solo gates afectadas y firmar el acta humana.

**Clasificación actual:** pruebas Windows del candidato previas PASS; nuevas verificaciones firmadas **pendientes de ejecución Windows**. PR #99 sigue Draft, issue #98 abierta. No activar código inseguro, no anunciar `PRODUCTION` ni bloquear el avance del laboratorio interactivo por ausencia de VPS.
