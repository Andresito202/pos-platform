# UC-SALES-002 — Gestión del ciclo de vida de la venta

## Estado

`IN_PROGRESS`

## Prioridad

`P0`

## Propósito

Definir el comportamiento funcional completo de una venta después de su creación y antes, durante o después de su finalización, incluyendo:

- suspensión;
- recuperación;
- expiración;
- anulación;
- cancelación;
- devolución;
- reimpresión;
- pagos parciales;
- pagos pendientes;
- pagos fallidos;
- sobrepagos;
- refunds;
- reversals;
- liberación de inventario;
- operación offline;
- idempotencia;
- concurrencia;
- auditoría;
- permisos;
- recuperación ante fallos.

Este caso de uso debe impedir que ventas, pagos, inventario y caja modifiquen destructivamente sus registros para resolver errores o cambios operativos.

---

# Documentos relacionados

Este documento debe mantenerse alineado con:

- `docs/use-cases/sales/UC-SALES-001-complete-sale.md`;
- `docs/use-cases/payments/UC-PAY-001-register-payment.md`;
- `docs/use-cases/payments/UC-PAY-002-register-mixed-payment.md`;
- `docs/use-cases/payments/UC-PAY-003-confirm-manual-transfer.md`;
- `docs/use-cases/payments/UC-PAY-004-refund-payment.md`;
- `docs/use-cases/payments/UC-PAY-005-reconcile-payment.md`;
- `docs/use-cases/payments/UC-PAY-006-handle-pending-payment.md`;
- `docs/use-cases/cash/UC-CASH-003-cash-operations.md`;
- `docs/adr/DEC-002-payment-compensation-policy.md`;
- `docs/domain/payment-state-model.md`;
- `docs/domain/payment-lifecycle.md`.

Si existe una contradicción sobre estados o transiciones de pagos, prevalece:

```text
docs/domain/payment-state-model.md
```

Si existe una contradicción sobre pagos inferiores, sobrepagos, fallos parciales o compensaciones, prevalece:

```text
docs/adr/DEC-002-payment-compensation-policy.md
```

---

# Alcance

Este documento define:

- ciclo operativo de una venta;
- estados persistentes de la venta;
- proyecciones derivadas de pago;
- suspensión y recuperación;
- expiración de ventas suspendidas;
- anulación antes y después de pagos;
- cancelación operativa;
- devoluciones;
- interacción con refunds y reversals;
- liberación y restitución de inventario;
- reimpresión;
- reintentos;
- operación local-first;
- tratamiento de operaciones tardías;
- eventos;
- auditoría;
- permisos;
- errores funcionales;
- invariantes;
- pruebas mínimas.

Este documento no define todavía:

- tablas físicas;
- migraciones;
- índices;
- contratos SQL;
- endpoints definitivos;
- contratos API definitivos;
- componentes de frontend;
- layout de tickets;
- integración fiscal definitiva;
- integración contable definitiva;
- implementación del hardware.

---

# Dependencias

## Dependencias completadas

- `UC-SALES-001`;
- `UC-PAY-004`;
- `UC-PAY-005`;
- `UC-PAY-006`;
- `CASH-003`;
- `DEC-001`;
- `DEC-002`.

## Dependencias relacionadas

Este documento condiciona o habilita:

- `SALES-003`;
- `PAY-009`;
- `UX-002`;
- `TECH-002`;
- `TECH-003`;
- implementación de ventas;
- implementación de inventario;
- implementación de caja;
- sincronización local-first;
- auditoría;
- conciliación.

---

# Actores

## Actor principal

- Cajero autorizado.

## Actores secundarios

- Administrador;
- supervisor;
- propietario;
- vendedor;
- asesor;
- domiciliario;
- cliente;
- sistema de inventario;
- sistema de pagos;
- sistema de caja;
- sistema fiscal;
- sistema de auditoría;
- motor de sincronización;
- proceso de conciliación;
- impresora o servicio de impresión;
- proveedor de pagos.

---

# Definiciones

## Sale

Agregado que representa una operación comercial con identidad propia.

Debe conservar:

- tenant;
- empresa;
- sucursal;
- terminal;
- canal;
- cliente, cuando aplique;
- líneas;
- cantidades;
- precios;
- promociones;
- descuentos;
- impuestos;
- redondeo;
- total exigible;
- moneda;
- estado;
- versión;
- fechas;
- actores;
- referencias;
- auditoría.

## SaleLine

Línea de venta que representa:

- producto;
- variante;
- presentación;
- cantidad;
- unidad;
- precio unitario;
- descuento;
- impuesto;
- subtotal;
- snapshot comercial;
- snapshot fiscal;
- referencia de inventario.

## SuspendedSale

Venta pausada temporalmente para ser recuperada posteriormente.

No constituye una venta finalizada.

## SaleCancellation

Operación que impide continuar o completar una venta todavía no consolidada definitivamente.

## SaleVoid

Invalidación autorizada de una venta o documento según su estado operativo y fiscal.

No debe confundirse automáticamente con refund o reversal.

## SaleReturn

Operación comercial posterior que devuelve total o parcialmente productos de una venta completada.

Puede originar:

- refund;
- reversal;
- crédito;
- cambio de producto;
- restitución de inventario;
- rechazo de restitución.

## Reprint

Generación de una copia adicional de un documento ya emitido.

No crea una nueva venta.

## SalePaymentProjection

Proyección derivada del estado de pagos relacionados.

No debe editarse manualmente.

## InventoryReservation

Reserva temporal de inventario asociada a una venta no completada.

## InventoryRelease

Liberación de una reserva previamente creada.

## InventoryRestock

Restitución física o lógica de inventario después de una devolución válida.

---

# Principios generales

1. Una venta no se elimina para corregirla.
2. Una venta completada no se sobrescribe destructivamente.
3. Una anulación no elimina pagos confirmados.
4. Una devolución no modifica la venta original.
5. Un refund no modifica el pago original.
6. Un reversal no modifica el pago original.
7. Una reimpresión no crea una venta.
8. Una venta suspendida no se considera completada.
9. Un pago pendiente no cubre la venta.
10. Un pago fallido no cubre la venta.
11. Una venta parcialmente pagada no se considera pagada.
12. Un sobrepago no cambia el total exigible.
13. El estado de pago de la venta es derivado.
14. El estado de inventario no se infiere únicamente del estado de pago.
15. Toda corrección financiera crea una operación nueva.
16. Toda corrección de inventario crea un movimiento nuevo.
17. Toda transición crítica es auditable.
18. Toda operación crítica es idempotente.
19. Toda operación usa versión esperada.
20. Los datos se aíslan por tenant.
21. Una operación offline no inventa confirmaciones externas.
22. Un timeout no significa éxito ni fallo definitivo.
23. Los eventos tardíos no reescriben silenciosamente hechos cerrados.
24. El frontend no decide validez financiera, fiscal ni de inventario.

---

# Estados persistentes de Sale

## `DRAFT`

La venta está siendo construida.

Puede modificarse según permisos y políticas.

## `SUSPENDED`

La venta fue pausada temporalmente.

Conserva:

- líneas;
- cantidades;
- precios;
- promociones aplicadas;
- cliente;
- reservas;
- pagos relacionados;
- actor;
- fecha;
- motivo;
- versión.

## `READY_FOR_PAYMENT`

La venta está validada comercialmente y lista para recibir pagos.

## `PAYMENT_IN_PROGRESS`

Existen intentos o componentes de pago en curso.

No significa que exista cobertura suficiente.

## `COMPLETED`

La venta quedó finalizada con cobertura válida y efectos comerciales confirmados.

## `CANCELLED`

La venta fue cancelada antes de completarse definitivamente.

Los pagos ya confirmados deben resolverse separadamente.

## `EXPIRED`

La venta o suspensión dejó de ser válida por política temporal.

## `RETURN_IN_PROGRESS`

Existe una devolución comercial en curso.

## `PARTIALLY_RETURNED`

Parte de la venta fue devuelta mediante operaciones posteriores.

## `FULLY_RETURNED`

Todo el valor o las cantidades elegibles fueron devueltos.

## `VOIDED`

La venta o documento fue invalidado mediante un procedimiento autorizado.

Este estado solo aplica cuando la política comercial, fiscal y operativa lo permita.

---

# Estados que no pertenecen a Sale

No deben agregarse como estados persistentes de `Sale`:

- `AUTHORIZED`;
- `SETTLED`;
- `RECONCILED`;
- `REFUNDED`;
- `REVERSED`;
- `CHARGEDBACK`;
- `PENDING_APPROVAL`;
- `REVIEW_REQUIRED`;
- `PARTIALLY_SETTLED`;
- `FULLY_SETTLED`.

Esos estados pertenecen a otros agregados o procesos.

Las condiciones equivalentes se representan mediante:

- relaciones;
- proyecciones;
- eventos;
- incidencias;
- operaciones relacionadas.

---

# Proyecciones de pago de la venta

## `UNPAID`

No existe cobertura confirmada.

## `PAYMENT_PENDING`

Existen componentes pendientes, reportados, autorizados o inciertos.

## `PARTIALLY_PAID`

La cobertura confirmada es mayor que cero pero inferior al total exigible.

## `PAID`

La cobertura confirmada cubre exactamente el total exigible.

## `OVERPAID`

La cobertura confirmada supera el total exigible.

El exceso debe clasificarse y resolverse explícitamente.

## `PAYMENT_FAILED`

Los intentos relevantes fallaron y no existe cobertura suficiente.

## `PARTIALLY_REFUNDED`

Parte del saldo elegible fue devuelto.

## `FULLY_REFUNDED`

Todo el saldo elegible fue devuelto.

## Regla

Estas proyecciones:

- se calculan;
- pueden reconstruirse;
- conservan fuentes;
- no sustituyen eventos;
- no sustituyen estados de pagos;
- no deben editarse manualmente;
- deben incluir versión de cálculo.

---

# Proyecciones de inventario de la venta

## `NOT_RESERVED`

No existen reservas.

## `PARTIALLY_RESERVED`

Solo parte de las líneas está reservada.

## `RESERVED`

Todas las cantidades necesarias están reservadas.

## `RELEASED`

Las reservas fueron liberadas.

## `COMMITTED`

El inventario fue descontado o comprometido definitivamente.

## `PARTIALLY_RESTOCKED`

Parte de las unidades devueltas fue restituida.

## `FULLY_RESTOCKED`

Todas las unidades elegibles fueron restituidas.

## `RESTOCK_REJECTED`

Las unidades devueltas no son aptas para volver al inventario disponible.

## Regla

El inventario debe conservar movimientos separados para:

- reserva;
- liberación;
- salida;
- devolución;
- restitución;
- pérdida;
- daño;
- cuarentena;
- ajuste.

---

# Transiciones generales permitidas

```text
DRAFT
├── READY_FOR_PAYMENT
├── SUSPENDED
├── CANCELLED
└── EXPIRED

SUSPENDED
├── DRAFT
├── READY_FOR_PAYMENT
├── CANCELLED
└── EXPIRED

READY_FOR_PAYMENT
├── PAYMENT_IN_PROGRESS
├── SUSPENDED
├── CANCELLED
└── EXPIRED

PAYMENT_IN_PROGRESS
├── PAYMENT_IN_PROGRESS
├── COMPLETED
├── SUSPENDED
├── CANCELLED
└── EXPIRED

COMPLETED
├── RETURN_IN_PROGRESS
└── VOIDED

RETURN_IN_PROGRESS
├── PARTIALLY_RETURNED
├── FULLY_RETURNED
└── COMPLETED

PARTIALLY_RETURNED
├── RETURN_IN_PROGRESS
└── FULLY_RETURNED
```

## Restricciones

1. `COMPLETED` no vuelve a `DRAFT`.
2. `COMPLETED` no vuelve a `READY_FOR_PAYMENT`.
3. `CANCELLED` no vuelve a estado activo.
4. `EXPIRED` no vuelve a estado activo sin crear una nueva revisión o venta.
5. `FULLY_RETURNED` no puede recibir una nueva devolución sobre el mismo saldo.
6. `VOIDED` no puede editarse destructivamente.
7. Una venta suspendida puede recuperarse solo mediante versión esperada.
8. Una transición inválida debe rechazarse.

---

# Precondiciones generales

1. Existe un tenant válido.
2. Existe una empresa válida.
3. Existe una sucursal válida.
4. Existe una terminal autorizada.
5. El usuario está autenticado.
6. El usuario tiene permisos.
7. La venta pertenece al tenant.
8. La venta existe.
9. La versión esperada coincide.
10. La moneda es válida.
11. Las líneas tienen snapshots válidos.
12. Las referencias de producto son válidas.
13. La política comercial está vigente.
14. La operación contiene idempotency key.
15. No existe un bloqueo administrativo incompatible.
16. No existe otra operación concurrente incompatible.

---

# Postcondiciones generales

Después de una operación válida:

- se conserva el estado anterior;
- se registra el estado nuevo;
- se incrementa la versión;
- se registra actor;
- se registra motivo;
- se conserva idempotency key;
- se registra auditoría;
- se publican eventos;
- se actualizan proyecciones;
- se conservan operaciones relacionadas;
- se preserva el aislamiento por tenant;
- no se duplican efectos;
- si está offline, queda en outbox.

---

# Suspensión de venta

## Propósito

Permitir que una venta incompleta sea pausada temporalmente sin perder:

- líneas;
- cantidades;
- precios;
- promociones;
- descuentos;
- impuestos;
- cliente;
- reservas;
- pagos relacionados;
- comentarios;
- trazabilidad.

## Casos permitidos

- cliente solicita esperar;
- cambio de cajero;
- interrupción operativa;
- consulta de precio;
- validación de inventario;
- pago pendiente;
- fallo temporal de hardware;
- operación offline;
- aprobación pendiente.

## Datos mínimos

- `sale_id`;
- estado actual;
- versión esperada;
- motivo;
- actor;
- terminal;
- fecha;
- política;
- idempotency key.

## Flujo principal

1. El actor solicita suspender la venta.
2. El sistema valida autenticación.
3. El sistema valida tenant.
4. El sistema valida permisos.
5. El sistema valida estado actual.
6. El sistema valida versión esperada.
7. El sistema valida operaciones de pago relacionadas.
8. El sistema valida reservas de inventario.
9. El sistema valida política de expiración.
10. El sistema consulta la idempotency key.
11. Si existe la misma solicitud, devuelve el resultado anterior.
12. Si la clave existe con contenido diferente, rechaza por conflicto.
13. El sistema registra motivo.
14. La venta pasa a `SUSPENDED`.
15. Se conserva la versión comercial.
16. Se conserva el estado de pagos.
17. Se conservan o liberan reservas según política.
18. Se incrementa la versión.
19. Se registra auditoría.
20. Se publica `SaleSuspended`.

## Reglas

1. Suspender no cancela.
2. Suspender no elimina líneas.
3. Suspender no elimina pagos.
4. Suspender no devuelve dinero.
5. Suspender no libera inventario automáticamente si la política conserva reservas.
6. Los pagos confirmados permanecen confirmados.
7. Los pagos pendientes permanecen explícitos.
8. Una venta con pago incierto puede suspenderse para revisión.
9. La suspensión debe tener vencimiento cuando la política lo exija.
10. La suspensión conserva el total exigible versionado.

---

# Política de reservas durante suspensión

La política debe definir una de estas estrategias:

## Mantener reserva

Las unidades continúan reservadas durante un periodo limitado.

Aplicable cuando:

- la suspensión es corta;
- el inventario es suficiente;
- la política lo permite;
- existe fecha de expiración.

## Liberar reserva

Las unidades se liberan al inventario disponible.

Aplicable cuando:

- el inventario es escaso;
- la suspensión es prolongada;
- no existe garantía de pago;
- la política lo exige.

## Reserva parcial

Solo algunas líneas conservan reserva.

Debe quedar explícito:

- cuáles;
- por cuánto tiempo;
- bajo qué versión;
- quién autorizó;
- qué evento liberará la reserva.

## Prohibiciones

No se permite:

- mantener reservas indefinidas;
- liberar inventario sin registrar movimiento;
- conservar una reserva vencida silenciosamente;
- duplicar reservas al recuperar;
- modificar cantidades sin nueva versión.

---

# Expiración de venta suspendida

## Regla principal

Una venta suspendida puede expirar por tiempo o política.

## Flujo

1. El sistema detecta vencimiento.
2. Valida estado actual.
3. Valida versión.
4. Consulta pagos relacionados.
5. Consulta reservas.
6. Libera reservas cuando corresponda.
7. No elimina pagos confirmados.
8. Si existen pagos confirmados, crea incidencia o inicia compensación.
9. La venta pasa a `EXPIRED`.
10. Se registra auditoría.
11. Se publica `SuspendedSaleExpired`.

## Reglas

1. Expirar no elimina la venta.
2. Expirar no elimina pagos.
3. Expirar no crea refund automáticamente sin política.
4. Los pagos pendientes deben resolverse.
5. Las reservas liberadas generan movimientos.
6. Una venta expirada no se recupera directamente.
7. Para continuar debe crearse una nueva venta o revisión autorizada.
8. La relación con la venta expirada debe conservarse.

---

# Recuperación de venta suspendida

## Propósito

Continuar una venta previamente suspendida.

## Datos mínimos

- `sale_id`;
- versión suspendida;
- actor;
- terminal;
- sucursal;
- motivo;
- idempotency key;
- expected version.

## Flujo principal

1. El actor solicita recuperar la venta.
2. El sistema valida autenticación.
3. Valida tenant.
4. Valida permisos.
5. Valida que esté `SUSPENDED`.
6. Valida que no esté expirada.
7. Valida versión esperada.
8. Valida terminal y sucursal.
9. Revalida precios según política.
10. Revalida promociones.
11. Revalida impuestos.
12. Revalida inventario.
13. Revalida reservas.
14. Revalida pagos.
15. Revalida estado de proveedores externos.
16. Detecta operaciones tardías.
17. Detecta conflictos.
18. Si existen diferencias, solicita confirmación o revisión.
19. La venta pasa a `DRAFT`, `READY_FOR_PAYMENT` o `PAYMENT_IN_PROGRESS`.
20. Se incrementa la versión.
21. Se registra auditoría.
22. Se publica `SuspendedSaleRecovered`.

## Reglas

1. Recuperar no duplica la venta.
2. Recuperar no duplica pagos.
3. Recuperar no duplica reservas.
4. Los precios pueden requerir actualización según política.
5. Una actualización de precio debe quedar explícita.
6. El cliente debe aceptar cambios materiales cuando corresponda.
7. Los pagos confirmados conservan su importe original.
8. Los pagos pendientes deben consultarse antes de reintentar.
9. Un conflicto de versión bloquea la recuperación.
10. Una venta expirada no se recupera directamente.

---

# Anulación de venta antes de completar

## Propósito

Detener una venta que todavía no ha alcanzado `COMPLETED`.

## Casos permitidos

- error del cliente;
- error del cajero;
- precio rechazado;
- inventario no disponible;
- cambio de decisión;
- pago fallido;
- pago incierto;
- imposibilidad operativa;
- fraude sospechado;
- política comercial;
- expiración autorizada.

## Datos mínimos

- `sale_id`;
- estado actual;
- versión esperada;
- motivo;
- actor;
- terminal;
- sucursal;
- idempotency key;
- evidencia cuando aplique.

## Flujo principal

1. El actor solicita anular la venta.
2. El sistema valida autenticación.
3. Valida tenant.
4. Valida permisos.
5. Valida estado.
6. Valida versión esperada.
7. Consulta pagos relacionados.
8. Consulta reservas de inventario.
9. Consulta movimientos de caja.
10. Consulta documentos emitidos.
11. Consulta operaciones externas.
12. Evalúa si existen efectos ya confirmados.
13. Si no existen efectos confirmados, cancela la venta.
14. Si existen pagos pendientes, inicia su resolución.
15. Si existen pagos confirmados, exige compensación.
16. Si existen movimientos de caja, exige movimientos compensatorios.
17. Libera reservas cuando corresponda.
18. La venta pasa a `CANCELLED`.
19. Incrementa la versión.
20. Registra auditoría.
21. Publica `SaleCancelled`.

## Reglas

1. Anular no elimina la venta.
2. Anular no elimina líneas.
3. Anular no elimina pagos.
4. Anular no elimina movimientos de caja.
5. Anular no elimina reservas sin registrar liberación.
6. Si no existen efectos financieros, la anulación puede completarse inmediatamente.
7. Si existen efectos confirmados, la venta puede quedar en revisión hasta completar compensaciones.
8. Los pagos pendientes deben resolverse antes de cerrar definitivamente la operación.
9. La anulación debe conservar motivo.
10. La anulación debe ser idempotente.

---

# Anulación con pagos pendientes

## Regla principal

Un pago pendiente no cubre la venta, pero puede producir una respuesta tardía.

## Tratamiento

1. La venta se marca para cancelación.
2. El intento pendiente conserva su estado.
3. El sistema consulta al proveedor.
4. Se bloquean reintentos incompatibles.
5. Se registra la intención de cancelación.
6. Si el proveedor rechaza o expira, la cancelación puede completarse.
7. Si el proveedor confirma tardíamente, se crea incidencia.
8. La confirmación tardía puede requerir reversal o refund.
9. La venta no se marca pagada automáticamente.
10. Se conserva correlation ID.

## Prohibiciones

No se permite:

- asumir que el timeout fue fallo;
- repetir el cobro sin consultar;
- eliminar el intento;
- ignorar un callback tardío;
- cerrar la venta como cancelada sin conservar la incertidumbre;
- duplicar compensaciones.

---

# Anulación con pagos confirmados

## Regla principal

Una venta con pagos confirmados no puede anularse destruyendo esos pagos.

## Tratamiento

Debe:

1. identificar cada componente confirmado;
2. calcular saldo elegible;
3. determinar si procede `Reversal`;
4. determinar si procede `Refund`;
5. identificar movimientos de caja;
6. identificar pagos externos;
7. iniciar compensaciones;
8. conservar la venta original;
9. conservar todos los pagos;
10. mantener trazabilidad.

## Resultado

La venta puede quedar:

- `CANCELLED` con compensaciones pendientes;
- `CANCELLED` con compensaciones completadas;
- en revisión;
- bloqueada por incertidumbre;
- rechazada para anulación por política.

## Regla

El estado comercial y el estado financiero no deben mezclarse en un único campo.

---

# Cancelación después de completar

## Principio

Una venta `COMPLETED` no debe volver directamente a `CANCELLED`.

Después de completada, las alternativas válidas son:

- devolución;
- void autorizado;
- nota correctiva;
- refund;
- reversal;
- ajuste fiscal;
- compensación;
- investigación.

## Restricción

La acción exacta depende de:

- estado fiscal;
- estado de pago;
- estado de liquidación;
- estado de conciliación;
- inventario;
- política de devoluciones;
- regulación aplicable;
- permisos.

---

# Void de venta o documento

## Definición

`VOIDED` representa una invalidación autorizada cuando la política comercial, fiscal y técnica lo permite.

## Reglas

1. No es equivalente a borrar.
2. No es equivalente a refund.
3. No es equivalente a reversal.
4. No es equivalente a chargeback.
5. Debe conservar documento original.
6. Debe conservar motivo.
7. Puede requerir documento sustituto.
8. Puede requerir referencia fiscal.
9. Puede requerir aprobación.
10. Debe quedar auditado.

## Prohibiciones

No se permite:

- usar `VOIDED` para ocultar una venta;
- invalidar una venta conciliada sin procedimiento;
- eliminar comprobantes;
- reutilizar consecutivos;
- cambiar importes originales;
- anular pagos por simple cambio de estado.

---

# Pagos parciales

## Regla principal

Una venta parcialmente pagada conserva el saldo pendiente.

## Fórmula

```text
outstanding_amount = payable_amount - confirmed_coverage
```

## Reglas

1. El saldo nunca puede ser negativo sin clasificar sobrepago.
2. Cada componente conserva identidad propia.
3. Un pago fallido no se suma.
4. Un pago pendiente no se suma como confirmado.
5. La venta no pasa a `COMPLETED` sin cobertura suficiente.
6. Puede agregarse otro medio.
7. El nuevo componente debe ser idempotente.
8. El sistema debe impedir doble cobertura.
9. El saldo debe recalcularse en la misma transacción lógica.
10. La entrega puede bloquearse según política.

## Cancelación con pago parcial

Si la venta se cancela con cobertura parcial:

- la cobertura confirmada permanece válida hasta compensarse;
- el saldo pendiente deja de requerirse comercialmente;
- el valor confirmado debe resolverse mediante refund, reversal, crédito o compensación autorizada;
- los movimientos de caja permanecen;
- la venta conserva la relación con todos los pagos.

---

# Sobrepagos

## Regla principal

El sobrepago no modifica el total exigible.

## Fórmula

```text
overpayment_amount = confirmed_coverage - payable_amount
```

cuando:

```text
confirmed_coverage > payable_amount
```

## Opciones autorizadas

- cambio en efectivo;
- refund;
- saldo a favor;
- crédito del cliente;
- compensación;
- aplicación a otra obligación, si la política lo permite.

## Reglas

1. El exceso conserva origen.
2. El exceso conserva medio.
3. El exceso no se oculta como descuento.
4. El exceso no se elimina.
5. La resolución genera una operación separada.
6. Todo saldo a favor requiere cliente identificado.
7. El cambio en efectivo requiere efectivo recibido suficiente.
8. Un doble cobro genera incidencia.
9. Una respuesta tardía puede generar sobrepago.
10. La venta conserva su total original.

---

# Fallo parcial de pagos

## Escenario

Uno o más componentes se confirmaron y otros fallaron, expiraron o quedaron inciertos.

## Decisión

Los componentes confirmados permanecen válidos.

## Opciones

- completar saldo con otro medio;
- suspender;
- cancelar y compensar;
- aplicar crédito autorizado;
- mantener pendiente;
- enviar a revisión.

## Prohibiciones

No se permite:

- convertir pagos confirmados en fallidos;
- borrar componentes;
- reutilizar referencias;
- duplicar reintentos;
- asumir que todo el pago falló;
- reducir el total para cuadrar la cobertura.

---

# Refund relacionado con venta

## Definición

Un `Refund` devuelve valor asociado a una venta completada o cancelada con pago confirmado.

## Reglas

1. Referencia la venta original.
2. Referencia el pago original.
3. Consume saldo elegible.
4. Puede ser total o parcial.
5. No modifica el pago original.
6. No modifica la venta original.
7. Puede cambiar proyecciones.
8. Puede generar salida de caja.
9. Puede quedar pendiente.
10. Debe ser idempotente.

## Relación con Sale

Una venta puede proyectarse como:

- `PARTIALLY_RETURNED`;
- `FULLY_RETURNED`;
- `PARTIALLY_REFUNDED`;
- `FULLY_REFUNDED`.

Estas proyecciones no convierten estados de `Refund` en estados persistentes de `Sale`.

---

# Reversal relacionado con venta

## Definición

Un `Reversal` deshace una autorización o confirmación cuando el medio y el proveedor lo permiten.

## Reglas

1. No es refund.
2. No se usa después de liquidación salvo semántica real del proveedor.
3. No modifica el intento original.
4. No modifica la venta original.
5. Debe conservar evidencia.
6. Puede quedar incierto.
7. Debe ser idempotente.
8. Consume saldo reversible.
9. No puede consumir el mismo importe que un refund incompatible.
10. Puede requerir revisión.

---

# Selección entre Refund y Reversal

## Regla principal

La decisión se basa en el estado real del componente.

## Aplicar Reversal cuando

- existe autorización reversible;
- el proveedor permite deshacer;
- no se ha liquidado definitivamente;
- la semántica del medio lo soporta;
- existe evidencia.

## Aplicar Refund cuando

- el valor ya fue confirmado;
- el proveedor no admite reversal;
- la operación ya fue liquidada;
- se devuelve valor al cliente;
- la política lo exige.

## Aplicar revisión cuando

- el proveedor no responde;
- existe contradicción;
- hubo timeout;
- existe doble callback;
- no se conoce el estado;
- existe conflicto de importe;
- existe riesgo de doble consumo.

---

# Devolución comercial

## Propósito

Registrar la devolución total o parcial de productos o servicios relacionados con una venta completada.

## Datos mínimos

- `sale_id`;
- líneas;
- cantidades;
- motivo;
- actor;
- cliente;
- evidencia;
- estado físico;
- resolución comercial;
- resolución financiera;
- versión esperada;
- idempotency key.

## Flujo principal

1. El actor solicita devolución.
2. El sistema valida venta.
3. Valida tenant.
4. Valida permisos.
5. Valida estado.
6. Valida ventana de devolución.
7. Valida líneas elegibles.
8. Valida cantidades.
9. Valida devoluciones previas.
10. Valida estado físico.
11. Valida pagos.
12. Calcula valor elegible.
13. Define refund o reversal.
14. Define restitución de inventario.
15. Define impuestos y documentos.
16. Registra la devolución.
17. Incrementa versión.
18. Publica eventos.
19. Actualiza proyecciones.
20. Conserva auditoría.

## Reglas

1. No puede devolverse más cantidad que la vendida.
2. No puede devolverse más valor que el elegible.
3. Las devoluciones previas reducen elegibilidad.
4. Los productos dañados pueden no volver a inventario disponible.
5. Los servicios pueden tener política distinta.
6. Las líneas conservan snapshots.
7. La devolución no elimina la venta.
8. El refund se procesa separadamente.
9. El inventario se procesa separadamente.
10. La devolución debe ser idempotente.

---

# Devolución parcial

## Regla

Una devolución parcial afecta solo las líneas y cantidades seleccionadas.

## Resultado

Puede generar:

- refund parcial;
- restitución parcial;
- ajuste fiscal;
- crédito parcial;
- cambio parcial;
- proyección `PARTIALLY_RETURNED`.

## Invariantes

1. La suma devuelta no supera lo vendido.
2. La suma reembolsada no supera el saldo elegible.
3. Las cantidades se controlan por línea.
4. Las promociones deben recalcularse según política.
5. Los impuestos deben conservar trazabilidad.
6. El inventario debe conocer el estado físico.
7. La venta original permanece inmutable.
8. El mismo componente no se devuelve dos veces.

---

# Devolución total

## Regla

Una devolución total consume todas las cantidades y valores elegibles.

## Resultado

Puede producir:

- proyección `FULLY_RETURNED`;
- refund total;
- reversal total;
- restitución total o parcial;
- documentos correctivos;
- cierre de saldo elegible.

## Restricción

Una venta totalmente devuelta no admite otra devolución sobre el mismo saldo.

---

# Política de inventario en devoluciones

## Clasificación física

- `RESTOCKABLE`;
- `DAMAGED`;
- `EXPIRED`;
- `OPENED`;
- `QUARANTINE`;
- `DISCARDED`;
- `RETURN_TO_SUPPLIER`;
- `NOT_APPLICABLE`.

## Reglas

1. Devolver comercialmente no implica restituir automáticamente.
2. El estado físico debe registrarse.
3. Solo unidades aptas vuelven al disponible.
4. Las unidades dañadas generan otro movimiento.
5. Las unidades vencidas no vuelven a disponible.
6. La restitución conserva lote cuando aplique.
7. La restitución conserva serie cuando aplique.
8. Un servicio no genera inventario.
9. La cantidad restituida no supera la devuelta.
10. Toda restitución queda auditada.

---

# Liberación de inventario al cancelar

## Regla principal

Cancelar una venta no completada libera reservas no consumidas.

## Flujo

1. Consultar reservas.
2. Validar versión.
3. Identificar cantidades comprometidas.
4. Liberar reservas elegibles.
5. Registrar movimientos.
6. Mantener consumos ya confirmados.
7. Generar incidencia si existe conflicto.
8. Publicar `SaleInventoryReleased`.

## Prohibiciones

No se permite:

- aumentar inventario sin movimiento;
- liberar dos veces;
- liberar cantidades ya vendidas;
- modificar el historial;
- liberar inventario de otro tenant;
- ignorar reservas offline.

---

# Restitución de inventario tras devolución

## Regla principal

La restitución depende del estado físico y la política.

## Flujo

1. Recibir unidades.
2. Validar línea original.
3. Validar cantidad.
4. Clasificar estado físico.
5. Determinar destino.
6. Registrar movimiento.
7. Actualizar proyección.
8. Publicar evento.
9. Conservar evidencia.

## Destinos posibles

- inventario disponible;
- cuarentena;
- desperdicio;
- reparación;
- devolución a proveedor;
- almacenamiento separado.

---

# Inventario y compensaciones

## Regla

Una corrección de inventario genera un movimiento compensatorio.

## Ejemplos

- liberación duplicada;
- restitución incorrecta;
- cantidad mal registrada;
- lote equivocado;
- producto equivocado;
- sincronización tardía.

## Prohibiciones

No se permite:

- editar saldo directamente;
- borrar movimientos;
- ocultar diferencias;
- reutilizar la misma compensación;
- aplicar compensación sin causa.

---

# Relación con caja

## Venta en efectivo

Genera movimientos según `CASH-003`.

## Cambio

Se registra como salida.

## Refund en efectivo

Se registra como salida separada.

## Cancelación

No elimina movimientos.

## Devolución

Puede generar salida.

## Reimpresión

No genera movimientos.

## Regla

La venta nunca modifica directamente el saldo físico de caja sin un movimiento explícito.

---

# Relación con conciliación

La conciliación:

- valida pagos;
- valida caja;
- valida refunds;
- valida reversals;
- detecta diferencias;
- no modifica la venta original;
- no modifica movimientos originales;
- genera incidencias o ajustes explícitos.

---

# Estados de devolución

## `RETURN_REQUESTED`

La solicitud fue creada.

## `RETURN_UNDER_REVIEW`

La devolución requiere validación.

## `RETURN_APPROVED`

La devolución fue autorizada.

## `RETURN_REJECTED`

La devolución fue negada.

## `RETURN_EXECUTION_IN_PROGRESS`

Se están ejecutando efectos.

## `RETURN_COMPLETED`

Los efectos requeridos fueron completados.

## `RETURN_PARTIALLY_COMPLETED`

Solo algunos efectos se completaron.

## `RETURN_FAILED`

La operación falló.

## `RETURN_REVIEW_REQUIRED`

Existe incertidumbre o contradicción.

## Regla

Estos estados pertenecen al proceso de devolución, no deben mezclarse automáticamente con `Sale`.

---

# Invariantes de anulaciones y devoluciones

1. Una venta completada no vuelve a borrador.
2. Una cancelación no elimina pagos.
3. Una devolución no elimina la venta.
4. Un refund no elimina el pago.
5. Un reversal no elimina el pago.
6. Un movimiento de caja no se elimina.
7. Un movimiento de inventario no se elimina.
8. El mismo valor no se reembolsa dos veces.
9. La misma cantidad no se restituye dos veces.
10. Un timeout no decide el resultado.
11. Toda corrección es una operación nueva.
12. Toda compensación conserva referencia.
13. Todo efecto parcial permanece visible.
14. Toda incertidumbre genera revisión.
15. Toda operación crítica queda auditada.

---

# Reimpresión

## Propósito

Permitir obtener una copia adicional de un comprobante, ticket, recibo o documento previamente emitido sin crear una nueva venta ni duplicar efectos.

## Regla principal

La reimpresión es una operación documental.

No debe:

- crear una venta;
- crear un pago;
- crear un movimiento de caja;
- descontar inventario;
- consumir consecutivo nuevo, salvo política fiscal explícita;
- alterar el documento original;
- modificar importes;
- modificar impuestos;
- modificar cliente;
- modificar fecha original.

## Datos mínimos

- `sale_id`;
- documento original;
- tipo de documento;
- actor;
- motivo;
- terminal;
- fecha;
- cantidad de copias;
- idempotency key;
- versión esperada cuando aplique.

## Flujo principal

1. El actor solicita reimpresión.
2. El sistema valida autenticación.
3. Valida tenant.
4. Valida permisos.
5. Valida venta.
6. Valida documento original.
7. Valida que el documento no esté anulado o reemplazado sin referencia.
8. Consulta la idempotency key.
9. Recupera snapshot original.
10. Genera una copia marcada como reimpresión.
11. Conserva identificador del documento original.
12. Registra actor.
13. Registra motivo.
14. Registra fecha de reimpresión.
15. Envía a impresión.
16. Registra resultado.
17. Publica `SaleDocumentReprinted`.

## Reglas

1. Toda copia debe identificarse como reimpresión.
2. La fecha comercial original no cambia.
3. La fecha de reimpresión debe conservarse.
4. La copia debe referenciar el original.
5. Un fallo de impresora no genera nueva venta.
6. Un reintento no duplica efectos comerciales.
7. Puede existir más de una reimpresión.
8. Cada reimpresión queda auditada.
9. La política puede exigir motivo.
10. La política puede limitar cantidad de copias.

---

# Fallo de impresión

## Regla principal

Un fallo de impresión no revierte una venta completada.

## Tratamiento

1. La venta conserva su estado.
2. Los pagos conservan su estado.
3. La caja conserva movimientos.
4. El inventario conserva movimientos.
5. Se registra el fallo.
6. El documento queda disponible para reimpresión.
7. El sistema puede reintentar.
8. El reintento debe ser idempotente.
9. La UI debe informar claramente.
10. El usuario no debe repetir la venta.

## Estados conceptuales de impresión

- `PRINT_PENDING`;
- `PRINTING`;
- `PRINTED`;
- `PRINT_FAILED`;
- `REPRINT_REQUESTED`;
- `REPRINTED`.

Estos estados pertenecen al proceso de impresión, no a `Sale`.

---

# Operación offline

## Principio

Una venta puede construirse, suspenderse, recuperarse y completarse offline únicamente dentro de las capacidades autorizadas por política.

## Permitido

- crear borrador;
- agregar líneas;
- suspender;
- recuperar;
- registrar efectivo;
- reservar inventario local disponible;
- emitir documento local provisional;
- registrar movimientos locales;
- almacenar eventos en outbox.

## Restringido

- confirmar proveedores externos;
- validar transferencias;
- confirmar saldos remotos;
- consultar inventario central actualizado;
- emitir documentos fiscales definitivos cuando la regulación exija conexión;
- aplicar promociones que requieran autoridad central;
- aprobar excepciones críticas sin política local.

## Reglas

1. Toda operación conserva identificador global.
2. Toda operación conserva idempotency key.
3. Toda operación conserva versión local.
4. Toda operación conserva fecha del dispositivo.
5. Toda operación conserva fecha de recepción.
6. Toda operación conserva dispositivo.
7. La outbox debe sobrevivir reinicios.
8. La sincronización no duplica ventas.
9. La sincronización no duplica pagos.
10. La sincronización no duplica inventario.
11. Los conflictos no se resuelven silenciosamente.
12. Una venta completada offline puede quedar pendiente de validación central.
13. Un pago externo no se confirma offline sin evidencia válida.
14. Una operación tardía conserva fecha original.
15. Un periodo cerrado no se reescribe silenciosamente.

---

# Conflictos offline

## Tipos

- misma venta modificada en dos dispositivos;
- reserva consumida en otra terminal;
- precio cambiado;
- promoción expirada;
- pago confirmado externamente;
- intento duplicado;
- venta cancelada centralmente;
- cliente modificado;
- límite de crédito consumido;
- turno cerrado;
- consecutivo en conflicto;
- documento fiscal rechazado.

## Tratamiento

1. Detectar conflicto.
2. Conservar ambas versiones.
3. Identificar autoridad por dato.
4. Clasificar severidad.
5. Impedir sobrescritura silenciosa.
6. Generar incidencia.
7. Permitir resolución autorizada.
8. Registrar decisión.
9. Crear compensaciones cuando aplique.
10. Publicar evento.

## Prohibiciones

No se permite:

- aplicar last-write-wins global;
- descartar una versión sin evidencia;
- inventar stock;
- inventar cobertura;
- duplicar pago;
- duplicar venta;
- ocultar conflicto de precio;
- cambiar fecha original.

---

# Operaciones tardías

## Casos

- pago externo confirmado después;
- venta offline recibida después del cierre;
- refund tardío;
- reversal tardío;
- reserva tardía;
- liberación tardía;
- reimpresión tardía;
- cancelación recibida después de completar;
- callback duplicado.

## Reglas

1. Toda operación tardía se autentica.
2. Se valida idempotencia.
3. Se conserva fecha original.
4. Se conserva fecha de recepción.
5. Se consulta estado actual.
6. Se detectan efectos ya aplicados.
7. No se reescribe el historial.
8. Se crea incidencia si existe contradicción.
9. Se crea compensación si corresponde.
10. La venta puede requerir revisión.

---

# Idempotencia

## Operaciones con claves separadas

- crear venta;
- actualizar borrador;
- suspender;
- recuperar;
- cancelar;
- anular;
- solicitar devolución;
- aprobar devolución;
- ejecutar refund;
- ejecutar reversal;
- liberar inventario;
- restituir inventario;
- reimprimir;
- publicar documento;
- sincronizar operación.

## Regla

```text
misma clave + mismo contenido
→ mismo resultado

misma clave + contenido diferente
→ conflicto
```

## Reglas

1. Las claves no se reutilizan entre operaciones diferentes.
2. Una venta no se duplica por reintento.
3. Un pago no se duplica por reintento.
4. Una reserva no se duplica por reintento.
5. Una devolución no se duplica por reintento.
6. Una reimpresión repetida con la misma clave devuelve el resultado existente.
7. Un timeout obliga a consultar el estado.
8. Los callbacks externos se deduplican.
9. Las respuestas tardías conservan correlation ID.
10. Toda colisión se registra.

---

# Concurrencia

## Riesgos

- dos usuarios recuperan la misma venta;
- dos usuarios cancelan la misma venta;
- devolución concurrente;
- refund y reversal concurrentes;
- venta y cierre de turno simultáneos;
- venta y cambio de precio simultáneos;
- reserva y liberación simultáneas;
- reimpresión concurrente;
- operación offline tardía;
- doble callback.

## Reglas

1. Toda operación usa versión esperada.
2. La actualización de estado y efectos debe compartir transacción lógica.
3. Dos operaciones incompatibles no pueden completarse.
4. Un saldo elegible se reserva antes de consumir.
5. Una cantidad elegible se reserva antes de devolver.
6. Un mismo inventario no se compromete dos veces.
7. Los locks no sustituyen idempotencia.
8. Los eventos se publican mediante outbox o equivalente.
9. Las proyecciones toleran reentrega.
10. Un timeout no autoriza repetir ciegamente.

---

# Control de versión

## Regla

Toda mutación debe incluir `expected_version`.

## Conflicto

Si:

```text
expected_version != current_version
```

la operación se rechaza con conflicto de versión.

## Tratamiento

1. Recuperar estado actual.
2. Mostrar diferencias.
3. Permitir reintento consciente.
4. No fusionar automáticamente cambios críticos.
5. Mantener la intención original.
6. Registrar conflicto.
7. Conservar correlation ID.

---

# Permisos

## Cajero

Puede:

- crear venta;
- modificar borrador;
- suspender;
- recuperar;
- cancelar ventas no completadas;
- solicitar devolución;
- reimprimir;
- registrar pagos permitidos.

No puede, salvo permiso especial:

- anular venta completada;
- aprobar su propia devolución crítica;
- ejecutar ajustes financieros críticos;
- cambiar precios bloqueados;
- liberar inventario manualmente;
- modificar documentos fiscales;
- borrar ventas;
- editar pagos confirmados.

## Supervisor

Puede:

- aprobar cancelaciones excepcionales;
- aprobar devoluciones;
- resolver conflictos;
- autorizar reimpresiones especiales;
- aprobar cambios comerciales;
- revisar auditoría;
- autorizar void cuando aplique.

## Administrador

Puede:

- configurar políticas;
- aprobar operaciones críticas;
- gestionar excepciones;
- revisar incidencias;
- autorizar compensaciones;
- ordenar investigaciones;
- definir ventanas y límites.

## Domiciliario

Puede:

- consultar venta o pedido asignado;
- registrar entrega;
- registrar efectivo recibido;
- reportar pago;
- solicitar incidencia.

No puede:

- modificar líneas;
- cambiar precio;
- cancelar venta;
- aprobar devolución;
- confirmar transferencia;
- reimprimir documentos fiscales;
- modificar inventario.

---

# Segregación de funciones

## Regla

La política puede exigir que una misma persona no:

- solicite y apruebe devolución;
- cree y apruebe compensación;
- registre y acepte diferencia crítica;
- anule y valide documento;
- ejecute refund crítico sin aprobación;
- modifique precio y complete venta.

## Evidencia

Debe conservarse:

- solicitante;
- aprobador;
- ejecutor;
- fechas;
- motivos;
- roles;
- permisos;
- política aplicada.

---

# Auditoría obligatoria

Debe registrarse:

- tenant;
- empresa;
- sucursal;
- terminal;
- dispositivo;
- usuario;
- rol;
- venta;
- versión;
- estado anterior;
- estado nuevo;
- operación;
- motivo;
- líneas afectadas;
- cantidades;
- importes;
- moneda;
- pagos relacionados;
- movimientos de caja;
- movimientos de inventario;
- documentos;
- idempotency key;
- correlation ID;
- fecha local;
- fecha del servidor;
- aprobaciones;
- errores;
- reintentos;
- evidencia.

No debe almacenar:

- contraseñas;
- tokens;
- secretos;
- datos de tarjeta restringidos;
- información innecesaria.

---

# Eventos de dominio

## Venta

- `SaleCreated`;
- `SaleUpdated`;
- `SaleReadyForPayment`;
- `SalePaymentStarted`;
- `SaleCompleted`;
- `SaleSuspended`;
- `SuspendedSaleRecovered`;
- `SuspendedSaleExpired`;
- `SaleCancelled`;
- `SaleVoided`.

## Devoluciones

- `SaleReturnRequested`;
- `SaleReturnApproved`;
- `SaleReturnRejected`;
- `SaleReturnStarted`;
- `SaleReturnPartiallyCompleted`;
- `SaleReturnCompleted`;
- `SaleReturnFailed`;
- `SaleReturnReviewRequired`.

## Inventario

- `SaleInventoryReserved`;
- `SaleInventoryReleased`;
- `SaleInventoryCommitted`;
- `SaleInventoryRestocked`;
- `SaleInventoryRestockRejected`.

## Documentos

- `SaleDocumentIssued`;
- `SaleDocumentPrintFailed`;
- `SaleDocumentReprintRequested`;
- `SaleDocumentReprinted`.

## Regla

Todo evento debe:

- incluir tenant;
- incluir agregado;
- incluir versión;
- incluir correlation ID;
- ser idempotente;
- no contener secretos;
- tolerar reentrega;
- conservar fecha del evento.

---

# Errores funcionales

- `SALE_NOT_FOUND`;
- `SALE_INVALID_STATE`;
- `SALE_VERSION_CONFLICT`;
- `SALE_PERMISSION_DENIED`;
- `SALE_IDEMPOTENCY_CONFLICT`;
- `SALE_ALREADY_COMPLETED`;
- `SALE_ALREADY_CANCELLED`;
- `SALE_ALREADY_EXPIRED`;
- `SALE_NOT_SUSPENDED`;
- `SALE_SUSPENSION_EXPIRED`;
- `SALE_PAYMENT_INCOMPLETE`;
- `SALE_PAYMENT_UNCERTAIN`;
- `SALE_PAYMENT_COMPENSATION_REQUIRED`;
- `SALE_OVERPAYMENT_REQUIRES_RESOLUTION`;
- `SALE_RETURN_NOT_ELIGIBLE`;
- `SALE_RETURN_QUANTITY_EXCEEDED`;
- `SALE_RETURN_AMOUNT_EXCEEDED`;
- `SALE_REFUND_REQUIRED`;
- `SALE_REVERSAL_REQUIRED`;
- `SALE_INVENTORY_CONFLICT`;
- `SALE_INVENTORY_RELEASE_FAILED`;
- `SALE_RESTOCK_REJECTED`;
- `SALE_PRINT_FAILED`;
- `SALE_DOCUMENT_NOT_FOUND`;
- `SALE_OFFLINE_CONFLICT`;
- `SALE_LATE_OPERATION_REQUIRES_REVIEW`;
- `SALE_EVIDENCE_REQUIRED`;
- `SALE_APPROVAL_REQUIRED`.

---

# Excepciones funcionales

## Venta no encontrada

La operación se rechaza.

## Estado incompatible

La transición se rechaza.

## Pago incierto

La venta queda pendiente o en revisión.

## Inventario insuficiente

La venta no se completa.

## Precio desactualizado

Debe revalidarse y solicitar aceptación cuando corresponda.

## Documento no disponible

La reimpresión se rechaza o se recupera desde almacenamiento autorizado.

## Conflicto offline

No se sobrescribe silenciosamente.

## Error después de entregar producto

Debe escalarse y conservar evidencia.

## Error después de cobrar

No se repite el cobro sin consultar estado.

---

# Recuperación ante fallos

## Fallo antes de persistir

No existe efecto confirmado.

## Fallo después de persistir y antes de responder

El cliente debe consultar por idempotency key.

## Fallo después de publicar parcialmente

La outbox o mecanismo equivalente completa la publicación.

## Fallo de proveedor

La operación permanece pendiente o incierta.

## Fallo de impresión

La venta permanece completada y puede reimprimirse.

## Fallo de inventario

La venta puede quedar en revisión o requerir compensación.

## Regla

El sistema debe poder determinar el resultado real sin depender de repetir ciegamente la operación.

---

# Integración con caja

## Reglas

1. Una venta en efectivo genera movimientos explícitos.
2. El cambio genera salida explícita.
3. Un refund en efectivo genera salida explícita.
4. Una cancelación no elimina movimientos.
5. Una reimpresión no genera movimientos.
6. Un error comercial no ajusta caja automáticamente.
7. Toda diferencia se registra.
8. La conciliación no modifica ventas ni caja.

---

# Integración con inventario

## Reglas

1. La reserva no equivale a salida definitiva.
2. La venta completada compromete inventario.
3. La cancelación libera reservas.
4. La devolución puede restituir.
5. La restitución depende de estado físico.
6. Toda corrección genera movimiento.
7. Un conflicto offline genera incidencia.
8. Los lotes y series se conservan cuando apliquen.

---

# Integración con pagos

## Reglas

1. La venta no modifica pagos.
2. El estado de pago es derivado.
3. Un pago pendiente no cubre.
4. Un pago fallido no cubre.
5. Un pago confirmado permanece confirmado.
6. Un refund es una operación separada.
7. Un reversal es una operación separada.
8. Un sobrepago se resuelve explícitamente.
9. Un timeout no define resultado.
10. Los pagos mixtos mantienen componentes separados.

---

# Integración fiscal

## Principio

La venta y sus documentos fiscales deben conservar snapshots y referencias inmutables.

## Reglas

1. Un consecutivo no se reutiliza.
2. Una reimpresión conserva el consecutivo original.
3. Un void conserva el documento original.
4. Una devolución puede requerir documento correctivo.
5. Los impuestos deben conservar trazabilidad.
6. La operación offline debe respetar la regulación.
7. Un rechazo fiscal no borra la venta.
8. Las correcciones se registran mediante documentos o procesos autorizados.

---

# Integración con conciliación

## Reglas

1. La conciliación consume evidencia.
2. La conciliación no modifica la venta original.
3. Las diferencias generan incidencias.
4. Los refunds y reversals se concilian separadamente.
5. Los movimientos de caja se concilian separadamente.
6. Los documentos fiscales pueden ser evidencia complementaria.
7. Toda resolución conserva trazabilidad.

---

# Métricas operativas

Deben poder medirse:

- ventas suspendidas;
- tiempo promedio de suspensión;
- recuperaciones;
- expiraciones;
- cancelaciones;
- devoluciones;
- devoluciones parciales;
- refunds;
- reversals;
- reimpresiones;
- fallos de impresión;
- conflictos offline;
- respuestas tardías;
- operaciones en revisión;
- diferencias de inventario;
- diferencias de caja.

---

# Invariantes globales de SALES-002

1. Una venta nunca se elimina para corregirla.
2. Una venta completada no vuelve a borrador.
3. Una cancelación no elimina pagos.
4. Una cancelación no elimina caja.
5. Una cancelación no elimina inventario.
6. Una devolución no modifica la venta original.
7. Un refund no modifica el pago original.
8. Un reversal no modifica el pago original.
9. Una reimpresión no crea venta.
10. Una reimpresión no crea pago.
11. Un pago pendiente no cubre la venta.
12. Un pago fallido no cubre la venta.
13. Un sobrepago no cambia el total.
14. Una reserva no es una salida definitiva.
15. Una restitución requiere movimiento.
16. Un timeout no decide resultado.
17. Toda corrección es una operación nueva.
18. Toda transición crítica usa versión esperada.
19. Toda operación crítica es idempotente.
20. Todo cambio queda auditado.
21. Los datos se aíslan por tenant.
22. Los eventos tardíos no reescriben hechos cerrados.
23. El frontend no decide validez comercial, financiera, fiscal ni de inventario.

---

# Escenarios de aceptación

## Escenario 1 — Suspender venta sin pagos

```text
Estado inicial: DRAFT
Pagos confirmados: 0
Reservas: activas
```

Resultado:

- la venta pasa a `SUSPENDED`;
- no se crean pagos;
- las reservas se conservan o liberan según política;
- se registra motivo;
- se publica `SaleSuspended`.

## Escenario 2 — Recuperar venta suspendida

```text
Estado inicial: SUSPENDED
Versión esperada: válida
```

Resultado:

- se revalidan precios;
- se revalidan promociones;
- se revalida inventario;
- se revalidan pagos;
- no se duplican reservas;
- la venta pasa al estado operativo correspondiente.

## Escenario 3 — Recuperación con precio modificado

Resultado:

- el sistema detecta el cambio;
- no sobrescribe el snapshot anterior;
- muestra la diferencia;
- solicita aceptación cuando corresponda;
- crea una nueva versión;
- conserva auditoría.

## Escenario 4 — Expiración de venta suspendida

Resultado:

- la venta pasa a `EXPIRED`;
- las reservas elegibles se liberan;
- los pagos no se eliminan;
- si existen pagos confirmados, se crea incidencia o compensación;
- no se permite recuperación directa.

## Escenario 5 — Cancelación sin pagos

```text
Estado: DRAFT
Cobertura confirmada: 0
```

Resultado:

- la venta pasa a `CANCELLED`;
- se liberan reservas;
- no se crea refund;
- no se crea reversal;
- no se crean movimientos financieros.

## Escenario 6 — Cancelación con pago parcial en efectivo

```text
Total exigible: 100.000
Efectivo confirmado: 40.000
Saldo pendiente: 60.000
```

Resultado:

- la venta se cancela comercialmente;
- el pago confirmado permanece;
- la caja conserva la entrada;
- se crea refund o compensación en efectivo;
- la venta no se elimina.

## Escenario 7 — Cancelación con tarjeta pendiente

Resultado:

- el intento permanece pendiente o incierto;
- se consulta al proveedor;
- la venta no se marca pagada;
- no se repite el cobro;
- una confirmación tardía genera incidencia.

## Escenario 8 — Cancelación con tarjeta confirmada

Resultado:

- el pago permanece confirmado;
- se determina reversal o refund;
- la venta conserva trazabilidad;
- no se modifica el pago original;
- la compensación queda auditada.

## Escenario 9 — Pago mixto con fallo parcial

```text
Total exigible: 100.000
Efectivo confirmado: 40.000
Tarjeta fallida: 60.000
```

Resultado:

- la cobertura confirmada es 40.000;
- la venta queda parcialmente pagada;
- el componente fallido permanece visible;
- se puede agregar otro medio;
- no se borra el efectivo confirmado.

## Escenario 10 — Sobrepago detectado

```text
Total exigible: 100.000
Cobertura confirmada: 120.000
```

Resultado:

- la venta conserva total 100.000;
- el exceso de 20.000 queda clasificado;
- se resuelve mediante operación separada;
- no se altera el precio;
- no se oculta como descuento.

## Escenario 11 — Devolución parcial

```text
Cantidad vendida: 10
Cantidad devuelta: 3
```

Resultado:

- se valida elegibilidad;
- se registra devolución parcial;
- se calcula valor elegible;
- se procesa refund o reversal;
- el inventario se restituye según estado físico;
- la venta proyecta `PARTIALLY_RETURNED`.

## Escenario 12 — Devolución total

Resultado:

- todas las cantidades elegibles se consumen;
- no se permite devolver el mismo saldo otra vez;
- se ejecutan efectos financieros;
- se ejecutan efectos de inventario;
- la venta proyecta `FULLY_RETURNED`.

## Escenario 13 — Producto devuelto dañado

Resultado:

- la devolución comercial puede aprobarse;
- el producto no vuelve a disponible;
- se clasifica como `DAMAGED`;
- se crea movimiento de inventario separado;
- el refund se procesa independientemente.

## Escenario 14 — Reimpresión

Resultado:

- se recupera el documento original;
- se imprime copia marcada como reimpresión;
- no se crea una venta;
- no se crea un pago;
- no se modifica inventario;
- queda auditado.

## Escenario 15 — Fallo de impresión

Resultado:

- la venta permanece `COMPLETED`;
- los pagos permanecen;
- la caja permanece;
- el inventario permanece;
- se registra el fallo;
- se habilita reimpresión.

## Escenario 16 — Venta offline sincronizada

Resultado:

- se valida idempotencia;
- se conserva fecha local;
- se conserva fecha de recepción;
- no se duplica venta;
- no se duplican pagos;
- no se duplica inventario;
- se actualizan proyecciones.

## Escenario 17 — Conflicto offline de inventario

Resultado:

- no se inventa stock;
- se conservan ambas versiones;
- se crea incidencia;
- se bloquea consolidación silenciosa;
- se requiere resolución autorizada.

## Escenario 18 — Callback tardío después de cancelación

Resultado:

- se autentica el callback;
- se identifica la venta cancelada;
- no se reabre automáticamente;
- se crea incidencia;
- se determina refund o reversal;
- no se duplica el cobro.

## Escenario 19 — Doble solicitud de devolución

Resultado:

- la segunda solicitud con misma clave devuelve el resultado existente;
- no se consume saldo dos veces;
- no se restituye inventario dos veces;
- no se genera un segundo refund.

## Escenario 20 — Conflicto de versión

Resultado:

- la operación se rechaza;
- se recupera la versión actual;
- se muestran diferencias;
- no se sobrescriben cambios;
- el usuario puede reintentar conscientemente.

---

# Pruebas mínimas

## Unitarias

1. Validar transición `DRAFT → SUSPENDED`.
2. Validar transición `SUSPENDED → DRAFT`.
3. Rechazar recuperación de venta expirada.
4. Calcular saldo pendiente.
5. Calcular sobrepago.
6. Calcular elegibilidad de devolución.
7. Validar cantidad devuelta.
8. Validar valor reembolsable.
9. Clasificar restitución de inventario.
10. Validar idempotency key.
11. Validar versión esperada.
12. Validar permisos.
13. Validar estado de venta.
14. Validar proyección de pago.
15. Validar proyección de inventario.
16. Impedir reimpresión como nueva venta.
17. Impedir doble refund.
18. Impedir doble restitución.
19. Impedir recuperación de venta cancelada.
20. Impedir transición inválida.

## Integración

1. Suspensión con reservas.
2. Recuperación con revalidación de precios.
3. Recuperación con pagos pendientes.
4. Cancelación sin pagos.
5. Cancelación con efectivo confirmado.
6. Cancelación con proveedor pendiente.
7. Cancelación con proveedor confirmado.
8. Devolución parcial y refund.
9. Devolución total y refund.
10. Devolución y restitución de inventario.
11. Producto dañado sin restitución disponible.
12. Reimpresión.
13. Fallo de impresión.
14. Outbox.
15. Auditoría.
16. Multi-tenant.
17. Operación offline.
18. Callback tardío.
19. Conciliación.
20. Documentos fiscales.

## Concurrencia

1. Dos recuperaciones simultáneas.
2. Dos cancelaciones simultáneas.
3. Dos devoluciones sobre la misma línea.
4. Refund y reversal simultáneos.
5. Dos restituciones sobre la misma cantidad.
6. Suspensión durante pago.
7. Cancelación durante callback.
8. Venta durante cierre de turno.
9. Reimpresión concurrente.
10. Sincronización tardía.
11. Dos dispositivos modificando la misma venta.
12. Reserva y liberación simultáneas.
13. Cambio de precio concurrente.
14. Doble callback.
15. Reintento después de timeout.

## Seguridad

1. Usuario sin permiso intenta cancelar.
2. Cajero intenta aprobar su propia devolución crítica.
3. Domiciliario intenta modificar la venta.
4. Domiciliario intenta confirmar transferencia.
5. Acceso entre tenants.
6. Reimpresión sin permiso.
7. Void sin autorización.
8. Ajuste sin motivo.
9. Modificación de pago confirmado.
10. Liberación de inventario ajeno.
11. Uso de terminal no autorizada.
12. Manipulación de versión.
13. Idempotency key reutilizada con contenido diferente.
14. Evidencia faltante.
15. Documento fiscal modificado.

## Recuperación y resiliencia

1. Caída antes de persistir.
2. Caída después de persistir y antes de responder.
3. Caída durante publicación de eventos.
4. Caída durante refund.
5. Caída durante reversal.
6. Caída durante liberación de inventario.
7. Caída durante restitución.
8. Caída durante reimpresión.
9. Reinicio con outbox pendiente.
10. Callback tardío.
11. Proveedor no disponible.
12. Impresora no disponible.
13. Base de datos temporalmente no disponible.
14. Reintento idempotente.
15. Reconstrucción de proyecciones.

---

# Matriz mínima de estados y operaciones

| Estado de venta | Suspender | Recuperar | Cancelar | Devolver | Reimprimir |
|---|---:|---:|---:|---:|---:|
| `DRAFT` | Sí | No | Sí | No | No |
| `SUSPENDED` | No | Sí | Sí | No | Según documento existente |
| `READY_FOR_PAYMENT` | Sí | No | Sí | No | Según documento existente |
| `PAYMENT_IN_PROGRESS` | Sí, con validación | No | Sí, con resolución financiera | No | Según documento existente |
| `COMPLETED` | No | No | No directamente | Sí | Sí |
| `CANCELLED` | No | No | No | No, salvo política excepcional | Sí, si existe documento |
| `EXPIRED` | No | No | No | No | Según documento existente |
| `RETURN_IN_PROGRESS` | No | No | No | Continuar proceso | Sí |
| `PARTIALLY_RETURNED` | No | No | No | Sí, sobre saldo elegible | Sí |
| `FULLY_RETURNED` | No | No | No | No | Sí |
| `VOIDED` | No | No | No | Según política correctiva | Sí |

---

# Matriz mínima de efectos

| Operación | Venta | Pago | Caja | Inventario | Documento |
|---|---|---|---|---|---|
| Suspender | Cambia estado | Conserva | Sin efecto directo | Mantiene o libera reserva | Sin efecto |
| Recuperar | Nueva versión | Revalida | Sin efecto directo | Revalida reserva | Sin efecto |
| Cancelar sin pago | `CANCELLED` | Sin efecto | Sin efecto | Libera reserva | Puede registrar cancelación |
| Cancelar con pago | `CANCELLED` o revisión | Refund/Reversal | Compensación explícita | Libera reserva | Puede requerir corrección |
| Devolver | Proyección derivada | Refund/Reversal | Puede generar salida | Restituye según estado | Puede requerir documento |
| Reimprimir | Sin cambio | Sin cambio | Sin cambio | Sin cambio | Nueva copia del original |
| Void | `VOIDED` | No se borra | No se borra | No se borra | Conserva original y corrección |

---

# Criterios de aceptación

`SALES-002` se considera completo cuando:

1. están definidos estados persistentes de `Sale`;
2. están separadas las proyecciones de pago;
3. están separadas las proyecciones de inventario;
4. está definida suspensión;
5. está definida recuperación;
6. está definida expiración;
7. está definida cancelación antes de completar;
8. está definido tratamiento de pagos pendientes;
9. está definido tratamiento de pagos confirmados;
10. está definido tratamiento de pagos parciales;
11. está definido tratamiento de sobrepagos;
12. está definida devolución parcial;
13. está definida devolución total;
14. está definida selección entre refund y reversal;
15. está definida liberación de inventario;
16. está definida restitución de inventario;
17. está definida reimpresión;
18. está definido fallo de impresión;
19. está definida operación offline;
20. están definidos conflictos offline;
21. están definidas operaciones tardías;
22. está definida idempotencia;
23. está definida concurrencia;
24. están definidos permisos;
25. está definida segregación de funciones;
26. están definidos eventos;
27. están definidos errores funcionales;
28. están definidas pruebas mínimas;
29. existe coherencia con `UC-SALES-001`;
30. existe coherencia con `UC-PAY-004`;
31. existe coherencia con `UC-PAY-005`;
32. existe coherencia con `UC-PAY-006`;
33. existe coherencia con `CASH-003`;
34. existe coherencia con `DEC-002`;
35. existe coherencia con `payment-state-model.md`;
36. no se autoriza todavía diseño físico;
37. el backlog incluye evidencia verificable.

---

# Consecuencias para SALES-003

`SALES-003` deberá definir la implementación comercial de:

- cálculo final;
- persistencia de snapshots;
- integración con precios;
- promociones;
- descuentos;
- impuestos;
- redondeo;
- cobertura de pagos;
- inventario;
- emisión documental;
- transacción lógica;
- outbox;
- recuperación.

No podrá contradecir los estados, invariantes y operaciones definidos aquí.

---

# Consecuencias para TECH-002

El diseño físico deberá contemplar, sin decidirse todavía en este documento:

- identidad de venta;
- versionado;
- estados persistentes separados;
- proyecciones reconstruibles;
- líneas y snapshots;
- suspensiones;
- cancelaciones;
- devoluciones;
- referencias a pagos;
- referencias a caja;
- referencias a inventario;
- documentos;
- idempotencia;
- auditoría;
- outbox;
- aislamiento multiempresa;
- operación local-first.

---

# Consecuencias para TECH-003

Los contratos API posteriores deberán distinguir:

- comandos;
- consultas;
- idempotency keys;
- expected version;
- errores de negocio;
- conflictos;
- resultados pendientes;
- resultados inciertos;
- operaciones compensatorias;
- reimpresión;
- devolución;
- cancelación;
- suspensión;
- recuperación.

No debe existir un endpoint genérico que permita escribir cualquier estado arbitrariamente.

---

# Restricciones arquitectónicas

Este documento no autoriza todavía:

- tablas definitivas;
- migraciones;
- índices;
- triggers;
- endpoints;
- contratos API definitivos;
- implementación del frontend;
- implementación fiscal;
- implementación contable;
- cierre del modelo físico.

Todo diseño posterior deberá respetar:

- agregados separados;
- operaciones inmutables;
- compensaciones;
- idempotencia;
- versión esperada;
- auditoría;
- outbox;
- multiempresa;
- local-first;
- permisos;
- segregación de funciones;
- proyecciones reconstruibles.

---

# Decisiones abiertas relacionadas

Este documento no cierra:

- `DEC-003`;
- `DEC-004`;
- `DEC-006`;
- `DEC-007`;
- `DEC-008`.

Estas decisiones aún pueden afectar:

- cálculo final;
- catálogo;
- persistencia;
- redondeo;
- sincronización;
- seguridad;
- licenciamiento;
- dispositivos.

No deben modificar las invariantes cerradas de ventas, pagos y caja sin actualizar formalmente este documento.

---

# Estado del documento

Estado: `IN_PROGRESS`

El documento puede pasar a `DONE` cuando:

- se valide la estructura;
- se complete revisión funcional;
- se complete revisión arquitectónica;
- no contradiga `UC-SALES-001`;
- no contradiga pagos;
- no contradiga caja;
- no contradiga inventario;
- no contradiga `DEC-002`;
- no contradiga `payment-state-model.md`;
- incluya evidencia verificable;
- el backlog marque `SALES-002` como `DONE`;
- las decisiones abiertas permanezcan explícitas;
- pueda continuarse la Fase 0 sin ambigüedades críticas de ventas.
