# Preparación exacta de cantidades de recepción — 2026-10-22

Base `82c7eea`, misma rama. Incremento independiente de la autoridad/políticas aún no disponibles. Reutiliza `money.ts` escala 6/BigInt y mueve sin cambiar su implementación `quantityFitsUnitPrecision` a utilidad compartida; Sales la reexporta para conservar su API. Inventory no importa Sales ni crea otra representación monetaria.

`convertReceiptQuantity` opera cantidad `(19,6)` por factor `(19,10)` del contrato físico de catálogo. Valida positividad, escalas, límites y precisión de unidad origen/destino. Si el producto no es representable exactamente en escala 6 o en la unidad inventariable, rechaza; nunca trunca, redondea ni oculta merma en el factor. `validateReceiptAllocationQuantities` exige asignaciones positivas cuya suma coincida exactamente con la línea. No duplica una línea por cada lote.

El factor no es una regla autorizada por ser un string válido. El futuro llamador debe resolver la conversión publicada/vigente, validar dimensiones/scope y conservar ID/factor/versión, además de política de lote/costo y permiso. Estas funciones son solo aritmética/preparación; no crean lote, recepción, stock, costo ni aprobación y no están expuestas por IPC.

Ejecución: `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/receipt-quantities.test.ts tests/sale.test.ts -t 'quantity|quantities'`: **7/7**, 46 omitidas (4 nuevas + 3 de precisión compartida). Paquetes, peso, valores mínimos, conversión inexacta, unidades indivisibles, escala/factor/cantidad inválidos, overflow y suma de asignaciones. TypeScript y fronteras/política verificados antes de publicar.

## Dependencia contractual comprobada

`packages/contracts/src/master-snapshot.ts` y `DEC-012` §32 autorizan únicamente `CASH_REGISTER`; el discriminador es literal. La recepción de `inventory-receiving-schema.md` exige Supplier e InventoryLocation centrales, y `inventory-schema.md` exige InventoryPolicy versionada para lotes/reservas/ajustes. No hay un snapshot autorizado para entregar esos maestros al runtime actual. No se amplía el literal ni se inventa un catálogo local para aparentar autoridad central.

El writer mínimo actual `inventory_movement/inventory_stock` sigue siendo el de MIGRATION_015; no se confunde con GoodsReceipt/costos/lotes/ubicaciones del contrato objetivo. Antes de materializar esas nuevas proyecciones y escritores se debe reconciliar el contrato de distribución y su owner con DEC-013, conservando las migraciones instaladas. El documento de recepción también difiere explícitamente PurchaseOrder/SupplierDocument/AccountsPayable/SupplierPayment: completar esas capacidades exige su contrato, no usar la recepción como factura u obligación implícita.

Por eso este incremento no cierra GoodsReceipt, D-21 o D-22 ni afirma conteos/kardex/traslados/aprobaciones completos. La preparación numérica ya queda implementada y probada sin elegir una política productiva ni tocar bases persistentes.
