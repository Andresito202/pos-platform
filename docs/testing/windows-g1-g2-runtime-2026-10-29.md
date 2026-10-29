# G1 + G2 — ejecución sobre el runtime y resultado pendiente

Fecha: 29 de octubre de 2026. PR #99 / issue #98. Rama `feat/p0-windows-login-install-readiness`.

**No se alcanzó el cierre integral solicitado. G1 continúa BLOQUEADO y G2 queda PARCIALMENTE IMPLEMENTADO Y PROBADO.** Se publicó código ejecutable del cierre de conexiones y logout; no se publicó una autenticación SCM multicuenta ni se conectó el ledger de leases a ese transporte inexistente. No se declara certificación ni preparación productiva.

## 1. Continuidad, commits y alcance

HEAD inicial real: `0978ec11b50360fbf2b9738f52b1a97c4f470030`. Frente a `1cc144a3`, GitHub mostró únicamente `1fd978ef…` y `0978ec11…`: propagación de cancelación desde el cierre del socket a los dos caminos del handler. No había una integración G1 ni un registro de conexiones asociado al ledger de leases.

Implementación de esta ejecución: [`246807297100909917f7111bd5aced3dc6425b3e`](https://github.com/Andresito202/pos-platform/commit/246807297100909917f7111bd5aced3dc6425b3e), hijo directo del HEAD inicial. Publicación fast-forward con expected SHA y `[skip ci]`. El commit documental posterior conserva los mismos blobs de runtime y pruebas.

Se leyó el informe [de continuidad](windows-login-continuity-audit-2026-10-29.md), AGENTS y el delta remoto. La copia local de fuentes pertenece al entorno Linux del asistente; no acredita el estado de `C:\Proyectos\pos-platform`. No se solicitó ejecutar Actions, fusionar PRs ni modificar bases persistentes.

## 2. Archivos modificados

| Archivo | Cambio efectivo |
|---|---|
| `apps/pos-local-service/src/channel/server.ts` | Registro de conexiones por ID del servidor; desconexión síncrona, retirada después de respuesta, cancelación inmediata y limpieza idempotente. Se reutiliza el AbortController de `0978ec11`. |
| `apps/pos-local-service/src/channel/local-channel-component.ts` | Conecta el cierre de sesión comercial al servidor real; libera el registro al detenerse o fallar el arranque; impide un segundo start del mismo componente ya iniciado. |
| `apps/pos-local-service/src/commercial/commercial-component.ts` | Notifica los IDs afectados después de persistir el tombstone y retirar bindings. Registro único del callback del transporte. |
| `apps/pos-local-service/src/session/session-binding-registry.ts` | `releaseSession` devuelve los IDs que acaba de invalidar; no crea un segundo registro de identidad. |
| `apps/pos-local-service/tests/channel-cancellation-lifecycle.test.ts` | Ocho pruebas con sockets TCP reales, cancelación, cierre, timeout, resultado tardío, punto de commit y recuperación idempotente SQLite. |
| `apps/pos-local-service/tests/native-session-close-lifecycle.test.ts` | Cuatro pruebas de tombstone durable, orden de invalidación, fallo de auditoría y liberación del callback. |
| `apps/pos-local-service/tests/channel-commercial-transport.test.ts` | En Linux adapta únicamente bind/connect a TCP loopback efímero; Windows conserva los pipes. Reejecuta los ocho casos que antes fallaban con EPERM. |
| `tools/operators/windows-login-final-checks.ps1` | Incluye las dos pruebas nuevas en el runner existente. La batería TCP está marcada solo para no-Windows. No se creó otro runner. |

## 3. Defectos corregidos

### Cierre de socket e identidad diferidos

El código de entrada propagaba cancelación cuando llegaba el evento close, pero los errores y timeouts primero llamaban socket.destroy. El registro podía seguir existiendo hasta el evento posterior. La prueba de resultado tardío observó esa ventana.

Ahora una sola función close, usada por errores, exceso de cola, desconexión explícita, stop y evento close, marca la conexión cerrada, aborta las solicitudes, borra protocolos negociados, retira registros, destruye el socket y ejecuta una sola vez el callback de liberación. Una excepción de ese callback no impide cerrar las demás conexiones. No se sustituyó el mecanismo de AbortSignal previo.

### Logout invalidaba bindings, pero no cerraba sus conexiones

`CommercialComponent.closeNativeSession` ya persistía BUSINESS_SESSION_CLOSED y retiraba bindings. No avisaba al servidor para cerrar los sockets asociados.

Ahora el orden ejecutable es:

1. Guardar el tombstone con el almacén canónico SQLite.
2. Retirar todos los bindings de esa sesión y obtener sus IDs del servidor.
3. Notificar al LocalChannelComponent que tiene el servidor real.
4. Desconectar y cancelar inmediatamente las conexiones compañeras.
5. Retirar la conexión iniciadora: pausar entrada y rechazar trabajo nuevo/en cola, permitir el envío de la respuesta en curso y cerrarla a continuación.

Si falla la escritura del tombstone, no se anuncia un cierre ni se invalidan primero los bindings. Los timeouts siguen limitando una respuesta de logout pendiente. La entrega de la respuesta no se garantiza frente a una caída de red; la persistencia y la idempotencia permiten reconocer el resultado confirmado.

Esta integración es de **sesión BUSINESS**, no una revocación completa del lease de Windows. No se confunden ssaSessionId, leaseId, transportSessionId y connectionId.

## 4. Qué conexiones funcionan y cómo se autentican

Se conserva el canal convencional MAC/anti-replay y su arranque Windows del mismo usuario/logon. El ID de conexión lo genera el servidor y no se recibe desde el payload. El cierre de sesión ahora está conectado desde CommercialComponent a ese servidor dentro de LocalChannelComponent; no depende de que un test llame a una utilidad aislada.

Las pruebas TCP abren net.Server y sockets reales y cruzan el cliente y servidor canónicos con sus marcos, MAC, negociación, colas y esquemas. En los tests se adapta la ubicación de escucha y conexión mediante vi.mock; no se simulan los bytes ni los eventos de socket. Las respuestas del test comercial siguen siendo fixtures y no constituyen E2E de negocio.

**Autenticación G1 de pares Windows: no implementada en esta ejecución.** Obtener el token propio con WindowsIdentity no prueba la identidad del otro extremo. Abrir otro pipe por su nombre tampoco prueba que sea la conexión que atiende la solicitud. No se aceptó un SID declarado en el payload, un booleano de configuración ni un pin recibido dentro de la cápsula como sustituto de esa evidencia.

El servidor Node actual no dispone de una integración nativa comprobada que entregue la identidad del peer vinculada al handle de esa conexión. Aún falta implementar el adaptador nativo y su custodia/aprovisionamiento, conectarlos al mismo handoff firmado y demostrar la instancia SCM y los derechos del pipe. Esto es trabajo de código pendiente, además de pruebas Windows pendientes; no se atribuye todo el bloqueo a la ausencia del PC.

## 5. Consumo, revocación y punto de commit

`SqliteWindowsHandoffLeaseAuthority` se conserva sin un nuevo mecanismo paralelo: firma/cápsula existentes, consumo único, revocación persistente y reloj del Service en la aceptación. Sus diez pruebas de SQLite siguen aprobadas, incluidas reapertura, expiración y revocación. **Todavía no vincula leases a conexiones SCM ni valida el lease antes de cada operación de ese transporte.**

Los nuevos mecanismos de desconexión del servidor son utilizables por el Service, pero su existencia no completa por sí sola el registro por lease. No se asignaron leases ficticios a las conexiones convencionales para aparentar esa integración.

Se probaron dos escenarios adicionales sobre OperationConfirmationStore canónico y SQLite temporal:

- Antes del commit síncrono: la señal de cancelación impide ejecutar el store en el handler de prueba; quedan cero operaciones y cero entradas de auditoría.
- Después del commit y antes de recibir la respuesta: desconectar no deshace el efecto. Tras cerrar/reabrir SQLite, el reintento devuelve ALREADY_CONFIRMED, con una operación y una auditoría.

Estas pruebas fijan el comportamiento observado de ese store con un handler de laboratorio. No demuestran que todas las operaciones asíncronas comerciales tengan ya una barrera de autorización por lease antes de cada efecto persistente. No se afirma que AbortSignal revierta transacciones confirmadas ni efectos externos.

## 6. Pruebas ejecutadas y fallos conservados

Entorno: Linux remoto, Node 24.22.1, TypeScript 6.0.3, Vitest 4.1.11. No Windows, SCM, WinSW, DPAPI real ni autenticador físico. Todas las bases utilizadas son SQLite temporales de los tests.

| Batería sobre los blobs publicados | PASS | FAIL | Omitidas |
|---|---:|---:|---:|
| Cancelación/cierre sobre TCP real | 8 | 0 | 0 |
| Cierre durable de sesión y callback | 4 | 0 | 0 |
| Ocho casos comerciales de transporte con fixtures, ahora en TCP Linux | 8 | 0 | 0 |
| Regresiones del handler comercial | 47 | 0 | 0 |
| Ledger SQLite de leases existente | 10 | 0 | 0 |
| Denegación/readiness WinSW existente | 1 | 0 | 2 |
| Handoff criptográfico existente | 22 | 0 | 2 |
| **Total de esta ejecución conjunta** | **100** | **0** | **4** |

No sumar este total a las ejecuciones anteriores, que se solapan. Los ocho EPERM históricos de Unix no se borraron del informe anterior: los mismos casos de serialización y transporte se ejecutaron aquí en TCP permitido. Esto no demuestra que el sandbox permita Unix sockets ni que Windows autentique los peers.

Durante el desarrollo hubo un fallo de la prueba de limpieza tardía, corregido en el servidor. También falló el fixture nuevo de confirmación porque usó UUID v4 donde el contrato exige v7; se corrigió el fixture usando uuidV7 y se repitió la batería. Esos intentos fallidos no son PASS históricos ni defectos ocultados del contrato.

TypeScript: PASS en Local Service completo, local-channel y Desktop. Arquitectura: 16/16 PASS y ARCH-003 PASS. Bundle de verificación de Local Service con esbuild y target node22: PASS. No se ejecutó el paquete instalable Windows ni se declara una nueva certificación completa de Electron. La modificación del runner PowerShell requiere además su parser/ejecución Windows; no se simuló PowerShell 5.1 en Linux.

Comandos y resultados sanitizados: [evidencia JSON](evidence/windows-g1-g2-runtime-2026-10-29.json). El archivo incluye SHA de runtime, blobs, comandos, casos y omisiones, y hash de los reportes Vitest.

## 7. Estado explícito y limitaciones restantes

| Objetivo | Clasificación final | Causa concreta |
|---|---|---|
| G1 integral SCM ↔ Electron | **BLOQUEADO / NO IMPLEMENTADO INTEGRALMENTE** | Falta adaptador nativo de autenticación de peers sobre la conexión real, custodia operacional del firmante, entrega/consumo conectados al runtime y política de pipe multicuenta verificada. |
| G2 cancelación y cierre de conexiones | **IMPLEMENTADO / PROBADO en TCP Linux** | Ruta real de servidor y caller LocalChannelComponent; la ejecución Windows sigue pendiente. |
| G2 cierre durable de sesión BUSINESS | **IMPLEMENTADO / PROBADO parcialmente** | Tombstone antes de invalidación y callback probado con SQLite; falta ejercicio en el Windows operacional. |
| G2 integral por lease Windows | **PARCIAL / BLOQUEADO** | Falta ligar el ledger al peer G1 autenticado, registrar conexiones por lease y comprobar/fencear cada operación con ese lease. El cierre por SSA no sustituye esto. |
| Certificación G1/G2 | **NO APROBADA** | Ninguna prueba Windows multicuenta; integración por lease incompleta. |

También permanecen pendientes la negociación interrumpida por reinicio, la recuperación multicuenta, la instancia SCM duplicada y el fencing de todas las operaciones asíncronas concurrentes con revocación. No se aseguran cubiertos por los tests TCP.

Se conserva SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN. No se cambió CurrentUser a LocalMachine, no se amplió el DACL, no se distribuyó el master secret, no se instaló WinSW ni se modificaron certificados/usuarios. Sin nuevas bases, protocolos de login, mecanismos de revocación durables ni ramas. El TCP existe solo en las pruebas; no habilita un endpoint comercial alternativo.

## 8. Procedimiento de comprobación Windows

Conservar cambios locales y sincronizar la rama mediante fast-forward únicamente cuando el árbol sea limpio y corresponda al PR #99. Registrar el SHA recibido. Después:

```powershell
Set-Location C:\Proyectos\pos-platform
git status --short --branch
git rev-parse HEAD
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm architecture:check
powershell.exe -NoProfile -File tools/operators/windows-login-final-checks.ps1 -Run
```

El runner conserva los casos Windows ya existentes; los ocho tests nuevos TCP de cancelación se omiten deliberadamente en Windows. No presentar esa omisión como aprobación del pipe. Para comprobar la integración nueva de logout en el modo interactivo, usar únicamente provisión auténtica y el procedimiento del informe de continuidad: abrir las conexiones de cuenta/panel, cerrar sesión, verificar tombstone, denegación de capacidades, cierre de las conexiones compañeras, respuesta de logout y rechazo de recuperación. Conservar SHA, comandos, resultados y eventos sin secretos.

No se entrega un comando de habilitación SCM: primero hay que terminar G1 y el G2 por lease. PR #99 sigue Draft e issue #98 abierta. **Esta entrega es un avance de runtime verificable y no satisface todavía el criterio de cierre integral de la misión.**
