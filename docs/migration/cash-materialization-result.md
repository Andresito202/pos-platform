# Cash — resultado de materialización física (Bloque 22)

## 1. Autorización y alcance

- **Autorización**: owner autorizó explícitamente, en sesión, "MATERIALIZAR CASH" — alcance limitado a Cash (CASH-001/002/003), sin tocar Sales/Payments/Fiscal/Customer/UI/API/Auth/Sync/Device-identity ni las migraciones 001-005.
- **Fecha**: 2026-09-02.
- **Rama**: `domain/cash-open-vertical-20260901`.
- **Decisiones intermedias resueltas por el owner en este bloque** (ver §5): extender `OpenCashShiftCommand`/`save()` con `businessDate`/`timezoneId`/`utcOffsetMinutes`/`currencyCode` en vez de fabricar valores o bloquear el bloque.

## 2. Qué se materializó realmente

### DDL / migración

- `MIGRATION_006` en `packages/database-sqlite/src/local-database.ts`, versión **6** del ledger existente (`local_schema_migrations`) — extiende la infraestructura ya establecida, no crea un sistema de migraciones paralelo (per `cash-physical-design.md` §5, "Único escritor: POS Local Service", el mismo servicio dueño de este archivo).
- Checksum SHA-256 de `MIGRATION_006`: `9c8f0c5fa816bb476750c8acb5cfaf6bb024c0425d897900cb5cd96abeea897e`.
- 7 tablas creadas: `cash_registers`, `cash_shifts`, `cash_movements`, `cash_counts`, `cash_count_denominations`, `cash_difference_reviews`, `cash_difference_review_actions` — todas `STRICT`, todas con `CHECK` de longitud de UUID donde aplica, montos/decimales como `TEXT` canónico (nunca `REAL`), signo verificado con `substr(x,1,1) != '-'` en vez de comparación numérica (una comparación `amount > 0` sobre una columna `TEXT` es vacuamente verdadera en SQLite por sus reglas de type-affinity — verificado contra una base real, no asumido).
- FKs compuestas de 4 columnas `(tenant_id, company_id, branch_id, x_id)` donde aplica, siguiendo el patrón ya establecido en `physical-conventions.md`.
- Índices parciales: `cash_shifts_incompatible_idx` (turno OPEN/CLOSING incompatible) y `cash_counts_one_completed_closing_idx` (un solo CashCount CLOSING COMPLETED por turno, corregido en Bloque 14 con `AND status='COMPLETED'`).
- Triggers append-only en `cash_movements` y `cash_difference_review_actions`.

**Correcciones encontradas y aplicadas durante la materialización** (auditando la SQL contra `cash-counting-schema.md`, la fuente lógica cerrada `PHY-G07`, columna por columna — no asumiendo que un borrador previo del Bloque 22 era correcto):

- `cash_shifts.opening_amount` **eliminado**: la regla 1 del schema lógico prohíbe explícitamente una segunda autoridad mutable para el monto de apertura ("la base inicial se deriva de [la CashMovement OPENING_FLOAT] y no tiene una segunda autoridad mutable"). El adaptador deriva `openingAmount` leyendo el movimiento `shift_sequence = 1` del turno.
- `cash_movements.device_reported_at` **agregado** — columna completa, ausente en el borrador previo.
- Nullability corregida contra las anotaciones explícitas del schema lógico (`NULL` presente = nullable, ausente = requerido, convención usada consistentemente en el documento): `cash_movements.actor_id` (ahora nullable), `cash_movements.reason_code`/`correlation_id`, `cash_counts.calculation_policy_version`/`calculation_checksum`/`tolerance_policy_version`/`tolerance_policy_checksum`/`correlation_id`, `cash_difference_reviews.severity`/`tolerance_policy_version`/`tolerance_policy_checksum`/`correlation_id`, `cash_difference_review_actions.reason_code`/`authorization_policy_version` (todas ahora `NOT NULL`).

### Adapter

- `packages/database-sqlite/src/cash-shift-repository.ts` — `SqliteCashShiftRepository implements CashShiftRepository`, `better-sqlite3` crudo con prepared statements (mismo patrón ya establecido en el paquete; `kysely` sigue sin usarse en ningún adapter real de este repositorio pese a estar declarado como dependencia).
- **Implementado de verdad** (CASH-001, OPEN): `hasIncompatibleOpenShift`, `findOpenByIdempotencyKey`, `save`, `findById`, `listPostedMovements`, `nextMovementSequence`.
- **NO implementado, deliberadamente** (interfaz cumplida, cada método lanza un error explícito y descriptivo en vez de insertar datos inventados): `findMovementByIdempotencyKey`, `saveMovement` (CASH-003), `findCloseByIdempotencyKey`, `saveClose` (CASH-002). Motivo: ni `RegisterCashMovementCommand` ni un comando de cierre cargan hoy el bookkeeping físico que `cash_movements`/`cash_counts`/`cash_difference_reviews` exigen `NOT NULL` (currency_code, business_date, reason_code, correlation_id, calculation/tolerance policy version+checksum...) — inventar esos valores habría violado la regla de no fabricación. Esto es un gap real y documentado, no fue "olvidado".

### Application layer (extensiones necesarias para materializar, no scope creep)

- `OpenCashShiftCommand` ganó `businessDate`, `timezoneId`, `utcOffsetMinutes`, `currencyCode` — decisión del owner en este bloque (ver §5), no una inferencia.
- `CashShiftRepository.save()` ganó el parámetro `physicalContext: CashShiftPhysicalContext`.
- Dos nuevos tipos de error en el puerto, ambos cerrando brechas de concurrencia física genuinas (ver §4): `IdempotencyKeyConflictError` (ya existía desde el trabajo previo a este documento) e `IncompatibleShiftOpenConflictError` (nuevo, descubierto ejecutando la prueba de concurrencia real contra SQLite — ver §4).
- `OpenCashShiftUseCase.execute()` captura ambos errores y re-ejecuta la misma decisión de replay/conflicto ya existente; solo cuando esa relectura no resuelve nada (la colisión no fue sobre nuestra propia clave) devuelve `INCOMPATIBLE_SHIFT_OPEN`.

### Domain layer

- `restore()` agregado a `CashShift`, `CashMovement`, `CashCount`, `CashDifferenceReview`, y `Actor.restore(type, id)` — únicamente para reconstrucción desde una fila persistida, sin re-validar invariantes (ya se cumplieron cuando el dato se creó). Uso exclusivo de adapters.

## 3. Qué NO se materializó (honesto, no una brecha oculta)

- **PostgreSQL: NOT EXECUTED — BLOCKED BY ENVIRONMENT.** Confirmado en el Bloque 20: `ECONNREFUSED 127.0.0.1:55432`, sin servidor Postgres disponible en este entorno. No se escribió DDL "de diseño" sin ejecutar como si fuera equivalente a materializar — el estado real es que Cash en PostgreSQL sigue `DESIGNED, NOT MATERIALIZED`.
- **CASH-002 (cierre) / CASH-003 (movimientos)**: puerto cumplido a nivel de interfaz, sin persistencia real (ver §2, adapter). `RegisterCashMovementUseCase`/close use case no fueron tocados — su propio comentario de código ya documentaba, antes de este bloque, que "Moneda" y "requiere aprobación" son gaps identificados, no inferidos aquí.
- **`hasIncompatibleOpenShift` sin considerar `originDeviceId` en su primera forma histórica** — ya corregido en bloques anteriores; no es un pendiente de este bloque.
- **Device/Register semantics** (si un dispositivo distinto puede abrir el mismo registro) — sigue sin resolverse, per las reglas de este bloque ("no resolver Device/Register semantics por inferencia"). No se tocó.

## 4. Concurrencia — dos brechas físicas cerradas, ambas probadas contra SQLite real (no simuladas)

1. **`opening_idempotency_key`** (ya anticipada en Bloques 17-19): dos requests concurrentes con la misma clave pueden pasar el lookup en memoria antes de que cualquiera confirme. El `UNIQUE(tenant_id, origin_device_id, opening_idempotency_key)` físico lo detecta al `INSERT`; el adaptador lo traduce a `IdempotencyKeyConflictError`.
2. **`cash_shifts_incompatible_idx`** (descubierta en este bloque, no anticipada): el mismo tipo de carrera sobre la OTRA constraint UNIQUE de `cash_shifts` (tenant, branch, register, device, `status IN ('OPEN','CLOSING')`) — la prueba de concurrencia real la disparó en la primera ejecución. Cuál de las dos constraints reporta SQLite primero es un detalle de implementación no determinista desde el punto de vista del llamador, así que `OpenCashShiftUseCase` trata ambos errores igual: siempre re-intenta el lookup de idempotencia primero (autoritativo si resuelve), y solo cae a `INCOMPATIBLE_SHIFT_OPEN` si esa relectura no encuentra nada.

Ambas se probaron con `Promise.all` de dos `OpenCashShiftUseCase.execute()` reales contra el MISMO archivo SQLite (no contra el fake en memoria) — ver `packages/database-sqlite/tests/cash-shift-repository.test.ts`, prueba "real concurrency". Resultado verificado: exactamente una fila física en `cash_shifts`, exactamente una en `cash_movements`, un resultado `OPENED` y un `ALREADY_OPENED` apuntando al mismo turno.

## 5. Decisión del owner tomada en este bloque

`cash_shifts`/`cash_movements` requieren `business_date`, `timezone_id`, `utc_offset_minutes`, `currency_code` (`NOT NULL`) que ningún objeto de dominio ni comando cargaba. Se presentaron tres opciones (extender el comando ahora / config a nivel de adapter / bloquear el bloque); el owner eligió **extender `OpenCashShiftCommand` ahora**. Aplicado exactamente como se planteó, sin ampliar el alcance a CASH-002/003.

## 6. Pruebas ejecutadas (todas reales, contra archivos SQLite físicos vía `mkdtemp`)

`packages/database-sqlite/tests/cash-shift-repository.test.ts` (10 pruebas nuevas) + `packages/database-sqlite/tests/local-database.test.ts` (11 preexistentes, sin modificar) = **21/21 PASS**:

- Round-trip completo (Money, IDs, scope, actor, version, timestamps, estado sobreviven exactos).
- Replay (misma clave + mismo payload → `ALREADY_OPENED`, una sola fila física).
- Conflicto (misma clave + payload distinto → `IDEMPOTENCY_CONFLICT`, una sola fila física).
- Concurrencia real (dos `execute()` genuinamente concurrentes, ver §4).
- Turno incompatible (segundo intento en el mismo tenant/branch/register/device rechazado).
- Aislamiento de tenant (`findById`/`hasIncompatibleOpenShift` bajo otro tenant no ven nada).
- Introspección de esquema (7 tablas `cash_*` exactas, `opening_amount` confirmado ausente, `device_reported_at` confirmado `NOT NULL`, `actor_id` confirmado nullable).
- Ledger de migración (versión 6 presente con checksum real de 64 hex, versiones 1-5 intactas).
- Rollback (una transacción DDL multi-statement que falla a mitad de camino no deja estado parcial — mismo mecanismo `native.transaction(...)` que usa `applyMigrations()`).
- Reapply (cerrar y reabrir el mismo archivo de base de datos es idempotente: sin filas de ledger duplicadas, mismos datos al releer).

Regresión completa ejecutada tras los cambios:

- `pnpm --filter @pos-platform/domain test` → 104/104 PASS.
- `pnpm --filter @pos-platform/application test` → 102/102 PASS (incluye la prueba de concurrencia M, reforzada en este bloque para exigir exactamente un `OPENED`/un `ALREADY_OPENED`, ya no solo "ninguno de los dos truena").
- `pnpm --filter @pos-platform/database-sqlite test` → 21/21 PASS.
- `pnpm -w typecheck` → limpio en los 7 proyectos del workspace.
- `pnpm run architecture:check` → `ARCH-003 boundary validation PASS`, ejecutado sin caché de Nx (`Cache: 0/1 hit`).

## 7. Gobernanza final

```text
DDL: MATERIALIZED — CASH ONLY (SQLite)
SQL: MATERIALIZED — CASH ONLY (SQLite)
MIGRATIONS: MATERIALIZED — CASH ONLY (SQLite, version 6)
POSTGRESQL: NOT EXECUTED — BLOCKED BY ENVIRONMENT
GO_AUTHORIZED: YES — CASH ONLY
```

BLOCKER: 0. MAJOR: 0.

Alcance real: apertura de turno (CASH-001) físicamente probada de extremo a extremo contra SQLite, incluida concurrencia real. Cierre (CASH-002) y movimientos (CASH-003) permanecen a nivel de puerto/interfaz, sin persistencia física — deferred, documentado en §3, no fabricado.
