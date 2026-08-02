Ciclo de vida de pagos

Objetivo

Definir estados, transiciones, responsabilidades e invariantes del módulo de pagos antes de diseñar sus casos de uso y persistencia física.

1. Conceptos

Payment

Representa un intento o registro de valor asociado a una venta, devolución, recaudo u obligación.

PaymentMethod

Medio utilizado para cubrir un valor.

Valores iniciales:

CASH;

BANK_TRANSFER;

STATIC_QR;

CARD;

DIGITAL_WALLET;

CUSTOMER_CREDIT;

GIFT_CREDIT;

OTHER_AUTHORIZED.

PaymentProvider

Entidad o sistema externo que procesa o recibe un pago.

Ejemplos:

banco;

adquirente;

billetera digital;

pasarela;

caja física;

cuenta por cobrar interna.

PaymentAllocation

Asigna un pago total o parcial a una venta, devolución, pedido o deuda.

ExternalReference

Referencia entregada por un proveedor externo.

No debe confundirse con:

número interno;

comprobante visual;

texto digitado por el usuario.

Settlement

Proceso mediante el cual el proveedor liquida el dinero al comercio.

Reconciliation

Proceso que cruza pagos registrados contra caja, extractos o reportes externos.

2. Estados

CREATED

El pago fue creado, pero todavía no ha sido procesado o confirmado.

PENDING

La operación está esperando respuesta, verificación o acción externa.

REPORTED

Un usuario informa que el pago fue realizado, pero todavía no está verificado.

Este estado no prueba que el dinero exista.

AUTHORIZED

El proveedor autorizó la operación, pero la liquidación puede estar pendiente.

CONFIRMED

El sistema considera válido el pago para cubrir la obligación.

La confirmación debe tener una fuente válida:

efectivo recibido por cajero autorizado;

confirmación manual autorizada;

respuesta firmada de proveedor;

proceso interno confiable.

REJECTED

La operación fue revisada y declarada no válida.

CANCELLED

El pago fue cancelado antes de confirmarse.

EXPIRED

El intento dejó de ser válido por tiempo o política.

FAILED

La operación no pudo completarse por fallo técnico o de proveedor.

SETTLED

El proveedor liquidó el valor al comercio.

RECONCILED

El pago fue cruzado correctamente contra la fuente financiera correspondiente.

PARTIALLY_REFUNDED

Parte del valor confirmado fue devuelto.

REFUNDED

Todo el valor elegible fue devuelto.

REVERSED

La confirmación o autorización fue revertida mediante una operación compensatoria válida.

3. Transiciones generales permitidas

CREATED
├── PENDING
├── REPORTED
├── CONFIRMED
├── CANCELLED
├── EXPIRED
└── FAILED

PENDING
├── AUTHORIZED
├── CONFIRMED
├── REJECTED
├── CANCELLED
├── EXPIRED
└── FAILED

REPORTED
├── CONFIRMED
├── REJECTED
├── CANCELLED
└── EXPIRED

AUTHORIZED
├── CONFIRMED
├── REVERSED
├── FAILED
└── EXPIRED

CONFIRMED
├── SETTLED
├── RECONCILED
├── PARTIALLY_REFUNDED
├── REFUNDED
└── REVERSED

SETTLED
├── RECONCILED
├── PARTIALLY_REFUNDED
├── REFUNDED
└── REVERSED

PARTIALLY_REFUNDED
├── PARTIALLY_REFUNDED
└── REFUNDED

Los estados terminales ordinarios son:

REJECTED;

CANCELLED;

EXPIRED;

FAILED;

RECONCILED;

REFUNDED;

REVERSED.

Una transición inválida debe rechazarse.

4. Flujo por método

Efectivo

Flujo normal:

CREATED
→ CONFIRMED
→ RECONCILED

Reglas:

Requiere caja abierta.

El cajero registra valor recibido.

El sistema calcula cambio.

El movimiento de caja se registra atómicamente con la venta.

La conciliación ocurre durante el cierre o arqueo.

No existe referencia bancaria.

No se permite confirmar más efectivo que el autorizado por la operación sin registrar el excedente correctamente.

Transferencia manual o QR estático

Flujo:

CREATED
→ REPORTED
→ CONFIRMED o REJECTED
→ RECONCILED

Reglas:

El cliente o domiciliario puede reportar.

Reportar no confirma.

La confirmación requiere usuario autorizado.

Se debe registrar:

entidad;

referencia;

fecha;

valor;

cuenta destino;

usuario confirmador.

Una captura de pantalla no constituye confirmación.

Una referencia externa no puede reutilizarse.

El QR mostrado debe pertenecer al negocio o sucursal.

Tarjeta o pasarela

Flujo conceptual:

CREATED
→ PENDING
→ AUTHORIZED
→ CONFIRMED
→ SETTLED
→ RECONCILED

Reglas:

La fuente de verdad es la respuesta autenticada del proveedor.

No se confía en parámetros del frontend.

Los webhooks o callbacks deben ser idempotentes.

Una autorización puede expirar o revertirse.

La liquidación puede ocurrir después de la venta.

La conciliación se realiza contra reportes del proveedor.

Billetera digital con API

Puede seguir el flujo de tarjeta o transferencia automática según el proveedor.

Crédito del cliente

No representa dinero recibido.

Flujo:

Venta confirmada
→ cuenta por cobrar
→ uno o varios pagos posteriores

Reglas:

Requiere cliente identificado.

Requiere cupo y política de crédito.

No incrementa efectivo esperado.

Genera una obligación separada.

Los abonos posteriores generan pagos reales.

El saldo debe ser auditable.

5. Pago mixto

Una venta puede contener varios pagos.

Ejemplo:

Total pagadero: $100.000

Efectivo:       $40.000
Transferencia:  $60.000

Cada componente debe existir como un Payment independiente.

Reglas:

La suma de pagos válidos debe cubrir exactamente el total pagadero.

El redondeo de efectivo solo aplica al saldo cubierto en efectivo.

Un pago pendiente no cubre la venta salvo política explícita.

Un pago rechazado no se incluye en el total cubierto.

Cada pago tiene estado propio.

La venta puede permanecer:

PAYMENT_PENDING;

PARTIALLY_PAID;

PAID;

PAYMENT_FAILED.

No se deben mezclar estados en un único campo de texto sin estructura.

6. Estados de pago de la venta

UNPAID

No existe valor confirmado.

PARTIALLY_PAID

Existe un valor confirmado menor al total pagadero.

PAYMENT_PENDING

Existe valor reportado, pendiente o autorizado aún no confirmado.

PAID

La suma de pagos confirmados cubre el total pagadero.

OVERPAID

Estado excepcional que debe impedirse o resolverse explícitamente.

REFUNDED

La venta fue reembolsada completamente.

PARTIALLY_REFUNDED

La venta fue reembolsada parcialmente.

PAYMENT_FAILED

Los intentos de pago fallaron y no existe cobertura suficiente.

Regla

El estado de pago de la venta se calcula a partir de pagos y devoluciones. No debe editarse manualmente.

7. Confirmación manual

La confirmación manual aplica inicialmente a transferencias y QR estático.

Debe registrar:

payment_id;

amount;

external_reference;

financial_entity;

destination_account_version;

reported_by;

confirmed_by;

confirmed_at;

reason;

evidence_reference opcional;

device_id;

branch_id;

audit_event_id.

Restricciones

El reportante y el confirmador pueden requerir separación según política.

El domiciliario no confirma.

El cajero solo confirma si tiene permiso explícito.

El propietario o administrador puede confirmar según su alcance.

El sistema debe alertar referencias repetidas.

Los valores deben coincidir o seguir una política de diferencia autorizada.

Una confirmación no se modifica; se revierte cuando sea necesario.

8. Idempotencia y duplicados

Toda operación crítica debe utilizar:

payment_id global;

idempotency_key;

provider_reference;

correlation_id.

Reglas

Repetir una solicitud con la misma clave devuelve el resultado original.

Un webhook repetido no duplica pagos.

Una referencia externa confirmada no puede cubrir dos ventas incompatibles.

El sistema debe detectar referencias reutilizadas.

La deduplicación no puede depender solo de fecha y valor.

Los registros de caja tampoco pueden duplicarse por reintento.

9. Operación offline

Permitido

efectivo;

crédito interno autorizado;

registro local de intención de otros medios, cuando la política lo permita.

Restringido

confirmación bancaria automática;

validación de transferencias;

consulta de proveedores externos;

liquidación;

conciliación central.

Reglas

El efectivo puede confirmarse localmente.

Una transferencia offline debe permanecer REPORTED o PENDING.

No debe marcarse CONFIRMED sin una fuente autorizada.

Al recuperar conexión se sincroniza de forma idempotente.

Los conflictos deben escalarse; no resolverse silenciosamente.

La venta puede quedar pendiente de entrega o confirmación según el canal.

10. Domicilios

Efectivo

El domiciliario puede recibir efectivo.

Debe registrar:

valor esperado;

valor recibido;

cambio entregado;

pedido;

turno;

recaudo;

hora.

El dinero se concilia al entregar recaudo a la sucursal.

Transferencia o QR

El domiciliario puede:

mostrar QR oficial;

reportar que el cliente pagó;

esperar confirmación;

consultar el estado.

No puede:

cambiar el QR;

cambiar la cuenta;

confirmar el pago;

modificar el importe.

Entrega

Una política puede impedir validar el PIN hasta que el pago esté confirmado.

11. Reversiones y devoluciones

Refund

Devuelve dinero relacionado con una venta confirmada.

Reversal

Revierte una autorización o confirmación mediante una operación compensatoria.

Reglas

No se cambia el estado histórico destructivamente.

Toda devolución referencia el pago original.

El valor devuelto no puede superar el valor elegible.

Debe respetarse el método original cuando la política lo exija.

El efectivo devuelto genera salida de caja.

Una devolución electrónica puede quedar pendiente.

Las devoluciones parciales deben acumularse correctamente.

Toda operación requiere permiso y auditoría.

12. Conciliación

Caja

Concilia:

base;

efectivo confirmado;

ingresos;

egresos;

retiros;

devoluciones;

recaudos de domiciliarios.

Transferencias

Concilia contra:

extracto;

archivo bancario;

consulta API;

revisión manual autorizada.

Tarjetas y pasarelas

Concilia contra:

transacciones autorizadas;

liquidaciones;

comisiones;

retenciones;

reversos;

contracargos.

Reglas

La conciliación no modifica silenciosamente la venta.

Las diferencias generan incidencias.

Los pagos no conciliados permanecen visibles.

La conciliación debe ser idempotente.

Deben conservarse fuente, periodo, usuario y resultado.

13. Invariantes

Un pago confirmado no se elimina.

Reportar no equivale a confirmar.

El domiciliario no confirma pagos.

La suma de pagos confirmados determina la cobertura.

El crédito no es efectivo recibido.

Las referencias externas deben ser únicas según contexto.

Las operaciones repetidas no duplican pagos ni caja.

Una devolución no supera el valor confirmado elegible.

El estado de pago de la venta es derivado.

El frontend no decide la validez financiera.

Todo cambio crítico queda auditado.

Los pagos de otro tenant nunca pueden consultarse ni asignarse.

Los pagos mixtos mantienen registros independientes.

El POS offline no inventa confirmaciones externas.

Las diferencias se registran; no se ocultan mediante ajustes silenciosos.