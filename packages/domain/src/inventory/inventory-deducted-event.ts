import type { InventoryReservation } from "./inventory-reservation.js";

/** `docs/domain/event-catalog.md:157` — fired when a reservation is (partially) consumed, producing the actual physical deduction. */
export class InventoryDeducted {
  readonly type = "InventoryDeducted";
  private constructor(
    readonly reservationId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly consumedAmount: string,
  ) {}

  static from(reservation: InventoryReservation, consumedAmount: string): InventoryDeducted {
    if (reservation.status !== "PARTIALLY_CONSUMED" && reservation.status !== "CONSUMED") {
      throw new TypeError(`InventoryDeducted.from() requires a (partially) consumed reservation, got ${reservation.status}`);
    }
    return new InventoryDeducted(reservation.id, reservation.inventoryLocationId, reservation.presentationId, consumedAmount);
  }
}
