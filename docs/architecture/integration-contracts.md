# ARCH-004: Contratos de integración del POS

## Estado

`DONE`.

## Propósito

Definir las fronteras de integración entre:

- renderer React y Electron main;
- Electron main y POS Local Service;
- POS Local Service y API central;
- POS Local Service y hardware;
- API central y proveedores externos.

Este documento concreta `ADR-003`, `ADR-005`, `DEC-007`, `DEC-008` y `DEC-010`. No define endpoints finales ni sustituye `TECH-003`, que materializará estos contratos en schemas y APIs ejecutables.

## Principios

1. Una frontera transporta intención y resultados; no traslada autoridad de dominio a la UI.
2. Todo contrato tiene versión explícita.
3. Toda operación crítica tiene identidad estable e idempotencia cuando pueda repetirse.
4. Un timeout no se interpreta automáticamente como fallo ni como éxito.
5. Los errores tienen códigos estables y detalles seguros para el usuario.
6. Los payloads se validan al entrar y al salir de cada frontera.
7. Ningún contrato filtra secretos, claves privadas o tokens completos.
8. Los DTO de un proveedor externo no se convierten en entidades de dominio.
9. La pérdida de una integración externa no invalida una venta local ya confirmada.
10. Auditoría, eventos y observabilidad son responsabilidades diferentes.

## Sobre común de solicitud

Toda solicitud entre procesos propios incluirá, cuando aplique:

```text
protocol_version
message_type
request_id
correlation_id
causation_id
operation_id
idempotency_key
tenant_id
company_id
branch_id
device_id
actor_id
expected_version
payload_schema_version
payload
```

Reglas:

- `request_id` identifica un intento de transporte;
- `operation_id` identifica el hecho lógico y no cambia en reintentos;
- `idempotency_key` identifica una orden repetible de manera segura;
- `correlation_id` agrupa el flujo extremo a extremo;
- `causation_id` conserva causalidad cuando una operación origina otra;
- los scopes solo se incluyen cuando fueron derivados y autorizados;
- el receptor no confía en scopes enviados por la UI sin revalidarlos.

## Sobre común de respuesta

```text
protocol_version
request_id
correlation_id
operation_id
status
result_code
result_schema_version
result
error
server_time
```

`status` se limita a:

- `SUCCEEDED`;
- `REJECTED`;
- `PENDING`;
- `UNKNOWN`.

`UNKNOWN` se utiliza cuando no existe evidencia suficiente para afirmar éxito o fallo. No habilita repetición ciega de una operación con efectos externos.

## Contrato de error

Un error estructurado incluye:

```text
code
category
retryable
user_message_key
field_errors
current_version
required_action
diagnostic_id
```

Categorías normativas:

- `VALIDATION`;
- `AUTHENTICATION`;
- `AUTHORIZATION`;
- `CONFLICT`;
- `NOT_FOUND`;
- `DEPENDENCY_UNAVAILABLE`;
- `RATE_LIMITED`;
- `INCOMPATIBLE_VERSION`;
- `INTEGRITY`;
- `UNKNOWN_OUTCOME`;
- `INTERNAL`.

Reglas:

1. Un error interno no expone stack trace al renderer ni al cliente HTTP.
2. `retryable` no autoriza crear un nuevo `operation_id`.
3. `RATE_LIMITED` conserva `retry_after` cuando la fuente lo provea.
4. `CONFLICT` devuelve versión actual o información suficiente para revisión.
5. `UNKNOWN_OUTCOME` obliga a consultar o reconciliar antes de repetir.
6. Los mensajes de usuario se resuelven en la interfaz; el código estable proviene del servicio.

## Renderer React ↔ Electron main

### Transporte

API allowlisted de preload sobre IPC interno de Electron.

### Operaciones permitidas

- consultar estado del runtime;
- enviar comandos de caso de uso;
- consultar resultados y proyecciones;
- recibir notificaciones tipadas;
- seleccionar archivos únicamente mediante diálogos controlados;
- solicitar acciones de ventana explícitas.

### Operaciones prohibidas

- acceso genérico a filesystem;
- ejecución de shell;
- importación dinámica de módulos Node;
- acceso directo a `ipcRenderer`;
- apertura directa de SQLite;
- lectura de variables de entorno;
- control directo de puertos, USB o serial;
- descarga y ejecución arbitraria de binarios.

### Validación

Preload y main validan el contrato. El renderer se considera entrada no confiable aunque el código forme parte del instalador.

## Electron main ↔ POS Local Service

### Transporte

Named pipes de Windows con:

- ACL restringida;
- nombre derivado de la instalación sin funcionar como secreto único;
- autenticación de la instancia;
- protocolo de challenge/response ligado al dispositivo cuando corresponda;
- límite de tamaño de mensajes;
- timeout por operación;
- framing explícito;
- cierre seguro ante mensajes inválidos.

### Handshake

Antes de habilitar funciones operativas se intercambian:

```text
desktop_version
service_version
protocol_min
protocol_max
installation_id
device_id
schema_version
service_state
```

El resultado del handshake puede ser:

- `COMPATIBLE`;
- `UPDATE_DESKTOP_REQUIRED`;
- `UPDATE_SERVICE_REQUIRED`;
- `MIGRATION_REQUIRED`;
- `RECOVERY_REQUIRED`;
- `UNTRUSTED_INSTALLATION`.

La UI no habilita venta si las versiones pueden interpretar de forma diferente una transacción crítica.

### Reintentos

- consultas pueden repetirse con nuevo `request_id`;
- comandos críticos conservan `operation_id` e `idempotency_key`;
- desconexión del canal no implica que el comando no fue persistido;
- después de reconectar se consulta el resultado por identidad antes de repetir.

## POS Local Service ↔ API central

### Transporte

HTTPS con TLS vigente y autenticación de dispositivo conforme a `DEC-008`.

### Tipos de intercambio

- autenticación y renovación de sesión del dispositivo;
- carga de operaciones outbox;
- descarga de configuración versionada;
- confirmación de inbox;
- checkpoints;
- heartbeat;
- estado de licencia y revocaciones;
- actualizaciones y manifiestos;
- diagnóstico autorizado.

### Sincronización

Cada operación sincronizada conserva:

```text
operation_id
aggregate_type
aggregate_id
operation_type
local_sequence
expected_version
payload_schema_version
payload_checksum
causation_id
correlation_id
occurred_at_local
recorded_at_local
```

La API central:

- valida tenant, empresa, sucursal, dispositivo y licencia;
- deduplica antes de aplicar efectos;
- verifica checksum para una identidad repetida;
- persiste inbox y resultado en la misma frontera transaccional aplicable;
- no usa el reloj local como autoridad global;
- devuelve conflicto explícito;
- no avanza checkpoint antes del commit.

### Lotes y control de flujo

- los lotes tienen límites configurables de cantidad y tamaño;
- una respuesta identifica cada operación individualmente;
- un fallo parcial no convierte todo el lote en éxito;
- `429` y `Retry-After` se respetan;
- el cliente aplica backoff con jitter;
- una operación incompatible se aísla sin perder las demás;
- la cola local conserva evidencia hasta confirmación durable.

## POS Local Service ↔ hardware

### Puerto común

Todo adaptador implementa un contrato de capacidad:

```text
adapter_id
adapter_version
device_kind
capabilities
connection_profile
health
execute(command)
cancel(command_id)
diagnostics()
```

El contrato no obliga a que todo dispositivo soporte cancelación. Las capacidades declaran el comportamiento real.

### Perfil de conexión

Puede incluir:

- USB HID;
- puerto serial/COM;
- USB virtual COM;
- red local restringida;
- spooler de Windows;
- interfaz provista por fabricante.

Credenciales o parámetros sensibles se referencian desde almacenamiento protegido; no se devuelven a la UI.

### Resultado de comando

```text
command_id
device_id
status
device_status
started_at
finished_at
retryable
diagnostic_code
result
```

Estados mínimos:

- `SUCCEEDED`;
- `FAILED`;
- `TIMED_OUT`;
- `CANCELLED`;
- `UNKNOWN`.

Un timeout de impresión no autoriza repetir una venta. La cola de impresión decide reintento del trabajo con la misma identidad.

### Aislamiento

1. El adaptador no modifica tablas de negocio.
2. El servicio traduce eventos de hardware a resultados de aplicación.
3. Un adaptador se carga solo si su versión y firma son confiables.
4. Fallar un adaptador no detiene adaptadores independientes.
5. Los comandos peligrosos, como apertura manual de cajón, verifican permiso y auditoría antes de ejecutarse.

## API central ↔ proveedores externos

La persistencia y ownership de esta frontera se rigen por `physical-model/external-integrations-schema.md`. `ExternalIntegration` es la conexión general; `FiscalConnection` es únicamente su perfil fiscal. `SyncOperation` cubre local↔central y un `IntegrationDispatch` durable cubre central↔provider, por lo que una llamada HTTP nunca se confunde con la entrega de Sync ni se ejecuta dentro del commit local.

Un `IntegrationDispatch` fiscal solo conserva intención, routing, correlación y estado agregado. Sus interacciones pertenecen exclusivamente a `FiscalSubmissionAttempt`, relacionado mediante `integration_dispatch_id`; `IntegrationDispatchAttempt` acepta únicamente dispatches `NON_FISCAL`. Las FKs discriminadas `FISCAL`/`NON_FISCAL` impiden dos historiales de attempt para una misma interacción fiscal.

La materialización es progresiva sin cambiar este contrato: migration 002 crea External Integrations y restringe físicamente todo dispatch a `NON_FISCAL`; migration 003 crea Fiscal/Electronic Invoicing y solo entonces habilita `FISCAL` junto con `FiscalSubmissionAttempt` y su FK discriminada. Runtime adapters y verificación real ocurren después y no son migrations.

Las integraciones externas se implementan mediante puertos específicos por capacidad, por ejemplo:

- proveedor de pagos;
- proveedor de facturación electrónica;
- correo o notificaciones;
- almacenamiento de objetos.

Cada puerto define un modelo canónico propio. Cada adaptador es responsable de:

- autenticación;
- renovación de credenciales;
- transformación de payloads;
- códigos y estados del proveedor;
- límites de tasa;
- timeouts;
- idempotencia disponible;
- consulta después de resultado incierto;
- redacción de secretos;
- compatibilidad de versión.

Un proveedor no modifica directamente ventas, pagos, caja, inventario ni auditoría. Sus respuestas originan comandos o resultados explícitos en el módulo propietario.

En el plano central↔provider, cada recurso sincronizable declara `POS_AUTHORITATIVE`, `PROVIDER_AUTHORITATIVE`, `BIDIRECTIONAL_WITH_EXPLICIT_CONFLICT_POLICY` o `REFERENCE_ONLY`. Esta `ResourceOwnershipPolicy` no reemplaza `SyncOperation.authority_policy`, que gobierna local↔central con el catálogo aprobado por `DEC-007`; no existe traducción 1:1 entre ambos. Una Sale puede ser `APPEND_ONLY_SHARED` en local↔central y `POS_AUTHORITATIVE` frente al provider, mientras el resultado fiscal es `PROVIDER_AUTHORITATIVE` sin transferir al provider ownership de Sale. No existe bidireccionalidad implícita ni `last-write-wins`. IDs externos se almacenan exclusivamente mediante `ExternalReferenceMapping`, nunca como columnas por proveedor en entidades canónicas.

El onboarding real sigue `Connect -> Test connection -> Discover -> Map -> Review -> Activate`; mostrar `Connected` no demuestra autenticación vigente ni verificación. Webhooks se reciben durablemente antes de procesar, derivan tenant/company desde la integración y solo aplican firma/autenticidad específica cuando el contrato oficial la documenta.

## Compatibilidad de versiones

1. Los cambios aditivos mantienen compatibilidad dentro de la ventana declarada.
2. Eliminar o reinterpretar campos exige nueva versión mayor del contrato.
3. Campos desconocidos no producen éxito si son críticos para integridad.
4. Clientes fuera de la ventana compatible reciben `INCOMPATIBLE_VERSION`.
5. Una actualización de schema no se activa antes de que productor y consumidor puedan interpretarla.
6. Los eventos históricos conservan su `payload_schema_version`.
7. Las versiones compatibles se prueban en CI mediante una matriz explícita.

## Seguridad

- TLS se verifica; no se deshabilita validación de certificados.
- Los tokens tienen alcance y duración mínimos.
- Las claves privadas de dispositivo no abandonan su almacenamiento protegido.
- Los contratos aplican límites de tamaño y profundidad.
- Se rechazan campos inesperados cuando puedan ocultar comportamiento crítico.
- Se aplican rate limits por tenant, dispositivo, actor e integración cuando corresponda.
- Webhooks, si existen, requieren autenticidad, deduplicación y protección contra replay.
- Logs, trazas y métricas no registran secretos ni documentos fiscales completos.
- El soporte no obtiene acceso ilimitado mediante un endpoint de diagnóstico.

## Observabilidad

Cada frontera registra:

- nombre y versión del contrato;
- resultado y latencia;
- `correlation_id`;
- tenant, sucursal y dispositivo cuando sea seguro;
- código de error;
- número de reintentos;
- estado del circuito o dependencia;
- métricas de cola y edad del mensaje.

La observabilidad no sustituye el registro auditable del actor, permiso, motivo y cambio de estado.

## Pruebas obligatorias

- contrato válido e inválido;
- versión compatible e incompatible;
- payload truncado o sobredimensionado;
- doble solicitud;
- misma idempotency key con checksum diferente;
- desconexión antes y después del commit;
- timeout con resultado posteriormente confirmado;
- `429` con `Retry-After`;
- dependencia `5xx`;
- certificado inválido;
- dispositivo revocado;
- canal local invocado por usuario no autorizado;
- adaptador de hardware bloqueado;
- impresión con resultado desconocido;
- checkpoint antes y después de commit;
- webhook duplicado o replay cuando aplique.

## Criterios de cierre

`ARCH-004` queda documentalmente cerrado porque:

1. las cinco fronteras están identificadas;
2. existe sobre común de solicitud, respuesta y error;
3. autoridad, idempotencia y resultado incierto están definidos;
4. el canal local no se expone a la red;
5. hardware opera mediante puertos y adaptadores;
6. la sincronización conserva el contrato de `DEC-007`;
7. los proveedores externos no contaminan el dominio;
8. están definidas compatibilidad, seguridad, observabilidad y pruebas mínimas.

La materialización en schemas Zod, IPC, endpoints y suites automatizadas pertenece a `TECH-003`, `TECH-004`, `DEV-003` y trabajos de implementación relacionados.
