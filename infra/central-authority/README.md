# Central Authority: preparación de despliegue Windows comercial

Estado 2026-10-24: el propietario confirma **entorno todavía no existente o no
confirmado**. Este directorio prepara el servicio existente; no registra DNS,
no genera claves, no aprovisiona cuentas y no despliega nada. `infra/central-sync`
es transporte de sincronización, no la autoridad de identidad.

## Perfil ejecutable preparado en P0-05

`CENTRAL_DEPLOYMENT_ENVIRONMENT` selecciona LOCAL, PREPRODUCTION o PRODUCTION.
No es una aprobación ni activa BUSINESS/SAS. Si se configura, el arranque exige
origen HTTPS canónico, puerto/límites/tiempos explícitos, archivos absolutos de
TLS/issuer/token y rol PostgreSQL `pos_platform_app`. PREPRODUCTION/PRODUCTION
rechazan dominios de laboratorio y requieren `sslmode=verify-full` para DB.
El cliente PostgreSQL debe disponer de su CA real por configuración del operador;
no se instala ninguna CA por ejecutar este código.

Antes de crear el pool/listener se verifica la hoja TLS contra hostname, vigencia
y clave privada, y se exige issuer Ed25519. Esto no prueba que los clientes confíen
en la cadena TLS: debe observarse contra el entorno real. Antes de escuchar se
verifican rol sin superuser/BYPASSRLS/creación de roles/DB, sin membresía del owner,
y presencia de las cuatro tablas canónicas de enrollment. No se concede ningún
privilegio ni se ejecutan migraciones. El token se lee de archivo protegido, no
del valor legacy de entorno. Archivos, CA, ACL y políticas deben provisionarse y
aprobarse externamente; no se eligieron valores operativos en este incremento.

`/health` conserva liveness. `/ready` devuelve 503 sin perfil o DB elegible y
200 sólo para el servicio de enrollment listo; declara explícitamente
`commercial_auth: NOT_ACTIVATED`. Las comprobaciones concurrentes comparten una
consulta y tienen deadline explícito. SIGINT/SIGTERM drenan HTTP antes de cerrar
el pool; el deadline configurado fuerza cierre de conexiones y salida fallida
si no termina. Un Host distinto del origen configurado se rechaza.

Sin selector ni campos del perfil se conserva el arranque **legacy de enrollment** para no
alterar callers/workflows existentes. Sus defaults históricos no son configuración
comercial aprobada. Las rutas BUSINESS permanecen bloqueadas en ambos casos.
El ejemplo sigue vacío y no desplegable; no ejecutar el servidor públicamente
como consecuencia de copiarlo. [Resultados P0-05](../../docs/testing/commercial-provisioning-2026-10-24.md).

## Separar los tres entornos

| Entorno | Uso / identidad | Estado |
| --- | --- | --- |
| Laboratorio local | DB tmpfs aleatoria, claves efímeras, autenticador Chromium; nombres `.test` sólo del fixture | Recorrido SAS demostrado; no trasladar configuración o datos |
| Preproducción | Host HTTPS controlado, DB aislada y usuarios/dispositivos autorizados por el operador | Sin host, DNS/TLS, administrador ni confianza provisionados |
| Producción | Datos y claves comerciales; control de cambios independiente | No autorizado por la orden de desarrollar/probar |

## Entradas a obtener del administrador, sin secretos en el repositorio

`runtime.env.example` enumera las variables que **ya consume**
`apps/central-authority/src/main.ts`. No se carga automáticamente ni sirve como
archivo de arranque. El operador debe configurar cada valor en su gestor de
secretos/configuración; los campos vacíos son información pendiente, no defaults.

1. Identificar administrador del servidor/DB, responsable DNS/TLS y custodios de
   claves. Registrar entorno, issuer HTTPS y RP/origen exactos controlados. No
   elegir un dominio de ejemplo ni reutilizar el dominio central-sync por inferencia.
2. Obtener la cadena TLS válida para ese host y las rutas de certificados/clave
   entregadas al servicio con ACL de su cuenta. Comprobar hostname, fechas y
   cadena desde Windows sin deshabilitar TLS. No subir claves privadas ni copiar
   la CA efímera del laboratorio.
3. Obtener la URL PostgreSQL y rol aprobados del owner DB. Preparar una DB de
   preproducción separada; aplicar sólo migraciones aprobadas por su procedimiento
   canónico. No copiar tablas `*_validation`, conceder UPDATE RBAC ni utilizar
   la cuenta postgres del laboratorio.
4. El custodio entrega al servicio la clave operacional DEVICE_TRUST autorizada;
   entregar al equipo sólo raíz/artefactos públicos firmados y huellas. Comparar
   huellas con el custodio por canal independiente antes de instalarlas. La
   credencial/activación se obtiene del owner DEV-003, no de SQL improvisado.
5. Determinar puerto, límites de cuerpo y vigencia de credencial aprobados. El
   ejemplo no elige valores; `main.ts` conserva sus valores históricos, que no
   constituyen aprobación para un nuevo despliegue. No exponer enrollment antes
   de revisar su autenticación de operador y políticas de abuso.
6. Si se usa `/v1/session-trust`, provisionar artefacto público firmado y token
   de transporte por archivo protegido. Esta publicación sólo distribuye confianza
   SSA: no entrega confianza SAS, permisos ni sesión BUSINESS.

El comando existente del servicio es `pnpm --filter @pos-platform/central-authority
start`; lo ejecutará el administrador en el entorno aprobado, con sus variables
ya provisionadas. **No se ejecutó aquí.** `GET /health` identifica el servicio y
protocolo, pero no acredita DB, política, enrolamiento ni login comercial listo.
No registrar cuerpos, cookies, DeviceProof, códigos, access/refresh ni secretos
de activación en los logs del servicio/proxy.

## Cliente Windows y DEV-003

- Registrar `NativeClientRegistration` real: clientId, authorizationOrigin HTTPS,
  platform ELECTRON y redirect exacto `http://127.0.0.1:<puerto-aprobado>/callback`.
  S256/state y callback ya están implementados. No cambiar el puerto en runtime
  ni aceptar un registro procedente de React.
- Ejecutar `inspectD3DeploymentEvidence(evidence, "WINDOWS")` con la evidencia
  pública real y referencia de aprobación. No requiere App Links ni decisiones
  Android. `ready` sólo valida estructura; no prueba posesión del dominio ni
  aprobación efectiva y no monta endpoints.
- El owner Devices debe resolver empresa/sucursal/instalación/dispositivo reales
  y su correspondencia. DeviceRegistry no acredita por sí solo la sucursal.
- El host privilegiado reutilizará `DeviceEnrollmentService.prepare/complete`,
  `LocalSecurityComponent`, el store cifrado y `DeviceTrustVerifier`. La activación
  se consume por la autoridad canónica. No hay un asistente Windows de enrolamiento
  operativo montado por este documento.
- `CommercialDeviceCredentialProvider` ya permite firmar las cuatro rutas
  comerciales desde la identidad custodiada local: verifica credencial/cadena
  operacional provisionada, binding, clave activa, vigencia y auditoría de
  enrolamiento. No exporta la clave ni implementa un RPC de firma.

## Antes de habilitar BUSINESS/SAS

El entrypoint productivo actual sirve enrolamiento y publicación de confianza
SSA. **Las rutas comerciales continúan bloqueadas y no hay productor SAS
productivo montado.** No promover `isolated-commercial-https.ts` ni cambiar su
guard de DB para conseguir una pantalla de login.

En la [propuesta única](../../docs/testing/android-commercial-approval-proposal-2026-10-22.md)
deben resolverse: custodia/entrega nativa main↔Service, registro de cliente,
perfil access/refresh ligado a dispositivo, vigencias/offline/abuso y despliegue;
migraciones de binding y contador SAS con privilegios mínimos; confianza SAS
independiente y política de versiones/composición de roles. El contador del fixture
no es una migración aprobada. No hay un parámetro booleano que sustituya estas decisiones.

Una vez aprobados, completar esos adapters y montaje sobre los owners existentes,
probar en DB de preproducción y después autenticar un empleado autorizado de forma
interactiva. Sólo ese recorrido permite certificar P0-07; no reutilizar cuentas,
grants ni claves de fixtures. Windows no espera aprobación exclusiva de Android.
