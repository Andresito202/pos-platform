import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Puerto de caja que Payment consume — `DEC-016` §10.
 *
 * Payments **no escribe** `cash_shift`, `cash_movement` ni asigna
 * `shift_sequence`: la secuencia es propiedad de Cash y asignarla desde fuera
 * rompería su monotonía. Payments declara aquí lo que necesita; Cash lo
 * implementa.
 *
 * La interfaz la define el consumidor (inversión de dependencias), de modo que
 * `cash/` nunca importa de `payments/`. `SqliteCashShiftStore` la satisface
 * estructuralmente.
 *
 * **La implementación debe ejecutarse dentro de la transacción del llamador.**
 * No abre una propia: el asiento de caja y la confirmación del pago son un solo
 * hecho (`DEC-016` §5.3) y no pueden confirmarse por separado.
 */
export interface CashSaleAppendInput {
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
}

export type CashSaleAppendOutcome =
  | { readonly kind: "POSTED"; readonly shiftSequence: number }
  | { readonly kind: "SHIFT_NOT_FOUND" }
  | { readonly kind: "SHIFT_NOT_OPEN" }
  | { readonly kind: "CURRENCY_MISMATCH" };

export interface CashPort {
  /**
   * Asienta un `CASH_SALE` / `IN` / `POSTED` en el turno indicado.
   *
   * Al ser `IN` y `POSTED` entra automáticamente en el pliegue de
   * `expectedCash` del cierre de turno (`BLOQUE 4D`), sin que el cierre
   * necesite conocer Payments.
   */
  appendCashSale(input: CashSaleAppendInput): CashSaleAppendOutcome;
}
