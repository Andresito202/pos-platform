# Cash — decisiones D5/D6 cerradas + contrato de idempotencia de OPEN

## 1. D5 — Idempotencia de `OpenCashShiftUseCase`

### Decisión

**RESOLVED.** El contrato completo se deriva, sin decisión de negocio oculta, de la misma arquitectura local-first ya normativa y ya implementada (con éxito, probada) para movimientos, conteos y acciones de revisión.

### Evidencia (auditoría directa de código en este bloque)

- `OpenCashShiftCommand` (`open-cash-shift.ts`): `scope`, `cashRegisterId`, `originDeviceId`, `openedByActor`, `openingAmount` — sin `idempotencyKey`.
- `OpenCashShiftUseCase.execute()`: sin lookup de idempotencia; único mecanismo anti-duplicado es `hasIncompatibleOpenShift(scope, cashRegisterId)`.
- `CashShiftRepository.save(shift, movement)`: sin parámetro `idempotencyKey` (a diferencia de `saveMovement`/`saveClose`, que sí lo reciben).
- `CashShiftRepository.hasIncompatibleOpenShift(scope, cashRegisterId)`: **no recibe `originDeviceId`**, pese a que `cash-counting-schema.md:59` exige la incompatibilidad "por tenant, sucursal, caja **y dispositivo**" — hallazgo relacionado, distinto de D5, registrado en §5.
- `findMovementByIdempotencyKey`/`findCloseByIdempotencyKey`: ambos `(scope, idempotencyKey)` — sin `originDeviceId` explícito como parámetro del puerto (aunque la constraint física sí lo incluye). Este es el patrón real ya establecido, no uno nuevo que este documento inventa.

### Por qué el tuple NO es una preferencia — es la misma conclusión arquitectónica ya aplicada 3 veces

`cash-counting-schema.md:108` justifica textualmente por qué `origin_device_id` forma parte de la idempotencia de movimientos: "una clave no se reutiliza **entre operaciones de caja distintas**". La razón de fondo (DEC-007, local-first) es que la `idempotency_key` la genera el dispositivo LOCALMENTE, sin coordinación con otros dispositivos — por lo que dos dispositivos distintos podrían generar, por coincidencia, el mismo string de clave. Sin `origin_device_id` en el tuple, esa coincidencia se leería como un replay del mismo request, cuando en realidad son dos operaciones distintas de dos dispositivos distintos.

Esa razón no depende de qué operación es (apertura, movimiento, conteo, acción) — depende de CÓMO se genera la clave (local, por dispositivo, sin coordinación central). `OpenCashShiftCommand` ya tiene `originDeviceId` como campo (`open-cash-shift.ts:18`) exactamente por este motivo. No hay ninguna razón textual ni arquitectónica para que OPEN sea la única operación de Cash donde este razonamiento no aplique.

**Tuple: `(tenant_id, origin_device_id, opening_idempotency_key)`.**

### Checksum

Contenido: `cashRegisterId`, `openedByActor.type`, `openedByActor.id`, `openingAmount` — canonicalizados (mismo orden de campos, mismo formato numérico que `Money.toString()` ya usa en el resto del dominio).

Excluidos explícitamente: `scope` (ya es la partición del lookup, no contenido a validar) y `originDeviceId` (ya es parte del tuple/namespace de la clave, no contenido del payload).

Esta selección de campos es **DERIVED**, no textual — ningún documento del repositorio enumera exhaustivamente el contenido de un checksum para NINGUNA entidad (Cash, Inventory, Catalog); el patrón general es "checksum del request canónico" sin más detalle en ningún lugar. La selección aquí sigue el mismo método que se aplicaría a cualquier operación: los campos que, de cambiar, representarían una operación semánticamente distinta (`cashRegisterId`, actor, monto) se incluyen; los que son metadatos de enrutamiento/identidad de la clave misma (scope, device) se excluyen.

### Retry (misma clave + mismo checksum)

No crea un segundo `CashShift` ni un segundo `CashMovement` `OPENING_FLOAT`. Devuelve el shift ya persistido y (si aplica) el evento ya calculado a partir de datos existentes — sin volver a emitir el evento de dominio como si fuera nuevo. Mismo patrón que `ALREADY_CLOSED` de `CloseCashShiftUseCase`, con un nuevo resultado análogo: `ALREADY_OPENED`.

### Conflict (misma clave + checksum distinto)

`REJECTED` con una nueva razón, `IDEMPOTENCY_CONFLICT`. No crea un segundo shift. No sobrescribe el resultado original — el shift original permanece exactamente como estaba.

### Retry tras respuesta perdida

Cubierto por el mismo mecanismo de retry: el lookup encuentra el shift ya persistido independientemente de si el llamador original recibió o no la respuesta — la idempotencia vive en la persistencia, no en el canal de red.

### Tenant escape

El lookup recibe `scope` como partición — una clave generada bajo el tenant A nunca puede resolver contra datos del tenant B, mismo comportamiento ya probado para movimientos/conteos.

### Device isolation

`origin_device_id` es parte del tuple — confirmado y justificado arriba. Dos dispositivos que generan el mismo string de clave no colisionan.

### Repository contract — IMPLEMENTADO (Bloque 18, corregido Bloque 19)

Este documento originalmente (Bloque 17) diseñó el contrato sin `originDeviceId` en el lookup, seguiendo por analogía el patrón de `findCloseByIdempotencyKey`. Ese diseño resultó objetivamente incompleto y fue implementado tal cual en el Bloque 18 — el Bloque 19, auditando la implementación contra el propio tuple que este documento declara en la sección anterior `(tenant_id, origin_device_id, opening_idempotency_key)`, encontró la inconsistencia y la corrigió. El contrato REAL, vigente en `packages/application/src/ports/cash-shift-repository.ts`, es:

1. `findOpenByIdempotencyKey(scope: TenantScope, originDeviceId: string, idempotencyKey: string): Promise<{ shift: CashShift; checksum: string } | null>` — `originDeviceId` SÍ es un parámetro explícito (a diferencia de lo que este documento decía originalmente), porque sin él dos dispositivos generando el mismo string de clave colisionarían y uno sería rechazado incorrectamente como `IDEMPOTENCY_CONFLICT` para una solicitud que nunca fue un duplicado — un riesgo funcional real, no cosmético. El checksum viaja en el retorno para que el caso de uso distinga replay de conflicto sin una segunda llamada.
2. `save(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string): Promise<void>` — se extendió la firma existente (no se creó `saveOpen`); no necesita `originDeviceId` como parámetro aparte porque `shift.originDeviceId` ya está disponible en el objeto que recibe.
3. `OpenCashShiftCommand.idempotencyKey: string` — implementado.
4. `OpenCashShiftResult` gana `{ kind: "ALREADY_OPENED", shift: CashShift }` y la razón de rechazo `"IDEMPOTENCY_CONFLICT"` — implementado.

`findMovementByIdempotencyKey`/`findCloseByIdempotencyKey` (CLOSE y MOVEMENT) permanecen exactamente como estaban — sin `originDeviceId` explícito y sin detección de conflicto por checksum. Esa asimetría es real, conocida desde el Bloque 19, y deliberadamente no corregida ahí ni aquí: está fuera del alcance de auditar el contrato de OPEN.

### Hallazgo relacionado, no resuelto aquí (fuera de alcance de D5)

`hasIncompatibleOpenShift` no recibe `originDeviceId`, aunque `cash-counting-schema.md:59` lo exige como cuarta dimensión de incompatibilidad. Es un gap distinto (afecta la protección de turno incompatible, no la idempotencia) — se registra como hallazgo INFORMATIONAL para un bloque futuro, no se corrige aquí (fuera del alcance de D5/D6).

---

## 2. D6 — `denomination_code` dentro de un `cash_count`

### Decisión del owner

**A — una sola línea por `denomination_code` dentro de un `cash_count`.** La cantidad se consolida en una única línea; no se permiten líneas repetidas para la misma denominación.

### Evidencia

`cash-counting-schema.md:172` ya daba la forma exacta de la constraint para esta opción: `UNIQUE (tenant_id, cash_count_id, denomination_code)`. La decisión del owner simplemente fija la condición que el schema dejaba abierta ("cuando la política no permite líneas repetidas") en: **siempre**, sin condición.

### Impacto físico

Constraint conceptual final, tenant-aware conforme a `physical-conventions.md:251` (mismo patrón que el resto del documento):

```text
UNIQUE (tenant_id, cash_count_id, denomination_code)
```

Sin condición — deja de ser parcial/condicional. No se introduce ninguna otra clave ni referencia.

### Cambios de documentación necesarios (aplicados en este bloque)

- `cash-physical-design.md §10`: la UNIQUE de `denomination_code` deja de estar marcada como condicional/pendiente.
- `cash-migration-design-review.md §10`: mismo ajuste en la matriz UNIQUE.
- `cash-owner-decision-pack.md`: formulario D6 marcado con la decisión tomada.

Ningún cambio a `CashCount`/dominio/aplicación — la entidad `CashCountDenomination` sigue sin existir en código (confirmado ABSENT en Bloque 16); esta decisión define su futura constraint, no la materializa.

---

## 3. Pendientes reales

- El único punto NO resuelto por evidencia (verdadera decisión de código, no de negocio): si `save()` gana un parámetro o se agrega `saveOpen()` — trivial, diferido al bloque de implementación, no bloquea el contrato funcional.
- El hallazgo de `hasIncompatibleOpenShift` sin `originDeviceId` — fuera de alcance de D5/D6, registrado para consideración futura.

Ninguno de los dos afecta la corrección física de una constraint, FK, UNIQUE, tipo o enforcement — no elevan a `HUMAN DECISION REQUIRED`.

## 4. Estado final

```text
D5: RESOLVED
D6: RESOLVED

DDL: NO
SQL: NO
MIGRATIONS: NO
GO_AUTHORIZED: NO
```
