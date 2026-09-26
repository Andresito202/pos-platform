import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { Receipt, ReceiptLine, ReceiptPayment } from "./receipt.js";

/**
 * Lee el recibo de una venta cobrada (`DEC-019`).
 *
 * **Sólo lee.** No inserta, no actualiza y no suma: los importes salen tal como
 * los dejó la transacción que completó la venta.
 *
 * Los pagos no cuelgan de la venta por una columna: `payments_payments` no tiene
 * `sale_id`. Se alcanzan por `payments_payment_allocations`, que es donde el
 * esquema une el dinero con lo que paga. Por eso la consulta pasa por la
 * imputación en lugar de inventar un `JOIN` que el esquema no admite.
 */

interface SaleRow {
  id: string; document_series: string; sale_number: number; customer_id: string | null;
  currency_code: string;
  business_date: string; completed_at: string | null; status: string;
  subtotal_amount: string; discount_amount: string; tax_amount: string;
  fiscal_total_amount: string; commercial_rounding_adjustment: string;
  payable_amount: string; calculation_checksum: string;
}

interface LineRow {
  line_number: number; product_name_snapshot: string; presentation_name_snapshot: string;
  identifier_snapshot: string | null; unit_code_snapshot: string; unit_precision_snapshot: number;
  quantity: string; unit_price_amount: string; gross_amount: string; discount_amount: string;
  taxable_amount: string; tax_amount: string; line_total_amount: string;
}

interface PaymentRow {
  payment_method: string; confirmed_amount: string | null; tendered_amount: string | null;
  change_amount: string | null; currency_code: string; confirmed_at: string | null;
}

export class SqliteReceiptStore {
  constructor(private readonly database: LocalDatabase) {}

  /**
   * Devuelve el recibo, o `null` si la venta no existe en el alcance, o existe
   * pero todavía no está cobrada.
   *
   * Una venta abierta no tiene recibo: entregar uno antes de cobrar sería
   * entregar un comprobante de algo que no ha ocurrido.
   */
  getReceipt(scope: SyncScope, saleId: string): Receipt | null {
    const sale = this.database.native.prepare(
      `SELECT id, document_series, sale_number, customer_id, currency_code, business_date, completed_at,
              status, subtotal_amount, discount_amount, tax_amount, fiscal_total_amount,
              commercial_rounding_adjustment, payable_amount, calculation_checksum
         FROM sales_sales
        WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND id = ?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, saleId) as SaleRow | undefined;

    if (sale === undefined) return null;
    if (sale.status !== "COMPLETED" || sale.completed_at === null) return null;

    const lines = this.database.native.prepare(
      `SELECT line_number, product_name_snapshot, presentation_name_snapshot, identifier_snapshot,
              unit_code_snapshot, unit_precision_snapshot, quantity, unit_price_amount,
              gross_amount, discount_amount, taxable_amount, tax_amount, line_total_amount
         FROM sales_sale_items
        WHERE tenant_id = ? AND sale_id = ?
        ORDER BY line_number`,
    ).all(scope.tenantId, saleId) as LineRow[];

    // Un pago puede imputarse a la venta más de una vez; `DISTINCT` evita que
    // el recibo lo enseñe repetido. El orden es el del cobro, que es el que el
    // cliente recuerda.
    const payments = this.database.native.prepare(
      `SELECT DISTINCT p.payment_method, p.confirmed_amount, p.tendered_amount,
              p.change_amount, p.currency_code, p.confirmed_at
         FROM payments_payment_allocations a
         JOIN payments_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
        WHERE a.tenant_id = ? AND a.collection_subject_type = 'SALE'
          AND a.collection_subject_id = ? AND p.status = 'CONFIRMED'
        ORDER BY p.confirmed_at, p.id`,
    ).all(scope.tenantId, saleId) as PaymentRow[];

    return {
      saleId: sale.id,
      documentSeries: sale.document_series,
      saleNumber: sale.sale_number,
      customerId: sale.customer_id,
      currencyCode: sale.currency_code,
      businessDate: sale.business_date,
      completedAt: sale.completed_at,
      lines: lines.map(toLine),
      subtotalAmount: sale.subtotal_amount,
      discountAmount: sale.discount_amount,
      taxAmount: sale.tax_amount,
      fiscalTotalAmount: sale.fiscal_total_amount,
      commercialRoundingAdjustment: sale.commercial_rounding_adjustment,
      payableAmount: sale.payable_amount,
      payments: payments.map(toPayment),
      calculationChecksum: sale.calculation_checksum,
    };
  }

  /**
   * ¿Existe la venta en este alcance, cobrada o no?
   *
   * Sirve para una sola cosa: distinguir «no es tuya» de «todavía no está
   * cobrada» cuando `getReceipt` devuelve `null`. Sin esto, el cajero recibiría
   * el mismo error en dos situaciones que exigen reacciones distintas.
   */
  saleExists(scope: SyncScope, saleId: string): boolean {
    const row = this.database.native.prepare(
      `SELECT 1 AS found FROM sales_sales
        WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND id = ?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, saleId) as { found: number } | undefined;
    return row !== undefined;
  }
}

function toLine(row: LineRow): ReceiptLine {
  return {
    lineNumber: row.line_number,
    productName: row.product_name_snapshot,
    presentationName: row.presentation_name_snapshot,
    identifier: row.identifier_snapshot,
    unitCode: row.unit_code_snapshot,
    unitPrecision: row.unit_precision_snapshot,
    quantity: row.quantity,
    unitPriceAmount: row.unit_price_amount,
    grossAmount: row.gross_amount,
    discountAmount: row.discount_amount,
    taxableAmount: row.taxable_amount,
    taxAmount: row.tax_amount,
    lineTotalAmount: row.line_total_amount,
  };
}

function toPayment(row: PaymentRow): ReceiptPayment {
  return {
    paymentMethod: row.payment_method,
    // Un pago CONFIRMED tiene importe confirmado; el esquema lo admite nulo
    // porque la fila nace antes de confirmarse, y el filtro ya excluye ese caso.
    confirmedAmount: row.confirmed_amount ?? "0.000000",
    tenderedAmount: row.tendered_amount,
    changeAmount: row.change_amount,
    currencyCode: row.currency_code,
    confirmedAt: row.confirmed_at ?? "",
  };
}
