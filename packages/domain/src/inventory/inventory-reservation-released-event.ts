import type { InventoryReservation } from "./inventory-reservation.js";

/** `docs/domain/event-catalog.md:155`. */
export class InventoryReservationReleased {
  readonly type = "InventoryReservationReleased";
  private constructor(
    readonly reservationId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly releasedQuantity: string,
  ) {}

  static from(reservation: InventoryReservation): InventoryReservationReleased {
    if (reservation.status !== "RELEASED") {
      throw new TypeError(`InventoryReservationReleased.from() requires a RELEASED reservation, got ${reservation.status}`);
    }
    return new InventoryReservationReleased(reservation.id, reservation.inventoryLocationId, reservation.presentationId, reservation.releasedQuantity.toString());
  }
}
