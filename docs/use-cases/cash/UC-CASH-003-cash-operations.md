# UC-CASH-003 — Operaciones, movimientos, arqueos y compensaciones de caja

## Estado

`DONE`

## Prioridad

`P0`

## Propósito

Definir el comportamiento operativo completo de la caja después de su apertura y antes de su cierre, incluyendo:

- ingresos;
- egresos;
- retiros;
- depósitos;
- cambio;
- devoluciones en efectivo;
- compensaciones;
- arqueos parciales;
- diferencias;
- recaudo de domiciliarios;
- operación offline;
- concurrencia;
- auditoría;
- recuperación ante errores.

Este caso de uso complementa:

- `UC-CASH-001-open-register.md`;
- `UC-CASH-002-close-register.md`;
- `UC-PAY-004-refund-payment.md`;
- `UC-PAY-005-reconcile-payment.md`;
- `DEC-002-payment-compensation-policy.md`;
- `payment-lifecycle.md`;
- `payment-state-model.md`.

---

# Alcance

Este documento define las reglas funcionales y operativas para administrar movimientos de efectivo durante un turno de caja.

Incluye:

- registro de movimientos;
- clasificación;
- validación;
- autorización;
- trazabilidad;
- conciliación;
- compensación;
- tratamiento de diferencias;
- interacción con ventas y pagos;
- recaudo de domiciliarios;
- operación local-first;
- idempotencia;
- concurrencia;
- eventos de dominio.

No define todavía:

- tablas físicas;
- migraciones;
- índices;
- endpoints;
- contratos SQL;
- componentes de frontend;
- implementación del hardware;
- integración contable definitiva.

---

# Dependencias

## Dependencias completadas

- `UC-CASH-001`;
- `UC-CASH-002`;
- `UC-PAY-004`;
- `UC-PAY-005`;
- `DEC-001`;
- `DEC-002`.

## Dependencias posteriores

Este documento habilita o condiciona:

- `CASH-004`;
- `SALES-002`;
- `PAY-009`;
- implementación de caja;
- conciliación;
- diseño físico;
- auditoría;
- operación offline.

---

# Actores

## Actor principal

- Cajero autorizado.

## Actores secundarios

- Administrador de sucursal;
- propietario;
- supervisor;
- domiciliario;
- asesor autorizado;
- sistema de pagos;
- sistema de ventas;
- sistema de auditoría;
- motor de sincronización;
- proceso de conciliación;
- proveedor externo, cuando corresponda.

---

# Conceptos

## CashRegister

Representa una caja lógica o física asociada a:

- tenant;
- empresa;
- sucursal;
- terminal;
- turno;
- usuario responsable;
- moneda.

## CashShift

Periodo operativo comprendido entre apertura y cierre.

Debe conservar:

- identificador;
- caja;
- terminal;
- usuario de apertura;
- fecha de apertura;
- base inicial;
- estado;
- versión;
- moneda;
- política aplicada.

## CashMovement

Registro inmutable de una entrada o salida de efectivo.

Todo movimiento debe identificar:

- tipo;
- dirección;
- importe;
- moneda;
- caja;
- turno;
- actor;
- fecha del dispositivo;
- fecha del servidor;
- motivo;
- origen;
- referencia;
- evidencia;
- idempotency key;
- correlation ID;
- versión.

## ExpectedCash

Valor calculado que debería existir en caja.

## CountedCash

Valor físicamente contado durante arqueo o cierre.

## CashDifference

Diferencia entre efectivo esperado y efectivo contado.

```text
cash_difference = counted_cash - expected_cash
```

## CashCollection

Recaudo recibido de un domiciliario u otro actor autorizado.

## CashWithdrawal

Retiro de efectivo de caja.

## CashDeposit

Ingreso de efectivo no originado directamente en una venta.

## CashCompensation

Movimiento explícito que corrige o equilibra un efecto financiero anterior sin borrar el historial.

---

# Dirección de movimientos

## Entrada

Aumenta el efectivo esperado.

Ejemplos:

- venta en efectivo;
- abono en efectivo;
- ingreso autorizado;
- recaudo de domiciliario;
- devolución de cambio no entregado;
- corrección positiva autorizada.

## Salida

Reduce el efectivo esperado.

Ejemplos:

- cambio entregado;
- refund en efectivo;
- retiro;
- gasto autorizado;
- entrega de efectivo a tesorería;
- corrección negativa autorizada.

---

# Tipos conceptuales de movimiento

- `OPENING_FLOAT`;
- `CASH_SALE`;
- `CASH_PAYMENT`;
- `CHANGE_GIVEN`;
- `CASH_REFUND`;
- `CASH_REVERSAL_COMPENSATION`;
- `CASH_WITHDRAWAL`;
- `CASH_DEPOSIT`;
- `COURIER_COLLECTION`;
- `CASH_EXPENSE`;
- `CASH_ADJUSTMENT_POSITIVE`;
- `CASH_ADJUSTMENT_NEGATIVE`;
- `TRANSFER_TO_SAFE`;
- `TRANSFER_FROM_SAFE`;
- `CLOSING_TRANSFER`;
- `OTHER_AUTHORIZED`.

Los tipos definitivos deben quedar versionados y extensibles.

---

# Estados conceptuales del movimiento

- `CREATED`;
- `PENDING_APPROVAL`;
- `APPROVED`;
- `POSTED`;
- `REJECTED`;
- `FAILED`;
- `CANCELLED`;
- `REVERSED_BY_COMPENSATION`.

## Regla

Un movimiento `POSTED` no se elimina ni se edita destructivamente.

Cuando se requiere corregirlo:

- se crea un movimiento compensatorio;
- se conserva la relación con el movimiento original;
- se registra motivo;
- se registra aprobador;
- se conserva auditoría.

---

# Precondiciones generales

1. Existe un tenant válido.
2. Existe una empresa válida.
3. Existe una sucursal válida.
4. Existe una terminal autorizada.
5. Existe un turno abierto.
6. La caja no está cerrada.
7. La moneda es compatible con el turno.
8. El usuario está autenticado.
9. El usuario tiene permisos.
10. La operación incluye idempotency key.
11. La versión esperada del turno es válida.
12. La política de caja está vigente.
13. No existe bloqueo administrativo.
14. La operación no pertenece a otro tenant.

---

# Postcondiciones generales

Después de una operación válida:

- el movimiento queda registrado;
- el efectivo esperado se recalcula;
- la versión del turno aumenta;
- se genera auditoría;
- se publica evento;
- se conserva la idempotency key;
- las proyecciones quedan actualizables;
- la operación queda disponible para conciliación;
- si está offline, queda en outbox;
- no se duplican efectos.

---

# Invariantes globales

1. Todo movimiento pertenece a una caja.
2. Todo movimiento pertenece a un turno.
3. Un movimiento `POSTED` es inmutable.
4. Los movimientos no se eliminan.
5. Toda corrección genera compensación.
6. El efectivo esperado se deriva de movimientos.
7. El efectivo contado no reemplaza el esperado.
8. Una diferencia no se oculta.
9. Un movimiento no pertenece a dos tenants.
10. La misma operación no puede registrarse dos veces.
11. El cambio entregado debe quedar registrado.
12. Un refund en efectivo genera salida.
13. Un retiro no es una venta.
14. Un ingreso manual no es una venta.
15. Un recaudo de domiciliario no se registra como venta nueva.
16. La conciliación no modifica movimientos.
17. El frontend no determina la validez financiera.
18. Toda operación crítica queda auditada.
19. Los importes respetan moneda y precisión.
20. Ningún movimiento se crea con importe cero.
21. Ningún importe puede ser negativo.
22. La dirección determina el efecto.
23. El turno cerrado no admite movimientos normales.
24. Las operaciones tardías requieren tratamiento explícito.
25. La caja no inventa efectivo.

---

# Flujo principal — Registrar movimiento de caja

## Entrada mínima

- `cash_register_id`;
- `cash_shift_id`;
- `movement_type`;
- `direction`;
- `amount`;
- `currency`;
- `reason`;
- `source_type`;
- `source_id`;
- `idempotency_key`;
- `expected_version`.

## Flujo

1. El actor solicita registrar un movimiento.
2. El sistema valida autenticación.
3. El sistema valida tenant.
4. El sistema valida empresa.
5. El sistema valida sucursal.
6. El sistema valida terminal.
7. El sistema valida turno abierto.
8. El sistema valida permiso.
9. El sistema valida moneda.
10. El sistema valida importe.
11. El sistema valida tipo de movimiento.
12. El sistema valida dirección.
13. El sistema valida relación con la fuente.
14. El sistema consulta la idempotency key.
15. Si ya existe la misma operación, devuelve el resultado anterior.
16. Si la clave existe con contenido distinto, rechaza por conflicto.
17. El sistema valida versión esperada.
18. El sistema evalúa si requiere aprobación.
19. Si no requiere aprobación, registra el movimiento.
20. Si requiere aprobación, queda `PENDING_APPROVAL`.
21. El sistema recalcula efectivo esperado.
22. El sistema incrementa la versión del turno.
23. El sistema registra auditoría.
24. El sistema publica evento.
25. El sistema devuelve el resultado.

---

# Registro de venta en efectivo

## Regla

Una venta en efectivo confirmada genera entrada de caja.

## Datos mínimos

- venta;
- pago;
- componente;
- importe recibido;
- importe aplicado;
- cambio;
- moneda;
- terminal;
- turno;
- cajero.

## Efecto conceptual

```text
entrada por efectivo recibido
- salida por cambio entregado
= cobertura neta aplicada
```

## Reglas

1. El importe recibido puede ser mayor al saldo exigible.
2. El exceso debe clasificarse.
3. El cambio debe registrarse como salida.
4. El cambio no modifica el precio.
5. La cobertura de la venta depende del importe aplicado.
6. El efectivo esperado depende de lo recibido menos el cambio.
7. La operación de venta y los movimientos de caja deben ser atómicos.
8. Un reintento no duplica entrada ni cambio.
9. Una venta anulada no borra los movimientos.
10. La anulación puede requerir compensación.

---

# Cambio entregado

## Regla

El cambio es una salida de caja relacionada con efectivo recibido.

## Datos mínimos

- pago;
- venta;
- importe recibido;
- importe exigible;
- cambio calculado;
- cambio entregado;
- actor;
- turno.

## Invariantes

1. El cambio no puede exceder el efectivo recibido.
2. El cambio no puede ser negativo.
3. El cambio debe pertenecer a la misma moneda.
4. El cambio debe registrarse.
5. El cambio entregado debe coincidir con la política de redondeo vigente.
6. Una diferencia entre cambio calculado y entregado genera incidencia.
7. El sistema no debe ocultarla como ajuste automático.

---

# Ingreso manual

## Casos permitidos

- aporte de base adicional;
- depósito autorizado;
- corrección positiva;
- reposición;
- ingreso de tesorería;
- otro ingreso aprobado.

## Reglas

1. Debe existir motivo.
2. Puede requerir aprobación.
3. No genera venta.
4. No genera pago de cliente.
5. Conserva evidencia.
6. No puede utilizarse para cuadrar caja silenciosamente.
7. Debe quedar disponible para conciliación.

---

# Egreso manual

## Casos permitidos

- gasto autorizado;
- retiro;
- transferencia a caja fuerte;
- compensación;
- corrección negativa;
- entrega a tesorería;
- otro egreso aprobado.

## Reglas

1. Debe existir saldo suficiente o autorización especial.
2. Debe existir motivo.
3. Debe existir beneficiario o destino cuando aplique.
4. Puede requerir aprobación.
5. No elimina movimientos previos.
6. No se usa para esconder faltantes.
7. Debe conservar evidencia.
8. Debe quedar disponible para conciliación.

---

# Retiros de efectivo

## Propósito

Reducir el riesgo operativo retirando efectivo acumulado de la caja.

## Actores autorizados

- cajero, según límites;
- supervisor;
- administrador;
- propietario;
- tesorería autorizada.

## Datos mínimos

- turno;
- caja;
- importe;
- moneda;
- destino;
- motivo;
- actor;
- receptor;
- evidencia;
- idempotency key.

## Flujo

1. El actor solicita el retiro.
2. El sistema valida turno.
3. El sistema valida permiso.
4. El sistema valida límite.
5. El sistema valida efectivo esperado disponible.
6. Si requiere aprobación, queda pendiente.
7. El aprobador valida el retiro.
8. El efectivo se entrega.
9. Se registra salida.
10. Se registra receptor.
11. Se actualiza efectivo esperado.
12. Se publica evento.

## Reglas

1. Un retiro no cierra el turno.
2. Un retiro no modifica ventas.
3. Un retiro no modifica pagos.
4. El retiro debe tener destino.
5. El receptor debe quedar identificado.
6. Un retiro fallido no reduce el efectivo esperado.
7. Un retiro completado es inmutable.
8. Una corrección se hace con compensación.

---

# Transferencias entre caja y caja fuerte

## Reglas

1. La salida de origen y la entrada de destino deben estar relacionadas.
2. Cada movimiento conserva identificador independiente.
3. La transferencia debe ser atómica o quedar en estado verificable.
4. Un fallo parcial genera incidencia.
5. No se duplica durante reintentos.
6. La caja receptora debe aceptar la transferencia.
7. El importe debe coincidir.
8. La moneda debe coincidir.
9. La evidencia debe conservarse.
10. La conciliación puede validar ambos extremos.

---

# Refund en efectivo

## Regla

Un refund completado en efectivo genera una salida de caja.

## Dependencia

Debe respetar `UC-PAY-004`.

## Flujo

1. Existe un refund autorizado.
2. El sistema valida saldo elegible.
3. El sistema valida permiso.
4. El sistema valida turno abierto.
5. El sistema valida efectivo disponible.
6. El actor entrega el efectivo.
7. Se registra salida de caja.
8. El refund se marca según su resultado real.
9. Se publica evento.
10. Se conserva auditoría.

## Reglas

1. Aprobar no equivale a entregar.
2. El refund no se completa antes de entregar el efectivo.
3. El importe entregado debe coincidir.
4. Un refund parcial conserva saldo pendiente.
5. El mismo saldo no se devuelve dos veces.
6. Si no hay efectivo suficiente, queda pendiente o requiere otra política.
7. El refund no elimina la venta.
8. El refund no elimina el pago.
9. Un reintento no duplica la salida.
10. El movimiento referencia el refund original.

---

# Compensaciones de caja

## Principio

Una compensación corrige un efecto anterior mediante un nuevo movimiento.

## Casos

- error de dirección;
- error de importe;
- retiro registrado incorrectamente;
- cambio incorrecto;
- recaudo duplicado;
- refund registrado incorrectamente;
- movimiento tardío;
- operación offline conflictiva;
- ajuste aprobado.

## Reglas

1. Toda compensación referencia el movimiento original.
2. Toda compensación conserva motivo.
3. Toda compensación conserva actor.
4. Toda compensación puede requerir aprobador.
5. El movimiento original permanece.
6. La compensación no se reutiliza.
7. El importe no puede exceder el autorizado.
8. Las compensaciones críticas requieren segregación de funciones.
9. Un movimiento no puede compensarse dos veces por el mismo valor.
10. Una compensación fallida no altera el saldo.

---

# Recaudo de domiciliarios

## Contexto

Un domiciliario puede recibir efectivo durante una entrega.

El dinero recibido no pertenece a una caja física hasta que se entrega y se acepta formalmente.

## Datos mínimos

- domiciliario;
- pedido;
- venta;
- pago;
- importe esperado;
- importe recibido;
- cambio entregado;
- fecha de recaudo;
- fecha de entrega;
- sucursal;
- turno;
- dispositivo;
- evidencia;
- idempotency key.

## Flujo del recaudo

1. El domiciliario recibe efectivo.
2. Registra importe recibido.
3. Registra cambio entregado.
4. El sistema conserva la operación.
5. La operación puede quedar offline.
6. El domiciliario entrega el recaudo a la sucursal.
7. El cajero cuenta el efectivo.
8. El sistema compara esperado y entregado.
9. Si coincide, registra entrada en caja.
10. Si no coincide, genera diferencia.
11. El domiciliario y cajero confirman.
12. Se registra auditoría.
13. Se publica evento.

## Reglas

1. El domiciliario no confirma transferencias.
2. El domiciliario no modifica la cuenta destino.
3. El recaudo debe vincularse a pedidos.
4. El importe no puede agregarse dos veces.
5. El efectivo recibido por domiciliario debe permanecer distinguible.
6. La entrega parcial debe quedar explícita.
7. Una diferencia no se oculta.
8. El cajero no puede modificar unilateralmente el valor reportado.
9. Se conserva valor reportado y valor contado.
10. La aceptación genera movimiento de entrada en caja.

---

# Diferencias de recaudo

## Tipos

- faltante;
- sobrante;
- pedido no reportado;
- recaudo duplicado;
- cambio incorrecto;
- efectivo deteriorado;
- moneda incorrecta;
- entrega parcial;
- operación offline no sincronizada.

## Reglas

1. Toda diferencia genera incidencia.
2. El faltante no se registra como gasto automático.
3. El sobrante no se asigna a otra venta.
4. La diferencia requiere investigación.
5. La resolución puede generar compensación.
6. El actor responsable debe quedar identificado.
7. La incidencia conserva evidencia.
8. La recurrencia puede aumentar severidad.

---

# Arqueo parcial

## Propósito

Comparar el efectivo esperado con el efectivo contado sin cerrar el turno.

## Datos mínimos

- turno;
- caja;
- importe contado;
- desglose por denominación;
- actor;
- fecha;
- motivo;
- evidencia;
- versión.

## Flujo

1. El actor inicia arqueo.
2. El sistema captura una versión del turno.
3. Calcula efectivo esperado.
4. El actor cuenta efectivo.
5. Registra denominaciones.
6. El sistema calcula total contado.
7. Calcula diferencia.
8. Registra arqueo.
9. Si hay diferencia, genera incidencia.
10. El turno permanece abierto.
11. Se publica evento.

## Reglas

1. Un arqueo no modifica movimientos.
2. Un arqueo no ajusta automáticamente.
3. Un arqueo no cierra el turno.
4. El arqueo conserva versión.
5. Los movimientos posteriores no cambian el resultado histórico del arqueo.
6. Una diferencia debe investigarse.
7. Las denominaciones deben sumar el total contado.
8. Los reintentos no crean arqueos duplicados.

---

# Arqueo ciego

## Definición

El cajero registra el valor contado sin visualizar previamente el efectivo esperado.

## Objetivo

Reducir el sesgo durante el conteo.

## Reglas

1. La política define cuándo aplica.
2. El efectivo esperado se revela después de confirmar el conteo.
3. El actor no puede modificar el conteo después de conocer el esperado.
4. Una corrección crea una nueva versión.
5. Toda reapertura requiere autorización.
6. El arqueo original permanece.

---

# Diferencias de caja

## Fórmula

```text
difference = counted_cash - expected_cash
```

## Clasificación

### Faltante

```text
difference < 0
```

### Exacto

```text
difference = 0
```

### Sobrante

```text
difference > 0
```

## Severidad conceptual

- `INFO`;
- `LOW`;
- `MEDIUM`;
- `HIGH`;
- `CRITICAL`.

## Factores

- importe;
- recurrencia;
- actor;
- turno;
- sucursal;
- porcentaje respecto a ventas;
- riesgo de fraude;
- ausencia de evidencia;
- incumplimiento de política.

## Reglas

1. Toda diferencia queda registrada.
2. La tolerancia no borra la diferencia.
3. Una diferencia aceptada conserva motivo.
4. Una diferencia material requiere aprobación.
5. El cajero no puede aprobar su propia diferencia crítica.
6. La diferencia puede generar investigación.
7. El cierre puede bloquearse.
8. Una diferencia no se corrige editando movimientos.

---

# Tolerancias

## Principio

Una tolerancia permite clasificar, no ocultar.

## Debe estar

- versionada;
- limitada por moneda;
- limitada por empresa;
- limitada por sucursal;
- limitada por tipo;
- aprobada;
- auditada.

## Prohibiciones

No se permite:

- tolerancia global sin contexto;
- usar tolerancia para ocultar fraude;
- ajustar automáticamente;
- aplicar tolerancia de otra moneda;
- cambiar retroactivamente la regla;
- cerrar una diferencia crítica como exacta.

---

# Operación offline

## Permitido

- ventas en efectivo;
- movimientos autorizados;
- cambio;
- recaudos;
- arqueos locales;
- colas de eventos;
- movimientos de turno.

## Restringido

- aprobaciones críticas sin política;
- conciliación central;
- cierre definitivo sin sincronización, cuando la política lo prohíba;
- confirmaciones externas;
- ajustes administrativos sensibles.

## Reglas

1. Cada operación conserva idempotency key.
2. Se registra fecha local.
3. Se registra fecha de recepción.
4. Se registra dispositivo.
5. Se conserva versión local.
6. La cola sobrevive reinicios.
7. La sincronización no duplica movimientos.
8. Un conflicto genera incidencia.
9. Un turno cerrado centralmente no admite inserción silenciosa.
10. Un movimiento tardío se vincula al turno histórico.
11. La política decide reapertura, ajuste o periodo posterior.
12. El sistema no modifica fechas originales.

---

# Operaciones tardías

## Casos

- venta offline;
- refund offline;
- recaudo tardío;
- movimiento de caja no sincronizado;
- arqueo local pendiente;
- reintento después de cierre.

## Tratamiento

1. Validar autenticidad.
2. Validar idempotencia.
3. Validar turno original.
4. Validar estado actual.
5. Conservar fecha original.
6. Conservar fecha de recepción.
7. Si el turno está abierto, incorporar normalmente.
8. Si está cerrado, crear incidencia.
9. No reescribir el cierre.
10. Crear revisión o compensación cuando corresponda.

---

# Idempotencia

## Operaciones con claves independientes

- registrar venta en efectivo;
- registrar cambio;
- registrar ingreso;
- registrar egreso;
- registrar retiro;
- aceptar recaudo;
- registrar refund;
- registrar compensación;
- iniciar arqueo;
- guardar conteo;
- aprobar diferencia;
- transferir a caja fuerte.

## Regla

```text
misma clave + mismo contenido
→ mismo resultado

misma clave + contenido diferente
→ conflicto
```

## Prohibiciones

- reutilizar claves entre operaciones distintas;
- deduplicar solo por importe;
- deduplicar solo por fecha;
- repetir salidas ante timeout;
- crear dos movimientos por el mismo evento.

---

# Concurrencia

## Riesgos

- dos cajeros registran el mismo recaudo;
- retiro simultáneo;
- refund simultáneo;
- cierre durante movimiento;
- arqueo durante movimiento;
- operación offline tardía;
- compensación duplicada;
- cambio de versión;
- doble aprobación.

## Reglas

1. Toda operación usa versión esperada.
2. Dos cierres no pueden completarse sobre la misma versión.
3. Un recaudo no puede aceptarse dos veces.
4. Un refund no puede consumir saldo dos veces.
5. Un retiro no puede exceder saldo disponible.
6. Los locks no sustituyen idempotencia.
7. La comprobación y registro deben compartir transacción lógica.
8. Los eventos deben publicarse mediante outbox o equivalente.
9. Un timeout obliga a consultar estado.
10. Los workers toleran reentrega.

---

# Permisos

## Cajero

Puede:

- registrar ventas en efectivo;
- registrar cambio;
- registrar recaudos;
- solicitar retiros;
- realizar arqueos;
- registrar movimientos permitidos.

No puede, salvo permiso especial:

- aprobar su propia diferencia;
- autorizar compensaciones críticas;
- eliminar movimientos;
- modificar movimientos publicados;
- cerrar incidencias críticas;
- registrar ajustes sin motivo.

## Supervisor

Puede:

- aprobar retiros;
- aprobar diferencias;
- autorizar compensaciones;
- revisar arqueos;
- aceptar recaudos excepcionales;
- desbloquear operaciones según política.

## Administrador

Puede:

- configurar límites;
- aprobar operaciones críticas;
- revisar auditoría;
- gestionar excepciones;
- ordenar investigaciones.

## Domiciliario

Puede:

- registrar efectivo recibido;
- registrar cambio;
- entregar recaudo;
- consultar estado de su recaudo.

No puede:

- confirmar transferencias;
- modificar pagos;
- aprobar diferencias;
- registrar ajustes de caja;
- cerrar turnos.

---

# Auditoría obligatoria

Debe registrarse:

- actor;
- tenant;
- empresa;
- sucursal;
- terminal;
- dispositivo;
- turno;
- movimiento;
- tipo;
- dirección;
- importe;
- moneda;
- origen;
- referencia;
- motivo;
- aprobador;
- fecha local;
- fecha del servidor;
- idempotency key;
- correlation ID;
- versión;
- estado anterior;
- estado posterior;
- resultado;
- error;
- evidencia.

No debe almacenar:

- contraseñas;
- tokens;
- secretos;
- datos restringidos de tarjeta;
- información innecesaria.

---

# Eventos de dominio

## Movimientos

- `CashMovementCreated`;
- `CashMovementApproved`;
- `CashMovementPosted`;
- `CashMovementRejected`;
- `CashMovementFailed`;
- `CashMovementCompensated`.

## Retiros

- `CashWithdrawalRequested`;
- `CashWithdrawalApproved`;
- `CashWithdrawalCompleted`;
- `CashWithdrawalRejected`.

## Recaudos

- `CourierCashReported`;
- `CourierCashReceived`;
- `CourierCashDifferenceDetected`;
- `CourierCashCollectionClosed`.

## Arqueos

- `CashCountStarted`;
- `CashCountCompleted`;
- `CashDifferenceDetected`;
- `CashDifferenceAccepted`;
- `CashDifferenceEscalated`.

## Refunds

- `CashRefundRequested`;
- `CashRefundCompleted`;
- `CashRefundFailed`.

## Regla

Los eventos deben:

- ser idempotentes;
- incluir tenant;
- incluir agregado;
- incluir versión;
- incluir correlation ID;
- no contener secretos;
- tolerar reentrega.

---

# Errores funcionales

- `CASH_SHIFT_NOT_OPEN`;
- `CASH_SHIFT_CLOSED`;
- `CASH_REGISTER_NOT_FOUND`;
- `CASH_REGISTER_BLOCKED`;
- `CASH_MOVEMENT_NOT_ALLOWED`;
- `CASH_AMOUNT_INVALID`;
- `CASH_CURRENCY_MISMATCH`;
- `CASH_INSUFFICIENT_BALANCE`;
- `CASH_PERMISSION_DENIED`;
- `CASH_APPROVAL_REQUIRED`;
- `CASH_VERSION_CONFLICT`;
- `CASH_IDEMPOTENCY_CONFLICT`;
- `CASH_COLLECTION_ALREADY_RECEIVED`;
- `CASH_REFUND_ALREADY_EXECUTED`;
- `CASH_WITHDRAWAL_LIMIT_EXCEEDED`;
- `CASH_DIFFERENCE_REQUIRES_REVIEW`;
- `CASH_OFFLINE_CONFLICT`;
- `CASH_LATE_OPERATION_REQUIRES_REVIEW`;
- `CASH_EVIDENCE_REQUIRED`.

---

# Excepciones

## Turno cerrado

La operación se rechaza o se trata como tardía.

## Saldo insuficiente

El egreso no se publica.

Puede:

- quedar pendiente;
- requerir otro turno;
- requerir otro medio;
- generar incidencia.

## Referencia duplicada

La operación se rechaza o devuelve la existente.

## Error después de entregar efectivo

Debe quedar en estado incierto y escalarse.

No se debe repetir automáticamente sin verificar.

## Caída durante sincronización

La operación permanece en outbox.

El reintento debe ser idempotente.

## Conteo incorrecto

Se crea una nueva versión del arqueo.

El conteo original permanece.

---

# Escenarios de aceptación

## Escenario 1 — Venta en efectivo exacta

```text
Total: 50.000
Efectivo recibido: 50.000
Cambio: 0
```

Resultado:

- entrada de caja: 50.000;
- cobertura de venta: 50.000;
- sin cambio;
- efectivo esperado aumenta 50.000.

## Escenario 2 — Venta con cambio

```text
Total: 50.000
Efectivo recibido: 60.000
Cambio: 10.000
```

Resultado:

- entrada: 60.000;
- salida: 10.000;
- cobertura: 50.000;
- efectivo esperado neto: 50.000.

## Escenario 3 — Refund en efectivo

```text
Refund autorizado: 20.000
```

Resultado:

- salida de caja: 20.000;
- refund completado;
- movimiento relacionado;
- no se elimina el pago original.

## Escenario 4 — Retiro

```text
Efectivo esperado: 500.000
Retiro: 300.000
```

Resultado:

- retiro autorizado;
- salida: 300.000;
- efectivo esperado posterior: 200.000;
- receptor identificado.

## Escenario 5 — Arqueo con faltante

```text
Esperado: 200.000
Contado: 190.000
Diferencia: -10.000
```

Resultado:

- arqueo registrado;
- diferencia tipo faltante;
- incidencia creada;
- no se genera ajuste automático.

## Escenario 6 — Arqueo con sobrante

```text
Esperado: 200.000
Contado: 205.000
Diferencia: 5.000
```

Resultado:

- arqueo registrado;
- diferencia tipo sobrante;
- importe no se asigna a venta;
- incidencia creada.

## Escenario 7 — Recaudo de domiciliario exacto

```text
Esperado: 150.000
Entregado: 150.000
```

Resultado:

- recaudo aceptado;
- entrada de caja: 150.000;
- pedidos vinculados;
- sin diferencia.

## Escenario 8 — Recaudo con faltante

```text
Esperado: 150.000
Entregado: 140.000
```

Resultado:

- entrada real: 140.000;
- diferencia: -10.000;
- incidencia creada;
- no se inventan 10.000.

## Escenario 9 — Movimiento offline sincronizado

Resultado:

- se valida idempotencia;
- se conserva fecha original;
- se registra una sola vez;
- se actualiza proyección;
- queda auditado.

## Escenario 10 — Movimiento tardío en turno cerrado

Resultado:

- no se inserta silenciosamente;
- se crea incidencia;
- se vincula al turno histórico;
- se decide revisión o compensación.

---

# Pruebas mínimas

## Unitarias

1. Cálculo de efectivo esperado.
2. Cálculo de diferencia.
3. Validación de importe.
4. Validación de moneda.
5. Validación de dirección.
6. Clasificación de faltante y sobrante.
7. Aplicación de tolerancia.
8. Cálculo de cambio.
9. Validación de retiro.
10. Validación de refund.
11. Idempotencia.
12. Versionado.

## Integración

1. Venta y movimiento atómicos.
2. Refund y salida de caja.
3. Retiro y aprobación.
4. Recaudo de domiciliario.
5. Arqueo y diferencia.
6. Operación offline.
7. Sincronización tardía.
8. Outbox.
9. Auditoría.
10. Multi-tenant.

## Concurrencia

1. Dos retiros simultáneos.
2. Dos refunds sobre el mismo saldo.
3. Doble aceptación de recaudo.
4. Cierre durante movimiento.
5. Arqueo durante venta.
6. Reintento después de timeout.
7. Doble callback.
8. Conflicto de versión.

## Seguridad

1. Cajero sin permiso.
2. Domiciliario intentando aprobar diferencia.
3. Acceso entre tenants.
4. Ajuste sin motivo.
5. Aprobación propia.
6. Evidencia faltante.
7. Movimiento en caja ajena.
8. Operación en turno cerrado.

---

# Criterios de aceptación

`CASH-003` se considera completo cuando:

1. están definidos ingresos y egresos;
2. están definidos retiros;
3. está definido el cambio;
4. están definidos refunds en efectivo;
5. están definidas compensaciones;
6. están definidos arqueos parciales;
7. están definidas diferencias;
8. está definido recaudo de domiciliarios;
9. está definida operación offline;
10. está definida idempotencia;
11. está definida concurrencia;
12. están definidos permisos;
13. están definidos eventos;
14. están definidos errores;
15. están definidas pruebas;
16. existe coherencia con `DEC-002`;
17. existe coherencia con `UC-PAY-004`;
18. existe coherencia con `UC-PAY-005`;
19. no se autoriza todavía diseño físico;
20. el backlog incluye evidencia verificable.

---

# Relación con SALES-002

`SALES-002` deberá respetar estas reglas:

- anular una venta no elimina movimientos de caja;
- devolver una venta crea refund;
- una venta suspendida conserva movimientos;
- la recuperación no duplica pagos;
- la reimpresión no genera movimientos;
- una venta parcialmente pagada no se marca pagada;
- un sobrepago se resuelve explícitamente;
- una compensación es una nueva operación;
- el inventario no se libera sin política;
- las operaciones críticas son auditables.

---

# Restricciones arquitectónicas

Este documento no autoriza todavía:

- tablas definitivas;
- migraciones;
- índices;
- triggers;
- endpoints;
- contratos API;
- implementación del frontend;
- implementación de hardware;
- cierre del modelo físico.

El diseño posterior deberá respetar:

- movimientos inmutables;
- agregados separados;
- versión esperada;
- idempotencia;
- outbox;
- auditoría;
- multiempresa;
- local-first;
- relaciones explícitas;
- compensaciones;
- conciliación;
- permisos atómicos.

---

# Estado del documento

Estado: `DONE`

El documento permanece `DONE` mientras:

- se valide su estructura;
- se complete revisión funcional;
- se complete revisión arquitectónica;
- no contradiga pagos;
- no contradiga conciliación;
- no contradiga `DEC-002`;
- incluya evidencia;
- el backlog marque `CASH-003` como `DONE`;
- `SALES-002` pueda avanzar sin ambigüedades de caja.
