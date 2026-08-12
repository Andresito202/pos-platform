# DEC-007 — Autoridad por dato, conflictos y recuperación local-first

Estado:

`DONE`

Prioridad:

`P0`

Fecha:

`2026-08-06`

Responsables:

- arquitectura;
- backend;
- sincronización;
- seguridad;
- persistencia;
- operación POS.

Relacionada con:

- `ADR-003-local-first.md`;
- `DEC-001`;
- `DEC-002`;
- `DEC-003`;
- `DEC-004`;
- `DEC-006`;
- `SYNC-003`;
- `TECH-005`;
- `TECH-002`;
- `LIC-002`;
- `DEV-002`.

---

# Contexto

POS Platform debe continuar operando cuando:

- Internet no esté disponible;
- la conexión sea inestable;
- el servidor central no responda;
- exista alta latencia;
- un proveedor externo presente timeout;
- el dispositivo se reinicie;
- una sincronización se interrumpa;
- existan operaciones pendientes de confirmación.

El POS puede confirmar determinadas operaciones localmente y sincronizarlas posteriormente.

Esa capacidad introduce riesgos que no pueden resolverse mediante un mecanismo genérico de “último valor gana”.

Los riesgos principales son:

- pérdida de operaciones;
- duplicación;
- sobrescritura de datos válidos;
- conflictos de inventario;
- conflictos de caja;
- pagos repetidos;
- reenvío de eventos;
- orden temporal incorrecto;
- relojes manipulados;
- dispositivos antiguos;
- respuestas tardías;
- colas sin límite;
- recuperación incompleta;
- acceso cruzado entre empresas;
- cambios ejecutados con reglas desactualizadas.

`ADR-003-local-first.md` define la orientación arquitectónica local-first.

Esta decisión define las reglas operativas obligatorias para implementarla.

## Contrato de persistencia local y central

La persistencia objetivo utiliza:

- PostgreSQL 16 como base central autoritativa;
- SQLite en modo WAL como base operacional local del POS.

Ambos motores comparten el mismo modelo lógico para los datos replicados, pero no están obligados a compartir DDL idéntico.

Reglas:

1. Las migraciones centrales y locales se versionan y validan de forma separada.
2. El contrato de sincronización, los identificadores, los estados y los checksums son independientes del dialecto.
3. Una restricción que SQLite no pueda expresar se valida localmente de forma transaccional y vuelve a validarse en PostgreSQL.
4. PostgreSQL puede incorporar índices, particionado o restricciones adicionales sin cambiar el contrato lógico.
5. Las pruebas SQLite no sustituyen las pruebas de integración sobre PostgreSQL.
6. Cada entidad se clasifica durante el diseño físico como central, local, replicada o proyección.

---

# Problema

Debe definirse de forma única y verificable:

1. qué nodo tiene autoridad sobre cada dato;
2. qué operaciones pueden confirmarse localmente;
3. qué operaciones requieren autoridad central;
4. cómo se identifica una operación;
5. cómo se conserva el orden;
6. cómo se detecta un duplicado;
7. cómo se procesa un reintento;
8. cómo se resuelve un conflicto;
9. cuándo se requiere revisión humana;
10. cómo se recupera una cola interrumpida;
11. cuánto tiempo se conservan los eventos;
12. cómo se reemplaza un dispositivo;
13. cómo se impide el acceso entre tenants;
14. cómo se valida una operación generada offline;
15. cómo se mantiene la trazabilidad completa.

---

# Decisión

POS Platform utilizará una arquitectura local-first basada en:

```text
operación local
+
transacción local
+
outbox persistente
+
sincronización idempotente
+
inbox persistente
+
autoridad definida por dominio
+
control de versión
+
auditoría completa
```

No se utilizará:

```text
last-write-wins
```

como política genérica.

No se utilizará el reloj del dispositivo como autoridad global.

No se sobrescribirá un hecho financiero o de inventario mediante una actualización destructiva.

No se aceptará una operación únicamente porque tenga una fecha más reciente.

---

# Principios normativos

1. Cada operación crítica tiene identidad global.
2. Cada operación crítica es idempotente.
3. Cada agregado mutable utiliza versión esperada.
4. Cada dispositivo mantiene outbox persistente.
5. El servidor mantiene inbox persistente.
6. La autoridad se define por dominio.
7. Los hechos cerrados no se reescriben.
8. Los conflictos no se ocultan.
9. Los reintentos no duplican efectos.
10. Una respuesta tardía no crea una segunda decisión.
11. El reloj local no determina autoridad.
12. El tenant se valida en cada operación.
13. El dispositivo se valida en cada sincronización.
14. Los eventos conservan trazabilidad.
15. La recuperación debe ser reproducible.

---

# Terminología

## Nodo local

Dispositivo POS que ejecuta operaciones y mantiene persistencia local.

## Nodo central

Backend central que valida, persiste, coordina y consolida información multiempresa.

## Operación local

Comando ejecutado por el POS y persistido en la base local.

## Evento local

Hecho producido por una operación local.

## Outbox

Registro persistente de operaciones o eventos pendientes de sincronización.

## Inbox

Registro persistente central utilizado para detectar operaciones ya recibidas.

## Checkpoint

Posición confirmada de sincronización entre un dispositivo y el servidor.

## Conflicto

Situación en la que una operación no puede aplicarse directamente porque el estado esperado ya cambió.

## Autoridad

Nodo o dominio autorizado para decidir el valor o estado definitivo.

## Revisión manual

Proceso controlado para resolver conflictos que no pueden decidirse automáticamente.

## Reintento

Nueva transmisión de la misma operación, conservando su identidad original.

## Respuesta tardía

Respuesta recibida después de timeout, desconexión o decisión operativa posterior.

---

# Identidad global

Toda operación sincronizable deberá incluir:

```text
operation_id
tenant_id
company_id
branch_id
device_id
session_id
actor_id
aggregate_type
aggregate_id
operation_type
idempotency_key
expected_version
occurred_at_local
recorded_at_local
schema_version
payload
payload_checksum
```

El identificador principal será:

```text
operation_id
```

Debe ser globalmente único.

La generación local utilizará `UUID v7` como formato canónico.

Reglas físicas:

1. PostgreSQL almacenará el valor mediante su tipo nativo `uuid`.
2. SQLite lo almacenará como texto canónico lowercase con guiones de 36 caracteres, validado al escribir y leer.
3. El mismo valor se conserva en API, outbox, inbox, auditoría y sincronización.
4. No se mantiene un segundo `global_id` cuando `id` ya contiene el UUID global.
5. Los identificadores heredados se preservan como referencia de migración y no sustituyen la identidad objetivo.

No se utilizarán enteros autoincrementales locales como identidad global.

---

# Idempotency key

Toda operación crítica deberá incluir:

```text
idempotency_key
```

Reglas:

1. La clave representa una intención comercial única.
2. Un reintento conserva la misma clave.
3. Una operación nueva utiliza una clave nueva.
4. La misma clave con el mismo payload retorna el mismo resultado.
5. La misma clave con payload diferente produce conflicto.
6. La clave se conserva local y centralmente.
7. La clave no se reutiliza entre tenants.
8. La clave no se elimina antes del periodo de retención.
9. Los efectos secundarios también deben ser idempotentes.
10. Una respuesta tardía se relaciona con la misma clave.
11. La unicidad se evalúa por `tenant_id`, `operation_type` e `idempotency_key`.
12. El inbox conserva el checksum asociado durante toda la ventana de reintento, recuperación y retención aplicable.

---

# Versionado optimista

Los agregados mutables utilizarán:

```text
expected_version
```

`expected_version` es obligatorio cuando la operación modifica un agregado versionado existente. Solo puede omitirse al crear un hecho append-only nuevo protegido por identidad global e idempotencia, o cuando no existe una versión previa que comparar.

El servidor aplicará la operación cuando:

```text
expected_version = current_version
```

Después de aplicar:

```text
new_version = current_version + 1
```

Si no coincide:

```text
SYNC_VERSION_CONFLICT
```

La operación no será sobrescrita automáticamente.

El conflicto se resolverá según la política específica del dominio.

---

# Relojes y tiempo

## Principio

El tiempo del dispositivo sirve como evidencia contextual, no como autoridad global.

Se conservarán:

```text
occurred_at_local
recorded_at_local
received_at_server
committed_at_server
```

## Autoridad temporal

El servidor asigna:

```text
received_at_server
committed_at_server
```

Estos valores se utilizan para:

- auditoría central;
- orden de recepción;
- retención;
- reportes técnicos;
- investigación de incidentes.

No determinan por sí solos la validez comercial.

## Desviación de reloj

El dispositivo deberá reportar:

```text
device_clock_offset
clock_quality
last_clock_sync_at
```

Estados posibles:

```text
TRUSTED
DEGRADED
UNTRUSTED
UNKNOWN
```

Una desviación fuera del límite configurado puede:

- generar advertencia;
- bloquear operaciones sensibles;
- exigir sincronización;
- requerir revisión.

## Prohibición

No se utilizará:

```text
latest_timestamp_wins
```

para resolver conflictos críticos.

---

# Orden causal

Cuando una operación dependa de otra deberá declarar:

```text
causation_id
correlation_id
```

Ejemplo:

```text
SaleCompleted
    ↓
PaymentRegistered
    ↓
InventoryDeducted
    ↓
ReceiptIssued
```

Una operación dependiente no podrá confirmarse centralmente si falta su causa obligatoria.

El servidor podrá mantenerla en:

```text
WAITING_FOR_DEPENDENCY
```

hasta:

- recibir la dependencia;
- vencer el plazo;
- enviarla a revisión;
- rechazarla explícitamente.

---

# Estados de sincronización local

Toda operación local tendrá uno de estos estados:

```text
LOCAL_PENDING
READY_TO_SYNC
SYNCING
SERVER_ACCEPTED
SERVER_REJECTED
CONFLICT
WAITING_FOR_DEPENDENCY
RETRY_SCHEDULED
REVIEW_REQUIRED
DEAD_LETTER
ARCHIVED
```

## `LOCAL_PENDING`

La operación fue creada dentro de una transacción local, pero todavía no está lista para envío.

## `READY_TO_SYNC`

La operación quedó confirmada localmente y puede transmitirse.

## `SYNCING`

Existe un intento activo de sincronización.

## `SERVER_ACCEPTED`

El servidor confirmó la operación y sus efectos.

## `SERVER_REJECTED`

El servidor rechazó definitivamente la operación.

## `CONFLICT`

La versión o estado central no permite aplicarla directamente.

## `WAITING_FOR_DEPENDENCY`

Falta una operación causal requerida.

## `RETRY_SCHEDULED`

La operación se reintentará después de un fallo temporal.

## `REVIEW_REQUIRED`

La decisión requiere intervención autorizada.

## `DEAD_LETTER`

La operación agotó los reintentos o presenta un error no recuperable automáticamente.

## `ARCHIVED`

La operación terminó su ciclo activo y se conserva según retención.

---

# Transiciones permitidas

```text
LOCAL_PENDING
    -> READY_TO_SYNC

READY_TO_SYNC
    -> SYNCING

SYNCING
    -> SERVER_ACCEPTED
    -> SERVER_REJECTED
    -> CONFLICT
    -> WAITING_FOR_DEPENDENCY
    -> RETRY_SCHEDULED
    -> REVIEW_REQUIRED
    -> DEAD_LETTER

RETRY_SCHEDULED
    -> READY_TO_SYNC

WAITING_FOR_DEPENDENCY
    -> READY_TO_SYNC
    -> REVIEW_REQUIRED
    -> DEAD_LETTER

CONFLICT
    -> REVIEW_REQUIRED
    -> SERVER_REJECTED
    -> SERVER_ACCEPTED

REVIEW_REQUIRED
    -> SERVER_ACCEPTED
    -> SERVER_REJECTED
    -> DEAD_LETTER

SERVER_ACCEPTED
    -> ARCHIVED

SERVER_REJECTED
    -> ARCHIVED

DEAD_LETTER
    -> REVIEW_REQUIRED
    -> ARCHIVED

REVIEW_REQUIRED
    -> RETRY_SCHEDULED

RETRY_SCHEDULED
    -> DEAD_LETTER
    -> REVIEW_REQUIRED
    -> SERVER_ACCEPTED
    -> SERVER_REJECTED
```

No se permite regresar de:

```text
SERVER_ACCEPTED
```

a:

```text
READY_TO_SYNC
```

La corrección se realiza mediante una operación nueva.

---

# Atomicidad local

La operación de negocio y el registro outbox deberán persistirse en la misma transacción local.

Ejemplo:

```text
BEGIN

guardar venta local
guardar líneas
guardar pago local
guardar movimiento local
guardar evento outbox

COMMIT
```

No se permite:

```text
guardar negocio
COMMIT

guardar outbox
COMMIT
```

porque una caída intermedia podría perder la sincronización.

---

# Atomicidad central

El servidor deberá ejecutar dentro de una misma frontera transaccional:

```text
validar inbox
validar tenant
validar dispositivo
validar idempotencia
validar versión
aplicar operación
guardar eventos
actualizar versión
registrar auditoría
confirmar inbox
```

Si falla un paso obligatorio:

```text
ROLLBACK
```

No se confirmará el inbox si los efectos principales no quedaron persistidos.

---

# Outbox local

Cada registro deberá contener como mínimo:

```text
outbox_id
operation_id
tenant_id
device_id
local_sequence
aggregate_type
aggregate_id
operation_type
payload
payload_checksum
schema_version
sync_status
attempt_count
next_attempt_at
last_attempt_at
last_error_code
last_error_detail
created_at
updated_at
```

## Reglas

1. La outbox es persistente.
2. No depende de memoria.
3. Sobrevive reinicios.
4. No elimina pendientes.
5. Mantiene intentos.
6. Mantiene último error.
7. Permite reanudación.
8. Se procesa por lotes limitados.
9. Respeta orden causal cuando aplique.
10. No mezcla tenants.
11. `local_sequence` es única y estrictamente creciente dentro de `(tenant_id, device_id)`.
12. `operation_id` no aparece en más de una entrada activa o histórica de outbox.

---

# Inbox central

Cada operación recibida se registra por:

```text
tenant_id
operation_id
idempotency_key
payload_checksum
```

## Casos

### Operación nueva

Se valida y procesa.

### Operación repetida con mismo checksum

Se devuelve el resultado previamente registrado.

### Operación repetida con checksum diferente

Se responde:

```text
SYNC_IDEMPOTENCY_CONFLICT
```

### Operación ya aceptada

No se repiten efectos.

## Restricciones de deduplicación

1. `operation_id` es única globalmente.
2. Existe unicidad adicional para `(tenant_id, operation_type, idempotency_key)` en la intención recibida.
3. Un mismo `idempotency_key` no puede quedar asociado a dos checksums dentro de su alcance.
4. El registro de inbox y los efectos centrales se confirman o revierten juntos.
5. La retención de inbox e idempotencia no puede ser menor que la mayor ventana soportada de retry, recuperación y operación offline.

### Operación ya rechazada

Se devuelve el rechazo original.

### Operación en revisión

Se devuelve su estado actual.

---

# Resultado de sincronización

La respuesta central deberá incluir:

```text
operation_id
server_status
server_result_code
aggregate_id
previous_version
new_version
received_at_server
committed_at_server
retryable
review_required
correlation_id
```

El POS persistirá la respuesta antes de actualizar la interfaz.

---

# Regla de autoridad

La autoridad no se asignará de forma genérica.

Cada dominio deberá declarar:

```text
authority_policy
```

Valores iniciales:

```text
LOCAL_AUTHORITATIVE_UNTIL_SYNC
SERVER_AUTHORITATIVE
APPEND_ONLY_SHARED
CENTRAL_REVIEW_REQUIRED
EXTERNAL_PROVIDER_AUTHORITATIVE
DERIVED_PROJECTION
```

---

# `LOCAL_AUTHORITATIVE_UNTIL_SYNC`

El nodo local puede confirmar temporalmente la operación.

El servidor puede:

- aceptarla;
- rechazarla;
- marcar conflicto;
- requerir revisión.

No puede reescribir silenciosamente el hecho local.

---

# `SERVER_AUTHORITATIVE`

La operación no se considera definitiva hasta confirmación central.

Ejemplos posibles:

- cambios globales de configuración;
- creación de usuarios;
- permisos;
- cambios de licencia;
- cambios fiscales críticos;
- cierre administrativo consolidado.

---

# `APPEND_ONLY_SHARED`

Los nodos producen hechos inmutables.

El servidor consolida sin sobrescribirlos.

Ejemplos:

- movimientos de caja;
- movimientos de inventario;
- eventos de auditoría;
- intentos de pago;
- eventos de dispositivo.

---

# `CENTRAL_REVIEW_REQUIRED`

La operación puede registrarse localmente, pero requiere decisión central o humana.

Ejemplos:

- conflicto de devolución;
- exceso de descuento;
- diferencia de inventario;
- venta con regla vencida;
- operación con reloj no confiable.

---

# `EXTERNAL_PROVIDER_AUTHORITATIVE`

La autoridad final pertenece a un proveedor externo.

Ejemplos:

- pago adquirido;
- documento fiscal;
- confirmación bancaria.

El POS y el backend mantienen estados internos, pero no inventan el resultado externo.

---

# `DERIVED_PROJECTION`

El dato se calcula a partir de hechos.

Ejemplos:

- saldo;
- total vendido;
- inventario disponible;
- cobertura de pago;
- resumen de caja.

Una proyección no sobrescribe los hechos originales.

---

# Matriz inicial de autoridad por dominio

| Dominio | Política principal | Autoridad definitiva | Operación offline | Conflicto esperado |
|---|---|---|---|---|
| Catálogo | `SERVER_AUTHORITATIVE` | Servidor central | Lectura local; cambios restringidos | Versión desactualizada |
| Pricing | `SERVER_AUTHORITATIVE` | Servidor central | Uso de versión sincronizada | Regla vencida o reemplazada |
| Venta abierta | `LOCAL_AUTHORITATIVE_UNTIL_SYNC` | Nodo local hasta cierre | Permitida | Cambios simultáneos sobre la misma venta |
| Venta completada | `APPEND_ONLY_SHARED` | Hecho local validado centralmente | Permitida según política | Duplicación o dependencia faltante |
| Pago en efectivo | `APPEND_ONLY_SHARED` | Hecho local + conciliación central | Permitido | Duplicación o caja cerrada |
| Pago externo | `EXTERNAL_PROVIDER_AUTHORITATIVE` | Proveedor externo | Restringido | Timeout o respuesta tardía |
| Caja | `APPEND_ONLY_SHARED` | Hechos locales consolidados | Permitida | Sesión cerrada o versión inconsistente |
| Inventario | `APPEND_ONLY_SHARED` | Movimientos; saldo derivado | Permitida según política | Stock insuficiente o conflicto de lote |
| Devoluciones | `CENTRAL_REVIEW_REQUIRED` cuando exista conflicto | Servidor o revisor autorizado | Parcialmente permitida | Elegibilidad ya consumida |
| Usuarios y permisos | `SERVER_AUTHORITATIVE` | Servidor central | No editable offline | Versión o permiso desactualizado |
| Licencias | `SERVER_AUTHORITATIVE` | Servidor central | Solo gracia aprobada | Dispositivo no autorizado |
| Fiscal | `EXTERNAL_PROVIDER_AUTHORITATIVE` | Proveedor fiscal | Emisión diferida según política | Documento rechazado o duplicado |
| Auditoría | `APPEND_ONLY_SHARED` | Hechos inmutables | Permitida | Duplicación técnica |
| Reportes | `DERIVED_PROJECTION` | Proyección central o local | Permitida con advertencia | Datos incompletos |

---

# Reglas por dominio

## Catálogo

1. El catálogo central es autoritativo.
2. El POS puede utilizar una copia sincronizada.
3. El POS no puede inventar productos globales.
4. Los cambios locales de catálogo requieren permiso y política explícita.
5. Un producto desactivado centralmente no se elimina de ventas históricas.
6. Una versión antigua puede seguir visible para historia.
7. Una presentación utilizada en una venta conserva snapshot.
8. Las operaciones offline utilizan la versión local conocida.
9. Si la versión está vencida, la operación puede:
   - bloquearse;
   - advertirse;
   - requerir revisión.
10. El servidor no reescribe ventas históricas por cambios de catálogo.

## Pricing

1. La versión de pricing es autoritativa desde el servidor.
2. El dispositivo conserva:
   - `pricing_pipeline_version`;
   - reglas;
   - vigencia;
   - checksum;
   - fecha de sincronización.
3. Una venta offline usa la versión sincronizada.
4. Una venta completada conserva su snapshot.
5. Una regla central nueva no recalcula ventas históricas.
6. Si una regla local está vencida:
   - se bloquea;
   - se limita;
   - se marca `REVIEW_REQUIRED`.
7. El frontend no decide el total final.
8. La sincronización puede aceptar, rechazar o revisar.
9. No se oculta una diferencia de pricing.
10. Toda corrección posterior es una operación nueva.

## Venta abierta

La venta abierta es autoritativa en el dispositivo que la creó.

Debe conservar:

```text
sale_id
owner_device_id
cash_session_id
current_version
last_local_sequence
```

Reglas:

1. Solo un dispositivo puede editar directamente la venta abierta.
2. Otro dispositivo puede solicitar transferencia explícita.
3. No se permite edición simultánea sin mecanismo de ownership.
4. La suspensión conserva el propietario original.
5. La recuperación en otro dispositivo requiere:
   - sincronización previa;
   - transferencia;
   - versión esperada;
   - auditoría.
6. Una venta completada deja de ser mutable.
7. Un cierre local genera hecho append-only.
8. El servidor no convierte una venta completada en borrador.

## Venta completada

1. Es un hecho inmutable.
2. Se identifica globalmente.
3. Se sincroniza de forma idempotente.
4. Los efectos dependientes deben declarar causalidad.
5. No se actualiza destructivamente.
6. Una corrección usa:
   - devolución;
   - anulación compensatoria;
   - refund;
   - reversal;
   - nota;
   - ajuste.
7. El servidor puede rechazar si:
   - el tenant no coincide;
   - el dispositivo no está autorizado;
   - falta dependencia;
   - la firma es inválida;
   - la versión de política no es soportada.
8. Un rechazo no elimina el hecho local.
9. El rechazo queda visible.
10. La reconciliación debe ser auditable.

## Caja

1. Cada sesión de caja pertenece a:
   - tenant;
   - sucursal;
   - dispositivo;
   - operador.
2. Una sesión local puede operar offline según política.
3. Los movimientos son append-only.
4. Un retiro no se sobrescribe.
5. Un ingreso no se sobrescribe.
6. Un cierre no se modifica.
7. Una diferencia se registra.
8. La caja central consolida hechos.
9. Dos sesiones incompatibles generan conflicto.
10. Una sesión cerrada no acepta movimientos posteriores.
11. Una operación tardía se envía a revisión.
12. La corrección requiere una operación compensatoria.

## Pagos en efectivo

1. El efectivo puede confirmarse localmente.
2. Debe existir una sesión de caja válida.
3. El pago genera movimiento de caja.
4. El pago y el movimiento se relacionan causalmente.
5. Un reintento no duplica el pago.
6. Un pago aceptado localmente puede ser rechazado centralmente solo por una causa explícita.
7. El rechazo no borra el hecho.
8. El conflicto se envía a conciliación.
9. El cambio pertenece al cálculo de caja.
10. El sobrepago no modifica pricing.

## Pagos externos

1. El proveedor es autoridad del resultado financiero.
2. El POS registra intención e intento.
3. Un timeout no equivale a rechazo.
4. Una respuesta tardía conserva el mismo intento.
5. No se crea un segundo pago por reintento.
6. La consulta posterior usa:
   - referencia del proveedor;
   - idempotency key;
   - correlation id.
7. Estados posibles:
   - pendiente;
   - aprobado;
   - rechazado;
   - desconocido;
   - en revisión.
8. Un estado incierto bloquea decisiones incompatibles.
9. La venta no se considera cubierta hasta cumplir la política definida.
10. Refund y reversal son operaciones separadas.

## Inventario

1. Los movimientos son append-only.
2. El saldo es una proyección.
3. Cada movimiento conserva:
   - producto;
   - presentación;
   - ubicación;
   - lote;
   - cantidad;
   - unidad;
   - causa;
   - dispositivo;
   - actor.
4. El POS puede generar movimientos offline según política.
5. El servidor consolida por causalidad.
6. No se aplica `last-write-wins` al saldo.
7. Un conflicto de stock no elimina movimientos.
8. El conflicto puede producir:
   - saldo negativo controlado;
   - revisión;
   - rechazo;
   - ajuste posterior.
9. La política depende del tipo de operación.
10. Un conteo no borra historia.
11. Una corrección genera ajuste.
12. Una conversión mantiene trazabilidad.

## Devoluciones

1. La devolución referencia la venta original.
2. Usa snapshot original.
3. Conserva elegibilidad restante.
4. Una devolución parcial no supera cantidad disponible.
5. Dos devoluciones concurrentes pueden generar conflicto.
6. El servidor verifica la elegibilidad central.
7. Si ya fue consumida:
   - rechaza;
   - revisa;
   - limita.
8. No se reescribe la venta original.
9. Refund, inventario y caja son efectos separados.
10. Toda diferencia queda auditable.

## Usuarios y permisos

1. El servidor es autoridad.
2. El dispositivo conserva una copia limitada.
3. Los permisos tienen versión y vigencia.
4. Una operación offline usa el permiso sincronizado.
5. Operaciones sensibles pueden requerir permiso no vencido.
6. Un permiso revocado no borra auditoría histórica.
7. El usuario no puede elevarse localmente.
8. La sincronización valida el permiso central.
9. Un permiso inválido produce rechazo explícito.
10. El dispositivo no define roles globales.

## Licencias y dispositivos

1. El servidor es autoridad.
2. Cada dispositivo tiene identidad propia.
3. La activación requiere firma o token verificable.
4. La gracia offline debe estar versionada.
5. Un dispositivo revocado no puede sincronizar.
6. Un reemplazo no reutiliza identidad silenciosamente.
7. Las operaciones pendientes deben migrarse mediante procedimiento controlado.
8. La revocación queda auditada.
9. El almacenamiento local protege secretos.
10. La política final se complementará con `DEC-008`.

---

# Resolución de conflictos

## Principio

Un conflicto no es un error genérico.

Debe clasificarse por:

```text
conflict_type
aggregate_type
aggregate_id
operation_id
expected_version
current_version
authority_policy
severity
resolution_policy
```

## Tipos iniciales

```text
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
AUTHORITY_CONFLICT
DEPENDENCY_CONFLICT
STATE_CONFLICT
PERMISSION_CONFLICT
TENANT_CONFLICT
DEVICE_CONFLICT
CLOCK_CONFLICT
POLICY_VERSION_CONFLICT
EXTERNAL_RESULT_CONFLICT
RESOURCE_CONFLICT
```

## Resoluciones posibles

```text
AUTO_ACCEPT
AUTO_REJECT
AUTO_MERGE
COMPENSATE
WAIT_FOR_DEPENDENCY
RETRY
REVIEW_REQUIRED
DEAD_LETTER
```

## `AUTO_ACCEPT`

Solo cuando:

- no se viola una invariante;
- la operación es idempotente;
- la autoridad lo permite;
- el estado central es compatible.

## `AUTO_REJECT`

Cuando:

- el tenant no coincide;
- la firma es inválida;
- el dispositivo está revocado;
- la operación es imposible;
- el estado terminal lo impide;
- el payload contradice la idempotency key.

## `AUTO_MERGE`

Solo se permite para datos expresamente declarados como fusionables.

Ejemplos posibles:

- etiquetas;
- notas no financieras;
- preferencias locales;
- metadatos no críticos.

No se permite `AUTO_MERGE` para:

- pagos;
- caja;
- inventario;
- ventas completadas;
- impuestos;
- licencias;
- auditoría.

## `COMPENSATE`

Crea una operación posterior que corrige efectos.

Ejemplos:

- ajuste de inventario;
- movimiento de caja;
- refund;
- reversal;
- nota de corrección.

## `WAIT_FOR_DEPENDENCY`

Se aplica cuando falta una causa obligatoria.

## `REVIEW_REQUIRED`

Se utiliza cuando ninguna regla automática puede garantizar consistencia.

Debe registrar:

```text
review_id
conflict_id
assigned_role
assigned_user
decision
reason
evidence
resolved_at
```

---

# Reintentos

## Política

Los reintentos utilizan backoff exponencial con jitter.

Conceptualmente:

```text
next_delay =
min(
    max_delay,
    base_delay * 2 ^ attempt_count
)
+
jitter
```

## Reglas

1. Un reintento conserva `operation_id`.
2. Conserva `idempotency_key`.
3. Conserva checksum.
4. Incrementa `attempt_count`.
5. Registra error anterior.
6. No altera el payload silenciosamente.
7. Un cambio de payload crea una operación nueva.
8. Los errores permanentes no se reintentan indefinidamente.
9. Los errores temporales se reintentan.
10. El usuario puede forzar reintento con permiso.
11. El sistema evita tormentas de reintentos.
12. La red recuperada no dispara toda la cola simultáneamente.

## Clasificación de errores

### Reintentables

- timeout;
- conexión rechazada;
- servidor temporalmente no disponible;
- rate limit;
- dependencia temporal;
- lock transitorio.

### No reintentables

- tenant inválido;
- firma inválida;
- payload corrupto;
- esquema incompatible;
- permiso denegado;
- dispositivo revocado;
- conflicto de idempotencia.

---

# Procesamiento por lotes

El límite, backoff, jitter, ventana, exclusiones y tratamiento de agotamiento provienen de una política técnica versionada. No se hardcodean números universales.

La operación original conserva el payload canónico inmutable. Una dead letter es evidencia/revisión referencial y no copia ese payload. Si la intención cambia, se crea una operación nueva con causalidad explícita.

La sincronización procesará lotes limitados.

Cada lote deberá tener:

```text
batch_id
device_id
tenant_id
first_sequence
last_sequence
operation_count
payload_checksum
created_at
```

Reglas:

1. No se mezcla tenant.
2. No se mezcla dispositivo.
3. Se respeta orden causal.
4. Una operación fallida no debe perder las restantes.
5. El resultado es individual por operación.
6. El checkpoint avanza solo sobre operaciones confirmadas.
7. Las operaciones bloqueadas no se descartan.
8. El tamaño de lote es configurable.
9. El lote puede fragmentarse.
10. La respuesta puede ser parcial.

---

# Checkpoints

El dispositivo conserva:

```text
last_uploaded_sequence
last_server_acknowledged_sequence
last_downloaded_cursor
last_successful_sync_at
last_full_reconciliation_at
```

Reglas:

1. El checkpoint se actualiza transaccionalmente.
2. No avanza antes de persistir la confirmación.
3. Un reinicio retoma desde el checkpoint.
4. Una pérdida de respuesta produce reenvío idempotente.
5. El servidor puede reconstruir el estado.
6. Un checkpoint corrupto activa recuperación.
7. No se confía únicamente en memoria.
8. Los checkpoints están aislados por tenant y dispositivo.

---

# Retención

## Principio

Los datos críticos no se eliminan por conveniencia operativa.

La política deberá distinguir:

```text
active_retention
archive_retention
audit_retention
legal_retention
```

## Outbox

- pendientes: hasta resolver;
- aceptadas: periodo mínimo configurable;
- rechazadas: periodo mínimo configurable;
- conflictos: hasta resolución y archivo;
- dead letter: hasta revisión o política de archivo.

## Inbox

Debe conservar suficiente información para impedir duplicados durante todo el periodo de riesgo.

## Auditoría

La auditoría se conserva según política legal y contractual.

## Prohibiciones

1. No purgar operaciones pendientes.
2. No purgar conflictos abiertos.
3. No purgar claves de idempotencia antes del plazo.
4. No purgar evidencias de pagos pendientes.
5. No purgar eventos fiscales no conciliados.
6. No compactar destruyendo trazabilidad.

---

# Compactación

La compactación puede reducir almacenamiento de proyecciones o caché.

No puede eliminar:

- hechos financieros;
- movimientos de inventario;
- movimientos de caja;
- eventos de auditoría;
- operaciones pendientes;
- conflictos abiertos;
- pruebas de idempotencia;
- resultados de proveedor.

Las proyecciones pueden reconstruirse desde hechos cuando sea viable.

---

# Recuperación tras reinicio

Al iniciar, el POS ejecutará:

```text
1. validar base local
2. validar integridad de outbox
3. cargar checkpoint
4. detectar operaciones en SYNCING
5. convertir intentos interrumpidos a estado recuperable
6. reanudar según backoff
7. verificar sesión de caja
8. verificar reglas y licencias
9. presentar conflictos visibles
10. iniciar sincronización controlada
```

Una operación que estaba en:

```text
SYNCING
```

antes del reinicio no se considera perdida ni aceptada.

Debe volver a:

```text
READY_TO_SYNC
```

o:

```text
RETRY_SCHEDULED
```

según evidencia disponible.

---

# Recuperación de base local

Si la base local presenta daño:

1. se detiene la operación;
2. se crea copia forense;
3. se intenta validación;
4. se intenta recuperación controlada;
5. no se sobrescribe el archivo original;
6. se verifica outbox;
7. se compara con inbox central;
8. se reconstruye cache;
9. se preservan operaciones no sincronizadas;
10. se genera incidente.

No se permite reinstalar el POS y perder la cola pendiente.

---

# Reemplazo de dispositivo

El reemplazo deberá considerar:

```text
old_device_id
new_device_id
replacement_reason
pending_operation_count
last_checkpoint
revocation_status
migration_status
authorized_by
```

Reglas:

1. El nuevo dispositivo tiene identidad nueva.
2. El anterior se revoca o marca reemplazado.
3. Las operaciones aceptadas no se reenvían.
4. Las pendientes se migran de forma controlada.
5. Las claves privadas no se copian manualmente.
6. La migración se audita.
7. La caja abierta requiere procedimiento específico.
8. Los conflictos permanecen.
9. Los secretos se reemiten.
10. La política final se complementará con `DEC-008`.

---

# Descarga desde el servidor

El servidor puede enviar:

- catálogo;
- precios;
- impuestos;
- permisos;
- configuración;
- licencias;
- estados de operaciones;
- resultados de revisión;
- confirmaciones externas.

Cada paquete deberá incluir:

```text
cursor
schema_version
tenant_id
payload_checksum
generated_at_server
```

El dispositivo:

1. valida tenant;
2. valida esquema;
3. valida checksum;
4. persiste antes de aplicar;
5. aplica transaccionalmente;
6. actualiza cursor;
7. registra auditoría.

---

# Seguridad de sincronización

Toda sincronización deberá validar:

```text
tenant_id
device_id
device_status
user_or_service_identity
session_or_token
signature_or_proof
schema_version
payload_checksum
```

## Reglas

1. HTTPS obligatorio.
2. Secretos fuera del frontend.
3. Tokens con vigencia.
4. Rotación de credenciales.
5. Dispositivo revocado bloqueado.
6. Tenant validado en backend.
7. Payload firmado o protegido según política.
8. Replay detectado por inbox e idempotencia.
9. Rate limiting por dispositivo.
10. Logs sin secretos.
11. Errores sin exposición interna.
12. Auditoría de autenticación.
13. Operaciones sensibles requieren privilegio.
14. Una respuesta no se acepta sin correlación.
15. La seguridad offline se complementa con `DEC-008`.

---

# Aislamiento multiempresa

Toda operación incluye:

```text
tenant_id
company_id
```

El backend debe:

1. derivar tenant desde identidad confiable;
2. comparar contra payload;
3. rechazar discrepancias;
4. filtrar repositorios;
5. impedir referencias cruzadas;
6. registrar intentos;
7. probar aislamiento;
8. no confiar en el tenant enviado por UI.

Una operación de un tenant nunca puede modificar datos de otro.

---

# Compatibilidad de esquema

Cada operación incluye:

```text
schema_version
```

El servidor puede responder:

```text
SCHEMA_SUPPORTED
SCHEMA_UPGRADE_REQUIRED
SCHEMA_DEPRECATED
SCHEMA_UNSUPPORTED
```

Reglas:

1. No interpretar silenciosamente un esquema desconocido.
2. Los cambios compatibles mantienen soporte.
3. Los cambios incompatibles requieren migración.
4. Una operación antigua puede enviarse a revisión.
5. El dispositivo debe conocer versiones mínimas.
6. Las migraciones locales son transaccionales.
7. Se conserva backup antes de migrar.
8. La versión queda auditada.

---

# Observabilidad

Cada sincronización deberá producir métricas:

```text
sync_operations_total
sync_operations_accepted
sync_operations_rejected
sync_operations_conflict
sync_operations_retry
sync_operations_dead_letter
sync_latency_ms
outbox_depth
oldest_pending_age
checkpoint_lag
clock_offset
```

Dimensiones:

```text
tenant
branch
device
operation_type
result_code
schema_version
```

No se incluirán datos sensibles como etiquetas de alta cardinalidad.

---

# Alertas mínimas

Se generará alerta cuando:

- crezca la outbox;
- exista operación pendiente demasiado antigua;
- aumenten conflictos;
- aparezcan dead letters;
- falle autenticación repetidamente;
- el reloj sea no confiable;
- el dispositivo esté revocado;
- el checkpoint no avance;
- existan errores de esquema;
- haya divergencias de checksum;
- fallen conciliaciones financieras.

---

# Códigos de error iniciales

```text
SYNC_TENANT_MISMATCH
SYNC_DEVICE_NOT_REGISTERED
SYNC_DEVICE_REVOKED
SYNC_AUTHENTICATION_FAILED
SYNC_SIGNATURE_INVALID
SYNC_SCHEMA_UNSUPPORTED
SYNC_PAYLOAD_CHECKSUM_MISMATCH
SYNC_IDEMPOTENCY_CONFLICT
SYNC_VERSION_CONFLICT
SYNC_STATE_CONFLICT
SYNC_PERMISSION_DENIED
SYNC_DEPENDENCY_MISSING
SYNC_CLOCK_UNTRUSTED
SYNC_POLICY_VERSION_EXPIRED
SYNC_EXTERNAL_RESULT_PENDING
SYNC_RETRY_EXHAUSTED
SYNC_REVIEW_REQUIRED
SYNC_DEAD_LETTER
```

---

# Invariantes de sincronización

1. Una operación no se pierde.
2. Una operación aceptada no se aplica dos veces.
3. Un reintento conserva identidad.
4. Una idempotency key no cambia payload.
5. Una venta completada no se reescribe.
6. Un pago no se duplica.
7. Un movimiento de caja no se elimina.
8. Un movimiento de inventario no se elimina.
9. Un conflicto no se oculta.
10. Un reloj local no define autoridad.
11. Un tenant no accede a otro.
12. Un dispositivo revocado no sincroniza.
13. Un checkpoint no avanza sin confirmación.
14. Una operación dependiente espera su causa.
15. Una respuesta tardía conserva correlación.
16. Una proyección no sustituye hechos.
17. Una cola pendiente sobrevive reinicios.
18. Una recuperación conserva evidencia.
19. Un cambio de esquema es explícito.
20. Toda resolución queda auditada.

---

# Escenarios de aceptación

## Escenario 1 — Venta offline y sincronización posterior

Dado:

- un dispositivo autorizado;
- sesión de caja abierta;
- catálogo y pricing vigentes;
- servidor no disponible.

Cuando:

1. se crea una venta;
2. se agregan líneas;
3. se registra pago en efectivo;
4. se completa la venta;
5. se guarda la operación y la outbox en la misma transacción;
6. vuelve la conexión;
7. se sincroniza.

Entonces:

- la venta no se pierde;
- el pago no se duplica;
- el movimiento de caja no se duplica;
- el inventario no se duplica;
- el servidor acepta una sola vez;
- el inbox registra la operación;
- el dispositivo recibe confirmación;
- el checkpoint avanza;
- la operación pasa a `SERVER_ACCEPTED`.

---

## Escenario 2 — Pérdida de respuesta después de aceptar

Dado:

- una operación enviada;
- el servidor la acepta;
- la respuesta se pierde.

Cuando:

- el dispositivo reintenta con el mismo `operation_id`;
- conserva `idempotency_key`;
- conserva checksum.

Entonces:

- el servidor detecta la operación existente;
- no repite efectos;
- devuelve el resultado previo;
- el dispositivo confirma la operación;
- no se duplica la venta;
- no se duplica el pago;
- no se duplica inventario.

---

## Escenario 3 — Misma idempotency key con payload diferente

Dado:

- una operación ya registrada;
- una segunda solicitud con la misma `idempotency_key`;
- payload diferente.

Cuando:

- llega al servidor.

Entonces:

```text
SYNC_IDEMPOTENCY_CONFLICT
```

Y:

- no se aplica el segundo payload;
- no se sobrescribe la operación original;
- se registra auditoría;
- el conflicto queda visible.

---

## Escenario 4 — Conflicto de versión

Dado:

```text
expected_version = 4
current_version = 5
```

Cuando:

- el dispositivo intenta modificar el agregado.

Entonces:

```text
SYNC_VERSION_CONFLICT
```

Y:

- no se sobrescribe el estado central;
- la operación pasa a `CONFLICT`;
- se aplica la política del dominio;
- puede terminar en `REVIEW_REQUIRED`;
- toda decisión queda auditada.

---

## Escenario 5 — Operación sin dependencia

Dado:

- un pago relacionado con una venta;
- la venta todavía no llegó al servidor.

Cuando:

- llega primero el pago.

Entonces:

```text
WAITING_FOR_DEPENDENCY
```

Y:

- no se pierde;
- no se rechaza automáticamente;
- espera la venta;
- se reanuda después;
- conserva causalidad.

---

## Escenario 6 — Dispositivo reiniciado durante sincronización

Dado:

- operaciones en `SYNCING`;
- reinicio abrupto.

Cuando:

- el POS inicia nuevamente.

Entonces:

- valida la base local;
- lee checkpoint;
- recupera operaciones;
- no las considera aceptadas sin evidencia;
- las mueve a `READY_TO_SYNC` o `RETRY_SCHEDULED`;
- reintenta con la misma identidad;
- no duplica efectos.

---

## Escenario 7 — Reloj manipulado

Dado:

- un dispositivo con desviación superior al límite;
- `clock_quality = UNTRUSTED`.

Cuando:

- intenta ejecutar una operación sensible.

Entonces:

- el reloj local no decide precedencia;
- el sistema genera alerta;
- puede bloquear;
- puede permitir con revisión;
- conserva hora local y hora central;
- registra el incidente.

---

## Escenario 8 — Dispositivo revocado

Dado:

- `device_status = REVOKED`.

Cuando:

- intenta sincronizar.

Entonces:

```text
SYNC_DEVICE_REVOKED
```

Y:

- no se procesan efectos;
- se registra intento;
- no se filtran secretos;
- las operaciones pendientes requieren procedimiento de recuperación.

---

## Escenario 9 — Conflicto de devolución

Dado:

- dos dispositivos;
- ambos intentan devolver la última unidad elegible.

Cuando:

- la primera devolución es aceptada;
- la segunda llega después.

Entonces:

- la segunda no supera elegibilidad;
- no modifica la venta original;
- no crea refund duplicado;
- termina en rechazo o revisión;
- queda evidencia del conflicto.

---

## Escenario 10 — Pago externo con timeout

Dado:

- intento de pago enviado;
- proveedor sin respuesta.

Cuando:

- ocurre timeout.

Entonces:

- no se marca aprobado;
- no se marca rechazado;
- queda estado pendiente o desconocido;
- el reintento conserva identidad;
- una respuesta tardía se vincula al mismo intento;
- no se crea un segundo pago.

---

## Escenario 11 — Pricing local vencido

Dado:

- dispositivo offline;
- versión de pricing vencida.

Cuando:

- se intenta completar una venta.

Entonces, según política:

- se bloquea;
- o se permite con límite;
- o pasa a `REVIEW_REQUIRED`.

Nunca:

- se recalcula silenciosamente;
- se oculta la versión usada;
- se aplica una regla inventada.

---

## Escenario 12 — Cola acumulada

Dado:

- varios días offline;
- gran cantidad de operaciones pendientes.

Cuando:

- vuelve la conexión.

Entonces:

- la cola se procesa por lotes;
- se usa backoff;
- no se envía toda simultáneamente;
- el checkpoint avanza de forma segura;
- las operaciones fallidas no eliminan las demás;
- la interfaz muestra progreso y errores.

---

## Escenario 13 — Tenant incorrecto

Dado:

- identidad autenticada para tenant A;
- payload con tenant B.

Cuando:

- se procesa.

Entonces:

```text
SYNC_TENANT_MISMATCH
```

Y:

- se rechaza;
- no se consulta ni modifica tenant B;
- se registra evento de seguridad.

---

## Escenario 14 — Esquema no soportado

Dado:

- operación con `schema_version` no soportada.

Cuando:

- llega al servidor.

Entonces:

```text
SYNC_SCHEMA_UNSUPPORTED
```

Y:

- no se interpreta parcialmente;
- no se modifica el payload;
- se conserva evidencia;
- se exige actualización o revisión.

---

## Escenario 15 — Base local dañada

Dado:

- error de integridad en SQLite.

Cuando:

- inicia el POS.

Entonces:

- se bloquea operación insegura;
- se crea copia forense;
- no se sobrescribe el original;
- se intenta recuperar outbox;
- se compara con inbox central;
- se reconstruye cache;
- se genera incidente.

---

## Escenario 16 — Reemplazo de dispositivo

Dado:

- dispositivo anterior fuera de servicio;
- operaciones pendientes;
- nuevo dispositivo autorizado.

Cuando:

- se ejecuta reemplazo.

Entonces:

- el nuevo dispositivo recibe identidad nueva;
- el anterior queda revocado o reemplazado;
- no se copian claves privadas manualmente;
- las operaciones aceptadas no se reenvían;
- las pendientes se migran con auditoría;
- los conflictos se conservan.

---

# Pruebas mínimas

## Unitarias

1. generación de `operation_id`;
2. idempotency key estable;
3. checksum determinista;
4. transiciones válidas;
5. transiciones prohibidas;
6. backoff;
7. jitter;
8. clasificación de errores;
9. policy resolver;
10. version conflict;
11. tenant mismatch;
12. clock quality;
13. checkpoint;
14. causalidad;
15. deduplicación.

## Integración local

1. negocio y outbox en una transacción;
2. rollback completo;
3. reinicio con `SYNCING`;
4. recuperación de checkpoint;
5. persistencia de errores;
6. procesamiento por lotes;
7. orden causal;
8. cola extensa;
9. base local en WAL;
10. migración de esquema.

## Integración central

1. inbox y efectos en una transacción;
2. mismo payload repetido;
3. payload diferente con misma clave;
4. expected version incorrecta;
5. tenant incorrecto;
6. dispositivo revocado;
7. dependencia faltante;
8. respuesta parcial;
9. conflicto manual;
10. auditoría.

## End-to-end

1. venta offline;
2. pago efectivo offline;
3. sincronización posterior;
4. timeout de proveedor;
5. respuesta tardía;
6. devolución concurrente;
7. cierre de caja offline;
8. inventario conflictivo;
9. dispositivo revocado;
10. actualización de esquema.

## Resiliencia

1. caída durante commit local;
2. caída después de commit local;
3. caída antes de confirmación central;
4. pérdida de respuesta;
5. pérdida de red;
6. latencia extrema;
7. rate limit;
8. servidor temporalmente caído;
9. reinicio del dispositivo;
10. disco casi lleno.

## Seguridad

1. replay;
2. token vencido;
3. firma inválida;
4. tenant manipulado;
5. dispositivo revocado;
6. escalamiento de privilegios;
7. payload modificado;
8. checksum incorrecto;
9. logs con secretos;
10. acceso cruzado entre tenants.

---

# Criterios de aceptación

`DEC-007` puede pasar a `DONE` cuando:

1. existe matriz de autoridad por dominio;
2. están definidos los estados de sincronización;
3. están definidas las transiciones;
4. está definida la identidad global;
5. está definida idempotencia;
6. está definido versionado optimista;
7. está definido orden causal;
8. está definido reloj confiable;
9. está definida outbox;
10. está definida inbox;
11. están definidos checkpoints;
12. están definidos reintentos;
13. está definida retención;
14. está definida compactación;
15. está definida recuperación;
16. está definido reemplazo de dispositivos;
17. está definido aislamiento multiempresa;
18. está definida compatibilidad de esquema;
19. están definidos códigos de error;
20. están definidos escenarios de aceptación;
21. están definidas pruebas mínimas;
22. no existen contradicciones con ADR existentes;
23. `ADR-003` queda complementado;
24. `SYNC-003` queda habilitado;
25. `TECH-005` reduce sus bloqueos;
26. el backlog queda actualizado;
27. existe evidencia versionada en Git.

---

# Consecuencias positivas

- operación offline verificable;
- reintentos seguros;
- ausencia de duplicación silenciosa;
- conflictos explícitos;
- autoridad definida;
- recuperación reproducible;
- auditoría completa;
- menor acoplamiento;
- soporte multiempresa;
- base para sincronización escalable;
- base para hardware local;
- base para licenciamiento offline.

---

# Costos y complejidad

La decisión introduce:

- outbox;
- inbox;
- checkpoints;
- estados adicionales;
- almacenamiento temporal;
- workers;
- métricas;
- reconciliación;
- procesos de revisión;
- pruebas de resiliencia;
- políticas por dominio.

Esta complejidad es necesaria.

No se implementarán abstracciones adicionales que no resuelvan uno de estos riesgos.

---

# Alternativas descartadas

## Last-write-wins

Descartada porque:

- depende de relojes;
- puede perder datos;
- no sirve para finanzas;
- no sirve para inventario;
- oculta conflictos.

## Sincronización solo por timestamps

Descartada porque no garantiza:

- causalidad;
- idempotencia;
- autoridad;
- integridad.

## Cola únicamente en memoria

Descartada porque se pierde al reiniciar.

## Reintentos con nueva identidad

Descartados porque duplican efectos.

## Merge genérico de JSON

Descartado porque mezcla datos con reglas diferentes.

## Microservicio de sincronización prematuro

Descartado inicialmente.

La sincronización puede vivir dentro del monolito modular mientras:

- los límites estén claros;
- exista worker separado;
- las métricas no justifiquen extracción.

---

# Riesgos residuales

1. crecimiento de outbox;
2. operaciones offline antiguas;
3. dispositivos con reloj incorrecto;
4. conflictos de inventario;
5. respuestas tardías externas;
6. corrupción local;
7. esquemas antiguos;
8. reemplazos incompletos;
9. mala configuración de retención;
10. exceso de revisión manual;
11. hardware con drivers inestables;
12. alto volumen de sincronización.

Estos riesgos deberán medirse durante:

- `SYNC-003`;
- `TECH-005`;
- pruebas de carga;
- pruebas de caos;
- piloto controlado.

---

# Documentos que deberán alinearse

Al cerrar esta decisión se deberán revisar:

- `docs/adr/ADR-003-local-first.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/domain/event-catalog.md`;
- `docs/domain/commercial-engine.md`;
- documentos de ventas;
- documentos de pagos;
- documentos de caja;
- documentos de inventario;
- `docs/product/backlog.md`;
- contratos de sincronización futuros.

No se modificará el modelo físico antes de autorizar `TECH-002`.

---

# Estado del documento

Estado:

`DONE`

La decisión contiene:

- autoridad por dominio;
- idempotencia;
- versionado;
- clocks;
- causalidad;
- estados;
- outbox;
- inbox;
- checkpoints;
- reintentos;
- lotes;
- retención;
- recuperación;
- seguridad;
- observabilidad;
- escenarios;
- pruebas;
- criterios de cierre.

Criterios de cierre verificados:

- revisarse contra documentos existentes;
- validarse por contradicciones;
- alinear documentos relacionados;
- pasar a `DONE`;
- actualizar backlog.
