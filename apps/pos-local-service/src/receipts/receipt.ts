/**
 * El recibo: lo que el cajero entrega, proyectado desde la venta (`DEC-019`).
 *
 * Ninguna cifra de estas estructuras se calcula aquí. Todas salen ya congeladas
 * de `sales_sales`, `sales_sale_items` y `payments_payments` —los campos
 * `_snapshot` y los importes en escala 6—, de modo que reimprimir es determinista
 * porque sus entradas lo son.
 *
 * Si alguna vez apareciera una suma en este módulo, sería una segunda verdad
 * sobre un número que ya tiene la suya. La venta manda.
 */

/** Una línea tal como se vendió, con los nombres e importes del momento. */
export interface ReceiptLine {
  readonly lineNumber: number;
  readonly productName: string;
  readonly presentationName: string;
  /** Código de barras o referencia con la que se encontró el producto; puede no haberla. */
  readonly identifier: string | null;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly quantity: string;
  readonly unitPriceAmount: string;
  readonly grossAmount: string;
  readonly discountAmount: string;
  readonly taxableAmount: string;
  readonly taxAmount: string;
  readonly lineTotalAmount: string;
}

/**
 * Un cobro concreto. `changeAmount` sólo tiene sentido en efectivo, y por eso
 * puede ser nulo: una transferencia no devuelve cambio.
 */
export interface ReceiptPayment {
  readonly paymentMethod: string;
  readonly confirmedAmount: string;
  readonly tenderedAmount: string | null;
  readonly changeAmount: string | null;
  readonly currencyCode: string;
  readonly confirmedAt: string;
}

/**
 * El recibo completo de una venta cobrada.
 *
 * **No lleva cabecera fiscal.** No es un olvido: no existe identidad de compañía
 * en local —`snapshot_type` admite un único valor, `CASH_REGISTER`— y fabricar
 * una razón social o un NIT en un documento que se entrega a un cliente es un
 * problema legal, no un hueco de interfaz (`DEC-019`).
 *
 * Tampoco lleva CUFE ni QR: el adapter fiscal no tiene consumidor todavía.
 */
export interface Receipt {
  readonly saleId: string;
  /** Consecutivo del documento: único por sucursal y serie. */
  readonly documentSeries: string;
  readonly saleNumber: number;
  /**
   * Quién compró, si la venta lo nombró (`MIGRATION_019`). Es la columna de la
   * venta, no una lectura de `Customers`: el nombre y el contacto los da
   * `customer.get`, con el permiso de su dueño. `null` es venta de mostrador
   * anónima, y así se dice.
   */
  readonly customerId: string | null;
  readonly currencyCode: string;
  readonly businessDate: string;
  readonly completedAt: string;
  readonly lines: readonly ReceiptLine[];
  readonly subtotalAmount: string;
  readonly discountAmount: string;
  readonly taxAmount: string;
  readonly fiscalTotalAmount: string;
  readonly commercialRoundingAdjustment: string;
  readonly payableAmount: string;
  readonly payments: readonly ReceiptPayment[];
  /** Huella del cálculo que produjo estos importes. Dos recibos con el mismo valor dicen lo mismo. */
  readonly calculationChecksum: string;
}
