# M60WL / GP-L80160 / CD350 — pruebas físicas controladas

Este procedimiento usa **Camacho Hardware LAB**, aplicación nativa aislada de Hardware. No es otro POS ni una sesión comercial. Reutiliza `android-hardware` y su AAR; no necesita RawBT, Mharmal, MasControl ni un servicio Windows de impresión. No cambia SSA, permisos, credenciales comerciales o bases del POS.

## 1. Identificar antes de instalar

Conectar un cable USB **de datos** al puerto de depuración del terminal. Mantener la impresora en su puerto host USB correspondiente. En el terminal, aceptar la huella RSA ADB solo para este Windows. ADB de red, root, cambios de drivers, desinstalación y borrado de datos no forman parte del procedimiento.

Herramientas oficiales: [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools). El diagnóstico enumera y lee propiedades; no imprime ni pulsa:

```powershell
$adb = 'C:\Proyectos\pos-platform\artifacts\android-hardware\2026-10-21\tools\platform-tools\adb.exe'
& $adb devices -l
powershell -File tools/hardware/android-device-lab.ps1 -AdbPath $adb -Serial '<SERIAL_OBSERVADO>'
```

Debe aparecer `device`, no `unauthorized` ni `offline`. Lista vacía significa que no hay enlace ADB confirmado; comprobar cable/puerto/notificación antes de considerar drivers. Comparar modelo, fabricante, Android, SDK, compilación y ABI con pantalla/etiqueta. Lo comunicado hasta ahora: M60WL, Android 9, M60WL_V2.01; no sustituye la lectura del equipo.

## 2. APK y autoridad de laboratorio

El APK entregado y sus hashes están en el [informe de ejecución](../testing/android-hardware-host-2026-10-21.md). La aplicación es minSdk 28, sin bibliotecas `.so`, no solicita INTERNET, almacenamiento general ni Bluetooth. No hay WebView, puerto de escucha, API de red o importación por intent externo. El servicio Binder sigue no exportado.

Para reconstruir, crear un kit nuevo **solo dentro de artifacts**, con ventanas de laboratorio explícitas. La clave de órdenes no es una clave de sesión o DeviceProof:

```powershell
node tools/hardware/android-lab.mjs init --directory artifacts/android-hardware/mi-kit --trust-hours 24 --max-job-seconds 300
powershell -File tools/hardware/build-android-lab.ps1 -KitDirectory artifacts/android-hardware/mi-kit
```

`24` horas y `300` segundos son elecciones explícitas de este ensayo, no políticas productivas D3. El APK incorpora únicamente la clave pública y política. La clave privada de órdenes permanece en `private/authority.pem`; la de firma APK está en `apk-signing/`. Proteger ambos directorios para la cuenta del técnico; no subirlos a Git, compartirlos ni copiarlos al terminal. Al vencer o desarmar la autoridad, no hay envíos nuevos. Para renovarla se requiere otro kit y APK revisado, conservando el ledger al actualizar. Nunca desinstalar/borrar datos para repetir una orden.

La compilación usa Kotlin, AAPT2, D8/R8 y apksig públicos, con versiones fijadas en Gradle. La API AOSP se usa para compilar/enlazar, no se incluye en el APK. No se instala SDK/driver propietario ni se acepta automáticamente una licencia de SDK. Esto es empaquetado directo, sin Android Gradle Plugin; verificar firma/manifest/DEX y ejecución en Android son evidencias diferentes.

Instalar solo después de contrastar el SHA256 del APK y las propiedades físicas:

```powershell
powershell -File tools/hardware/android-device-lab.ps1 -AdbPath $adb -Serial '<SERIAL_OBSERVADO>' -InstallApk -ApkPath '<APK_ENTREGADO>' -ExpectedApkSha256 '<SHA256_ENTREGADO>' -ExpectedModel '<MODELO_LEÍDO_Y_CONTRASTADO>' -ExpectedBuild '<BUILD_LEÍDO_Y_CONTRASTADO>'
```

El helper rechaza una app LAB previamente instalada y conserva su ledger. No instala otras aplicaciones ni arranca automáticamente una prueba. Alternativamente transferir el APK al terminal, verificar su hash y usar su instalador Android; no habilitar instalación desconocida para apps arbitrarias.

## 3. USB e informe ligado al terminal

Abrir **Camacho Hardware LAB**. Las acciones iniciales no envían bytes:

1. **Descubrir USB y terminal** muestra VID/PID, nombres, bcdDevice USB, interfaces, direcciones/tipos de endpoint y permiso real. Ninguna coincidencia se llama «certificada».
2. **Solicitar permiso USB**: elegir la impresora identificada y responder al diálogo Android. No se fuerza la captura de una interfaz ocupada; cerrar otras apps de impresión antes de probar.
3. Descubrir nuevamente y **exportar informe firmado** usando el selector de archivos Android, por ejemplo a Downloads. Este paso exige nueva orden si cambian reporte, proceso, USB o descriptores.
4. Comparar visualmente la huella `key_fingerprint` de la pantalla con el archivo recibido. La clave se crea en Android Keystore para esta app LAB, no se exporta su parte privada. No se declara attestation ni identidad comercial. Comprobar además que la autoridad pública mostrada corresponde al APK entregado.

El informe debe tener `permission=true`, hash de descriptores y un endpoint BULK OUT. Guardar modelo exacto de etiqueta, revisión/firmware del self-test del fabricante, cable y topología de alimentación. `usb_version`/bcdDevice no se presenta como firmware de impresión. Si falta esa identificación, no emitir orden.

```powershell
& $adb -s '<SERIAL_OBSERVADO>' pull /sdcard/Download/camacho-hardware-report.json artifacts/android-hardware/informe-real.json
```

No hay lectura de datos privados del POS ni `adb run-as`. Sin ADB, transportar el archivo por USB/medio controlado. El informe contiene metadatos del equipo; tratarlo como evidencia técnica local.

## 4. Perfil revisado y primera impresión

Crear un JSON de perfil con estos campos **reales**: `printer_model` (= GP-L80160), `printer_firmware`, `protocol` (= ESC_POS), `identity_evidence` (etiqueta/informe/fecha), `command_evidence` (manual/revisión/página/hash), `timeout_ms` (elección explícita del ensayo) y `drawer:null`.

El manual de la serie está publicado por [Gprinter](https://www.gprinter.net/down/9026ce9dd030ad601748af0bc9b1c3d6.pdf). Confirmar que corresponde a la revisión exacta del equipo; la publicación por sí sola no valida una conexión ni fija parámetros de cajón. No copiar VID/PID, code page, pines ni tiempos de otro modelo. La prueba inicial imprime ASCII fijo con identificador de trabajo; no configura code page, corta papel ni abre cajón. No es un recibo de venta ni documento fiscal.

Emitir desde el Windows autorizado, con informe fresco y los valores observados (ninguno de los placeholders es ejecutable):

```powershell
node tools/hardware/android-lab.mjs issue --directory artifacts/android-hardware/2026-10-21/kit --report artifacts/android-hardware/informe-real.json --expected-key-fingerprint '<HUELLA_CONTRASTADA_EN_PANTALLA>' --usb-name '<USB_NAME_DEL_INFORME>' --interface '<ÍNDICE_REAL>' --endpoint '<DIRECCIÓN_BULK_OUT_REAL>' --profile '<PERFIL_REVISADO.json>' --kind PRINT_TEST --reason 'Prueba física autorizada GP-L80160' --seconds 300 --output artifacts/android-hardware/orden-impresion.json
& $adb -s '<SERIAL_OBSERVADO>' push artifacts/android-hardware/orden-impresion.json /sdcard/Download/orden-impresion.json
```

Importar la orden mediante el selector nativo. Verificar resumen, dispositivo y motivo; pulsar **Revisar y ejecutar UNA orden** y confirmar físicamente. Firma válida no reemplaza la comprobación técnica. El estado TRANSPORT_ACCEPTED solo prueba aceptación de bytes. Observar el papel y conservar foto/identificador, fecha, técnico y resultado. No reimportar una orden ante incertidumbre: conservar registro y reconciliar antes de otra autorización.

## 5. Cajón: bloqueo hasta tener evidencia eléctrica

La revisión exacta del CD350 y salida GP-L80160 deben coincidir en conector, pinout, voltaje, carga y tiempo del pulso. La [familia CD350 del fabricante](https://3nstar.com/product/cash-drawer-pos-cd350/) no demuestra qué variante está instalada. Obtener manual/etiqueta/confirmación técnica de ambos; registrar su referencia y hash. No medir ni intervenir partes energizadas desde este procedimiento. El éxito previo en una app de diagnóstico no revela los parámetros que usó.

Bloqueo vigente, confirmado por el propietario el 2026-10-21: para VID 26728 / PID 1280 el emisor y el verificador nativo rechazan `DRAWER_OPEN` con `M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED`, incluso si un trabajo está firmado. La apertura automática permanece deshabilitada. No basta completar un JSON para levantarlo: requiere revisión de la evidencia de la unidad, cambio revisado del bloqueo y pruebas controladas autorizadas.

Solo después de esa revisión, el perfil para DRAWER_OPEN podrá incorporar `drawer` con **todos** estos valores explícitos: `model` (= CD350), `pin` (selector ESC/POS documentado), `on_byte`, `off_byte`, `time_unit_ms`, `voltage_v` (texto decimal), `electrical_evidence` (fuentes y revisión). No hay números eléctricos de ejemplo ni valores por defecto en el kit. Un perfil de impresión debe mantener `drawer:null`.

Generar una orden nueva `--kind DRAWER_OPEN` con ese perfil, motivo y plazo explícitos. Importar y comparar en pantalla el resumen eléctrico antes de confirmar una sola apertura. No automatizar la confirmación por ADB ni usarla como prueba de permisos comerciales. Sin sensor confirmado, registrar «apertura observada por técnico», nunca «sensor abierto».

## 6. Casos y evidencia de certificación

| Caso | Resultado que debe observarse | Evidencia |
|---|---|---|
| Impresión válida | Un único ticket con job_id, sin cajón ni corte | Orden firmada, registro firmado, foto/observación del papel |
| Orden duplicada / toques concurrentes | No hay segundo envío | Mismo job_id, ledger y observación |
| Firma alterada / otra autoridad / otra instalación | Rechazo antes de I/O | Mensaje y ausencia de efecto |
| Caducidad / reloj hacia atrás / autoridad desarmada | Rechazo | Orden, reloj y registro de ensayo |
| USB retirado / endpoint incorrecto / permiso denegado | Sin envío aceptado; error explícito | Informe USB, estado y observación |
| Desconexión durante escritura / reinicio | FAILED o UNKNOWN según fase; sin reproducción automática | Ledger después de reinicio y ausencia de nueva emisión |
| Apertura permitida | Un pulso exacto del perfil revisado | Referencias eléctricas, orden, registro y observación del cajón |
| Pulso incompleto/incompatible | No emitir la orden; rechazo del perfil | Validación y ausencia de efecto; no ensayar un valor eléctrico peligroso |
| Impresora apagada / sin papel | No inventar estado ni éxito físico | Observación; ausencia de sensor se declara, no se simula |

Exportar el registro de ejecución desde la app: contiene ledger y autorizaciones, firmado por su clave local. Copiar junto a los informes. No editarlo para añadir PASS: las observaciones humanas se registran aparte indicando quién las vio. Restablecer alimentación/conexión no reenvía trabajos anteriores. La app no ofrece reintento físico automático.

La suite JVM prueba autorización/concurrencia con dobles de I/O; compilar/verificar APK no sustituye esta tabla física ni pruebas Android de Binder/SQLite/USB. La matriz única conserva `UNTESTED` hasta la ejecución real suficiente. El transporte de laboratorio es documental, firmado y fuera de red; web↔puente productivo, RBAC comercial y login siguen pendientes de sus contratos y decisiones, sin un WebSocket inseguro como atajo.
