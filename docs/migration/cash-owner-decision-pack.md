# Cash — paquete de decisión del owner (D5, D6)

## 1. Contexto

`docs/migration/cash-human-decisions.md` (Bloque 15) resolvió 4 de 6 decisiones humanas pendientes del diseño físico de Cash y dejó `BLOCKED` por las 2 restantes — ambas afectan directamente una `UNIQUE`. Este documento las presenta con evidencia real, sin resolverlas, para que el owner decida. Ninguna otra parte del diseño se toca.

---

## 2. D5 — Idempotencia de `cash_shifts`

### 3. Pregunta

¿Qué conjunto de campos identifica de forma única una misma solicitud de apertura/cierre de turno para efectos de idempotencia?

### 4. Evidencia existente

| Fuente | Qué dice | Clasificación |
|---|---|---|
| **Dominio** (`packages/domain/src/cash/cash-shift.ts`) | `CashShift.open()` no recibe ni almacena ninguna clave de idempotencia — la identidad del turno es su `id` (UUID v7), generado por el caller | ABSENT |
| **Application — apertura** (`packages/application/src/use-cases/open-cash-shift.ts`) | `OpenCashShiftCommand` **no tiene campo `idempotencyKey`**. `OpenCashShiftUseCase.execute()` no hace ningún lookup de idempotencia — la única protección contra duplicados es `repository.hasIncompatibleOpenShift(scope, cashRegisterId)`, un mecanismo distinto (por incompatibilidad de estado, no por clave de request) | **ABSENT — verificado leyendo el archivo en este bloque** |
| **Application — cierre** (`packages/application/src/use-cases/close-cash-shift.ts`) | `CloseCashShiftCommand` sí tiene `idempotencyKey`; `CloseCashShiftUseCase` sí hace `repository.findCloseByIdempotencyKey(scope, idempotencyKey)` antes de proceder | PRESENT, pero solo para cierre — confirma la asimetría |
| **Puerto** (`packages/application/src/ports/cash-shift-repository.ts`) | Tiene `findMovementByIdempotencyKey`, `findCloseByIdempotencyKey` — **no existe** `findOpenByIdempotencyKey` ni equivalente | ABSENT para apertura |
| **Contratos** (`packages/contracts`) | Cash nunca se conectó a `apps/pos-local-service`/contracts (sin consumidor real, per regla repetida en todos los bloques) | ABSENT |
| **Schema físico** (`cash-counting-schema.md:48`) | Columnas `opening_idempotency_key`, `opening_request_checksum`, `closing_idempotency_key`, `closing_request_checksum` existen en `cash_shifts`, sin `UNIQUE` anexo explícito | DERIVED (columnas sí, constraint no) |
| **Schema físico** (`cash-counting-schema.md:64`) | "Apertura y cierre tienen claves/checksums independientes; misma clave y contenido devuelve el mismo resultado, contenido distinto produce conflicto" | NORMATIVE (comportamiento), no da el tuple físico |
| **Schema físico — patrón usado en otras tablas** (líneas 108, 159-160, 214) | Movements/counts/actions sí tienen `UNIQUE(tenant_id, origin_device_id, <key>)` textual | NORMATIVE para esas 3 tablas, no para shifts |
| **Documentación** UC-CASH-001 | "Pruebas mínimas: repetición de solicitud"; "Excepciones: Solicitud repetida" — exige el comportamiento, no define el tuple | NORMATIVE (comportamiento), INFERRED (tuple) |
| **Tests** (`packages/application/tests/open-cash-shift.test.ts`) | No existe ningún test de replay/idempotencia para apertura — coherente con que el código no lo implementa | ABSENT |
| **Permission/security** | Sin relación — la autorización (`canOpenShift`) es un chequeo distinto, ya resuelto, no afecta esta decisión | N/A |
| **Physical design** (`cash-physical-design.md §7`) | Propone `UNIQUE(tenant_id, origin_device_id, opening_idempotency_key)` marcado explícitamente **INFERRED**, no normativo | INFERRED |
| **Migration design review** (`cash-migration-design-review.md §14,21`) | Clasificó esto como HUMAN DECISION REQUIRED — origen de esta ficha | — |

**Resumen:** el comportamiento exigido es NORMATIVE. El tuple físico exacto es INFERRED en el diseño y ABSENT en la aplicación real (la apertura ni siquiera implementa una clave de idempotencia hoy — usa un mecanismo distinto). No es solo una laguna documental: es una laguna de implementación real también.

### 5. Alternativas

**Opción A — `(tenant_id, origin_device_id, opening_idempotency_key)` / `(tenant_id, origin_device_id, closing_idempotency_key)`**
- Cubre: apertura y cierre, cada una con su propia clave, mismo patrón que movements/counts/actions.
- Replay: mismo dispositivo + misma clave → mismo resultado.
- Conflict: mismo dispositivo + misma clave + contenido distinto → conflicto.
- Tenant isolation: sí, `tenant_id` en la clave.
- Device isolation: sí — dos dispositivos distintos con la misma clave NO colisionan (cada uno tiene su propio namespace de idempotencia).
- Riesgo: si el mismo request se reenvía desde OTRO dispositivo (ej. reintento tras fallo de red que cambia de conexión), NO se detecta como duplicado — podría crear un segundo intento de apertura (bloqueado igualmente por `hasIncompatibleOpenShift`, pero por una vía distinta a la idempotencia).
- Impacto físico: consistente con el resto del schema; requiere además agregar `idempotencyKey`/lookup a `OpenCashShiftUseCase` (cambio de código, fuera de este bloque).

**Opción B — `(tenant_id, cash_register_id, opening_idempotency_key)` (sin `origin_device_id`)**
- Cubre: apertura/cierre por caja física, no por dispositivo.
- Replay: mismo register + misma clave → mismo resultado, sin importar qué dispositivo la originó.
- Conflict: igual, por register.
- Tenant isolation: sí.
- Device isolation: **no** — dos dispositivos distintos que generan la misma clave para el mismo register colisionarían como si fueran la misma solicitud.
- Riesgo: más laxo; podría enmascarar dos solicitudes genuinamente distintas de dos cajeros/dispositivos distintos si sus generadores de clave coinciden por azar o error.
- Impacto físico: NO sigue el patrón usado en el resto del documento (que siempre incluye `origin_device_id`) — se apartaría del precedente sin una razón textual para hacerlo.

Ninguna alternativa se recomienda por ser "técnicamente común" — ambas son compatibles con el contrato; la diferencia real es el alcance de aislamiento por dispositivo, una decisión de producto (¿un mismo cajero reintentando desde dos dispositivos debe verse como la misma operación o como dos?), no una decisión técnica.

### 6. Impacto D5

Afecta: 2 `UNIQUE` de `cash_shifts` (apertura y cierre) + el código de `OpenCashShiftUseCase`/`CloseCashShiftCommand`/puerto (agregar el campo/lookup de apertura, ausente hoy). No afecta ninguna otra tabla.

### 7. Formulario de decisión

```text
OWNER DECISION — D5:

[X] Opción A — (tenant_id, origin_device_id, opening/closing_idempotency_key)
[ ] Opción B — (tenant_id, cash_register_id, opening/closing_idempotency_key)
[ ] otra: __________________________________________________
```

**Resuelto en Bloque 17** sin requerir un checkbox literal del owner: el análisis mostró que Opción A no era una preferencia entre dos alternativas técnicamente equivalentes, sino la misma conclusión arquitectónica (local-first, DEC-007) ya aplicada 3 veces en este mismo schema para movimientos/conteos/acciones — Opción B habría sido la que necesitaba justificación nueva, no A. Contrato funcional completo en `docs/migration/cash-owner-decisions-resolved.md`.

---

## 8. D6 — Repetición de `denomination_code` dentro de un `cash_count`

### 9. Pregunta

¿Puede una misma `denomination_code` aparecer más de una vez dentro del mismo `cash_count`?

### 10. Evidencia existente

| Fuente | Qué dice | Clasificación |
|---|---|---|
| **cash-counting-schema.md:172** | "`UNIQUE (tenant_id, cash_count_id, denomination_code)` **cuando la política no permite líneas repetidas**" | NORMATIVE que existe una política; ABSENT su contenido |
| **cash-counting-schema.md:171** | `UNIQUE(tenant_id, cash_count_id, line_number)` — esta SÍ es incondicional | NORMATIVE (constraint distinta, sin relación con D6) |
| **Dominio** | `CashCount` (`packages/domain/src/cash/cash-count.ts`) no modela denominaciones en absoluto — documentado explícitamente como fuera de alcance de los use cases construidos | ABSENT |
| **Application** | Ningún puerto/use case de Cash maneja denominaciones | ABSENT |
| **Tests** | Sin tests — no hay código que probar | ABSENT |
| **Documentación** UC-CASH-002/003 | Mencionan "desglose por denominación" como entrada opcional, sin especificar si admite líneas repetidas para la misma denominación | ABSENT |
| **Physical design / Migration review** | Documentaron la constraint tal cual, marcándola condicional y pendiente — origen de esta ficha | — |
| **CashPolicyVersion** (D1, Bloque 15) | La "política" que D6 referencia no tiene contrato — es la misma entidad no autorizada de D1 | ABSENT (mismo bloqueo raíz) |

**Resumen:** no existe ninguna fuente — normativa, de código o de test — que determine el valor de la política referenciada. La pregunta es genuinamente abierta.

### 11. Alternativas

**Opción A — una sola línea por `denomination_code`** (`UNIQUE(tenant_id, cash_count_id, denomination_code)` activa)
- Suma: cada denominación aparece una vez; `quantity` acumula el conteo total de esa denominación.
- `line_number`: identifica la línea, una por denominación.
- Cálculo: `line_amount = denomination_value * quantity` sigue siendo directo.
- Correcciones: una corrección que cambia la cantidad de una denominación edita/reemplaza una única línea conocida (dentro de las reglas de inmutabilidad ya definidas — en la práctica, el `CashCount` `CORRECTION` crea denominaciones nuevas, no edita las del original).
- Reporting: más simple — un query por denominación siempre da una fila.
- Idempotencia/integridad: más estricta — impide capturar dos conteos físicos separados de la misma denominación (ej. si el cajero cuenta el cajón en dos tandas y quiere registrar cada tanda por separado).

**Opción B — múltiples líneas permitidas** (sin `UNIQUE` sobre `denomination_code`)
- Suma: el total de una denominación es la SUMA de todas sus líneas — el reporting debe agrupar (`GROUP BY denomination_code`) en vez de leer una fila.
- `line_number`: sigue siendo único por línea, sin relación con la denominación.
- Cálculo: `line_amount` por línea sigue siendo directo; el total por denominación requiere agregación.
- Correcciones: más flexible — permite capturar el conteo en el orden físico real (ej. varias bolsas de la misma denominación contadas por separado), preservando esa evidencia línea por línea.
- Reporting: requiere agregación explícita en cada consumidor.
- Idempotencia/integridad: más laxa — no hay protección física contra una doble captura accidental de la misma denominación como error de digitación (quedaría como dos líneas legítimas indistinguibles de un error).

Ninguna alternativa se recomienda por conveniencia — la diferencia real es si el modelo de captura física del arqueo permite/registra múltiples "montones" de la misma denominación como evidencia separada, una decisión operativa de cómo se cuenta el efectivo en el negocio real, no una decisión técnica.

### 12. Impacto D6

Afecta: 1 `UNIQUE` condicional de `cash_count_denominations`. No afecta ninguna otra tabla ni columna.

### 13. Formulario de decisión

```text
OWNER DECISION — D6:

[X] A — denomination_code único dentro del count (UNIQUE activa)
[ ] B — denomination_code puede repetirse (sin UNIQUE)
[ ] otra: __________________________________________________
```

**Decidido por el owner en Bloque 17.** Aplicado a `cash-physical-design.md §10` y `cash-migration-design-review.md §10`: `UNIQUE(tenant_id, cash_count_id, denomination_code)` sin condición.

---

## 14. Estado

```text
D5: RESOLVED (Bloque 17)
D6: RESOLVED (Bloque 17, decisión del owner)
```

Detalle completo en `docs/migration/cash-owner-decisions-resolved.md`. El diseño físico (`cash-physical-design.md`) y la revisión de diseño de migración (`cash-migration-design-review.md`) ya reflejan ambas decisiones.

```text
DDL: NO
SQL: NO
MIGRATIONS: NO
GO_AUTHORIZED: NO
```
