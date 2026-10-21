# Motor canónico en M60WL — 2026-10-21

Base local/remota verificada: `feat/android-commercial-runtime@51d5febdb38388ad455e3dcb05023a67b4a8f2fe`, por orden expresa del propietario. Predecesora `b907d20f` y PR #92 draft conservadas. El commit que incorpora este informe identifica el código ensayado; no se integra a main ni se certifica el POS completo.

## Incremento y ruta elegida

Se conserva `LocalDatabase`, better-sqlite3 **13.0.3**, migraciones, WAL y WriterLock. No se cambia código comercial, sesión, SSA, credenciales ni bases del POS. Los seis archivos de la prueba SQLite nativa previa continúan; su código de Activity y su paquete `.probe` no se modifican ni se vuelven a ejecutar. El build añade una variante `.runtimeprobe`, no otro POS.

Node ARM64/Bionic **24.18.0-2**, de paquetes Termux firmados, se empaqueta dentro del APK propio; no requiere instalar la aplicación Termux. [Receta upstream fijada](https://github.com/termux/termux-packages/blob/3383e9f8a5566e4445eae6eeeaded8873a0c5f98/packages/nodejs-lts/build.sh). El prebuilt nodejs-mobile 18.20.4 se descartó en la revisión limitada porque expone N-API 9, mientras el addon existente exige N-API 10. No se investigaron versiones históricas ni se reemplazó SQLite por Android SQLite. Android no se presenta como plataforma oficialmente soportada por el proyecto Node: esta evidencia es específica de este equipo/build; ver [BUILDING de Node 24.18.0](https://github.com/nodejs/node/blob/v24.18.0/BUILDING.md#android).

Procedencia: [repositorio oficial Termux](https://packages.termux.dev/apt/termux-main/), InRelease verificado con GPG, clave `CC72CF8BA7DBFA0182877D045A897D96E57CF20C`, keyring desde commit `3383e9f8a5566e4445eae6eeeaded8873a0c5f98` de termux-packages. Se verifica el hash del índice firmado y de ocho paquetes fijados en `apps/pos-android/runtime-input-lock.json`. No se ejecuta ningún script de instalación. Un cambio de versiones falla cerrado para revisión.

Toolchain: NDK r27d **27.3.13750724**, compilador aarch64-linux-android28-clang/clang++, C++20, N-API 10 y libc++ estática para el addon. ZIP Linux oficial, SHA-256 `601246087a682d1944e1e16dd85bc6e49560fe8b6d61255be2829178c8ed15d9`; SHA-1 publicado en el índice SDK `22105e410cf29afcf163760cc95522b9fb981121`. Volumen Docker exclusivo `camacho-android-ndk-r27d`, sin instalar NDK/Java en Windows. Bibliotecas Bionic y sus licencias se incluyen como assets; la copia privada se valida por SHA-256 y commit atómico de cada archivo. No se incluye material privado de firma.

La compilación usa los fuentes y defines SQLite originales del paquete pnpm existente. No reutiliza un binario Windows/GNU Linux. APK firmado con la clave aislada del kit LAB existente; certificado SHA-256 `92ca6262bd95d0d301e812da8a499f2949051b4c0164f638aef6459f9480b208`. apksig verifica v2/minSdk 28; no se afirma v1. No hay permisos INTERNET/USB/almacenamiento externo, WebView, puerto de control ni autoridad comercial en este paquete.

## Prueba real observada

M60WL, M60WL_V2.01, Android 9/API 28, qcom, ARM64, ADB WiFi previamente autorizado `192.168.1.128:5555`. No se reinició/restableció el terminal ni se cambió su configuración. Solo se creó almacenamiento privado de diagnóstico. El APK arranca su propio Node mediante ProcessBuilder, sin shell, y no necesita conexión al servicio comercial Windows. ADB se usa para instalar y observar; no presta el motor al terminal.

Primer APK observado: SHA-256 `9ddcdfff12adb2456a46bf651084dd0a75e2acc93654391c89d637a39b9e4ff6`, 71.030.990 bytes. Instalación Success. Primer proceso: 333 ms de prueba y RSS 54.398.976 bytes; proceso posterior: 112 ms y RSS 54.333.440. Son mediciones puntuales del ensayo, no benchmarks de ventas ni tiempo total de lanzamiento. `previousSuccessfulProcess` cambió de false a true al detener únicamente `.runtimeprobe` y abrirlo de nuevo.

Comprobaciones físicas del motor: `process.platform=android`, `arch=arm64`, Node v24.18.0, N-API 10, WAL, integrity_check=ok, foreign_keys=1, migraciones 1–18, segundo writer rechazado dentro del proceso, transacción confirmada, rollback deliberado, cierre y reapertura. Huella de checksums de migraciones `4d6177fa35eea5a97885d22bbfdf46ab31b744815158b98a6b280a1ed61dcb1a`. No se atribuye a esta prueba exclusión entre dos procesos concurrentes ni certificación de recuperación ante corte eléctrico.

Cada salida declara `businessSession=false`, `commercialSale=false`, `hardwareCommand=false`. La UI real se inspeccionó mediante screenshot. Evidencia inicial en `artifacts/android-runtime/2026-10-21/device-closure/`, más `device-shell-engine-first.log`, `device-closure.log` y `apk-first.log`. Esos artefactos locales son ignorados por Git; no se publican claves, datos comerciales ni APK en el repositorio fuente.

## Validación y fallos conservados

- TypeScript focalizado: `pnpm --filter @pos-platform/pos-local-service exec tsc -p ../pos-android/tsconfig.runtime.json`, exit 0 (`types-final.log`).
- Límites: `node tools/architecture/validate-boundaries.mjs`, ARCH-003 PASS (`boundaries-final.log`).
- Extractor: cuatro pruebas sin binarios ejecutados: alias materializado/repetición, escape de link, traversal y ciclo; 4/4, exit 0 (`extractor-tests.log`).
- Emisor LAB: `node --test tools/hardware/android-lab.test.mjs`, 6/6 (`drawer-node-final.log`).
- Biblioteca y verificador LAB JVM: 21/21 (HardwareCore 5, LabAuthorization 16), Gradle test + labApk, exit 0 (`hardware-apk-closure.log`). Incluye rechazo de solicitud firmada para el VID/PID real con parámetros exclusivamente sintéticos de fixture; ningún pulso se ejecuta en estos tests.
- Hardware LAB reconstruido: SHA-256 `f590d3f152287939bbc35af7f543d434d1a26c4d3333b708aa7875f2b3967f07`, instalado con `adb install -r --no-streaming`, Success (`lab-install-block.log`), sin desinstalar ni ejecutar trabajos.

Fallos corregidos, sin ocultarlos: descarga Packages.xz 404 → índice firmado sin comprimir; extracción con aliases Linux y licencia NCSA inicialmente fallida → validación de rutas y materialización de aliases, incluyendo paquete termux-licenses; primer verificador de APK detectó que faltaba recompilar la copia atómica Kotlin → reconstrucción, sin relajar el verificador. D8 conserva advertencia de superclass java.lang.Object en los stubs android-all: la ejecución física fue posible, pero el empaquetado no equivale a SDK/producto certificado. PowerShell 5 muestra `NativeCommandError` por stderr informativo de adb/gpgv; se conservan logs y se comprueba el exit code real.

El [procedimiento reproducible único](../../apps/pos-android/README.md) prepara, verifica, compila, empaqueta y verifica el APK sin instalarlo automáticamente. No se repiten 25 sesiones, 23 MFA, 12 Argon2id, E2E comerciales, canales Windows/Linux ni la impresión ASCII previa: sus contratos no cambiaron.

## Cajón: denegación vigente y documentación oficial

Confirmación del operador: modelo CD350 conocido; revisión, voltaje nominal, pinout, puerto/recorrido eléctrico y temporización desconocidos. El emisor y `LabAuthorization` rechazan DRAWER_OPEN para **26728/1280**, incluso firmado, con `M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED`. No hay apertura automática ni ruta comercial Android activada. No basta un perfil JSON para levantar el bloqueo: requiere evidencia y cambio revisado con prueba autorizada.

La [ficha oficial CD350 en español](https://3nstar.com/wp-content/uploads/2018/11/CD350-SP.pdf) enumera varias interfaces y sensor como característica, pero no identifica la variante instalada ni aporta pinout/pulso suficiente. El [manual oficial de familia GP-L80160/L80180](https://www.gprinter.net/down/9026ce9dd030ad601748af0bc9b1c3d6.pdf), dos páginas inspeccionadas, describe una salida de cajón de la familia (DC24V/1A); **no demuestra** voltaje de este CD350, revisión de placa integrada, conexión o pulso. No se aplicó ese dato al hardware. El PDF CD350 inglés no fue accesible con el lector web; la ficha española sí. La apertura por aplicaciones externas no identifica el comando usado y no se toma como certificación Camacho.

Se conservan contratos, auditoría durable, estados existentes y no repetición de trabajos inciertos; no se crean permisos ni estados alternativos. En esta continuidad no hubo impresión ni pulso. La impresión ASCII anterior queda como evidencia limitada comunicada y confirmada por el operador en `b907d20f`, sin extenderla a CP1252/corte/recibo comercial.

## Eslabón que falta

| Componente | Estado y dependencia exacta |
| --- | --- |
| Motor canónico dentro del APK Android | IMPLEMENTED y prueba física observada para persistencia diagnóstica; no servicio comercial completo |
| Arranque comercial Android | `apps/pos-local-service/src/main.ts` aún exige Windows fuera de test y usa DPAPI en esa plataforma. Hace falta proveedor Android Keystore/custodia y composición de runtime segura; no se elimina el guard ni se usa InsecureDerivedKeyProvider como solución. La prueba de DB no valida TLS, almacén de CA, DNS, ICU ni todos los paths de recursos del paquete relocalizado; deben verificarse antes de usarlo como servicio, sin desactivar TLS |
| Interfaz React y transporte Android | No integrada aquí. Reutilizar posService/ChannelBridge y contratos, con autenticación del proceso y lifecycle; no exponer addJavascriptInterface, loopback anónimo o puerto LAN. No se crea una pantalla comercial ficticia |
| Persona → BUSINESS → DeviceProof → SSA | Protocolo productivo bloqueado por D3; [solicitud única vigente](business-access-continuity-2026-10-20.md). Faltan RP/origin/hostname real TLS, cliente/redirect nativo aprobado, protocolo de acceso y custodia, tiempos, revocación/refresh y abuso. El redirect de Electron no se adjudica automáticamente a Android. No se emiten credenciales/SSA ni se acepta sessionId/booleanos como prueba |
| PRINT_RECEIPT → trabajo durable → Binder → USB | Contratos y partes existentes conservados; falta composición comercial dentro del mismo UID, autorización canónica y binding de job/bytes, persistencia de estados antes del efecto. ASCII previo no verifica codificación segura, corte ni esta cadena |
| Cajón | Bloqueado hasta identificar perfil eléctrico de la unidad y validar físicamente con autorización. Estado real cerrado/no apertura observada por Camacho |

No existe persona autenticada en el POS Android ni venta end-to-end comprobada. No se cambia Windows/Linux ni se proclama producción. La continuidad autorizada avanza sobre esta única rama; PR #92 permanece draft.
