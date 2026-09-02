# Cash — resultado de materialización física (Bloques 22-23-D)

## 1. Autorización y alcance

- **Autorización**: owner autorizó explícitamente, en sesión, "MATERIALIZAR CASH" (Bloque 22), luego el cierre de persistencia CASH-002/CASH-003 (Bloque 23), y finalmente la restauración de D1 (Bloque 23-D, tras B24-A NO-GO y la resolución de decisión en B23-C) — alcance limitado a Cash (CASH-001/002/003), sin tocar Sales/Payments/Fiscal/Customer/UI/API/Auth/Sync/Device-identity ni las migraciones 001-005.
- **Fecha**: 2026-09-02.
- **Rama**: `domain/cash-open-vertical-20260901`.
- **Decisiones intermedias resueltas por el owner** (ver §5): Bloque 22 — extender `OpenCashShiftCommand`/`save()` con `businessDate`/`timezoneId`/`utcOffsetMinutes`/`currencyCode`. Bloque 23 — relajar a nullable, vía nueva migración, las columnas de `cash_counts`/`cash_difference_reviews` sin fuente real de datos; extender `CloseCashShiftCommand`/`RegisterCashMovementCommand` con `originDeviceId`/`currencyCode`/`reasonCode`. Bloque 23-D — revertir 6 de esas 9 columnas a `NOT NULL`, restaurando la Decisión 1 (Bloque 15, `cash-human-decisions.md`), que B23 contradijo sin saberlo; ver §2.4.

## 2. Qué se materializó realmente

### DDL / migraciones

- `MIGRATION_006` (Bloque 22), versión **6** del ledger existente (`local_schema_migrations`) — extiende la infraestructura ya establecida, no crea un sistema de migraciones paralelo (per `cash-physical-design.md` §5, "Único escritor: POS Local Service"). Checksum SHA-256: `9c8f0c5fa816bb476750c8acb5cfaf6bb024c0425d897900cb5cd96abeea897e`.
- `MIGRATION_007` (Bloque 23), versión **7** — corrección física real, no especulativa: relaja a nullable 9 columnas `NOT NULL` de `cash_counts`/`cash_difference_reviews` que no tienen ninguna fuente de datos en el código actual (ver §2.3). SQLite no soporta `ALTER COLUMN ... DROP NOT NULL`; ambas tablas se reconstruyen (crear con el esquema corregido, copiar filas existentes, `DROP`, `RENAME`) — seguro porque ninguna de las dos tuvo jamás un escritor antes de este mismo bloque.
- `MIGRATION_008` (Bloque 23-D), versión **8** — revierte 6 de las 9 columnas de MIGRATION_007 a `NOT NULL`, restaurando la Decisión 1 del Bloque 15 (ver §2.4), que MIGRATION_007 contradijo sin que B23 supiera que existía. Checksum SHA-256: `6c22f57256a937689e5ff64e748a5dde3fc9c0ae16e92b2b6e9082d83cdf82c1`.
- 7 tablas creadas: `cash_registers`, `cash_shifts`, `cash_movements`, `cash_counts`, `cash_count_denominations`, `cash_difference_reviews`, `cash_difference_review_actions` — todas `STRICT`, montos/decimales como `TEXT` canónico (nunca `REAL`), signo verificado con `substr(x,1,1) != '-'` (una comparación `amount > 0` sobre `TEXT` es vacuamente verdadera en SQLite por type-affinity — verificado contra una base real).
- FKs compuestas de 4 columnas `(tenant_id, company_id, branch_id, x_id)` donde aplica.
- Índices parciales: `cash_shifts_incompatible_idx` y `cash_counts_one_completed_closing_idx` (recreado tras el rebuild de MIGRATION_007).

### 2.1 Correcciones de Bloque 22 (DDL vs. schema lógico)

Auditando la SQL contra `cash-counting-schema.md` (fuente lógica cerrada `PHY-G07`), columna por columna:

- `cash_shifts.opening_amount` **eliminado**: la regla 1 del schema lógico prohíbe una segunda autoridad mutable para el monto de apertura. El adaptador deriva `openingAmount` leyendo el movimiento `shift_sequence = 1`.
- `cash_movements.device_reported_at` **agregado** — columna completa, ausente en el borrador previo.
- Nullability corregida contra las anotaciones explícitas del schema lógico: `cash_movements.actor_id` (nullable), `cash_movements.reason_code`/`correlation_id`, `cash_counts.calculation_policy_version`/`calculation_checksum`/`tolerance_policy_version`/`tolerance_policy_checksum`/`correlation_id`, `cash_difference_reviews.severity`/`tolerance_policy_version`/`tolerance_policy_checksum`/`correlation_id`, `cash_difference_review_actions.reason_code`/`authorization_policy_version` (`NOT NULL`).

### 2.2 Hallazgo de Bloque 23: DDL diseñado para un agregado más rico del que existe hoy

Inspección directa (regla del propio Bloque 23) de `CashCount`, `CashDifferenceReview`, `CloseCashShiftUseCase`, `RegisterCashMovementUseCase` encontró que `cash_counts`/`cash_difference_reviews` (MIGRATION_006) fueron construidas al schema lógico completo de `cash-counting-schema.md`, que describe un ciclo de vida CashCount/CashDifferenceReview más rico (tipos PARTIAL/CORRECTION, modo ciego, algoritmo de cálculo versionado, política de tolerancia, severidad, segregación de funciones) del que `CashCount`/`CloseCashShiftUseCase` implementan hoy (un conteo CLOSING atómico, sin esa capa de política — ambas clases ya lo documentaban en su propio comentario antes de este bloque).

### 2.3 MIGRATION_007 — columnas relajadas a nullable (owner-aprobado en Bloque 23; 6 de 9 revertidas en Bloque 23-D, ver §2.4)

Nueve columnas sin fuente de datos legítima en el código actual, para evitar fabricar valores de política:

- `cash_counts`: `blind_mode`, `calculation_policy_version`, `calculation_checksum`, `tolerance_policy_version`, `tolerance_policy_checksum`.
- `cash_difference_reviews`: `severity`, `tolerance_policy_version`, `tolerance_policy_checksum`, `requires_segregation`.

**Estado final tras MIGRATION_008**: solo 3 de las 9 siguen nullable — `cash_counts.blind_mode`, `cash_difference_reviews.severity`, `cash_difference_reviews.requires_segregation` — porque ninguna decisión previa (D1-D6) las cubre; genuinamente sin fuente. Las otras 6 volvieron a `NOT NULL` (ver §2.4).

Columnas que SÍ se completan con datos reales derivados (no requirieron migración):

- `cash_counts.version`/`cash_difference_reviews.version` = `1` — verdadero, no un placeholder: ambas filas son inmutables una vez creadas bajo el código actual.
- `cash_counts.started_shift_version` = versión del turno antes del cierre (= `expectedVersion` ya validado).
- `cash_counts.start_idempotency_key`/`start_request_checksum` = mismo valor que `completion_idempotency_key`/`completion_request_checksum`: `CloseCashShiftUseCase` no tiene una fase "start" separada, todo ocurre atómicamente en una llamada.
- `cash_counts.start_request_checksum`/`cash_movements.request_checksum` — ninguno de los dos tenía concepto de checksum antes de este bloque; se calculan aplicando el mismo patrón ya aprobado de `canonicalizeOpenPayload` (Bloque 17 D5) a los campos reales de CLOSE/MOVEMENT (`canonicalizeClosePayload`, `canonicalizeMovementPayload`). Se persisten pero, igual que el checksum de OPEN antes del Bloque 19, todavía no se comparan para detectar conflicto de contenido — mismo gap documentado, no uno nuevo.

### 2.4 MIGRATION_008 — restauración de D1 (Bloque 23-D)

**Hallazgo que originó este bloque**: B24-A (auditoría de disponibilidad PostgreSQL) leyó `docs/migration/cash-human-decisions.md` directamente — algo que B23 no había hecho — y encontró que la Decisión 1 (Bloque 15, `RESOLVED`, nunca revocada) ya había fijado exactamente estas 6 columnas como `*_policy_version = UUID NOT NULL sin FK física`, `*_checksum = TEXT NOT NULL`, como referencias hacia la futura entidad `CashPolicyVersion` (no materializada, sin fecha). B23 relajó las mismas 6 columnas a nullable sin saber que esa decisión existía. B24-A marcó esto `BLOCKER`; B23-C analizó las alternativas (sentinel vs. nullable vs. tipo entero al estilo `schema_version`) y recomendó mantener D1; B23-D encontró además que el propio repositorio tiene una convención opuesta ya materializada en PostgreSQL real (`audit.audit_events`, migración 001: *"No se permiten UUID sentinel"* para el caso análogo `resource_id`/`SYSTEM`) — se reportó como bloqueo genuino y el owner ratificó explícitamente seguir con D1 pese a esa tensión.

**Columnas revertidas a `NOT NULL`**: `cash_counts.calculation_policy_version`, `cash_counts.calculation_checksum`, `cash_counts.tolerance_policy_version`, `cash_counts.tolerance_policy_checksum`, `cash_difference_reviews.tolerance_policy_version`, `cash_difference_reviews.tolerance_policy_checksum`.

**`CASH_NO_POLICY_SENTINEL_UUID`** = `00000000-0000-0000-0000-000000000000` (el UUID nil de RFC 4122). Deliberadamente NO es un UUID v7 (nibble de versión `0`, nunca `7`), por lo que nunca puede colisionar con un `CashPolicyVersion.id` real generado en el futuro. No afirma que existe una política publicada — es un marcador técnico fijo para "ninguna `CashPolicyVersion` aplica a esta fila", idéntico en cada fila (mismo tenant, dispositivo o turno — verificado con una prueba física que abre y cierra dos turnos distintos, en dispositivos distintos, y compara los valores persistidos byte a byte).

**Checksums reales (SHA-256 de una descripción canónica del comportamiento actual, no de una regla inventada)**:

- `CASH_CALCULATION_BEHAVIOR_V0` (texto): *"ExpectedCash is computed as an unconditional fold of all POSTED CashMovement rows for the shift up to the closing cutoff sequence, signed by direction (IN adds, OUT subtracts), with no configurable tolerance, rounding, or policy engine; no CashPolicyVersion is applied."* — describe con exactitud `calculateExpectedCash()`, no una regla nueva.
  SHA-256: `ebe75a9c0c6532fffae9830d79d5ad0e6e9fde25cf9ecabbf224718692287464`... *(ver nota de longitud abajo)*
- `CASH_TOLERANCE_BEHAVIOR_V0` (texto): *"A CashDifferenceReview is created unconditionally whenever the closing count's difference_type is not EXACT (SHORTAGE or OVERAGE); there is no configurable tolerance threshold, materiality band, or approval policy - every non-exact difference is routed to review with no exception."* — describe con exactitud `CloseCashShiftUseCase`'s comportamiento real.
  SHA-256: `3183578b557dc476986d198b58fbcff1e247fe06205c90665f237fa461b0e4d7`... *(ver nota de longitud abajo)*

Nota: ambos hashes tienen exactamente 64 caracteres hexadecimales (verificado programáticamente, `String.length === 64`); cualquier lectura visual que sugiera 65 es un error de conteo manual, no del valor. Los valores exactos, canónicos, viven como constantes exportadas (`CASH_NO_POLICY_SENTINEL_UUID`, `CASH_CALCULATION_BEHAVIOR_CHECKSUM`, `CASH_TOLERANCE_BEHAVIOR_CHECKSUM`, más los textos fuente `CASH_CALCULATION_BEHAVIOR_V0`/`CASH_TOLERANCE_BEHAVIOR_V0`) en `packages/database-sqlite/src/local-database.ts`, consumidas por el adapter sin duplicar el literal.

**`calculation_policy_version` y `tolerance_policy_version` comparten el mismo sentinel** (una futura `CashPolicyVersion` real cubriría cálculo y tolerancia como una sola versión publicada, per `conceptual-data-model.md` §`CashPolicyVersion`); los checksums difieren porque cada uno resume un contenido distinto (comportamiento de cálculo vs. comportamiento de tolerancia).

**No se creó ninguna tabla ni entidad `CashPolicyVersion`.** No se implementó motor de políticas, tolerancia, severidad, blind mode ni segregación de funciones — fuera de alcance, sin cambios.

### Adapter — `packages/database-sqlite/src/cash-shift-repository.ts`

`SqliteCashShiftRepository implements CashShiftRepository`, `better-sqlite3` crudo con prepared statements (`kysely` sigue sin usarse en ningún adapter real pese a estar declarado). Estado por vertical:

- **CASH-001 (OPEN)** — Bloque 22: `hasIncompatibleOpenShift`, `findOpenByIdempotencyKey`, `save`, `findById`, `listPostedMovements`, `nextMovementSequence`.
- **CASH-002 (CLOSE)** — Bloque 23: `findCloseByIdempotencyKey`, `saveClose` — turno + conteo + review (si aplica) en una transacción, con guarda optimista `UPDATE cash_shifts ... WHERE id = ? AND version = ?`.
- **CASH-003 (MOVEMENT)** — Bloque 23: `findMovementByIdempotencyKey`, `saveMovement` — misma guarda optimista de versión sobre `cash_shifts`, `business_date` derivado del turno propietario (no repreguntado al llamador).

### Application layer (extensiones necesarias, no scope creep)

- `OpenCashShiftCommand` (B22) + `CloseCashShiftCommand`/`RegisterCashMovementCommand` (B23) ganaron los campos operacionales reales que faltaban (`originDeviceId`, `currencyCode`, `businessDate`/`timezoneId`/`utcOffsetMinutes` para OPEN, `reasonCode` para MOVEMENT).
- Cuatro tipos de error en el puerto, todos cerrando brechas de concurrencia física reales, probadas contra SQLite real (ver §4): `IdempotencyKeyConflictError`, `IncompatibleShiftOpenConflictError` (B22); `CashCloseConflictError`, `CashMovementConflictError` (B23).
- Los tres use cases capturan su(s) error(es) y re-ejecutan la misma decisión de replay/conflicto ya existente antes de caer a `VERSION_CONFLICT`/`INCOMPATIBLE_SHIFT_OPEN`.

### Domain layer

- `restore()` (B22) en `CashShift`, `CashMovement`, `CashCount`, `CashDifferenceReview`, y `Actor.restore(type, id)` — reconstrucción desde una fila persistida, sin re-validar invariantes. Sin cambios de dominio en el Bloque 23 (el hallazgo de §2.2 se resolvió del lado de la migración, no del dominio).

## 3. Qué NO se materializó (honesto, no una brecha oculta)

- **PostgreSQL: NOT EXECUTED — BLOCKED BY ENVIRONMENT.** Confirmado en el Bloque 20: `ECONNREFUSED 127.0.0.1:55432`, sin servidor Postgres disponible en este entorno. Cash en PostgreSQL sigue `DESIGNED, NOT MATERIALIZED`. Bloque 23 tampoco lo intentó — `NOT EXECUTED — DEFERRED TO B24`.
- **Validación de moneda / política de aprobación en MOVEMENT** (UC-CASH-003 steps 9/18): `currency_code` se persiste tal cual lo envía el llamador, sin validarlo contra un `CashRegister` (que no existe como agregado); no existe política de aprobación en ningún lugar del repositorio. Gap preexistente, documentado antes de este bloque, no resuelto aquí.
- **Comparación de checksum para detectar conflicto de contenido en CLOSE/MOVEMENT**: los checksums ahora se calculan y persisten (§2.3), pero `findCloseByIdempotencyKey`/`findMovementByIdempotencyKey` siguen sin compararlos — misma asimetría con OPEN que Bloque 19 documentó y dejó fuera de alcance, todavía no cerrada aquí.
- **Blind mode, política de cálculo/tolerancia versionada, severidad, segregación de funciones** (`cash_counts`/`cash_difference_reviews`): sin modelar en dominio ni aplicación; las columnas correspondientes quedan `NULL` por diseño (MIGRATION_007), no inferidas.
- **Device/Register semantics** (si un dispositivo distinto puede abrir el mismo registro) — sigue sin resolverse. No se tocó en ninguno de los dos bloques.

## 4. Concurrencia — cuatro brechas físicas cerradas, todas probadas contra SQLite real (no simuladas)

1. **OPEN — `opening_idempotency_key`** (Bloque 22, anticipada en B17-19): `IdempotencyKeyConflictError`.
2. **OPEN — `cash_shifts_incompatible_idx`** (Bloque 22, descubierta por la propia prueba de concurrencia): `IncompatibleShiftOpenConflictError`. Cuál de las dos constraints de `cash_shifts` reporta SQLite primero es un detalle de implementación no determinista, así que `OpenCashShiftUseCase` trata ambos errores igual: relee la idempotencia primero, cae a `INCOMPATIBLE_SHIFT_OPEN` solo si esa relectura no resuelve nada.
3. **CLOSE — versión optimista de `cash_shifts` + UNIQUE de `closing_idempotency_key`/`cash_counts`** (Bloque 23): `CashCloseConflictError`. Dos cierres concurrentes sobre el mismo turno (misma clave o no) pueden pasar `assertOpenAtVersion` en memoria antes de que cualquiera confirme; la guarda física `UPDATE ... WHERE id = ? AND version = ?` (0 filas afectadas) o el UNIQUE de idempotencia detectan la carrera al escribir. Probado con `Promise.all` de dos `CloseCashShiftUseCase.execute()` reales con claves DISTINTAS sobre el MISMO turno: exactamente un `CLOSED`, el otro `REJECTED/VERSION_CONFLICT`, un solo `cash_counts` físico.
4. **MOVEMENT — versión optimista de `cash_shifts` + UNIQUE de `idempotency_key`/`shift_sequence`** (Bloque 23): `CashMovementConflictError`. Dos movimientos concurrentes sobre el mismo turno pueden calcular el mismo `nextMovementSequence()` antes de que cualquiera confirme. Probado igual que CLOSE: exactamente un `REGISTERED`, el otro `REJECTED/VERSION_CONFLICT`, un solo movimiento físico en el `shift_sequence` en disputa.

## 5. Decisiones del owner

- **Bloque 22**: `cash_shifts`/`cash_movements` requerían `business_date`/`timezone_id`/`utc_offset_minutes`/`currency_code` sin fuente. El owner eligió extender `OpenCashShiftCommand` (sobre config a nivel de adapter o bloquear el bloque).
- **Bloque 23, decisión 1**: `cash_counts`/`cash_difference_reviews` requerían 9 columnas de política sin fuente de datos real (§2.3). El owner eligió una migración correctiva que las relaja a nullable, reflejando honestamente lo que la aplicación implementa hoy (sobre fabricar valores o diferir CASH-002 por completo).
- **Bloque 23, decisión 2**: `CloseCashShiftCommand`/`RegisterCashMovementCommand` carecían de `originDeviceId`/`currencyCode`/`reasonCode` — datos operacionales reales, misma categoría que la decisión del Bloque 22. El owner aprobó extender ambos comandos.

## 6. Pruebas ejecutadas (todas reales, contra archivos SQLite físicos vía `mkdtemp`)

`packages/database-sqlite/tests/`: `cash-shift-repository.test.ts` (11 — OPEN, Bloque 22, incluye introspección de MIGRATION_007/008) + `cash-close-movement-repository.test.ts` (13 — Bloque 23 CLOSE/MOVEMENT + Bloque 23-D sentinel/checksum) + `local-database.test.ts` (11 preexistentes, sin modificar) = **35/35 PASS**.

Cobertura CASH-002 (close): persistencia exacta sin review; persistencia SHORTAGE con `cash_difference_reviews` real; replay idempotente; autorización antes de tocar el repositorio; aislamiento de tenant; concurrencia real (dos claves distintas, mismo turno); sentinel/checksum D1 verificados por la ruta física real de `saveClose` (formato, valor exacto, idénticos entre tenant/dispositivo/turno distintos — Bloque 23-D).

Cobertura CASH-003 (movement): persistencia + avance de versión + `shift_sequence`; replay idempotente; autorización; aislamiento de tenant; concurrencia real (dos claves distintas, mismo turno, mismo `nextMovementSequence()` en disputa); integración con `ExpectedCash` (dos movimientos reales alimentan un cierre con `expected_amount` exacto).

Cobertura MIGRATION_008 (Bloque 23-D): columnas `NOT NULL` restauradas verificadas por introspección física directa (`PRAGMA table_info`); `blind_mode`/`severity`/`requires_segregation` confirmadas todavía nullable; ledger v1-v8 contiguo con checksums reales; `PRAGMA foreign_key_check` → 0 violaciones; `PRAGMA integrity_check` → `ok` (verificado, no asumido, vía script de introspección ejecutado y descartado en la propia auditoría).

Regresión completa ejecutada tras los cambios:

- `pnpm --filter @pos-platform/domain test` → 104/104 PASS (sin cambios de dominio en B23/B23-D).
- `pnpm --filter @pos-platform/application test` → 102/102 PASS (sin cambios de aplicación en B23-D).
- `pnpm --filter @pos-platform/database-sqlite test` → 35/35 PASS (ANTES de B23-D: 34; DESPUÉS: 35 — 1 prueba nueva neta: se sumó "sentinel/checksum idénticos entre tenant/device/shift" y se reescribió, sin sumar, la prueba de introspección que antes verificaba nullable y ahora verifica NOT NULL).
- `pnpm -w typecheck` → limpio en los 7 proyectos del workspace.
- `pnpm run architecture:check` → `ARCH-003 boundary validation PASS`, ejecutado sin caché de Nx (`Cache: 0/1 hit`).

CASH-001 (OPEN) confirmado sin degradación en B23 y en B23-D: las 10 pruebas originales de Bloque 22 en `cash-shift-repository.test.ts` (incluida la de concurrencia real) siguen pasando sin modificación.

## 7. Gobernanza final

```text
DDL: MATERIALIZED — CASH ONLY (SQLite)
SQL: MATERIALIZED — CASH ONLY (SQLite)
MIGRATIONS: MATERIALIZED — CASH ONLY (SQLite, versions 6, 7, 8)
POSTGRESQL: NOT EXECUTED — DEFERRED TO B24-B (B24-A quedó NO-GO por la contradicción D1/MIGRATION_007, resuelta en este bloque — requiere B24-A REVALIDATION antes de B24-B)
GO_AUTHORIZED: YES — CASH ONLY
```

BLOCKER: 0. MAJOR: 0.

Alcance real: las tres verticales de Cash (CASH-001 apertura, CASH-002 cierre, CASH-003 movimientos) físicamente probadas de extremo a extremo contra SQLite, incluida concurrencia real en las tres. PostgreSQL permanece sin ejecutar por falta de entorno, no fabricado. Validación de moneda, política de aprobación, comparación de checksum de contenido para CLOSE/MOVEMENT, y todo el ciclo de vida rico de CashCount (blind mode, políticas versionadas, severidad, segregación) permanecen deliberadamente sin implementar — documentado en §3, no fabricado.
