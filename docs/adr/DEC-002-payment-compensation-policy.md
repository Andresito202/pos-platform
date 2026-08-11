# DEC-002 — Política de pagos inferiores, sobrepagos, fallos parciales y compensaciones

## Estado

`DONE`

## Prioridad

`P0`

## Fecha

2026-08-04

## Contexto

POS Platform debe soportar pagos individuales y mixtos con medios que pueden confirmar, fallar o responder en momentos diferentes.

Los casos críticos incluyen:

- pago inferior al total exigible;
- sobrepago;
- pago mixto con confirmación parcial;
- fallo de uno de los componentes;
- efectivo confirmado y proveedor externo pendiente;
- proveedor externo confirmado y efectivo insuficiente;
- respuestas tardías;
- timeouts;
- operación offline;
- refunds;
- reversals;
- compensaciones posteriores.

Sin una política explícita, caja, ventas y pagos podrían aplicar reglas incompatibles, producir doble cobro, entregar mercancía sin cobertura suficiente o modificar estados históricos de forma destructiva.

Esta decisión bloquea:

- `CASH-003`;
- `SALES-002`.

---

# Decisión

Se adopta una política basada en:

1. cobertura confirmada;
2. componentes independientes;
3. reserva explícita;
4. compensaciones como operaciones nuevas;
5. prohibición de sobrescritura destructiva;
6. idempotencia;
7. trazabilidad completa;
8. separación entre pago, venta y caja;
9. tratamiento explícito de incertidumbre;
10. políticas versionadas por empresa.

---

# Terminología

## Total exigible

Importe que la venta u obligación debe cubrir después de:

- precio;
- promociones;
- descuentos;
- impuestos;
- redondeo;
- cargos autorizados;
- ajustes previos.

## Importe confirmado

Suma de componentes de pago válidamente confirmados.

## Importe pendiente

Suma de componentes todavía no confirmados ni rechazados definitivamente.

## Importe fallido

Suma de componentes rechazados, fallidos o expirados.

## Cobertura confirmada

```text
confirmed_amount / payable_amount
```

## Saldo pendiente

```text
payable_amount - confirmed_amount
```

Nunca puede persistirse como valor negativo sin clasificar explícitamente el exceso.

## Sobrepago

Importe confirmado superior al total exigible.

## Pago inferior

Importe confirmado inferior al total exigible.

## Fallo parcial

Situación en la que al menos un componente se confirma y otro falla, expira, se cancela o queda incierto.

## Compensación

Operación posterior que corrige o equilibra un efecto financiero sin eliminar ni sobrescribir operaciones históricas.

---

# Política de pago inferior

## Regla principal

Un pago inferior no cubre completamente la venta.

## Comportamiento

Cuando:

```text
confirmed_amount < payable_amount
```

la venta queda en una proyección equivalente a:

```text
PARTIALLY_PAID
```

o:

```text
PAYMENT_PENDING
```

según existan componentes pendientes.

## Reglas

1. La venta no puede marcarse `PAID`.
2. El saldo pendiente debe permanecer visible.
3. El usuario puede agregar otro componente autorizado.
4. Un componente fallido no se incluye en cobertura.
5. Un componente pendiente no se incluye como confirmado.
6. La entrega puede bloquearse según política.
7. El inventario y la venta no deben cerrarse definitivamente sin cobertura suficiente, salvo crédito autorizado.
8. El pago inferior no se corrige modificando el importe original.
9. Un nuevo pago crea un nuevo componente o intento.
10. La caja solo registra efectivo realmente recibido.

## Excepción: crédito autorizado

El saldo puede cubrirse mediante crédito interno cuando:

- el cliente está identificado;
- existe cupo;
- la política lo permite;
- la obligación se registra separadamente;
- la aprobación queda auditada.

---

# Política de sobrepago

## Regla principal

El sistema debe impedir el sobrepago antes de confirmarlo cuando sea técnicamente posible.

## Cuando el sobrepago es detectado antes de confirmar

Debe:

1. rechazar el importe;
2. solicitar corrección;
3. recalcular el saldo;
4. impedir doble cobertura;
5. no crear movimientos financieros innecesarios.

## Cuando el sobrepago ya fue confirmado

El exceso no se elimina ni se reasigna silenciosamente.

Debe clasificarse y resolverse mediante una de estas opciones autorizadas:

- cambio en efectivo;
- refund;
- saldo a favor;
- crédito del cliente;
- ajuste autorizado;
- compensación contra otra obligación, cuando la política lo permita.

## Reglas

1. El exceso conserva origen y medio.
2. El sistema registra el importe exacto confirmado.
3. La venta conserva el total exigible original.
4. La resolución del exceso se registra como operación separada.
5. No se reduce retroactivamente el pago confirmado.
6. No se oculta el exceso mediante descuento artificial.
7. No se altera el precio para cuadrar el pago.
8. Todo saldo a favor requiere cliente identificado.
9. Todo refund exige elegibilidad.
10. El cambio en efectivo solo aplica cuando hubo efectivo recibido suficiente.

---

# Política de pago mixto

## Regla principal

Cada componente mantiene ciclo de vida, evidencia y valor independientes.

## Ejemplo

```text
Total exigible: 100.000
Efectivo:        40.000
Tarjeta:         60.000
```

## Reglas

1. Cada componente tiene identificador propio.
2. La cobertura se calcula sumando componentes confirmados.
3. Un componente pendiente no cubre la venta.
4. Un componente fallido no cubre la venta.
5. Un componente confirmado no se revierte por el fallo de otro.
6. La venta puede quedar parcialmente cubierta.
7. El operador puede agregar un nuevo componente.
8. El sistema debe impedir duplicar el mismo medio o referencia cuando resulte incompatible.
9. Las compensaciones deben respetar el medio original cuando aplique.
10. Los refunds parciales deben identificar qué componentes consumen saldo elegible.

---

# Política de fallo parcial

## Escenario

Un componente queda confirmado y otro falla.

## Decisión

El componente confirmado permanece válido.

El sistema no debe:

- borrarlo;
- marcarlo fallido;
- modificarlo;
- fingir que nunca existió;
- duplicarlo durante reintentos.

## Opciones permitidas

1. completar el saldo con otro medio;
2. cancelar la venta y compensar el valor confirmado;
3. mantener la venta pendiente;
4. convertir el saldo en crédito autorizado;
5. iniciar refund o reversal según el medio y estado real;
6. enviar el caso a revisión.

## Regla de compensación

La compensación depende del ciclo real del componente:

- si aún puede deshacerse técnicamente: `Reversal`;
- si ya está confirmado y no admite reversal: `Refund`;
- si es efectivo: salida de caja autorizada;
- si existe incertidumbre: `REVIEW_REQUIRED`;
- si existe contracargo: proceso independiente.

---

# Efectivo confirmado y proveedor externo pendiente

## Regla

El efectivo recibido es válido y debe quedar registrado en caja.

El proveedor externo pendiente no se considera cobertura confirmada.

## Comportamiento

La venta puede quedar:

- parcialmente pagada;
- pendiente;
- bloqueada para entrega;
- autorizada excepcionalmente según política.

## Prohibiciones

No se permite:

- devolver automáticamente el efectivo sin autorización;
- duplicar el intento externo;
- marcar confirmado por timeout;
- cerrar la venta como pagada sin cobertura;
- borrar el movimiento de caja.

---

# Proveedor externo confirmado y efectivo insuficiente

## Regla

El componente externo confirmado permanece válido.

El faltante en efectivo debe tratarse como saldo pendiente.

## Opciones

- recibir efectivo adicional;
- agregar otro medio;
- aplicar crédito autorizado;
- cancelar y compensar el componente externo;
- mantener la venta pendiente.

## Prohibiciones

No se permite:

- modificar el importe del componente externo;
- inventar efectivo;
- reducir el total exigible;
- registrar cambio inexistente;
- eliminar la confirmación externa.

---

# Timeouts y respuestas tardías

## Regla principal

Un timeout no significa éxito ni fallo definitivo.

## Tratamiento

1. El intento pasa a estado incierto.
2. Se consulta el proveedor antes de reintentar.
3. Un callback tardío puede confirmar o rechazar.
4. La idempotencia evita doble cobro.
5. Una contradicción genera incidencia.
6. La venta puede quedar pendiente.
7. El operador no debe repetir manualmente sin validar estado.
8. Todo reintento conserva correlation ID.

---

# Operación offline

## Efectivo

Puede confirmarse localmente cuando:

- existe turno;
- existe caja;
- el usuario está autorizado;
- la operación queda en outbox;
- la sincronización es idempotente.

## Proveedores externos

No pueden marcarse confirmados offline sin evidencia válida.

## Reglas

1. Un intento offline conserva fecha local y fecha de recepción.
2. Un periodo cerrado no se reescribe.
3. Un conflicto genera incidencia.
4. El sistema no duplica pagos al sincronizar.
5. La venta puede quedar pendiente.
6. El saldo se recalcula al recibir eventos.
7. Los límites offline deben ser configurables.
8. La política debe versionarse por empresa.

---

# Refunds y reversals

## Refund

Se usa cuando el valor ya fue confirmado y debe devolverse.

## Reversal

Se usa cuando el proveedor permite cancelar técnicamente la operación antes de liquidación definitiva.

## Reglas

1. No son equivalentes.
2. No modifican el pago original.
3. Consumen saldo elegible.
4. Son idempotentes.
5. Requieren evidencia.
6. Deben respetar segregación de funciones.
7. El mismo importe no puede consumirse dos veces.
8. Un refund parcial conserva saldo restante.
9. Un reversal incierto no se considera completado.
10. Una compensación en efectivo genera movimiento de caja separado.

---

# Reglas para CASH-003

`CASH-003` deberá definir:

- recepción de efectivo;
- cambio;
- faltantes;
- sobrantes;
- retiros;
- devoluciones;
- compensaciones;
- recaudos de domiciliarios;
- arqueos;
- cierre;
- movimientos inmutables;
- tratamiento de pagos mixtos;
- operación offline;
- reapertura o ajuste.

## Invariantes de caja

1. El efectivo esperado se deriva de movimientos confirmados.
2. Los movimientos no se eliminan.
3. Un refund genera egreso.
4. Un reversal no borra ingresos previos.
5. El cambio debe quedar registrado.
6. Un faltante no se oculta.
7. Un sobrante no se aplica automáticamente a una venta.
8. Toda compensación requiere causa.
9. Los reintentos no duplican caja.
10. La caja pertenece a terminal y turno.

---

# Reglas para SALES-002

`SALES-002` deberá definir:

- suspensión;
- recuperación;
- anulación;
- devolución;
- reimpresión;
- cobertura parcial;
- pagos pendientes;
- pagos fallidos;
- sobrepagos;
- compensaciones;
- entrega bloqueada;
- liberación de inventario.

## Invariantes de venta

1. Una venta no se considera pagada sin cobertura confirmada suficiente.
2. La venta no sobrescribe estados de pagos.
3. La anulación no elimina pagos confirmados.
4. La devolución crea operaciones compensatorias.
5. La reimpresión no genera nueva venta.
6. El inventario debe respetar estado de la venta.
7. Una venta pendiente conserva trazabilidad.
8. Un pago fallido no desaparece.
9. Un sobrepago no altera el total de venta.
10. Toda transición debe ser auditable.

---

# Idempotencia

Se requieren claves separadas para:

- crear componente;
- confirmar componente;
- agregar saldo;
- registrar efectivo;
- registrar cambio;
- crear refund;
- ejecutar refund;
- crear reversal;
- ejecutar reversal;
- registrar compensación;
- cancelar venta;
- recuperar venta suspendida.

## Regla

```text
misma clave + mismo contenido
→ mismo resultado

misma clave + contenido diferente
→ conflicto
```

---

# Concurrencia

## Riesgos

- dos operadores completan el mismo saldo;
- doble callback;
- doble entrega;
- refund simultáneo;
- reversal y refund sobre el mismo importe;
- dos cierres de caja;
- sincronización tardía;
- referencia externa repetida.

## Reglas

1. Toda operación usa versión esperada.
2. Los componentes reservan saldo elegible.
3. Dos operaciones incompatibles no pueden completarse.
4. Los locks no sustituyen idempotencia.
5. El saldo debe recalcularse en la misma transacción lógica.
6. Los eventos se publican mediante outbox o equivalente.
7. Las proyecciones toleran reentrega.

---

# Invariantes globales

1. Ningún pago confirmado se elimina.
2. Ningún componente se consume dos veces.
3. La cobertura confirmada nunca excede el total exigible sin clasificar sobrepago.
4. El saldo pendiente nunca es negativo sin exceso explícito.
5. Un pago pendiente no cubre la venta.
6. Un pago fallido no cubre la venta.
7. Un componente confirmado no falla retroactivamente.
8. Un timeout no decide el resultado.
9. Todo exceso conserva origen.
10. Toda compensación es una operación nueva.
11. La caja conserva movimientos inmutables.
12. La venta no edita pagos.
13. El frontend no decide validez financiera.
14. Toda transición es idempotente.
15. Todo cambio crítico queda auditado.
16. Los datos se aíslan por tenant.
17. Las referencias externas son únicas por contexto.
18. Los eventos tardíos no reescriben silenciosamente periodos cerrados.

---

# Escenarios de aceptación

## Escenario 1 — Pago inferior en efectivo

```text
Total exigible: 50.000
Efectivo recibido: 30.000
```

Resultado:

- efectivo registrado;
- venta parcialmente pagada;
- saldo pendiente: 20.000;
- entrega según política;
- posibilidad de agregar otro componente.

## Escenario 2 — Sobrepago en efectivo

```text
Total exigible: 50.000
Efectivo recibido: 60.000
```

Resultado:

- pago confirmado por 60.000;
- exceso clasificado: 10.000;
- cambio registrado por 10.000;
- cobertura neta de la venta: 50.000.

## Escenario 3 — Pago mixto con fallo parcial

```text
Total exigible: 100.000
Efectivo confirmado: 40.000
Tarjeta fallida: 60.000
```

Resultado:

- efectivo permanece confirmado;
- venta parcialmente pagada;
- saldo pendiente: 60.000;
- tarjeta fallida conservada;
- se permite nuevo intento.

## Escenario 4 — Tarjeta confirmada y efectivo faltante

```text
Total exigible: 100.000
Tarjeta confirmada: 70.000
Efectivo recibido: 20.000
```

Resultado:

- cobertura confirmada: 90.000;
- saldo pendiente: 10.000;
- venta no queda pagada.

## Escenario 5 — Respuesta tardía

El proveedor confirma después de un timeout.

Resultado:

- no se duplica el cobro;
- el intento se resuelve;
- la cobertura se recalcula;
- la incidencia se conserva si hubo contradicción.

## Escenario 6 — Cancelación con componente confirmado

Resultado:

- la venta se cancela según política;
- el componente confirmado no se elimina;
- se crea reversal o refund;
- la compensación queda auditada.

---

# Consecuencias

## Positivas

- elimina ambigüedad entre venta, pago y caja;
- evita doble cobro;
- evita borrar pagos válidos;
- permite pagos mixtos reales;
- soporta offline;
- soporta proveedores con respuestas tardías;
- habilita `CASH-003`;
- habilita `SALES-002`.

## Costes

- requiere más estados y proyecciones;
- exige idempotencia;
- exige auditoría;
- exige reservas y control de concurrencia;
- aumenta pruebas;
- requiere operaciones compensatorias explícitas.

---

# Restricciones arquitectónicas

Esta decisión no autoriza todavía:

- tablas definitivas;
- migraciones;
- índices;
- contratos API;
- endpoints;
- implementación.

El diseño físico deberá respetar:

- separación de agregados;
- componentes independientes;
- movimientos inmutables;
- reservas;
- idempotencia;
- concurrencia;
- outbox;
- auditoría;
- aislamiento multiempresa.

---

# Evidencia de cierre

`DEC-002` permanece `DONE` porque:

- las reglas fueron revisadas;
- son compatibles con `payment-state-model.md` y `payment-lifecycle.md`;
- cubren pagos mixtos, efectivo, proveedores externos y operación offline;
- cubren refunds, reversals y compensaciones;
- definen consecuencias para `CASH-003` y `SALES-002`;
- el backlog incluye evidencia verificable de su cierre.
