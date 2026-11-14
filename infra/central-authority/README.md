# Central Authority: preparación de despliegue Windows comercial

Estado 2026-10-26: el propietario confirma **entorno todavía no existente o no
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
200 para el servicio listo; declara `commercial_auth: NOT_ACTIVATED` sin montaje
comercial o `CONFIGURED` cuando el preflight comercial está satisfecho. CONFIGURED
no significa usuario autenticado ni certificación humana. Las comprobaciones concurrentes comparten una
consulta y tienen deadline explícito. SIGINT/SIGTERM drenan HTTP antes de cerrar
el pool; el deadline configurado fuerza cierre de conexiones y salida fallida
si no termina. Un Host distinto del origen configurado se rechaza.

Sin selector ni campos del perfil se conserva el arranque **legacy de enrollment** para no
alterar callers/workflows existentes. Sus defaults históricos no son configuración
comercial aprobada. Sin provisión comercial explícita las rutas BUSINESS permanecen bloqueadas.
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

El montaje está implementado y probado en laboratorio: BUSINESS, binding PKCE,
access/refresh V2, SSA/SAS, DPAPI, entrada Electron y logout. No reconstruirlo.
El proceso existente monta el handler sólo con CENTRAL_COMMERCIAL_PROVISION_FILE,
perfil PREPRODUCTION/PRODUCTION, manifiesto 008–016 exacto y confianza verificada.
No basta renombrar un perfil de laboratorio ni establecer un booleano.

Procedimiento operativo reutilizable, con entradas del operador:

1. Obtener el manifiesto sin conexión ni DDL:
   `pnpm --filter @pos-platform/target-migrations postgres:commercial:apply --manifest`.
2. Operador DB aplica el runner registrado con URL pos_migrator, base/SHA exactos
   y timeouts explícitos. Conservar ledger y resultados. No usar proposals/ ni
   ejecutar contra bases comerciales desde una sesión de laboratorio.
3. Configurar el archivo CAMACHO_CENTRAL_COMMERCIAL_V2 según el schema compartido,
   con datos reales, políticas, factor/membresía y claves operacionales distintas.
   Instalar las publicaciones SSA/SAS y tokens separados por archivo protegido;
   verificar pins con sus custodios. Nunca transferir claves raíz privadas.
4. Aprovisionar DEV-003 auténtico, Service y archivo público Desktop coincidente,
   conforme al [cierre Windows](../../docs/testing/windows-login-closure-2026-10-26.md).
5. Arrancar el servicio existente y comprobar TLS desde Windows, /ready, ruta
   comercial y después la ceremonia con persona/autenticador físico. Preservar
   evidencia de renovación, logout, revocación y denegación tras reinicio.

Observación local 2026-10-26: SCM informa PosLocalService Running. Las variables
de Central y los archivos de provisión no se proporcionaron a esta consola;
no se infiere que falten en todas las cuentas del sistema. No se reinició ni
reconfiguró el servicio instalado. Sin URL, operador y material auténtico no se
ejecutó un despliegue ni se certificó P0-07. CI permanece pendiente; no Actions.

## P0 focalizado de login, sin dependencias de facturación

Se añadió `pnpm --filter @pos-platform/central-authority run login:preflight`.
Es de **solo lectura**, comprueba presencia de variables/archivos administrados
de BUSINESS/GLOBAL y coincidencia TLS local con el perfil del proceso.
No consulta PostgreSQL, no ejecuta el servidor, no imprime secretos y nunca
certifica MFA humano, pertenencia/roles reales o SSA/SAS firmados por el operador.

La prueba que precede al montaje real sigue exigiendo origen HTTPS aprobado,
registro ELECTRON exacto, identidad D3, roles verificados, PostgreSQL de
privilegios mínimos y raíces independientes. Ninguna ausencia se suple
con identidades aleatorias, `NODE_TLS_REJECT_UNAUTHORIZED=0`, bypass RLS
o credenciales copiadas de laboratorio. El VPS y dominio comercial definitivos
siguen fuera del P0 de implementación.
