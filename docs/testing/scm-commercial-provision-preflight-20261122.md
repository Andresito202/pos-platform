# SCM comercial: preflight de provisiones administradas

Estado: **herramienta de diagnóstico, NO habilitación ni certificación**.

Esta herramienta comprueba exclusivamente la coherencia de dos provisiones
SERVICE/DESKTOP ya creadas por un operador autorizado: identidad compartida,
ventana temporal, claves públicas/pines SHA-256, ruta y hash del adaptador nativo,
separación de roles y rechazo de rutas `.lab-state`, `lab-data` y preproducción.

No genera identidad, credenciales, certificado, llave, SID o provisiones; no
instala ni inicia servicios, no modifica ACL, no accede a PostgreSQL ni SQLite y
**no lee el contenido de la clave privada del servicio ni del receptor DPAPI**.

En el Windows autorizado, cuando el responsable haya entregado ambos JSON
administrados en rutas canónicas, ejecutar en PowerShell con Node 22:

```powershell
node tools/operators/scm-provision-preflight.mjs "C:\ProgramData\CamachoPOS\private\service-provision.json" "C:\ProgramData\CamachoPOS\private\desktop-provision.json"
```

El resultado válido es `SCM_PROVISION_METADATA_VALID`, acompañado siempre de
`commercial_ready:false` y `physical_certification:REQUIRED`. Un resultado
válido **no significa que las ACL sean correctas**, que el lector nativo pueda
acceder a los archivos bajo el token correspondiente, que el servicio
`CamachoPOSLocalService` esté instalado, que exista interoperabilidad SCM ni
que el POS pueda iniciar sesión.

La verificación definitiva requiere, por separado: instalación SCM autorizada
sin reutilizar el servicio `PosLocalService` de `.lab-state`, lectura protegida
real de los JSON bajo SERVICE/DESKTOP, registro correcto de WinSW bajo
`NT SERVICE\CamachoPOSLocalService`, prueba
`apps/pos-local-service/tests/windows-scm-physical.test.ts` con
`CAMACHO_SCM_PHYSICAL_PROVISION`, evidencias de autenticación negativa,
revocación persistida y posterior decisión de liberación del gate comercial.
Mantener `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` hasta completar
esa certificación.

Pruebas sin Windows ni credenciales:
`node --test tools/operators/scm-provision-preflight.test.mjs`.
