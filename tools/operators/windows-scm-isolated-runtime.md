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

## Corrección de junctions — base fe53f3c9 (2026-11-03)

La auditoría fue de sólo lectura sobre el intento histórico
df4afd4cf4af44daa227f286ceb44df3 del laboratorio
608ba7092afe4a5b93ac14a7df23a046. No se debe reparar, recuperar, reutilizar ni
borrar ese intento para probar esta corrección. El runner y el XML instalados
no fueron modificados.

Se encontraron 957 junctions, no sólo los 35 de Desktop. Sus DACL propias
eran D:AI con FullControl heredado exclusivamente de SYSTEM y Administradores.
La lectura de READ_ATTRIBUTES bajo un token restringido de diagnóstico devolvió
Win32 5 en los 957 enlaces; permitió leer sus destinos y los 455 ancestros
físicos distintos de los enlaces. No hubo otros errores de apertura.
El token restringido es una copia reducida del token del proceso de diagnóstico,
no el token real SCM: Windows exige que pasen tanto los SIDs normales como los
restrictivos. No se habilitaron privilegios ni se inició un servicio.
La transición 5 -> 0 tras conceder RX sólo al junction se reprodujo en fixtures,
manteniendo intactas las ACL del destino, padre y propietario.

Esto acredita la omisión de configuración y reproduce una condición causal
compatible con el EPERM físico. No acredita la lista completa de grupos,
privilegios y restricciones del token SCM real; el probe posterior sigue siendo
obligatorio. La ausencia de una ACE explícita por sí sola no se usó como prueba.

El defecto del código era doble: el manifiesto registraba enlaces, pero el
sellado los excluía, y Verify recorría realpath sin comprobar su propia DACL.
La política nueva no contiene nombres de dependencias particulares:

- Manifest/READY v2 y política nofollow-v1. Se conservan destino canónico y
  texto lógico del enlace en el manifiesto; los hashes del código no cambian
  por conceder una ACL al reparse point.
- windows-scm-junction-acl.ps1 abre cada junction con OPEN_REPARSE_POINT y
  BACKUP_SEMANTICS. GetSecurityInfo/SetSecurityInfo actúan sobre ese handle,
  con WRITE_DAC para el preparador; no se usa Set-Acl sobre la ruta del enlace.
- Sólo se aceptan junctions de directorio MOUNT_POINT con destino físico directo
  dentro de payload. Se rechazan otros tags, destinos externos o alterados,
  padres reparse, DACL nulas, denegaciones y escritores no confiables.
- El resultado permite únicamente RX al SID de SCM y FullControl administrativo
  y SYSTEM, sin ACE heredables en el junction. Se protege su DACL, sin cambiar
  propietario, destino ni identidad. No concede escritura de código al servicio.
- junction-before.json se crea de forma exclusiva antes de la primera escritura.
  Fija volumen/file ID, hash del buffer reparse, propietario, DACL Before/Expected
  y DACL/propietario del padre. El hash del journal y del helper queda en READY.
- Los enlaces se sellan antes de los padres. La recuperación restaura primero
  los objetos físicos y después los junctions; rechaza objetos sustituidos,
  retargets y cambios concurrentes de DACL/propietario/padre.
- Antes de publicar READY se vuelve a comparar todo el ?rbol con el manifiesto,
  para rechazar archivos o enlaces aparecidos durante el sellado.
- Verify comprueba cobertura exacta del manifiesto, hashes y DACL de los enlaces
  ANTES del realpath de Node. READY no se publica si falla la configuración.
  effective_scm_access sigue siendo NOT_PROVEN hasta el probe real.
- Prepare repetido sobre un READY compatible sólo verifica. Los intentos de
  política anterior se rechazan y requieren otro GUID, sin reparación automática.

Referencias del mecanismo: [CreateFile y OPEN_REPARSE_POINT](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea)
y [evaluación de tokens restringidos](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens).
Las pruebas comprueban el comportamiento real del kernel en temporales; no lo
convierten en evidencia de interoperabilidad comercial.

### Procedimiento mínimo posterior

Primero revisar y guardar este diff en un commit de la misma rama y comprobar
checkout limpio. La preparación exporta HEAD y exige que el helper copiado
coincida con el snapshot; no se prepara desde herramientas sin commit.

~~~powershell
$repo='C:\CamachoLab\pos-platform'
$lab='C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046'
$fresh=Join-Path $lab ('runtimes\'+[guid]::NewGuid().ToString('N'))
$addon=Join-Path $repo 'packages\local-channel\native\build\Release\camacho_windows_pipe.node'
$sha=(Get-FileHash -LiteralPath $addon -Algorithm SHA256).Hash
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Prepare -LabRoot $lab -Attempt $fresh -NativeAddon $addon -NativeAddonSha256 $sha
if($LASTEXITCODE -ne 0){throw 'PREPARE_NO_PASS_CONSERVAR_INTENTO'}
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Verify -LabRoot $lab -Attempt $fresh
if($LASTEXITCODE -ne 0){throw 'VERIFY_NO_PASS'}
~~~

En otra ejecución expresamente autorizada para el probe, con SCM detenido:
guardar bytes, SHA-256 y SDDL del runner actual; publicar únicamente el candidato
control/service-probe-runner.ps1 de $fresh preservando ACL; verificar el hash;
realizar un único arranque por el procedimiento existente y comprobar que vuelve
a detenido. No cambiar XML, ImagePath, cuenta, logpath ni custodias. Restaurar
después el runner original y verificar sus bytes, SHA-256 y SDDL.

El candidato exige el SID virtual real y sesión 0. La comprobación de enlaces
compila el helper en el scratch de esa identidad; la carga de dependencias y
pruebas con flags físicas desactivadas escribe únicamente en work/service.
No crea claves, no enrola ni ejecuta las pruebas físicas oficiales.

~~~powershell
& powershell.exe -NoProfile -File "$repo\tools\operators\windows-scm-isolated-runtime.ps1" -Mode Verify -RequireScmProbe -LabRoot $lab -Attempt $fresh
if($LASTEXITCODE -ne 0){throw 'PROBE_SCM_NO_DEMOSTRADO'}
~~~

No aplicar estos comandos al GUID histórico. Los comandos de arranque no se
ejecutan en esta entrega y no se propone una nueva modificación del XML.

### Evidencia de regresión de junctions

Suite completa observada sobre fe53f3c9 más este diff: 56 PASS, 0 FAIL,
0 omitidas, exit 0. Los primeros casos focalizados tuvieron 2 PASS / 6 FAIL por
metadatos AI no normalizados en el directorio del fixture; se corrigió el setup
sin relajar el comparador productivo y la suite completa posterior pasó.
La auditoría nativa inicial no compiló por referencias System.dll ausentes;
se corrigió el parámetro de compilación antes de auditar el intento.

El verificador original del intento histórico devolvió ISOLATED_RUNTIME_HASHES=PASS.
Huella agregada de rutas/IDs/DACL/propietarios/destinos de los 957 junctions:
c0b073202f3bc6b2aa49adef16c195986add9d17cee1bbad4a3c607fa1e7f7ee.
SHA-256 observado del runner restaurado:
0432efc499275c9af4169e35d3e308b0f7ac6e0b2b735193b90a050690a09aba.

Pendiente: Prepare/Verify v2 de un intento real nuevo y probe con el token SCM
real, incluida la disponibilidad del compilador .NET bajo esa identidad.
No se concede ningún permiso global para resolver un fallo futuro de ese paso.
No hay aprobación física de G1/G2 ni afirmación de producción.
