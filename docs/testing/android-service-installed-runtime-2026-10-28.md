# Android: lector privilegiado y runtime instalado — 2026-10-28

Base `be95fd38967f35ea2bd6381e8a9bcc8d54a648ed`, misma rama `feat/android-commercial-runtime`. Alcance autorizado: continuar consulta de licencia, preparación release y pruebas del M60WL. ADB no mostró dispositivos; el propietario confirmó que no está conectado y autorizó **simular la conexión**. No se presenta la simulación como hardware, Keystore real, sincronización Central, roles operativos o certificación Play.

## Código integrado

- `AndroidSecurityFoundation.licenseInformation`: conecta el lector canónico a SQLite del mismo lifecycle. Usa exclusivamente binding de instalación y branch confiables, un loader interno y `requireVerifiedDevice()` en cada consulta. Verifica enrolamiento persistido, clave local exacta, firma/estado/vigencia DeviceTrust y capacidad previamente aceptada. Sin provisión, después de detener o ante revocación: UNVERIFIED. No activa capacidad ni concede BUSINESS, grants, ventas o roles.
- `AndroidPrivateServiceControl`: protocolo cerrado para el pipe heredado, `LICENSE_INFORMATION <secuencia>\n` y `STOP\n`. Sin sockets, firma arbitraria, claves, scope de cliente ni comandos de provisión. Límites de tamaño, ASCII, secuencia consecutiva y cierre ante replay/manipulación. El host no aprovisionado responde desde su composición real, sin fixtures.
- Binder same-UID envía la consulta al hijo y recibe una respuesta correlacionada. Una consulta pendiente, timeout de diagnóstico de 2 segundos, cancelación y pérdida del hijo producen UNVERIFIED. Ese timeout es local al diagnóstico, no política productiva de sesión. El estado guardado registra el ID y DTO público recibido para distinguir una respuesta real del texto inicial de la vista.
- `AndroidLicenseQuery`: correlación/cancelación sin persistir estados de licencia en la Activity. No cambian el aviso, diseño comercial, texto plano del dominio ni la prohibición de navegación de pago.
- `prepare-installed-runtime.py`: prepara una **derivación de laboratorio**, sin sobrescribir directorios existentes. Comprueba hashes de assets y binarios de origen, ELF ARM64 PIE, segmentos de 16 KB y ausencia de segmentos W+X. Resuelve la clausura de dependencias, acorta nombres versionados/SONAME/RUNPATH en las tablas dinámicas y conserva hashes de origen/resultado. No cambia instrucciones ni descarga otro motor. Los nombres APK terminan en `.so`; se resuelven dentro del directorio instalado, sin depender de Termux.
- Node y el addon SQLite se empaquetan en `lib/arm64-v8a`, separados de los assets de datos/JS. Adaptador privado de binding del paquete derivado carga SQLite desde ese mismo directorio, ligado a `process.execPath`; no se modifica el owner SQLite comercial. Se conservan licencias/notices y provenance. El addon existente se recompila con flags de alineación 16 KB.
- `RuntimeAssets`: verifica hashes de librerías instaladas por PackageManager y el launcher usa `nativeLibraryDir`. El fallback de ejecución desde datos sigue limitado al probe target 28 y se rechaza para target moderno. No se eleva el target por cosmética, no se genera firma productiva ni se abre red/React.
- La tarea y script existentes aceptan el layout candidato, generan un APK separado y mantienen el anterior. `verify-runtime-apk.py` verifica cada librería, dependencias y ausencia de binarios nativos en assets para esa variante.

## Evidencia y comandos

SQLite y transporte simulado:

```powershell
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/android-private-service-control.test.ts tests/android-security-foundation.test.ts -t 'private control|simulated native parent|license observation' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/android-service-reader-pipe.json
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/pos-local-service exec tsc -p ../pos-android/tsconfig.runtime.json --noEmit
node --test apps/pos-android/operational-boundary.test.mjs
node tools/architecture/validate-boundaries.mjs
```

Observado: **3 PASS / 11 filtradas** en la nueva integración. Proceso padre simulado cruza pipes reales del SO hacia otro proceso con SQLite temporal; consultas consecutivas, replay, EOF y reinicio. La prueba separada de composición usa firmas de test, enrolamiento canónico y capacidad aceptada; DeviceTrust revocado vuelve a UNVERIFIED. Nunca credenciales operativas. Nueva guardia de control: **1 PASS** tras agregar límite de chunk. Frontera del bundle: **3 PASS** después del nuevo import de transporte. TypeScript y ARCH-003: **PASS**.

Contratos JVM: **14/14 PASS**, incluida la nueva correlación, replay, timeout y cancelación. `test-installed-runtime.py`: **2 PASS**, preparación desde assets verificados, clausura de dependencias/hash y rechazos por 4 KB, otra arquitectura, truncamiento y directorio existente. Preparación observada: **11 binarios**; bundle fuente `e6b50eebb0a7b3b82627494df6b1110863593747ef3355034a2ce619bafc73e5`. PowerShell: ambos scripts modificados pasan el parser; no se ejecutó el ensayo de dispositivo.

Artefactos locales: `android-service-reader-pipe.json` SHA-256 `a5997df21896046f3ca310e7d5bed8ceff91e5454307fc57d74b3f95679d3e95`; `android-control-final.json` SHA-256 `e998ae37ffe720d089f2e45400c69b46ea33020b132082bd6f14734c50cb122e` (directorio `artifacts/licensing/2026-10-28`). No son evidencia de CI o servicios externos.

Preparación reproducible, usando inputs públicos y toolchain ya verificados/cacheados (sin repetir descargas ni la prueba comercial histórica):

```powershell
node --input-type=module -e "import {bundleRuntime} from './apps/pos-android/bundle-runtime.mjs'; await bundleRuntime('apps/pos-android/build/runtime-inputs');"
docker run --rm --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" --mount type=volume,source=camacho-android-ndk-r27d,target=/ndk,readonly gradle:8.14-jdk17 python3 /work/compile-runtime-addon.py /work /ndk/android-ndk-r27d
node apps/pos-android/bundle-runtime.mjs
node apps/pos-android/package-runtime-assets.mjs
docker run --rm --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" gradle:8.14-jdk17 python3 /work/test-installed-runtime.py
docker run --rm --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" gradle:8.14-jdk17 python3 /work/prepare-installed-runtime.py /work/build/runtime-root /work/build/runtime-assets /work/build/installed-candidate-20261028
powershell -NoProfile -File apps/pos-android/build-runtime-probe.ps1 -KitDirectory artifacts/android-hardware/mi-kit -InstalledRuntimeDirectory apps/pos-android/build/installed-candidate-20261028
docker run --rm --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" gradle:8.14-jdk17 python3 /work/verify-runtime-apk.py /work/build/installed-runtime-apk/camacho-installed-runtime-candidate.apk /work/build/installed-candidate-20261028/assets
```

El directorio candidato debe ser nuevo para cada preparación. Los comandos de firma usan sólo el kit de laboratorio existente, fuera de Git; no imprimen secretos ni crean credenciales centrales.

**Build y verificación observados: PASS.** APK `apps/pos-android/build/installed-runtime-apk/camacho-installed-runtime-candidate.apk`, 36 024 988 bytes, SHA-256 `bf89d2c6f628c558b6f7274e506bb7e9084c11ab217f22da319b24af7bfac59f`. Firma v2 verificada por el firmante existente, min/target 28, paquete `co.camachopos.android.runtimeprobe`, ARM64. Verificación posterior: 79 assets, 11 binarios instalados y clausura ELF/hash correctos, sin material privado empaquetado. Bundle derivado `dd1c889f81a708accb81e9c9a20f3f836cf0d43f1b7c4d3a55b8293a49ec01c7`. No instalado/ejecutado en Android. D8 conserva la advertencia de stubs Java del build de laboratorio y el firmante informa uso de una API Java obsoleta; no se silencian ni equivalen a una prueba de runtime moderno. Política del repositorio: **PASS, 1250 archivos rastreados**.

Primer intento de compilación: el enlace del addon terminó, pero el paso posterior falló por faltar `build/runtime-inputs/runtime-service.mjs` en la caché previa. Se generó con el bundler existente y se agregó preflight antes de compilar. No se interpretó como fallo del motor ni se repitieron pruebas de login.

## Prueba física preparada, no ejecutada

No instalar ni tocar otros paquetes. Verificar primero serial autorizado, modelo M60WL, SDK 28 y firma del paquete. La actualización debe usar la misma firma del probe, sin desinstalar/borrar datos. La variante conserva nombre de paquete de laboratorio y no sustituye un POS productivo.

```powershell
$adb='C:\Proyectos\pos-platform\artifacts\android-hardware\2026-10-21\tools\platform-tools\adb.exe'
$serial='<serial autorizado real>'
& $adb -s $serial get-state
& $adb -s $serial shell getprop ro.product.model
& $adb -s $serial shell getprop ro.build.version.sdk
# Sólo tras verificar M60WL / 28 y firma compatible; nunca desinstalar para forzarla.
& $adb -s $serial install -r --no-streaming apps/pos-android/build/installed-runtime-apk/camacho-installed-runtime-candidate.apk
powershell -NoProfile -File apps/pos-android/test-service-device.ps1 -AdbPath artifacts/android-hardware/2026-10-21/tools/platform-tools/adb.exe -Serial '<serial autorizado real>' -EvidenceDirectory artifacts/android-runtime/2026-10-28/license-query -LicenseInformationOnly
```

Esta prueba inicia sólo el servicio propio, consulta Binder/pipe, exige respuesta UNVERIFIED correlacionada, guarda JSON/captura y lo detiene. No imprime, no pulsa cajón, no autentica una persona y no fabrica una capacidad EXPIRED. Se corrigió la selección de JSON en el script existente porque los nuevos TextViews informativos preceden al texto de estado.

## Límites pendientes

1. El host instalado continúa con `AndroidServiceFoundation`, sin provisión auténtica. El lector de `AndroidSecurityFoundation` queda conectado internamente y probado; **no hay montaje productivo de esa composición en el APK** ni se acepta una credencial importada por React para activarlo. Faltan perfil SEC-004, DEV-003, raíces operativas y composición Android autorizada de BUSINESS/SSA/SAS/canal.
2. El APK candidato sigue target 28, identidad y firma de laboratorio. El target [vigente de Play](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) exige API 36 para nuevas apps/actualizaciones. Falta SDK/release/AAB, identidad/firma reales, contrato de foreground service y permisos aplicables, comprobación de librerías en Android moderno y revisión Play. La clausura ELF preparada no acredita publicación.
3. [Android 10](https://developer.android.com/about/versions/10/behavior-changes-10) prohíbe ejecutar directamente desde el home escribible para apps target 29+. El layout instalado elimina esa estrategia en la variante candidata; su ejecución Android todavía requiere dispositivo o emulador real. La [guía de páginas de 16 KB](https://developer.android.com/guide/practices/page-sizes) requiere también probar el runtime, no sólo inspeccionar ELF.
4. Roles, sincronización de capacidad Central auténtica, expiración tras gracia, historia fiscal y recuperación offline en M60WL siguen **SKIP: equipo no conectado y confianza comercial no provisionada**. Una simulación de transporte no sustituye esas pruebas.
5. Sin Actions, sin merge, sin cambios Windows, FACTUS, diseño comercial, hardware ni `oracleJdk-27`.
