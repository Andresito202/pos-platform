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

**Aviso actualizado:** Central ya tiene el montaje V2 HTTPS de BUSINESS,
MFA, SSA y SAS, pero se activa solo con provisión, base, confianza y dispositivos
reales. La ausencia de esas condiciones deniega el acceso. El renderer únicamente
muestra funciones cuando `authorization.capabilities.get` devuelve grants del backend. El servicio local
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

## Instalación comercial Windows — bloqueo de identidad identificado

Antes de instalar WinSW, ejecutar exclusivamente el preflight sin cambios:

```powershell
powershell.exe -NoProfile -File .\tools\operators\windows-login-deployment-preflight.ps1
```

El descriptor WinSW existente ejecuta Local Service bajo la cuenta virtual
`NT SERVICE\\CamachoPOSLocalService`. La custodia del secreto del canal en
`packages/local-channel/src/windows-production.ts` usa DPAPI `CurrentUser`;
la DACL del named pipe acepta la sesión Windows que ejecuta el Service. El
escritorio Electron interactivo tiene otro contexto de logon. **No** basta con
instalar WinSW o compartir las variables `POS_*`: el transporte y el secreto
requieren un procedimiento aprobado de cruce de identidad que no está materializado.

Por seguridad, el descriptor rehúsa aceptar el perfil
`POS_WINDOWS_COMMERCIAL_PROVISION_FILE` como una instalación comercial
certificada. No modificar la DACL para `Everyone` o `Authenticated Users`,
no cambiar DPAPI a texto plano, no usar cuenta LocalSystem como solución.

El lanzador local de esta carpeta sigue siendo una herramienta diferente: inicia
Service y Desktop bajo la misma cuenta interactiva **solo con provisión legítima**.
No instala un servicio SCM, ni aprueba identidad D3, certificados, WebAuthn,
registro nativo, MFA o grants. El preflight no modifica archivos ni servicios.

Siguiente cierre pendiente en P0: materializar y auditar canal Windows SCM ↔
usuario autorizado (identidad de cliente, ACL, intercambio de secreto, persistencia
y revocación) antes de permitir instalación comercial automática. La prueba
operativa debe ejecutarse en Windows real con un autenticador físico y Central
HTTPS autorizada. No comprar VPS/dominio ni usar fixtures para cerrar esta tarea.
