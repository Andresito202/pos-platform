# Bloque 3A — importación XLSX/CSV de catálogo y existencias

## Separación vigente (no mezclar writers)

1. **Catálogo:** plantilla `camacho-catalogo.csv|xlsx` → preview → confirm
   - Alta: `catalog.product.register`
   - Actualización comercial: `catalog.product.update`
   - Precio: `catalog.price.publish`
2. **Existencias:** plantilla `camacho-existencias.csv|xlsx` → preview → confirm
   - Solo `inventory.stock.receive` (suma, no sobrescribe saldo)
   - Identidad idempotente `inventory-csv:{import_id}:{row_id}`

La selección de archivo **no escribe**. La confirmación puede fallar a mitad;
las filas ya confirmadas permanecen y el reintento con la misma identidad no
duplica.

## Columnas de catálogo

`import_id`, `row_id`, `codigo_producto`, `nombre`, `descripcion`, `marca`,
`categoria`, `codigo_barras`, `presentacion`, `unidad`, `precision`,
`cantidad_por_presentacion` (informativa en 3A), `precio_venta`, `moneda`,
`control_existencias`, `estado`.

Unidad/precisión de productos con historia: si difieren del registrado, se
rechaza `UNIT_CHANGE_FORBIDDEN` (no se muta la unidad base).

## Columnas de existencias

Compatibles con el CSV legado de 7 columnas, o con lote opcional:

`lote`, `fecha_fabricacion`, `fecha_vencimiento`, `referencia_proveedor`,
`documento_recibo` — solo con `PURCHASE_RECEIPT` y campos de lote completos.

## Campos administrativos persistidos (SQLite MIGRATION_031)

`catalog_product.description`, `brand`, `category` — lectura/escritura real vía
register/update/list/find. No viven solo en React.

## Pendiente 3B / 3C

- Aplicar `cantidad_por_presentacion` como regla de conversión autorizada.
- Canal multicaja de invalidación de catálogo/inventario.
- Importación atómica de archivo completo (hoy es por fila).
- Alta de presentaciones adicionales en la misma planilla.
- Cambio de `stock_controlled` en actualización (solo en alta hoy).
