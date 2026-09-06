/**
 * B33 (Inventory persistence). Same reasoning as `catalog-conflict-errors.ts`
 * — `IdempotencyKeyConflictError` (defined alongside `CashShiftRepository`)
 * covers the same-idempotency-key race for every Inventory create
 * operation as-is. This file adds the optimistic-version race for
 * `InventoryReservation`'s consume/release and `InventoryTransfer`'s
 * dispatch/receipt/cancellation — two concurrent writers both read
 * version N, only one `UPDATE ... WHERE version = N` succeeds. Same
 * shape as `ProductConflictError`.
 */
export class InventoryReservationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryReservationConflictError";
  }
}

export class InventoryTransferConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryTransferConflictError";
  }
}
