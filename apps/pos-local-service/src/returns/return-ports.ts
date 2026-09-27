import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Lo que la devolución necesita de Cash y de Inventory — mismo patrón que
 * `payments/cash-port.ts`: la interfaz la declara el consumidor, de modo que
 * `cash/` e `inventory/` nunca importan de `returns/`. `SqliteCashShiftStore`
 * y `SqliteInventoryStore` la satisfacen estructuralmente.
 *
 * **Las escrituras se ejecutan dentro de la transacción de la devolución.** La
 * salida de efectivo, el reingreso de mercancía y la devolución misma son un
 * solo hecho: si se confirmaran por separado, un fallo entre ellos dejaría
 * dinero entregado sin devolución registrada, o al revés.
 */
export interface ReturnCashPort {
  findActiveShiftForRegister(
    scope: SyncScope, cashRegisterId: string,
  ): { readonly shiftId: string; readonly status: "OPEN" | "CLOSING" } | null;
  shiftBusinessDate(scope: SyncScope, shiftId: string): string | null;
  appendCashRefund(input: {
    readonly scope: SyncScope;
    readonly movementId: string;
    readonly cashShiftId: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly operatorUserId: string;
    readonly businessDate: string;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly reasonCode: string;
  }):
    | { readonly kind: "POSTED"; readonly shiftSequence: number }
    | { readonly kind: "SHIFT_NOT_FOUND" }
    | { readonly kind: "SHIFT_NOT_OPEN" }
    | { readonly kind: "CURRENCY_MISMATCH" }
    | { readonly kind: "INSUFFICIENT_CASH"; readonly expectedCash: string };
}

export interface ReturnInventoryPort {
  appendReturnRestock(input: {
    readonly scope: SyncScope;
    readonly sessionId: string;
    readonly operatorUserId: string;
    readonly saleId: string;
    readonly saleReturnId: string;
    readonly presentationId: string;
    readonly quantity: string;
    readonly businessDate: string;
    readonly correlationId: string;
    readonly causationId: string | null;
  }): { readonly kind: "POSTED"; readonly lotsRestored: number } | { readonly kind: "IDEMPOTENT" };
}
