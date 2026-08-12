# PHY-G11: SyncDeadLetter

## Estado y alcance

Contrato documental de `PHY-G11` para operaciones de sincronización que agotaron reintentos o no pueden procesarse automáticamente de forma segura.

Este documento no contiene DDL ni autoriza migraciones. Al cerrar `PHY-G11`, `TECH-002` permanecía `IN_PROGRESS`, la primera migración permanecía `NO-GO` y `PHY-G12` todavía no se había iniciado; su evolución posterior se registra en `traceability.md` y `backlog.md`.

## Decisión: registro separado

Se adopta `SyncDeadLetter` como agregado separado de evidencia y tratamiento que referencia una `SyncOperation` original.

`DEAD_LETTER` continúa siendo el estado operativo canónico definido por `DEC-007`. El agregado separado no reemplaza ese estado: aporta identidad, clasificación, revisión, reactivación autorizada, concurrencia, retención y consulta operacional sin sobrecargar Outbox o Inbox.

Se descarta modelarlo únicamente como estado de Outbox/Inbox porque:

1. Outbox controla entrega e intentos en el nodo originador; Inbox controla deduplicación y resultado en el receptor.
2. Ninguno conserva por sí solo el lifecycle completo de revisión entre nodos.
3. Sobrescribir su estado perdería decisiones, actores, motivos y evidencia histórica.
4. Una operación puede llegar a dead letter antes de existir Inbox o después de existir ambos registros.
5. Revisión, archivo y reactivación necesitan control de concurrencia propio.

`SyncDeadLetter` no es una segunda operación, no contiene una intención de negocio y nunca copia el payload.

`OutboxEntry` tiene un único significado transversal: sobre de entrega/retry asociado 1:1 a `SyncOperation`, sin duplicar la intención ni su payload autoritativo. Puede tener origen local con Device/secuencia u origen central sin ambos. `SyncDeadLetter` solo la referencia cuando esa entrega entra en agotamiento o error permanente; no se crea una segunda clase homónima para eventos del bootstrap.

## Ownership y autoridad

Sync es propietario de `SyncOperation`, `OutboxEntry`, `InboxEntry`, `SyncCheckpoint`, `SyncConflict`, `SyncReview`, `SyncDeadLetter` y su historial de tratamiento. El dominio originador sigue siendo propietario de la intención y de los efectos de negocio.

Clases de ubicación conceptuales:

| Concepto | Clase | Autoridad |
|---|---|---|
| `SyncOperation` | `DUAL_WITH_EXPLICIT_POLICY` | nodo originador conserva identidad e intención inmutables; el receptor decide aceptación según autoridad del dominio |
| `OutboxEntry` | `DUAL_WITH_EXPLICIT_POLICY` | nodo originador; Device y secuencia son obligatorios solo para origen local |
| `InboxEntry` | `CENTRAL_ONLY` para el flujo definido por `DEC-007` | backend central; deduplica y conserva el resultado recibido |
| `SyncDeadLetter` | `DUAL_WITH_EXPLICIT_POLICY` | el nodo que detecta crea; el backend autoriza tratamiento una vez conocido, sin last-write-wins |

Una dead letter creada localmente puede permanecer disponible durante desconexión. Al sincronizarse conserva su identidad global. El cliente local no puede autorizar por sí mismo un retry manual crítico, reclasificar un incidente de seguridad ni ampliar permisos.

Si local y central detectan concurrentemente el mismo caso, convergen por `operation_id`: el primer `dead_letter_id` registrado centralmente es canónico y el otro nodo lo adopta. Las acciones/evidencias no duplicadas se anexan idempotentemente. Nunca se elige por timestamp ni se mantienen dos agregados para la misma operación.

## Intención, payload y relaciones

`SyncOperation` conserva la intención original y el payload canónico inmutable junto con:

- `operation_id`;
- `idempotency_key`;
- `tenant_id`, Company y Branch cuando apliquen;
- dispositivo, instalación, sesión y actor;
- agregado y tipo de operación;
- `expected_version`;
- `causation_id`, `parent_operation_id` y `correlation_id` cuando apliquen;
- `schema_version` y versión de política;
- tiempos y evidencia de reloj;
- `payload_checksum`.

Outbox referencia esa operación y conserva exclusivamente scheduling, secuencia, intentos y último error de entrega. Inbox referencia la misma operación recibida y conserva deduplicación, checksum y resultado central. Si el adaptador serializa temporalmente el payload para transporte, esos bytes no son una segunda fuente mutable y deben coincidir exactamente con el checksum de `SyncOperation`.

Relaciones obligatorias:

```text
SyncOperation entregable 1 ── 1 OutboxEntry
SyncOperation recibida 1 ── 0..1 InboxEntry central
SyncOperation 1 ── 0..1 SyncDeadLetter
SyncDeadLetter 1 ── 0..n SyncDeadLetterAction
SyncConflict 0..1 ── 0..n SyncReview
SyncDeadLetter 0..1 ── 0..n SyncReview
```

Una `SyncReview` referencia exactamente un `SyncConflict` o un `SyncDeadLetter`. DeadLetter puede referenciar un conflicto, pero no todo error permanente es un conflicto de dominio.

Las tablas base, candidate keys, FKs, XOR de Review, delete policies y diferencias PostgreSQL/SQLite se definen en `sync-base-schema.md`; este documento conserva la autoridad sobre el lifecycle de DeadLetter.

## Identidad y atributos conceptuales

### SyncDeadLetter

- `id`: UUID v7 global;
- `tenant_id`;
- `operation_id` obligatorio;
- `outbox_id` opcional;
- referencia a Inbox mediante `(tenant_id, operation_id)` cuando exista;
- `conflict_id` opcional;
- `origin`: `LOCAL_OUTBOX` o `CENTRAL_INBOX`;
- `status`;
- `error_classification`;
- `error_code` estable;
- `reason_code` opcional para la decisión operativa;
- `first_failed_at`;
- `last_failed_at`;
- `retry_count` observado al entrar o volver a dead letter;
- `retry_policy_version`;
- `evidence_reference` opcional y sanitizada;
- `created_at`;
- `archived_at` opcional;
- `version` para concurrencia optimista;
- `audit_reference` opcional.

No contiene `payload`, copia de la operación, secretos, stack trace libre, credenciales ni datos sensibles innecesarios.

### SyncDeadLetterAction

Hijo append-only que conserva cada revisión, autorización de retry, rechazo, resultado y archivo:

- `id`: UUID v7 global;
- `tenant_id`;
- `dead_letter_id`;
- `operation_id`;
- acción y permiso aplicado;
- `previous_status` y `new_status`;
- actor, rol y scope;
- motivo obligatorio;
- condición que cambió, cuando autoriza retry;
- `error_classification` y `error_code` observados;
- `retry_count` resultante;
- `causation_id` y `correlation_id`;
- evidencia y referencia de auditoría sanitizadas;
- timestamp confiable.

Actualizar la proyección `status` del agregado y crear su acción/auditoría obligatoria forman una sola frontera transaccional en el nodo autoritativo.

## Estados y transiciones

Se reutiliza exclusivamente el vocabulario de sincronización de `DEC-007`:

- `DEAD_LETTER`;
- `REVIEW_REQUIRED`;
- `RETRY_SCHEDULED`;
- `ARCHIVED`.

No se crean estados paralelos `OPEN`, `UNDER_REVIEW`, `RETRY_AUTHORIZED`, `RESOLVED`, `REJECTED` o `CANCELLED`.

Transiciones del tratamiento:

```text
DEAD_LETTER
    -> REVIEW_REQUIRED
    -> ARCHIVED                 solo por decisión autorizada y auditable

REVIEW_REQUIRED
    -> RETRY_SCHEDULED          retry autorizado
    -> ARCHIVED                 rechazo/cierre sin reejecución conforme a retención

RETRY_SCHEDULED
    -> DEAD_LETTER              nuevo agotamiento/error permanente
    -> REVIEW_REQUIRED          resultado nuevo incierto o sensible
    -> ARCHIVED                 después de resultado central aceptado/rechazado registrado en Operation/Inbox
```

`SERVER_ACCEPTED` y `SERVER_REJECTED` pertenecen a `SyncOperation`/resultado de Inbox y no se duplican como estado de DeadLetter. `SyncDeadLetterAction` conserva el resultado que causó el archivo. `ARCHIVED` termina el tratamiento activo, pero no borra la operación, Inbox, Outbox, auditoría o evidencia sujeta a retención.

## Clasificación de errores

`error_classification` utiliza el siguiente catálogo conceptual y se mantiene separado de `conflict_type` y `error_code`:

| Clasificación | Retry automático | Tratamiento predeterminado |
|---|---|---|
| `TRANSIENT` | sí, dentro de política | backoff; dead letter al agotar límite |
| `PERMANENT` | no | revisión o rechazo autoritativo |
| `CONFLICT` | solo si la política del conflicto lo permite | `SyncConflict` y posible revisión |
| `AUTHORIZATION` | no | revisión de seguridad o rechazo; repetir no amplía permisos |
| `VALIDATION` | no | corregir productor/software o crear nueva intención válida |
| `DEPENDENCY` | sí solo mientras la dependencia pueda aparecer | `WAITING_FOR_DEPENDENCY`; bloqueo causal |
| `VERSION_INCOMPATIBLE` | no en la misma versión | actualización compatible o revisión |
| `TENANT_VIOLATION` | no | rechazo y señal de seguridad |
| `DEVICE_REVOKED` | no | rechazo y señal de seguridad según `DEC-008` |
| `UNKNOWN` | no después del límite seguro | revisión y diagnóstico sanitizado |

Cuando exista una categoría específica se usa en lugar de `PERMANENT`. Los códigos existentes de `DEC-007`, como `SYNC_SIGNATURE_INVALID`, `SYNC_PAYLOAD_CHECKSUM_MISMATCH`, `SYNC_IDEMPOTENCY_CONFLICT`, `SYNC_SCHEMA_UNSUPPORTED`, `SYNC_PERMISSION_DENIED`, `SYNC_TENANT_MISMATCH` y `SYNC_DEVICE_REVOKED`, permanecen autoritativos para la causa concreta.

Checksum o firma inválidos, tenant violation, dispositivo revocado y fallos de autorización se marcan como potenciales incidentes de seguridad. No reciben retry automático sin una política explícita posterior; una firma o payload inválido no se “corrige” mutando la operación.

## Retry y agotamiento

El ejecutor de Sync que posee `OutboxEntry` controla `attempt_count`, `last_attempt_at`, `next_attempt_at` y último error. `SyncDeadLetter.retry_count` es el valor observado al producir la transición y no un contador paralelo editable.

Una `SyncRetryPolicyVersion` técnica o referencia equivalente define, sin números hardcodeados:

- máximo de intentos por clasificación/canal;
- backoff y jitter;
- límite de retraso;
- ventana y condiciones de retry automático;
- errores excluidos;
- requisitos de retry manual;
- tratamiento después del agotamiento.

El retry conserva `operation_id`, `idempotency_key`, payload, checksum, causalidad y schema. Autorizar retry crea `SyncDeadLetterAction`, cambia a `RETRY_SCHEDULED` y vuelve a habilitar la misma OutboxEntry; no crea otra operación ni otro payload.

Si el payload o la intención deben cambiar, el caso original se rechaza o archiva y se crea una `SyncOperation` nueva con identidad nueva, `parent_operation_id`/`causation_id` explícitos y su propia idempotencia.

## Error permanente y atomicidad

Un error permanente detiene retry automático, conserva evidencia, crea o actualiza la dead letter y puede generar alerta. No se confirma Inbox ni efecto de negocio parcial cuando la frontera central falla; Inbox y efectos continúan compartiendo commit o rollback.

Si el backend aplicó el efecto y se perdió el ACK, el reenvío con la misma identidad consulta Inbox y devuelve el resultado anterior. Ese escenario no crea dead letter por agotamiento local cuando existe evidencia central de aceptación; antes de clasificarlo se reconcilia Inbox/checkpoint.

## Revisión y reactivación

Revisar, reintentar, rechazar o archivar exige permiso atómico, tenant/scope válido, actor, motivo y control de versión. La política puede exigir reautenticación, MFA, aprobación superior o segregación de funciones.

El retry manual exige registrar una condición material que cambió, por ejemplo dependencia disponible, servicio recuperado, permiso legítimamente concedido o software actualizado. No es condición válida editar payload, cambiar tenant, ignorar revocación o reducir una validación.

Incidentes `TENANT_VIOLATION`, `DEVICE_REVOKED`, `AUTHORIZATION` o `VALIDATION` vinculada a integridad requieren revisión de seguridad o corrección externa; no se reactivan automáticamente.

## Idempotencia, causalidad y dependencias

1. Existe como máximo una `SyncDeadLetter` por `operation_id`.
2. Reingresar a dead letter reutiliza el agregado y añade una acción.
3. Reenvíos repetidos de Outbox conservan una sola operación y un solo efecto.
4. Inbox devuelve aceptación/rechazo previo sin reejecutar.
5. DeadLetter nunca se convierte en mensaje ejecutable.
6. `causation_id`, `parent_operation_id` y `correlation_id` se resuelven desde la operación original y se conservan en acciones/eventos.
7. La creación local/central concurrente converge a una identidad canónica por unicidad de operation y control de versión.

Si B depende causalmente de A y A está en dead letter, B permanece `WAITING_FOR_DEPENDENCY`, `REVIEW_REQUIRED` o bloqueada según la política del dominio. B no se aplica ni se envía a dead letter automáticamente por mera llegada anticipada. Si A se acepta después, B vuelve a evaluarse; si A se rechaza definitivamente, el dominio decide rechazo, compensación o revisión de B.

Un checkpoint no declara confirmada una operación en dead letter. El procesamiento de operaciones posteriores independientes solo puede avanzar si el contrato del canal conserva explícitamente el hueco y no viola orden causal; nunca se oculta la operación pendiente.

## Tenant isolation

- `tenant_id` de DeadLetter, Operation, Outbox, Inbox, Conflict, Review y Action debe coincidir.
- Las relaciones usan las candidate keys y FKs tenant-aware cerradas en `sync-base-schema.md`; RLS PostgreSQL permanece como defensa adicional conforme a `PHY-G14`.
- SQLite valida tenant mediante repositorios cerrados, FK/constraints posibles y revalidación central.
- El tenant efectivo se deriva de identidad, sesión y dispositivo; el valor del cliente no es autoridad.
- Leer, revisar, reintentar, rechazar o archivar otro tenant produce denegación sin revelar existencia.
- Una dead letter nunca se mueve ni se reasigna entre tenants.

## Seguridad por gate

| Gate | Amenaza | Control documental | Prueba futura |
|---|---|---|---|
| `SEC-G01` | referencia o acción cross-tenant | claves tenant-aware, contexto confiable, RLS futura | lectura/FK/review/retry de otro tenant |
| `SEC-G03` | retry o archivo sin autoridad | permisos `sync.dead_letter.*`, ABAC, deny by default | actor/scope/self-approval inválidos |
| `SEC-G04` | dispositivo revocado reenvía | validación de `DEC-008`; sin retry automático | revocación antes/después de dead letter |
| `SEC-G05` | replay, duplicado o payload alterado | operación/checksum inmutables, Inbox, misma identidad | ACK perdido, retry, checksum distinto |
| `SEC-G06` | revisión o reactivación sin rastro | acciones y auditoría append-only | fallo de auditoría y reconstrucción causal |
| `SEC-G08` | payload malicioso fuerza procesamiento | validación estricta, límites y evidencia sanitizada | payload/schema/firma inválidos |
| `SEC-G10` | cierre funcional sin evidencia ejecutable | suites PostgreSQL/SQLite/integración pendientes | gate permanece `NOT_EVALUATED` |

Una dead letter no contiene secretos ni duplica payload en auditoría, logs, métricas o eventos. Evidencias externas se referencian de forma opaca y sanitizada.

## Permisos

- `sync.dead_letter.read`;
- `sync.dead_letter.review`;
- `sync.dead_letter.retry`;
- `sync.dead_letter.reject`;
- `sync.dead_letter.archive`.

No se crean roles. Los roles existentes reciben grants explícitos según tenant, Company/Branch, dispositivo, clasificación y riesgo. `read` no concede revisión; `review` no concede retry/reject/archive. Retry de seguridad, rechazo y archivo pueden exigir MFA, reautenticación, motivo y actor distinto del originador.

## Auditoría y eventos

Auditoría append-only obligatoria para creación, inicio/decisión de revisión, retry autorizado/ejecutado, rechazo, reingreso, aceptación posterior y archivo. Conserva actor, tenant, recurso, `operation_id`, estados, clasificación/código, motivo, reviewer, policy version, causalidad, correlación y tiempo confiable, sin payload ni secretos.

Eventos canónicos de Sync:

- `SyncOperationDeadLettered`;
- `SyncDeadLetterReviewed`;
- `SyncRetryAuthorized`;
- `SyncDeadLetterArchived`.

No se crea `SyncDeadLetterResolved`: `SyncOperationApplied` y `SyncOperationRejected` ya representan los resultados autoritativos y evitan dos nombres para el mismo hecho.

## Retención, archivo y purga

Dead letters activas se conservan hasta decisión. Las aceptadas/rechazadas y archivadas se conservan según políticas versionadas `active_retention`, `archive_retention`, `audit_retention` y `legal_retention`; este gate no fija duraciones.

`ARCHIVED` retira el caso de la cola activa, pero no borra evidencia. Una purga futura es un proceso separado, autorizado y auditable, condicionado por la mayor ventana de retry/offline/idempotencia, obligaciones legales y capacidad de reconstrucción. No existen cascadas destructivas desde Tenant, Device, Operation, Outbox o Inbox.

## Concurrencia

`SyncDeadLetter.version` usa concurrencia optimista; timestamps no deciden.

- Dos revisores con la misma versión esperada: solo uno transiciona; el otro recibe conflicto y recarga evidencia.
- Dos retries autorizados simultáneamente: una sola acción habilita la Outbox; Inbox impide doble efecto.
- Retry antiguo después de aceptación/rechazo: Inbox devuelve resultado terminal y no reabre el caso.
- Archivo concurrente con retry: gana una única transición por versión; nunca ambos efectos parciales.
- Resolución central mientras el dispositivo está offline: se aplica después por versión/secuencia autoritativa, no por timestamp local.

## Restricciones e índices candidatos

El contrato físico base exige y la implementación posterior deberá demostrar:

1. PK UUID v7 global y `UNIQUE(operation_id)` para una sola dead letter por operación;
2. relaciones tenant-aware a Operation, Outbox, Inbox, Conflict, Review y Actions;
3. ausencia total de columna payload en DeadLetter/Action;
4. clasificación, estado, contador no negativo, versión y tiempos válidos;
5. `first_failed_at <= last_failed_at` y archivo coherente con `ARCHIVED`;
6. acción/auditoría obligatoria en cada transición crítica;
7. índices por `(tenant_id, status, last_failed_at)`, operación, clasificación/código, dispositivo vía Operation y próximo tratamiento;
8. una sola transición concurrente mediante expected version;
9. consultas y mensajes que no filtren existencia cross-tenant;
10. semántica equivalente comprobada en PostgreSQL y SQLite/WAL.

R2-A cierra candidate keys y relaciones en `sync-base-schema.md`. Los nombres de índices y detalles de DDL se decidirán únicamente después de autorización de migración.

## Observabilidad futura

Sin implementar infraestructura, se reservan señales sanitizadas para retry exhausted, permanent error, dead letter creada, incidente de seguridad, revisión, retry autorizado, resultado, archivo, volumen excesivo por tenant/dispositivo y repetición de error code. Métricas no sustituyen auditoría ni exponen payload.

## Migración del legado avícola

La auditoría de `backend/`, `database/`, `infra/` y `frontend/` no encontró outbox, inbox, SyncOperation, retries persistidos, conflictos Sync ni dead letters. Errores HTTP o mensajes de conexión del frontend son evidencia técnica efímera, no operaciones migrables.

Clasificación:

- migrable: ninguno demostrado;
- parcialmente migrable: ninguno con identidad/causalidad suficiente;
- evidencia solamente: logs o auditoría heredada que documente un fallo, conservada como evidencia histórica sanitizada;
- no migrable: excepciones, mensajes y operaciones abandonadas sin `operation_id`, tenant, payload checksum, intentos y causalidad.

No se inventan dead letters, retries, aceptación/rechazo, actores, timestamps, tenant ni causalidad a partir de logs.

## Pruebas futuras

### PostgreSQL

- aislamiento/RLS tenant y FK compuestas;
- unicidad por operación;
- lifecycle y constraints;
- permisos y segregación;
- retry autorizado;
- dos revisores concurrentes;
- archive vs retry;
- Inbox+efecto atómicos y ausencia de efecto duplicado.

### SQLite/WAL

- agotamiento persistente y creación local;
- restart con dead letter recuperable;
- referencia al payload original sin copia ni mutación;
- reactivación con misma Operation/Outbox;
- nuevo agotamiento reutiliza el registro;
- sincronización posterior idempotente;
- bloqueo causal de dependientes;
- resolución central recibida después de offline.

### Integración

- servidor aplica y ACK se pierde: Inbox deduplica y no crea dead letter falsa;
- replay con mismo checksum devuelve resultado;
- checksum distinto no se ejecuta;
- cross-tenant rechazado y señalado;
- dispositivo revocado sin retry automático;
- payload/schema/firma malformados;
- A en dead letter bloquea B y posterior resolución reevalúa B;
- operación original inválida exige operación nueva, sin mutación.

## Criterio de cierre de PHY-G11

`PHY-G11` puede cerrarse documentalmente cuando el modelo separado, ownership, identidad, referencias, estados, clasificación, retry, error permanente, revisión, reactivación, archivo, idempotencia, causalidad, dependencias, local-first, tenancy, seguridad, permisos, auditoría, eventos, concurrencia, legado y pruebas estén alineados transversalmente sin duplicar operación o payload.
