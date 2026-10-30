# Comparativo y cierre remoto de observaciones G1/G2 — 2026-10-29, America/Bogota

**Resultado:** observaciones de ciclo de vida y distribución candidata corregidas y probadas remotamente. **Windows SCM, ejecución del addon nativo y certificación humana siguen pendientes.** Se conserva `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.

Repositorio `Andresito202/pos-platform`, PR #99 Draft, rama `feat/p0-windows-login-install-readiness`. Se comprobó el remoto `cabd41e45f0ff3ca8ccfc3ce27165d16336897c9`, se comparó el rango desde `23ae1d02` y se preservaron los tres commits recibidos. El nuevo código es `52ab79a7cc55411b343283bc92b3aad89f3910b7`; publicación con padre esperado y sin force push. No se accedió al PC del propietario, no se instalaron servicios, no se tocaron bases persistentes ni se activaron Actions. #98 permanece abierta.

## 1. Comparación de lo recibido

| Commit recibido | Aporte correcto | Deficiencia restante comprobada | Resolución |
| --- | --- | --- | --- |
| `7fe6615ee76f042de240ec1f7b4e7957a0c57f96` | Limpia conexiones y claves cuando el primer cierre nativo falla. | El segundo `stop()` podía esperar indefinidamente el accept pendiente. Otro error al destruir un socket podía interrumpir la limpieza y sustituir el error nativo. | Un único resultado terminal de apagado, cierre individual protegido y conservación del primer error. Se rechaza arrancar un transporte ya detenido, incluso antes de su primer listen. |
| `fb628a7f03a59462e8ad2edbc1a793102f7dbbe8` | Token de intento impide publicar una activación tardía. | `stop()` terminaba sin esperar el arranque. Se admitía otro intento antes de acabar el anterior, y la limpieza usaba un registro compartido de unregister. | Recursos y callback pertenecen al intento; el apagado cierra el servidor en arranque y espera su terminación. Nuevos intentos se rechazan durante arranque/apagado. |
| `cabd41e45f0ff3ca8ccfc3ce27165d16336897c9` | Evita dejar un token de arranque al fallar la provisión síncrona inicial. | No resolvía las carreras anteriores. | Se conserva esa garantía; su prueba ya pasaba sobre el código recibido y pasa después de la corrección. |
| Distribución del addon | Se había declarado pendiente correctamente. | `build-artifact.mjs` solo distribuía el bundle y better-sqlite3. | Se amplió el mismo builder para el perfil SCM_CANDIDATE con addon fijado por hash y checksum, dentro de un único artefacto LOCAL_SERVICE. |

No se presume que los tres commits hubieran pasado pruebas externas: no aportaban pruebas nuevas ni evidencia ejecutada. La validación se hizo sobre sus bytes remotos reales.

## 2. Defectos, contratos y cambios mínimos

### Arranque/apagado y propiedad de recursos

Componente: `apps/pos-local-service/src/channel/local-channel-component.ts`.

Contrato: un apagado terminado no puede dejar pendiente un arranque que adquiera capacidades; cada intento libera únicamente sus recursos. Cierres concurrentes o repetidos no deben volver a cancelar la misma generación ni convertir un error anterior en éxito.

Reproducción: iniciar con un servidor controlado cuya promesa no termina; solicitar `stop()` y, antes de resolver el arranque, intentar otro `start()`. El código recibido devolvía el apagado y admitía el reemplazo. También llamaba dos veces al coordinador al cerrar concurrentemente y omitía el cierre del servidor si ese coordinador lanzaba una excepción.

Cambio: registro temprano de recursos, promesas de inicio/apagado, cleanup compartido por intento y unregister capturado localmente. `stop()` espera el inicio cancelado. La limpieza continúa si falla el coordinador y conserva los errores. Un cleanup fallido impide reutilizar ese componente; requiere recuperar el proceso/instancia, no declarar un cierre exitoso.

Pruebas: arranque tardío, bloqueo de reemplazo, cierre simultáneo y secuencial, fallo del coordinador, provisión inicial fallida, error de inicio más error de limpieza y cierre fallido persistente. Son puertos simulados de ciclo de vida, no identidades Windows.

Regresión posible: orden de callbacks, tiempos de apagado y reinicio de componente. Se ejecutaron también las suites existentes de lifecycle, canal y procesos. Si el sistema operativo bloquea una operación nativa, el timeout del lifecycle existente continúa siendo su frontera; Linux no acredita ese comportamiento Win32.

### Cierre del transporte y conservación de errores

Componentes: `apps/pos-local-service/src/channel/windows-scm-transport.ts` y `server.ts`.

Contrato: borrar claves temporales y retirar capacidades aunque falle una parte del cierre; los siguientes llamadores reciben el mismo resultado terminal. Una instancia detenida no puede emitir un nuevo handoff con su master ya borrado.

Reproducción: `adapter.stop()` lanza mientras accept queda pendiente; el segundo stop se quedaba esperando. Otro socket que lanza al cerrarse sustituía el fallo inicial y evitaba el borrado posterior. Además, el servidor perdía el error de arranque cuando también fallaba la limpieza del transporte.

Cambio: apagado coalescido/terminal, estado detenido previo a callbacks, recorrido de todos los recursos aunque alguno falle y borrado de cache/master. Una conexión aceptada tarde se destruye. El servidor preserva ambos errores de inicio/limpieza mediante AggregateError. El error de cierre nativo original sigue siendo el resultado del stop del transporte.

Pruebas: accept pendiente y segundo cierre, fallo adicional de socket, limpieza de buffers/vínculos, entrega tardía y stop antes del primer listen. Son inyección de fallos; no afirman que CloseHandle/CancelIoEx hayan sido ejecutados en Windows.

### Distribución candidata del addon

Componentes: `apps/pos-local-service/build-artifact.mjs` y su suite existente `tests/local-service-artifact.test.ts`.

Contrato: conservar el artefacto LOCAL_SERVICE único, reproducible y compatible con ReleaseArtifactSchema; una distribución SCM no puede omitir silenciosamente el addon ni aceptar bytes distintos del hash externo. La integridad no habilita producción.

Se reutilizan el tar/gzip, bundle, reporte e integración de release existentes. El modo por defecto INTERACTIVE conserva su estructura y nombre. SCM_CANDIDATE tiene staging/nombre separados e incluye:

```text
pos-local-service.mjs
node_modules/better-sqlite3/...
native/camacho_windows_pipe.node
native/camacho_windows_pipe.sha256
```

El reporte existente añade perfil, ruta relativa, SHA-256, tamaño y destino del addon y conserva los campos base del artefacto. Ambos procesos pueden referenciar el mismo binario instalado y administrado; sus claves privadas siguen separadas y no entran al paquete.

Validaciones: destino win32-x64, archivo regular con extensión .node, ausencia de symlink en la hoja, límite de 8 MiB, lectura acotada del descriptor abierto, hash independiente obligatorio, cabecera PE/PE32+ y marca DLL x64. Se copian exactamente los bytes que se comprobaron. No se infiere ABI, origen confiable ni ejecución a partir de una cabecera PE.

Pruebas positivas/negativas: extracción del tar, igualdad de bytes, checksum, reproducibilidad, preservación del artefacto interactivo, ausencia/hash incorrecto, bytes alterados, arquitectura/formato/DLL/offset inválidos, destino o perfil rechazado y symlink. **El PE de esta prueba es un fixture estructural que nunca se carga. No es un addon Windows compilado. No se publica ese binario de fixture ni se usa en el flujo comercial.**

Regresión posible: herramientas que consumen el reporte y errores de entrada del builder. El contrato externo de release no se cambió; se probó su esquema y sus tests existentes. Las entradas del addon en INTERACTIVE se rechazan para evitar omisiones silenciosas. SCM_CANDIDATE es una selección de build y no un permiso del runtime.

## 3. Archivos del nuevo commit

- `apps/pos-local-service/src/channel/local-channel-component.ts`
- `apps/pos-local-service/src/channel/windows-scm-transport.ts`
- `apps/pos-local-service/src/channel/server.ts`
- `apps/pos-local-service/build-artifact.mjs`
- `apps/pos-local-service/tests/channel-component-lifecycle.test.ts`
- `apps/pos-local-service/tests/windows-scm-stop.test.ts`
- `apps/pos-local-service/tests/channel-cancellation-lifecycle.test.ts`
- `apps/pos-local-service/tests/local-service-artifact.test.ts`
- `tools/operators/windows-login-final-checks.ps1`

El runner Windows existente incluye las nuevas suites; no se construyó otro runner. No se cambiaron RSA/Ed25519, DPAPI CurrentUser, protocolo de login, SSA/SAS, permisos BUSINESS/GLOBAL, tablas ni migraciones. Tampoco se desarrollaron otros módulos. La evidencia estructurada contiene los blobs y cada caso ejecutado.

## 4. Evidencia observada

[Evidencia por comando, caso y fuente](evidence/windows-g1-g2-closure-2026-10-29.json).

Entorno: Linux x64, Node 24.22.1, libuv 1.52.1, TypeScript 6.0.3, Vitest 4.1.11. Se trabajó sobre una reconstrucción de fuentes, sin checkout Git local ni acceso a Windows del propietario. Se verificaron los hashes de los 831 archivos fuente examinados; los nueve blobs modificados publicados coinciden con los probados. Las pruebas se ejecutaron antes de crear el commit y se vinculan a ese contenido exacto, no a un HEAD histórico distinto.

| Verificación | Resultado real |
| --- | --- |
| Reproducción inicial sobre cabd41e4: 9 casos nuevos de lifecycle/stop | 8 fallidos, 1 aprobado; fallos conservados en JSON. |
| Reproducción adicional del error de inicio más error de cleanup | 1 fallido; los otros casos de ese archivo se omitieron por filtro de nombre. |
| Regresión ampliada actual: 31 archivos | 350 aprobados, 0 fallidos, 30 omitidos por Windows/PowerShell/DPAPI/SCM. |
| Procesos, ejecutados con cwd del Service, archivo distinto | 8 aprobados, 0 fallidos, 0 omitidos. |
| TypeScript | Contratos, canal, Service, Desktop main y renderer: PASS. |
| Arquitectura | 16 tests del validador y validación de fronteras: PASS. |
| Build Service | Suite de artefacto: bundle real, reproducibilidad, extracción y arranque de Node fuera del repositorio en Linux. |
| Build Electron | main, entradas, preload y renderer: PASS; aviso del logo PNG ausente en la reconstrucción remota, sin cambios de UI. |
| Addon nativo _WIN32 | No compilado ni ejecutado. |
| Certificación humana/SCM/BUSINESS/GLOBAL | No ejecutada ni aprobada. |

Los 8 casos de procesos no están en los 31 archivos de la regresión principal: son conjuntos distintos. Las baterías focalizadas de desarrollo se solapan y **no se suman** a esos totales. Los 289 casos de la entrega anterior permanecen como evidencia histórica, sin añadirse a esta cuenta.

## 5. Procedimiento que queda para Windows

Conservar la [preparación física y de identidades existente](windows-scm-g1-g2-materialization-2026-10-29.md#f-procedimiento-windows-pendiente). La compilación real requiere Windows SDK/Visual C++, Node de destino y node-gyp aprobado. No se ha instalado ninguno de esos componentes en el PC del propietario.

Después de compilar el addon real y revisar su hash, usar el MISMO builder:

```powershell
$env:POS_ARTIFACT_CHANNEL_PROFILE='SCM_CANDIDATE'
$env:POS_ARTIFACT_TARGET='win32-x64'
$env:POS_ARTIFACT_WINDOWS_PIPE_FILE=(Resolve-Path 'packages/local-channel/native/build/Release/camacho_windows_pipe.node').Path
$env:POS_ARTIFACT_WINDOWS_PIPE_SHA256='<sha256 aprobado, 64 caracteres hexadecimales en minúscula>'
pnpm --filter @pos-platform/pos-local-service run build:artifact
```

Esperado: `dist/pos-local-service-0.0.0-win32-x64-scm-candidate.tar.gz` y `local-service-artifact-win32-x64-scm-candidate.json` dentro del Service (la versión se toma de su package.json). El reporte declara el hash del tar y el hash/tamaño/ruta del addon. Obtener un hash no sustituye su aprobación. El instalador aprobado conserva las verificaciones de release, permisos y rutas; no se deben usar los fixtures de las pruebas.

Las provisiones SERVICE/DESKTOP deben fijar el binario instalado bajo ruta administrada absoluta y el hash aprobado. Eso no aprovisiona por sí mismo las identidades, el firmante o el receptor. Las claves continúan bajo DPAPI CurrentUser y propietarios correspondientes. No ejecutar instalación privilegiada sobre una máquina operativa sin la autorización específica ya exigida.

Ejecutar después `tools/operators/windows-login-final-checks.ps1 -Run` y el escenario físico concurrente existente bajo SCM y el usuario/logon real, incluido el host de Electron. Registrar SHA y versiones. Falta demostrar en Windows DACL, identidad de ambos peers, duplicación, reinicio, replay, cierre/cancelación y errores nativos. La ceremonia humana HTTPS/contraseña/WebAuthn UV/PKCE/DeviceProof/SSA/SAS/RBAC se realiza al final, con BUSINESS y GLOBAL separados.

## 6. Clasificación final

| Área | Clasificación |
| --- | --- |
| Observaciones remotas revisadas | Corregidas y probadas en el alcance reproducido. |
| G1 | Código integrado y distribución candidata implementada/probada; binario y ejecución Windows pendientes. NO CERTIFICADO. |
| G2 | Lifecycle, autorización por operación y revocación preservados; nuevas carreras/cierres corregidos y probados. Windows real pendiente. NO CERTIFICADO. |
| Laboratorio Linux de esta entrega | Aprobado para los casos ejecutados; SDK/DPAPI/identidades simulados donde lo indica la suite. |
| WinSW comercial | BLOQUEADO por el gate conservado. |
| Certificación humana | PENDIENTE. |
| Producción y merge | NO APROBADOS. PR #99 sigue Draft; #98 abierta. |

No quedan sin atender las observaciones de código reproducidas en esta revisión. La compilación y las pruebas Windows pueden descubrir ajustes adicionales; esta entrega no promete su resultado ni certifica el login comercial completo.
