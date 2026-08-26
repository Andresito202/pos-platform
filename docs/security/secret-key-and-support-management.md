# SEC-004: Gestión de secretos, claves y acceso de soporte

## Estado

`DONE` como contrato de seguridad. La selección de proveedores concretos de KMS, firma y cifrado local se materializa y verifica durante implementación.

## Propósito

Definir cómo POS Platform crea, almacena, usa, rota, revoca y retira:

- secretos de aplicación;
- claves de licencia;
- claves de actualización;
- claves de dispositivo;
- credenciales de integraciones externas y fiscales;
- certificados;
- claves de backup;
- accesos temporales de soporte.

Este documento complementa `DEC-008`, `DEC-009`, `DEC-010` y `docs/architecture/security-model.md`.

## Principios

1. No existe secreto universal compartido por todos los clientes.
2. Renderer, PWA y frontend web no reciben secretos de infraestructura, dispositivo o proveedor.
3. Las claves privadas centrales no se distribuyen a instalaciones.
4. Las claves privadas de dispositivo no se transmiten al servidor.
5. Firma de licencias y firma de actualizaciones son funciones separadas.
6. Sandbox, staging y producción usan secretos independientes.
7. Todo secreto tiene propietario, propósito, ambiente, rotación y retiro.
8. Logs, trazas, auditoría y diagnósticos no contienen secretos completos.
9. Un backup no se convierte en mecanismo para clonar identidad o licencia.
10. Soporte utiliza acceso temporal, autorizado, limitado y auditable; no una puerta trasera.

## Clasificación

| Clase | Ejemplos | Ubicación autorizada | Prohibido |
|---|---|---|---|
| Firma raíz | raíz de confianza de licencias/actualizaciones | custodia offline o HSM/KMS con control reforzado | repositorio, CI ordinario, cliente |
| Firma operativa | firma de licencias, manifiestos o releases | HSM/KMS o servicio de firma autorizado | renderer, variables públicas |
| Dispositivo | clave privada de instalación | protección criptográfica local no exportable cuando sea posible | servidor, backup ordinario, UI |
| Aplicación central | DB, object storage, APIs | secret manager del entorno | imagen, código, logs |
| Integración externa/fiscal | Siigo, Factus, Alegra, futuros ERP/proveedores, certificados | secret manager central por tenant/empresa/provider/ambiente | POS renderer, PWA, SQLite, Sync/Outbox/Audit, fixtures |
| Pago | credenciales de adquirente | secret manager y alcance del adaptador | venta, logs, export general |
| Backup | claves o referencias de cifrado | almacén separado del backup | mismo archivo sin protección |
| Sesión | access/refresh tokens | memoria o almacenamiento protegido según cliente | localStorage no protegido, logs |
| Soporte | token JIT y sesión | broker/servicio de soporte temporal | credencial maestra permanente |

## Inventario de secretos

Todo secreto productivo registra metadata sin revelar su valor:

```text
secret_reference
secret_class
owner_module
tenant_id cuando aplique
company_id cuando aplique
environment
provider
purpose
created_at
activated_at
expires_at
rotation_due_at
revoked_at
status
last_used_at
version
```

No se registra el secreto dentro de auditoría. El acceso registra referencia, actor/proceso, propósito y resultado.

## Claves centrales de firma

### Separación

Se utilizarán jerarquías o claves distintas para:

- licencias y activaciones;
- actualizaciones y artefactos;
- confianza de dispositivo;
- firma de mensajes administrativos cuando aplique.

Comprometer una clave no debe permitir firmar toda clase de artefacto.

### Custodia

- raíz de confianza protegida y fuera de procesos ordinarios;
- claves operativas en KMS/HSM o servicio equivalente con autenticación fuerte;
- acceso por identidad de workload, no credencial humana compartida;
- aprobación reforzada para rotación o revocación;
- logs del servicio de claves;
- exportación privada deshabilitada cuando la tecnología lo permita;
- procedimiento de continuidad y recuperación documentado.

### Rotación

Los artefactos incluyen `key_id` y versión. La rotación:

1. publica nueva clave pública mediante cadena autenticada;
2. mantiene ventana explícita de verificación cuando sea segura;
3. deja de firmar con clave retirada;
4. conserva evidencia histórica;
5. permite revocación urgente;
6. no invalida ventas ni documentos ya confirmados.

## Clave privada del dispositivo

El POS Local Service genera y usa la clave privada.

Reglas:

- se protege con Windows CNG, DPAPI u otro mecanismo aprobado para el perfil de servicio;
- se prefiere clave no exportable cuando la implementación y recuperación lo permitan;
- los permisos de filesystem y servicio limitan acceso;
- Electron renderer no puede solicitar exportación;
- la clave pública y attestations permitidas pueden registrarse centralmente;
- reinstalación no reutiliza silenciosamente una clave perdida;
- reemplazo sigue `DEC-008`;
- backups ordinarios excluyen la clave;
- clonar la carpeta no crea un dispositivo confiable.

La elección entre alcance de máquina, cuenta de servicio o almacén criptográfico se prueba contra instalación, actualización, cambio de usuario, backup y recuperación antes del piloto.

## Secretos locales de aplicación

Los secretos necesarios para el nodo local:

- se almacenan mediante DPAPI, Windows Credential Manager o almacén aprobado compatible con el servicio;
- no se guardan en `.env` productivo ni JSON plano;
- no se incluyen en parámetros de línea de comandos;
- no se devuelven a preload o renderer;
- se cargan bajo demanda y se mantienen el menor tiempo posible en memoria;
- se rotan o reemiten después de pérdida o compromiso;
- tienen fallback seguro cuando Windows no permite acceso.

## Credenciales de integraciones externas y fiscales

Las integraciones centrales conservan secretos por:

- tenant;
- empresa/NIT;
- proveedor;
- ambiente;
- versión.

Reglas:

1. `ExternalIntegration` e `IntegrationCredentialBinding` guardan únicamente referencias opacas; los valores permanecen en el secret manager.
2. Factus sandbox y producción nunca comparten la misma referencia.
3. Siigo `username/access_key`, Factus `client_id/client_secret/username/password` y Alegra API email/API token se tratan como material long-lived de cliente y nunca llegan a SQLite, renderer, PWA, SyncOperation, Outbox o AuditEvent.
4. Siigo `Partner-Id` es configuración de plataforma del integrador, separada de secretos de cliente; no se duplica por empresa como credencial.
5. Access tokens short-lived se mantienen en memoria/cache protegida o facility central de corta duración. Refresh tokens, cuando existan, se tratan como secretos rotables separados.
6. Tokens se obtienen y renuevan dentro del adapter central. Se respeta siempre `expires_in` retornado y el contrato efectivo; un valor de ejemplo no se hard-codea como autoridad.
7. Rotar credenciales crea un binding nuevo, prueba y revalida la conexión, activa el reemplazo y revoca/retira el anterior sin mostrar nuevamente valores almacenados.
8. Certificados privados se cifran y tienen vigencia monitorizada.
9. Cambiar NIT, provider, ambiente, credencial o certificado exige reautenticación, autorización, versionado y auditoría sanitizada.
10. El soporte puede validar estado y referencias sin revelar valores.
11. Un export de empresa no contiene secretos utilizables salvo procedimiento criptográfico específico y autorizado.

Si una modalidad futura exige emisión fiscal local, deberá crear una revisión de esta política para custodia local, contingencia, certificado y responsabilidades. No se copiarán automáticamente credenciales centrales al POS.

## Secretos centrales de aplicación

API, workers y migraciones obtienen secretos desde el mecanismo administrado del entorno.

- cada workload recibe alcance mínimo;
- producción no usa secretos de staging;
- la base utiliza usuario/rol acorde con la función;
- migraciones usan identidad controlada distinta cuando requieran privilegios superiores;
- rotar una credencial no exige reconstruir la imagen;
- el secreto no aparece en Dockerfile, repositorio, artefacto o cache de build;
- acceso humano directo se limita y audita.

## Datos en reposo

### Central

- PostgreSQL administrado con cifrado en reposo provisto y verificado;
- conexiones TLS;
- object storage cifrado;
- backups cifrados;
- claves y roles separados por entorno;
- acceso público cerrado o restringido cuando la plataforma lo permita.

### Nodo local

La línea base obligatoria incluye:

- ACL de Windows sobre base, WAL, backups, logs y configuración;
- cuenta de servicio con mínimo privilegio;
- secretos fuera de SQLite;
- backups cifrados al salir del equipo o ubicación confiable;
- recomendación y verificación de cifrado de disco cuando el sistema operativo lo permita;
- advertencia operativa si el equipo no dispone de cifrado de disco;
- bloqueo de exports no autorizados.

Antes del piloto se seleccionará y documentará uno de estos perfiles por oferta:

### `OS_PROTECTED`

SQLite se protege mediante ACL, cuenta de servicio y cifrado completo de disco administrado por el cliente o POS Platform. Deben quedar documentadas limitaciones y responsabilidad de recuperación.

### `DB_ENCRYPTED`

SQLite utiliza una implementación de cifrado a nivel de base que haya superado proof of concept de:

- licencia y redistribución;
- mantenimiento;
- soporte Node LTS;
- empaquetado Windows x64;
- rendimiento;
- WAL;
- backup y restauración;
- migración;
- rotación de clave;
- recuperación;
- actualización de Electron y servicio.

No se declarará SQLCipher u otra biblioteca como seleccionada hasta completar esa evidencia. Una dependencia nativa abandonada no entra al producto por el solo hecho de cifrar.

El perfil efectivo se registra por instalación. No se promete cifrado de base cuando solo existe ACL.

## Backups

- datos y claves se administran por separado;
- un backup incluye manifiesto, checksum, schema y versión;
- secretos de dispositivo se excluyen por defecto;
- credenciales fiscales no se copian en backups locales;
- claves de cifrado no se almacenan junto al backup sin protección;
- export y restauración requieren autorización;
- restaurar datos no restaura automáticamente confianza del dispositivo;
- pérdida de clave tiene procedimiento y consecuencias documentadas;
- las restauraciones se auditan.

## Instaladores y actualizaciones

Los artefactos productivos:

- se firman con certificado de firma de código o mecanismo aplicable;
- incluyen checksum y manifiesto;
- se construyen en CI controlado;
- conservan procedencia del commit;
- no incluyen secretos;
- verifican firma antes de instalar;
- rechazan paquetes alterados;
- respetan compatibilidad de schema;
- registran resultado y diagnóstico.

Las credenciales de firma:

- no se almacenan como archivo exportable en el repositorio;
- no se exponen a pull requests no confiables;
- solo son accesibles desde el workflow de release autorizado;
- requieren protección reforzada y rotación;
- no se comparten con firma de licencias.

## Acceso de soporte

### Regla

No existe contraseña maestra, usuario oculto, token permanente ni llave universal para entrar a instalaciones de clientes.

### Acceso conectado

Una sesión de soporte requiere:

```text
support_session_id
requesting_tenant
approved_by
support_actor
scope
reason
created_at
starts_at
expires_at
device_or_service_target
status
```

Además:

- MFA del personal de soporte;
- aprobación del cliente o política contractual explícita;
- privilegio mínimo;
- expiración corta y no renovable silenciosamente;
- reautenticación para acciones críticas;
- registro de comandos o acciones de alto nivel;
- prohibición de extracción masiva no autorizada;
- revocación inmediata;
- cierre y resumen auditable.

La sesión no permite revelar secretos. Operaciones fiscales, NIT, cuentas, QR, licencias, propietarios o exports requieren permisos reforzados.

### Soporte offline

`LOCAL_PERPETUAL` puede generar un paquete diagnóstico que contiene únicamente:

- versiones;
- estado de servicios;
- códigos de error;
- métricas locales necesarias;
- configuración no sensible allowlisted;
- integridad de schema;
- estado de colas sin payload comercial completo;
- referencias de dispositivo no secretas;
- logs redactados dentro de una ventana seleccionada.

El cliente ve alcance y autoriza la generación. El paquete tiene checksum, expiración o política de retiro y no incluye claves, tokens, contraseñas, credenciales fiscales ni base completa.

## Redacción y telemetría

Se redactan como mínimo:

- `Authorization` y cookies;
- access y refresh tokens;
- passwords;
- client secrets;
- claves privadas;
- cadenas de conexión;
- certificados privados;
- payloads fiscales completos;
- datos de tarjetas;
- códigos de recuperación;
- secretos de webhook;
- contenido de backups.

La redacción ocurre antes de enviar logs o trazas, no únicamente en el visor.

No se registra telemetría no autorizada en `LOCAL_PERPETUAL`. Las métricas externas respetan modalidad, contrato y privacidad.

## Rotación y respuesta a incidentes

Ante sospecha de compromiso:

1. identificar clase, ambiente y alcance;
2. bloquear o revocar credencial;
3. emitir reemplazo;
4. actualizar consumidores autorizados;
5. invalidar sesiones o tokens derivados;
6. evaluar datos y operaciones afectadas;
7. preservar evidencia;
8. notificar según obligación;
9. verificar que logs y backups no contengan el secreto;
10. cerrar con causa raíz y controles preventivos.

Una rotación no reescribe hechos históricos ni rompe la verificación de artefactos válidos sin una política explícita de confianza.

## Pruebas obligatorias

- secreto ausente del repositorio y artefactos;
- secreto ausente de renderer/preload;
- redacción de logs, errores y traces;
- acceso por workload autorizado y denegado;
- separación entre entornos;
- rotación sin downtime indebido;
- revocación;
- clave de dispositivo no exportable o protegida;
- clonación de carpeta no válida como nuevo dispositivo;
- backup sin claves privadas;
- restore sin activar identidad automáticamente;
- firma válida e inválida de instalador;
- workflow no autorizado sin acceso a firma;
- soporte expirado;
- soporte fuera de scope;
- diagnóstico offline sanitizado;
- credenciales Siigo/Factus/Alegra aisladas por tenant, empresa, provider y ambiente;
- rotación de credencial con binding nuevo, revalidación y retiro del anterior;
- access/refresh tokens ausentes de tablas de negocio, SQLite, Sync/Outbox/Audit, logs y excepciones;
- perfil local de datos en reposo seleccionado y verificado.

## Criterios de cierre

`SEC-004` queda documentalmente cerrado porque define:

1. clasificación e inventario de secretos;
2. jerarquías y custodia de firma;
3. protección de clave de dispositivo;
4. secretos locales y centrales;
5. credenciales fiscales por empresa y ambiente;
6. datos en reposo y perfiles locales honestos;
7. backups sin clonación de confianza;
8. firma de instaladores y actualizaciones;
9. soporte conectado y offline sin puerta trasera;
10. rotación, incidentes y pruebas.

La salida a piloto queda condicionada a seleccionar proveedores concretos, completar el proof of concept del perfil local de datos en reposo y aprobar evidencia automatizada. Esa materialización no requiere inventar nuevas reglas durante `TECH-002`.
