# UC-SYNC-003: Gestionar conflictos, reintentos, recuperación, reloj y observabilidad

## Objetivo

Definir el contrato operativo para detectar, clasificar, conservar, reintentar, revisar, recuperar y observar operaciones de sincronización que no pueden completarse automáticamente de forma inmediata.

Este caso de uso no redefine las políticas de autoridad ni reemplaza `DEC-007`.

Formaliza su ejecución mediante:

- conflictos explícitos;
- reintentos seguros;
- backoff controlado;
- recuperación tras reinicio;
- checkpoints;
- dead letter;
- revisión manual;
- reloj no autoritativo;
- observabilidad;
- aislamiento multi-tenant.

## Alcance

Aplica a operaciones sincronizables generadas o recibidas conforme a `UC-SYNC-001`.

Incluye:

- conflictos de versión;
- conflictos de idempotencia;
- conflictos de autoridad;
- dependencias ausentes;
- conflictos de estado;
- conflictos de permisos;
- conflictos de tenant;
- conflictos de dispositivo;
- conflictos de reloj;
- conflictos de versión de política;
- conflictos de resultados externos;
- agotamiento de reintentos;
- reinicios abruptos;
- corrupción o atraso de checkpoint;
- reloj no confiable;
- operaciones en dead letter;
- revisión manual;
- señales operativas de observabilidad.

No sustituye las reglas específicas de conflicto de cada dominio.

## Precondiciones

- Existe una `SyncOperation` válida.
- La operación tiene identidad global estable.
- Existe `idempotency_key`.
- Existe `payload_checksum` cuando corresponda.
- Existe `expected_version` cuando aplique.
- El tenant y dispositivo son identificables.
- La autoridad por dominio está definida.
- Existe persistencia local para operaciones pendientes.
- Existe inbox central para deduplicación.
- Existe checkpoint cuando corresponda.

## Actores

### Actor principal

Subsistema de sincronización.

### Actores secundarios

- dominio de negocio;
- dispositivo POS;
- servidor central;
- operador autorizado;
- revisor autorizado;
- subsistema de observabilidad;
- subsistema de auditoría.

## Estados operativos

Una operación puede encontrarse conceptualmente en estados como:

- `READY_TO_SYNC`;
- `SYNCING`;
- `SERVER_ACCEPTED`;
- `RETRY_SCHEDULED`;
- `WAITING_FOR_DEPENDENCY`;
- `CONFLICT`;
- `REVIEW_REQUIRED`;
- `DEAD_LETTER`.

Los estados específicos deben permanecer compatibles con `DEC-007` y `UC-SYNC-001`.

## Identidad durante reintentos

Un reintento conserva:

- `operation_id`;
- `idempotency_key`;
- `payload_checksum`;
- `aggregate_type`;
- `aggregate_id`;
- `tenant_id`;
- `device_id`;
- causalidad;
- payload original.

Un reintento no crea una nueva intención de negocio.

Si cambia materialmente el payload, debe crearse una nueva operación con identidad nueva.

## Clasificación de conflictos

Tipos conceptuales:

- `VERSION_CONFLICT`;
- `IDEMPOTENCY_CONFLICT`;
- `AUTHORITY_CONFLICT`;
- `DEPENDENCY_CONFLICT`;
- `STATE_CONFLICT`;
- `PERMISSION_CONFLICT`;
- `TENANT_CONFLICT`;
- `DEVICE_CONFLICT`;
- `CLOCK_CONFLICT`;
- `POLICY_VERSION_CONFLICT`;
- `EXTERNAL_RESULT_CONFLICT`;
- `RESOURCE_CONFLICT`.

Todo conflicto materializado mediante `SyncConflict` conserva como mínimo `conflict_id`, `conflict_type`, versiones esperada y vigente cuando apliquen, `authority_policy`, `severity`, `resolution_policy`, `status` y la evidencia de resolución definida por el modelo conceptual.

La clasificación debe permitir determinar:

- severidad;
- autoridad;
- posibilidad de reintento;
- necesidad de revisión;
- necesidad de compensación;
- posibilidad de dead letter.

## Conflicto de versión

Se produce cuando `expected_version` no coincide con la versión vigente del agregado autoritativo.

El sistema:

1. no sobrescribe silenciosamente;
2. conserva `expected_version`;
3. conserva `current_version`;
4. registra `SyncConflict`;
5. aplica política del dominio;
6. puede reintentar, esperar dependencia, requerir revisión o rechazar.

## Conflicto de idempotencia

Se produce cuando:

- la misma `operation_id` llega con diferente checksum; o
- la misma `idempotency_key` representa payload materialmente diferente.

La operación no se aplica automáticamente.

Debe producir conflicto explícito.

## Conflicto de autoridad

Se produce cuando una operación intenta modificar un dato cuya autoridad no corresponde al actor o lado que la origina.

No debe resolverse mediante last-write-wins.

La política se obtiene del dominio y de `DEC-007`.

## Conflicto de dependencia

Se produce cuando una operación válida no puede aplicarse porque falta una dependencia necesaria.

Ejemplos:

- entidad padre aún no sincronizada;
- configuración requerida ausente;
- licencia aún no disponible;
- referencia externa pendiente;
- operación causal todavía no aplicada.

Puede producir:

- `WAITING_FOR_DEPENDENCY`;
- `RETRY_SCHEDULED`;
- `REVIEW_REQUIRED`;
- `DEAD_LETTER`.

## Conflicto de estado

Se produce cuando la transición solicitada ya no es compatible con el estado actual.

No debe corregirse por sobrescritura.

El dominio decide si:

- rechaza;
- compensa;
- reintenta;
- deriva a revisión.

## Conflicto de permisos

Se produce cuando el actor o dispositivo no posee autorización suficiente para aplicar la operación.

Un reintento no amplía permisos.

Una operación no puede autoautorizarse por repetición.

## Conflicto de tenant

Se produce cuando existe inconsistencia de aislamiento entre tenant, empresa, sucursal, dispositivo, actor o agregado.

Debe considerarse error crítico de seguridad.

Nunca debe repararse mediante reasignación automática de tenant.

## Conflicto de dispositivo

Se produce cuando la operación se origina o intenta aplicarse desde un dispositivo no autorizado, revocado, incompatible o fuera de alcance.

No debe ignorarse por estar offline.

## Conflicto de reloj

El reloj local del dispositivo no constituye autoridad global.

Se utiliza únicamente como evidencia temporal local.

Debe conservarse cuando corresponda:

- `occurred_at_local`;
- `recorded_at_local`;
- `received_at_server`;
- `committed_at_server`;
- `device_clock_offset`;
- `clock_quality`;
- `last_clock_sync_at`.

Una desviación significativa puede producir:

- `CLOCK_CONFLICT`;
- `SYNC_CLOCK_UNTRUSTED`;
- revisión;
- restricción operativa.

No se utiliza `last-write-wins` basado únicamente en timestamps del dispositivo.

## Calidad de reloj

Valores conceptuales compatibles con el modelo:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- o los definidos normativamente por `DeviceClockState`.

La calidad del reloj no altera por sí sola la autoridad de datos.

## Reintentos

Los reintentos deben ser seguros e idempotentes.

Reglas:

1. conservan identidad;
2. conservan payload;
3. conservan checksum;
4. incrementan `attempt_count`;
5. registran `last_attempt_at`;
6. calculan `next_attempt_at`;
7. no duplican efectos de negocio;
8. respetan tenant y dispositivo;
9. respetan permisos y autoridad;
10. no modifican silenciosamente la operación original.

## Backoff

Los reintentos automáticos utilizan backoff exponencial con jitter.

El contrato debe permitir al menos:

- intento actual;
- retraso calculado;
- límite máximo;
- jitter;
- error anterior;
- próxima ejecución.

El sistema debe evitar tormentas de reintentos.

## Error recuperable

Un error puede considerarse recuperable cuando existe expectativa razonable de éxito posterior sin cambiar la intención original.

Ejemplos:

- red temporalmente indisponible;
- timeout;
- dependencia aún no disponible;
- servidor temporalmente no disponible;
- bloqueo transitorio.

## Error no recuperable automáticamente

Ejemplos:

- checksum incompatible;
- tenant incorrecto;
- payload inválido;
- dispositivo revocado;
- permiso inexistente;
- violación estructural;
- conflicto que exige revisión.

No debe insistirse indefinidamente.

## Agotamiento de reintentos

Cuando se alcanza el límite aplicable:

- la operación deja de reintentarse automáticamente;
- conserva todo su historial;
- registra motivo;
- puede pasar a `REVIEW_REQUIRED`;
- puede pasar a `DEAD_LETTER`;
- puede permitir reintento manual autorizado.

## Dead letter

`DEAD_LETTER` representa una operación que no puede procesarse automáticamente de forma segura.

Debe conservar:

- `operation_id`;
- tenant;
- dispositivo;
- payload checksum;
- error final;
- intentos;
- timestamps;
- conflicto asociado cuando exista;
- evidencia relevante;
- estado de revisión.

Una dead letter no se elimina automáticamente mientras exista necesidad de revisión o retención.

## Revisión manual

`REVIEW_REQUIRED` requiere intervención autorizada.

La revisión debe conservar:

- `review_id`;
- `conflict_id`;
- actor;
- rol;
- decisión;
- motivo;
- evidencia;
- momento de decisión.

Posibles decisiones:

- aceptar;
- rechazar;
- reintentar;
- compensar;
- esperar dependencia;
- enviar a dead letter.

La revisión no debe borrar el historial original.

## Checkpoint

El checkpoint representa la posición confirmada de sincronización.

Reglas:

1. se actualiza transaccionalmente;
2. no avanza antes de confirmación persistida;
3. permanece aislado por tenant y dispositivo;
4. permite reanudar tras reinicio;
5. no omite operaciones pendientes;
6. un checkpoint corrupto activa recuperación controlada.

## Recuperación tras reinicio

Después de un reinicio:

1. carga persistencia local;
2. identifica operaciones `SYNCING` sin confirmación final;
3. carga checkpoint;
4. valida estado de outbox;
5. reconstruye operaciones pendientes;
6. aplica idempotencia;
7. reanuda según estado y backoff;
8. no asume como aceptada una operación sin evidencia;
9. no descarta operaciones pendientes;
10. conserva causalidad y orden requerido.

## Operación interrumpida durante SYNCING

Una operación que estaba en `SYNCING` antes de un reinicio no se considera automáticamente:

- perdida;
- aceptada;
- rechazada.

Debe reconciliarse con:

- inbox;
- checkpoint;
- idempotencia;
- confirmación central;
- estado local persistido.

## Recuperación de checkpoint

Si el checkpoint es inconsistente o corrupto:

1. no se avanza artificialmente;
2. se conserva evidencia;
3. se inicia reconciliación controlada;
4. se consulta la autoridad cuando sea posible;
5. se reconstruye desde registros persistentes;
6. se evita duplicar efectos.

## Recuperación local

La recuperación de base local no puede:

- alterar identidades;
- regenerar derechos;
- eliminar revocaciones;
- cambiar tenant;
- borrar conflictos abiertos;
- asumir confirmaciones inexistentes.

## Orden y causalidad

La sincronización debe respetar dependencias causales cuando existan.

Una operación puede permanecer en `WAITING_FOR_DEPENDENCY` hasta que la dependencia requerida sea confirmada.

El reloj no sustituye relaciones de causalidad.

## Observabilidad

La observabilidad permite detectar degradación y fallos operativos sin convertirse en fuente de verdad del dominio.

Señales mínimas compatibles con contratos existentes:

- `sync_operations_success`;
- `sync_operations_retry`;
- `sync_operations_conflict`;
- `sync_operations_dead_letter`;
- `outbox_depth`;
- `oldest_pending_age`;
- `checkpoint_lag`;
- `clock_offset`;
- cantidad de operaciones en `REVIEW_REQUIRED`;
- cantidad en `WAITING_FOR_DEPENDENCY`.

Las métricas deben poder segmentarse como mínimo por:

- tenant;
- dispositivo;
- módulo;
- resultado;
- tipo de conflicto.

## Separación entre observabilidad y auditoría

Observabilidad:

- diagnostica comportamiento operativo;
- mide salud;
- detecta tendencias;
- permite alertas.

Auditoría:

- conserva evidencia de acciones y decisiones relevantes;
- identifica actores;
- conserva trazabilidad normativa.

Una métrica no sustituye un registro auditable.

## Alertas operativas

Puede generarse alerta cuando:

- aumenta `outbox_depth`;
- aumenta `oldest_pending_age`;
- crece `checkpoint_lag`;
- aumentan conflictos;
- aumentan dead letters;
- el checkpoint no avanza;
- el reloj es `UNTRUSTED`;
- hay reintentos repetidos;
- existen operaciones pendientes durante demasiado tiempo.

## Seguridad de observabilidad

La observabilidad debe:

- respetar aislamiento multi-tenant;
- minimizar datos sensibles;
- evitar incluir secretos;
- no registrar credenciales;
- no exponer payload completo cuando no sea necesario;
- no sustituir controles preventivos.

## Auditoría

Eventos relevantes:

- creación de conflicto;
- cambio de estado;
- programación de reintento;
- agotamiento de reintentos;
- entrada a `REVIEW_REQUIRED`;
- decisión manual;
- entrada a `DEAD_LETTER`;
- recuperación de checkpoint;
- recuperación tras reinicio;
- detección de reloj no confiable.

Debe conservarse:

- tenant;
- actor;
- dispositivo;
- `operation_id`;
- `conflict_id` cuando exista;
- resultado;
- motivo;
- timestamps;
- evidencia técnica necesaria.

## Errores conceptuales

Como mínimo:

- `SYNC_PAYLOAD_CHECKSUM_MISMATCH`;
- `SYNC_IDEMPOTENCY_CONFLICT`;
- `SYNC_VERSION_CONFLICT`;
- `SYNC_STATE_CONFLICT`;
- `SYNC_AUTHORITY_CONFLICT`;
- `SYNC_DEPENDENCY_CONFLICT`;
- `SYNC_PERMISSION_CONFLICT`;
- `SYNC_TENANT_CONFLICT`;
- `SYNC_DEVICE_CONFLICT`;
- `SYNC_CLOCK_UNTRUSTED`;
- `SYNC_POLICY_VERSION_CONFLICT`;
- `SYNC_EXTERNAL_RESULT_CONFLICT`;
- `SYNC_RETRY_EXHAUSTED`;
- `SYNC_REVIEW_REQUIRED`;
- `SYNC_DEAD_LETTER`;
- `SYNC_CHECKPOINT_INVALID`;
- `SYNC_RECOVERY_REQUIRED`.

## Invariantes

1. Un conflicto no se oculta.
2. Un conflicto no sobrescribe silenciosamente el estado existente.
3. Un reintento conserva identidad.
4. Un reintento conserva checksum.
5. Un reintento no duplica efectos.
6. Un reintento no amplía permisos.
7. El reloj local no define autoridad global.
8. No se usa last-write-wins como regla general de resolución.
9. Un checkpoint no avanza sin confirmación persistida.
10. Una cola pendiente sobrevive reinicios.
11. Una recuperación conserva evidencia.
12. Una operación `SYNCING` sin confirmación debe reconciliarse.
13. Un tenant no puede acceder a operaciones de otro tenant.
14. Una dead letter permanece visible hasta su tratamiento.
15. Una revisión manual conserva actor, motivo y decisión.
16. Los conflictos críticos requieren política explícita.
17. La observabilidad no sustituye auditoría.
18. La observabilidad no sustituye autorización.
19. Las métricas respetan aislamiento multi-tenant.
20. La causalidad prevalece sobre orden temporal local cuando exista dependencia explícita.

## Excepciones

- error transitorio;
- error permanente;
- versión obsoleta;
- checksum incompatible;
- dependencia ausente;
- permiso insuficiente;
- tenant incorrecto;
- dispositivo no autorizado;
- reloj no confiable;
- checkpoint corrupto;
- reinicio durante sincronización;
- agotamiento de reintentos;
- conflicto no resoluble automáticamente;
- dead letter;
- revisión pendiente.

## Postcondiciones

Cuando la operación se resuelve automáticamente:

- existe resultado determinista;
- se conserva evidencia;
- se actualiza estado correspondiente;
- el checkpoint avanza solo cuando corresponde.

Cuando no puede resolverse automáticamente:

- el conflicto permanece explícito;
- la operación queda en estado controlado;
- no se pierde;
- no se duplica;
- puede requerir revisión o dead letter.

## Pruebas mínimas

### Conflictos

- version conflict;
- idempotency conflict;
- authority conflict;
- dependency conflict;
- state conflict;
- permission conflict;
- tenant conflict;
- device conflict;
- clock conflict;
- policy version conflict.

### Reintentos

- primer reintento;
- múltiples reintentos;
- backoff creciente;
- jitter;
- reinicio conserva intento;
- reintento no duplica efecto;
- reintento manual autorizado;
- agotamiento de reintentos.

### Checkpoints

- avance válido;
- no avanza antes de confirmación;
- recuperación desde checkpoint;
- checkpoint corrupto;
- aislamiento por tenant;
- aislamiento por dispositivo.

### Recuperación

- reinicio sin operaciones pendientes;
- reinicio con outbox pendiente;
- reinicio durante `SYNCING`;
- operación aceptada pero respuesta perdida;
- operación no aceptada;
- recuperación conserva identidad;
- recuperación conserva checksum.

### Reloj

- reloj confiable;
- reloj degradado;
- reloj no confiable;
- timestamp futuro;
- timestamp atrasado;
- cambio manual de reloj;
- reloj no determina precedencia.

### Dead letter y revisión

- agotamiento lleva a dead letter;
- conflicto crítico lleva a review;
- revisión acepta;
- revisión rechaza;
- revisión reintenta;
- revisión compensa;
- dead letter no se purga prematuramente.

### Observabilidad

- aumenta outbox depth;
- aumenta oldest pending age;
- aumenta checkpoint lag;
- conflicto incrementa métrica;
- retry incrementa métrica;
- dead letter incrementa métrica;
- alerta por reloj no confiable;
- aislamiento de métricas por tenant.

### Seguridad

- conflicto cross-tenant;
- intento de ampliar permiso por retry;
- payload alterado;
- dispositivo revocado;
- observabilidad sin secretos.

## Documentos normativos relacionados

- docs/adr/ADR-003-local-first.md;
- docs/adr/DEC-007-local-first-data-authority.md;
- docs/architecture/conceptual-data-model.md;
- docs/domain/business-rules.md;
- docs/domain/glossary.md;
- docs/product/non-functional-requirements.md;
- docs/security/permission-matrix.md;
- docs/use-cases/sync/UC-SYNC-001-synchronize-operation.md;
- docs/use-cases/sync/UC-SYNC-002-manage-offline-configuration.md.