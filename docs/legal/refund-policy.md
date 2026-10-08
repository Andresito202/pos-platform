# Política de Reembolso y Devoluciones — Camacho POS Colombia

**Producto:** Camacho POS Colombia  
**Versión:** 0.1  
**Estado:** MATERIALIZADA — pendiente de formalización contractual/comercial  
**Fecha de preparación:** 2026-10-07

> Esta política define la regla comercial y operativa que debe acompañar al caso de uso técnico existente. No sustituye la implementación de `Refund`/`Reversal`, que se rige por `docs/use-cases/payments/UC-PAY-004-refund-payment.md` y `docs/adr/DEC-002-payment-compensation-policy.md`. Tampoco inventa derechos comerciales que deban ser definidos por contrato o por la legislación aplicable.

## 1. Alcance

Esta política aplica a solicitudes de devolución de dinero relacionadas con ventas y pagos procesados mediante Camacho POS Colombia, en la medida en que la funcionalidad correspondiente esté habilitada y el contrato aplicable lo contemple.

La devolución financiera y la devolución física de mercancía son procesos relacionados, pero no equivalentes.

- **Refund:** operación compensatoria que devuelve valor después de un pago confirmado.
- **Reversal:** operación técnica que revierte una autorización o confirmación cuando el medio y su estado todavía lo permiten.

No se debe presentar una reversión como si fuera una devolución comercial confirmada.

## 2. Principios

Toda devolución debe:

1. conservar la trazabilidad de la venta y pago originales;
2. evitar la eliminación o sobrescritura destructiva de registros;
3. verificar que exista valor realmente elegible para devolver;
4. impedir que el mismo importe sea devuelto dos veces;
5. registrar motivo, actor, fecha y evidencia correspondiente;
6. respetar permisos, límites y segregación de funciones;
7. mantener el aislamiento por empresa y tenant;
8. respetar las obligaciones fiscales, contables y de auditoría aplicables.

## 3. Cuándo puede solicitarse

Una solicitud podrá evaluarse cuando exista una causa válida conforme al contrato, las condiciones comerciales del establecimiento y la legislación aplicable.

Ejemplos de causas que pueden ser evaluadas:

- devolución de una compra;
- cancelación o corrección cuando la operación sea legal y técnicamente procedente;
- cobro duplicado;
- pago confirmado por valor incorrecto;
- error operativo comprobado;
- devolución de un pago conforme a una condición comercial previamente informada.

La existencia de una causa no implica aprobación automática. La solicitud debe superar las validaciones de elegibilidad.

## 4. Elegibilidad financiera

Sólo podrá devolverse el valor efectivamente confirmado y que permanezca disponible para compensación.

El sistema deberá considerar:

- pagos originales;
- reembolsos ya completados;
- operaciones en proceso;
- componentes de pagos mixtos;
- moneda;
- referencias e idempotencia;
- límites y permisos;
- conciliaciones;
- obligaciones fiscales o contables relacionadas.

Un pago pendiente, fallido o no autenticado no constituye por sí mismo dinero confirmado disponible para reembolso.

## 5. Reembolsos parciales

Se permiten reembolsos parciales cuando la operación y la política comercial lo permitan.

El sistema deberá conservar:

- valor solicitado;
- valor aprobado;
- valor completado;
- valor pendiente;
- valor restante elegible;
- componentes afectados;
- motivo y evidencia.

Una devolución parcial no puede ocultar el saldo restante ni convertirlo artificialmente en cero.

## 6. Medio de devolución

Como regla de control, la devolución debe utilizar el medio original cuando sea posible y apropiado.

Cambiar el medio requiere una razón válida y los permisos o controles reforzados que correspondan.

No se considerará completado un reembolso externo sólo porque el usuario haya presentado una captura de pantalla, un mensaje o una declaración no autenticada.

La confirmación debe basarse en evidencia válida del medio o en un procedimiento manual autorizado y auditable.

## 7. Efectivo

Cuando la devolución se realice en efectivo:

- debe existir una caja y turno válidos cuando la operación lo requiera;
- debe registrarse el movimiento de salida;
- el valor debe quedar vinculado a la devolución;
- los reintentos no pueden duplicar el egreso;
- la operación debe respetar los límites y permisos vigentes.

El movimiento de caja no elimina el pago original.

## 8. Pagos electrónicos y proveedores externos

Cuando el medio requiera intervención de un proveedor externo:

1. se registrará la solicitud;
2. se conservará su referencia;
3. se esperará evidencia válida del resultado cuando corresponda;
4. un timeout no se interpretará automáticamente como éxito o fracaso definitivo;
5. una respuesta tardía se reconciliará con la operación existente;
6. no se realizará una segunda devolución para compensar una respuesta simplemente tardía.

Si un proveedor no soporta una reversión o devolución determinada, el sistema no debe simularla.

## 9. Devolución de mercancía

Una devolución física de mercancía no demuestra por sí sola que el dinero haya sido reembolsado.

Cuando corresponda, deberán registrarse por separado:

- solicitud o aceptación de devolución física;
- estado de recepción del producto;
- efecto sobre inventario;
- efecto tributario;
- reembolso financiero;
- auditoría.

La reincorporación al inventario debe seguir las reglas del módulo de inventario y no debe producirse sólo por registrar un reembolso financiero.

## 10. Impuestos y documentos fiscales

Las devoluciones deben conservar la trazabilidad de los valores, bases e impuestos de la operación original.

Cuando exista obligación fiscal de emitir, corregir, anular o relacionar documentos, el flujo deberá utilizar la integración fiscal habilitada y la normativa aplicable.

No se debe modificar retroactivamente el snapshot fiscal original para hacer coincidir un reembolso.

## 11. Casos no procedentes

Una solicitud puede ser rechazada, cancelada o enviada a revisión cuando:

- el pago no existe;
- el pago pertenece a otro tenant o empresa;
- el importe ya fue reembolsado;
- el importe solicitado supera el saldo elegible;
- no existe evidencia suficiente;
- la operación carece de autorización;
- el medio no permite la operación solicitada;
- existe un conflicto de concurrencia o idempotencia;
- hay una inconsistencia que requiere revisión manual;
- la devolución contraviene una obligación legal o fiscal.

El rechazo debe conservar trazabilidad; no debe borrar la solicitud.

## 12. Fraude, abuso y revisión

Las operaciones con señales de riesgo podrán requerir revisión adicional, por ejemplo:

- múltiples reembolsos sobre el mismo pago;
- importes superiores a límites;
- cambio de medio;
- operaciones repetidas por el mismo actor;
- inconsistencias entre venta, pago, inventario o caja;
- respuestas externas contradictorias.

Una revisión no constituye por sí misma una acusación de fraude.

## 13. Tiempos

Los tiempos de procesamiento dependen del medio de pago, del proveedor externo y del procedimiento aplicable.

No se publicará un plazo fijo para proveedores externos sin evidencia contractual o técnica que lo respalde.

Las solicitudes internas deberán tramitarse conforme a los procedimientos y términos que defina el Responsable y a las obligaciones legales aplicables.

## 14. Solicitud

El canal oficial para solicitar un reembolso será:

**Correo:** PENDIENTE DE FORMALIZACIÓN  
**Canal:** PENDIENTE DE FORMALIZACIÓN  
**Identificación requerida:** la necesaria para verificar la operación y la legitimidad de la solicitud.

La solicitud deberá permitir localizar la operación, normalmente mediante comprobante, referencia, fecha, valor u otro identificador disponible.

## 15. Relación con la implementación existente

Esta política no crea un segundo flujo de pagos.

La implementación existente debe seguir siendo la fuente técnica para:

- `Refund`;
- `Reversal`;
- idempotencia;
- permisos;
- segregación de funciones;
- estados;
- conciliación;
- auditoría;
- aislamiento multi-tenant.

La política comercial sólo define el marco que debe respetar esa implementación.

## 16. Estado de materialización

La política queda incorporada como documento único para el requisito de reembolso.

**No se declara todavía como política comercial definitiva**, porque el titular contractual, canales oficiales, condiciones económicas y otras condiciones específicas deben ser formalizados.

No se debe crear otra política paralela para el mismo requisito.
