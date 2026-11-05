# Caja y ventas — RBAC de controles existentes (2026-11-04)

Rama: `feat/android-commercial-runtime`. La certificación del login Windows es responsabilidad separada del PR #99; no se han modificado login, SCM, DPAPI, sesiones, grants, snapshots, servicios comerciales, precios ni contratos.

## Tabla de permisos y handlers ya presentes

| Superficie | Acción real | Permiso requerido en UI | Backend/contrato |
|---|---|---|---|
| Caja sin turno | `sale.openShift` | `CASH_SHIFT_OPEN` | `cash.shift.open` |
| Caja con turno | `sale.closeShift` | `CASH_SHIFT_CLOSE` | `cash.shift.close` |
| Catálogo de venta | `sale.listCatalogItems` / `sale.findItem` | `CATALOG_PRODUCT_READ` | `catalog.item.list`, `catalog.item.find` |
| Carrito → venta | `sale.createSale` | `SALES_SALE_CREATE` | `sale.create` |
| Efectivo | `sale.chargeCash` | `PAYMENTS_PAYMENT_REGISTER` | `payment.register.cash` |
| Registrar transferencia | `sale.registerTransfer` | `PAYMENTS_TRANSFER_REPORT` | `payment.register.transfer` |
| Confirmar transferencia | `sale.confirmTransfer` | `PAYMENTS_TRANSFER_CONFIRM` | `payment.transfer.confirm` |
| Cancelar transferencia pendiente | `sale.cancelTransfer` | `PAYMENTS_PAYMENT_CANCEL` | `payment.cancel` |
| Consultar/actualizar transferencia | `sale.loadTransfer` | `PAYMENTS_PAYMENT_READ` | `payment.get` |
| Ver comprobante | `onReceipt` | `SALES_RECEIPT_READ` | Pantalla de comprobantes existente |
| Facturar venta cobrada | `onInvoice` | `FISCAL_DOCUMENT_ISSUE` | Emisión fiscal existente |

## Correcciones de interfaz realizadas

- Se oculta el control de apertura si falta `CASH_SHIFT_OPEN`, sin inventar un turno. El indicador de turno abierto sigue visible a usuarios con otras capacidades, pero el campo de arqueo y el botón de cierre se muestran solo con `CASH_SHIFT_CLOSE`.
- El botón de creación de venta se oculta sin `SALES_SALE_CREATE`.
- Los controles de cobro en efectivo y el contador de billetes/monedas se muestran solo con `PAYMENTS_PAYMENT_REGISTER`.
- El botón de reporte de transferencia se muestra solo con `PAYMENTS_TRANSFER_REPORT`. Confirmar y cancelar se muestran separadamente con los permisos reales `PAYMENTS_TRANSFER_CONFIRM` y `PAYMENTS_PAYMENT_CANCEL`; su estado pendiente, versión y bloqueo por busy/completed permanecen intactos.
- La consulta de pago continúa independiente con `PAYMENTS_PAYMENT_READ`, sin asumir que el supervisor de una transferencia tiene que poder cobrar efectivo o crear ventas.
- Tarjeta, QR integrado, crédito/fiado y lectura de balanza siguen siendo superficies deshabilitadas cuando no existe contrato operativo. No se activan ni se inventan pasarelas.
- Los iconos SVG existentes de métodos de pago se conservan sin cambio; fotografías de denominaciones aún faltan en el árbol de Git, como ya documentó la auditoría visual.

## Pruebas y límites

- Se ajustaron las comprobaciones históricas para esperar controles **ocultos** cuando el permiso falta, en vez de botones meramente deshabilitados.
- Se añadieron dos escenarios de interfaz para solo lectura de pagos y solo apertura de caja. Los tests de flujo comercial y contratos `SalePanel.test.tsx` permanecen para detectar regresiones en pago y transferencia.
- **No se ejecutaron TypeScript, Vitest, Playwright ni Electron físico en esta sesión**. El workflow GitHub Actions existente puede ser verde sin ejecutar el escaneo Strix ni las suites de renderizador; no interpretar como certificación.
- La validación de privilegios sigue correspondiendo al backend. Ocultar un botón no constituye autorización.
- Pendiente de ejecutar `pnpm --filter @pos-platform/pos-desktop typecheck` y `pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/SalePanel.test.tsx` en un entorno apropiado, además de pruebas físicas después de certificación Windows.
