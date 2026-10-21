# Android: persistencia sobre el motor existente

Owner: POS Local Service, DEC-017/DEC-025. Continuidad de `51d5feb`, sin motor comercial alternativo. Todavía no es el APK comercial del POS.

La prueba SQLite nativa `co.camachopos.android.probe` se conserva sin cambios: fue instalada y comprobada antes de este incremento. Su tarea `probeApk` no certifica Node ni se repite aquí.

El nuevo `co.camachopos.android.runtimeprobe` incluye Node ARM64/Bionic 24.18.0 y **better-sqlite3 13.0.3**, recompilado con NDK r27d, API 28, N-API 10. Ejecuta `LocalDatabase` y las migraciones canónicas 1–18 sin modificarlas. Prueba WAL, integridad, exclusión de segundo writer en el proceso, transacción, rollback, cierre/reapertura y persistencia entre dos procesos del APK. Sus datos viven exclusivamente en `files/commercial-engine-probe` de ese paquete. No instala Termux ni necesita un servicio Windows para ejecutar el motor.

No contiene React, sesiones, ventas, permisos USB, red, WebView ni endpoints. El arranque comercial existente continúa bloqueando plataformas sin custodia segura implementada; no se cambia ese control. La firma de laboratorio y target 28 son para este ensayo en Android 9, no un perfil de distribución productivo ni de Android moderno.

## Procedimiento único

Requisitos: dependencias pnpm existentes, Node Windows, Docker y el kit privado Hardware LAB ya provisionado. Descargar el [NDK oficial r27d Linux](https://dl.google.com/android/repository/android-ndk-r27d-linux.zip) y proporcionar su ruta; el script verifica SHA-256 antes de extraerlo únicamente en el volumen Docker `camacho-android-ndk-r27d`.

```powershell
powershell -NoProfile -File apps/pos-android/build-runtime-engine.ps1 `
  -NdkZip artifacts/android-runtime/2026-10-21/android-ndk-r27d-linux.complete.zip `
  -KitDirectory artifacts/android-hardware/mi-kit
```

Verifica InRelease con GPG, el índice firmado y cada .deb antes de extraer. Nunca ejecuta scripts de paquetes. `runtime-input-lock.json` fija versiones y hashes: un cambio requiere revisión, no actualización automática. Conservar los inputs verificados permite repetir extracción/compilación sin nuevas versiones. Incluye licencias de Node, paquetes, addon, node-addon-api y avisos NDK; no constituye evaluación legal de distribución.

Salida: `build/runtime-apk/camacho-node-runtime-probe.apk`. El verificador inspecciona assets/digests, ausencia de archivos privados de firma y código de copia atómica. La herramienta de firma verifica APK v2 para API 28. D8 conserva una advertencia sobre stubs Java del build; consultar el informe y no tratar este empaquetado como un SDK productivo completo.

Instalar solo en el M60WL identificado y ya autorizado, sin desinstalar ni borrar datos:

```powershell
$adb = 'C:\Proyectos\pos-platform\artifacts\android-hardware\2026-10-21\tools\platform-tools\adb.exe'
$serial = '192.168.1.128:5555' # sesión ya autorizada; comprobar si cambia
& $adb -s $serial get-state
& $adb -s $serial shell getprop ro.product.model
& $adb -s $serial install -r --no-streaming apps/pos-android/build/runtime-apk/camacho-node-runtime-probe.apk
powershell -NoProfile -File apps/pos-android/test-runtime-device.ps1 `
  -AdbPath $adb -Serial $serial -EvidenceDirectory artifacts/android-runtime/2026-10-21/device-final
```

El ensayo acciona exclusivamente el botón de diagnóstico de ese paquete y reinicia únicamente su proceso. No imprime ni envía pulsos. Para ejecución manual, abrir «Camacho Node Runtime Probe», ejecutar la prueba y repetir después de cerrar/reabrir el proceso. Resultados y límites en [el informe](../../docs/testing/android-runtime-engine-2026-10-21.md).

Comprobaciones focalizadas:

```powershell
pnpm --filter @pos-platform/pos-local-service exec tsc -p ../pos-android/tsconfig.runtime.json
docker run --rm --mount type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work gradle:8.14-jdk17 python3 /work/test-extract-runtime.py
node tools/architecture/validate-boundaries.mjs
```
