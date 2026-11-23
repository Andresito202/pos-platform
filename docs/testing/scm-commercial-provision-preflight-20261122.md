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

El empaquetador NSIS incorpora también el verificador como
`resources/service-payload/scm-provision-preflight.mjs`, junto al runtime
`resources/service-payload/runtime/node.exe`. Esto **solo lo distribuye**;
el instalador no lo ejecuta, no crea provisiones, no registra el SCM comercial
ni utiliza ese resultado para desbloquear el gate.

Para ejecutarlo desde una instalación con carga útil íntegra, el operador
puede invocar directamente ese `node.exe` y los dos JSON gestionados de su
equipo. No utilizar los archivos de prueba de `.lab-state`.

El resultado válido es `SCM_PROVISION_METADATA_VALID`, acompañado siempre de
`commercial_ready:false` y `physical_certification:REQUIRED`. Un resultado
válido **no significa que las ACL sean correctas**, que el lector nativo pueda
acceder a los archivos bajo el token correspondiente, que el servicio
`CamachoPOSLocalService` esté instalado, que exista interoperabilidad SCM ni
que el POS pueda iniciar sesión.

La verificación definitiva sigue el procedimiento
`docs/testing/scm-windows-physical-certification-procedure-20261122.md`:
atestación del propietario, helper `-Action PreparePhysicalCertification`
(sin NSIS comercial), lectura protegida real de los JSON bajo SERVICE/DESKTOP,
registro WinSW bajo `NT SERVICE\CamachoPOSLocalService`, ACL del par SCM,
prueba `apps/pos-local-service/tests/windows-scm-physical.test.ts` con
`CAMACHO_SCM_PHYSICAL_PROVISION`, evidencias de autenticación negativa,
revocación persistida y posterior decisión de liberación del gate comercial.
Mantener `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` hasta completar
esa certificación. El preflight opcionalmente acepta el JSON Central como
tercer argumento; nunca marca `commercial_ready:true`.

Pruebas sin Windows ni credenciales:
`node --test tools/operators/scm-provision-preflight.test.mjs`.
