import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Puerto de crédito que Payments consume — `DEC-005`.
 *
 * Payments **no conoce** `customers_credit_accounts` ni
 * `customers_credit_transactions`: declara aquí lo que necesita y `credit/` lo
 * implementa, de modo que `credit/` nunca importa de `payments/`. Es la misma
 * inversión de dependencias que ya sostienen `CashPort` e `InventoryPort`, y
 * `SqliteCreditStore` satisface este puerto estructuralmente.
 *
 * **La implementación debe ejecutarse dentro de la transacción del llamador.**
 * La obligación del cliente y la confirmación del pago que la origina son un
 * solo hecho: si una se escribe y la otra no, el comercio ha entregado
 * mercancía que nadie debe, o cobrado una deuda que no existe.
 */
export interface CreditAccountSnapshot {
  readonly accountId: string;
  /** Cupo explícito. No hay cupo por defecto del comercio (`DEC-005`). */
  readonly creditLimit: string;
  readonly currencyCode: string;
}

export interface CreditPort {
  /** La cuenta del cliente bajo el tenant verificado, o `null` si no la tiene. */
  findAccountByCustomer(scope: SyncScope, customerId: string): CreditAccountSnapshot | null;

  /**
   * Saldo pendiente recomputado desde el libro. Payments lo pide en el momento
   * de decidir y jamás lo recibe del llamador.
   */
  outstandingBalance(scope: SyncScope, accountId: string): bigint;

  /** Asienta el movimiento que origina la deuda. No abre transacción. */
  appendTransaction(input: {
    readonly scope: SyncScope;
    readonly transactionId: string;
    readonly accountId: string;
    readonly transactionType: "SALE_CREDIT" | "CUSTOMER_PAYMENT";
    readonly direction: "INCREASE" | "DECREASE";
    readonly amount: string;
    readonly currencyCode: string;
    readonly saleId: string | null;
    readonly paymentId: string | null;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly nowIso: string;
  }): void;
}
