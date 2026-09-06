import { Quantity } from "../quantity.js";
import { InventoryDomainError } from "./inventory-domain-errors.js";

export interface CreateInventoryTransferLineInput {
  readonly id: string;
  readonly transferId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly requestedQuantity: Quantity;
}

export interface RestoreInventoryTransferLineInput extends CreateInventoryTransferLineInput {
  readonly dispatchedQuantity: Quantity;
  readonly receivedQuantity: Quantity;
}

/**
 * `InventoryTransferLine` (`conceptual-data-model.md:1614-1641`) — one
 * presentation/lot within a transfer. `differenceQuantity` is always
 * derived (`dispatchedQuantity - receivedQuantity`), never a stored
 * input, matching regla 3 ("la diferencia debe quedar registrada", not
 * asserted by the caller).
 */
export class InventoryTransferLine {
  private constructor(
    readonly id: string,
    readonly transferId: string,
    readonly presentationId: string,
    readonly lotId: string | null,
    readonly requestedQuantity: Quantity,
    readonly dispatchedQuantity: Quantity,
    readonly receivedQuantity: Quantity,
  ) {}

  static create(input: CreateInventoryTransferLineInput): InventoryTransferLine {
    if (!input.requestedQuantity.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "requested transfer quantity must be strictly positive");
    }
    return new InventoryTransferLine(input.id, input.transferId, input.presentationId, input.lotId, input.requestedQuantity, Quantity.zero(), Quantity.zero());
  }

  static restore(input: RestoreInventoryTransferLineInput): InventoryTransferLine {
    return new InventoryTransferLine(input.id, input.transferId, input.presentationId, input.lotId, input.requestedQuantity, input.dispatchedQuantity, input.receivedQuantity);
  }

  dispatch(quantity: Quantity): InventoryTransferLine {
    if (!quantity.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "dispatched quantity must be strictly positive");
    }
    // regla 2: "dispatched_quantity no puede superar la cantidad autorizada salvo política explícita" — no policy exists yet, so the safe default is to enforce the cap.
    if (quantity.subtract(this.requestedQuantity).isPositive()) {
      throw new InventoryDomainError("RECEIVED_QUANTITY_EXCEEDS_DISPATCHED", `dispatched ${quantity.toString()} exceeds requested ${this.requestedQuantity.toString()} for line ${this.id}`);
    }
    return new InventoryTransferLine(this.id, this.transferId, this.presentationId, this.lotId, this.requestedQuantity, quantity, this.receivedQuantity);
  }

  receive(quantity: Quantity): InventoryTransferLine {
    if (!quantity.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "received quantity must be strictly positive");
    }
    // regla 3: "received_quantity puede ser menor que dispatched_quantity" — but never greater; the excess would have no source movement to back it.
    if (quantity.subtract(this.dispatchedQuantity).isPositive()) {
      throw new InventoryDomainError("RECEIVED_QUANTITY_EXCEEDS_DISPATCHED", `received ${quantity.toString()} exceeds dispatched ${this.dispatchedQuantity.toString()} for line ${this.id}`);
    }
    return new InventoryTransferLine(this.id, this.transferId, this.presentationId, this.lotId, this.requestedQuantity, this.dispatchedQuantity, quantity);
  }

  differenceQuantity(): Quantity {
    return this.dispatchedQuantity.subtract(this.receivedQuantity);
  }

  isFullyReceived(): boolean {
    return this.differenceQuantity().equals(Quantity.zero());
  }
}
