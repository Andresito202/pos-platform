# Pendiente — importación XLSX y alta masiva (siguiente bloque)

## Separación vigente

1. **Catálogo:** alta unitaria (`catalog.product.register`) y edición
   (`catalog.product.update` / `catalog.price.publish` / media).
2. **Existencias:** recepción/ajuste unitarios e `InventoryCsvImport` →
   `inventory.stock.receive` / adjust.

CSV de existencias **no** es soporte nativo de XLSX ni alta masiva de productos.

## Contratos / validaciones que faltan para XLSX

- Formato canónico de columnas (código, nombre, presentación, unidad, precisión,
  barcode, precio, moneda, stock inicial opcional).
- Idempotencia por fila y rechazo de unidades incompatibles con historia.
- Separación explícita fila-catálogo vs fila-existencia (no mezclar en un solo
  writer genérico).
- Límite de tamaño, encoding y rechazo de macros/OLE.
- Permisos dedicados distintos de `INVENTORY_STOCK_RECEIVE`.
- Evidencia de aislamiento tenant/company y de no-double-post en reintentos.

Hasta autorizar ese bloque, no se simula XLSX en UI.
