# Cash — diseño físico detallado (pre-DDL)

## 1. Objetivo

Traducir `docs/migration/cash-target-migration-manifest.md` (`CASH-MANIFEST-V1`, PASS en Gate 12) a un diseño físico columna-por-columna, trazable a las fuentes normativas, para PostgreSQL y SQLite. Este documento no contiene DDL, SQL, Kysely, migration runner ni seeds. Su existencia no autoriza materialización ni cambia `GO_AUTHORIZED`.

`DOCUMENTED != IMPLEMENTED`, `DESIGNED != MATERIALIZED`, `PASS != DDL AUTHORIZATION`.

## 2. Alcance

Exactamente 7 tablas, las mismas del manifest aprobado: `cash_registers`, `cash_shifts`, `cash_movements`, `cash_counts`, `cash_count_denominations`, `cash_difference_reviews`, `cash_difference_review_actions`. No se diseña `CashPolicyVersion` (sin contrato normativo — ver §30), no se diseña `expected_cash` (es derivado, §5), no se introduce ninguna otra tabla ni autoridad.

## 3. Reglas de diseño

- Todo elemento cita `fuente → sección → decisión`. Ninguna columna, constraint o índice se justifica por "parece lógico" o "buena práctica" sin respaldo textual.
- Precisión monetaria: `numeric(19,6)` en PostgreSQL, TEXT decimal canónico en SQLite; nunca `REAL` ni `number` de JavaScript como autoridad (`physical-conventions.md`, tabla de precisión; `cash-counting-schema.md:118,155`).
- UUID v7: string canónico lowercase con guiones en dominio/contratos, `uuid` en PostgreSQL, `TEXT(36)` validado en el adaptador en SQLite (`physical-conventions.md:83-91`). Generado en aplicación (el `IdGenerator` que ya existe en `packages/application`), no por función de base de datos — `physical-conventions.md:100`: "el generador UUID v7 debe poder probar monotonicidad razonable sin usar el timestamp como autoridad de negocio".
- Relaciones tenant-aware: "Toda tabla tenant-scoped expone `UNIQUE (tenant_id, id)` cuando otra tabla tenant-scoped la referencia. Si Company o Branch forman parte del invariante, el destino expone además `(tenant_id, company_id, id)` o `(tenant_id, company_id, branch_id, id)` y la FK usa ese mismo scope" (`physical-conventions.md:251`).

## 4. Estrategia PostgreSQL

Schema `cash`. Owner/roles según el patrón ya normativo (`physical-conventions.md:311-321`): `pos_schema_owner` (DDL), `pos_migrator` (ejecución de migración autorizada), `pos_app` (tráfico de negocio, sin `BYPASSRLS`), `pos_worker` cuando aplique. RLS habilitada y forzada (`FORCE ROW LEVEL SECURITY`) en las 7 tablas — todas son tenant-scoped. Política: comparar `tenant_id` contra `current_setting('app.tenant_id', true)::uuid`, contexto fijado con `SET LOCAL` dentro de la transacción, ausencia de contexto = denegación (`physical-conventions.md:323-329`). RLS es defensa adicional, no sustituye FKs/UNIQUE/CHECK (`physical-conventions.md:259`).

## 5. Estrategia SQLite

Prefijo plano `cash_<tabla>` (mismo nombre lógico que la contraparte `cash.<tabla>` de PostgreSQL — `cash-counting-schema.md` no exige nombres distintos). Decimal canónico como TEXT. Único escritor: POS Local Service, dentro de `BEGIN IMMEDIATE`. La protección de turno incompatible (§6.3) se valida dentro de esa transacción por ausencia de índice parcial condicional nativo confiable en SQLite para este caso — mismo patrón ya usado en `cash-counting-schema.md:66` para RT-00X. FKs se reproducen donde SQLite las soporte; las invariantes que el dialecto no exprese nativamente las valida el repositorio, y PostgreSQL revalida al aceptar centralmente (`physical-conventions.md:260`; `cash-counting-schema.md:259-261`).

`ExpectedCash` — ver §5 del manifest y §13 de este documento — es un fold, no una tabla, en ambos motores.

## 6. `cash_registers`

Fuente: `cash-counting-schema.md:34-44`; manifest §6.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `company_id`, `branch_id` | UUID | NOT NULL |
| `code`, `code_normalized`, `name` | text | NOT NULL |
| `currency_code` | ISO 4217 | NOT NULL |
| `status` | enum | `ACTIVE` \| `RETIRED` |
| `created_at` | timestamptz | NOT NULL |
| `retired_at` | timestamptz | NULL |
| `version` | integer | NOT NULL, arranca en 1 |

PK: `id`. FK: `(tenant_id, company_id, branch_id)` → Branch, tenant-aware compuesta. UNIQUE: `(tenant_id, company_id, branch_id, code_normalized)` (`cash-counting-schema.md:41`) y `UNIQUE (tenant_id, id)` para ser referenciable por `cash_shifts`/`cash_movements` (`physical-conventions.md:251`). CHECK: `status IN ('ACTIVE','RETIRED')`. Índices: los de las UNIQUE ya cubren el query path principal (lookup por sucursal+código).

No delete en cascada sobre historia financiera (`cash-counting-schema.md:44`) — se retira (`RETIRED`), nunca se borra.

## 7. `cash_shifts`

Fuente: `cash-counting-schema.md:46-66`; manifest §7.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `company_id`, `branch_id`, `cash_register_id` | UUID | NOT NULL |
| `origin_device_id` | UUID | NOT NULL |
| `opened_by_actor_type`, `opened_by_actor_id` | actor | NOT NULL |
| `opened_at`, `business_date`, `timezone_id`, `utc_offset_minutes`, `currency_code` | — | NOT NULL |
| `status` | enum | `OPEN` \| `CLOSING` \| `CLOSED` |
| `closed_by_actor_type`, `closed_by_actor_id`, `closed_at` | — | NULL hasta cierre |
| `opening_idempotency_key`, `opening_request_checksum` | text | NOT NULL |
| `closing_idempotency_key`, `closing_request_checksum` | text | NULL hasta cierre |
| `last_movement_sequence` | integer | NOT NULL, monotónico |
| `version` | integer | NOT NULL |
| `created_at`, `server_recorded_at` | timestamptz | server_recorded_at NULL hasta aceptación central |

PK: `id`. FK: `(tenant_id, company_id, branch_id, cash_register_id)` → `cash_registers` vía su `UNIQUE(tenant_id, company_id, branch_id, code_normalized)`... en la práctica vía `UNIQUE(tenant_id, id)` de `cash_registers` más scope repetido, siguiendo `physical-conventions.md:251` regla 4 (verificar cadena Company/Branch completa, no FKs independientes). UNIQUE: `UNIQUE(tenant_id, id)` (para ser referenciada por movimientos/conteos); `UNIQUE(tenant_id, origin_device_id, opening_idempotency_key)` por el mismo patrón de idempotencia usado en movimientos/conteos (`cash-counting-schema.md:108,159-160` — no textual para shift específicamente, inferido por consistencia del mismo documento, marcado en §30); mismo patrón para `closing_idempotency_key`. Índice parcial único de turno incompatible: `(tenant_id, branch_id, cash_register_id, origin_device_id) WHERE status IN ('OPEN','CLOSING')` — tal como exige `cash-counting-schema.md:59,66` ("por tenant, sucursal, caja y dispositivo"). CHECK: `status IN ('OPEN','CLOSING','CLOSED')`.

SQLite: el índice parcial condicional no es tan confiable bajo escritura concurrente como en PostgreSQL — la validación se hace dentro de `BEGIN IMMEDIATE` (`cash-counting-schema.md:66`).

## 8. `cash_movements`

Fuente: `cash-counting-schema.md:70-118`; manifest §8.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `company_id`, `branch_id`, `cash_register_id`, `cash_shift_id` | UUID | NOT NULL |
| `shift_sequence` | integer | NOT NULL |
| `movement_type` | enum (16 valores) | NOT NULL |
| `direction` | enum | `IN` \| `OUT` |
| `amount` | `numeric(19,6)` / TEXT | NOT NULL, `> 0` |
| `currency_code`, `status` (7 valores), `reference_type` | — | NOT NULL |
| `reference_id`, `original_cash_movement_id`, `evidence_reference` | UUID | NULL |
| `reason_code` | text | NOT NULL |
| `actor_type`, `actor_id` | actor | actor_id NULL según tipo |
| `approved_by_actor_type`, `approved_by_actor_id` | actor | NULL |
| `business_date`, `occurred_at`, `device_reported_at`, `origin_device_id` | — | NOT NULL |
| `idempotency_key`, `request_checksum`, `correlation_id` | text/UUID | NOT NULL |
| `version`, `created_at`, `server_recorded_at` | — | server_recorded_at NULL hasta aceptación |

PK: `id`. FK: `(tenant_id, cash_shift_id)` → `cash_shifts.(tenant_id, id)`; `(tenant_id, branch_id, cash_register_id)` → `cash_registers`. UNIQUE: `(tenant_id, cash_shift_id, shift_sequence)` (`cash-counting-schema.md:107`); `(tenant_id, origin_device_id, idempotency_key)` (`cash-counting-schema.md:108`). CHECK: `amount > 0`; `direction IN ('IN','OUT')`; `movement_type` en los 16 valores cerrados; `status` en los 7 valores cerrados. Índice adicional: `(tenant_id, cash_shift_id, status) WHERE status='POSTED'` — soporta el fold de `ExpectedCash`, único query path documentado para ese cálculo (§13).

Append-only: sin UPDATE/DELETE tras `POSTED`; compensación referencia `original_cash_movement_id` y crea fila nueva (`cash-counting-schema.md:110,112`).

## 9. `cash_counts`

Fuente: `cash-counting-schema.md:120-185`; manifest §9.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `company_id`, `branch_id`, `cash_register_id`, `cash_shift_id` | UUID | NOT NULL |
| `count_type` | enum | `PARTIAL` \| `CLOSING` \| `CORRECTION` |
| `status` | enum | `IN_PROGRESS` \| `COMPLETED` \| `ABORTED` |
| `blind_mode` | boolean | NOT NULL |
| `started_shift_version`, `movement_cutoff_sequence` | integer | NOT NULL |
| `calculation_policy_version`, `calculation_checksum` | text | NOT NULL — ver §30 |
| `expected_amount`, `counted_amount`, `difference_amount` | `numeric(19,6)`/TEXT | NULL hasta completar |
| `difference_type` | enum | `SHORTAGE`\|`EXACT`\|`OVERAGE`, NULL hasta completar |
| `severity` | — | NULL hasta completar |
| `currency_code`, `denomination_breakdown_status` (`PROVIDED`\|`NOT_PROVIDED`) | — | NOT NULL |
| `tolerance_policy_version`, `tolerance_policy_checksum` | text | NOT NULL — ver §30 |
| `supersedes_cash_count_id` | UUID | NULL |
| `started_by_actor_type/id`, `started_at` | — | NOT NULL |
| `completed_by_actor_type/id`, `completed_at` | — | NULL hasta completar |
| `aborted_by_actor_type/id`, `aborted_at`, `abort_reason_code` | — | NULL salvo abortado |
| `origin_device_id`, `start_idempotency_key`, `start_request_checksum` | — | NOT NULL |
| `completion_idempotency_key`, `completion_request_checksum` | — | NULL hasta completar |
| `correlation_id`, `version`, `created_at`, `server_recorded_at` | — | server_recorded_at NULL hasta aceptación |

PK: `id`. FK: `(tenant_id, cash_shift_id)` → `cash_shifts`; `(tenant_id, supersedes_cash_count_id)` → `cash_counts` (self-referencial, opcional). UNIQUE: `(tenant_id, origin_device_id, start_idempotency_key)`; `(tenant_id, origin_device_id, completion_idempotency_key)` cuando existe; `(tenant_id, supersedes_cash_count_id)` cuando existe; `(tenant_id, cash_shift_id) WHERE count_type='CLOSING'` parcial (`cash-counting-schema.md:157-163`). CHECK: `expected_amount >= 0`, `counted_amount >= 0` (`cash-counting-schema.md:155-156`); enums cerrados de `count_type`/`status`/`difference_type`/`denomination_breakdown_status`.

## 10. `cash_count_denominations`

Fuente: `cash-counting-schema.md:165-177`; manifest §9.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `cash_count_id` | UUID | NOT NULL |
| `line_number` | integer | NOT NULL |
| `denomination_code` | text | NOT NULL |
| `denomination_value` | `numeric(19,6)`/TEXT | NOT NULL, `> 0` |
| `quantity` | integer | NOT NULL, `> 0` |
| `line_amount` | `numeric(19,6)`/TEXT | NOT NULL, `> 0` |
| `currency_code`, `created_at` | — | NOT NULL |

PK: `id`. FK: `(tenant_id, cash_count_id)` → `cash_counts`. UNIQUE: `(tenant_id, cash_count_id, line_number)`; `(tenant_id, cash_count_id, denomination_code)` cuando la política no permite líneas repetidas (`cash-counting-schema.md:171-172`). CHECK: `denomination_value > 0`, `quantity > 0`, `line_amount > 0`. `line_amount = denomination_value * quantity` — enforceable como CHECK nativo en PostgreSQL (`numeric` soporta aritmética); en SQLite (TEXT canónico) no es un CHECK portable — ver §30. Filas inmutables tras completar el conteo (`cash-counting-schema.md:177`).

## 11. `cash_difference_reviews`

Fuente: `cash-counting-schema.md:187-206`; manifest §10.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `company_id`, `branch_id`, `cash_shift_id`, `cash_count_id` | UUID | NOT NULL |
| `status` | enum | `REVIEW_REQUIRED`\|`ACCEPTED`\|`ESCALATED`\|`RESOLVED` |
| `severity`, `tolerance_policy_version`, `tolerance_policy_checksum` | — | NOT NULL — ver §30 |
| `requires_segregation` | boolean | NOT NULL |
| `created_at`, `resolved_at`, `version`, `correlation_id` | — | resolved_at NULL hasta resolución |

PK: `id`. FK: `(tenant_id, cash_count_id)` → `cash_counts`; `(tenant_id, cash_shift_id)` → `cash_shifts`. UNIQUE: `(tenant_id, cash_count_id)` (`cash-counting-schema.md:202` — a lo sumo una Review por conteo). CHECK: enum de `status`; existe solo si diferencia≠0 o política exige revisión explícita (`cash-counting-schema.md:203`, no expresable como CHECK sin acceso al conteo — validación de aplicación, RLS/constraint no sustituyen esto).

## 12. `cash_difference_review_actions`

Fuente: `cash-counting-schema.md:208-214`; manifest §10.

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK |
| `tenant_id`, `cash_difference_review_id` | UUID | NOT NULL |
| `action_type` | enum (mínimo `CREATED`\|`ACCEPTED`\|`ESCALATED`\|`RESOLVED`) | NOT NULL |
| `from_status`, `to_status` | enum | NOT NULL |
| `reason_code` | text | NOT NULL |
| `note`, `evidence_reference` | — | NULL |
| `actor_type`, `actor_id` | actor | NOT NULL/NULL según tipo |
| `authorization_policy_version` | text | NOT NULL — ver §30 |
| `idempotency_key`, `request_checksum`, `occurred_at`, `origin_device_id`, `created_at`, `server_recorded_at` | — | server_recorded_at NULL hasta aceptación |

PK: `id`. FK: `(tenant_id, cash_difference_review_id)` → `cash_difference_reviews`. UNIQUE: `(tenant_id, origin_device_id, idempotency_key)` (`cash-counting-schema.md:214`). Append-only, sin UPDATE/DELETE.

## 13. ExpectedCash — confirmación DERIVED

No es tabla, no es columna mutable en `cash_shifts`. Se calcula: `fold(cash_movements WHERE tenant_id/cash_shift_id = X AND status='POSTED' AND shift_sequence <= corte, signedAmount, zero)` (`cash-counting-schema.md:116`; ya implementado como función pura en `packages/domain/src/cash/expected-cash.ts`, verificado en Bloque 9). El índice `(tenant_id, cash_shift_id, status)` de §8 es el único soporte físico que necesita — ninguna tabla `expected_cash` se diseña.

## 14. Matriz tenant-aware

| Tabla | `tenant_id` | `company_id` | `branch_id` | FK compuesta hacia |
|---|---|---|---|---|
| cash_registers | Sí | Sí | Sí | Branch |
| cash_shifts | Sí | Sí | Sí | cash_registers, Branch |
| cash_movements | Sí | Sí | Sí | cash_shifts, cash_registers |
| cash_counts | Sí | Sí | Sí | cash_shifts |
| cash_count_denominations | Sí | — (heredado) | — (heredado) | cash_counts |
| cash_difference_reviews | Sí | Sí | Sí | cash_counts, cash_shifts |
| cash_difference_review_actions | Sí | — (heredado) | — (heredado) | cash_difference_reviews |

Ninguna FK simple por `id` desnudo — todas compuestas con `tenant_id` como mínimo, per `physical-conventions.md:251,255,258`.

## 15. Matriz RLS

Las 7 tablas: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Política única por tabla: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. Roles con acceso: `pos_app`, `pos_worker` (sin `BYPASSRLS`); `pos_platform_admin` excepcional, auditado, solo lectura. SQLite no tiene RLS — el único escritor local (POS Local Service) es el mecanismo equivalente (`physical-conventions.md:309-335`).

## 16. Matriz de concurrencia

| Tabla | Mecanismo |
|---|---|
| cash_shifts | `version`/`expected_version`; índice parcial único anti-turno-incompatible |
| cash_movements | `UNIQUE(tenant_id, cash_shift_id, shift_sequence)`; append-only |
| cash_counts | `version`; conflicto de versión → `ABORTED`, nunca resultado parcial confirmado (`cash-counting-schema.md:141`) |
| cash_difference_reviews / actions | `version` en review; acciones append-only, idempotencia propia |

Ningún last-write-wins (`cash-counting-schema.md:30`).

## 17. Matriz de idempotencia

| Tabla | Clave |
|---|---|
| cash_shifts | `(tenant_id, origin_device_id, opening_idempotency_key)` / `(..., closing_idempotency_key)` |
| cash_movements | `(tenant_id, origin_device_id, idempotency_key)` |
| cash_counts | `(tenant_id, origin_device_id, start_idempotency_key)` / `(..., completion_idempotency_key)` |
| cash_difference_review_actions | `(tenant_id, origin_device_id, idempotency_key)` |

Mismo key + mismo checksum → mismo resultado; mismo key + checksum distinto → conflicto (`cash-counting-schema.md:64` y patrón repetido en todo el documento). La detección de conflicto de checksum a nivel de repositorio real queda fuera de este diseño (adapter no existe — ya documentado en Bloque 9).

## 18. Matriz de versionamiento

`version` en `cash_shifts`, `cash_movements`, `cash_counts`, `cash_difference_reviews`. `cash_count_denominations` y `cash_difference_review_actions` son append-only sin `version` propio (su inmutabilidad es la garantía).

## 19. Matriz de invariantes (no exhaustiva, las no-negociables)

| Invariante | Tabla(s) | Mecanismo físico |
|---|---|---|
| Un solo `OPENING_FLOAT` POSTED por turno | cash_movements | UNIQUE parcial `(tenant_id, cash_shift_id) WHERE movement_type='OPENING_FLOAT'` |
| Un solo turno incompatible OPEN/CLOSING por tenant+branch+register+device | cash_shifts | índice parcial único (§7) |
| Un solo CashCount CLOSING completado por turno | cash_counts | UNIQUE parcial `(tenant_id, cash_shift_id) WHERE count_type='CLOSING'` |
| Solo POSTED afecta ExpectedCash | cash_movements | filtrado en el fold (§13), no constraint físico — es una regla de lectura |
| Denominaciones suman `counted_amount` | cash_count_denominations | aplicación (SQLite) / CHECK posible (PostgreSQL) — ver §30 |
| POSTED inmutable | cash_movements | sin UPDATE/DELETE permitido a nivel de aplicación/grants |

## 20. Matriz PostgreSQL/SQLite

| Aspecto | PostgreSQL | SQLite |
|---|---|---|
| Dinero/cantidad | `numeric(19,6)` | TEXT decimal canónico |
| UUID | `uuid` | `TEXT(36)` |
| Enums | `CHECK IN (...)` o tipo enum | `CHECK IN (...)` (SQLite no tiene tipo enum nativo) |
| RLS | Sí, forzada | N/A — único escritor local |
| Índice parcial | Nativo | Emulado dentro de `BEGIN IMMEDIATE` |
| CHECK aritmético (line_amount) | Nativo | No portable — ver §30 |

## 21. Matriz de trazabilidad (muestra representativa)

| Elemento | Fuente | Sección | Decisión |
|---|---|---|---|
| 7 tablas | cash-counting-schema.md | "Decisión central" + "Autoridad y ubicación" | Incluidas, sin invención |
| UNIQUE turno incompatible | cash-counting-schema.md | línea 59, 66 | Índice parcial 4 columnas |
| UNIQUE movimiento | cash-counting-schema.md | línea 107-108 | Dos UNIQUE, tal cual |
| `expected_amount >= 0` | cash-counting-schema.md | línea 155-156 | CHECK directo |
| RLS pattern | physical-conventions.md | líneas 309-335 | Reutilizado sin variación |
| FK tenant-aware | physical-conventions.md | línea 251 | Aplicado a las 7 tablas |
| CashPolicyVersion | Bloque 9/10/manifest §10 | — | NO diseñada — bloqueada por falta de contrato |

## 22. Dependencias con migrations 001/002/003

`001_central_foundation` posee Tenant/Company/Branch, consumidos por referencia, nunca redefinidos — 001 excluye explícitamente "Cash" de su alcance (`first-target-migration-manifest.md:268`). `002_external_integrations_foundation` (schema `integrations`) y `003_fiscal_electronic_invoicing_foundation` (schema `fiscal`) no comparten tabla ni schema con `cash`. Sin conflicto de nombre, sin FK hacia 002/003, ninguna de las tres se modifica.

## 23. Exclusiones

Mismas del manifest §16: sin DDL, sin cambios a 001/002/003, sin `GO_AUTHORIZED`, sin `CashPolicyVersion` sin contrato, sin materialización de otros bounded contexts, sin User/Session/Role dentro de Cash, sin adapters/HTTP/UI/hardware/seeds/providers.

## 24. Riesgos

- Diseñar `cash_counts`/`cash_difference_reviews` con columnas de versión de política (`calculation_policy_version`, `tolerance_policy_version`, `authorization_policy_version`) como texto libre sin FK, en vez de esperar a `CashPolicyVersion`, es una decisión de **cómo diferir** (campo presente, sin autoridad referenciada) — riesgo: si la futura `CashPolicyVersion` no usa un identificador compatible con `text`, requeriría migrar la columna.
- `line_amount = denomination_value * quantity` sin CHECK nativo en SQLite depende enteramente de la aplicación — riesgo de corrupción silenciosa si un futuro adapter SQLite se escribe sin repetir esa validación.
- La UNIQUE de idempotencia de apertura/cierre de turno (`origin_device_id` incluido) es inferida por patrón, no textual para `cash_shifts` específicamente — riesgo bajo, pero debe confirmarse antes de DDL real.

## 25. Riesgos — regla general aplicada

Ningún riesgo se resolvió inventando una respuesta; los tres quedan abiertos para el siguiente gate.

## 26. Puntos que requieren decisión humana

1. **`CashPolicyVersion`**: ¿se definen sus columnas de referencia (`*_policy_version`, `*_checksum`) como texto opaco sin FK hasta que exista el contrato, o se bloquea el diseño completo de `cash_counts`/`cash_difference_reviews` hasta entonces? Este documento asumió la primera opción por continuidad con el manifest (§10), pero es una decisión, no un hecho normativo.
2. **`line_amount` CHECK en SQLite**: ¿trigger, validación exclusiva de aplicación, o columna generada? Ninguna fuente lo especifica.
3. **Normalización de `code_normalized`**: la función exacta (lowercase, trim, unicode fold) no está definida en `cash-counting-schema.md` ni en `physical-conventions.md`.
4. **Inmutabilidad de `currency_code` mientras existan turnos**: no expresable como CHECK simple (requiere ver otras filas) — trigger vs. validación de aplicación.
5. **UNIQUE de idempotencia de `cash_shifts`**: confirmar formalmente el tuple `(tenant_id, origin_device_id, opening/closing_idempotency_key)` contra una fuente explícita, no solo por patrón.
