# TECH-002 R2-A: esquema físico base de Sync

## Estado y alcance

Contrato documental de `TECH-002 / R2-A` para las relaciones físicas entre Foundation, Devices/Licensing y Sync. No contiene DDL, no autoriza migraciones y no implementa repositorios.

Fuentes: `DEC-007`, `DEC-008`, `UC-SYNC-001`, `UC-SYNC-003`, `SEC-G01`, `SEC-G04`, `SEC-G05`, `SEC-G06`, `SEC-G07`, `SEC-G10`, modelo conceptual, ownership, `foundation-schema.md`, `device-licensing-schema.md`, `sync-dead-letter-schema.md` y `physical-conventions.md`.

Sync posee coordinación, transporte, deduplicación y tratamiento técnico. El módulo originador conserva ownership de la intención y del efecto de negocio.

## Matriz de ubicación y autoridad

| Concepto | PostgreSQL | SQLite/WAL | Autoridad |
|---|---|---|---|
| `SyncOperation` | copia recibida y operaciones centrales entregables | intención local inmutable | nodo originador para intención/payload; dominio receptor para aceptación |
| `OutboxEntry` | existe para operación central entregable | existe para operación local entregable | nodo originador para scheduling y retry |
| `InboxEntry` | receptor central de operaciones locales | no se crea una Inbox genérica | PostgreSQL para deduplicación y resultado central |
| `SyncCheckpoint` | posición central confirmada por Device/stream/dirección | posición local durable por Device/stream/dirección | cada nodo conserva su posición confirmada; el ACK central decide avance de upload |
| `SyncConflict` | registro central y copia sincronizada cuando aplique | conflicto local pendiente de decisión central cuando aplique | política de autoridad del dominio |
| `SyncReview` | decisión autoritativa | snapshot de lectura cuando se requiera operar offline | backend/revisor autorizado |
| `SyncDeadLetter` y acciones | consolidación y tratamiento autoritativo | evidencia local durable de agotamiento | según `PHY-G11`; el cliente no amplía autoridad |

Una entrega central no implica que SQLite deba recibirla mediante una Inbox genérica. Descargas de configuración y decisiones centrales usan contratos versionados y checkpoints; no se inventa una segunda máquina de deduplicación local.

### Persistencia local mínima relacionada

SQLite conserva solamente las identidades y políticas necesarias para operar/verificar offline: Tenant/Company/Branch como snapshot mínimo; Device, Installation, DeviceKey pública y evidencia/estado propios; requests/responses de activación; License, FeatureEntitlement, LicenseActivation, revocaciones, gracia, trust store público y OfflineAuthorizationSnapshot verificados. No replica User, credenciales, Session central, Membership editable, secretos, ni toda Foundation. La lista física y sus representaciones están en `device-licensing-schema.md`; este contrato añade Operation, Outbox y Checkpoint locales, pero no Inbox genérica.

## Identidad y cardinalidades

`sync.sync_operations.id` es la PK UUID v7 y representa semánticamente `operation_id`. Las columnas denominadas `operation_id` referencian ese `id`; no existe un segundo UUID equivalente.

```text
SyncOperation entregable 1 ── 1 OutboxEntry
SyncOperation recibida   1 ── 0..1 InboxEntry central
SyncOperation            1 ── 0..n SyncConflict
SyncOperation            1 ── 0..1 SyncDeadLetter
SyncConflict             1 ── 0..n SyncReview
SyncDeadLetter           1 ── 0..n SyncReview
SyncDeadLetter           1 ── 0..n SyncDeadLetterAction
Device + stream + direction 1 ── 1 SyncCheckpoint por nodo
```

Una `SyncReview` referencia exactamente uno entre Conflict y DeadLetter. Una operación puede conservar conflictos históricos distintos, pero solo uno activo de la misma clasificación y política a la vez.

## Mapa relacional transversal

| Entidad | Owner | Scope | PK/candidate key | Relaciones y cardinalidad | Nulabilidad/lifecycle | Delete | Autoridad Sync |
|---|---|---|---|---|---|---|---|
| Tenant | Tenants | global de plataforma | `id`; code normalizado global | 1→n Company, Membership, Device, License, Operation | status explícito | restrict si referenciado | central master |
| Company | Companies | Tenant | `id`; `(tenant_id,id)` | n→1 Tenant; 1→n Branch/Device; 0→n Operation según scope | obligatoria para Device, opcional en operación tenant-wide | no cascade | central master replicado mínimo |
| Branch | Branches | Tenant+Company | `id`; `(tenant_id,company_id,id)` | n→1 Company; 1→n recursos scoped | opcional en Device/Operation | no cascade | central master replicado mínimo |
| User | Identity | global | `id` | 1→n Membership/Session | no prueba tenant | no cascade | server authoritative |
| TenantMembership | Tenants | Tenant+User | `id`; `(tenant_id,id)`, `(user_id,id)` | n→1 Tenant/User; 1→n Session | se revoca, no borra | no cascade | server authoritative |
| Session | Identity | global pre-contexto o Tenant seleccionado | `id`; `(tenant_id,id)` cuando scoped | n→1 User; n→0..1 Membership/Device | revocable; pre-contexto no origina operación tenant | no cascade | servidor de identidad |
| SecurityEvent | Identity | plataforma o Tenant | `id` | referencias opcionales a Session/Device | append-only | no update/delete/cascade | origen que confirma el evento |
| AuditEvent | Audit | plataforma o Tenant | `id` | referencias opcionales a Session/Device/Operation | append-only | no update/delete/cascade | origen del hecho |
| Device | Devices | Tenant+Company+Branch opcional | `id`; keys tenant/company/branch | n→1 Tenant/Company/Branch; 1→n Installation/Key/Activation/Operation | revocable/reemplazable | no cascade | central confirma confianza |
| Installation | Devices | Tenant; Device opcional hasta link | `id`; `(tenant_id,id)`, `(tenant_id,device_id,id)` | n→0..1 Device; 1→n evidence/activation/operation | link único; retiro irreversible | no cascade | local hasta aceptación central |
| DeviceKey | Devices | Tenant+Device | `id`; `(tenant_id,device_id,id)` | n→1 Device; 1→n Activation/request | rotación/revocación append history | no cascade | clave pública sincronizada |
| DeviceHardwareEvidence | Devices | Tenant+Device+Installation | `id`; versión por tipo | n→1 Device/Installation | append-only | no cascade | origen de observación |
| DeviceOperationalState | Devices | Tenant+Device+Installation | `(tenant_id,device_id)` | 1→1 Device; n→1 Installation vigente | mutable con versión esperada | no cascade | central confirma estado reportado |
| DeviceManagementProfile | Devices | Tenant+Device | `id`; vigencia activa | n→1 Device | versionado por vigencia | no cascade | central master |
| License | Licensing | Tenant | `id`; `(tenant_id,id)` | n→1 Tenant; 1→n Entitlement/Activation/Grace | versión emitida inmutable | no cascade | central master firmada |
| FeatureEntitlement | Licensing | Tenant+License | `id`; versión/feature | n→1 License | versión emitida; límites R1 | no cascade | central master firmada |
| LicenseActivation | Licensing | Tenant+License+Device+Installation+Key | `id`; `(tenant_id,license_id,id)` | n→1 License/Device/Installation/Key | reemplazo crea otra fila | no cascade | central master firmada |
| LicenseRevocation | Licensing | Tenant; key target global excepcional | `id`; target/secuencia | exactamente un target tipado | append-only y secuenciada | no cascade | central master firmada |
| GraceAuthorization | Licensing | Tenant+License; Activation opcional | `id`; license/secuencia | n→1 License; n→0..1 Activation misma License | append-only, vigencia explícita | no cascade | central master firmada |
| TrustedSigningKey | Licensing | global por ambiente | `id`; environment/purpose/key | 1→n artefactos firmados | lifecycle criptográfico | no cascade | trust store central |
| DeviceActivationRequest | Devices | Tenant+Device+Installation+Key | `id`; idempotency/nonce | n→1 Device/Installation/Key; 1→0..1 Response | local→central; terminal | no cascade | origen local, decisión central |
| DeviceActivationResponse | Devices | Tenant+Request+Activation | `id`; request único | 1→1 Request y Activation | append-only, aplicación idempotente | no cascade | central master firmada |
| OfflineAuthorizationSnapshot | Authorization | Tenant+Membership+Device+Installation | `id`; vigencia/policy | n→1 Membership/Device/Installation | firmado, expirable y reemplazable | no cascade | central emite; local verifica |
| SyncOperation | Sync | Tenant; Company/Branch opcionales según alcance | `id=operation_id`; idempotencia scoped | 1→1 Outbox si entregable; 0..1 Inbox; n Conflict; 0..1 DeadLetter | payload inmutable; status versionado | no cascade | origen conserva intención; dominio receptor decide el efecto |
| OutboxEntry | Sync | Tenant; Device opcional | `id`; `operation_id`; Device/sequence | 1→1 Operation entregable | retry/ACK mutable | no cascade | nodo originador |
| InboxEntry | Sync | Tenant central | `id`; operation e idempotencia únicas | 1→1 Operation recibida | resultado terminal durable | no cascade | receptor central |
| SyncCheckpoint | Sync | Tenant+Device+stream+direction | `id`; scope único | n→1 Device; 0..1 Operation confirmada | mutable con expected version | no cascade | nodo que confirma posición |
| SyncConflict | Sync | Tenant+Operation | `id`; activo por op/type/policy | n→1 Operation; 1→n Review | resolución versionada, historia preservada | no cascade | política de dominio |
| SyncReview | Sync | Tenant+target XOR | `id`; target activo según política | n→exactamente 1 Conflict o DeadLetter | decisión versionada/auditada | no cascade | revisor central autorizado |
| SyncDeadLetter | Sync | Tenant+Operation | `id`; operation única | 1→1 Operation; refs opcionales Outbox/Inbox/Conflict; 1→n Action/Review | archive ≠ delete | no cascade | nodo detecta; central autoriza tratamiento |
| SyncDeadLetterAction | Sync | Tenant+DeadLetter+Operation | `id` | n→1 DeadLetter y Operation | append-only | no cascade | nodo autoritativo de transición |

Las referencias a License/Activation desde una Operation se expresan mediante `aggregate_type`/`aggregate_id` y validación del módulo, no con una FK polimórfica. Las relaciones fuertes viven dentro de Licensing; Sync no adquiere ese ownership.

## `sync.sync_operations`

### Columnas

| Columna | PostgreSQL | SQLite | Nulable | Regla |
|---|---|---|---:|---|
| `id` | `uuid` | UUID `TEXT` | no | PK global; `operation_id` canónico |
| `tenant_id` | `uuid` | UUID `TEXT` | no | scope y FK Tenant |
| `company_id` | `uuid` | UUID `TEXT` | sí | nulo para operación tenant-wide; obligatorio con origen Device |
| `branch_id` | `uuid` | UUID `TEXT` | sí | misma Company/Tenant |
| `source_kind` | `text` | `TEXT` | no | `LOCAL_DEVICE` o `CENTRAL_SERVICE` |
| `device_id` | `uuid` | UUID `TEXT` | sí | dispositivo origen; obligatorio solo para origen local |
| `installation_id` | `uuid` | UUID `TEXT` | sí | instalación origen; obligatoria solo para origen local y mismo Device |
| `session_id` | `uuid` | UUID `TEXT` | sí | sesión central cuando exista; no se copia token |
| `actor_type` | `text` | `TEXT` | no | usuario, servicio o sistema identificado |
| `actor_id` | `uuid` | UUID `TEXT` | sí | nulo únicamente para actor técnico identificado por tipo/política |
| `aggregate_type` | `text` | `TEXT` | no | código publicado del módulo propietario |
| `aggregate_id` | `uuid` | UUID `TEXT` | no | identidad histórica del recurso, no FK polimórfica |
| `operation_type` | `text` | `TEXT` | no | código canónico publicado |
| `idempotency_key` | `text` | `TEXT` | no | estable, acotada y no secreta |
| `expected_version` | `bigint` | `INTEGER` | sí | obligatorio cuando la operación usa concurrencia optimista |
| `authority_policy` | `text` | `TEXT` | no | valor canónico de `DEC-007` |
| `parent_operation_id` | `uuid` | UUID `TEXT` | sí | nueva intención correctiva o sucesora |
| `causation_id` | `uuid` | UUID `TEXT` | sí | causa conocida; puede coincidir con parent según el caso |
| `correlation_id` | `uuid` | UUID `TEXT` | no | trazabilidad extremo a extremo |
| `schema_version` | `integer` | `INTEGER` | no | `>= 1` |
| `payload` | `jsonb` | JSON canónico `TEXT` | no | intención original inmutable y validada |
| `payload_checksum` | `bytea` | `BLOB` | no | checksum de bytes canónicos |
| `sync_status` | `text` | `TEXT` | no | estados de `DEC-007`, sin catálogo paralelo |
| `occurred_at_local` | `timestamptz` | RFC 3339 `TEXT` | sí | evidencia del origen local |
| `recorded_at_local` | `timestamptz` | RFC 3339 `TEXT` | sí | obligatorio para origen local; ausente para origen central |
| `received_at_server` | `timestamptz` | RFC 3339 `TEXT` | sí | asignado al recibir centralmente |
| `committed_at_server` | `timestamptz` | RFC 3339 `TEXT` | sí | solo tras commit central |
| `version` | `bigint` | `INTEGER` | no | concurrencia del estado técnico; payload sigue inmutable |

### Candidate keys, FKs e invariantes

- PK `id`; candidate keys `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, device_id, id)` para referencias de delivery/checkpoint cuando existe Device.
- `UNIQUE (tenant_id, operation_type, idempotency_key)` conserva la identidad lógica. Misma clave con checksum distinto produce conflicto y señal de seguridad.
- FKs `(tenant_id, company_id)` y `(tenant_id, company_id, branch_id)` cuando sus referencias existan; `branch_id` exige `company_id`.
- Para origen local, FK `(tenant_id, company_id, device_id)` y FK `(tenant_id, device_id, installation_id)`; cuando `branch_id` existe, FK `(tenant_id, company_id, branch_id, device_id)` exige que Operation y Device compartan sede. Device/Installation deben estar vigentes según aplicación, no solo existir.
- `LOCAL_DEVICE` exige Company, Device, Installation y `recorded_at_local`; `CENTRAL_SERVICE` exige Device, Installation y tiempos locales nulos, no inventa secuencia local y conserva `committed_at_server` como tiempo autoritativo de su commit. Company/Branch centrales se informan solo cuando la intención tiene ese alcance.
- FKs self tenant-aware `(tenant_id, parent_operation_id)` y `(tenant_id, causation_id)` cuando existan; ninguna puede apuntar a otro tenant ni al mismo `id`.
- `session_id` se valida mediante la candidate key tenant-aware de Session cuando exista contexto tenant. Actor/resource tipados no usan una FK polimórfica; aplicación valida ownership y Audit conserva la referencia aunque el recurso se retire.
- El payload, schema, checksum, idempotency key, origen, aggregate y operation type no se actualizan. Solo cambia estado técnico con expected `version`.
- El checksum detecta divergencia, pero autenticidad fuerte de origen local exige la prueba criptográfica de `DEC-008` cuando la política de riesgo la requiera.

## `sync.outbox_entries`

Sobre de entrega/retry, no segunda intención.

Columnas: `id`, `tenant_id`, `operation_id`, `device_id NULL`, `local_sequence NULL`, `operation_type`, `schema_version`, `payload_checksum`, `correlation_id`, `causation_id NULL`, `sync_status`, `created_at`, `available_at`, `attempt_count`, `last_attempt_at NULL`, `next_attempt_at NULL`, `last_error_code NULL`, `acknowledged_at NULL`, `updated_at`, `version`.

Invariantes:

1. `UNIQUE (operation_id)`, candidate keys `(tenant_id, id)` y `(tenant_id, operation_id, id)`, y FK `(tenant_id, operation_id) -> sync_operations(tenant_id, id)` con `NO ACTION`.
2. Toda operación entregable crea exactamente una Outbox en la misma transacción; una operación que no requiere entrega no crea ninguna.
3. Origen local exige `device_id` y `local_sequence`; origen central exige ambos nulos.
4. FK `(tenant_id, device_id)` cuando exista, FK `(tenant_id, device_id, operation_id)` a Operation para probar el mismo origen y `UNIQUE (tenant_id, device_id, local_sequence)` parcial.
5. Metadata duplicada solo para routing/integridad debe coincidir con Operation. No contiene payload, idempotency key, aggregate ni actor.
6. Si el adaptador materializa bytes de transporte, son derivados efímeros o snapshot técnico reemplazable verificable contra `payload_checksum`; nunca otra fuente mutable.
7. Retry modifica únicamente scheduling, error, attempts, ACK y versión sobre la misma fila.
8. `acknowledged_at` requiere resultado persistido del receptor; ACK perdido consulta Inbox y no recrea Operation/Outbox.

Índices mínimos: trabajo elegible por estado/disponibilidad, retry por `next_attempt_at`, operación y secuencia local. No se agregan índices de analítica.

## `sync.inbox_entries`

Contrato receptor central; no es log genérico.

| Columna | Nulable | Regla |
|---|---:|---|
| `id uuid` | no | PK UUID v7 de la recepción |
| `tenant_id uuid` | no | RLS y mismo tenant de Operation |
| `operation_id uuid` | no | FK 1:1 a Operation recibida |
| `receiver_code text` | no | código estable del receptor lógico, no hostname efímero |
| `operation_type text` | no | coincide con Operation |
| `idempotency_key text` | no | coincide con Operation |
| `payload_checksum bytea` | no | coincide con Operation |
| `processing_status text` | no | estado compatible con `DEC-007` |
| `result_code text` | sí | obligatorio al existir resultado terminal |
| `result_reference text` | sí | referencia sanitizada, no payload arbitrario |
| `result_checksum bytea` | sí | cubre resultado canónico persistido |
| `previous_version bigint` | sí | evidencia cuando aplica |
| `new_version bigint` | sí | evidencia cuando aplica |
| `received_at_server timestamptz` | no | tiempo central |
| `applied_at timestamptz` | sí | solo efecto confirmado |
| `rejected_at timestamptz` | sí | solo rechazo confirmado |
| `error_code text` | sí | código estable, sanitizado |
| `committed_at_server timestamptz` | sí | posterior o igual a recepción |

Constraints:

- `UNIQUE (operation_id)` y `UNIQUE (tenant_id, operation_id)` para deduplicación/FK posteriores.
- FK `(tenant_id, operation_id)` a Operation con `NO ACTION`.
- unicidad adicional `(tenant_id, operation_type, idempotency_key)`; checksum diferente bajo cualquiera de ambas identidades rechaza sin efecto adicional y genera `SecurityEvent`/AuditEvent.
- applied/rejected son mutuamente excluyentes; resultado terminal exige checksum y `committed_at_server`.
- misma Operation/checksum retorna el resultado persistido; no reejecuta el caso de uso.
- Inbox y efecto del dominio comparten commit o rollback. Un fallo parcial no deja Inbox terminal sin efecto ni efecto sin resultado Inbox.

## `sync.sync_checkpoints`

Una fila mutable por `(tenant_id, device_id, stream_code, direction)` y nodo persistente.

Columnas: `id`, `tenant_id`, `device_id`, `stream_code`, `direction`, `confirmed_sequence NULL`, `confirmed_cursor NULL`, `last_confirmed_operation_id NULL`, `last_successful_sync_at NULL`, `last_full_reconciliation_at NULL`, `checkpoint_status`, `version`, `updated_at`.

Reglas:

- `direction` es `UPLOAD` o `DOWNLOAD`; upload usa secuencia contigua confirmada y download usa cursor opaco versionado. No se comparan cursores por timestamp.
- PK `id`; `UNIQUE (tenant_id, device_id, stream_code, direction)` y FK tenant-aware a Device.
- `last_confirmed_operation_id`, cuando exista, usa FK `(tenant_id, device_id, last_confirmed_operation_id)` a Operation para upload; en download conserva FK `(tenant_id, last_confirmed_operation_id)` y el stream/cursor autoritativo determina el destinatario.
- solo avanza después de persistir Inbox/resultado/ACK correspondiente. Una operación en conflicto, review o dead letter no se oculta detrás del watermark; un canal que permita huecos los conserva explícitamente fuera del checkpoint contiguo.
- restart relee checkpoint durable; checksum/estado imposible activa recuperación y no adelanta posición.
- la actualización usa expected `version`; clocks no resuelven concurrencia.

## `sync.sync_conflicts`

Columnas: `id`, `tenant_id`, `operation_id`, `aggregate_type`, `aggregate_id`, `conflict_type`, `expected_version NULL`, `observed_version NULL`, `authority_policy`, `severity`, `resolution_policy`, `status`, `detected_at`, `resolved_at NULL`, `resolved_by_actor_type NULL`, `resolved_by_actor_id NULL`, `resolution_reason NULL`, `evidence_reference NULL`, `version`.

Constraints:

- `UNIQUE (tenant_id, id)`, candidate key `(tenant_id, operation_id, id)` y FK `(tenant_id, operation_id)` con `NO ACTION`.
- aggregate/type coinciden con Operation; no existe FK polimórfica al recurso.
- índice unique parcial por `(tenant_id, operation_id, conflict_type, resolution_policy)` para conflicto activo; historia resuelta no se sobrescribe.
- timestamps/actor/reason son coherentes con resolución; decisiones usan expected `version`.
- tenant violation, checksum mismatch y dispositivo revocado también crean señal de seguridad; el conflicto no sustituye Audit/SecurityEvent.

## `sync.sync_reviews`

Columnas: `id`, `tenant_id`, `conflict_id NULL`, `dead_letter_id NULL`, `assigned_role`, `assigned_user_id NULL`, `decision NULL`, `reason NULL`, `evidence_reference NULL`, `created_at`, `resolved_at NULL`, `version`.

Constraints:

- `CHECK ((conflict_id IS NOT NULL)::int + (dead_letter_id IS NOT NULL)::int = 1)` o expresión equivalente por dialecto.
- FKs `(tenant_id, conflict_id)` y `(tenant_id, dead_letter_id)`; exactamente una se verifica.
- ningún cascade desde Conflict/DeadLetter. Resolver conserva actor, permiso, política, motivo, evidencia y AuditEvent.
- una revisión activa por target/política cuando el contrato lo requiera; el índice se separa por target para evitar semántica ambigua de `NULL`.

## Dead letter y acciones

`sync-dead-letter-schema.md` conserva lifecycle y atributos. R2-A cierra físicamente:

- `UNIQUE (operation_id)` y candidate keys `(tenant_id, id)` y `(tenant_id, operation_id, id)`;
- FK obligatoria `(tenant_id, operation_id)`;
- FKs opcionales `(tenant_id, operation_id, outbox_id)` a Outbox y `(tenant_id, operation_id, conflict_id)` a Conflict; Inbox se identifica por `(tenant_id, operation_id)`. Todas prueban la misma Operation;
- `SyncDeadLetterAction` usa FK `(tenant_id, operation_id, dead_letter_id)` a la candidate key de DeadLetter y conserva así Operation verificada;
- acciones son append-only; archive cambia estado/proyección y nunca borra Operation, Inbox, Outbox, Conflict, Review, Action, Audit o evidencia.

## Relaciones con Foundation, Device y Licensing

| Referencia | Candidate key destino | Política |
|---|---|---|
| Company | `(tenant_id, id)` | `NO ACTION`; nunca cross-tenant |
| Branch | `(tenant_id, company_id, id)` | `NO ACTION`; branch exige Company |
| Session | `(tenant_id, id)` para sesión con contexto | `NO ACTION`; sesión pre-contexto no origina operación tenant-scoped |
| Device | `(tenant_id, id)` y `(tenant_id, company_id, id)` | `NO ACTION`; revocación bloquea nuevas entregas, no borra historia |
| Installation | `(tenant_id, device_id, id)` | `NO ACTION`; retirada no invalida historia |
| AuditEvent | referencia Operation mediante `(tenant_id, operation_id)` cuando exista | Audit no se borra por cascada |
| License/Activation | no FK genérica desde SyncOperation | aggregate tipado + validación del módulo; Activation sí referencia Device/Installation fuertemente |

Sync no adquiere ownership de License, Activation, Session ni recursos de negocio por conservar su identidad.

## Políticas de delete y retención

| Relación | Política candidata |
|---|---|
| Tenant/Company/Branch hacia recursos históricos | `RESTRICT`/`NO ACTION` |
| Device/Installation/License/Activation hacia Operation o evidencia | `RESTRICT`/`NO ACTION` |
| Operation hacia Outbox/Inbox/Conflict/DeadLetter/Checkpoint | `RESTRICT`/`NO ACTION` |
| Conflict/DeadLetter hacia Review/Action | `RESTRICT`/`NO ACTION` |
| referencias históricas a actor/recurso retirado | conservar identificador; `SET NULL` no se usa para borrar atribución |

No hay `CASCADE` destructivo en el subsistema. La purga futura exige política de retención, proceso separado, auditoría y prueba de que no rompe idempotencia, recovery u obligaciones legales.

## Grafo y ciclos de creación

Orden lógico sin ciclos irresolubles:

1. catálogos globales y claves confiables;
2. Tenant;
3. Company, Branch y Membership;
4. Device;
5. Installation;
6. DeviceKey y evidencia;
7. License y FeatureEntitlement;
8. LicenseActivation, GraceAuthorization, revocaciones y artefactos de activación;
9. Session con contexto Device, cuando corresponda;
10. SyncOperation;
11. Outbox/Inbox/Checkpoint/Conflict;
12. DeadLetter;
13. Review y DeadLetterAction;
14. AuditEvent referencial.

Los self-links `replacement_*`, `supersedes_*`, `parent_operation_id` y `causation_id` son ciclos semánticos válidos dentro de tablas ya creadas; no requieren `DEFERRABLE`. Se insertan nulos cuando el lifecycle lo autoriza y se completan mediante transición controlada, o referencian una fila anterior ya existente. No existe ciclo Device→Activation→Device: Device no guarda `activation_id`; Activation es dependiente histórica. No se propone `DEFERRABLE` en R2-A.

Actor y aggregate/resource son referencias históricas tipadas sin FK polimórfica. Esto evita ciclos contra todos los módulos y conserva evidencia; no relaja la validación tenant/ownership del caso de uso.

## Fronteras transaccionales

1. **Origen local:** cambio de negocio + SyncOperation + Outbox = una transacción SQLite/WAL.
2. **Recepción central:** validar identidad/tenant/device/licencia/schema/checksum + persistir Operation recibida + efecto de negocio + Inbox/resultados + Audit/SecurityEvent aplicable = una transacción PostgreSQL.
3. **ACK y checkpoint:** primero existe resultado Inbox confirmado; después la misma transacción local persiste ACK en Outbox y avanza el checkpoint contiguo.
4. **Dead letter:** transición Operation/Outbox + creación o actualización versionada de DeadLetter + Action/Audit = una transacción en el nodo que posee el estado.
5. **Activación:** LicenseActivation + efectos autorizados de Device/Installation + ActivationResponse + SyncOperation/Outbox entregable + Audit = una transacción central.
6. SQLite y PostgreSQL nunca comparten una transacción distribuida; retry, Inbox y checkpoints producen convergencia idempotente.

## Seguridad aplicable

| Gate | Amenaza | Control documental | Prueba futura |
|---|---|---|---|
| `SEC-G01` | FK o consulta cross-tenant | candidate/FK tenant-aware, RLS central, repositorio cerrado local | referencias cruzadas en ambos dialectos |
| `SEC-G04` | Device/Installation/Key revocados | vínculo triple, prueba de posesión, estados efectivos | replay/reemplazo/revocación |
| `SEC-G05` | duplicado, reorder, payload manipulado | Operation/Outbox/Inbox, checksum, causalidad, checkpoint contiguo | ACK perdido, checksum distinto, dependencia invertida |
| `SEC-G06` | retry/review sin atribución | Action y Audit append-only, actor/motivo/versión | fallo parcial y reconstrucción causal |
| `SEC-G07` | secreto en payload/evidencia | allowlist, referencia opaca y redacción; prueba fuerte fuera de SQLite | scanning y payload malicioso |
| `SEC-G10` | declarar release sin evidencia | gates siguen `PLANNED / NOT_EVALUATED` | suite ejecutable futura |

Checksum simple no prueba autenticidad frente a control de SQLite. Una violación de tenant, checksum, replay o Device revocado no recibe retry automático y produce códigos estables y señal de seguridad.

## Índices de integridad y operación fundamental

Se justifican únicamente:

- candidate keys tenant-aware requeridas por FK;
- Operation por identidad e idempotencia;
- Outbox por operación, secuencia y trabajo elegible;
- Inbox por operación e idempotencia;
- Checkpoint por tenant/device/stream/direction;
- Conflict activo por operación/tipo/política;
- Review activo por target;
- DeadLetter por operación, estado y tratamiento;
- relaciones Device/Installation/Activation y lookup de revocación vigente.

No se autorizan índices analíticos, particionado ni tuning especulativo.

## Pruebas físicas futuras obligatorias

- mismo operation/checksum produce un efecto y mismo resultado; checksum distinto no muta;
- Operation entregable sin Outbox o Outbox duplicada se rechaza;
- secuencia local duplicada o cross-device/cross-tenant se rechaza;
- Inbox terminal y efecto de negocio fallan o confirman juntos;
- ACK perdido y restart no reaplican ni adelantan checkpoint;
- checkpoint no salta hueco conflictivo/dead-lettered;
- Review cumple XOR y las FKs opcionales de DeadLetter pertenecen a la misma Operation/Tenant;
- Device/Installation/Key/Activation incompatibles se rechazan;
- ningún delete de Tenant/Device/Operation destruye historia;
- payload, logs, Audit y evidencia no exponen secretos;
- PostgreSQL/RLS y SQLite/WAL conservan semántica equivalente donde cada tabla existe.

## Gate R2-A

R2-A puede declararse `PASS` documental si las relaciones de este contrato permanecen alineadas con Foundation, Device/Licensing, PHY-G11, modelo conceptual, ownership, pruebas, trazabilidad y backlog, y las validaciones no encuentran contradicciones materiales.

`PASS` de R2-A no cambia `TECH-002`, no aprueba `SEC-G01..SEC-G10`, no inicia R2-B/R3/R4 y no autoriza la primera migración.
