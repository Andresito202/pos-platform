# Biblioteca nativa Hardware — Android 9

Owner: Hardware de POS Local Service, DEC-017. **No es una aplicación APK ni un motor comercial alternativo.**

Incluye descubrimiento USB, solicitud explícita de permiso OS, envío BULK OUT por perfil exacto, servicio Binder del mismo UID y ledger SQLite privado para impedir repetición de trabajos. No contiene servidor WebSocket/HTTP, `JavascriptInterface`, claves, credenciales, SDK propietario ni integración Mharmal. Sin `HardwareAuthorizationVerifier` confiable del host se rechaza toda ejecución. El host debe invocar `recoverInterrupted()` antes de aceptar comandos; los trabajos interrumpidos son UNKNOWN y no se reenvían.

Compilación observada con Docker/Gradle 8.14/JDK17:

```powershell
docker run --rm --mount "type=bind,source=$PWD,target=/work" --workdir /work gradle:8.14-jdk17 gradle --no-daemon --max-workers=2 test bridgeAar
```

Ejecutar desde esta carpeta. Resultado: `build/outputs/camacho-android-hardware.aar`. Kotlin 2.2.0, JVM target 1.8. API AOSP Android 9 de Robolectric es `compileOnly`, no se empaqueta; el host debe aportar Kotlin stdlib y su pipeline Android/D8/manifest/provisionamiento. No se presenta este empaquetado ZIP como validación de un APK con Android Gradle Plugin.

No hay fabricante/ABI confirmado, Android SDK local, emulador ni ADB autorizado. Los cinco tests JVM no ejecutan UsbManager, Binder ni SQLite Android en un dispositivo. Falta aplicación anfitriona, distribución/actualización, autorización canónica y transporte seguro web↔nativo aprobado; ver [DEC-025](../../../../docs/adr/DEC-025-hardware-portability-proposal.md).

Dependencias de compilación públicas: Kotlin/stdlib (Apache-2.0), API AOSP de compilación (licencias AOSP), JUnit de test (EPL-1.0); sin redistribuir drivers. No se instala driver, no se acepta licencia Android SDK ni se instala paquete en el terminal desde esta entrega.
