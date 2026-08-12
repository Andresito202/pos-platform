# Ciclo operativo de pagos

## Estado

`ACTIVE`

## Autoridad documental

Este documento describe los conceptos, flujos operativos, evidencias y reglas transversales del módulo de pagos.

La fuente oficial y definitiva para estados, transiciones, proyecciones y eventos es:

```text
docs/domain/payment-state-model.md
```

Si este documento contradice `payment-state-model.md`, prevalece `payment-state-model.md`.

Este documento no autoriza una máquina global que mezcle:

- `PaymentAttempt`;
- `Payment`;
- `Refund`;
- `Reversal`;
- `Settlement`;
- `Reconciliation`;
- `Chargeback`.

---

# 1. Objetivo

Definir el comportamiento operativo del módulo de pagos antes de construir:

- modelo físico;
- migraciones;
- entidades;
- repositorios;
- servicios;
- endpoints;
- interfaces;
- integraciones externas.

El módulo debe permitir:

- pagos individuales;
- pagos mixtos;
- pagos presenciales;
- pagos manuales;
- pagos electrónicos;
- operación offline controlada;
- devoluciones;
- reversals;
- liquidación;
- conciliación;
- contracargos;
- auditoría;
- trazabilidad multiempresa.

---

# 2. Principios obligatorios

1. Reportar un pago no equivale a confirmarlo.
2. Autorizar un pago no equivale a confirmarlo.
3. Confirmar un pago no equivale a liquidarlo.
4. Liquidar un pago no equivale a conciliarlo.
5. Conciliar un pago no modifica el pago original.
6. Un refund no es un reversal.
7. Un contracargo no es un refund.
8. Ninguna respuesta incierta se interpreta como éxito.
9. Ningún timeout se interpreta automáticamente como fallo definitivo.
10. El frontend no decide la validez financiera.
11. Toda confirmación requiere una fuente autorizada.
12. Toda transición debe ser idempotente.
13. Todo cambio crítico debe quedar auditado.
14. Una corrección financiera genera una nueva operación.
15. Los registros históricos no se sobrescriben destructivamente.
16. El aislamiento entre tenants es obligatorio.
17. Los datos sensibles de tarjeta no se almacenan.
18. Las proyecciones financieras deben ser reconstruibles.

---

# 3. Conceptos

## Payment

Representa el resultado financiero agregado de uno o varios intentos relacionados con una obligación.

Un `Payment` puede estar asociado a:

- venta;
- pedido;
- devolución;
- recaudo;
- deuda;
- cuenta por cobrar;
- obligación autorizada.

El pago no contiene como estados persistentes:

- `SETTLED`;
- `RECONCILED`;
- `REFUNDED`;
- `REVERSED`;
- `CHARGEDBACK`.

Esos conceptos pertenecen a otros agregados o a proyecciones derivadas.

## PaymentAttempt

Representa un intento técnico u operativo de ejecutar o confirmar un pago.

Debe conservar:

- identificador global;
- `payment_id`;
- proveedor;
- medio;
- importe;
- moneda;
- idempotency key;
- correlation ID;
- referencia externa;
- terminal;
- dispositivo;
- fechas;
- respuestas;
- errores;
- evidencia.

## PaymentMethod

Medio utilizado para cubrir una obligación.

Valores conceptuales iniciales:

- `CASH`;
- `BANK_TRANSFER`;
- `STATIC_QR`;
- `DYNAMIC_QR`;
- `CARD`;
- `DIGITAL_WALLET`;
- `CUSTOMER_CREDIT`;
- `GIFT_CREDIT`;
- `OTHER_AUTHORIZED`.

Los valores definitivos deben ser extensibles y no depender de un proveedor específico.

## PaymentProvider

Entidad o sistema que procesa, recibe, autoriza, liquida o reporta un pago.

Ejemplos:

- banco;
- adquirente;
- datáfono;
- billetera digital;
- pasarela;
- procesador;
- caja física;
- cuenta por cobrar interna.

## PaymentGroup y pagos mixtos

`PaymentGroup` agrupa los `Payment` independientes que cubren una misma obligación. El término componente puede utilizarse en la interfaz, pero no representa un agregado o tabla adicional.

Cada `Payment` del grupo conserva:

- medio;
- valor esperado;
- valor confirmado;
- intento;
- proveedor;
- estado propio;
- referencia;
- evidencia;
- elegibilidad para refund;
- elegibilidad para reversal.

## PaymentAllocation

Asigna total o parcialmente un importe confirmado a:

- venta;
- pedido;
- devolución;
- deuda;
- cuenta por cobrar;
- obligación.

Una asignación no puede consumir dos veces el mismo importe.

## ExternalReference

Referencia entregada por una fuente externa.

No debe confundirse con:

- número interno;
- captura de pantalla;
- texto digitado;
- consecutivo visual;
- comprobante sin verificación.

La unicidad debe definirse según:

- tenant;
- empresa;
- proveedor;
- cuenta;
- terminal;
- tipo de operación;
- periodo.

## Refund

Operación compensatoria que devuelve valor previamente confirmado y todavía elegible.

No modifica destructivamente el pago original.

## Reversal

Cancelación técnica de una operación cuando la semántica real del proveedor permite deshacerla antes de su liquidación definitiva.

Después de liquidación, la política normal es refund.

## Settlement

Proceso mediante el cual caja, proveedor, adquirente, billetera o banco reconoce y liquida movimientos financieros.

La liquidación no equivale a conciliación.

## Reconciliation

Proceso que cruza movimientos internos contra:

- caja;
- extractos;
- bancos;
- proveedores;
- adquirentes;
- pasarelas;
- billeteras;
- archivos externos.

La conciliación crea vínculos, clasificaciones e incidencias. No reescribe pagos.

## Chargeback

Operación iniciada por banco, adquirente, procesador o proveedor mediante la cual se disputa o revierte posteriormente valor ya procesado.

Un contracargo puede ocurrir después de liquidación y conciliación.

---

# 4. Separación de ciclos de vida

Los ciclos deben mantenerse separados.

## Intento técnico

```text
PaymentAttempt
CREATED
→ PENDING / PROCESSING
→ CONFIRMED / DECLINED / FAILED / UNKNOWN
```

## Resultado financiero

```text
Payment
CREATED
→ PENDING
→ PARTIALLY_CONFIRMED / CONFIRMED
```

## Liquidación

```text
Settlement
CREATED
→ PENDING / PROCESSING
→ PARTIALLY_COMPLETED / COMPLETED
```

## Conciliación

```text
Reconciliation
CREATED
→ RUNNING
→ PARTIALLY_RECONCILED / RECONCILED / REVIEW_REQUIRED
→ CLOSED
```

## Devolución

```text
Refund
REQUESTED
→ PENDING_APPROVAL / APPROVED
→ PROCESSING
→ PARTIALLY_COMPLETED / COMPLETED
```

## Reversal

```text
Reversal
REQUESTED
→ PROCESSING
→ COMPLETED
```

## Contracargo

```text
Chargeback
RECEIVED
→ UNDER_REVIEW / DISPUTED
→ WON / LOST / PARTIALLY_LOST
→ CLOSED
```

Las transiciones completas y definitivas se encuentran en `payment-state-model.md`.

---

# 5. Autoridad de evidencia

## Efectivo

La fuente primaria es:

- entrega física validada por cajero autorizado;
- movimiento de caja;
- turno válido;
- arqueo;
- cierre.

No existe referencia bancaria.

Una captura o fotografía no reemplaza la evidencia de caja.

## Transferencia

La evidencia puede provenir de:

- movimiento bancario;
- referencia bancaria verificable;
- API del banco;
- proveedor autorizado;
- confirmación manual autorizada.

Una captura de pantalla es evidencia auxiliar, no confirmación final por sí sola.

## QR

La evidencia primaria depende del tipo:

### QR estático

Puede requerir:

- reporte del cliente;
- referencia;
- cuenta destino;
- validación manual;
- movimiento bancario.

### QR dinámico

La fuente primaria debe ser:

- proveedor;
- banco;
- billetera;
- procesador;
- respuesta autenticada.

## Tarjeta

La fuente primaria de confirmación es:

- adquirente;
- procesador;
- pasarela;
- datáfono integrado;
- respuesta autenticada.

La autorización no prueba liquidación ni abono bancario.

## Billetera digital

La fuente primaria es la respuesta autenticada de la billetera o proveedor.

## Crédito del cliente

La fuente primaria es la cuenta por cobrar interna y su política de crédito.

No representa efectivo recibido.

## Proveedor fiscal

La factura o documento fiscal no constituye evidencia suficiente de:

- recepción;
- confirmación;
- liquidación;
- abono;
- conciliación.

---

# 6. Flujo de efectivo

## Flujo operativo

```text
Payment.CREATED
→ Payment.CONFIRMED

CashMovement
→ registrado en turno válido

Reconciliation
→ conciliación de caja durante arqueo o cierre
```

## Reglas

1. Requiere caja y turno válidos.
2. El cajero registra el valor recibido.
3. El sistema calcula el cambio.
4. El movimiento de caja se registra atómicamente con la operación.
5. El efectivo confirmado incrementa el efectivo esperado.
6. El cambio entregado reduce el efectivo esperado.
7. No se permite confirmar más efectivo del autorizado sin registrar el excedente.
8. La conciliación ocurre durante arqueo o cierre.
9. Un refund en efectivo genera salida de caja.
10. Si no existe efectivo suficiente, no se inventa una devolución completada.
11. Los reintentos no duplican movimientos.
12. El cierre conserva diferencia esperada y observada.

---

# 7. Transferencia manual y QR estático

## Flujo operativo

```text
Payment.CREATED
→ Payment.PENDING

PaymentAttempt
CREATED
→ PENDING / REVIEW_REQUIRED
→ CONFIRMED / DECLINED
```

La conciliación ocurre posteriormente mediante `Reconciliation`.

## Reglas

1. El cliente o domiciliario puede reportar.
2. Reportar no confirma.
3. La confirmación requiere un usuario autorizado o fuente externa válida.
4. Debe registrarse:
   - entidad;
   - referencia;
   - fecha;
   - valor;
   - moneda;
   - cuenta destino;
   - versión de cuenta;
   - reportante;
   - confirmador;
   - dispositivo;
   - sucursal;
   - evidencia.
5. Una captura de pantalla no constituye confirmación final.
6. La referencia externa no puede reutilizarse dentro del mismo contexto.
7. El QR debe pertenecer al negocio o sucursal autorizada.
8. El usuario no puede sustituir silenciosamente la cuenta destino.
9. Una diferencia de importe requiere política explícita.
10. La confirmación manual debe ser auditable.
11. La conciliación se realiza contra banco, extracto o fuente externa.
12. El pago original no cambia a `RECONCILED`.

---

# 8. Tarjeta o pasarela

## Flujo operativo

```text
Payment.CREATED
→ Payment.PENDING

PaymentAttempt
CREATED
→ PENDING
→ PROCESSING / REQUIRES_ACTION
→ CONFIRMED / DECLINED / FAILED / UNKNOWN

Settlement
CREATED
→ PROCESSING
→ PARTIALLY_COMPLETED / COMPLETED

Reconciliation
CREATED
→ RUNNING
→ RECONCILED / REVIEW_REQUIRED
→ CLOSED
```

## Reglas

1. La fuente de verdad es la respuesta autenticada del proveedor.
2. No se confía en parámetros enviados por el frontend.
3. Webhooks y callbacks deben ser idempotentes.
4. Una autorización puede expirar.
5. Una autorización puede requerir reversal.
6. Un timeout genera incertidumbre, no fallo automático.
7. Antes de reintentar debe consultarse el estado conocido.
8. La liquidación puede ocurrir después de la venta.
9. La conciliación se realiza contra reportes y abonos.
10. Las comisiones se separan del valor confirmado.
11. Las retenciones se separan del valor confirmado.
12. No se debe almacenar PAN completo, CVV ni datos restringidos.
13. La tokenización debe delegarse al proveedor.
14. Un contracargo es una operación posterior independiente.

---

# 9. Billetera digital y QR dinámico

Puede seguir un ciclo similar a tarjeta o transferencia automática, según las capacidades del proveedor.

Debe distinguir:

- intención creada;
- pago pendiente;
- acción requerida;
- pago confirmado;
- pago rechazado;
- pago expirado;
- pago desconocido;
- pago liquidado;
- pago conciliado.

No se permite consolidar todos esos conceptos en un único estado.

---

# 10. Crédito del cliente

## Principio

El crédito interno no representa dinero recibido.

## Flujo conceptual

```text
Venta autorizada
→ cuenta por cobrar
→ uno o varios abonos posteriores
→ pagos reales
```

## Reglas

1. Requiere cliente identificado.
2. Requiere cupo disponible.
3. Requiere política vigente.
4. No incrementa efectivo esperado.
5. Genera obligación separada.
6. Los abonos posteriores generan pagos.
7. El saldo debe ser auditable.
8. Los movimientos son append-only.
9. Los ajustes requieren causa y autorización.
10. La operación offline depende de una proyección vigente y límites configurados.

---

# 11. Pago mixto

Una venta puede contener varios `Payment` agrupados.

## Ejemplo

```text
Total pagadero: $100.000
Efectivo:        $40.000
Transferencia:   $60.000
```

## Reglas

1. Cada medio se persiste como un `Payment` independiente.
2. Cada `Payment` conserva medio, importe, intentos y evidencia.
3. La suma confirmada determina la cobertura.
4. Un pago pendiente no cubre la venta salvo política expresa.
5. Un pago rechazado no se incluye en el total cubierto.
6. El redondeo comercial se resuelve antes de los pagos y no se aplica por medio.
7. Un refund parcial conserva distribución versionada.
8. La distribución predeterminada de refunds mixtos se encuentra en `UC-PAY-004`.
9. No se deben mezclar estados de pagos en un texto libre.
10. Los pagos pueden liquidarse y conciliarse de forma independiente.

---

# 12. Proyección de pago de la venta

El estado de cobertura de una venta es una proyección derivada.

## Clasificaciones conceptuales

- `UNPAID`;
- `PAYMENT_PENDING`;
- `PARTIALLY_PAID`;
- `PAID`;
- `OVERPAID`;
- `PAYMENT_FAILED`;
- `PARTIALLY_REFUNDED`;
- `FULLY_REFUNDED`.

## Definiciones

### UNPAID

No existe valor confirmado aplicable.

### PAYMENT_PENDING

Existen intentos pendientes, reportados, autorizados o inciertos sin cobertura suficiente confirmada.

### PARTIALLY_PAID

Existe valor confirmado menor al total exigible.

### PAID

La suma confirmada cubre el total exigible.

### OVERPAID

Existe valor confirmado superior al exigible.

Debe impedirse o resolverse mediante política explícita.

### PAYMENT_FAILED

Los intentos relevantes fallaron y no existe cobertura suficiente.

### PARTIALLY_REFUNDED

Parte del valor elegible fue devuelto mediante refunds completados.

### FULLY_REFUNDED

Todo el valor elegible fue devuelto mediante refunds completados.

## Regla

La proyección:

- se calcula;
- no se edita manualmente;
- conserva fuentes;
- debe ser reconstruible;
- no reemplaza estados de `Payment`;
- no reemplaza estados de `Refund`.

---

# 13. Confirmación manual

La confirmación manual aplica inicialmente a:

- transferencia;
- QR estático;
- otros medios autorizados sin confirmación automática.

## Datos mínimos

- `payment_id`;
- `payment_attempt_id`;
- importe;
- moneda;
- referencia externa;
- entidad financiera;
- versión de cuenta destino;
- reportante;
- confirmador;
- fecha;
- motivo;
- evidencia;
- dispositivo;
- sucursal;
- evento de auditoría;
- idempotency key;
- correlation ID.

## Restricciones

1. Reportante y confirmador pueden requerir separación.
2. El domiciliario no confirma.
3. El cajero solo confirma con permiso explícito.
4. El administrador confirma según alcance.
5. Se alertan referencias repetidas.
6. Los importes deben coincidir o seguir tolerancia aprobada.
7. Una confirmación no se edita.
8. Una corrección se realiza mediante nueva operación.
9. La confirmación no implica liquidación.
10. La confirmación no implica conciliación.

---

# 14. Idempotencia y duplicados

Toda operación crítica debe usar identificadores globales y claves de idempotencia.

## Campos conceptuales

- identificador global;
- idempotency key;
- provider reference;
- correlation ID;
- tenant;
- empresa;
- dispositivo;
- versión esperada;
- hash de solicitud.

## Reglas

1. La misma clave y el mismo contenido devuelven el resultado original.
2. La misma clave con contenido diferente produce conflicto.
3. Un webhook repetido no duplica pagos.
4. Una referencia confirmada no cubre obligaciones incompatibles.
5. El sistema detecta referencias reutilizadas.
6. La deduplicación no depende solo de fecha e importe.
7. Los movimientos de caja no se duplican por reintento.
8. Los refunds no se duplican.
9. Los reversals no se duplican.
10. Las liquidaciones no consumen dos veces el mismo importe.
11. Las conciliaciones no consumen dos veces el mismo movimiento.
12. Los workers deben tolerar reentrega de eventos.

---

# 15. Operación offline

## Permitido

- efectivo;
- crédito interno autorizado;
- creación local de ventas;
- creación local de intentos;
- registro de intención de otros medios;
- cola de eventos;
- movimientos de caja permitidos;
- proyecciones vigentes.

## Restringido

- confirmación bancaria automática;
- confirmación de tarjeta sin proveedor;
- validación de transferencia;
- consulta externa;
- liquidación central;
- conciliación central;
- contracargos;
- cambios de configuración sensible.

## Reglas

1. El efectivo puede confirmarse localmente.
2. Una transferencia offline permanece pendiente.
3. No se marca confirmado sin fuente autorizada.
4. Se conserva fecha local y fecha de recepción.
5. La sincronización es idempotente.
6. Los conflictos se escalan.
7. No se sobrescriben silenciosamente versiones.
8. La venta puede quedar pendiente de entrega.
9. Un evento tardío puede generar incidencia.
10. Un periodo cerrado no se reescribe.
11. Una caída de red no autoriza doble cobro.
12. La cola debe sobrevivir reinicios.

---

# 16. Domicilios

## Efectivo

El domiciliario puede recibir efectivo.

Debe registrar:

- valor esperado;
- valor recibido;
- cambio entregado;
- pedido;
- turno;
- recaudo;
- fecha;
- ubicación o evidencia permitida;
- dispositivo.

El dinero se concilia cuando se entrega el recaudo a la sucursal.

## Transferencia o QR

El domiciliario puede:

- mostrar QR oficial;
- reportar pago;
- esperar confirmación;
- consultar estado autorizado.

No puede:

- cambiar el QR;
- cambiar la cuenta;
- confirmar el pago;
- modificar el importe;
- reutilizar referencias;
- aprobar diferencias.

## Entrega

Una política puede impedir validar entrega o PIN mientras no exista cobertura confirmada suficiente.

---

# 17. Refunds

Un refund devuelve valor confirmado y todavía elegible.

## Reglas

1. No cambia destructivamente el pago original.
2. Referencia el pago y componente originales.
3. No supera el valor elegible.
4. Respeta el medio original cuando la política lo exige.
5. El efectivo genera salida de caja.
6. Una devolución electrónica puede quedar pendiente.
7. Las devoluciones parciales se acumulan.
8. El estado del refund es independiente.
9. El valor completado alimenta la proyección reembolsada.
10. Toda operación requiere permiso y auditoría.
11. La distribución mixta usa algoritmo versionado.
12. Un refund aprobado no equivale a completado.

---

# 18. Reversals

Un reversal cancela técnicamente una operación cuando el proveedor permite deshacerla.

## Reglas

1. Conserva referencia al intento original.
2. Requiere evidencia válida.
3. No elimina el intento.
4. No elimina el pago.
5. No equivale a refund.
6. Después de liquidación se prefiere refund.
7. Una respuesta incierta permanece explícita.
8. Un reversal completado alimenta `reversed_amount`.
9. Un resultado contradictorio genera incidencia.
10. No consume el mismo importe que un refund sin política explícita.

---

# 19. Liquidación

## Caja

Puede considerar:

- efectivo confirmado;
- ingresos;
- egresos;
- retiros;
- refunds;
- recaudos;
- diferencias.

## Tarjetas, QR y billeteras

Puede considerar:

- bruto;
- comisiones;
- retenciones;
- refunds;
- reversals;
- contracargos;
- ajustes;
- neto.

## Reglas

1. Una liquidación puede agrupar pagos.
2. Un pago puede liquidarse parcialmente.
3. La liquidación no cambia `PaymentStatus`.
4. El bruto permanece separado de comisiones.
5. Los archivos originales son inmutables.
6. Una corrección genera versión o ajuste.
7. El mismo importe no se liquida dos veces.
8. `COMPLETED` no implica conciliación.
9. Bruto, comisiones, retenciones, refunds, reversals, contracargos, ajustes positivos, ajustes negativos y neto se conservan como componentes exactos separados.
10. Cada cálculo congela política/version, entradas, evidencia y resultado, e indica si el bruto incluye operaciones posteriormente reversadas o ya viene neto de reversals.
11. No existe una fórmula universal que reste reversals sin considerar el tratamiento declarado del bruto, ni se modifica Payment histórico para cuadrar Settlement.

---

# 20. Conciliación

## Caja

Concilia:

- base;
- efectivo confirmado;
- ingresos;
- egresos;
- retiros;
- refunds;
- recaudos;
- arqueo;
- cierre.

## Transferencias

Concilia contra:

- extracto;
- archivo bancario;
- consulta API;
- confirmación autorizada.

## Tarjetas y pasarelas

Concilia contra:

- transacciones;
- lotes;
- liquidaciones;
- comisiones;
- retenciones;
- refunds;
- reversals;
- contracargos;
- abonos bancarios.

## Reglas

1. La conciliación no modifica la venta.
2. La conciliación no modifica el pago.
3. Las diferencias generan incidencias.
4. Los movimientos no conciliados permanecen visibles.
5. La conciliación es idempotente.
6. Se conserva fuente, periodo, usuario y resultado.
7. Una conciliación cerrada no se edita directamente.
8. Un evento tardío genera revisión o reapertura.
9. Los ajustes son operaciones separadas.
10. `RECONCILED` pertenece a `ReconciliationStatus`, no a `PaymentStatus`.
11. El periodo y alcance son snapshots de Reconciliation, no agregados con estado propio.
12. Los únicos estados persistentes de Reconciliation son los definidos por `PAY-007`; `OPEN` y `PROCESSING` quedan reservados a otros conceptos cuando corresponda.

---

# 21. Contracargos

## Reglas

1. Son operaciones posteriores.
2. Pueden aparecer después de liquidación.
3. Pueden aparecer después de conciliación.
4. No cambian destructivamente el pago.
5. No se modelan como refund.
6. Conservan evidencia y plazos.
7. El resultado perdido alimenta `chargeback_amount`.
8. Una conciliación histórica puede requerir revisión posterior.
9. El historial de disputa no se elimina.
10. Los ajustes contables derivados son operaciones separadas.

---

# 22. Auditoría

Debe registrarse:

- actor;
- proceso;
- tenant;
- empresa;
- sucursal;
- dispositivo;
- acción;
- agregado;
- identificador;
- estado anterior;
- estado nuevo;
- motivo;
- evidencia;
- referencia externa;
- correlation ID;
- idempotency key;
- fecha del dispositivo;
- fecha del servidor;
- versión;
- resultado;
- error.

La auditoría no almacena:

- contraseñas;
- tokens;
- CVV;
- PAN completo;
- secretos;
- certificados;
- información innecesaria.

---

# 23. Invariantes

1. Un pago confirmado no se elimina.
2. Reportar no equivale a confirmar.
3. Autorizar no equivale a confirmar.
4. Confirmar no equivale a liquidar.
5. Liquidar no equivale a conciliar.
6. El domiciliario no confirma pagos.
7. La suma confirmada determina cobertura.
8. El crédito no es efectivo recibido.
9. Las referencias externas son únicas según contexto.
10. Los reintentos no duplican pagos.
11. Los reintentos no duplican caja.
12. Un refund no supera el saldo elegible.
13. Un reversal no elimina el pago original.
14. Un contracargo no es refund.
15. La proyección de la venta es derivada.
16. El frontend no decide validez financiera.
17. Todo cambio crítico queda auditado.
18. Un tenant no accede a pagos de otro tenant.
19. Los pagos mixtos conservan componentes independientes.
20. El POS offline no inventa confirmaciones externas.
21. Las diferencias no se ocultan.
22. Ningún importe se consume dos veces.
23. Toda transición usa versión esperada.
24. Toda operación crítica es idempotente.
25. Las proyecciones pueden reconstruirse.
26. Los estados de agregados permanecen separados.

---

# 24. Relación con el modelo oficial

Los estados, transiciones y eventos definitivos se encuentran en:

```text
docs/domain/payment-state-model.md
```

Este documento debe utilizarse para:

- flujos operativos;
- autoridad de evidencia;
- comportamiento por medio;
- confirmación manual;
- offline;
- domicilios;
- liquidación;
- conciliación;
- reglas transversales.

`payment-state-model.md` debe utilizarse para:

- estados persistentes;
- transiciones;
- eventos;
- proyecciones;
- invariantes de estados;
- separación de agregados;
- consecuencias para persistencia.

---

# 25. Restricción de diseño físico

Este documento no define:

- tablas;
- columnas;
- claves;
- índices;
- migraciones;
- endpoints;
- contratos SQL;
- particionamiento.

El diseño físico debe basarse conjuntamente en:

- casos de uso aprobados;
- `payment-state-model.md`;
- reglas de seguridad;
- estrategia multiempresa;
- sincronización local-first;
- auditoría;
- requisitos de rendimiento.

---

# 26. Estado del documento

Estado: `ACTIVE`

El modelo antiguo de máquina global queda reemplazado por `payment-state-model.md`.

No se permite volver a introducir `SETTLED`, `RECONCILED`, `REFUNDED`, `REVERSED` o `CHARGEDBACK` como estados persistentes de `Payment`.
