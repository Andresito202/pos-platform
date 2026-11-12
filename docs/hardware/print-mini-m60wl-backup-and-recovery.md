# Copia de seguridad y recuperación — Print Mini en M60WL

**Objetivo:** preservar una copia instalable del APK **realmente instalado** en el Android M60WL, no un build antiguo. El paquete `co.camachopos.printmini` reúne la impresión y el puente de báscula CH340. El respaldo **no** contiene las preferencias privadas de la app ni las del sistema Android.

## Desde Windows a una memoria USB (por ejemplo F:)

1. Con la USB conectada al Windows y ADB previamente autorizado para el M60WL, consultar `adb -s 192.168.1.14:5555 shell pm path co.camachopos.printmini`.
2. Debe existir **un solo APK** (`package:/data/app/.../base.apk`); si hay `split_config` adicionales, un archivo base no basta y debe prepararse un set de APK completo. No copiar un APK de un paquete de laboratorio distinto.
3. Usar `adb pull RUTA_APK_INSTALADA F:\CamachoPOS\PrintMini_M60WL\CamachoPOS_PrintMini_M60WL.apk`. Generar SHA256 local y comprobar que el archivo copiado a USB conserva el hash. Preferir comparación adicional con `adb shell sha256sum RUTA_APK_INSTALADA`.
4. Guardar al lado un `LEAME-INSTALAR.txt` con el paquete, versión, fecha y pasos de reinstalación, y la copia del userscript de Firefox/Violentmonkey si el propietario lo utiliza en MásControl. El userscript es independiente de la APK.
5. Inventariar apps Android con `adb shell pm list packages -3` **sin desinstalar nada**. No subir APKs privados, inventarios con identificadores, claves o certificados de firma a Git.

## Recuperación sin Windows para el cajero

Copiar el APK a una memoria USB compatible con OTG del M60WL, abrir **Archivos**, pulsar el APK y escoger **Instalar/Actualizar**. Android puede exigir habilitar «instalar desde esta fuente» para el administrador de archivos. En una actualización, nunca desinstalar antes si no es necesario: `pm install -r`/«Actualizar» conserva datos cuando se firma con el mismo certificado.

Si ya fue desinstalada, instalar desde cero y revisar de nuevo servicio de impresión predeterminado, impresora, USB CH340 y autorización del diálogo **Activar báscula → Permitir**. Reinstalar la APK **no** restaura la extensión Violentmonkey ni el script de Firefox automáticamente.

## Compatibilidad y seguridad

La APK de laboratorio/debug no es un instalador comercial generalizado. Para distribuir a terceros hace falta firma release custodiada, revisión de licencias, aprobación de hardware y pruebas por terminal. No incluir keystores, claves privadas ni tokens en la memoria USB. Un dispositivo USB `0x1A86:0x7523` solo demuestra la presencia de un CH340, no que el hardware conectado sea la TEK ATLAS probada.

**Estado:** método documentado; la existencia de un respaldo en `F:` no está comprobada desde GitHub. Debe verificarse mediante el hash de la USB en el Windows del operador.
