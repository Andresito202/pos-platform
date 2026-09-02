# Cash — revisión de diseño de migración (pre-DDL)

## 1. Objetivo

Auditar `docs/architecture/physical-model/cash-physical-design.md` (Bloque 13) contra las fuentes normativas — sin asumir que su PASS previo era correcto por sí solo — y producir un diseño de migración revisable: topología, PK/FK/UNIQUE/CHECK/índices resueltos con evidencia, orden de creación, rollback conceptual y estrategia de identidad. No contiene DDL, SQL, Kysely, migration runner ni seeds. No autoriza `GO_AUTHORIZED`.

## 2. Alcance

Exactamente las 7 tablas ya aprobadas: `cash_registers`, `cash_shifts`, `cash_movements`, `cash_counts`, `cash_count_denominations`, `cash_difference_reviews`, `cash_difference_review_actions`. Ninguna tabla agregada, eliminada ni auxiliar. Sin `CashPolicyVersion`. Sin tabla para `ExpectedCash`.

## 3. Fuentes normativas

`cash-counting-schema.md`, `physical-conventions.md`, `traceability.md`, `data-ownership.md`, `permission-matrix.md`, UC-CASH-001/002/003, DEC-002, DEC-007, `cash-target-migration-manifest.md`, `cash-physical-design.md`, y — para §23 — el código fuente real de `tools/target-migrations/src/*.ts` (no solo sus manifests documentales).

## 4. Resumen ejecutivo

El diseño físico del Bloque 13 tenía dos defectos reales de nivel MAJOR, ambos corregidos aquí con evidencia normativa directa (ninguno requirió inventar nada):

1. **FK de `cash_shifts`→`cash_registers` (y análogas) usaban una clave de 4 columnas contra una UNIQUE de 2 columnas** — incompatible. Corregido ampliando la candidate key de las tablas padre a `(tenant_id, company_id, branch_id, id)` per `physical-conventions.md:251,258`.
2. **El UNIQUE parcial de cierre `(tenant_id, cash_shift_id) WHERE count_type='CLOSING'` bloquearía el flujo de reintento tras `ABORTED`** que el propio schema exige (`cash-counting-schema.md:141`, prueba obligatoria #27). Corregido a `WHERE count_type='CLOSING' AND status='COMPLETED'`, respaldado por la propia prosa de la regla 4 (línea 61: "CashCount `CLOSING` `COMPLETED`... unique parcial... para ese tipo").

Una hipótesis planteada por este mismo bloque — que `UNIQUE(tenant_id, supersedes_cash_count_id)` pudiera impedir correcciones múltiples legítimas — se investigó y se descarta: el schema exige explícitamente cadena lineal, "cero o un sucesor directo" (`cash-counting-schema.md:183`), por lo que la constraint original era correcta.

## 5. Migration topology

```text
cash_registers (raíz, sin dependencia dentro de Cash)
    └── cash_shifts (FK → cash_registers)
            ├── cash_movements (FK → cash_shifts, → cash_registers)
            └── cash_counts (FK → cash_shifts)
                    ├── cash_count_denominations (FK → cash_counts)
                    ├── cash_counts (self, supersedes_cash_count_id)
                    └── cash_difference_reviews (FK → cash_counts, → cash_shifts)
                            └── cash_difference_review_actions (FK → cash_difference_reviews)
```

## 6. Dependency graph (externo)

Todas las 7 tablas dependen de `Tenant`/`Company`/`Branch` (propiedad de `001_central_foundation`, consumidas por referencia — `first-target-migration-manifest.md:268` excluye Cash explícitamente de 001, confirmando que la relación es de consumo, no de redefinición). Ninguna depende de `002_external_integrations_foundation` ni `003_fiscal_electronic_invoicing_foundation`.

## 7. PostgreSQL design (conceptual)

Schema `cash`, propietario `pos_schema_owner`. Orden: crear schema → `cash_registers` → `cash_shifts` → `cash_movements` → `cash_counts` → `cash_count_denominations` → `cash_difference_reviews` → `cash_difference_review_actions` → constraints diferidas (self-FK de `cash_counts`) → índices → `ENABLE`/`FORCE ROW LEVEL SECURITY` en las 7 → políticas → grants a `pos_app`/`pos_worker` (sin `BYPASSRLS`, per `physical-conventions.md:317-318`). Grants exactos (SELECT/INSERT/UPDATE por tabla) no están enumerados columna-por-columna en ninguna fuente para Cash específicamente — permanecen como diseño pendiente de la tarea de materialización, no de este documento.

## 8. SQLite design (conceptual)

Prefijo `cash_<tabla>`, mismo orden de creación. Decimal → TEXT canónico; UUID → `TEXT(36)`. FKs reproducidas donde SQLite las soporte nativamente (todas las de este diseño lo son — son FKs simples de igualdad compuesta, sin condiciones). Único escritor: POS Local Service, dentro de `BEGIN IMMEDIATE`. Sin RLS — el único-escritor-local es la defensa equivalente. Diferencia explícita respecto a PostgreSQL: `line_amount = denomination_value * quantity` no es un CHECK portable en SQLite (ver §11) — es responsabilidad exclusiva de aplicación en ese motor, mientras que en PostgreSQL puede ser CHECK nativo.

## 9. Matriz PK/FK

| Tabla | PK | FK saliente | Candidate key consumida | Clasificación |
|---|---|---|---|---|
| cash_registers | `id` | `(tenant_id, company_id, branch_id)` → Branch | (externa, 001) | NORMATIVE |
| cash_shifts | `id` | `(tenant_id, company_id, branch_id, cash_register_id)` → `cash_registers(tenant_id, company_id, branch_id, id)` | **corregida en este bloque** | DERIVED (`physical-conventions.md:251,258`) |
| cash_movements | `id` | `(tenant_id, company_id, branch_id, cash_shift_id)` → `cash_shifts(tenant_id, company_id, branch_id, id)`; `(tenant_id, company_id, branch_id, cash_register_id)` → `cash_registers(...)` | **corregida en este bloque** | DERIVED |
| cash_counts | `id` | `(tenant_id, company_id, branch_id, cash_shift_id)` → `cash_shifts(...)`; `(tenant_id, supersedes_cash_count_id)` → `cash_counts(tenant_id, id)` (self, opcional) | **corregida en este bloque** para el FK a shift; self-FK sin cambios | DERIVED |
| cash_count_denominations | `id` | `(tenant_id, cash_count_id)` → `cash_counts(tenant_id, id)` | sin cambio — la tabla no tiene `company_id`/`branch_id` (`cash-counting-schema.md:167`) | NORMATIVE |
| cash_difference_reviews | `id` | `(tenant_id, company_id, branch_id, cash_count_id)` → `cash_counts(...)`; `(tenant_id, company_id, branch_id, cash_shift_id)` → `cash_shifts(...)` | **corregida en este bloque** | DERIVED |
| cash_difference_review_actions | `id` | `(tenant_id, cash_difference_review_id)` → `cash_difference_reviews(tenant_id, id)` | sin cambio — sin `company_id`/`branch_id` (`cash-counting-schema.md:210`) | NORMATIVE |

**Candidate keys que deben exponer las tablas padre** (nuevo respecto al Bloque 13): `cash_registers`, `cash_shifts`, `cash_counts` exponen tanto `UNIQUE(tenant_id, id)` (baseline) como `UNIQUE(tenant_id, company_id, branch_id, id)` (para las FK que verifican la cadena completa) — ambas per `physical-conventions.md:251`: "expone `UNIQUE(tenant_id, id)`... si Company o Branch forman parte del invariante, el destino expone ADEMÁS...". `cash_count_denominations` y `cash_difference_review_actions` solo necesitan `UNIQUE(tenant_id, id)` — sus hijos no cargan `company_id`/`branch_id` propios.

Ningún ID sin tenant/scope participa en una FK — regla 1 de `physical-conventions.md:255` ("FK simple por `id` solo válida para catálogos globales") no aplica a ninguna de las 7 tablas, todas tenant-scoped.

## 10. Matriz UNIQUE

| Tabla | UNIQUE | Propósito | Fuente | Clasificación |
|---|---|---|---|---|
| cash_registers | `(tenant_id, company_id, branch_id, code_normalized)` | integridad de negocio (código no repetido) | `cash-counting-schema.md:41` | NORMATIVE |
| cash_registers | `(tenant_id, id)`, `(tenant_id, company_id, branch_id, id)` | soporte de FK | `physical-conventions.md:251` | DERIVED |
| cash_shifts | `(tenant_id, id)`, `(tenant_id, company_id, branch_id, id)` | soporte de FK | `physical-conventions.md:251` | DERIVED |
| cash_shifts | parcial `(tenant_id, branch_id, cash_register_id, origin_device_id) WHERE status IN ('OPEN','CLOSING')` | invariante de negocio (turno incompatible) | `cash-counting-schema.md:59,66` | NORMATIVE |
| cash_shifts | `(tenant_id, origin_device_id, opening_idempotency_key)` / `(..., closing_idempotency_key)` | idempotencia | patrón repetido del documento (línea 108, 159-160), no textual para shift | **INFERRED — ver §21** |
| cash_movements | `(tenant_id, cash_shift_id, shift_sequence)` | integridad de orden | `cash-counting-schema.md:107` | NORMATIVE |
| cash_movements | `(tenant_id, origin_device_id, idempotency_key)` | idempotencia | `cash-counting-schema.md:108` | NORMATIVE |
| cash_counts | `(tenant_id, id)`, `(tenant_id, company_id, branch_id, id)` | soporte de FK | `physical-conventions.md:251` | DERIVED |
| cash_counts | `(tenant_id, origin_device_id, start_idempotency_key)` | idempotencia | `cash-counting-schema.md:159` | NORMATIVE |
| cash_counts | `(tenant_id, origin_device_id, completion_idempotency_key)` cuando existe | idempotencia | `cash-counting-schema.md:160` | NORMATIVE |
| cash_counts | `(tenant_id, supersedes_cash_count_id)` cuando existe | cadena lineal, no ramificada | `cash-counting-schema.md:161,183` — **verificado en este bloque, correcto tal cual** | NORMATIVE |
| cash_counts | parcial `(tenant_id, cash_shift_id) WHERE count_type='CLOSING' AND status='COMPLETED'` | un solo cierre completado por turno | `cash-counting-schema.md:61,162` — **corregida en este bloque** (se agregó `AND status='COMPLETED'`) | NORMATIVE |
| cash_count_denominations | `(tenant_id, cash_count_id, line_number)` | integridad de orden | `cash-counting-schema.md:171` | NORMATIVE |
| cash_count_denominations | `(tenant_id, cash_count_id, denomination_code)` cuando la política no permite líneas repetidas | integridad condicional | `cash-counting-schema.md:172` | NORMATIVE (condición de política no definida — ver §21) |
| cash_difference_reviews | `(tenant_id, id)` | soporte de FK | `physical-conventions.md:251` | DERIVED |
| cash_difference_reviews | `(tenant_id, cash_count_id)` | a lo sumo una Review por conteo | `cash-counting-schema.md:202` | NORMATIVE |
| cash_difference_review_actions | `(tenant_id, origin_device_id, idempotency_key)` | idempotencia | `cash-counting-schema.md:214` | NORMATIVE |

Ningún UNIQUE se agregó por intuición u optimización — todos tienen fuente o están clasificados INFERRED/pendiente.

## 11. Matriz CHECK

| Elemento | Enum/condición | Fuente | Clasificación |
|---|---|---|---|
| `cash_registers.status` | `ACTIVE`, `RETIRED` | `cash-counting-schema.md:42` | NORMATIVE, cerrado |
| `cash_shifts.status` | `OPEN`, `CLOSING`, `CLOSED` | `cash-counting-schema.md:50-54` | NORMATIVE, cerrado |
| `cash_movements.movement_type` | 16 valores | `cash-counting-schema.md:74-91` | NORMATIVE, cerrado |
| `cash_movements.direction` | `IN`, `OUT` | `cash-counting-schema.md:105` | NORMATIVE, cerrado |
| `cash_movements.status` | 7 valores | `cash-counting-schema.md:93-101` | NORMATIVE, cerrado |
| `cash_movements.amount > 0` | — | `cash-counting-schema.md:105` | NORMATIVE |
| `cash_counts.count_type` | `PARTIAL`, `CLOSING`, `CORRECTION` | `cash-counting-schema.md:126-130` | NORMATIVE, cerrado |
| `cash_counts.status` | `IN_PROGRESS`, `COMPLETED`, `ABORTED` | `cash-counting-schema.md:132-136` | NORMATIVE, cerrado |
| `cash_counts.difference_type` | `SHORTAGE`, `EXACT`, `OVERAGE` | `cash-counting-schema.md:146` | NORMATIVE, cerrado |
| `cash_counts.denomination_breakdown_status` | `PROVIDED`, `NOT_PROVIDED` | `cash-counting-schema.md:145` | NORMATIVE, cerrado |
| `cash_counts.expected_amount >= 0`, `counted_amount >= 0` | — | `cash-counting-schema.md:155-156` | NORMATIVE |
| `cash_count_denominations.denomination_value > 0`, `quantity > 0` (entero) | — | `cash-counting-schema.md:173` | NORMATIVE |
| `cash_count_denominations.line_amount > 0` y `= denomination_value * quantity` | — | `cash-counting-schema.md:174-175` | NORMATIVE en PostgreSQL; **no portable en SQLite — enforcement de aplicación en ese motor** (ver §21) |
| `cash_difference_reviews.status` | `REVIEW_REQUIRED`, `ACCEPTED`, `ESCALATED`, `RESOLVED` | `cash-counting-schema.md:195-198` | NORMATIVE, cerrado |
| `cash_difference_review_actions.action_type` | `CREATED`, `ACCEPTED`, `ESCALATED`, `RESOLVED` | `cash-counting-schema.md:212`, texto: **"Acciones iniciales"** | **NO cerrado artificialmente** — el mismo calificativo "iniciales" que usa el documento para `movement_type` ("tipos iniciales respaldados"), que sí resultó ampliable. Diseñar el CHECK con estos 4 valores hoy, documentando explícitamente que la fuente no garantiza exhaustividad. |

No se convirtió ningún listado "mínimo"/"inicial" en cerrado sin marcarlo.

## 12. Matriz de índices

| Índice | Categoría |
|---|---|
| Los de §10 (todas las UNIQUE) | A — integridad |
| `(tenant_id, ...)` implícitos en cada FK compuesta | B — RLS/FK |
| `(tenant_id, cash_shift_id, status) WHERE status='POSTED'` en `cash_movements` | C — query path explícito (fold de ExpectedCash, único consumidor documentado) |

Ningún índice D (especulativo) se incluye — no hay índice sin categoría A/B/C en este diseño.

## 13. Matriz RLS

Las 7 tablas: `ENABLE` + `FORCE ROW LEVEL SECURITY`. Política: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. Sin contexto → denegación, nunca acceso global (`physical-conventions.md:329`). Roles con acceso de negocio: `pos_app`, `pos_worker`, ninguno con `BYPASSRLS`. Única excepción normativa conocida en todo el repositorio: `pos_platform_admin`, "inspección global excepcional y auditada", `BYPASSRLS`, solo lectura, "nunca heredado por app/worker" (`physical-conventions.md:320`) — esta excepción SÍ está en la fuente, se documenta tal cual, no se inventa ninguna adicional. Ninguna excepción administrativa nueva se introduce para Cash.

## 14. Matriz de idempotencia

Ver columna "Clasificación" de §10. Único punto INFERRED: la clave de idempotencia de apertura/cierre de `cash_shifts` — necesaria para integridad física (sin ella, un reintento de apertura podría crear un segundo `OPENING_FLOAT`, violando la regla 1 de línea 58), pero el documento no da el tuple exacto para `cash_shifts` como sí lo hace textualmente para movimientos (línea 108) y conteos (línea 159-160). Elevada a §21 como decisión que SÍ afecta corrección física — no se declara PASS incondicional sobre este punto (ver §23/26).

## 15. Matriz de versioning/concurrencia

`version` en `cash_registers`, `cash_shifts`, `cash_movements`, `cash_counts`, `cash_difference_reviews`. `expected_version` se valida en `cash_shifts` (apertura/movimiento/cierre) y `cash_counts` (completar). Ningún versionado se agregó donde el schema no lo declara — `cash_count_denominations` y `cash_difference_review_actions` no llevan `version` propio.

## 16. Matriz append-only

| Tabla | Mecanismo físico | Fuente |
|---|---|---|
| cash_movements | sin UPDATE/DELETE tras `POSTED`; compensación = fila nueva con `original_cash_movement_id` | `cash-counting-schema.md:110,112,121` |
| cash_difference_review_actions | sin UPDATE/DELETE, cada transición inserta una fila | `cash-counting-schema.md:210,213` |

Enforcement propuesto: grants (sin `UPDATE`/`DELETE` para `pos_app` sobre estas dos tablas tras la fila de negocio) — **no triggers**, per prohibición explícita de este bloque. Grants exactos quedan como diseño pendiente de materialización (mismo estatus que §7).

## 17. Migration ordering (conceptual, no SQL)

1. Prerrequisitos externos ya materializados: `001_central_foundation` (Tenant/Company/Branch) — sin cambios.
2. Schema `cash`.
3. `cash_registers`.
4. `cash_shifts` (FK a `cash_registers`).
5. `cash_movements` (FK a `cash_shifts`, `cash_registers`).
6. `cash_counts` (FK a `cash_shifts`; self-FK `supersedes_cash_count_id` diferida hasta que la tabla exista).
7. `cash_count_denominations` (FK a `cash_counts`).
8. `cash_difference_reviews` (FK a `cash_counts`, `cash_shifts`).
9. `cash_difference_review_actions` (FK a `cash_difference_reviews`).
10. Constraints diferidas (self-FK de `cash_counts`).
11. Índices no cubiertos por UNIQUE (§12, categoría C).
12. `ENABLE`/`FORCE ROW LEVEL SECURITY` + políticas, las 7 tablas.
13. Grants a `pos_app`/`pos_worker` (contenido exacto pendiente — §7/§16).

## 18. Rollback strategy (conceptual)

Orden inverso estricto: `cash_difference_review_actions` → `cash_difference_reviews` → `cash_count_denominations` → `cash_counts` → `cash_movements` → `cash_shifts` → `cash_registers` → schema. Riesgo de pérdida de datos: alto para cualquier reversión con filas ya escritas — estas 7 tablas son hechos financieros append-only por diseño; un rollback físico de DDL vacío (sin filas) es seguro, un rollback con datos reales requiere el mismo tratamiento que cualquier migración financiera del repositorio (fuera del alcance de diseño, es una decisión de materialización). PostgreSQL: `DROP TABLE` en el orden inverso dentro de una transacción. SQLite: mismo orden, mismo único-escritor.

## 19. Migration identity / checksum strategy (conceptual)

Sin archivo de migración todavía — no hay ID que asignar en este bloque (Bloque 8 ya determinó que no hay convención numérica automática; asignar un identificador es un acto de gobernanza posterior, no de diseño). Cuando exista: seguirá el mismo patrón ya usado por 001/002/003 en `tools/target-migrations` (descriptor + checksum del cuerpo + dependencia declarada + up/down + introspección + smoke), verificado en este bloque contra el código fuente real, no solo su documentación (§23).

## 20. Matriz de trazabilidad (Physical Design → Migration Design → Fuente → Evidencia)

| Elemento físico | Migration design | Fuente normativa | Evidencia de implementación |
|---|---|---|---|
| 7 tablas | §5-9 | cash-counting-schema.md | packages/domain (CashShift/CashMovement/CashCount/CashDifferenceReview ya construidos, Bloques 2-10) |
| FK tenant-aware 4 columnas | §9 | physical-conventions.md:251,258 | ninguna aún — corrección de diseño, no de código |
| UNIQUE cierre COMPLETED | §10 | cash-counting-schema.md:61,141 | prueba obligatoria #27 del schema; sin equivalente de test unitario propio (Cash no persiste — no aplica todavía) |
| RLS | §13 | physical-conventions.md:309-335 | PoC de PHY-G14 en PostgreSQL 16.14, real (`traceability.md:140`) |
| Idempotencia shift | §14 | inferencia de patrón | **sin confirmación textual — ver §21** |

## 21. Human decisions (afectan corrección física — bloquean PASS incondicional)

1. **Clave de idempotencia de `cash_shifts`** — el tuple `(tenant_id, origin_device_id, opening/closing_idempotency_key)` es INFERRED por patrón, no dado textualmente para esta tabla. Afecta directamente la corrección de una UNIQUE — **HUMAN DECISION REQUIRED**.
2. **`line_amount` CHECK en SQLite** — trigger vs. aplicación vs. columna generada; ninguna fuente decide. Afecta el enforcement de una constraint — **HUMAN DECISION REQUIRED**.
3. **`code_normalized`** — función de normalización no definida — **HUMAN DECISION REQUIRED**.
4. **Inmutabilidad de `currency_code`** — mecanismo (trigger vs. aplicación) no definido — **HUMAN DECISION REQUIRED**.
5. **Campos de `CashPolicyVersion`** (`calculation_policy_version`, `tolerance_policy_version`, `tolerance_policy_checksum`, `authorization_policy_version`) — confirmados como texto opaco sin FK hasta que exista el contrato de política; no se introdujeron campos nuevos, son exactamente los que cita `cash-counting-schema.md` en sus columnas — pero su tipo final (texto vs. referencia real) sigue pendiente de esa decisión — **HUMAN DECISION REQUIRED**.
6. **`UNIQUE (tenant_id, cash_count_id, denomination_code)` condicional** — la condición ("cuando la política no permite líneas repetidas") depende de una política no definida — **HUMAN DECISION REQUIRED** (menor impacto: sin esa política, el diseño simplemente omite esa segunda UNIQUE).

Los 5 puntos humanos originales del Bloque 13 permanecen; se reformulan aquí con precisión sobre cuáles afectan corrección física directa de una constraint.

## 22. Findings

| # | Hallazgo | Severidad | Corregido en este bloque |
|---|---|---|---|
| 1 | FK de 4 columnas contra UNIQUE de 2 columnas (`cash_shifts`→`cash_registers` y análogas) | MAJOR | Sí — §9 |
| 2 | UNIQUE de cierre sin filtrar `status='COMPLETED'`, bloquearía reintento tras ABORTED | MAJOR | Sí — §10 |
| 3 | `UNIQUE(tenant_id, supersedes_cash_count_id)` — hipótesis de que impediría correcciones múltiples | INFORMATIONAL (investigado, descartado: la constraint es correcta) | N/A |
| 4 | `action_type` tratado como más cerrado de lo que la fuente garantiza ("Acciones iniciales") | MINOR | Sí — clarificado en §11 |
| 5-10 | Los 6 puntos de §21 | MAJOR (afectan corrección física directa) | No — requieren decisión humana, no se inventan |

## 23. Compatibilidad con 001/002/003 — verificación directa de código fuente

`grep -rli "cash" tools/target-migrations/src/` → **0 resultados**, ejecutado en este bloque sobre el código TypeScript real que genera el SQL de 001/002/003 (`postgres.ts`, `postgres-003-*.ts`), no solo sobre sus manifests documentales. Confirma, con evidencia de implementación y no solo documental, que ningún objeto, schema o tabla de las migraciones existentes colisiona con el diseño de Cash.

## 24. Declaración explícita

```text
DDL: NO
SQL: NO
MIGRATIONS: NO
GO_AUTHORIZED: NO
```
