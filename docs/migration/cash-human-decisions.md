# Cash — cierre de decisiones humanas del contrato físico (pre-DDL)

## 1. Objetivo

Cerrar, con evidencia y sin conveniencia, las 6 `HUMAN DECISION REQUIRED` identificadas en `docs/migration/cash-migration-design-review.md` (Bloque 14) antes de cualquier posible autorización de DDL. No materializa el modelo físico.

## 2. Estado de entrada

Bloque 13 PASS, Bloque 14 PASS, commit `a861e59`, branch `domain/cash-open-vertical-20260901`. Documentos de referencia: `cash-physical-design.md`, `cash-migration-design-review.md`.

## 3-7. Las 6 decisiones

---

## DECISIÓN 1 — CashPolicyVersion / campos de policy version

**Nombre:** tipo y forma física de `calculation_policy_version`, `calculation_checksum`, `tolerance_policy_version`, `tolerance_policy_checksum` (cash_counts, cash_difference_reviews), `authorization_policy_version` (cash_difference_review_actions).

**Estado anterior:** HUMAN DECISION REQUIRED.

**Fuente normativa:** `cash-counting-schema.md:124,191,210` (columnas); `conceptual-data-model.md` §CashPolicyVersion: "Versión inmutable publicada que conserva únicamente reglas aprobadas de conteo, tolerancia, clasificación de diferencias, aprobación y restricciones offline. Conserva... vigencia, checksum, actor, motivo y versión sustituida."

**Interpretación:** `CashPolicyVersion` es un concepto YA modelado (tiene forma conceptual definida: vigencia, checksum, actor, motivo, versión sustituida — el mismo patrón que `AuthorizationPolicyVersion` de PHY-G03), pero no autorizado a materializarse — ningún gate lo ha aprobado para DDL, y `data-ownership.md:20` confirma que, cuando exista, pertenecería a Cash Register (no a otro módulo). Los campos `*_policy_version` no son una entidad nueva: son referencias hacia esa entidad futura.

**Impacto físico:** tipo de columna, nullability, presencia/ausencia de FK.

**Decisión:** `*_policy_version` = `UUID`, `NOT NULL` (el schema no los marca `NULL`), **sin FK física** (la tabla destino no existe ni está autorizada). `*_checksum` = `TEXT`, `NOT NULL`, snapshot congelado del contenido de esa versión al momento del cálculo — mismo patrón que `request_checksum` (texto) usado en todo el documento. Ningún campo nuevo se introduce; los 5 nombres ya estaban en el schema.

**Clasificación final:** **RESOLVED** (forma física de la columna) — la creación de `CashPolicyVersion` en sí permanece explícitamente fuera de alcance, sin fecha, sin bloquear el diseño de las 7 tablas de Cash.

**Cambios necesarios:** ninguno al esquema ya diseñado — clarifica lo que ya estaba implícito en `cash-physical-design.md §9,11,12`.

---

## DECISIÓN 2 — `line_amount` en SQLite

**Nombre:** enforcement de `line_amount = denomination_value * quantity` en SQLite.

**Estado anterior:** HUMAN DECISION REQUIRED (Bloque 14 lo dejó abierto por prudencia; esta decisión lo corrige).

**Fuente normativa:** `cash-counting-schema.md:174-175` (la regla); `cash-counting-schema.md:259-261` y `physical-conventions.md:260`: "SQLite reproduce las FKs que existan localmente y el repositorio valida las invariantes que el dialecto no pueda expresar; PostgreSQL revalida al recibir."

**Interpretación:** esta NO es una decisión nueva — es la regla general que el proyecto YA aplica de forma idéntica en cada caso donde SQLite no puede expresar una invariante nativamente (el propio `cash-physical-design.md §5` la cita para la protección de turno incompatible). `line_amount` es exactamente ese caso: PostgreSQL soporta aritmética sobre `numeric` en un CHECK; SQLite, con decimal como TEXT canónico, no.

**Impacto físico:** enforcement (constraint vs. aplicación), no la columna en sí (permanece almacenada, no derivada — ver B).

**Decisión:** **Opción B**. PostgreSQL: `CHECK (line_amount = denomination_value * quantity)` nativo. SQLite: sin CHECK portable; el repositorio (`packages/database-sqlite`, cuando exista adapter) valida antes de insertar; PostgreSQL revalida al aceptar centralmente, mismo patrón que el resto del documento.

**Clasificación final:** **RESOLVED**.

**Cambios necesarios:** ninguno al esquema — corrige la clasificación (de "requiere decisión" a "regla general ya existente, aplicada").

---

## DECISIÓN 3 — `code_normalized`

**Nombre:** función de normalización de `cash_registers.code_normalized`.

**Estado anterior:** HUMAN DECISION REQUIRED.

**Fuente normativa:** `physical-conventions.md:102-110` ("Identificadores humanos"): "SKU, códigos, series, números de venta, NIT y referencias externas: se normalizan mediante una función **versionada**; conservan el valor original cuando sea necesario mostrarlo o auditarlo; tienen unicidad en su scope de negocio, no global por conveniencia; no se reutilizan cuando el contrato exige historia; no se generan con `COUNT(*)`."

**Interpretación:** esta regla general resuelve la ARQUITECTURA de la normalización (debe ser una función versionada y reproducible, el valor original `code` se conserva siempre, la unicidad es de scope de negocio — exactamente lo que ya expresa `UNIQUE(tenant_id, company_id, branch_id, code_normalized)`). No resuelve la TRANSFORMACIÓN EXACTA (¿lowercase? ¿trim? ¿normalización Unicode? ¿qué caracteres se consideran equivalentes?) — ningún documento del repositorio define esa función concreta para Cash ni para ningún otro código humano.

**Impacto físico:** ninguno sobre columnas/constraints ya diseñadas (el campo y su UNIQUE ya están correctamente definidos); sí afecta el comportamiento de una futura función de normalización versionada, no diseñada aquí.

**Decisión:** arquitectura RESUELTA (función versionada, valor original preservado, scope de negocio). Transformación exacta permanece sin definir — no se inventa `LOWER()`/`TRIM()`/normalización Unicode.

**Clasificación final:** **PARCIALMENTE RESOLVED** — mecanismo cerrado, contenido exacto de la función `HUMAN DECISION REQUIRED` (bloque separado de trabajo, no bloquea el diseño físico de columnas/constraints ya cerrado).

**Cambios necesarios:** ninguno al esquema.

---

## DECISIÓN 4 — Inmutabilidad de `currency_code`

**Nombre:** mecanismo de enforcement de "moneda inmutable mientras existan turnos asociados".

**Estado anterior:** HUMAN DECISION REQUIRED.

**Fuente normativa:** `cash-counting-schema.md:43` (regla); `cash-counting-schema.md:106` ("moneda igual a CashShift y CashRegister" para movimientos); regla general de este mismo Bloque 15: "PROHIBIDO crear triggers salvo que exista autorización normativa explícita" — ningún documento de Cash autoriza un trigger.

**Respuestas con evidencia:**
1. ¿CashRegister puede cambiar moneda? Sí, mientras no tenga turnos asociados (`cash-counting-schema.md:43`, implícito por la condición).
2. ¿Un shift abierto puede cambiar moneda? No — el shift fija `currency_code` al abrir (`cash-counting-schema.md:48`), sin flujo de cambio documentado.
3. ¿Un movement puede usar moneda diferente? No — "moneda igual a CashShift y CashRegister" (línea 106).
4. ¿Un count puede usar moneda diferente? El schema lista `currency_code` en `cash_counts` (línea 124) sin regla de divergencia — se hereda del shift.
5. ¿La moneda se hereda? Sí, register → shift → movement/count.
6. ¿Qué ocurre si cambia la configuración del register? La regla de línea 43 lo impide mientras existan turnos asociados — sin mecanismo físico de "congelamiento" documentado más allá de esa frase.
7-8. Enforcement: dado que la regla depende de EXISTENCIA DE OTRAS FILAS (turnos asociados a ese register), no es expresable como CHECK simple en ninguno de los dos motores — requiere consultar `cash_shifts`. Sin autorización de trigger en ningún documento.

**Decisión:** enforcement de aplicación/repositorio (mismo patrón que Decisión 2), no trigger. El repositorio valida, antes de permitir cambiar `currency_code` en `cash_registers`, que no existan `cash_shifts` asociados; PostgreSQL no necesita revalidar esto centralmente porque `cash_registers` es `CENTRAL_MASTER_REPLICATED` (autoridad única, no hay escritura local que sincronizar).

**Clasificación final:** **RESOLVED** (mecanismo). La lógica de validación en sí es trabajo de implementación futura, no un nuevo elemento de diseño físico.

**Cambios necesarios:** ninguno al esquema.

---

## DECISIÓN 5 — Idempotencia de `cash_shifts`

**Nombre:** tuple UNIQUE de `opening_idempotency_key`/`closing_idempotency_key`.

**Estado anterior:** HUMAN DECISION REQUIRED (Bloque 14: INFERRED, no textual).

**Fuente normativa:** `cash-counting-schema.md:48` (columnas, sin UNIQUE anexo); línea 64: "Apertura y cierre tienen claves/checksums independientes; misma clave y contenido devuelve el mismo resultado, contenido distinto produce conflicto" (comportamiento, no constraint). Búsqueda dirigida en este bloque (`grep` de `opening_idempotency|closing_idempotency|origin_device_id` sobre `cash-counting-schema.md`) confirma: **el único lugar donde el documento da un tuple `UNIQUE` explícito con `origin_device_id` es en movements (línea 108), counts (159-160) y actions (214) — nunca para shifts.**

**Interpretación:** el COMPORTAMIENTO exigido (replay determinista, conflicto ante contenido distinto) es normativo e inequívoco. El TUPLE FÍSICO exacto que lo implementa no lo es — podría ser `(tenant_id, origin_device_id, opening_idempotency_key)` por el mismo patrón usado 3 veces en el documento, pero también podría, en teoría, omitir `origin_device_id` si la apertura se considerase idempotente por tenant+key sin importar el dispositivo (menos plausible, pero el texto no lo descarta explícitamente).

**Impacto físico:** afecta directamente una UNIQUE — dentro de la categoría que este bloque prohíbe declarar `PASS` sin resolver.

**Decisión:** NO se convierte la inferencia en norma. Se mantiene como decisión pendiente.

**Clasificación final:** **HUMAN DECISION REQUIRED** (permanece abierta).

**Cambios necesarios:** ninguno todavía — el diseño físico ya documenta el tuple como candidato razonado (`cash-physical-design.md §7`), marcado explícitamente INFERRED, no como hecho cerrado.

---

## DECISIÓN 6 — UNIQUE condicional de `cash_count_denominations.denomination_code`

**Nombre:** `UNIQUE(tenant_id, cash_count_id, denomination_code)` "cuando la política no permite líneas repetidas".

**Estado anterior:** HUMAN DECISION REQUIRED (verificado en este bloque: es literalmente el 6º ítem de la lista `Human decisions` del Bloque 14, `cash-migration-design-review.md §21.6` — no asumido, confirmado contra el documento).

**Fuente normativa:** `cash-counting-schema.md:172`: "`UNIQUE (tenant_id, cash_count_id, denomination_code)` cuando la política no permite líneas repetidas."

**Interpretación:** la condición depende de una "política" — no nombrada, no vinculada a `CashPolicyVersion` ni a ningún otro documento de este repositorio. No existe fuente que determine si esa política, hoy, permite o prohíbe líneas repetidas. Este bloque prohíbe explícitamente usar "normalmente se hace así" como evidencia — se descarta esa vía.

**Impacto físico:** afecta directamente si una UNIQUE existe o no.

**Decisión:** no se activa la constraint condicional en este diseño; permanece documentada como condicional, dependiente de la misma política aún inexistente que bloquea la Decisión 1.

**Clasificación final:** **HUMAN DECISION REQUIRED** (permanece abierta — depende de la misma resolución de política que D1, sin duplicar el hallazgo).

**Cambios necesarios:** ninguno.

## 8. Matriz de impacto

| Decisión | Tabla | Columna | Constraint | FK | UNIQUE | Tipo | Enforcement | Estado |
|---|---|---|---|---|---|---|---|---|
| D1 CashPolicyVersion | cash_counts, cash_difference_reviews, cash_difference_review_actions | `*_policy_version`, `*_checksum` | — | No (sin FK física) | — | UUID / TEXT — clarificado | — | RESOLVED |
| D2 line_amount SQLite | cash_count_denominations | `line_amount` | Sí (CHECK) | — | — | — | PG: CHECK; SQLite: aplicación | RESOLVED |
| D3 code_normalized | cash_registers | `code_normalized` | — | — | ya existente, sin cambio | — | función versionada — mecanismo resuelto, transformación exacta pendiente | PARCIAL |
| D4 currency immutability | cash_registers | `currency_code` | Sí (regla, no CHECK simple) | — | — | — | aplicación/repositorio, sin trigger | RESOLVED |
| D5 shift idempotency | cash_shifts | `opening/closing_idempotency_key` | — | — | Sí, tuple exacto pendiente | — | — | **HUMAN DECISION REQUIRED** |
| D6 denomination UNIQUE condicional | cash_count_denominations | `denomination_code` | — | — | Sí, activación pendiente | — | — | **HUMAN DECISION REQUIRED** |

## 9. Propagación documental

- `docs/architecture/physical-model/cash-physical-design.md`: sin cambios de columnas/constraints — D1-D4 solo clarifican razonamiento ya reflejado allí; D5-D6 ya estaban marcadas correctamente como abiertas, sin cambio.
- `docs/migration/cash-migration-design-review.md`: sin cambios — su §21 sigue siendo la lista canónica de decisiones; este documento (Bloque 15) es su resolución, no su reemplazo.
- Ningún cambio a `packages/domain`, `packages/application`, migrations, ni `CashPolicyVersion`.

## 10. Compatibilidad verificada

Physical Design, Migration Design Review, Manifest, domain/application code, permission-matrix, PostgreSQL/SQLite: revisados, sin contradicción nueva introducida por D1-D4 (todas son clarificaciones dentro de lo ya diseñado, no cambios de contrato). D5-D6 no alteran nada porque permanecen exactamente como estaban clasificadas.

## 11. Findings

| # | Hallazgo | Severidad |
|---|---|---|
| 1 | D2 estaba clasificada más conservadoramente de lo necesario en Bloque 14 — la regla general del proyecto (`physical-conventions.md:260`) ya la resolvía | INFORMATIONAL |
| 2 | D3 tiene una regla general (`physical-conventions.md:102-110`) que resuelve su arquitectura pero no su función exacta — resolución parcial, no total | INFORMATIONAL |
| 3 | D5 y D6 permanecen genuinamente sin evidencia suficiente — no se fuerza un cierre | INFORMATIONAL (correctamente sin resolver) |

Sin BLOCKER, sin MAJOR nuevos.

## 12. Estado final

4/6 RESOLVED (D1, D2, D3-parcial se cuenta como avance sustantivo aunque no total, D4). 2/6 permanecen HUMAN DECISION REQUIRED (D5, D6) — **ambas afectan directamente si una UNIQUE existe o su composición exacta**, dentro de la categoría que este bloque prohíbe declarar como PASS definitivo.

```text
DDL: NO
SQL: NO
MIGRATIONS: NO
GO_AUTHORIZED: NO
```
