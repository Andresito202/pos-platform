# UC-INVENTORY-001: Recibir mercancía

## Actor principal

Operador de inventario, compras, supervisor o administrador autorizado.

## Precondiciones

- Usuario autenticado.
- Sucursal activa.
- Ubicación de inventario activa y perteneciente a la sucursal autorizada.
- Proveedor y productos válidos.
- Permiso de recepción.

## Entrada

- supplier_id;
- branch_id;
- inventory_location_id;
- goods_receipt_lines, cada una con:
  - line_number;
  - product_presentation_id;
  - source_quantity;
  - source_unit_id;
  - inventory_quantity;
  - unit_cost;
  - currency_code;
  - cost_tax_treatment: `INCLUDED`, `EXCLUDED` o `UNKNOWN`;
  - unit_conversion_id, conversion_factor y conversion_version cuando exista conversión;
  - una o más goods_receipt_lot_allocations, cada una con inventory_quantity y, cuando corresponda, supplier_batch_code, manufacture_date y expiration_date;
- received_at;
- idempotency_key;
- correlation_id.

`GoodsReceipt` representa exclusivamente la recepción física confirmada y puede existir sin `PurchaseOrder`. El primer release no acepta una referencia genérica `Purchase`; `PurchaseOrder`, documento del proveedor, impuestos de compra, landed cost, contabilidad y pagos a proveedores permanecen diferidos.

Cada línea congela la presentación, la cantidad y unidad fuente, la cantidad inventariable, el costo unitario declarado, la moneda, el tratamiento tributario conocido y la conversión exacta aplicada. `UNKNOWN` conserva que el tratamiento tributario no pudo determinarse; no ejecuta ni sustituye un cálculo tributario de compras. El instante efectivo, actor y dispositivo/fuente se derivan del contexto autenticado y su evidencia temporal; no se aceptan como identidad libre del frontend.

## Flujo principal

1. El usuario escanea o selecciona productos.
2. El sistema completa datos conocidos.
3. El usuario registra líneas, costo y una o más asignaciones de lote cuando aplique.
4. El sistema valida que la ubicación pertenezca al tenant, empresa y sucursal derivados.
5. El sistema valida y congela el factor y la versión de conversión aplicables antes de obtener la cantidad inventariable.
6. Valida que la suma de las asignaciones de lote de cada línea sea igual a su cantidad inventariable, además de duplicados, fechas, costos, moneda y unidades.
7. Crea el `GoodsReceipt` confirmado y sus `GoodsReceiptLine`.
8. Crea o resuelve los lotes y registra las `GoodsReceiptLotAllocation` de cada línea.
9. Registra un `InventoryMovement` de entrada por cada `GoodsReceiptLotAllocation` en la única ubicación seleccionada para la recepción.
10. Actualiza las proyecciones de stock a partir de los movimientos.
11. Registra el costo de recepción con su instante efectivo y actor/fuente.
12. No calcula landed cost, costo contable, valoración promedio ni impuestos de compra, y no modifica automáticamente el precio de venta.
13. Registra auditoría y outbox.
14. Confirma atómicamente la operación y emite `GoodsReceiptConfirmed`.

Si la mercancía se recibe en más de una ubicación, se registra un `GoodsReceipt` independiente por ubicación. Una recepción confirmada es inmutable: un error se corrige mediante una nueva operación compensatoria y una devolución al proveedor genera movimientos de salida nuevos; ninguna de las dos reescribe la recepción original.

## Excepciones

- Producto inactivo.
- Unidad incompatible.
- Fecha inválida.
- Lote duplicado según política.
- Costo negativo.
- Moneda o tratamiento tributario del costo inválidos.
- Conversión incompleta, no versionada o inconsistente.
- Suma de asignaciones de lote distinta de la cantidad inventariable de la línea.
- Solicitud repetida.
- Ubicación inexistente, inactiva o fuera del alcance autorizado.

## Postcondiciones

- Inventario incrementado por movimientos.
- Costo de recepción conservado sin convertirlo en costo contable, valoración o precio de venta.
- Recepción, líneas, asignaciones de lote, movimientos, auditoría y outbox trazables.

## Pruebas mínimas

- producto unitario;
- producto por peso;
- lote con vencimiento;
- una línea distribuida entre múltiples lotes y un movimiento por asignación;
- asignaciones cuya suma no coincide con la cantidad inventariable;
- recepción repetida;
- ubicación de otra sucursal o tenant;
- intento de mezclar ubicaciones en una recepción;
- conversión de unidades;
- conservación de factor y versión de conversión;
- tratamiento tributario de costo incluido, excluido y desconocido sin calcular impuesto de compra;
- corrección compensatoria sin modificación de la recepción confirmada;
- múltiples empaques.
