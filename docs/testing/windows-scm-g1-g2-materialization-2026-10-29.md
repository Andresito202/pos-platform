# G1 + G2 — materialización y evidencia, 29 de octubre de 2026

**Dictamen: implementación integrada, pruebas parciales aprobadas, certificación Windows y producción NO aprobadas.** El adaptador nativo ya existe y tiene llamadas desde Service y Electron; el ledger existente gobierna conexiones y operaciones. La entrada comercial SCM sigue detenida por `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`. No hay un booleano para quitarlo.

## A. Continuidad y repositorio

Repositorio `Andresito202/pos-platform`, PR #99 Draft, rama `feat/p0-windows-login-install-readiness`, base `feat/android-commercial-runtime`. Se comprobó el HEAD remoto antes de escribir y se publicaron avances con comparación del padre esperado, sin force push. No se fusionó #99/#96, no se cerró #98 ni se activaron Actions.

| Commit | Cambio comprobable |
| --- | --- |
| `a30ee66cdec533ceef73bf181078fba046dfa53d` | Punto remoto inicial de esta intervención. Existían criptografía candidata, ledger y cierre/cancelación de canales; faltaba transporte nativo unido al ledger. |
| `c1f9bc1df40cc8e79d4d2926409bffe950b82d70` | Adaptador Windows N-API, custodia del firmante, provisión, Service/Electron, admisión por lease y controles por operación; gate conservado. |
| `140a849bfcfecc6da08079e6868c07b62bdbf6fd` | Drenaje limitado de la respuesta iniciadora mediante shutdown del pipe; los demás miembros se cancelan y cierran. |
| `033373e1ce8de8ba5188dea22bb736cc79011a70` | Cambio de cuenta negocia otro canal; el panel renueva su conexión tras la transición explícita. No se reintentan operaciones ambiguas. |

La comparación histórica amplia permanece en [la auditoría de continuidad](windows-login-continuity-audit-2026-10-29.md) y [el informe de cierre anterior](windows-g1-g2-runtime-2026-10-29.md). No se atribuye autoría Codex/ChatGPT a partir del nombre del committer: esta entrega identifica deltas por SHA.

El trabajo se ejecutó en Linux remoto sobre una reconstrucción de los archivos fuente del repositorio, cotejando blobs con GitHub. No hubo acceso al PC del propietario ni a `C:\Proyectos\pos-platform`. No existe una comprobación del árbol de trabajo de ese PC. Un corte temporal del entorno ocurrió después de publicar y probar `c1f9bc1`; se recuperaron los archivos y se completaron las correcciones posteriores. Los resultados finales se volvieron a ejecutar sobre los blobs publicados del último commit de código.

## B. Lo conservado y las deficiencias corregidas

Se reutilizan RSA-OAEP-SHA256, Ed25519, el formato firmado existente, DPAPI CurrentUser, el autenticador/MAC, framing, negociación y catálogo de respuestas canónicos. SQLite sigue siendo el único almacenamiento durable y Service el único escritor. No se añadieron tablas, migraciones, otro login, otro protocolo de autorización ni otro runner. SSA/SAS, RBAC y separación BUSINESS/GLOBAL conservan sus autoridades existentes.

| Deficiencia y componente examinado | Contrato/evidencia | Modificación mínima y prueba | Riesgo residual |
| --- | --- | --- | --- |
| G1: handoff sin socket atestiguado; `windows-handoff*`, `windows-production`, `server`, entradas reales | Una identidad declarada en JSON o el token propio no autentican al peer. El servidor Node convencional no aportaba la evidencia requerida sobre la conexión real. | Adaptador C++ que crea/conecta el pipe, obtiene PID/sesión/token del peer y conserva un duplicado del mismo handle; adaptadores TS lo unen al servidor y cliente existentes. Pruebas negativas de la frontera y prueba física preparada. | Rama Windows C++ aún sin compilar/ejecutar en Windows. |
| Firmante sin custodia operacional | Electron no puede obtener la clave privada del servicio; el pin debe ser independiente de la cápsula. | Ed25519 protegido con DPAPI CurrentUser bajo la identidad de servicio; directorio/archivo de propietario exclusivo, CreateNew, recuperación pública y pin administrado. Se amplió el operador de enrollment existente. Pruebas de pin, identidad, no sobrescritura y borrado de DER con puerto DPAPI de prueba. | Aprovisionamiento y DPAPI de cuenta virtual requieren Windows aprobado. |
| G2: ledger sin miembros activos | Consumir/revocar en SQLite no termina un socket ya admitido. | La autoridad existente registra IDs generados por servidor, admite miembros del lease y comprueba cada operación. `revoke` confirma tombstone antes de desvincular/cancelar/cerrar todos los miembros. TCP y SQLite reales prueban varias conexiones y revocación durante solicitud. | Efecto nativo debe verificarse con SCM y Electron reales. |
| Fallo de persistencia durante revocación | Un write fallido no puede reportar éxito ni conservar capacidades activas. | Se cierran conexiones, se propaga el error y el transporte queda en fallo cerrado para nuevas negociaciones. Pruebas SQLite `query_only`. | No se afirma que un tombstone no escrito sobreviva un reinicio; debe mantenerse la denegación de la sesión comercial y tratar el error. |
| Reloj/replay | La limpieza del MAC precede a la admisión y no debe eliminar tombstones por una fecha del llamador o salto fuera de ventana. | Reloj de Service y `TrustedClockGuard`; `acceptTransportFrame` limita limpieza/expiración antes de tocar el store existente. Pruebas de salto adelante, retroceso, reloj inválido y expiración. | La tolerancia es estricta: un retroceso rechaza y requiere intervención de reloj/provisión. |
| Respuesta de logout y cierre | Destruir inmediatamente tras `write` puede perder bytes aún no leídos en un pipe Windows. | Se retira autoridad inmediatamente, se permiten solo los bytes de la respuesta en curso y se usa `end`/shutdown con destrucción forzosa acotada. Test TCP: respuesta firmada iniciadora válida; otros miembros cerrados y siguientes operaciones rechazadas. La prueba física también incluye este drenaje. | El comportamiento Win32 aún necesita ejecución física. |
| Cambio de cuenta y panel | `DesktopCommercialAccount` reutilizaba el canal retirado; revocar el lease deja también obsoleto el canal del panel. | Login posterior negocia otra conexión. La transición explícita renueva el delegado del panel usando la fábrica autenticada. Fixtures ahora rechazan reutilizar un canal retirado; pruebas Electron simulado verifican reemplazo y cierre sin reintentar efectos. | No se ejecutó UI Electron real ni autenticador humano en esta intervención. |

Los archivos y sus blobs exactos se enumeran en [la evidencia estructurada](evidence/windows-scm-g1-g2-2026-10-29.json). Son 30 archivos de código, contratos, pruebas y operador; los documentos de evidencia se publican aparte. No se cambiaron UI, ventas, pagos, licencias, FACTUS, hardware ni migraciones comerciales.

## C. Conexión G1/G2 realmente implementada

1. La provisión administrada tiene rol SERVICE/DESKTOP, perfil de instalación/dispositivo/logon, hash del addon y clave pública/pin del firmante. Solo SERVICE apunta al archivo privado del firmante; solo DESKTOP al receptor DPAPI. Los documentos y el binario requieren rutas locales canónicas, ausencia de reparse points y protección de escritura/propietario/ancestros. No se conceden permisos desde el lector.
2. Service verifica su identidad y ascendencia hasta el PID que SCM informa para `CamachoPOSLocalService`. Se contrastan SID, sesión 0, vida del proceso y tiempos de creación; se vuelve a consultar SCM. Esto contempla WinSW como padre y Node como descendiente, sin confiar en un PID anunciado por IPC.
3. Se crea el pipe con primera instancia exclusiva, rechazo remoto y DACL protegida: SYSTEM, SID del servicio y derechos de datos para el logon SID aprobado. El cliente no recibe `FILE_CREATE_PIPE_INSTANCE`. Se mantiene una instancia reservada al entregar las conexiones aceptadas. No se añaden ACE de Everyone/Authenticated Users.
4. Ambos extremos consultan Windows sobre el handle conectado: PID/sesión y token de ese proceso, SID/logon SID y tiempo de creación. Se conserva un duplicado de ese mismo handle para revalidación. El descriptor se abre/cierra mediante las funciones de libuv del anfitrión, evitando mezclar tablas CRT privadas del addon y Node/Electron.
5. Sobre ese socket Service entrega la cápsula RSA-OAEP/Ed25519 existente. Desktop verifica el firmante contra el pin administrado, contexto, firma y ventana; abre con su receptor DPAPI y vuelve a atestiguar el peer. Recibe una clave derivada temporal, nunca el secreto maestro.
6. La primera petición con MAC válido consume el lease una vez bajo transacción SQLite y comprobación de revocación. Más sockets nativamente autenticados pueden unirse al mismo lease vivo dentro de ese proceso, sin un segundo consumo. Una autoridad reiniciada no puede recuperar ese recibo consumido.
7. Cada operación comprueba peer y ledger antes del handler. El contexto de servidor incluye una comprobación adicional para efectos cancelables después de awaits; el coordinador de login la usa antes de verificar/retener/activar autorización. Las operaciones SQLite síncronas mantienen su unidad de ejecución; la cancelación no deshace commits ya efectuados ni efectos confirmados por Central.
8. Logout usa el cierre durable de sesión existente y su callback de conexiones. Primero se persiste revocación, después se retiran miembros, se cancelan señales y se cierran sockets. Solo la respuesta iniciadora puede drenar de forma acotada. Los autenticadores y buffers temporales se liberan/limpian durante cierre; no se promete borrado forense de todas las copias internas de JS/OpenSSL.
9. Tras una revocación, una negociación nativa nueva puede obtener un lease NUEVO dentro de la provisión aún vigente. Esto habilita solamente transporte: no restaura SSA/SAS, grants ni una sesión BUSINESS revocada. La recuperación comercial sigue pasando por las autoridades canónicas.

La entrada `main.ts` contiene el cableado pero falla antes de DB/arranque cuando se selecciona SCM comercial. Las pruebas de componentes ejercitan esa integración sin convertirla en habilitación productiva. No se marca `RUNTIME_VERIFIED` para el despliegue comercial SCM.

## D. Pruebas y límites

Los resultados finales y comandos completos corresponden a `033373e1ce8de8ba5188dea22bb736cc79011a70`, con cotejo de los 30 blobs publicados. Véase JSON adjunto para cada caso, estado, comandos, entorno, tiempos, omisiones y salida de compilación.

- Vitest: **289 aprobadas, 0 fallidas, 30 omitidas; 319 casos en total**. Transporte TCP, framing/MAC, RSA/Ed25519 y bases SQLite temporales son reales; kernel Windows, DPAPI y Electron son puertos simulados en las pruebas que así lo indican.
- TypeScript: contratos, canal, Service, Desktop main, renderer y CLI de enrollment; resultados en evidencia.
- Arquitectura: 16 pruebas del validador y validación del grafo; resultados en evidencia.
- Build: artefacto Service, main/entradas/preload/renderer de Electron. La etiqueta win32 del tar de Service no prueba ejecución en Windows. El nuevo addon nativo se compila/distribuye/aprueba por separado; no está incluido como binario certificado en ese tar. Vite avisó del logo PNG ausente en la reconstrucción remota; no se hicieron pruebas visuales.
- C++ en Linux: se compiló y cargó exclusivamente la rama que rechaza plataformas no Windows; 7 rechazos comprobados. **La rama `_WIN32` no fue compilada ni ejecutada.** No se transforma este resultado en evidencia SCM.
- Las 30 omisiones requieren Windows/PowerShell/DPAPI/SCM. Se enumeran individualmente. La prueba física nueva también queda omitida. No se ejecutaron PostgreSQL, MFA humano ni certificación end-to-end BUSINESS/GLOBAL en esta intervención.

Se corrigieron fallos iniciales del arnés (RSA de fixture menor a los 3072 bits requeridos, reloj fijo anterior a emisión y aserciones estructurales antiguas). No se debilitó el contrato para hacerlos pasar. Las nuevas pruebas de cuenta usan conexiones retiradas que rechazan solicitudes; las anteriores permitían una reutilización que el servidor real ya no admite.

## E. Clasificación

| Área | Estado |
| --- | --- |
| G1 código | IMPLEMENTADO como candidato integrado; addon Windows pendiente de compilación/validación. |
| G1 pruebas | PROBADO parcialmente con frontera Windows simulada; NO CERTIFICADO. |
| G2 código | IMPLEMENTADO en ledger, servidor, ciclo de sesión y Electron. |
| G2 pruebas | PROBADO con TCP/SQLite/criptografía reales y puertos OS simulados; NO CERTIFICADO en Windows. |
| Laboratorio Linux focalizado | Aprobado para el alcance de los casos ejecutados; no certifica el login completo. |
| Windows SCM/WinSW | BLOQUEADO para uso comercial; prueba física pendiente. |
| BUSINESS / GLOBAL | Conservados; certificación integral de cada recorrido pendiente. |
| Certificación humana | Pendiente: identidades aprobadas, HTTPS legítimo y autenticador físico UV. |
| Producción / merge | NO APROBADOS. PR #99 continúa Draft; issue #98 abierta. |

## F. Procedimiento Windows pendiente

Usar una VM Windows desechable y aprobada, sin datos comerciales. No ejecutar preparación privilegiada sobre una máquina operativa. Esta entrega no instala servicios ni modifica ACL: el propietario debe aprobar primero el manifiesto/identidades y la instalación de laboratorio. Los placeholders deben sustituirse por datos aprobados; no se deben inventar SID, dispositivos ni enrollments.

### 1. Revisar fuente y compilar el addon

Con árbol limpio, rama PR #99 actualizada sin sobrescribir trabajo local, verificar que el commit de código es ancestro de HEAD. Requiere Node de destino, Python, Windows SDK/Visual C++ y una versión aprobada de node-gyp ya disponibles:

```powershell
Set-Location C:\Proyectos\pos-platform
git status --porcelain=v1
git branch --show-current
git rev-parse HEAD
git merge-base --is-ancestor 033373e1ce8de8ba5188dea22bb736cc79011a70 HEAD
node --version
node -p "process.versions.uv"
node-gyp --version
node-gyp rebuild --directory packages/local-channel/native --arch=x64
Get-FileHash packages/local-channel/native/build/Release/camacho_windows_pipe.node -Algorithm SHA256
```

Esperado: build MSVC sin error y hash registrado por SHA, arquitectura y versiones. Si falla, corregir sobre la misma rama y repetir; no retirar el gate. Aprobar/copiar el binario a una ruta administrada protegida e incluir su hash en ambas provisiones. No usar el addon Linux de verificación.

### 2. Enrollment público y provisión aprobada

Reutilizar el operador existente. Los directorios privados deben estar previamente aprobados, fuera del repositorio y con DACL protegida de propietario exclusivo. No aplicar ACL amplias como solución. Variables siguientes contienen solo IDs públicos genuinos:

```powershell
$env:POS_INSTALLATION_ID='<installation_id aprobado>'
$env:POS_DEVICE_ID='<device_id aprobado>'
pnpm --filter @pos-platform/pos-local-service exec tsx ../../tools/operators/windows-channel-receiver.mts --prepare '<archivo receptor privado nuevo>' '<enrollment receptor público nuevo>'
```

Ese comando se ejecuta bajo el usuario interactivo real del Desktop. Bajo la identidad REAL `NT SERVICE\CamachoPOSLocalService`, sesión 0, mediante la preparación aprobada de SCM del laboratorio:

```powershell
pnpm --filter @pos-platform/pos-local-service exec tsx ../../tools/operators/windows-channel-receiver.mts --prepare-service-signer '<archivo firmante privado nuevo>' '<enrollment firmante público nuevo>'
```

Para recuperar solo metadata pública de archivos existentes, usar respectivamente `--recover-public` o `--recover-service-signer-public` y otro archivo público NUEVO. Nunca sobrescribir ni rotar claves para superar un error.

El propietario/instalador debe construir y proteger dos documentos `WindowsScmHandoffProvisionSchema`, versión 1. Comparten handoff aprobado y pin Ed25519: campos reales SID/logon SID/sesión del enrollment receptor, instalación/dispositivo, RSA pública/hash, revisión, ventana de vigencia y referencia de política. Añaden ruta/hash del addon y pública/pin del firmante. SERVICE contiene únicamente `signer_private_file`; DESKTOP únicamente `receiver_file`. El documento administrado no contiene claves privadas. No hay `enabled` ni flag equivalente. Un nuevo logon requiere su aprobación de contexto; no se relajan comparaciones.

### 3. Regresión y transporte físico

Primero, desde Windows interactivo, ejecutar el runner existente con el árbol limpio y registrar el transcript:

```powershell
powershell -NoProfile -File tools/operators/windows-login-final-checks.ps1 -Run
```

Para el escenario nativo concurrente, invocar el MISMO test físico desde dos identidades, sin sustituir el runtime nativo por DI. Bajo el proceso descendiente del SCM real del laboratorio, configurar `CAMACHO_SCM_PHYSICAL_PROVISION` con el archivo SERVICE administrado y ejecutar:

```powershell
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/windows-scm-physical.test.ts --no-file-parallelism --reporter=json --outputFile='<evidencia SERVICE nueva>.json'
```

Durante sus 60 segundos de espera, bajo el usuario/logon aprobado, configurar la variable con el archivo DESKTOP y ejecutar el mismo comando con otra salida de evidencia. No ejecutar la batería completa bajo SCM: sus pruebas de identidad interactiva tienen deliberadamente otro contrato.

Repetir el escenario con el receptor dentro del host Node de Electron, en lugar del Node externo. Desde el mismo Desktop interactivo y con la provisión DESKTOP:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
pnpm --filter @pos-platform/pos-desktop exec electron ../pos-local-service/node_modules/vitest/vitest.mjs run --root ../pos-local-service tests/windows-scm-physical.test.ts --no-file-parallelism --reporter=json --outputFile='<evidencia Electron nueva>.json'
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Esperado por rol: **1 test passed, 0 skipped**; Service acredita dos IDs distintos, persistencia anterior al cierre y cierre de ambos miembros. Desktop acredita dos handshakes/operaciones y la respuesta iniciadora drenada, seguida de rechazo en ambos canales. También se intentan logon/sesión/SID incorrectos, pin distinto, suplantación de servidor por el Desktop e instancia duplicada. Guardar SHA, comando, identidad/rol sin secretos, hora, versiones y hashes de los JSON. Esto prueba transporte, no UI ni sesión BUSINESS.

Falta además evidencia Windows real de segundo usuario y segundo logon, DACL leída del pipe, caída durante negociación, reinicios/recuperación, fallos de aprovisionamiento, revocación concurrente y limpieza de handles. Reutilizar las pruebas y contratos existentes; registrar negativos explícitos, nunca interpretar un skip como aprobación. La prueba automatizada de restart SQLite es real pero Linux, y no sustituye estos reinicios Win32.

Solo después de revisar esa evidencia corresponde discutir la retirada del gate mediante un cambio revisado. El login comercial SCM completo requiere además recorrido humano HTTPS → contraseña → WebAuthn UV → PKCE → DeviceProof → SSA/SAS → permisos efectivos, con BUSINESS y GLOBAL certificados por separado. No hay comando de esta entrega que habilite producción ni cierre #98.
