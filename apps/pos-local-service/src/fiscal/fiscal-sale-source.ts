import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { DocumentScope } from "./sqlite-fiscal-document-store.js";

/**
 * Lectura de la venta cobrada para armar un documento fiscal (`DEC-021` F4).
 *
 * Mismo patrón de consulta que `SqliteReceiptStore` —venta, `sales_sale_items`,
 * pagos vía `payments_payment_allocations`— pero con las columnas que la
 * factura necesita y el recibo no: `presentation_id` por línea (para resolver
 * el atributo fiscal) y `payment_method` en crudo (para traducir a código
 * DIAN). Dos consumidores del mismo dato con necesidades distintas no
 * justifican un tercer modelo compartido; cada uno lee lo suyo.
 *
 * **Sólo lee.** No inserta, no actualiza, no interpreta el desenlace incierto.
 */

export interface FiscalSaleLine {
  readonly lineNumber: number;
  readonly presentationId: string;
  readonly productNameSnapshot: string;
  readonly quantity: string;
  readonly unitPriceAmount: string;
  readonly discountAmount: string;
}

export interface FiscalSalePayment {
  readonly paymentMethod: string;
  readonly confirmedAmount: string;
}

export interface FiscalSaleSource {
  readonly customerId: string | null;
  readonly saleId: string;
  readonly documentSeries: string;
  readonly saleNumber: number;
  readonly currencyCode: string;
  readonly commercialRoundingAdjustment: string;
  readonly lines: readonly FiscalSaleLine[];
  readonly payments: readonly FiscalSalePayment[];
}

interface SaleRow {
  customer_id: string | null;
  id: string; document_series: string; sale_number: number; currency_code: string;
  commercial_rounding_adjustment: string;
}

interface LineRow {
  line_number: number; presentation_id: string; product_name_snapshot: string;
  quantity: string; unit_price_amount: string; discount_amount: string;
}

interface PaymentRow {
  payment_method: string; confirmed_amount: string;
}

export class SqliteFiscalSaleSource {
  constructor(private readonly database: LocalDatabase) {}

  /** `null` si la venta no existe en el alcance, o existe pero no está `COMPLETED`. */
  read(scope: DocumentScope, saleId: string): FiscalSaleSource | null {
    const sale = this.database.native.prepare(
      `SELECT id, customer_id, document_series, sale_number, currency_code, commercial_rounding_adjustment
         FROM sales_sales
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=? AND status='COMPLETED'`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, saleId) as SaleRow | undefined;
    if (sale === undefined) return null;

    const lines = this.database.native.prepare(
      `SELECT line_number, presentation_id, product_name_snapshot, quantity,
              unit_price_amount, discount_amount
         FROM sales_sale_items
        WHERE tenant_id=? AND sale_id=?
        ORDER BY line_number`,
    ).all(scope.tenantId, saleId) as LineRow[];

    const payments = this.database.native.prepare(
      `SELECT DISTINCT p.payment_method, p.confirmed_amount
         FROM payments_payment_allocations a
         JOIN payments_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
        WHERE a.tenant_id=? AND a.collection_subject_type='SALE' AND a.collection_subject_id=?
          AND p.status='CONFIRMED'
        ORDER BY p.confirmed_at, p.id`,
    ).all(scope.tenantId, saleId) as PaymentRow[];

    return {
      saleId: sale.id,
      customerId: sale.customer_id,
      documentSeries: sale.document_series,
      saleNumber: sale.sale_number,
      currencyCode: sale.currency_code,
      commercialRoundingAdjustment: sale.commercial_rounding_adjustment,
      lines: lines.map((row) => ({
        lineNumber: row.line_number,
        presentationId: row.presentation_id,
        productNameSnapshot: row.product_name_snapshot,
        quantity: row.quantity,
        unitPriceAmount: row.unit_price_amount,
        discountAmount: row.discount_amount,
      })),
      payments: payments.map((row) => ({
        paymentMethod: row.payment_method,
        confirmedAmount: row.confirmed_amount,
      })),
    };
  }
}
