# Runtime aislado de pruebas SCM (sólo laboratorio)

Base auditada: rama feat/p0-windows-login-install-readiness, 087d7770.
No cambia empaquetado comercial, identidad SCM, claves, DPAPI ni ACL privadas.
No inicia, detiene, instala ni reconfigura servicios. Los runners se generan
como candidatos; preparar NO los publica en la instalación del servicio.

## Decisión y alcance del grafo

| Alternativa | Ventaja | Coste/riesgo |
| --- | --- | --- |
| Instalación aislada con lockfile congelado | pnpm resuelve peers y variantes opcionales; integridades del lockfile; árbol nuevo sin ACL heredadas del almacén principal | Red inicial y espacio; hay que verificar binarios y congelar el resultado |
| Copia mediante manifiesto del árbol instalado | Sin descarga; hashes de las copias | Preserva el desfase instalado/lockfile; hay que reconstruir peers, enlaces, nativos y archivos dinámicos a mano |

Se elige instalación aislada, seguida de un manifiesto de hashes del resultado.
El lockfile fija Vitest 4.1.12, Vite 8.2.4 y Electron 44.9.1; la instalación
principal auditada tenía Vitest 4.1.11 y Vite 8.2.1. No se copia ese árbol.

Lectura del lockfile sobre 087d7770 para los filtros Desktop/Local Service:
11 workspaces, 299 snapshots, 20 contextos con peers y 129 aristas opcionales,
sin referencias ausentes en el recorrido. Son cifras del grafo multiplataforma,
no de paquetes efectivamente instalados en Windows. Incluye dependencies,
devDependencies de los workspaces seleccionados, enlaces workspace y snapshots
transitivos con sus contextos peer y optionalDependencies. pnpm decide qué
variantes OS/CPU instalar; dependencies.json registra las resoluciones realmente
instaladas, peers opcionales ausentes y metadatos OS/CPU/engines.

Los nativos incluyen better-sqlite3 13.0.3 (prebuild N-API win32-x64 incluido en
el paquete, sin descargarlo por separado), Electron, esbuild, Rollup, Rolldown y
Lightning CSS. El addon Camacho ya compilado se aporta con SHA-256 explícito;
no se compila ni se cambia. Node se copia y también queda inventariado.
No se ejecutan scripts generales de instalación: sólo el install.js del paquete
Electron resuelto dentro del snapshot. Ese downloader valida su distribución;
se inventarían después todos los bytes descargados. Las integridades npm del
lockfile y los hashes locales del manifiesto tienen alcances distintos:
los hashes locales prueban conservación del artefacto, no una firma pública.

Se inventaría TODO archivo de cada paquete instalado, no sólo imports estáticos:
chunks, workers, JSON, WASM, prebuilds y cargas dinámicas quedan dentro del árbol.
Se rechazan enlaces externos, colgantes y archivos compartidos por hardlink.
Un peer obligatorio ausente bloquea READY. Los imports dinámicos efectivamente
usados se comprueban cargando ambos tests oficiales con sus flags de ejecución
DESACTIVADOS: deben resultar exactamente dos tests omitidos y cero ejecutados.
Esto no prueba las ramas de hardware/DPAPI que sólo corren en el test físico.

## Disposición y seguridad

Cada intento vive en C:\CamachoPosScmLab\<id-real-32-hex>\runtimes\<guid-32-hex>.
Nunca se reutiliza un intento parcial ni se elimina un intento fallido.

- payload: snapshot Git del commit limpio, dependencias y ejecutables; SCM RX.
- control: verificador y candidatos de runner; SCM RX.
- work/service: temporales, cache y reportes del servicio; SCM Modify.
- work/operator: cache y temporales interactivos; SCM no puede escribir. La raíz
  permite inspección RX; los nuevos archivos heredan sólo custodia administrativa.
  El preflight interactivo rechaza archivos escribibles por otras identidades.
- store, downloads, logs, source.tar, journal y acl-before.json: evidencia y
  material de preparación; quedan bajo custodia administrativa.
- READY.json: hashes del manifiesto, del grafo y de los controles; no acredita
  acceso efectivo SCM. Cada verificación reexamina bytes, enlaces y ACL.
- FAILED-*.json / RECOVERY-*.json: evidencia retenida de fallos/recuperación.

Administradores y SYSTEM conservan FullControl. No se cambia ningún propietario.
Se exige que los padres de laboratorio ya tengan custodia administrativa segura;
si no la tienen, se bloquea sin repararlos. No se accede a service/private ni
desktop/private durante preparación, verificación o probe.

Antes de la primera ACL se persiste el journal de TODO el conjunto acotado.
Se sellan hijos antes de padres. La recuperación compara Before/Expected,
rechaza cambios concurrentes y verifica el SDDL exacto restaurado. Si Windows
normaliza metadatos de DACL o aparece una modificación concurrente, se requiere
revisión. La recuperación no convierte un intento fallido en READY ni lo borra.

La configuración .mjs se carga con configLoader native para evitar escribir
archivos de configuración temporales en node_modules. Cache, TMP y TEMP se
dirigen a work/service o work/operator según la identidad. No se comparte
cache escribible entre el servicio y el operador. La carpeta de código no se usa como salida.

## Secuencia operativa

Estas instrucciones se ejecutan por fases. En esta entrega NO se ha iniciado
SCM, publicado un runner, preparado custodia ni ejecutado pruebas físicas.
Primero revisar y guardar las herramientas en un commit de la misma rama:
la preparación exige un checkout limpio y exporta exactamente HEAD.

### 1. Preparar, sin tocar el servicio

En PowerShell elevado de la VM aprobada, con Node x64, Git, tar y pnpm 9.15.0:

~~~powershell
$repo='C:\CamachoLab\pos-platform'
$lab='C:\CamachoPosScmLab\<id-real-32-hex>'
$attempt=Join-Path $lab ('runtimes\'+[guid]::NewGuid().ToString('N'))
$addon=Join-Path $repo 'packages\local-channel\native\build\Release\camacho_windows_pipe.node'
$addonHash=(Get-FileHash -LiteralPath $addon -Algorithm SHA256).Hash
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Prepare -LabRoot $lab -Attempt $attempt -NativeAddon $addon -NativeAddonSha256 $addonHash
if($LASTEXITCODE -ne 0){throw 'PREPARACION_NO_LISTA_REVISAR_INTENTO'}
~~~

Se utiliza store propio y package-import-method=copy. Los nombres del virtual
store se acortan mediante virtual-store-dir-max-length=32 (pnpm 9.15.0).
Antes de sellar se rechazan rutas de 250 caracteres o más, para fallar de forma
explícita antes de los límites de las API de PowerShell 5.1, sin cambiar Windows. --frozen-lockfile rechaza
drift y --ignore-scripts evita ejecutar postinstall del workspace y de paquetes
no autorizados. Git archive fija core.autocrlf=false/core.eol=lf; el hash del
lockfile se compara contra el blob de Git, no contra una conversión CRLF local.
La versión de pnpm se exige explícitamente. No se copia node_modules principal.

Los smoke de Node y Electron sólo cargan código/dependencias. Node abre SQLite
en memoria y ambos cargan la API N-API del addon sin listen/connect válidos.
Se eliminan las variables que habilitan enrolamiento, pruebas físicas e
inyección de módulos. Los reportes deben indicar dos omisiones intencionadas.

### 2. Verificar y repetir sin reinstalar

~~~powershell
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Verify -LabRoot $lab -Attempt $attempt
if($LASTEXITCODE -ne 0){throw 'RUNTIME_NO_VERIFICADO'}
~~~

Repetir Prepare sobre un READY del mismo commit sólo verifica, sin instalar ni
volver a aplicar ACL. Si cambia el commit se exige otro intento.
Si hay FAILED o falta READY, conservar el directorio y usar otro GUID.
Cuando existe acl-before.json puede ejecutarse Recover como administrador:
restaura sólo las ACL del intento y escribe RECOVERY, conservando toda evidencia.
No se borran carpetas ni se repara el almacén principal.

### 3. Probe real bajo SCM, sólo en otra ejecución autorizada

Con el servicio detenido y la identidad virtual intacta, el operador debe:
1. Guardar copia y hash del runner actual en el intento, fuera de work.
2. Publicar control/service-probe-runner.ps1 como
   service/run-physical-test.ps1 del laboratorio, preservando su ACL existente.
3. Confirmar el hash publicado y autorizar un único arranque del servicio
   existente mediante el procedimiento del laboratorio; no cambiar ImagePath,
   cuenta, XML, tipo de inicio ni directorios privados.
4. Verificar que termina detenido y conserva los logs del servicio.

El candidato exige SID real y sesión 0. Mode Probe revalida hashes/ACL, comprueba
que SCM no puede crear archivos en payload ni en work/operator, ni abrir package.json para escritura,
carga SQLite y addon, y ejecuta los dos tests con las flags físicas desactivadas.
Produce work/service/scm-probe-<guid>.json con manifiesto, SID y reportes de carga.
No enrola, no lee provisiones privadas, no crea claves y no certifica G1/G2.

Después, como operador:

~~~powershell
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Verify -RequireScmProbe -LabRoot $lab -Attempt $attempt
if($LASTEXITCODE -ne 0){throw 'ACCESO_SCM_NO_DEMOSTRADO'}
~~~

Se exige una evidencia posterior a READY, del mismo manifiesto y cuyo propietario
sea el SID virtual del servicio. Un smoke del administrador no satisface este gate.

### 4. Pruebas oficiales posteriores

Sólo tras el probe y con los manifiestos/provisiones oficiales existentes listos:
publicar el candidato control/service-physical-runner.ps1 preservando ACL y
verificar su hash. El one-shot exige que el runner instalado coincida exactamente
con ese candidato y que el snapshot corresponda al HEAD revisado.

~~~powershell
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-physical-one-shot.ps1" -Run -LabRoot $lab -IsolatedRuntime $attempt -DesktopProvision "$lab\desktop\desktop-provision.json" -ServiceResult "$lab\results\service-physical.json"
~~~

Este último comando sí controla SCM y ejecuta pruebas físicas: se documenta para
la fase posterior, NO se ejecuta durante preparación ni en esta entrega.
Los wrappers lab-gate y five-stage también aceptan -IsolatedRuntime.
El provisionador existente consume el mismo snapshot y probe; ya no invoca el
reparador de ACL principal. No debe invocarse automáticamente para resolver
enrolamientos parciales. Si faltan provisiones, detenerse y continuar por el
procedimiento existente con autorización separada; no recrear custodia DPAPI.

## Validación de herramientas y límites

Comando de regresión:
~~~powershell
node --test tools/operators/windows-scm-isolated-runtime.test.mjs tools/operators/windows-scm-lab-dependency-acl.test.mjs tools/operators/windows-scm-lab-binding.test.mjs tools/operators/windows-scm-manifest-pair.test.mjs
~~~

Las pruebas del preparador usan árboles temporales y un instalador simulado que
falla intencionalmente, sin red ni SCM. Incluyen hashes, junctions, hardlinks,
archivos añadidos, peers, omisiones opcionales, idempotencia, journal, fallo real
de Set-Acl, denegaciones, exceso de escritura y recuperación padre/hijo.
No confundir su PASS con instalación real, acceso bajo SCM o pruebas físicas.

Pendientes del entorno: descarga real de las versiones fijadas, validación
real de los nativos bajo Node/Electron y probe SCM. Un nuevo uso dinámico no
cubierto o un paquete opcional no disponible debe bloquear el test que lo
requiera; no se añaden permisos al repositorio para salvarlo. No se prueba aquí
interoperabilidad productiva, login humano, hardware ni certificación G1/G2.

## Evidencia de esta entrega (2026-11-03)

Base Git: 087d77701a2e5aeeb5bdca3f9de7405c1a25305d, con este diff local.
Entorno observado: Windows Server 2022, Node v22.19.0, PowerShell 5.1.20348.558;
pnpm disponible 9.15.0. No se hizo commit ni publicación.

- Suite final del comando anterior: 48 PASS, 0 FAIL, 0 omitidas, exit 0.
  Incluye 26 casos nuevos y las regresiones existentes; no sumar ejecuciones
  repetidas ni confundirlas con pruebas físicas.
- Parser explícito de los cinco scripts PowerShell modificados/nuevos: PASS.
  Los dos candidatos generados también se parsearon dentro de la suite.
- node --check del preparador: PASS; git diff --check: PASS.
- Ejecuciones intermedias conservadas en la sesión: 35 PASS / 8 FAIL
  (parser editado y normalización CRLF) y 20 PASS / 1 FAIL (array JSON en
  recuperación PS5.1). Se corrigieron y la ejecución final anterior es la
  evidencia de la versión entregada. No se ocultaron como omisiones.
- Instalación real desde registro, READY real, probe SCM y tests físicos:
  NO EJECUTADOS. No hay promoción de G1/G2, login humano ni producción.
