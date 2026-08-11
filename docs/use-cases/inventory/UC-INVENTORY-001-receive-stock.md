# UC-INVENTORY-001: Recibir mercancía

## Actor principal

Operador de inventario, compras, supervisor o administrador autorizado.

## Precondiciones

- Usuario autenticado.
- Sucursal activa.
- Proveedor y productos válidos.
- Permiso de recepción.

## Entrada

- supplier_id;
- purchase_id opcional;
- branch_id;
- items;
- cantidades;
- unidades;
- costos;
- lotes;
- fechas;
- idempotency_key.

## Flujo principal

1. El usuario escanea o selecciona productos.
2. El sistema completa datos conocidos.
3. El usuario registra cantidad, costo, lote y vencimiento cuando aplique.
4. El sistema convierte cantidades a unidad base.
5. Valida duplicados, fechas, costos y unidades.
6. Crea la recepción.
7. Crea lotes cuando corresponda.
8. Registra movimientos de entrada.
9. Actualiza proyecciones de stock.
10. Registra historial de costos.
11. No modifica automáticamente el precio de venta.
12. Registra auditoría.
13. Emite InventoryReceived.

## Excepciones

- Producto inactivo.
- Unidad incompatible.
- Fecha inválida.
- Lote duplicado según política.
- Costo negativo.
- Solicitud repetida.

## Postcondiciones

- Inventario incrementado por movimientos.
- Costos conservados.
- Recepción trazable.

## Pruebas mínimas

- producto unitario;
- producto por peso;
- lote con vencimiento;
- recepción repetida;
- conversión de unidades;
- múltiples empaques.
