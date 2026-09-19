# DEC-016 — Payment V1: arquitectura local, frontera con Sale y con Cash

## Estado

`PROPUESTA NORMATIVA` — 2026-09-05. **No autoriza implementar nada.**

No crea tablas, no crea `MIGRATION_011`, no integra proveedores, no implementa
webhooks ni checkout. Fija la arquitectura para que el bloque de implementación
no tenga que redescubrirla.

**Este documento no redefine el dominio de pagos.** `PAY-007`
(`docs/domain/payment-state-model.md`, `DONE`) es la única autoridad de estados;
`docs/architecture/physical-model/payments-schema.md` (`CLOSED` en `TECH-002
R2-B`) es el contrato físico; `DEC-002` fija la política de cobertura y
compensación. Lo que aquí se decide es **el alcance de V1** y **la orquestación
local-first** sobre lo que `4C`, `4D` y `4E` ya materializaron.

No modifica `DEC-002`, `DEC-007`, `DEC-012`, `DEC-013`, `DEC-014`, `DEC-015`,
`PAY-007` ni `payments-schema.md`. No modifica Cash V1 ni Sales V1.

## 1. Contexto verificado

| Hecho | Fuente verificada |
|---|---|
| `PaymentStatus` = `CREATED`, `PENDING`, `PARTIALLY_CONFIRMED`, `CONFIRMED`, `FAILED`, `CANCELLED`, `REVIEW_REQUIRED` | `PAY-007` §PaymentStatus |
| `PaymentAttemptStatus` incluye `UNKNOWN` y `REVIEW_REQUIRED` como no-terminales | `PAY-007` §PaymentAttemptStatus |
| `SETTLED`/`RECONCILED`/`REFUNDED`/`REVERSED`/`CHARGEDBACK` **no** son `Payment.status` | `PAY-007` §Regla principal |
| Agregados: `PaymentGroup`, `Payment`, `PaymentAllocation`, `PaymentAttempt`, `Refund` | `payments-schema.md` |
| **La llamada a proveedor nunca comparte transacción de base de datos** | `payments-schema.md` §Fronteras |
| Efectivo confirmado coordina Payment/Attempt/Allocation y `CashMovement` **en una unidad de trabajo local, sin acceso directo entre repositories** | `payments-schema.md` §Fronteras |
| `sales_sales.status` ya admite `PAYMENT_IN_PROGRESS` y `COMPLETED`, con `completed_at` y `version` | `MIGRATION_010`, materializado |
| Transición `READY_FOR_PAYMENT → PAYMENT_IN_PROGRESS → COMPLETED`; `COMPLETED` terminal | `UC-SALES-002` |
| `SalePaymentProjection` (`UNPAID`…`OVERPAID`) es **proyección derivada**, no estado persistente | `UC-SALES-002` |
| `cash_movement` ya admite `CASH_SALE`, `CASH_PAYMENT`, `CHANGE_GIVEN`, estado `POSTED` | `MIGRATION_009`, materializado |
| `expectedCash` del cierre 4D = pliegue de movimientos `POSTED` (`IN` suma, `OUT` resta) | `SqliteCashShiftStore.close()` |
| `PAYMENTS_TRANSFER_REPORT` y `PAYMENTS_TRANSFER_CONFIRM` ya son códigos canónicos | `permission-matrix.md` regla 14 |

**No se halló ninguna contradicción** entre estas fuentes y lo que Payment V1
necesita. No se reabre ninguna decisión.

## 2. Alcance de V1

### 2.1 Dentro

| Elemento | Alcance V1 |
|---|---|
| Métodos | `CASH` y `TRANSFER` |
| Autoridad de confirmación | `LOCAL_DEVICE` (efectivo) y `MANUAL_ATTESTATION` (transferencia) |
| Operaciones | registrar pago, confirmar transferencia, cancelar pago no confirmado, consultar |
| Cobertura | pago único y pago mixto (varios `Payment` en un `PaymentGroup`) |
| Completion | automática dentro de la transacción que completa la cobertura |
| Efectivo | asiento en `cash_movement` dentro de la misma transacción |

### 2.2 Fuera, explícitamente

`CARD` · `QR` · `NEQUI` como métodos **integrados con proveedor** · cualquier
adapter (Wompi, Mercado Pago, PayU, Bold, datáfonos) · webhooks · polling ·
checkout · `Refund` (`UC-PAY-004`) · `Reversal` · `Settlement` · `Reconciliation`
(`UC-PAY-005`) · `Chargeback` · `CUSTOMER_CREDIT` (diferido por `CUST-002`/`DEC-005`)
· crédito autorizado de `DEC-002` · captura de tendered/vuelto · `CashCount` ·
sonido de confirmación.

### 2.3 Por qué `NEQUI` y `QR` no requieren proveedor en V1

En el comercio colombiano pequeño, un cobro Nequi o QR se resuelve fuera de
banda: el cliente paga, el comerciante ve la notificación en su teléfono y la
confirma en el POS. Eso es **`MANUAL_ATTESTATION` sobre el método `TRANSFER`**,
no una integración. `provider_code` puede registrar «NEQUI» como metadato de
infraestructura sin que el dominio conozca ningún SDK.

Por tanto V1 cubre Nequi y QR **como flujo operativo** sin implementar un solo
proveedor. Lo que queda fuera es la confirmación *automática*.

### 2.4 Consecuencia estructural de V1: cero llamadas salientes

Efectivo es autoridad local. Transferencia es atestiguación de un hecho que ya
ocurrió. **V1 no emite ninguna llamada a proveedor.** De ahí se sigue que los
escenarios de commit distribuido —proveedor confirma y la base local falla,
timeout, respuesta tardía— son **estructuralmente inalcanzables en V1**.

Esto no autoriza a simplificar el modelo: `PaymentAttempt` y sus estados
`PENDING`/`UNKNOWN`/`REVIEW_REQUIRED` se conservan tal como `PAY-007` los fija,
porque V2 los necesitará. V1 sencillamente **no puede producirlos** (§9.3).

## 3. Modelo de dominio V1

### 3.1 Agregados

```
Sale (Sales, ya materializado)
  ↑ referenciado por (collection_subject_type='SALE', collection_subject_id)
PaymentGroup (Payments)   1 ─── N  Payment   1 ─── N  PaymentAttempt
                                      │
                                      └─ 1 ─── N  PaymentAllocation ──→ Sale
```

- **`PaymentGroup`** — intención de cobro sobre un sujeto (`SALE` en V1).
  Sostiene `expected_payable_amount` y la moneda. Su cobertura es **proyección
  derivada**, nunca columna mutable (`payments-schema.md` §grupos).
- **`Payment`** — un componente de cobro con un método. Un pago mixto son varios
  `Payment` en el mismo grupo.
- **`PaymentAttempt`** — ciclo técnico de un intento. En V1 hay exactamente un
  intento por `Payment`; el modelo admite varios sin cambio.
- **`PaymentAllocation`** — imputación de importe confirmado a un sujeto. Es lo
  único que produce cobertura.

### 3.2 Identidad — cuatro identificadores que no deben confundirse

| Identificador | Quién lo genera | Qué identifica |
|---|---|---|
| `payment_id` | POS local (UUID) | el componente de cobro |
| `idempotency_key` | el llamador (renderer/main) | **la intención de operación**, no el pago |
| `provider_reference` | proveedor externo | el hecho en el sistema del proveedor |
| `operation_id` | POS local | la operación de runtime (FK a `runtime_operations`) |

Reutilizar uno como otro es el error que `PAY-007` regla 6 y
`payments-schema.md` previenen. En V1 `provider_reference` es opcional y sólo
metadato de atestiguación (p. ej. el número de comprobante que el operador
teclea).

### 3.3 Dinero

Representación idéntica a `cash_movement` y `sales_sales`: `TEXT` a escala 6,
aritmética `BigInt`, sin coma flotante. `currency_code` del `Payment` **debe**
igualar el del `PaymentGroup` y el de la `Sale`. V1 no hace conversión de
moneda.

### 3.4 Método de pago — dominio e infraestructura separados (respuesta a la
pregunta A/B/C)

**Opción C: ambos, mediante separación.**

- `payment_method` es **abstracción de dominio**: `CASH`, `TRANSFER` en V1;
  `CARD`, `QR`, `CUSTOMER_CREDIT` ya reservados por `payments-schema.md`.
- `provider_code` + `provider_reference_type` + `provider_reference` son
  **metadatos de infraestructura**. Identifican un adapter/configuración y
  **no convierten a Nequi, Wompi o un datáfono en entidad del core**.
- `authority_type` es lo que realmente gobierna la confirmación:
  `LOCAL_DEVICE` · `MANUAL_ATTESTATION` · `EXTERNAL_PROVIDER_AUTHORITATIVE`
  (el tercero, sin uso en V1).

Un proveedor futuro soporta un subconjunto de métodos sin que el dominio cambie:
la capacidad vive en el adapter, no en el enum.

## 4. Máquina de estados V1

V1 **no define estados nuevos**. Usa un subconjunto alcanzable de `PAY-007`.

### 4.1 `Payment` — subconjunto alcanzable en V1

| Estado | Significado en V1 | Entrada | Salida | Actor | Audit |
|---|---|---|---|---|---|
| `CREATED` | Componente registrado, sin confirmar | registro de un `TRANSFER` | → `CONFIRMED` \| `CANCELLED` | `USER` con `PAYMENTS_PAYMENT_REGISTER` | `PAYMENT_REGISTERED` |
| `CONFIRMED` | Importe confirmado íntegro | efectivo al registrar; transferencia al confirmar | terminal en V1 | `USER` con `..._REGISTER` / `PAYMENTS_TRANSFER_CONFIRM` | `PAYMENT_CONFIRMED` |
| `CANCELLED` | Componente abandonado antes de confirmar | cancelación explícita | terminal | `USER` con `PAYMENTS_PAYMENT_CANCEL` | `PAYMENT_CANCELLED` |

`PENDING`, `PARTIALLY_CONFIRMED`, `FAILED` y `REVIEW_REQUIRED` **no son
alcanzables en V1** y su producción es un defecto:

- `PENDING` exige un intento en vuelo hacia un proveedor — V1 no los emite.
- `PARTIALLY_CONFIRMED` exige confirmación parcial *de un mismo componente*; V1
  confirma un componente por su importe íntegro o no lo confirma. La cobertura
  parcial *de la venta* se expresa con varios `Payment`, no con este estado.
- `FAILED` exige rechazo de un proveedor.
- `REVIEW_REQUIRED` exige evidencia contradictoria tardía.

### 4.2 `PaymentAttempt` — subconjunto alcanzable en V1

`CREATED → CONFIRMED` y `CREATED → CANCELLED`. Nada más.

### 4.3 `Sale` — sin estados nuevos

`READY_FOR_PAYMENT → PAYMENT_IN_PROGRESS → COMPLETED`, exactamente como
`UC-SALES-002` y `MIGRATION_010` ya los fijan.

## 5. `Sale → Payment → Completion` — decisión central

### 5.1 Propiedad de cada transición

| Transición | Dueño | Escribe |
|---|---|---|
| `READY_FOR_PAYMENT → PAYMENT_IN_PROGRESS` | Sales | `sales_sales` |
| `Payment CREATED → CONFIRMED` | Payments | `payments_*` |
| asiento de efectivo | **Cash** (puerto), nunca Payments | `cash_movement` |
| `PAYMENT_IN_PROGRESS → COMPLETED` | Sales | `sales_sales` |

Ningún módulo escribe tablas de otro. La coordinación vive en un caso de uso de
la capa de aplicación que compone repositorios dentro de **una** unidad de
trabajo, tal como `payments-schema.md` §Fronteras ya exige para efectivo.

### 5.2 Completion es automática y transaccional

**La venta se completa dentro de la misma transacción local que confirma el
pago que hace suficiente la cobertura.** No existe una operación IPC
`sale.complete` en V1.

Justificación: cualquier diseño con dos operaciones separadas admite el estado
«pago confirmado, venta sin completar», que exigiría un proceso de reparación.
Al ser la misma transacción SQLite, ese estado es **inexpresable**: o se
confirman pago y venta, o no se confirma ninguno.

Esto es posible porque V1 no llama a ningún proveedor (§2.4): toda la
confirmación es local, y el único escritor de SQLite es el POS Local Service.

### 5.3 Las tres fronteras transaccionales

```
T1  REGISTRO  (una transacción)
    ├─ PaymentGroup (si no existe)          ← UNIQUE por sujeto
    ├─ Payment CREATED  +  Attempt CREATED
    ├─ Sale: READY_FOR_PAYMENT → PAYMENT_IN_PROGRESS   (guard version)
    ├─ runtime_operations · local_operation_audit · outbox
    └─ [si CASH] continúa en T2 dentro de la MISMA transacción

  ── frontera con el exterior: en V2, aquí y sólo aquí va la llamada al
     proveedor, FUERA de toda transacción, con la intención ya persistida ──

T2  CONFIRMACIÓN  (una transacción)
    ├─ Attempt → CONFIRMED       (guard: estado + version)
    ├─ Payment → CONFIRMED
    ├─ PaymentAllocation (importe imputado a la Sale)
    ├─ [si CASH] Cash port: append CashMovement CASH_SALE / IN / POSTED
    ├─ recomputar cobertura confirmada DESDE allocations
    └─ si cobertura ≥ payable_amount → T3 en la MISMA transacción

T3  COMPLETION  (misma transacción que T2)
    ├─ Sale: PAYMENT_IN_PROGRESS → COMPLETED, completed_at, version+1
    └─ audit SALE_COMPLETED · outbox
```

Para `CASH`, `T1`+`T2`+`T3` son **una sola transacción**: registro,
confirmación, asiento de caja y completion. Para `TRANSFER`, `T1` es una
transacción (reporte) y `T2`+`T3` otra (confirmación), separadas por una acción
humana.

### 5.4 Lo que NO puede ser atómico

- Una llamada a proveedor externo. Prohibido por `payments-schema.md` §Fronteras
  y por física distribuida. **V1 no tiene ninguna.**
- La entrega de la respuesta IPC al llamador. Se resuelve con idempotencia
  (§7), no con transaccionalidad.

### 5.5 Guarda de completion — invariante duro

`Sale → COMPLETED` **sólo** si, recomputado **dentro de la transacción** desde
`payments_payment_allocations`:

```
Σ allocations(sale, CONFIRMED) ≥ sales_sales.payable_amount
```

La cobertura **nunca** se toma de un valor recibido, cacheado ni proyectado
fuera de la transacción. Sin esta regla, `READY_FOR_PAYMENT → COMPLETED` sin
pago válido sería alcanzable.

## 6. Abstracción de proveedor

V1 no implementa ningún proveedor, pero fija dónde vivirá la costura.

**El dominio conoce exactamente esto y nada más:**

```
PaymentProviderPort
  authorize(intent) -> ProviderOutcome
```

donde `intent` transporta `{ attempt_id, amount, currency, method,
idempotency_key }` y `ProviderOutcome` es un tipo cerrado:

```
CONFIRMED { provider_reference, provider_reported_at, evidence }
DECLINED  { error_code }
PENDING   { provider_reference? }
UNKNOWN   { }            ← timeout, corte, respuesta ilegible
```

Reglas:

1. `UNKNOWN` es un resultado **de primera clase**, no una excepción. `PAY-007`
   regla 14: ningún proceso infiere éxito por timeout. Tampoco fracaso.
2. El dominio `MUST NOT` conocer SDKs, cliente HTTP, API keys, ni framework de
   webhook (`payments-schema.md` §neutralidad).
3. El puerto se invoca **fuera** de toda transacción de base de datos.
4. La intención `MUST` estar persistida y ser recuperable antes de invocarlo.
5. Webhook y polling son **entradas no confiables**: verifican autenticidad,
   replay, referencia, importe, moneda, tenant y transición antes de producir
   estado autoritativo (`payments-schema.md` §attempts). El frontend jamás envía
   éxito financiero autoritativo.

Cuatro variantes y un método: es lo mínimo que V2 necesita, y no más.

## 7. Idempotencia

### 7.1 Cuatro planos, no uno

| Plano | Clave | Protege | Alcance |
|---|---|---|---|
| Local | `idempotency_key` | repetir la **operación** | `UNIQUE (tenant_id, origin_device_id, idempotency_key)` |
| Hacia proveedor | la misma clave, propagada | doble cobro externo | V2 |
| Referencia externa | `provider_reference` | doble registro del mismo hecho | `UNIQUE (tenant_id, provider_code, provider_reference_type, provider_reference)` |
| Identidad | `payment_id` | el componente | PK |

### 7.2 Generación y custodia

La genera **el llamador** (renderer → Electron main → servicio) y la conserva
para el reintento; el servicio la persiste en la fila. Es la misma disciplina de
`4C`/`4D`: el llamador no aporta identidad ni ámbito (`DEC-014` §3.4), pero sí
aporta *la clave de su propia intención*, que es un dato de la petición, no una
afirmación de autoridad.

### 7.3 Comportamiento

| Situación | Resultado |
|---|---|
| Reintento con misma clave y mismo checksum | resultado original, sin efecto nuevo — `IDEMPOTENT` |
| Misma clave, payload distinto | `IDEMPOTENCY_CONFLICT` |
| Respuesta perdida tras commit | el reintento devuelve el resultado original |
| Dos peticiones concurrentes | SQLite tiene un único escritor; la segunda ve la fila y devuelve `IDEMPOTENT` |
| Timeout de proveedor | V2: `UNKNOWN` persistido; **jamás** `FAILED` inferido |

### 7.4 El agujero que la idempotencia NO tapa — y qué lo tapa

Si el operador registra **dos pagos con claves distintas** para la misma venta,
la unicidad no lo impide: son dos intenciones legítimamente distintas.

Lo que lo impide es la **invariante de cobertura**: dentro de la transacción,
si la cobertura confirmada resultante superaría `payable_amount`, la
confirmación se rechaza como `OVERPAYMENT_NOT_ALLOWED`, conforme a `DEC-002`
(«el sistema debe impedir el sobrepago antes de confirmarlo cuando sea
técnicamente posible»).

**La protección real contra el doble cobro es la cobertura, no la clave.**
Registrarlo explícitamente evita confiar en la garantía equivocada.

## 8. Autorización

Patrón idéntico a `DEC-014`/`DEC-015`, sin excepción.

Actor: `createActor("USER", authSnapshot.claims.user_id)` — tipo literal, id del
snapshot verificado. Ámbito: configuración local. Sesión: `connectionId`
asignado por el servidor (`DEC-015`).

| Operación | Permiso canónico |
|---|---|
| Registrar pago (efectivo o reporte de transferencia) | `PAYMENTS_PAYMENT_REGISTER` |
| Reportar transferencia | `PAYMENTS_TRANSFER_REPORT` *(ya canónico)* |
| Confirmar transferencia | `PAYMENTS_TRANSFER_CONFIRM` *(ya canónico)* |
| Cancelar pago no confirmado | `PAYMENTS_PAYMENT_CANCEL` |
| Consultar pago | `PAYMENTS_PAYMENT_READ` |
| Completar venta | sin permiso propio: es efecto de la confirmación (§5.2) |

**Segregación:** `PAYMENTS_TRANSFER_REPORT` y `PAYMENTS_TRANSFER_CONFIRM` son
permisos distintos precisamente para que reportar y confirmar puedan exigirse a
personas distintas. V1 no fuerza que el actor difiera, pero el modelo lo
permite sin cambio.

### 8.1 Superficie IPC futura a validar

`payment.register` · `payment.transfer.confirm` · `payment.cancel` ·
`payment.get` — y sus canales Electron `pos:*` correspondientes (`DEC-014`
§3.2). Cada una:

- rechaza en el sobre `tenant_id`, `company_id`, `branch_id`, `device_id`,
  `actor_id` (`forbidCallerAssertedIdentity`);
- no admite en el payload `user_id`, `actor_type`, permisos **ni
  `confirmed_amount` decidido por el cliente**;
- exige `operation_id` + `idempotency_key` en las mutantes;
- resuelve identidad por `connectionId`, nunca por la petición.

**El renderer nunca afirma que un pago fue confirmado.** Envía la intención; la
capa confiable decide.

## 9. Fallo y recuperación

### 9.1 Matriz

| # | Escenario | Resultado V1 | Estado | Idempotencia | Audit | Recuperación |
|---|---|---|---|---|---|---|
| A | Pago exitoso | `CONFIRMED` (+ Sale `COMPLETED` si cubre) | `CONFIRMED` | clave persistida | `PAYMENT_CONFIRMED` (+`SALE_COMPLETED`) | — |
| B | Pago rechazado | **inalcanzable en V1** (no hay proveedor) | — | — | — | — |
| C | Timeout de proveedor | **inalcanzable en V1** | — | — | — | V2: `UNKNOWN` |
| D | Proveedor responde tras timeout | **inalcanzable en V1** | — | — | — | V2: resuelve `UNKNOWN` |
| E | Cliente reintenta | resultado original | sin cambio | `IDEMPOTENT` | sin asiento nuevo | — |
| F | Dos peticiones concurrentes | una gana; la otra `IDEMPOTENT` o `VERSION_CONFLICT` | consistente | clave + `version` | un solo asiento | — |
| G | Respuesta HTTP/IPC perdida tras commit | reintento devuelve el original | sin cambio | `IDEMPOTENT` | sin duplicado | — |
| H | DB local falla tras confirmación externa | **inalcanzable en V1** | — | — | — | V2: intención persistida + `UNKNOWN` |
| I | Referencia de proveedor duplicada | rechazo por unicidad | sin cambio | `UNIQUE` provider ref | rechazo auditado | — |
| J | Pago ya confirmado | `ALREADY_CONFIRMED` | `CONFIRMED` | — | rechazo auditado | — |
| K | Venta ya completada | `SALE_ALREADY_COMPLETED` | `COMPLETED` | — | rechazo auditado | — |
| L | Pago de otra venta | `SALE_NOT_FOUND` / `SUBJECT_MISMATCH` | sin cambio | — | rechazo auditado | — |
| M | Pago de otro tenant/company/branch | `SALE_NOT_FOUND` | sin cambio | — | rechazo auditado | ámbito de config, no de la petición |
| N | Actor no autorizado | `UNAUTHORIZED` | sin cambio | — | rechazo auditado | — |
| O | Efectivo con turno cerrado | `CASH_SHIFT_NOT_OPEN` | sin cambio | — | rechazo auditado | §10.3 |
| P | Cobertura excedida | `OVERPAYMENT_NOT_ALLOWED` | sin cambio | — | rechazo auditado | §7.4 |
| Q | Venta no está en estado pagable | `SALE_NOT_PAYABLE` | sin cambio | — | rechazo auditado | — |

### 9.2 `B`, `C`, `D`, `H` — por qué «inalcanzable» no es una evasión

Los cuatro exigen una llamada saliente. V1 no emite ninguna (§2.4). Declararlos
inalcanzables es **más honesto** que escribir un manejo que nadie podrá probar,
y no crea deuda: el modelo (`PaymentAttempt`, `UNKNOWN`, intención persistida,
puerto de §6) ya está dimensionado para cuando existan.

### 9.3 Invariante de subconjunto

Un `Payment` o `PaymentAttempt` en `PENDING`, `PARTIALLY_CONFIRMED`, `FAILED`,
`PROCESSING`, `REQUIRES_ACTION`, `EXPIRED`, `DECLINED`, `UNKNOWN` o
`REVIEW_REQUIRED` **en una base V1 es un defecto**, no un estado de negocio.
Debe ser detectable por prueba.

## 10. Frontera con Cash

### 10.1 Regla

Payments **no escribe `cash_movement`**. Invoca un puerto propiedad de Cash que
añade el movimiento dentro de la misma transacción local.

### 10.2 Correspondencia

| Hecho | `movement_type` | `direction` | `status` |
|---|---|---|---|
| Pago en efectivo confirmado | `CASH_SALE` | `IN` | `POSTED` |

El movimiento entra automáticamente en el pliegue de `expectedCash` del cierre
4D (`IN` suma). **Cash V1 no se modifica**: `CASH_SALE`, `IN` y `POSTED` ya
existen en `MIGRATION_009`.

### 10.3 Precondición dura

Un pago en efectivo exige que `sales_sales.cash_shift_id` sea no nulo **y** que
ese turno esté `OPEN`. Si el turno se cerró, se rechaza con
`CASH_SHIFT_NOT_OPEN`.

Sin esta guarda, un pago podría asentar dinero en un turno ya cuadrado y
cerrado, falseando su arqueo retroactivamente. El `FOREIGN KEY` a `cash_shift`
resolvería igual: la integridad referencial **no** protege de esto, sólo la
guarda de estado.

### 10.4 Dependencia que el bloque de implementación deberá satisfacer

`SqliteCashShiftStore` hoy sólo inserta el `OPENING_FLOAT` dentro de `open()`.
Payment V1 exige **añadir** un método de aposición de movimiento que asigne
`shift_sequence` (= `cash_shift.last_movement_sequence + 1`, propiedad de Cash).

Es una **adición** al almacén de Cash, no una modificación de la semántica de
Cash V1, y `NOT YET MATERIALIZED`. Se registra aquí porque es la única
dependencia de Payment sobre un módulo cerrado.

### 10.5 Vuelto — decisión V1

V1 asienta el **neto**: un solo `CASH_SALE` por el importe imputado a la venta.
El importe entregado por el cliente y su vuelto son cálculo de interfaz y no se
persisten.

`expectedCash` es idéntico bajo ambas convenciones, de modo que el arqueo no
pierde nada. Se pierde forensia de tender (detectar vuelto sistemáticamente
erróneo). `CHANGE_GIVEN` permanece disponible en `MIGRATION_009` para un bloque
posterior que la necesite; adoptarlo **no exige cambio de modelo**. Decisión
reversible, registrada en §16.

## 11. Auditoría y outbox

### 11.1 Eventos mínimos

| Evento | Tipo | Transaccional | Cuándo |
|---|---|---|---|
| `PAYMENT_REGISTERED` | dominio + outbox | sí | `T1` |
| `PAYMENT_CONFIRMED` | dominio + outbox | sí | `T2` |
| `PAYMENT_CANCELLED` | dominio + outbox | sí | cancelación |
| `SALE_COMPLETED` | dominio + outbox | sí | `T3` |

Cuatro eventos. No se crean más: `PAYMENT_FAILED`, `PAYMENT_PENDING` y
`PAYMENT_REVIEW_REQUIRED` corresponden a estados que V1 no alcanza (§9.3), y
emitirlos sería declarar una capacidad inexistente.

### 11.2 Reglas

- `aggregate_type = "PAYMENT"` / `"SALE"`; `operation_type` conforme a
  `STABLE_CODE_PATTERN`.
- Audit y outbox se escriben **dentro** de la misma transacción que el hecho,
  igual que en `4C`/`4D`. Un pago sin rastro es inexpresable.
- `actor_type = 'USER'`, `actor_id` del snapshot verificado.
- Los rechazos de §9 son auditables: un rechazo silencioso `MUST NOT` ocurrir.

## 12. Persistencia futura — `NOT YET MATERIALIZED`

**No se crea `MIGRATION_011`.** Diseño conceptual únicamente.

| Tabla | Propósito | PK | Unicidad crítica | Índices |
|---|---|---|---|---|
| `payments_payment_groups` | intención de cobro por sujeto | `(tenant_id, id)` | `(tenant_id, branch_id, collection_subject_type, collection_subject_id)` | por sujeto |
| `payments_payments` | componente de cobro | `(tenant_id, id)` | `(tenant_id, origin_device_id, idempotency_key)`; `operation_id` | `(tenant_id, payment_group_id)`; `(tenant_id, branch_id, status)` |
| `payments_payment_attempts` | intento técnico | `(tenant_id, id)` | `(tenant_id, payment_id, attempt_number)`; `(tenant_id, provider_code, provider_reference_type, provider_reference)` cuando existan | `(tenant_id, payment_id)` |
| `payments_payment_allocations` | imputación confirmada | `(tenant_id, id)` | `(tenant_id, payment_id, allocation_sequence)` | `(tenant_id, collection_subject_type, collection_subject_id)` ← **soporta la guarda de §5.5** |

Campos críticos por tabla conforme a `payments-schema.md` §grupos/§payments/
§allocations/§attempts, sin desviación. Dinero `TEXT` escala 6 con los mismos
`CHECK` de `sales_sales`. `version` entero para bloqueo optimista.
`FOREIGN KEY (operation_id) REFERENCES runtime_operations(operation_id)`, igual
que `sales_sales`.

**`sales_sales` no requiere `ALTER`.** `status`, `version` y `completed_at` ya
existen, y la referencia vive en `PaymentGroup` hacia `Sale`, no al revés. La
futura migración es **puramente aditiva**.

`payments_refunds` y `payments_refund_items` quedan fuera de V1.

## 13. Confirmación visual y sonora — ubicación, no implementación

**No se implementa.** Se fija dónde podrá engancharse sin riesgo.

### 13.1 Las cuatro cosas que no son lo mismo

```
respuesta del proveedor ≠ autorización de pago
        ≠ pago confirmado ≠ venta completada ≠ confirmación en UI
```

Un sonido disparado por cualquiera de las tres primeras miente al operador.

### 13.2 Punto seguro

El evento `SALE_COMPLETED` (§11.1) es el «cha-ching»: es el único que significa
«cobertura suficiente, confirmada y persistida». `PAYMENT_CONFIRMED` sobre un
pago parcial **no** debe sonar como venta cobrada; admite a lo sumo una señal
distinta y menor.

### 13.3 Cómo se evita el sonido duplicado

El resultado IPC distingue la transición real del reintento —`COMPLETED` frente
a `SALE_ALREADY_COMPLETED`, `CONFIRMED` frente a `IDEMPOTENT`—, exactamente
como `4D` distingue `CLOSED` de `IDEMPOTENT`. **La UI sólo suena con el
resultado no idempotente.** Un reintento nunca vuelve a sonar.

### 13.4 Cómo se evita el sonido sin pago real

La UI no decide: reacciona a un resultado emitido por la capa confiable tras
commit. No existe camino por el que el renderer produzca ese resultado por su
cuenta (`DEC-014` §3.4, `DEC-015` §5.7).

## 14. Matriz de pruebas futura

| Categoría | Casos críticos |
|---|---|
| **Domain** | transiciones válidas; transición inválida rechazada; subconjunto V1 (§9.3) inalcanzable; aritmética `BigInt` exacta; moneda coincide |
| **Application** | registro efectivo confirma y completa en una transacción; reporte de transferencia deja `CREATED`; confirmación completa; pago mixto acumula cobertura; cancelación libera |
| **Persistence** | rollback deja cero filas; unicidad de idempotencia; unicidad de grupo por sujeto; unicidad de referencia externa; FK compuesta cross-tenant |
| **Provider adapter** | *(V2)* `UNKNOWN` no infiere éxito ni fracaso; webhook falso/replay rechazado; mismatch de importe/moneda rechazado |
| **IPC** | sobre con `tenant_id`/`actor_id` rechazado; payload con `user_id` o `confirmed_amount` rechazado; mutante sin `idempotency_key` rechazado |
| **Security** | sin permiso → `UNAUTHORIZED`; sin sesión vinculada → `SESSION_NOT_BOUND`; venta de otro tenant no visible; `PAYMENTS_TRANSFER_CONFIRM` exigido y distinto de `REPORT` |
| **Idempotency** | reintento igual → `IDEMPOTENT` sin efecto; payload distinto → `IDEMPOTENCY_CONFLICT`; sin `CashMovement` duplicado |
| **Concurrency** | dos confirmaciones concurrentes → un solo asiento; `version` protege completion; sin doble `COMPLETED` |
| **Failure recovery** | respuesta perdida → reintento devuelve original; turno cerrado → rechazo; sobrepago → rechazo; venta ya completada → rechazo |
| **Cash boundary** | `CASH_SALE` entra en `expectedCash`; turno cerrado rechaza; `shift_sequence` monotónico; Cash V1 sin regresión |

## 15. Revisión crítica del propio diseño

| Riesgo buscado | Veredicto |
|---|---|
| Doble cobro | Cubierto por la **invariante de cobertura** (§7.4), no por la clave. Registrado explícitamente para no confiar en la garantía equivocada. |
| Doble `Payment` | Unicidad `(tenant, device, idempotency_key)` + cobertura. |
| Doble completion | `status` terminal + `version` + escritor único. |
| Race conditions | SQLite de escritor único serializa; guardas de `version` en Sale y Payment. |
| Identidad falsificable | `connectionId` del servidor (`DEC-015`); actor del SAS. |
| Ámbito falsificable | Ámbito de configuración; el sobre rechaza los campos de identidad. |
| Idempotencia insuficiente | **Sí, aislada:** claves distintas para la misma venta no colisionan → §7.4 lo cubre con cobertura. |
| Timeout mal modelado | V1 no lo alcanza; V2 tiene `UNKNOWN` de primera clase y prohibición de inferir por timeout. |
| Webhook/reconciliación futura incompatible | `PaymentAttempt` con `provider_reference` único y `UNKNOWN` resoluble a posteriori: compatible. |
| Acoplamiento a proveedor | Puerto de un método y cuatro variantes; `provider_code` es metadato. |
| Pérdida de audit | Audit y outbox en la misma transacción que el hecho. |
| Estados imposibles | Subconjunto V1 declarado y comprobable (§9.3). |
| `READY_FOR_PAYMENT → COMPLETED` sin pago | Imposible: guarda de §5.5 recomputa desde allocations dentro de la transacción. |
| **Dinero en turno cerrado** | Hallado en revisión: la FK no protege. Guarda de estado añadida en §10.3. |
| **Payments escribiendo caja** | Hallado en revisión: exige puerto de Cash y `shift_sequence` propiedad de Cash (§10.4). |

## 16. Decisiones diferidas

| # | Decisión | Estado |
|---|---|---|
| D-1 | `CARD`/`QR`/`NEQUI` con proveedor integrado y sus adapters | `NOT_EVALUATED` |
| D-2 | Webhooks, polling y reconciliación automática | `NOT_EVALUATED` |
| D-3 | `Refund`, `Reversal`, `Settlement`, `Reconciliation`, `Chargeback` | `DOCUMENTED` (UC-PAY-004/005, PAY-007) · fuera de V1 |
| D-4 | Crédito autorizado como cobertura (`DEC-002` §excepción) | `DOCUMENTED` · fuera de V1 |
| D-5 | Captura de tendered/vuelto con `CHANGE_GIVEN` (§10.5) | diferida; reversible sin cambio de modelo |
| D-6 | Confirmación de transferencia por actor distinto del que reporta | permitida por el modelo; no forzada en V1 |
| D-7 | Sonido y confirmación visual (§13) | ubicación fijada; implementación diferida |
| D-8 | `MIGRATION_011` con las cuatro tablas de §12 | `NOT YET MATERIALIZED` |
| D-9 | Método de aposición de movimiento en el almacén de Cash (§10.4) | `NOT YET MATERIALIZED` |
| D-1/D-2 | Adapter Wompi (checkout, consulta y webhook) | parcialmente `MATERIALIZED` en `feat/payment-qr-provider-foundation`; ver §19 (desvío respecto de §6) y §20 (reconciliación bajo demanda + `MIGRATION_016` + `redirect-url` + wiring de Electron + `STILL_PENDING` conectado; barrido automático y aprovisionamiento productivo siguen `NOT_YET_MATERIALIZED`) |

> **PENDIENTE DE ACTUALIZACIÓN — recuperación de alcance del 2026-09-19.** La
> fila `D-1/D-2` de esta tabla describe el estado de la rama **antes** de la
> recuperación de alcance del 2026-09-19. De lo que enumera, siguen
> materializados el checkout (incluido `redirect-url`), la consulta
> `GET /v1/transactions/{id}` y el webhook; fueron **retirados de la línea
> activa** la reconciliación bajo demanda, `MIGRATION_016`, el wiring de
> Electron y la conexión de `STILL_PENDING`. La fila no se reescribe: el aviso
> al inicio de §20 tiene el detalle y `D-2` sigue abierta.

## 17. Invariantes de Payment V1

1. Un `Payment` confirmado nunca se modifica destructivamente (`DEC-002`).
2. Una corrección financiera es una operación nueva, jamás una sobrescritura.
3. La cobertura se recomputa desde `allocations` dentro de la transacción.
4. `Sale → COMPLETED` exige cobertura suficiente comprobada, nunca declarada.
5. Ninguna llamada externa comparte transacción local.
6. Ningún timeout infiere éxito ni fracaso.
7. El efectivo confirmado siempre produce exactamente un asiento de caja.
8. El efectivo exige turno `OPEN`.
9. El renderer no afirma identidad, ámbito, autoridad ni importe confirmado.
10. Todo hecho y todo rechazo son auditables dentro de su transacción.

## 18. Gobernanza

`PAY-007` sigue siendo la única autoridad de estados. `payments-schema.md` sigue
siendo el contrato físico. Este documento **no los amplía**: los restringe a un
subconjunto V1 y fija la orquestación local.

La materialización exigirá autorización explícita que nombre las tablas, al modo
en que `DEC-012` D5 nombró las de Cash. Ningún `SEC-Gxx` cambia de estado.

## 19. Nota posterior — desvío verificado respecto de §6 (2026-09-18)

Al materializar el adapter Wompi en `feat/payment-qr-provider-foundation`
(`apps/pos-local-service/src/payments/payment-provider-port.ts`, ya integrado
en esa rama antes de esta nota) se verificó que el contrato realmente
implementado **no** es el `ProviderOutcome` de cuatro variantes que fija §6.

**Lo que existe de verdad:**

```
PaymentProviderPort
  createPaymentIntent(intent)      -> PaymentProviderIntentResult
  getPaymentStatus(providerReference) -> PaymentProviderEvidence
  normalizeNotification(payload)   -> PaymentProviderEvidence
```

`PaymentProviderEvidence.status` es `"PENDING" | "APPROVED" | "REJECTED"` — un
subconjunto cerrado de tres estados, **sin `UNKNOWN`**. `DECLINED`, `VOIDED` y
`ERROR` de Wompi se pliegan sobre `REJECTED`
(`apps/pos-local-service/src/payments/wompi/wompi-transaction.ts`,
`mapWompiStatus`).

**Por qué no se corrigió el código en vez del documento:** modificar el puerto
para agregar `UNKNOWN` fue explícitamente prohibido al autorizar este trabajo,
precisamente para no acomodarlo *ad hoc* a un solo proveedor sin una decisión
deliberada. La regla 1 de §6 (*"ningún proceso infiere éxito por timeout;
tampoco fracaso"*) se preserva de todos modos: ante timeout, error HTTP o
respuesta ilegible, el cliente Wompi (`wompi-http-client.ts`) lanza una
excepción tipada (`WompiTimeoutError`, `WompiHttpError`,
`WompiMalformedResponseError`, `WompiNetworkError`) en vez de forzar
`REJECTED` — pero eso es una excepción no tipificada por el contrato de
retorno, no el resultado de primera clase que §6 exige.

**Brecha adicional encontrada, sin resolver:** `getPaymentStatus` recibe
`{ providerReference }`, pero la única consulta real de Wompi
(`GET /v1/transactions/{id}`) es por `transaction.id` propio de Wompi, nunca
por la referencia que el comerciante genera al crear el checkout. Hoy este
método no tiene ningún llamador productivo (no existe polling ni
reconciliación — D-2 sigue `NOT_EVALUATED` en ese sentido), así que se decidió
no fijar su firma todavía: la decisión correcta depende de cómo se diseñe la
reconciliación real, no al revés.

**Disposición:** esta nota dispensa el desvío frente a §6, no lo ratifica como
diseño final. Si `D-2` (webhooks/polling/reconciliación) se materializa,
`PaymentProviderPort` deberá revisarse formalmente contra esta sección —con
autorización explícita— antes de asumir que el subconjunto de tres estados
es definitivo.

## 20. Reconciliación bajo demanda — `ReconcileProviderPaymentUseCase` (2026-09-18)

> **PENDIENTE DE ACTUALIZACIÓN — recuperación de alcance del 2026-09-19.**
>
> El código descrito en **§20.1, §20.2, §20.4 y §20.5** fue **retirado de la
> línea activa** de `feat/payment-qr-provider-foundation` el 2026-09-19: se
> materializó fuera del alcance autorizado de esta rama (la capa de autoridad
> de Wompi), sin haber resuelto antes las decisiones D-2/D-3 ni las
> sub-decisiones SD-1/SD-2/SD-3. Concretamente dejaron de existir en la rama:
> `reconcile-provider-payment-use-case.ts` (+ su test),
> `apps/pos-desktop/src/qr-checkout-window.ts` (+ su test), `MIGRATION_016`,
> los canales `pos:payment.qr.checkout.open` y `payment.qr.reconcile`, y
> `SqlitePaymentStore.recordObservedProviderTransaction` /
> `getObservedProviderTransaction`.
>
> **§20.3 (`redirect-url` en `buildWompiWebCheckout`) NO fue retirada**: sigue
> `MATERIALIZED`/`TESTED` en la rama.
>
> Estas secciones **no se borran ni se reescriben**: son evidencia histórica
> válida de lo que se diseñó, se implementó y se probó, y el código es
> recuperable de la historia de git (`67d4d5d`, `abe73da`). Léelas como
> registro de un trabajo retirado, no como descripción del estado actual de la
> rama. Su reescritura queda pendiente de la decisión formal sobre D-2.

Primer materializado de `D-2`, acotado: **no** es el "polling automático"
completo que D-2 nombra, sino la pieza que ese polling necesitaría de todos
modos. Verificado contra la documentación real de Wompi antes de diseñar
(no asumido):

- El redirect de Web Checkout es explícitamente **"informativo únicamente,
  nunca un método de validación"** según la documentación de Wompi — igual
  que exige la regla 5 de §6 ("el frontend jamás envía éxito financiero
  autoritativo"). Sólo sirve para *aprender* el `transaction.id` real.
- El webhook sigue siendo la vía primaria; esta reconciliación es la vía de
  respaldo cuando el webhook se demora, se pierde, o el redirect llega
  primero.
- Wompi documenta su propio endpoint de estado como consulta **por
  `transaction.id`**, recomendando explícitamente re-consultarlo
  periódicamente — nunca por referencia del comerciante. Confirma la brecha
  de §19: sin un `transaction.id` ya conocido, no hay nada que reconciliar.

### 20.1 Lo que existe

`apps/pos-local-service/src/payments/reconcile-provider-payment-use-case.ts` —
recibe `{ paymentId, providerTransactionId }`, exige
`PAYMENTS_PAYMENT_READ` (única lectura de la autoridad del proveedor),
descarta pagos que no son `QR`/`PENDING` sin llamar a Wompi, y aplica el
veredicto:

- `APPROVED` → delega en `ConfirmProviderPaymentUseCase` **sin modificarlo**;
  la protección real contra doble confirmación son sus guardas existentes
  (estado `PENDING`/`CREATED`, unicidad de `provider_transaction_id`), no la
  clave de idempotencia de esta llamada — cada invocación genera la suya
  propia a propósito (ver el comentario de la clase).
- `PENDING` → `STILL_PENDING`, sin escribir nada.
- `REJECTED` → `PROVIDER_REJECTED` con la evidencia; **no cancela el pago**.
  Cancelar es autoridad del operador (`CancelPaymentUseCase`, ya existente);
  mezclarlo aquí habría sido una decisión de producto no pedida.
- Error del cliente Wompi (timeout/HTTP/malformado) → se propaga tal cual;
  esta capa no infiere estado ante una consulta fallida.

9 tests unitarios, `TESTED` en este turno (mocks de store/provider/confirm,
sin red).

### 20.2 `MIGRATION_016` — el `transaction.id` aprendido, persistido (2026-09-18)

Autorizada explícitamente y nombrando la tabla, como exige §18. Cierra el
bloqueo que impedía el barrido en segundo plano: hasta ahora
`payments_payment_attempts` sólo escribía un `transaction.id` de Wompi **en
el momento de confirmar** (`confirmProviderPayment`); no había dónde anotar
uno aprendido antes, por ejemplo desde el redirect de checkout.

- `payments_payment_attempts.observed_provider_transaction_id` /
  `.observed_provider_transaction_at` — nullable, ambos o ninguno
  (`CHECK`). **No autoritativo**: aprenderlos no mueve
  `payments_payments.status` ni `payments_payment_attempts.status`; sólo
  `confirmProviderPayment` sigue teniendo esa autoridad.
- Índice único `(tenant_id, provider_code, observed_provider_transaction_id)`
  — el mismo `transaction.id` de Wompi no puede quedar "observado" en dos
  intentos del mismo tenant, con la misma disciplina que ya aplica
  `payments_payment_attempts_provider_reference_idx` a la referencia
  confirmada.
- Índice de apoyo `(tenant_id, status, observed_provider_transaction_at)
  WHERE status='PENDING' AND observed_provider_transaction_id IS NOT NULL` —
  anticipa la consulta que el futuro barrido necesitará, sin implementarlo.
- Tabla reconstruida (`CREATE` → `INSERT...SELECT` → `DROP` → `RENAME`),
  igual que `MIGRATION_008`: SQLite no permite alterar un `CHECK` existente.
- **Sólo SQLite.** PostgreSQL central no tiene ninguna tabla de `payments_*`
  materializada todavía (`payments-schema.md` es el contrato físico, pero
  `tools/target-migrations` no lo aplica) — no hay dialecto que actualizar en
  paralelo; no es una migración a medias, es que el otro lado no existe aún.

`SqlitePaymentStore.recordObservedProviderTransaction` /
`.getObservedProviderTransaction` — escritura y lectura mínimas, localizan el
mismo intento `QR`/`PENDING` que `confirmProviderPayment` usaría. Ninguna
usada todavía por `ReconcileProviderPaymentUseCase`: conectarlas es parte del
wiring de §20.3, no de esta migración.

`TESTED` este turno: `pnpm --filter @pos-platform/database-sqlite test`
(37/37, migración aplica limpio sobre el ledger real) y 5 pruebas de
integración nuevas en `apps/pos-local-service/tests/payment.test.ts` contra
un `LocalDatabase` real — round-trip, `PAYMENT_NOT_FOUND`,
`PAYMENT_NOT_RECONCILABLE` tras confirmar, y los dos `CHECK`/`UNIQUE` de la
migración disparando de verdad, no simulados.

`pnpm test:migrations:sqlite` (el comando que documenta este archivo) también
corrió y dio PASS, pero **no prueba esta migración**: ese comando ejecuta
`tools/target-migrations/tests/sqlite-migration.test.ts`, que valida un
ledger de ejecución distinto (`001_local_migration_control`), no
`MIGRATION_016` ni ninguna del array de `local-database.ts`. Se deja
constancia para que un PASS de ese comando no se lea como evidencia de esta
migración.

### 20.3 `redirect-url` en `buildWompiWebCheckout` (2026-09-19)

`WompiCheckoutCredentials.redirectUrl` — opcional, validado (`new URL(...)`,
rechaza vacío o mal formado), y **no forma parte del checksum de
integridad**: `signature:integrity` sólo firma
`reference`+`amount-in-cents`+`COP`+`integritySecret`, verificado con una
prueba que compara la firma con y sin `redirect-url` presente.

Acepta cualquier esquema absoluto, incluido un protocolo custom de Electron
(`pos-camacho://...`) — el destino real todavía no está decidido (es parte
del wiring de §20.4 punto 2), así que el validador no se ata a `https:`.

Sigue siendo, por diseño, un dato **no autoritativo**: el comentario en
`WompiCheckoutCredentials` y `DEC-016` §20 mismo repiten la advertencia
textual de Wompi ("informativo únicamente, nunca un método de validación").
Que este campo exista no cambia esa regla ni la relaja.

`TESTED` este turno: 6 pruebas nuevas en `wompi-checkout-builder.test.ts`
(omitido por defecto, valor propagado tal cual, esquema custom aceptado,
firma sin cambios, vacío y mal formado rechazados) + toda la suite de
`payments/wompi` (47/47) y de la app completa (572/576, mismos 4 skips
preexistentes de plataforma). `ARCH-003` y `ci:repository-policy` PASS.

### 20.4 Wiring del redirect en Electron (2026-09-19)

Cierra el punto 3 de §20.5 (antigua numeración): el `id` que Wompi devuelve
al redirigir ahora tiene un camino real, de extremo a extremo, hasta
`ReconcileProviderPaymentUseCase` — sin tocar `PaymentProviderPort` ni
inventar autoridad nueva en ningún punto del camino.

**`apps/pos-desktop/src/qr-checkout-window.ts` — `QrCheckoutWindowManager`.**
Abre el checkout en una `BrowserWindow` propia (mismo
`WINDOW_SECURITY_CONFIG.webPreferences` que la ventana principal, **sin
preload**: nunca tiene `posService` ni ninguna API del proceso principal —
es una ventana de navegador corriente mostrando la página de Wompi).
Observa `will-navigate` y `will-redirect` (ambos cancelables, antes de que
la navegación se comprometa — nunca `did-navigate`, que dispara después);
cuando la URL navegada coincide en origen **y** ruta exactos con el
`redirect-url` configurado, extrae `id` y cierra la ventana. Cualquier otra
navegación (banco, 3DS) pasa de largo sin tocarla. `WOMPI_CHECKOUT_RETURN_URL`
es un sentinel provisional — quien aprovisione
`WompiCheckoutCredentials.redirectUrl` del lado del servicio local debe usar
exactamente el mismo valor; ese aprovisionamiento sigue sin existir.

Un test expuso un bug real antes de llegar a `main`: el `close()` de la
ventana dispara `"closed"` de forma síncrona en algunos caminos, y
`settle(CLOSED_BY_USER)` ganaba la carrera contra `settle(REDIRECTED)` por
orden de llamada. Se corrigió resolviendo primero, cerrando después —
`settle` ya era idempotente, pero el orden importaba.

**`pos:payment.qr.checkout.open` — canal nativo, no comercial.** Vive en
`NATIVE_IPC_CHANNELS` (`ipc-allowlist.ts`), deliberadamente separado de
`IPC_ALLOWED_CHANNELS`: `ChannelBridge` reenvía todo lo segundo al servicio
local, y abrir una ventana no es una operación que el servicio deba conocer.
`main.ts` lo registra por su cuenta, pasando la ventana principal vigente
como `parent`.

**`payment.qr.reconcile` — canal comercial nuevo, con esquema propio.**
Añadido a `packages/contracts/src/ipc-commercial.ts` e `ipc.ts` (contrato),
enrutado en `local-channel-component.ts` (el `switch` exhaustivo con
`never` que ya exigía esto — ver §19: es la misma garantía que dejó a los
cinco `payment.*` originales inalcanzables un bloque entero) y en
`commercial-request-handler.ts`, con un slot opcional
`reconcileProviderPayment` en `CommercialComponent` que replica
exactamente el patrón ya existente de `registerQrPayment`
(`undefined` sin proveedor inyectado → `PROVIDER_NOT_CONFIGURED`; con uno,
construye `ReconcileProviderPaymentUseCase` reutilizando la misma instancia
de `ConfirmProviderPaymentUseCase`). No exige `operation_id`/
`idempotency_key`: la protección contra doble efecto sigue viniendo de las
guardas de `confirmProviderPayment`, no de una clave del sobre — igual
razón que ya fijó `ReconcileProviderPaymentUseCase` en §20.1.

`TESTED` este turno, sin red real en ningún caso:
- `qr-checkout-window.test.ts` — 20 pruebas (funciones puras de
  coincidencia/extracción + `QrCheckoutWindowManager` con un `BrowserWindow`
  simulado).
- `main.test.ts` — reachability del canal nativo, payload inválido rechazado
  sin abrir ventana, y las dos pruebas estructurales existentes actualizadas
  para las dos allowlists (comercial + nativa).
- `ipc-allowlist.test.ts` / `preload-api.test.ts` / `preload.test.ts` —
  actualizadas para las listas exactas nuevas.
- `ipc-contracts.test.ts` — 6 pruebas del esquema `payment.qr.reconcile`.
- `commercial-ipc.test.ts` — 3 pruebas de alcance real (sin proveedor,
  sin permiso, `PAYMENT_NOT_FOUND` demostrando que el mensaje atraviesa
  todo el enrutamiento real) — la misma disciplina de "alcanzable de
  extremo a extremo" que el archivo ya exige para toda capacidad nueva.

`pnpm typecheck` (los 9 proyectos), suites completas de `contracts` (250),
`local-channel` (4), `pos-local-service` (575/579, mismos 4 skips de
plataforma) y `pos-desktop` (150/150) — todas PASS. `ARCH-003` (forzado sin
caché de Nx) y `ci:repository-policy` PASS.

### 20.5 `STILL_PENDING` conectado con `recordObservedProviderTransaction` (2026-09-19)

`ReconcileProviderPaymentUseCase.execute` ahora escribe la observación
antes de devolver `STILL_PENDING`: si `getPaymentStatus` responde
`PENDING`, llama a
`paymentStore.recordObservedProviderTransaction(scope, paymentId,
providerTransactionId, this.now().toISOString())` y **después** devuelve
el resultado — la escritura no cambia lo que se reporta ni requiere que
haya tenido éxito.

**Por qué es seguro ignorar el resultado de la escritura.** Entre el
`get()` inicial (que confirma `QR`/`PENDING`) y la respuesta de Wompi media
una llamada HTTP real — una ventana no trivial en la que un webhook
concurrente podría confirmar o cancelar el mismo pago. Si eso ocurre,
`recordObservedProviderTransaction` devuelve `PAYMENT_NOT_RECONCILABLE` en
vez de `RECORDED`; la escritura simplemente no aplica, y `STILL_PENDING`
se sigue devolviendo tal cual, porque es el veredicto de Wompi el que
importa aquí, no si la anotación llegó a guardarse. Probado explícitamente
(`"still reports STILL_PENDING even when recording the observation fails
to land"`).

Sigue siendo **no autoritativo**: la escritura nunca toca
`payments_payments.status` ni el `status` del intento — sólo
`confirmProviderPayment` conserva esa autoridad, sin cambios.

`TESTED` este turno: 2 pruebas unitarias nuevas en
`reconcile-provider-payment-use-case.test.ts` (la anotación se llama con
los identificadores correctos; una escritura fallida no cambia el
resultado) y 1 prueba de integración en `payment.test.ts` contra un
`LocalDatabase` real — registra un QR, reconcilia con un proveedor de
prueba que responde `PENDING`, y verifica con
`getObservedProviderTransaction` que el id quedó anotado mientras el pago
sigue `PENDING`. Suite completa de `pos-local-service`: 577/581 (mismos 4
skips preexistentes de plataforma). `ARCH-003` (forzado sin caché de Nx) y
`ci:repository-policy` PASS.

### 20.6 Lo que sigue sin existir — y por qué

**El barrido en segundo plano** en sí no existe: es scheduler/infra,
deliberadamente fuera de alcance de esta rama. Ahora sí tiene algo que
leer (`payments_payment_attempts_reconciliation_sweep_idx` ya recibe filas
reales), pero nadie lo recorre todavía.

**El destino real de `redirect-url`** tampoco está decidido: el
`WOMPI_CHECKOUT_RETURN_URL` de `qr-checkout-window.ts` es un valor
provisional. Aprovisionar `WompiCheckoutCredentials.redirectUrl` en
`main.ts` del servicio local con ese mismo valor es wiring productivo,
explícitamente fuera de alcance desde el inicio de esta rama.

### 20.7 Pendiente para autorizar D-2 completo

1. ~~Migración: columna para el `transaction.id` aprendido y aún no confirmado.~~
   `MATERIALIZED`/`TESTED` — §20.2.
2. ~~`redirect-url` en el checkout builder.~~ `MATERIALIZED`/`TESTED` — §20.3.
3. ~~Wiring del redirect en Electron (`QrCheckoutWindowManager`,
   `payment.qr.checkout.open`, `payment.qr.reconcile`).~~
   `MATERIALIZED`/`TESTED` — §20.4.
4. ~~Conectar `STILL_PENDING` con `recordObservedProviderTransaction`.~~
   `MATERIALIZED`/`TESTED` — §20.5.
5. Decidir el destino real de `redirect-url`, y el wiring productivo en
   `main.ts` del servicio local (proveedor real, secretos) — fuera de
   alcance hasta ahora.
6. Job/scheduler para el barrido periódico, leyendo el índice de §20.2.

> **PENDIENTE DE ACTUALIZACIÓN — recuperación de alcance del 2026-09-19.**
> Los puntos **1, 3 y 4** de esta lista aparecen tachados porque se
> materializaron el 2026-09-18/19; ese código fue **retirado de la línea
> activa** el 2026-09-19 (ver el aviso al inicio de §20). Vuelven por tanto a
> estar **pendientes** en la rama, aunque su diseño y sus pruebas existieron y
> siguen documentados aquí. El punto **2** (`redirect-url` en el checkout
> builder) sigue materializado y su tachado es correcto.
