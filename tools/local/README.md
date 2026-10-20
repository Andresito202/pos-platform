# Arranque local integrado — Windows

Este arranque de **diagnóstico local** no reemplaza el login ni crea credenciales SSA.

## Alcance real

El launcher usa los procesos existentes:
- POS Local Service: SQLite/WAL, canal autenticado DPAPI/Windows named pipe.
- Electron + React con la entrada de producción, no visual-preview.
- Rechaza producir identidades, claves o permisos de prueba.

## Ejecución

En PowerShell, desde la raíz:

    powershell -NoProfile -File .\tools\local\launch-windows.ps1 -CheckOnly
    powershell -NoProfile -File .\tools\local\launch-windows.ps1

Requiere los valores de aprovisionamiento ya existentes:
POS_DATA_DIRECTORY, POS_INSTALLATION_ID, POS_DEVICE_ID,
POS_SERVICE_VERSION, POS_PROTOCOL_MIN, POS_PROTOCOL_MAX,
POS_TENANT_ID, POS_COMPANY_ID y POS_BRANCH_ID.

No inventa UUIDs, ni claves ni credenciales. No imprime secretos.
Si faltan variables, termina sin iniciar procesos. Se almacenan los
registros de esa ejecución en el directorio temporal
camacho-pos-real-launch y no en el repositorio.

**Aviso:** el servidor central actual no expone login comercial autenticado,
MFA/SSA por HTTPS, y el renderer únicamente muestra pantallas cuando
authorization.capabilities.get devuelve permisos efectivos. El servicio local
puede arrancar y la ventana puede decir «Acceso no disponible»: eso es
fail-closed y NO significa producto operativo. No habilitar botones ni
falsificar permisos para salir de esa pantalla. Facturación requiere también
credenciales FACTUS depositadas.

Pruebas finales aún necesarias: usuario/contraseña/MFA, dispositivo,
emisión SSA real, activación local y autorización, snapshot de permisos,
cajero/supervisor/administrador, cobros y fiscal sandbox. Las superficies
planned de App.tsx que usan requiredPermissions vacío no están completas.

Esta herramienta no fusiona main ni prueba automáticamente un login.
Su utilidad es identificar el primer bloqueo real del arranque Windows.
