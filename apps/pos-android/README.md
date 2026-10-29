# Android: persistencia sobre el motor existente

Owner: POS Local Service, DEC-017/DEC-025. Continuidad de `51d5feb`, sin motor comercial alternativo. Todavía no es el APK comercial del POS.

Continuidad 2026-10-28: [lector privilegiado y layout instalado](../../docs/testing/android-service-installed-runtime-2026-10-28.md). El candidato separado empaqueta Node/SQLite y su clausura ELF en `lib/arm64-v8a`, con hashes y alineación de 16 KB, y consulta informativa por Binder/pipe. Sigue siendo laboratorio target 28, sin confianza comercial instalada ni certificación Play. El procedimiento histórico inferior mantiene su alcance original.

La prueba SQLite nativa `co.camachopos.android.probe` se conserva sin cambios: fue instalada y comprobada antes de este incremento. Su tarea `probeApk` no certifica Node ni se repite aquí.

El nuevo `co.camachopos.android.runtimeprobe` incluye Node ARM64/Bionic 24.18.0 y **better-sqlite3 13.0.3**, recompilado con NDK r27d, API 28, N-API 10. Ejecuta `LocalDatabase` y las migraciones canónicas 1–18 sin modificarlas. Prueba WAL, integridad, exclusión de segundo writer en el proceso, transacción, rollback, cierre/reapertura y persistencia entre dos procesos del APK. Sus datos viven exclusivamente en `files/commercial-engine-probe` de ese paquete. No instala Termux ni necesita un servicio Windows para ejecutar el motor.

No contiene React, sesiones, ventas, permisos USB, red, WebView ni endpoints. La continuidad de 2026-10-22 añade un Service nativo no exportado, foreground explícito y controles de inicio/estado/parada. El Node hijo ejecuta `ServiceLifecycle` y `LocalDatabaseComponent` existentes en `files/android-local-service`; **no inicia outbox ni comercio antes de local-security**, conforme a DEC-020. `READY` describe únicamente ese fundamento: `commercial_access=BLOCKED_PENDING_TRUSTED_PROVISIONING`, `local_security=NOT_PROVISIONED`, canal externo cerrado.

El arranque comercial Windows y DPAPI permanecen intactos. La firma de laboratorio y target 28 son para Android 9; no constituyen perfil de distribución productivo ni soporte de Android moderno. El único permiso nuevo es FOREGROUND_SERVICE; su notificación indica que el servicio carece de aprovisionamiento comercial.

La continuidad de custodia añade un **candidato de laboratorio**: Android Keystore protege con AES-256-GCM una semilla aleatoria; el padre nativo entrega sus 32 bytes en memoria por el pipe heredado al Node propio. `AndroidKeystoreKeyProvider` deriva claves por contexto y reutiliza `EncryptedFileSecretStore`. La prueba guarda únicamente un sello de diagnóstico cifrado; no crea una identidad de dispositivo ni credencial comercial. El cierre final limpia las claves del diagnóstico inmediatamente después de comprobar el sello. La semilla en claro existe en RAM durante el uso; la clave AES de envoltura es no exportable. `OS_BOUND` describe esta custodia en reposo, no aprobación del perfil productivo ni autenticación de una persona. Falta aprobar el perfil SEC-004 y el aprovisionamiento confiable antes de local-security/outbox/comercio. Si falta la clave de envoltura o su archivo, o falla su autenticación, no se regeneran silenciosamente.

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

Para actualizar únicamente TypeScript/Kotlin del host sin descargar ni recompilar otra vez los binarios ya verificados:

```powershell
node apps/pos-android/bundle-runtime.mjs
node apps/pos-android/package-runtime-assets.mjs
powershell -NoProfile -File apps/pos-android/build-runtime-probe.ps1 -KitDirectory artifacts/android-hardware/mi-kit
```

Después de instalar con `adb install -r` como arriba, probar solo el nuevo ciclo de vida:

```powershell
powershell -NoProfile -File apps/pos-android/test-service-device.ps1 `
  -AdbPath $adb -Serial $serial -EvidenceDirectory artifacts/android-runtime/2026-10-22/device-service
```

El script verifica inicio, Activity en segundo plano, parada ordenada, nuevo proceso Node y restauración del sello cifrado después de reiniciar únicamente el host propio. `-ExistingCustodyOnly` permite comprobar una instalación en lugar sin repetir la prueba completa: exige un sello previo, inicia, verifica su restauración y detiene el servicio. No ejecuta la prueba SQLite anterior ni impresiones. No se abre canal comercial ni se asignan IDs de tenant/dispositivo/usuario. Evidencia y decisiones pendientes en [custodia Android](../../docs/testing/android-custody-2026-10-22.md).
