# UC-SALES-001: Completar venta

## Actor principal

Cajero o usuario autorizado.

## Precondiciones

- Sesión válida.
- Empresa y sucursal activas.
- Caja abierta cuando el método lo requiera.
- Dispositivo autorizado.
- Licencia operativa.
- Carrito no vacío.

## Entrada

- sale_id global;
- branch_id;
- cash_shift_id;
- customer_id opcional;
- items;
- payments;
- discounts;
- sales_channel;
- idempotency_key.

## Validaciones

- contexto de tenant y sucursal;
- productos activos;
- precio vigente;
- permisos de descuento;
- cantidades positivas;
- stock;
- lotes;
- impuestos;
- suma de pagos;
- método de pago;
- estado de caja.

## Flujo principal

1. El POS prepara una solicitud idempotente.
2. El sistema valida contexto y permisos.
3. Valida cada producto y precio.
4. Congela snapshots de producto, precio, impuesto y descuento.
5. Verifica o reserva stock.
6. Calcula subtotal, descuentos, impuestos y total.
7. Valida pagos.
8. Crea venta.
9. Crea detalles.
10. Registra pagos.
11. Registra movimientos de inventario.
12. Registra movimiento de caja cuando corresponda.
13. Registra auditoría.
14. Guarda eventos en outbox.
15. Confirma la transacción.
16. Devuelve consecutivo y estado.
17. Solicita impresión de forma desacoplada.
18. Sincroniza o publica según modalidad.

## Excepciones

### Stock insuficiente

No se confirma la venta.

### Precio desactualizado

Se informa y se exige actualización controlada.

### Pago incompleto

No se confirma la venta.

### Doble solicitud

Se devuelve la venta ya creada.

### Fallo de impresión

La venta permanece confirmada y el ticket queda pendiente.

### Sin Internet

La modalidad híbrida confirma localmente y encola sincronización.

## Postcondiciones

- Venta inmutable confirmada.
- Inventario y caja consistentes.
- Pagos registrados.
- Auditoría disponible.
- Operación idempotente.

## Eventos

- SaleCompleted;
- InventoryDeducted;
- CashMovementRecorded;
- ReceiptRequested;
- SyncOperationQueued cuando aplique.

## Pruebas mínimas

- efectivo;
- transferencia;
- pago mixto;
- producto por peso;
- varios lotes;
- descuento autorizado;
- descuento rechazado;
- doble clic;
- caída de impresora;
- venta offline;
- concurrencia de stock;
- rollback completo.
