# UC-SYNC-001: Sincronizar operación local-first

## Objetivo

Sincronizar una operación local-first entre un dispositivo POS y el nodo central de forma determinista, idempotente, auditable y recuperable, preservando identidad global, causalidad, aislamiento multi-tenant y autoridad por dominio.

Este caso de uso operacionaliza ADR-003 y DEC-007.

No redefine las políticas de conflicto, autoridad, reloj, recuperación o retención ya establecidas por DEC-007.

## Actor principal

Agente de sincronización del dispositivo POS.

## Actores secundarios

- API central;
- motor de dominio correspondiente;
- almacenamiento local;
- outbox local;
- inbox central;
- servicio de autorización;
- subsistema de observabilidad.

## Precondiciones

- El dispositivo posee identidad válida.
- La instalación está autorizada.
- El tenant efectivo está resuelto.
- La operación pertenece a un dominio sincronizable.
- La política offline aplicable permite generar la operación.
- Existe una identidad global de operación.
- El payload es serializable de forma determinista.
- La versión de esquema es compatible.
- La autorización requerida fue evaluada conforme a la política aplicable.

## Entrada

- operation_id;
- idempotency_key;
- correlation_id;
- tenant_id derivado;
- company_id opcional;
- branch_id opcional;
- device_id;
- installation_id;
- aggregate_type;
- operation_type;
- aggregate_id opcional;
- session_id opcional;
- actor_id opcional;
- expected_version opcional;
- causation_id opcional;
- parent_operation_id opcional;
- payload;
- payload_checksum;
- schema_version;
- policy_version opcional;
- occurred_at_local;
- recorded_at_local;
- clock_quality;
- local_sequence;
- sync_status.

## Identidad global de operación

Cada operación sincronizable debe poseer operation_id globalmente único.

La identidad no cambia durante:

- reintentos;
- reinicios;
- pérdida de respuesta;
- reenvíos;
- recuperación del dispositivo;
- procesamiento por lotes.

idempotency_key identifica la intención idempotente asociada.

La misma idempotency_key con el mismo payload debe devolver el resultado previamente conocido.

La misma idempotency_key con un payload diferente debe producir conflicto explícito.

## Atomicidad local

La operación de negocio y su registro en outbox deben persistirse en la misma transacción local.

No se considera confirmada localmente una operación sincronizable si:

- el efecto de negocio fue persistido pero la outbox no;
- la outbox fue persistida pero el efecto de negocio no.

La atomicidad local debe impedir operaciones huérfanas.

## Outbox local

Cada operación pendiente de sincronización se representa mediante una entrada persistente de outbox.

La outbox conserva como mínimo:

- outbox_id;
- operation_id;
- tenant_id;
- device_id;
- local_sequence;
- operation_type;
- payload_checksum;
- sync_status;
- attempt_count;
- next_attempt_at opcional;
- last_attempt_at opcional;
- last_error_code opcional;
- causalidad aplicable.

La outbox no es una cola únicamente en memoria.

Un reinicio del POS no puede perder operaciones pendientes.

## Estados de sincronización

Los estados conceptuales aplicables son:

- LOCAL_PENDING;
- READY_TO_SYNC;
- SYNCING;
- SERVER_ACCEPTED;
- SERVER_REJECTED;
- CONFLICT;
- WAITING_FOR_DEPENDENCY;
- RETRY_SCHEDULED;
- REVIEW_REQUIRED;
- DEAD_LETTER;
- ARCHIVED.

Las transiciones deben respetar DEC-007.

## Preparación para envío

Antes del envío:

1. se valida integridad local;
2. se valida payload_checksum;
3. se valida compatibilidad de esquema;
4. se valida tenant;
5. se valida dispositivo;
6. se verifica causalidad requerida;
7. se verifica expected_version cuando aplique;
8. se confirma que la operación sea elegible para sincronización.

Una operación no elegible no se envía silenciosamente.

## Envío al nodo central

El mensaje enviado debe conservar:

- operation_id;
- idempotency_key;
- correlation_id;
- tenant_id;
- device_id;
- installation_id;
- expected_version;
- causation_id;
- payload;
- payload_checksum;
- schema_version;
- policy_version aplicable.

Un reintento reutiliza la misma identidad.

## Inbox central

El nodo central mantiene inbox persistente.

La inbox debe conservar como mínimo:

- tenant_id;
- operation_id;
- idempotency_key;
- payload_checksum;
- processing_status;
- result_code;
- previous_version opcional;
- new_version opcional;
- received_at_server;
- committed_at_server opcional.

Debe permitir detectar:

- operación nueva;
- replay;
- reintento válido;
- idempotency conflict;
- checksum conflict;
- operación ya aceptada;
- operación ya rechazada;
- operación en revisión.

La inbox no se confirma hasta que los efectos principales de la operación queden persistidos.

## Procesamiento central

El nodo central debe:

1. validar autenticidad y contexto;
2. validar tenant;
3. validar dispositivo;
4. validar esquema;
5. validar checksum;
6. consultar inbox;
7. evaluar idempotencia;
8. validar versión esperada;
9. validar causalidad;
10. aplicar autoridad por dominio;
11. ejecutar reglas de negocio;
12. persistir efectos;
13. persistir resultado de inbox;
14. devolver respuesta estructurada.

## Control de versión

Cuando exista expected_version, debe cumplirse:

expected_version = current_version

si la política del dominio exige coincidencia estricta.

Una diferencia produce conflicto de versión y no debe sobrescribir silenciosamente el estado central.

## Causalidad

Las operaciones dependientes deben declarar causalidad explícita.

Una operación cuya dependencia requerida no exista o no esté confirmada puede pasar a:

- WAITING_FOR_DEPENDENCY;
- CONFLICT;
- REVIEW_REQUIRED;

según la política del dominio.

El orden de llegada no sustituye el orden causal.

## Autoridad por dominio

La autoridad no se determina genéricamente.

Debe aplicarse la política definida en DEC-007, incluyendo cuando corresponda:

- LOCAL_AUTHORITATIVE_UNTIL_SYNC;
- SERVER_AUTHORITATIVE;
- APPEND_ONLY_SHARED;
- CENTRAL_REVIEW_REQUIRED;
- EXTERNAL_PROVIDER_AUTHORITATIVE;
- DERIVED_PROJECTION.

Este caso de uso no puede convertir una proyección derivada en fuente de verdad.

## Reloj y tiempo

El tiempo local es evidencia contextual.

No se usa created_at_local ni cualquier timestamp del dispositivo como autoridad global de precedencia.

No se utiliza last-write-wins como política genérica.

Una calidad de reloj no confiable debe quedar registrada y puede provocar revisión o restricción según política.

## Resultado del servidor

La respuesta central debe contener como mínimo:

- operation_id;
- accepted;
- result_code;
- server_version opcional;
- conflict_id opcional;
- review_id opcional;
- authoritative_result opcional;
- processed_at;
- server_checkpoint opcional;
- correlation_id.

## Confirmación local

Cuando el servidor acepta la operación:

1. se valida que la respuesta corresponda al mismo operation_id;
2. se valida integridad de respuesta;
3. se registra resultado;
4. se actualiza estado a SERVER_ACCEPTED;
5. se actualizan proyecciones locales autorizadas cuando corresponda;
6. se avanza checkpoint únicamente sobre operaciones confirmadas;
7. la entrada puede archivarse conforme a retención.

## Rechazo central

Un rechazo autoritativo debe conservar:

- reason_code;
- operación original;
- payload original;
- checksum;
- respuesta central;
- evidencia de auditoría.

Un rechazo no elimina destructivamente la operación local.

## Reintentos

Un reintento conserva:

- operation_id;
- idempotency_key;
- payload;
- payload_checksum;
- causalidad original.

No se crea una nueva identidad para un simple reintento.

Los errores reintentables y no reintentables se clasifican conforme a DEC-007.

## Checkpoint

El checkpoint representa progreso confirmado de sincronización.

Debe conservar como mínimo:

- tenant_id;
- device_id;
- last_uploaded_sequence;
- last_server_acknowledged_sequence;
- last_downloaded_cursor;
- last_successful_sync_at;
- last_full_reconciliation_at opcional;
- checkpoint_status.

Reglas:

1. se actualiza transaccionalmente;
2. no avanza sobre operaciones no confirmadas;
3. un reinicio retoma desde el checkpoint;
4. debe estar aislado por tenant y dispositivo;
5. corrupción de checkpoint activa recuperación explícita.

## Recuperación tras reinicio

Al reiniciar:

1. se carga el checkpoint;
2. se valida integridad de outbox;
3. se recuperan operaciones pendientes;
4. se reconstruyen estados transitorios seguros;
5. se reanudan reintentos elegibles;
6. no se generan nuevas identidades para operaciones existentes.

## Aislamiento multi-tenant

Toda operación debe conservar el tenant efectivo.

Ningún 	enant_id enviado por cliente constituye por sí solo prueba suficiente de pertenencia.

Una operación no puede:

- leer datos de otro tenant;
- escribir datos de otro tenant;
- utilizar una outbox de otro tenant;
- avanzar checkpoint de otro tenant;
- consumir una inbox de otro tenant.

## Seguridad

La sincronización debe validar en backend:

- identidad del dispositivo;
- tenant;
- instalación;
- autorización;
- integridad del payload;
- versión de esquema;
- versión de política;
- revocaciones conocidas.

Una operación offline no puede utilizarse para evadir controles de seguridad.

## Salida

- operation_id;
- final_sync_status;
- accepted;
- result_code;
- server_version opcional;
- conflict_id opcional;
- review_id opcional;
- checkpoint opcional;
- retry_at opcional;
- correlation_id;
- audit_reference.

## Flujos alternos

### Replay con mismo checksum

La inbox devuelve el resultado previo de forma idempotente.

### Misma idempotency key con payload diferente

Se produce SYNC_IDEMPOTENCY_CONFLICT.

### Versión incompatible

Se produce SYNC_VERSION_CONFLICT.

### Dependencia ausente

La operación pasa a WAITING_FOR_DEPENDENCY o conflicto según política.

### Tenant incorrecto

La operación se rechaza sin revelar información del tenant objetivo.

### Dispositivo revocado

La operación se rechaza conforme a la política de seguridad.

### Reloj no confiable

El reloj se registra como evidencia no confiable y no decide precedencia.

### Respuesta perdida después de aceptación

El dispositivo reintenta con la misma identidad y la inbox devuelve el resultado previo.

## Reglas de consistencia

1. Una operación posee una sola identidad global.
2. Un reintento no crea otra operación lógica.
3. Negocio y outbox son atómicos localmente.
4. Efectos centrales e inbox son atómicos centralmente.
5. La misma operación no produce efectos duplicados.
6. El checksum debe ser determinista.
7. El tenant debe preservarse extremo a extremo.
8. La causalidad no se reemplaza por timestamps.
9. El checkpoint solo representa progreso confirmado.
10. Los conflictos nunca se ocultan mediante sobrescritura.
11. Las proyecciones derivadas no sustituyen hechos fuente.
12. Un error de red no significa rechazo de negocio.
13. Una respuesta tardía no crea una segunda operación.
14. El estado local debe poder recuperarse tras reinicio.
15. La sincronización debe ser auditable.

## Puntos de auditoría

Registrar como mínimo:

- operation_id;
- idempotency_key;
- tenant_id;
- device_id;
- operation_type;
- payload_checksum;
- expected_version;
- estado previo;
- estado nuevo;
- reason_code;
- local_sequence;
- conflict_id;
- review_id;
- correlation_id;
- actor o agente técnico;
- momento observado.

## Puntos de observabilidad futura

Métricas mínimas:

- outbox_depth;
- inbox_dedup_hits;
- sync_success_total;
- sync_rejected_total;
- sync_operations_conflict;
- local_sequence;
- dead_letter_count;
- checkpoint_lag;
- oldest_pending_operation_age;
- checksum_mismatch_total;
- clock_quality_degraded_total.

## Pruebas mínimas

### Identidad e idempotencia

- operation_id único;
- reintento conserva operation_id;
- reintento conserva idempotency_key;
- mismo checksum devuelve resultado previo;
- checksum diferente genera conflicto.

### Atomicidad

- negocio y outbox en una transacción;
- rollback del negocio revierte outbox;
- fallo de outbox revierte negocio;
- inbox y efectos centrales en una transacción.

### Versionado y causalidad

- expected_version correcto;
- expected_version obsoleto;
- dependencia disponible;
- dependencia ausente;
- orden de llegada distinto al orden causal.

### Recuperación

- reinicio con outbox pendiente;
- reinicio durante envío;
- respuesta perdida tras aceptación;
- checkpoint válido;
- checkpoint corrupto.

### Seguridad

- tenant incorrecto;
- dispositivo revocado;
- payload manipulado;
- checksum incorrecto;
- esquema no soportado;
- replay.

### Reloj

- reloj correcto;
- reloj adelantado;
- reloj atrasado;
- reloj manipulado;
- timestamp nunca decide autoridad.

## Documentos normativos relacionados

- docs/adr/ADR-003-local-first.md;
- docs/adr/DEC-007-local-first-data-authority.md;
- docs/adr/DEC-008-device-trust-license-activation.md;
- docs/architecture/conceptual-data-model.md;
- docs/domain/business-rules.md;
- docs/domain/glossary.md;
- docs/security/permission-matrix.md.