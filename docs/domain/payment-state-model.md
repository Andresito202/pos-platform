# PAY-007 — Modelo consolidado de estados de pagos

## Estado

`DONE`

---

# Propósito

Definir el modelo conceptual definitivo de estados del dominio de pagos de POS Platform.

Este documento separa formalmente los ejes de:

- `Payment`;
- `PaymentAttempt`;
- `Refund`;
- `Reversal`;
- `Settlement`;
- `Reconciliation`;
- `Chargeback`.

El objetivo es eliminar estados ambiguos, impedir transiciones destructivas y establecer qué conceptos son:

- estados persistentes;
- proyecciones derivadas;
- eventos de dominio;
- operaciones compensatorias;
- incidencias operativas.

Este documento sustituye cualquier interpretación anterior que trate todos los estados financieros como una sola máquina de estados.

---

# Alcance

Este modelo cubre:

- pagos individuales;
- pagos mixtos;
- pagos presenciales;
- efectivo;
- tarjeta;
- transferencia;
- QR;
- billeteras;
- crédito;
- pagos offline;
- intentos pendientes;
- confirmaciones tardías;
- refunds;
- reversals;
- liquidaciones;
- conciliaciones;
- contracargos;
- ajustes relacionados.

No define todavía:

- tablas;
- columnas;
- claves físicas;
- índices;
- migraciones;
- endpoints;
- contratos SQL;
- particionamiento;
- implementación concreta.

---

# Principios obligatorios

1. Cada agregado tiene su propia máquina de estados.
2. Los agregados financieros históricos son inmutables.
3. Una corrección financiera se representa mediante una operación nueva.
4. Un estado derivado no sustituye el historial de eventos.
5. La conciliación no cambia el estado financiero original del pago.
6. La liquidación no equivale a conciliación.
7. La autorización no equivale a confirmación.
8. La confirmación no equivale a liquidación.
9. La liquidación no equivale a abono bancario.
10. Un refund no es una reversión.
11. Un contracargo no es un refund.
12. Una proyección puede cambiar sin sobrescribir eventos históricos.
13. La incertidumbre debe conservarse explícitamente.
14. Ningún proceso debe inferir éxito por timeout.
15. Toda transición debe ser idempotente y auditable.

---

# Taxonomía del modelo

## Estado persistente

Es el estado almacenado directamente en el agregado responsable.

Ejemplos:

- estado de `PaymentAttempt`;
- estado de `Refund`;
- estado de `Reversal`;
- estado de `Settlement`;
- estado de `Reconciliation`;
- estado de `Chargeback`.

## Proyección derivada

Es una vista calculada a partir de uno o varios agregados y eventos.

Ejemplos:

- importe pagado;
- importe reembolsado;
- saldo reembolsable;
- pago totalmente reembolsado;
- pago parcialmente reembolsado;
- pago liquidado;
- pago conciliado;
- pago con contracargo.

Una proyección derivada no debe almacenarse como fuente única de verdad sin conservar sus entradas.

## Evento de dominio

Es un hecho inmutable ocurrido en el dominio.

Ejemplos:

- `PaymentConfirmed`;
- `RefundCompleted`;
- `ReversalCompleted`;
- `SettlementCompleted`;
- `ReconciliationClosed`;
- `ChargebackReceived`.

## Operación compensatoria

Es una nueva operación que corrige o compensa otra sin modificarla.

Ejemplos:

- refund;
- reversal;
- ajuste;
- contracargo;
- compensación de caja.

## Incidencia

Es una condición que requiere revisión, evidencia o resolución.

Ejemplos:

- diferencia de conciliación;
- confirmación tardía;
- estado incierto del proveedor;
- duplicado;
- movimiento offline tardío;
- inconsistencia de liquidación.

---

# Ejes separados

El dominio debe manejar al menos estos ejes independientes:

1. `PaymentAttemptStatus`
2. `PaymentStatus`
3. `RefundStatus`
4. `ReversalStatus`
5. `SettlementStatus`
6. `ReconciliationStatus`
7. `ChargebackStatus`

No se permite crear una única enumeración que mezcle todos estos conceptos.

---

# PaymentAttemptStatus

## Propósito

Representa el ciclo de vida técnico de un intento de pago.

## Estados

- `CREATED`
- `PENDING`
- `PROCESSING`
- `REQUIRES_ACTION`
- `CONFIRMED`
- `DECLINED`
- `FAILED`
- `EXPIRED`
- `CANCELLED`
- `UNKNOWN`
- `REVIEW_REQUIRED`

## Estados terminales conceptuales

- `CONFIRMED`
- `DECLINED`
- `FAILED`
- `EXPIRED`
- `CANCELLED`

`UNKNOWN` y `REVIEW_REQUIRED` no son estados de éxito ni de fracaso definitivo.

## Transiciones permitidas

```text
CREATED
├── PENDING
├── PROCESSING
├── CANCELLED
└── FAILED

PENDING
├── PROCESSING
├── REQUIRES_ACTION
├── CONFIRMED
├── DECLINED
├── EXPIRED
├── UNKNOWN
└── REVIEW_REQUIRED

PROCESSING
├── CONFIRMED
├── DECLINED
├── FAILED
├── UNKNOWN
└── REVIEW_REQUIRED

REQUIRES_ACTION
├── PROCESSING
├── CONFIRMED
├── DECLINED
├── EXPIRED
├── CANCELLED
└── UNKNOWN

UNKNOWN
├── CONFIRMED
├── DECLINED
├── FAILED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── CONFIRMED
├── DECLINED
├── FAILED
├── CANCELLED
└── UNKNOWN
```

## Reglas

1. Un timeout no produce `FAILED` automáticamente.
2. Un callback tardío puede resolver `UNKNOWN`.
3. `CONFIRMED` requiere evidencia válida.
4. Un intento confirmado no vuelve a `PENDING`.
5. Un intento terminal puede recibir evidencia tardía contradictoria; eso crea una incidencia, no una modificación silenciosa.
6. Cada intento conserva proveedor, referencia, idempotency key y correlation ID.
7. Un pago mixto puede contener varios intentos independientes.
8. Agotar la resolución automática de un `UNKNOWN` —por la ventana máxima o por el presupuesto de consultas que fije la política vigente— produce `UNKNOWN → REVIEW_REQUIRED`, nunca `UNKNOWN → FAILED`. El agotamiento dice que el mecanismo automático dejó de preguntar, no que el cobro fracasara; la regla 1 ya lo exige para el timeout que abre la incertidumbre y esta regla lo extiende al momento en que se deja de insistir. `REVIEW_REQUIRED` no es terminal, así que una evidencia tardía por una entrada autorizada sigue pudiendo resolver el intento por la regla 2.

---

# PaymentStatus

## Propósito

Representa el resultado financiero agregado del pago, no el estado técnico de un intento.

## Estados persistentes permitidos

- `CREATED`
- `PENDING`
- `PARTIALLY_CONFIRMED`
- `CONFIRMED`
- `FAILED`
- `CANCELLED`
- `REVIEW_REQUIRED`

## Regla principal

`PaymentStatus` no contiene:

- `SETTLED`;
- `RECONCILED`;
- `PARTIALLY_REFUNDED`;
- `REFUNDED`;
- `REVERSED`;
- `CHARGEDBACK`.

Esos conceptos pertenecen a otros agregados o a proyecciones derivadas.

## Transiciones permitidas

```text
CREATED
├── PENDING
├── PARTIALLY_CONFIRMED
├── CONFIRMED
├── FAILED
└── CANCELLED

PENDING
├── PARTIALLY_CONFIRMED
├── CONFIRMED
├── FAILED
├── CANCELLED
└── REVIEW_REQUIRED

PARTIALLY_CONFIRMED
├── CONFIRMED
├── CANCELLED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── PARTIALLY_CONFIRMED
├── CONFIRMED
├── FAILED
└── CANCELLED
```

## Reglas

1. `CONFIRMED` representa importe confirmado suficiente según la política del pago.
2. `PARTIALLY_CONFIRMED` aplica cuando solo parte del importe esperado fue confirmada.
3. Los refunds posteriores no cambian `PaymentStatus`.
4. Los reversals posteriores no cambian destructivamente `PaymentStatus`.
5. La conciliación no cambia `PaymentStatus`.
6. La liquidación no cambia `PaymentStatus`.
7. Los contracargos no cambian `PaymentStatus`.
8. La vista financiera actual se obtiene mediante proyecciones.

---

# Proyecciones financieras de Payment

Las siguientes propiedades son derivadas:

- `confirmed_amount`;
- `refunded_amount`;
- `reversed_amount`;
- `chargeback_amount`;
- `settled_amount`;
- `reconciled_amount`;
- `refundable_amount`;
- `net_effective_amount`.

## Proyecciones de clasificación

- `NOT_REFUNDED`
- `PARTIALLY_REFUNDED`
- `FULLY_REFUNDED`
- `NOT_REVERSED`
- `FULLY_REVERSED`
- `NOT_SETTLED`
- `PARTIALLY_SETTLED`
- `FULLY_SETTLED`
- `NOT_RECONCILED`
- `PARTIALLY_RECONCILED`
- `FULLY_RECONCILED`
- `NO_CHARGEBACK`
- `PARTIALLY_CHARGEDBACK`
- `FULLY_CHARGEDBACK`

Estas clasificaciones no son estados persistentes de `Payment`.

---

# Fórmula conceptual del efecto neto

```text
confirmed_amount
- refunded_amount
- reversed_amount
- chargeback_amount
+ positive_adjustments
- negative_adjustments
= net_effective_amount
```

La fórmula exacta deberá versionarse y respetar moneda, precisión y reglas de cada medio.

---

# RefundStatus

## Propósito

Representa el ciclo de vida de una devolución solicitada sobre valor confirmado y todavía elegible.

## Estados persistentes

- `REQUESTED`
- `PENDING_APPROVAL`
- `APPROVED`
- `PROCESSING`
- `PARTIALLY_COMPLETED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `REJECTED`
- `UNKNOWN`
- `REVIEW_REQUIRED`

## Transiciones permitidas

```text
REQUESTED
├── PENDING_APPROVAL
├── APPROVED
├── REJECTED
├── CANCELLED
└── REVIEW_REQUIRED

PENDING_APPROVAL
├── APPROVED
├── REJECTED
├── CANCELLED
└── REVIEW_REQUIRED

APPROVED
├── PROCESSING
├── CANCELLED
└── REVIEW_REQUIRED

PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
├── UNKNOWN
└── REVIEW_REQUIRED

PARTIALLY_COMPLETED
├── PROCESSING
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

UNKNOWN
├── PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── APPROVED
├── PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
├── REJECTED
└── CANCELLED
```

## Reglas

1. `APPROVED` no implica dinero devuelto.
2. `COMPLETED` exige evidencia suficiente del medio utilizado.
3. Un refund parcial conserva importe completado y saldo pendiente.
4. Un refund no modifica destructivamente `Payment`.
5. El importe completado alimenta `refunded_amount`.
6. La distribución en pagos mixtos usa la política versionada aprobada.
7. Un refund fallido no libera automáticamente reservas sin validar el resultado real.
8. Una respuesta incierta del proveedor produce `UNKNOWN` o `REVIEW_REQUIRED`.
9. Un refund completado no puede volver a `PROCESSING`.
10. Las correcciones posteriores se representan mediante nuevas operaciones.

---

# ReversalStatus

## Propósito

Representa la cancelación técnica de una operación antes de que su efecto financiero se considere definitivamente liquidado.

## Estados persistentes

- `REQUESTED`
- `PROCESSING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `UNKNOWN`
- `REVIEW_REQUIRED`

## Transiciones permitidas

```text
REQUESTED
├── PROCESSING
├── CANCELLED
└── REVIEW_REQUIRED

PROCESSING
├── COMPLETED
├── FAILED
├── UNKNOWN
└── REVIEW_REQUIRED

UNKNOWN
├── PROCESSING
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── PROCESSING
├── COMPLETED
├── FAILED
└── CANCELLED
```

## Reglas

1. El reversal se usa cuando la semántica real del proveedor permite deshacer técnicamente la operación original.
2. Después de una liquidación confirmada, la política normal es refund, no reversal.
3. `COMPLETED` requiere evidencia válida del proveedor o del subsistema responsable.
4. Un reversal parcial no produce `FULLY_REVERSED`.
5. El valor completado alimenta `reversed_amount`.
6. Un intento incierto no se considera completado.
7. El reversal conserva referencia al intento original.
8. El reversal no elimina el intento ni el pago original.
9. Una respuesta tardía contradictoria crea una incidencia.

---

# SettlementStatus

## Propósito

Representa el ciclo de vida de la liquidación financiera reconocida por caja, proveedor, adquirente, billetera o banco.

## Estados persistentes

- `CREATED`
- `PENDING`
- `PROCESSING`
- `PARTIALLY_COMPLETED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `UNKNOWN`
- `REVIEW_REQUIRED`

## Transiciones permitidas

```text
CREATED
├── PENDING
├── PROCESSING
├── CANCELLED
└── FAILED

PENDING
├── PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
├── UNKNOWN
└── REVIEW_REQUIRED

PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
├── UNKNOWN
└── REVIEW_REQUIRED

PARTIALLY_COMPLETED
├── PROCESSING
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

UNKNOWN
├── PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── PROCESSING
├── PARTIALLY_COMPLETED
├── COMPLETED
├── FAILED
└── CANCELLED
```

## Reglas

1. Una liquidación puede agrupar múltiples pagos.
2. Un pago puede liquidarse parcialmente.
3. `COMPLETED` no implica conciliación bancaria.
4. La liquidación conserva por separado bruto, comisiones, retenciones, refunds, reversals, contracargos, ajustes positivos, ajustes negativos y neto.
5. Las comisiones no reducen el importe confirmado del pago.
6. Las retenciones no cambian el valor histórico de la venta.
7. Una liquidación corregida genera una nueva versión o ajuste.
8. Un movimiento no puede liquidarse dos veces por el mismo importe.
9. La evidencia externa original permanece inmutable.
10. `settled_amount` se calcula a partir de componentes completados.
11. Cada cálculo conserva `calculation_policy_version`, entradas exactas, tratamiento del bruto respecto de reversals, evidencia de proveedor y resultado.
12. La política distingue si el bruto incluye operaciones posteriormente reversadas o ya viene neto de reversals; nunca se descuenta un reversal dos veces.
13. Settlement no modifica Payment histórico para cuadrar una diferencia.

---

# ReconciliationStatus

## Propósito

Representa el ciclo de vida de una ejecución de conciliación entre movimientos internos y fuentes externas.

## Estados persistentes

- `CREATED`
- `RUNNING`
- `REVIEW_REQUIRED`
- `PARTIALLY_RECONCILED`
- `RECONCILED`
- `FAILED`
- `CANCELLED`
- `CLOSED`
- `REOPENED`

## Transiciones permitidas

```text
CREATED
├── RUNNING
├── CANCELLED
└── FAILED

RUNNING
├── PARTIALLY_RECONCILED
├── RECONCILED
├── REVIEW_REQUIRED
├── FAILED
└── CANCELLED

REVIEW_REQUIRED
├── RUNNING
├── PARTIALLY_RECONCILED
├── RECONCILED
├── FAILED
└── CANCELLED

PARTIALLY_RECONCILED
├── RUNNING
├── RECONCILED
├── REVIEW_REQUIRED
└── CLOSED

RECONCILED
└── CLOSED

CLOSED
└── REOPENED

REOPENED
├── RUNNING
├── REVIEW_REQUIRED
├── PARTIALLY_RECONCILED
├── RECONCILED
└── FAILED
```

## Reglas

1. `RECONCILED` pertenece a la ejecución de conciliación, no a `PaymentStatus`.
2. Un pago puede estar confirmado y no conciliado.
3. Un pago puede estar liquidado y no conciliado.
4. Una conciliación cerrada no se modifica directamente.
5. La reapertura crea una nueva revisión vinculada.
6. Los movimientos tardíos no reescriben snapshots de alcance ni conciliaciones cerradas.
7. `PARTIALLY_RECONCILED` requiere detalle de saldos e incidencias pendientes.
8. Las diferencias materiales bloquean el cierre salvo política explícita.
9. `reconciled_amount` se deriva de elementos conciliados válidos.
10. La conciliación no crea pagos, refunds ni movimientos de caja silenciosamente.
11. El periodo y alcance son un snapshot de Reconciliation y no tienen máquina de estados propia.
12. `OPEN` y `PROCESSING` no pertenecen a `ReconciliationStatus`; los estados de items e incidencias permanecen separados.

---

# ChargebackStatus

## Propósito

Representa el ciclo de vida de un contracargo iniciado por banco, adquirente, procesador o proveedor.

## Estados persistentes

- `RECEIVED`
- `UNDER_REVIEW`
- `ACCEPTED`
- `DISPUTED`
- `WON`
- `LOST`
- `PARTIALLY_LOST`
- `CANCELLED`
- `CLOSED`

## Transiciones permitidas

```text
RECEIVED
├── UNDER_REVIEW
├── ACCEPTED
├── DISPUTED
└── CANCELLED

UNDER_REVIEW
├── ACCEPTED
├── DISPUTED
├── CANCELLED
└── CLOSED

DISPUTED
├── WON
├── LOST
├── PARTIALLY_LOST
└── CLOSED

ACCEPTED
├── LOST
├── PARTIALLY_LOST
└── CLOSED

WON
└── CLOSED

LOST
└── CLOSED

PARTIALLY_LOST
└── CLOSED
```

## Reglas

1. Un contracargo no cambia destructivamente `PaymentStatus`.
2. El contracargo conserva referencia al pago, proveedor y evidencia.
3. `LOST` alimenta `chargeback_amount`.
4. `PARTIALLY_LOST` alimenta solo el importe confirmado como pérdida.
5. `WON` no elimina el historial de la disputa.
6. Un contracargo puede aparecer después de liquidación y conciliación.
7. Una conciliación cerrada afectada por contracargo requiere nueva revisión o periodo posterior.
8. Un contracargo no se modela como refund.
9. La evidencia y los plazos de disputa deben conservarse.
10. El cierre no elimina el riesgo histórico.

---

# Proyecciones agregadas

## RefundProjection

Se deriva de refunds completados:

- `NOT_REFUNDED`
- `PARTIALLY_REFUNDED`
- `FULLY_REFUNDED`

## ReversalProjection

Se deriva de reversals completados:

- `NOT_REVERSED`
- `PARTIALLY_REVERSED`
- `FULLY_REVERSED`

## SettlementProjection

Se deriva de liquidaciones completadas:

- `NOT_SETTLED`
- `PARTIALLY_SETTLED`
- `FULLY_SETTLED`

## ReconciliationProjection

Se deriva de elementos conciliados:

- `NOT_RECONCILED`
- `PARTIALLY_RECONCILED`
- `FULLY_RECONCILED`

## ChargebackProjection

Se deriva de contracargos perdidos:

- `NO_CHARGEBACK`
- `PARTIALLY_CHARGEDBACK`
- `FULLY_CHARGEDBACK`

## Regla

Las proyecciones:

- pueden recalcularse;
- conservan sus fuentes;
- no sustituyen eventos;
- no autorizan sobrescribir agregados;
- deben incluir versión de cálculo;
- deben ser reconstruibles.

---

# Reglas entre agregados

1. `PaymentAttempt.CONFIRMED` puede contribuir a `Payment.CONFIRMED`.
2. `Refund.COMPLETED` incrementa `refunded_amount`.
3. `Reversal.COMPLETED` incrementa `reversed_amount`.
4. `Settlement.COMPLETED` incrementa `settled_amount`.
5. `Reconciliation.RECONCILED` incrementa `reconciled_amount` solo respecto de los elementos válidamente conciliados.
6. `Chargeback.LOST` incrementa `chargeback_amount`.
7. Ningún agregado modifica directamente el estado interno de otro.
8. La coordinación se realiza mediante eventos, comandos y proyecciones.
9. Las proyecciones deben poder reconstruirse desde fuentes inmutables.
10. Toda referencia entre agregados conserva tenant, empresa, moneda y correlación.

---

# Transiciones prohibidas

No se permite:

- `Payment.CONFIRMED -> PENDING`;
- `Payment.CONFIRMED -> CREATED`;
- `Payment.CONFIRMED -> SETTLED`;
- `Payment.CONFIRMED -> RECONCILED`;
- `Payment.CONFIRMED -> REFUNDED`;
- `Payment.CONFIRMED -> REVERSED`;
- `Payment.CONFIRMED -> CHARGEDBACK`;
- `Refund.COMPLETED -> PROCESSING`;
- `Reversal.COMPLETED -> PROCESSING`;
- `Settlement.COMPLETED -> PROCESSING`;
- editar directamente una conciliación `CLOSED`;
- borrar un contracargo cerrado;
- convertir un timeout en éxito o fallo definitivo sin evidencia;
- sobrescribir un evento histórico;
- reutilizar una idempotency key con contenido diferente;
- conciliar dos veces el mismo importe incompatible;
- liquidar dos veces el mismo componente;
- compensar silenciosamente refunds, reversals y contracargos.

---

# Resolución de conflictos

## Principio

Cuando dos fuentes contradicen el estado conocido, el sistema conserva ambas evidencias y crea una incidencia.

## Casos

- callback tardío contra intento marcado `FAILED`;
- proveedor confirma después de timeout;
- pago local offline duplicado al sincronizar;
- liquidación externa sin pago interno;
- pago interno sin liquidación externa;
- refund completado externamente pero desconocido internamente;
- contracargo recibido después de conciliación cerrada;
- reversal y refund sobre el mismo importe;
- dos cierres concurrentes;
- referencia externa reutilizada.

## Tratamiento

1. No se sobrescribe el estado anterior silenciosamente.
2. Se registra la nueva evidencia.
3. Se evalúa idempotencia.
4. Se determina el agregado responsable.
5. Se crea una incidencia si existe contradicción material.
6. Se recalculan proyecciones cuando la evidencia queda validada.
7. Se conserva la secuencia temporal completa.
8. Los ajustes se representan mediante operaciones nuevas.

---

# Operación offline y eventos tardíos

## Reglas

1. La fecha de creación local y la fecha de recepción se conservan separadas.
2. El dispositivo debe aportar identificador, usuario, versión e idempotency key.
3. Una operación offline no puede inventar confirmación externa.
4. Al sincronizar, se valida autenticidad, duplicidad y secuencia.
5. Si el periodo está cerrado, se crea una incidencia o revisión posterior.
6. Un evento tardío puede actualizar una proyección, pero no borrar el historial.
7. Un conflicto de versión pasa a `REVIEW_REQUIRED`.
8. Los eventos offline deben ser ordenables por reloj lógico o secuencia del dispositivo.
9. Una caída de red no autoriza doble cobro.
10. El sistema debe permitir reanudación segura.

---

# Idempotencia y concurrencia

## Claves separadas

Se requieren claves independientes para:

- crear pago;
- crear intento;
- confirmar intento;
- crear refund;
- ejecutar refund;
- crear reversal;
- ejecutar reversal;
- registrar liquidación;
- cerrar liquidación;
- iniciar conciliación;
- cerrar conciliación;
- reabrir conciliación;
- registrar contracargo;
- resolver contracargo.

## Reglas

1. Misma clave y mismo contenido devuelve el resultado existente.
2. Misma clave y contenido diferente produce conflicto.
3. Toda transición usa versión esperada.
4. Dos comandos concurrentes incompatibles no pueden completarse ambos.
5. Los locks no sustituyen versionado ni idempotencia.
6. Un timeout exige consulta antes de reintentar.
7. Los workers pueden reiniciarse sin duplicar efectos.
8. Los eventos deben publicarse con outbox o mecanismo equivalente.
9. La proyección debe tolerar reentrega de eventos.
10. El orden por agregado debe preservarse.

---

# Eventos de dominio consolidados

## PaymentAttempt

- `PaymentAttemptCreated`
- `PaymentAttemptPending`
- `PaymentAttemptProcessing`
- `PaymentAttemptConfirmed`
- `PaymentAttemptDeclined`
- `PaymentAttemptFailed`
- `PaymentAttemptExpired`
- `PaymentAttemptCancelled`
- `PaymentAttemptMarkedUnknown`
- `PaymentAttemptReviewRequired`

## Payment

- `PaymentCreated`
- `PaymentPending`
- `PaymentPartiallyConfirmed`
- `PaymentConfirmed`
- `PaymentFailed`
- `PaymentCancelled`
- `PaymentReviewRequired`

## Refund

- `RefundRequested`
- `RefundApproved`
- `RefundProcessing`
- `RefundPartiallyCompleted`
- `RefundCompleted`
- `RefundFailed`
- `RefundRejected`
- `RefundCancelled`
- `RefundReviewRequired`

## Reversal

- `ReversalRequested`
- `ReversalProcessing`
- `ReversalCompleted`
- `ReversalFailed`
- `ReversalCancelled`
- `ReversalReviewRequired`

## Settlement

- `SettlementCreated`
- `SettlementProcessing`
- `SettlementPartiallyCompleted`
- `SettlementCompleted`
- `SettlementFailed`
- `SettlementReviewRequired`

## Reconciliation

- `ReconciliationStarted`
- `ReconciliationPartiallyCompleted`
- `ReconciliationCompleted`
- `ReconciliationReviewRequired`
- `ReconciliationClosed`
- `ReconciliationReopened`
- `ReconciliationFailed`

## Chargeback

- `ChargebackReceived`
- `ChargebackUnderReview`
- `ChargebackAccepted`
- `ChargebackDisputed`
- `ChargebackWon`
- `ChargebackLost`
- `ChargebackPartiallyLost`
- `ChargebackClosed`

---

# Invariantes globales

1. Ningún evento financiero histórico se elimina.
2. Ningún agregado se corrige mediante sobrescritura destructiva.
3. Todo importe conserva moneda y precisión.
4. Ningún importe se consume dos veces.
5. Todo cambio de estado conserva actor o proceso responsable.
6. Todo cambio de estado conserva fecha y versión.
7. Toda referencia externa conserva proveedor y contexto.
8. Toda transición es idempotente.
9. Toda contradicción material queda visible.
10. Las proyecciones son reconstruibles.
11. `PaymentStatus` no contiene estados de refund, reversal, settlement, reconciliation ni chargeback.
12. Un refund y un reversal no pueden consumir el mismo importe sin una regla explícita.
13. El saldo reembolsable nunca es negativo.
14. El importe liquidado no excede el importe elegible sin ajuste explícito.
15. El importe conciliado no excede el importe disponible para conciliación.
16. El efecto neto debe cuadrar con sus componentes.
17. El aislamiento entre tenants es obligatorio.
18. Ningún dato sensible de tarjeta se almacena en eventos o auditoría.

---

# Decisiones cerradas por PAY-007

1. `PARTIALLY_REFUNDED` y `FULLY_REFUNDED` son proyecciones, no estados persistentes de `Payment`.
2. `PARTIALLY_REVERSED` y `FULLY_REVERSED` son proyecciones.
3. `PARTIALLY_SETTLED` y `FULLY_SETTLED` son proyecciones.
4. `PARTIALLY_RECONCILED` y `FULLY_RECONCILED` son valores de `ReconciliationProjection`; solo `PARTIALLY_RECONCILED` también pertenece a `ReconciliationStatus`, mientras una ejecución completa usa `RECONCILED`.
5. `REVERSED` no es un estado persistente de `Payment`.
6. `SETTLED` no es un estado persistente de `Payment`.
7. `RECONCILED` no es un estado persistente de `Payment`.
8. `CHARGEDBACK` no es un estado persistente de `Payment`.
9. Refund, reversal, settlement, reconciliation y chargeback son agregados o procesos separados.
10. Después de liquidación, la corrección normal es refund; reversal solo aplica cuando la semántica real del proveedor lo permite.
11. Una conciliación cerrada puede verse afectada por eventos posteriores mediante reapertura o revisión nueva, nunca mediante edición directa.
12. El pago original permanece inmutable y su situación financiera actual se expresa mediante proyecciones.

---

# Criterios de aceptación

`PAY-007` se considera completo cuando:

- cada agregado tiene estados propios;
- no existe una enumeración global ambigua;
- están definidas transiciones permitidas;
- están definidas transiciones prohibidas;
- están definidas proyecciones;
- están definidos eventos;
- están definidos invariantes;
- están resueltos refunds posteriores a conciliación;
- está resuelta la diferencia entre refund y reversal;
- está resuelta la diferencia entre settlement y reconciliation;
- está definido el tratamiento de chargebacks;
- está definido el tratamiento offline;
- están definidas idempotencia y concurrencia;
- el modelo es compatible con UC-PAY-001 a UC-PAY-006;
- el diseño físico puede comenzar sin ambigüedad de estados.

---

# Consecuencias para el modelo físico

El futuro modelo físico deberá:

- representar cada medio de un pago mixto como un `Payment` independiente dentro de un `PaymentGroup`;
- no crear un agregado o tabla `PaymentComponent` adicional;
- relacionar cada intento mediante `PaymentAttempt.payment_id`;
- relacionar la cobertura mediante `PaymentAllocation`;
- usar estados separados por agregado;
- evitar una columna global de estado financiero;
- conservar historial de transiciones;
- soportar versionado optimista;
- soportar idempotency keys;
- soportar referencias externas únicas por contexto;
- separar eventos y proyecciones;
- soportar relaciones parciales por importe;
- impedir doble consumo;
- permitir reconstrucción de proyecciones;
- soportar outbox;
- soportar auditoría;
- aislar datos por tenant.

Este documento no define todavía nombres de tablas, columnas, índices ni migraciones.

---

# Estado del documento

Estado: `DONE`

Permanece `DONE` porque cuenta con:

- revisión de consistencia con `payment-lifecycle.md`;
- revisión contra UC-PAY-001 a UC-PAY-006;
- validación de encabezados y cercas Markdown;
- confirmación de que no quedan estados ambiguos;
- actualización del backlog;
- cierre de DEC-001.
