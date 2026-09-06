import type { InventoryTransfer } from "./inventory-transfer.js";

/** `docs/domain/event-catalog.md:159` — fired on receive completion (full or partial), when stock has actually moved end to end. */
export class InventoryTransferred {
  readonly type = "InventoryTransferred";
  private constructor(
    readonly transferId: string,
    readonly sourceLocationId: string,
    readonly destinationLocationId: string,
    readonly status: "RECEIVED" | "PARTIALLY_RECEIVED",
  ) {}

  static from(transfer: InventoryTransfer): InventoryTransferred {
    if (transfer.status !== "RECEIVED" && transfer.status !== "PARTIALLY_RECEIVED") {
      throw new TypeError(`InventoryTransferred.from() requires a (partially) received transfer, got ${transfer.status}`);
    }
    return new InventoryTransferred(transfer.id, transfer.sourceLocationId, transfer.destinationLocationId, transfer.status);
  }
}
