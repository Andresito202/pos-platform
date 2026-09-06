import type { InventoryReservation } from "./inventory-reservation.js";

/** `docs/domain/event-catalog.md:153`. */
export class InventoryReserved {
  readonly type = "InventoryReserved";
  private constructor(
    readonly reservationId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly referenceType: string,
    readonly referenceId: string,
  ) {}

  static from(reservation: InventoryReservation): InventoryReserved {
    return new InventoryReserved(reservation.id, reservation.inventoryLocationId, reservation.presentationId, reservation.referenceType, reservation.referenceId);
  }
}
