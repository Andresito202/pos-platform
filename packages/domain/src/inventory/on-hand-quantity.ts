import { Quantity } from "../quantity.js";
import type { InventoryMovement } from "./inventory-movement.js";

/**
 * "StockBalance es DERIVED_PROJECTION... reconstruible desde movimientos"
 * (inventory-schema.md) — a pure fold, not a stored/versioned row, mirroring
 * calculateExpectedCash's role for Cash. This computes ON-HAND quantity
 * only, not the full StockBalance shape (on_hand/reserved/available):
 * `reserved_quantity` is maintained by InventoryReservation's own lifecycle,
 * which this block does not implement, so a full StockBalance with a
 * fabricated `reserved: 0` would misrepresent a value that is genuinely
 * unmodeled, not verified zero.
 */
export function calculateOnHandQuantity(postedMovements: readonly InventoryMovement[]): Quantity {
  return postedMovements.reduce((total, movement) => total.add(movement.signedQuantity()), Quantity.zero());
}
