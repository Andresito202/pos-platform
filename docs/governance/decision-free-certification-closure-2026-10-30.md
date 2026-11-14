# Decisión del propietario — cierre definitivo del frente de certificación gratuita (2026-10-30)

**Estado: CERRADO EN SU ALCANCE, NO REABRIR POR INICIATIVA DEL AGENTE.**

## Decisión vinculante para Codex, Work y colaboradores

Desde el 30 de octubre de 2026, el propietario dispone dejar de invertir trabajo en obtener, investigar o adaptar el producto para certificados externos, firmas Authenticode, MSIX, Microsoft Store y GitHub Actions. El trabajo siguiente es **materialización funcional del POS comercial** sobre la línea activa, no nuevas rondas de certificación.

**Evidencia aprobada por ejecución real en Windows (observada por el propietario):**

- `pnpm certify:local:free`: **10 de 10 controles PASS**, HEAD `1efddb4ac18f17811eeca0b298ccb7049afeb701`. Recibo local generado: `C:\Users\Usuario\AppData\Local\Temp\camacho-pos-free-cert-jem1gl\receipt.json`.
- `tools/operators/windows-central-sync-isolated-gate.ps1 -Run`: **CENTRAL-SYNC GATE: VERIFIED** sobre HEAD `72baef5e7e58e1cb2886ea771e6f7c6e90db5d13`: SQLite → Central HTTP → PostgreSQL; checkpoint/inbox, pérdida de respuesta, recuperación `IN_FLIGHT`, idempotencia, prueba Ed25519, rechazo de escritura cruzada, dos tenants auténticos, aislamiento RLS de lectura por rol y contexto transaccional, emisión atómica de credencial y rechazo de reutilización.
- `tools/operators/windows-installation-readonly-certification.ps1`: **WINDOWS_SCM_READONLY_RESULT=NOT_CERTIFIED**, porque `CamachoPOSLocalService` **no estaba instalado**; esto **no es un fallo del software instalado** ni un PASS de instalación. Recibo local: `C:\Users\Usuario\AppData\Local\Temp\camacho-pos-windows-readonly-ae550d93dc834beeba6d859a3547e455\receipt.json`.

Estos son controles técnicos internos gratuitos. **No existe certificación externa emitida, firma pública del instalador, certificación productiva integral ni garantía de 100 % de funcionalidades comerciales**. No manipular ni reinterpretar el alcance.

## Reglas de cierre

1. **No bloquear desarrollo, distribución controlada, pruebas ni materialización por GitHub Actions**: limitaciones de plan/créditos o jobs fallidos no son razón para detener la implementación. Mantener tests locales reproducibles, evidencia hash-bound y revisión de código.
2. **No comprar certificados ni suscripciones** y no depender de Microsoft Store, MSIX, SignPath, Code Signing ni firma pública.
3. **No reabrir certificación de forma autónoma**, ni añadir más gates documentales como sustituto de implementar módulos reales. Volver a la herramienta de prueba existente **solo** si cambia código cubierto, si surge un bug reproducible o si hace falta demostrar el comportamiento de una nueva integración; esto es regresión técnica ordinaria, no una nueva campaña de certificación.
4. **No retirar seguridad ni cambiar la arquitectura comercial** para obtener un certificado: se conservan Electron, servicio local, privilegios mínimos, WinSW/SCM donde corresponda, SQLite offline, PostgreSQL central, multiempresa, integridad, credenciales, autorización y hardware.
5. **No usar certificados autofirmados como si fueran de confianza pública** ni afirmar que SmartScreen no advertirá sobre binarios sin firmar. Firmas comerciales externas quedan fuera de alcance y no condicionan el desarrollo.
6. No ejecutar `git reset --hard`, `git clean`, `force-push`, cambios sobre preproducción `55435`, instalaciones destructivas o operaciones SCM en el PC del propietario sin alcance y consentimiento específico.
7. **No habilitar login comercial SCM** eludiendo el bloqueo `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`. Es una brecha **funcional y de seguridad a resolver**, no una razón para reabrir el debate de certificados. La ausencia del servicio instalado se gestionará en un laboratorio aislado antes de la instalación comercial.

## Prioridad siguiente: materialización funcional del POS

Continuar en la **misma rama activa** `feat/p0-windows-login-install-readiness`, PR #99, sin abrir líneas paralelas. Auditar primero el código actual y el tablero existente.

Secuencia de trabajo concreta:

1. **G1/G2 — Login Windows real:** cerrar interoperabilidad de identidad entre Electron interactivo y Local Service bajo SCM; vincular canal/DPAPI/acceso al named pipe con mínimo privilegio; no compartir secretos entre usuarios por medio de ACL abiertas; preservar semántica de DeviceProof, SSA, MFA/PKCE y fail-closed.
2. **Arranque e instalación funcional:** build del addon nativo Windows auténtico; empaquetado con checksum y carga real; servicio WinSW con cuenta virtual en laboratorio, lifecycle stop/start y recuperación sin pérdida SQLite. El fixture PE estructural no sustituye un binario ejecutable.
3. **Ceremonia humana al final:** navegador HTTPS, autenticación MFA, BUSINESS, grant/snapshot, vuelta a Electron y habilitación real de pantallas por permisos. No adelantar pruebas manuales de PC cuando todavía pueda avanzarse con código y pruebas automatizadas.
4. **POS comercial end-to-end:** venta, inventario, cliente, caja, pagos y hardware Windows/Android/Linux según prioridades del tablero; conservar operación offline y reconciliación al recuperar conectividad. No declarar capacidad completa sin pruebas físicas y flujo real.

Cada tarea debe terminar con: archivos realmente modificados, commits, tests locales/aislados ejecutados (o explícitamente pendientes), bug resuelto, riesgo residual y **única acción manual indispensable** para cerrar la fase. No prometer ejecución en segundo plano ni resultados no observados.

## Criterio de reapertura

Solo una **orden explícita posterior del propietario** puede reabrir decisiones de **certificación externa**. La obligación normal de probar cambios, auditar vulnerabilidades, cumplir normas y conservar seguridad continúa vigente, sin que ello reabra este frente.

**Nota:** la evidencia citada está ligada a SHAs históricos específicos; cualquier nuevo HEAD exige las pruebas de regresión pertinentes a su alcance, pero no volver a discutir la estrategia de certificación gratuita.
