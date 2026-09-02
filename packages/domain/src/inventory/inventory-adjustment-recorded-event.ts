import type { InventoryMovement } from "./inventory-movement.js";

/** UC-INVENTORY-002 "Puntos de observabilidad futura": `INVENTORY_ADJUSTMENT_RECORDED`. */
export class InventoryAdjustmentRecorded {
  readonly type = "InventoryAdjustmentRecorded";
  private constructor(
    readonly movementId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly movementType: "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT",
    readonly occurredAt: Date,
  ) {}

  static from(movement: InventoryMovement): InventoryAdjustmentRecorded {
    if (movement.movementType !== "POSITIVE_ADJUSTMENT" && movement.movementType !== "NEGATIVE_ADJUSTMENT") {
      throw new TypeError(`InventoryAdjustmentRecorded.from() requires an adjustment movement, got ${movement.movementType}`);
    }
    return new InventoryAdjustmentRecorded(movement.id, movement.inventoryLocationId, movement.presentationId, movement.movementType, movement.occurredAt);
  }
}
