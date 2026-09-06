import type { InventoryMovement } from "./inventory-movement.js";

/** `docs/domain/event-catalog.md:163` — catalogued name for a merma/waste movement. */
export class InventoryLossRecorded {
  readonly type = "InventoryLossRecorded";
  private constructor(
    readonly movementId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly reasonCode: string,
    readonly occurredAt: Date,
  ) {}

  static from(movement: InventoryMovement): InventoryLossRecorded {
    if (movement.movementType !== "WASTE") {
      throw new TypeError(`InventoryLossRecorded.from() requires a WASTE movement, got ${movement.movementType}`);
    }
    if (!movement.reasonCode) {
      throw new TypeError("InventoryLossRecorded.from() requires a movement with a reasonCode");
    }
    return new InventoryLossRecorded(movement.id, movement.inventoryLocationId, movement.presentationId, movement.reasonCode, movement.occurredAt);
  }
}
