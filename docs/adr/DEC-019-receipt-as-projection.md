# DEC-019 — El recibo es una proyección de la venta, no un artefacto almacenado

**Estado:** aceptada · **Fecha:** 2026-09-13 · **Ámbito:** POS Local Service

## Contexto

El recibo es lo que el cajero entrega. Hasta hoy no existía una sola línea de
código: `ReceiptRequested` figura como evento en `UC-SALES-001`, la
investigación de UX pide «factura térmica con datos fiscales, impuestos, CUFE y
QR» y «plantilla de recibo configurable», y ahí terminaba todo.

La primera decisión no es cómo se imprime. Es **si el recibo se guarda**.

## La pregunta

Un recibo debe poder reimprimirse mostrando exactamente lo mismo. La lectura
habitual de esa exigencia es «guárdalo»: una tabla `receipt` con el documento ya
compuesto. Antes de aceptarla conviene mirar qué guarda ya la venta.

`sales_sale_items` persiste, por línea y congelado en el momento de la venta:

- `product_name_snapshot`, `presentation_name_snapshot`, `identifier_snapshot`;
- `unit_code_snapshot`, `unit_precision_snapshot`;
- `quantity`, `unit_price_amount`, `gross_amount`, `discount_amount`;
- `taxable_amount`, `tax_amount`, `line_total_amount`;
- `pricing_resolution_snapshot` y `tax_calculation_snapshot`.

Y `sales_sales` persiste el consecutivo —`document_series` + `sale_number`, con
índice único por sucursal—, los totales, `commercial_rounding_adjustment`, las
versiones de política aplicadas y `calculation_checksum`, que ya es una huella
de 64 caracteres sobre el cálculo.

La venta es inmutable una vez `COMPLETED`. **El sufijo `_snapshot` no es
decorativo: significa que el dato no volverá a cambiar aunque cambien el
catálogo, el precio o la tasa.**

## Decisión

**El recibo se deriva de la venta. No se persiste.**

Guardarlo sería duplicar datos que ya son inmutables, y duplicar un dato es
garantizar que una de las dos copias envejezca. Este proyecto ya pagó esa
factura dos veces con las cifras del censo, y el tablero lo tiene escrito como
regla.

Una reimpresión es determinista porque sus entradas lo son: mismos
`_snapshot`, mismo consecutivo, mismo `calculation_checksum`.

## Consecuencias

**No hay `MIGRATION_016`.** El recibo no añade esquema. Es la razón por la que
esta pieza es barata y segura.

**La proyección es de sólo lectura.** No calcula dinero: lee importes ya
calculados y congelados. Si alguna vez hiciera aritmética, estaría produciendo
una segunda verdad sobre el mismo número — exactamente lo que costó unificar la
aritmética monetaria.

**Si el recibo y la venta discrepan, manda la venta.**

## Lo que esta decisión NO resuelve, y por qué

Tres piezas del recibo quedan fuera, y ninguna por falta de ganas:

| Pieza | Bloqueo verificado |
|---|---|
| Cabecera fiscal (razón social, NIT, dirección) | `local_master_snapshot_artifact.snapshot_type` admite **un único valor**, `CASH_REGISTER`. `DEC-013 §7` define cuatro; sólo existe ése. No hay identidad de compañía en local. |
| CUFE y código QR | El adapter fiscal no tiene consumidor: cero llamadas a `DocumentIssuancePort`, `issueDocument` y `NumberingRangePort` en `apps/pos-local-service/src`. |
| Impresión térmica | Periféricos POS es `DOCUMENTED` con cero código. |

Las tres se enchufan sobre esta proyección cuando existan. Ninguna la invalida:
un recibo sin CUFE es un recibo incompleto, no un recibo equivocado.

**Mientras la cabecera fiscal no exista, la proyección no la inventa.** No se
rellena con literales ni con configuración local: un NIT fabricado en un recibo
es un problema legal, no un hueco de interfaz.
