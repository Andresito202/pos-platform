import { Quantity } from "../quantity.js";
import type { InventoryMovement } from "./inventory-movement.js";
import type { InventoryReservation } from "./inventory-reservation.js";

/**
 * `StockBalance` is `DERIVED_PROJECTION` (inventory-schema.md) —
 * "reconstruible desde movimientos [y reservas]". B32 keeps it a pure
 * computed value, not a persisted mutable aggregate with its own
 * `expected_version`: unlike Cash's `calculateExpectedCash` (also a pure
 * fold, no `ExpectedCash` table), there is no adapter yet to decide
 * whether B33 caches this as a real versioned row or keeps recomputing
 * it — that is a persistence-layer decision, not a domain one, and B32
 * (domain/application design, no persistence) must not pre-commit to it.
 *
 * `onHandQuantity` folds posted `InventoryMovement`s exactly like
 * `calculateOnHandQuantity` already did. `reservedQuantity` folds
 * `outstandingQuantity()` (`quantity - consumed - released`) over EVERY
 * reservation passed in, with no status filter: the quantity math
 * itself already zeroes out `RELEASED` (fully released) and `CONSUMED`
 * (fully consumed) reservations, while `EXPIRED` correctly keeps
 * contributing its full outstanding amount — "una reserva expirada debe
 * liberarse mediante transición explícita" (UC-INVENTORY-002 regla 4):
 * expiry alone does not free capacity. A status whitelist here would
 * have to remember to include `EXPIRED`; folding the quantity directly
 * makes that a property of the math, not a list to keep in sync.
 */
export class StockBalance {
  private constructor(
    readonly onHandQuantity: Quantity,
    readonly reservedQuantity: Quantity,
  ) {}

  static compute(postedMovements: readonly InventoryMovement[], outstandingReservations: readonly InventoryReservation[]): StockBalance {
    const onHand = postedMovements.reduce((total, movement) => total.add(movement.signedQuantity()), Quantity.zero());
    const reserved = outstandingReservations.reduce((total, reservation) => total.add(reservation.outstandingQuantity()), Quantity.zero());
    return new StockBalance(onHand, reserved);
  }

  availableQuantity(): Quantity {
    return this.onHandQuantity.subtract(this.reservedQuantity);
  }
}
