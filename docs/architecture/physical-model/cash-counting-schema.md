# TECH-002F: esquema físico de turnos, movimientos y arqueos de caja

## Estado y alcance

`CLOSED` dentro de `TECH-002` para `PHY-G07`.

Este documento materializa conceptualmente `UC-CASH-001`, `UC-CASH-002`, `UC-CASH-003`, `DEC-002` y `DEC-007`. Define identidad, cardinalidades, estados, restricciones y fronteras transaccionales para caja sin escribir DDL ni autorizar migraciones.

La decisión central es separar:

- `CashShift`: ciclo operativo de apertura y cierre;
- `CashMovement`: hecho financiero que modifica el efectivo esperado;
- `CashCount`: evidencia física de un arqueo parcial, cierre o corrección;
- `CashCountDenomination`: desglose inmutable del valor contado;
- `CashDifferenceReview`: tratamiento explícito de una diferencia;
- `CashDifferenceReviewAction`: historial append-only de decisiones.

`CashCount` es un agregado propio. No se reduce a columnas mutables dentro de `CashShift`, porque un turno admite varios arqueos parciales, arqueo ciego, correcciones relacionadas y un único conteo de cierre.

## Autoridad y ubicación

| Agregado o entidad | Clase | Autoridad |
|---|---|---|
| CashRegister | `CENTRAL_MASTER_REPLICATED` | central; el POS consume versión autorizada |
| CashShift, CashMovement, CashCount, CashCountDenomination | `LOCAL_AUTHORITATIVE_SYNCED` | POS Local Service del dispositivo que opera el turno hasta aceptación central |
| CashDifferenceReview | `DUAL_WITH_EXPLICIT_POLICY` | creación local; decisiones críticas requieren autoridad prevista por política vigente |
| CashDifferenceReviewAction | misma autoridad que su Review | actor autorizado que ejecuta la transición |
| ExpectedCash | cálculo derivado | fold determinista de CashMovement `POSTED` hasta un corte explícito |

No se utiliza last-write-wins. Un conflicto central produce revisión, operación tardía o compensación; nunca reescribe un movimiento, conteo o cierre confirmado.

## Caja y turno

### `cash.cash_registers` / `cash_cash_registers`

Columnas lógicas: `id`, `tenant_id`, `company_id`, `branch_id`, `code`, `code_normalized`, `name`, `currency_code`, `status`, `created_at`, `retired_at NULL`, `version`.

Constraints:

- scope/FK compuestos a Branch;
- `UNIQUE (tenant_id, company_id, branch_id, code_normalized)`;
- estados `ACTIVE`/`RETIRED`;
- moneda ISO 4217 inmutable mientras existan turnos asociados;
- sin delete en cascada sobre historia financiera.

### `cash.cash_shifts` / `cash_cash_shifts`

Columnas lógicas: `id`, `tenant_id`, `company_id`, `branch_id`, `cash_register_id`, `origin_device_id`, `opened_by_actor_type`, `opened_by_actor_id`, `opened_at`, `business_date`, `timezone_id`, `utc_offset_minutes`, `currency_code`, `status`, `closed_by_actor_type NULL`, `closed_by_actor_id NULL`, `closed_at NULL`, `opening_idempotency_key`, `opening_request_checksum`, `closing_idempotency_key NULL`, `closing_request_checksum NULL`, `last_movement_sequence`, `version`, `created_at`, `server_recorded_at NULL`.

Estados persistentes:

- `OPEN`;
- `CLOSING`;
- `CLOSED`.

Reglas:

1. Cada turno tiene exactamente un CashMovement `OPENING_FLOAT` `POSTED`, protegido por unique parcial tenant-scoped; la base inicial se deriva de ese hecho y no tiene una segunda autoridad mutable.
2. Existe como máximo un turno en estado `OPEN` o `CLOSING` por `(tenant_id, branch_id, cash_register_id)`, **con independencia de `origin_device_id`**, conforme a la definición normativa de turno incompatible de `UC-CASH-001`. El unique lógico del turno activo es, por tanto, `(tenant_id, branch_id, cash_register_id)` restringido a los estados `OPEN` y `CLOSING`. Una `CashRegister` es un único cajón físico: la regla impide que dos turnos simultáneos calculen `ExpectedCash` contra el mismo efectivo, cuyo `counted_amount` sólo podría atribuirse a uno. `origin_device_id` conserva íntegras sus funciones de procedencia, idempotencia, auditoría y trazabilidad, y no expresa propiedad sobre la caja. Decisión registrada en `DEC-012` §25.
3. `OPEN -> CLOSING -> CLOSED` es la secuencia normal; un retorno operativo no modifica el turno cerrado y requiere un caso de uso compensatorio explícito.
4. Un turno `CLOSED` tiene exactamente un CashCount `CLOSING` `COMPLETED`, protegido por unique parcial `(tenant_id, cash_shift_id)` para ese tipo. No se agrega una FK circular desde CashShift.
5. Un turno `CLOSED` es inmutable y no admite movimientos normales tardíos.
6. Cada mutación usa `expected_version`; `last_movement_sequence` aumenta monotónicamente dentro del turno.
7. Apertura y cierre tienen claves/checksums independientes; misma clave y contenido devuelve el mismo resultado, contenido distinto produce conflicto.

La protección de turno incompatible se expresa con índice parcial en PostgreSQL. SQLite la valida dentro de `BEGIN IMMEDIATE` por el único escritor local y la cubre con pruebas de concurrencia, conforme a la excepción documentada en `physical-conventions.md`.

## Movimientos y efectivo esperado

### `cash.cash_movements` / `cash_cash_movements`

Columnas lógicas: `id`, `tenant_id`, `company_id`, `branch_id`, `cash_register_id`, `cash_shift_id`, `shift_sequence`, `movement_type`, `direction`, `amount`, `currency_code`, `status`, `reference_type`, `reference_id NULL`, `original_cash_movement_id NULL`, `reason_code`, `evidence_reference NULL`, `actor_type`, `actor_id NULL`, `approved_by_actor_type NULL`, `approved_by_actor_id NULL`, `business_date`, `occurred_at`, `device_reported_at`, `origin_device_id`, `idempotency_key`, `request_checksum`, `correlation_id`, `version`, `created_at`, `server_recorded_at NULL`.

Tipos iniciales respaldados por `UC-CASH-003`:

- `OPENING_FLOAT`;
- `CASH_SALE`;
- `CASH_PAYMENT`;
- `CHANGE_GIVEN`;
- `CASH_REFUND`;
- `CASH_REVERSAL_COMPENSATION`;
- `CASH_WITHDRAWAL`;
- `CASH_DEPOSIT`;
- `COURIER_COLLECTION`;
- `CASH_EXPENSE`;
- `CASH_ADJUSTMENT_POSITIVE`;
- `CASH_ADJUSTMENT_NEGATIVE`;
- `TRANSFER_TO_SAFE`;
- `TRANSFER_FROM_SAFE`;
- `CLOSING_TRANSFER`;
- `OTHER_AUTHORIZED`.

Estados persistentes:

- `CREATED`;
- `PENDING_APPROVAL`;
- `APPROVED`;
- `POSTED`;
- `REJECTED`;
- `FAILED`;
- `CANCELLED`;

Constraints e invariantes:

- `amount` usa la representación decimal exacta de escala **6** y precisión total **19** definida en `physical-conventions.md`; `numeric(19,6)` en PostgreSQL y TEXT decimal canónico en SQLite. Nunca se representa ni se calcula con `number` de JavaScript. Decisión registrada en `DEC-012` §26;
- `amount > 0` para todo tipo distinto de `OPENING_FLOAT`; el efecto usa `IN`/`OUT`, nunca signo ambiguo. `OPENING_FLOAT` admite `amount >= 0`: declara la base inicial del turno, y una caja puede abrirse sin efectivo. `UC-CASH-001` valida esa base como **no negativa** y sólo exige probar el rechazo de una base negativa; cero no introduce el signo ambiguo que la restricción general previene. Corrección registrada en `DEC-012` §23;
- moneda igual a CashShift y CashRegister;
- `UNIQUE (tenant_id, cash_shift_id, shift_sequence)`;
- `UNIQUE (tenant_id, origin_device_id, idempotency_key)`; una clave no se reutiliza entre operaciones de caja distintas;
- referencia tenant-scoped al turno y caja de la misma sucursal;
- un movimiento compensatorio referencia `original_cash_movement_id`, usa tipo correctivo y no actualiza el movimiento original;
- solo `POSTED` participa en ExpectedCash;
- un `POSTED` no se edita ni elimina;
- `REVERSED_BY_COMPENSATION` es una proyección derivada de un movimiento compensatorio `POSTED`; el estado persistido del original permanece `POSTED`;
- estados previos a `POSTED` cambian únicamente mediante transición autorizada, expected version, auditoría y outbox.

`ExpectedCash` no es tabla ni importe mutable del turno. Se obtiene mediante un fold decimal exacto y versionado de movimientos `POSTED` hasta `shift_sequence`, respetando dirección y política de tipos. El resultado congelado en un CashCount conserva corte, versión de política y checksum del cálculo.

Todos los importes lógicos usan precisión `(19,6)`: PostgreSQL `numeric(19,6)` y SQLite texto decimal canónico conforme a `physical-conventions.md`. No se usa `REAL`, `number` JavaScript ni suma SQL nativa sobre importes SQLite autoritativos.

## Arqueo

### `cash.cash_counts` / `cash_cash_counts`

Columnas lógicas: `id`, `tenant_id`, `company_id`, `branch_id`, `cash_register_id`, `cash_shift_id`, `count_type`, `status`, `blind_mode`, `started_shift_version`, `movement_cutoff_sequence`, `calculation_policy_version`, `calculation_checksum`, `expected_amount NULL`, `counted_amount NULL`, `difference_amount NULL`, `difference_type NULL`, `severity NULL`, `currency_code`, `denomination_breakdown_status`, `tolerance_policy_version`, `tolerance_policy_checksum`, `supersedes_cash_count_id NULL`, `started_by_actor_type`, `started_by_actor_id`, `started_at`, `completed_by_actor_type NULL`, `completed_by_actor_id NULL`, `completed_at NULL`, `aborted_by_actor_type NULL`, `aborted_by_actor_id NULL`, `aborted_at NULL`, `abort_reason_code NULL`, `origin_device_id`, `start_idempotency_key`, `start_request_checksum`, `completion_idempotency_key NULL`, `completion_request_checksum NULL`, `correlation_id`, `version`, `created_at`, `server_recorded_at NULL`.

Tipos:

- `PARTIAL`;
- `CLOSING`;
- `CORRECTION`.

Estados:

- `IN_PROGRESS`;
- `COMPLETED`;
- `ABORTED`.

Reglas:

1. Iniciar congela `started_shift_version` y `movement_cutoff_sequence`.
2. Completar exige expected version de CashCount y que CashShift permanezca en la versión capturada. Si hubo un movimiento durante el conteo, el mismo comando deja el CashCount `ABORTED` con motivo auditable y devuelve `CASH_VERSION_CONFLICT`; no compara efectivo físico contra un corte obsoleto.
3. En cierre, el turno pasa a `CLOSING` antes del conteo y bloquea operaciones incompatibles hasta commit o rollback.
4. `expected_amount` se calcula en dominio desde movimientos `POSTED` hasta el corte y se congela junto con versión/checksum de algoritmo.
5. En arqueo ciego, `expected_amount` no se expone al actor antes de `COMPLETED`; la persistencia no autoriza su lectura.
6. `denomination_breakdown_status` es `PROVIDED` o `NOT_PROVIDED`; `counted_amount` es la suma exacta de denominaciones cuando se informa el desglose. `NOT_PROVIDED` solo es válido si la política vigente permite conteo sin detalle.
7. `difference_amount = counted_amount - expected_amount`; `SHORTAGE`, `EXACT` y `OVERAGE` se derivan del signo.
8. Una tolerancia clasifica y exige acciones, pero nunca convierte una diferencia real en cero.
9. Un CashCount `COMPLETED` es inmutable.
10. Un conteo incorrecto crea CashCount `CORRECTION` mediante `supersedes_cash_count_id`; el original permanece y cada conteo puede tener como máximo un sucesor directo para formar una cadena lineal. La corrección hereda del conteo corregido turno, corte, expected_amount, moneda y versiones/checksums de cálculo y tolerancia; solo vuelve a capturar la evidencia física y recalcula la diferencia.
11. Corregir un conteo después de cerrar el turno no reemplaza el CashCount `CLOSING` original ni los importes históricos del cierre; crea revisión y, si corresponde, movimiento compensatorio separado.
12. Un CashCount no crea CashMovement automáticamente.
13. Toda diferencia distinta de cero crea exactamente una CashDifferenceReview; la severidad determina si basta revisión posterior o si el cierre exige autorización previa.
14. `COMPLETED` exige expected_amount, counted_amount, difference_amount, difference_type, completed_by y completed_at; `IN_PROGRESS` no publica un resultado parcial como confirmado.
15. `ABORTED` exige actor, instante y motivo; no contiene resultado confirmado, denominaciones finales ni Review y no puede volver a completarse.
16. expected_amount y counted_amount son `>= 0`; difference_amount admite signo porque expresa `counted - expected`.

Constraints de identidad:

- `UNIQUE (tenant_id, origin_device_id, start_idempotency_key)`;
- `UNIQUE (tenant_id, origin_device_id, completion_idempotency_key)` cuando existe;
- `UNIQUE (tenant_id, supersedes_cash_count_id)` cuando existe;
- `UNIQUE (tenant_id, cash_shift_id)` parcial para `count_type=CLOSING`;
- el conteo corregido pertenece al mismo tenant, caja, turno y moneda, está `COMPLETED` y el nuevo tipo es `CORRECTION`.

### `cash.cash_count_denominations` / `cash_cash_count_denominations`

Columnas lógicas: `id`, `tenant_id`, `cash_count_id`, `line_number`, `denomination_code`, `denomination_value`, `quantity`, `line_amount`, `currency_code`, `created_at`.

Constraints:

- `UNIQUE (tenant_id, cash_count_id, line_number)`;
- `UNIQUE (tenant_id, cash_count_id, denomination_code)` cuando la política no permite líneas repetidas;
- valor de denominación `> 0`, cantidad entera `> 0`;
- `line_amount = denomination_value * quantity` calculado con decimal exacto;
- `line_amount > 0`;
- moneda igual al CashCount;
- filas inmutables después de completar el conteo.

Cardinalidades:

- CashShift `1:N` CashCount;
- CashCount tiene `0:N` CashCountDenomination; `PROVIDED` exige al menos una línea y `NOT_PROVIDED` exige cero;
- cada CashCount referencia cero o un conteo corregido y puede tener cero o un sucesor directo, formando una cadena lineal;
- cada CashShift referencia cero o un CashCount de cierre y todo turno `CLOSED` referencia exactamente uno;
- cada CashCount `COMPLETED` con diferencia distinta de cero tiene exactamente una CashDifferenceReview; un conteo exacto puede tener cero o una si la política exige revisión.

## Diferencias y revisión

### `cash.cash_difference_reviews` / `cash_cash_difference_reviews`

Columnas lógicas: `id`, `tenant_id`, `company_id`, `branch_id`, `cash_shift_id`, `cash_count_id`, `status`, `severity`, `tolerance_policy_version`, `tolerance_policy_checksum`, `requires_segregation`, `created_at`, `resolved_at NULL`, `version`, `correlation_id`.

Estados:

- `REVIEW_REQUIRED`;
- `ACCEPTED`;
- `ESCALATED`;
- `RESOLVED`.

Constraints:

- `UNIQUE (tenant_id, cash_count_id)`;
- diferencia distinta de cero o política que exija revisión explícita;
- una diferencia material no permite cerrar CashShift sin acción autorizada conforme a política;
- el actor que contó no aprueba su propia diferencia crítica cuando `requires_segregation=true`;
- aceptar una diferencia no modifica CashCount ni crea un ajuste automático.

### `cash.cash_difference_review_actions` / `cash_cash_difference_review_actions`

Append-only: `id`, `tenant_id`, `cash_difference_review_id`, `action_type`, `from_status`, `to_status`, `reason_code`, `note NULL`, `evidence_reference NULL`, `actor_type`, `actor_id NULL`, `authorization_policy_version`, `idempotency_key`, `request_checksum`, `occurred_at`, `origin_device_id`, `created_at`, `server_recorded_at NULL`.

Acciones iniciales: `CREATED`, `ACCEPTED`, `ESCALATED`, `RESOLVED`.

Cada transición válida inserta una acción, actualiza la versión del Review, registra auditoría y outbox en una transacción. `UNIQUE (tenant_id, origin_device_id, idempotency_key)` impide duplicar la decisión. Las aprobaciones críticas sin autoridad offline vigente se mantienen `REVIEW_REQUIRED` o `ESCALATED`.

## Fronteras transaccionales

### Apertura

Dentro de un commit local:

1. valida turno incompatible;
2. reserva idempotencia/checksum;
3. crea CashShift `OPEN`;
4. crea CashMovement `OPENING_FLOAT` `POSTED` con `shift_sequence=1`;
5. actualiza secuencia/version del turno;
6. inserta auditoría y outbox.

### Movimiento POSTED

Validación de turno/version, asignación de secuencia, CashMovement, transición/version de CashShift, auditoría, resultado idempotente y outbox comparten commit. Un movimiento de venta o refund comparte además la frontera de su caso de uso propietario; Cash no duplica el agregado de Payment o Sale.

### Arqueo parcial

Iniciar CashCount y reservar su idempotencia comparten commit. Completar valida la versión capturada y, en otro commit atómico, congela esperado/corte, inserta denominaciones, calcula contado/diferencia, crea Review/acción inicial ante toda diferencia, registra auditoría y outbox. Si la versión cambió, ese commit marca el conteo `ABORTED`, audita el motivo y emite outbox sin publicar importes de un corte inválido. No cambia el estado del turno ni crea movimiento.

### Cierre

En una sola transacción local:

1. obtiene lock o expected version y cambia CashShift `OPEN -> CLOSING`;
2. bloquea operaciones incompatibles;
3. reserva idempotencia/checksum de cierre;
4. congela el corte y calcula ExpectedCash;
5. crea CashCount `CLOSING` `COMPLETED` y denominaciones;
6. calcula y conserva diferencia/tolerancia;
7. crea Review ante toda diferencia y la acción requerida; valida la referencia de aprobación y la segregación cuando la diferencia es material;
8. valida la unicidad del conteo de cierre;
9. cambia CashShift `CLOSING -> CLOSED`;
10. registra auditoría, resultado idempotente y outbox;
11. confirma un único commit.

Una falla revierte cierre, conteo y evidencia completa. Un reintento devuelve el mismo cierre.

### Corrección y compensación

La corrección crea un CashCount `CORRECTION`, denominaciones y Review nuevos relacionados con el conteo original, reutilizando exactamente su corte, esperado, moneda y políticas versionadas. Si se autoriza corregir un efecto financiero, el CashMovement compensatorio se confirma en su propia frontera referenciando conteo/revisión y movimiento original. Nunca se sobrescribe conteo, cierre o movimiento previo.

## Aceptación central y operaciones tardías

Inbox, validación tenant-scoped y efectos aceptados comparten transacción PostgreSQL. Un duplicado exacto retorna el resultado conocido. Un turno ya cerrado centralmente, una versión incompatible o una operación tardía genera incidencia/revisión; no se inserta silenciosamente en la secuencia cerrada ni se recalcula el CashCount histórico.

## Eventos

- iniciar conteo: `CashCountStarted`;
- completar conteo: `CashCountCompleted`;
- invalidar o abandonar conteo: `CashCountAborted`;
- detectar diferencia: `CashDifferenceDetected`;
- aceptar diferencia: `CashDifferenceAccepted`;
- escalar diferencia: `CashDifferenceEscalated`;
- solicitar cierre: `CashShiftClosingRequested`;
- cerrar turno: `CashShiftClosed`.

Las transiciones internas de CashMovement pueden emitir sus eventos específicos. `CashMovementRecorded` es el evento de integración que comunica una única incorporación `POSTED` al efectivo esperado; no sustituye el historial de transición ni se emite para estados no publicados.

## Importación desde fuentes externas

Una fuente externa solo puede importarse cuando distingue inequívocamente turno y snapshot de cierre y aporta tenant, empresa, sucursal, dispositivo, moneda explícita, idempotencia, secuencia, aprobación y referencias robustas.

Mapeo permitido con reconciliación:

- un registro de turno coherente puede producir CashShift histórico;
- un registro de movimiento de efectivo puede producir CashMovement histórico, preservando tipo, importe, usuario y timestamp;
- el importe de apertura se reconcilia con su movimiento de origen para evitar duplicar la base;
- un cierre externo puede producir CashCount `CLOSING` histórico solo si los importes contado, esperado y de diferencia satisfacen exactamente la fórmula;
- una diferencia histórica distinta de cero crea Review `REVIEW_REQUIRED`; no se infiere aceptación, resolución ni aprobador;
- ausencia de denominaciones, políticas, aprobadores o evidencias se conserva como no disponible.

No se infieren arqueos parciales, arqueo ciego, versiones corregidas, tolerancias, aprobaciones, incidencias, dispositivo, moneda o secuencias inexistentes. Turnos incoherentes, múltiples aperturas incompatibles, movimientos huérfanos y fórmulas de cierre inválidas se llevan a revisión/cuarentena.

## Pruebas obligatorias

1. apertura concurrente no crea turnos incompatibles;
2. base inicial produce un solo movimiento de apertura;
3. movimiento POSTED cambia ExpectedCash y aumenta secuencia/version;
4. movimiento no POSTED no afecta ExpectedCash;
5. reintento no duplica movimiento;
6. importe cero, signo ambiguo o moneda distinta se rechazan;
7. arqueo parcial no cierra turno ni crea movimiento;
8. movimiento durante conteo produce conflicto de versión;
9. arqueo ciego no revela esperado antes de completar;
10. denominaciones suman exactamente counted_amount;
11. conteo sin desglose solo funciona si la política lo permite;
12. diferencia negativa, cero y positiva se clasifican correctamente;
13. tolerancia no borra diferencia;
14. diferencia crítica sin aprobación bloquea cierre;
15. actor no aprueba su diferencia crítica cuando hay segregación;
16. cierre guarda un único CashCount de cierre y es idempotente;
17. crash antes del commit no deja turno CLOSING ni conteo parcial confirmado;
18. corrección crea nuevo CashCount y conserva original;
19. corrección posterior al cierre no reescribe cierre;
20. compensación crea movimiento nuevo y conserva el original;
21. operación tardía no reabre ni recalcula el turno silenciosamente;
22. sync duplicado no reaplica movimientos, conteos o decisiones;
23. aislamiento tenant/company/branch/register/shift;
24. decimales exactos equivalentes en PostgreSQL y SQLite;
25. reconstrucción de ExpectedCash desde movimientos y corte;
26. una importación externa reconcilia base y fórmula de cierre sin inventar denominaciones.
27. conflicto de versión deja el conteo `ABORTED` sin resultado confirmado y permite iniciar otro conteo.
28. corrección reutiliza corte, esperado y políticas del conteo original sin recalcular el cierre.

## Condición de cierre

`PHY-G07` queda cerrado tras confirmar transversalmente que modelo conceptual, eventos, permisos, migración, trazabilidad, UC-CASH-002, UC-CASH-003, DEC-002 y DEC-007 usan estas identidades y reglas sin contradicciones.

Al cerrar `PHY-G07` no se inició `PHY-G08` ni se autorizó DDL o migraciones; en ese corte la primera migración conservó su gate independiente `NO-GO`. Su estado vigente se registra en `traceability.md` y `../../product/backlog.md`.
