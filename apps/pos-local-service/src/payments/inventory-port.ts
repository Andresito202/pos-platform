import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Puerto de inventario que la finalización de la venta consume.
 *
 * Mismo patrón que `CashPort`: la interfaz la declara el consumidor, de modo
 * que `inventory/` nunca importa de `payments/`. `SqliteInventoryStore` la
 * satisface estructuralmente.
 *
 * **La implementación se ejecuta dentro de la transacción del llamador.** La
 * salida de la mercancía y el `COMPLETED` de la venta que la saca son un solo
 * hecho: si se confirmaran por separado, un fallo entre ambos dejaría una venta
 * cobrada cuya mercancía sigue figurando en la estantería.
 */
export interface SaleDeductionInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleId: string;
  readonly presentationId: string;
  /** Cantidad total de la presentación en la venta, TEXT a escala 6. */
  readonly quantity: string;
  readonly businessDate: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type SaleDeductionOutcome =
  | { readonly kind: "POSTED" }
  | { readonly kind: "IDEMPOTENT" }
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly available: string };

export interface InventoryPort {
  /**
   * Da salida a lo vendido de una presentación con control de existencia.
   *
   * Idempotente por `(venta, presentación)`: reintentar la finalización de la
   * misma venta no descuenta dos veces.
   */
  appendSaleDeduction(input: SaleDeductionInput): SaleDeductionOutcome;
}
