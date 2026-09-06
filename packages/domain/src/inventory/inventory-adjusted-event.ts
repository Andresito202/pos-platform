import type { InventoryMovement } from "./inventory-movement.js";

/**
 * B32: renamed from `InventoryAdjustmentRecorded` — `docs/domain/event-catalog.md:151`
 * catalogs this event as `InventoryAdjusted`, a MINOR discrepancy B30/B31
 * registered and B32 now closes (a straightforward rename, not a new
 * decision: the catalogued name is authoritative and unambiguous).
 */
export class InventoryAdjusted {
  readonly type = "InventoryAdjusted";
  private constructor(
    readonly movementId: string,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly movementType: "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT",
    readonly occurredAt: Date,
  ) {}

  static from(movement: InventoryMovement): InventoryAdjusted {
    if (movement.movementType !== "POSITIVE_ADJUSTMENT" && movement.movementType !== "NEGATIVE_ADJUSTMENT") {
      throw new TypeError(`InventoryAdjusted.from() requires an adjustment movement, got ${movement.movementType}`);
    }
    return new InventoryAdjusted(movement.id, movement.inventoryLocationId, movement.presentationId, movement.movementType, movement.occurredAt);
  }
}
