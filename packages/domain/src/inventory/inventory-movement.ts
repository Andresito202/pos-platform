import { Quantity } from "../quantity.js";
import type { TenantScope } from "../tenant-scope.js";
import { InventoryDomainError } from "./inventory-domain-errors.js";

/**
 * inventory-schema.md ("inventory.inventory_movements"), line naming the
 * "tipos estables" (stable types): this is NOT presented as a closed,
 * exhaustive enumeration the way CashMovementType was — the document says
 * these types "incluyen" (include) the ones below, and explicitly defers
 * ordinary GoodsReceipt-backed inbound and Sale-backed outbound movements
 * to `reference_type`/`reference_id` without giving them a stable
 * `movement_type` name ("entradas/salidas respaldadas... no aliases
 * intercambiables" — described, never named). Only the six named values
 * below are transcribed; no name is invented for the unnamed ones. Only
 * POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT have a factory and a use case
 * this block — the rest are real, closed-so-far members with no business
 * logic behind them yet, same posture as CashMovementType's untouched 14.
 */
export type InventoryMovementType =
  | "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT" | "WASTE"
  | "TRANSFER_OUT" | "TRANSFER_IN" | "RESERVATION_CONSUMPTION";

export type InventoryMovementDirection = "IN" | "OUT";
export type InventoryMovementStatus = "POSTED";

export interface RegisterInventoryMovementInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly inventoryLocationId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly movementType: InventoryMovementType;
  readonly direction: InventoryMovementDirection;
  readonly quantity: Quantity;
  readonly reasonCode: string | null;
  readonly occurredAt: Date;
  /**
   * B32 addition: `inventory-schema.md` requires `reference_type`/
   * `reference_id` on every row, but B27's original shape omitted them
   * entirely — a real gap, only surfaced now that `RESERVATION_CONSUMPTION`/
   * `TRANSFER_OUT`/`TRANSFER_IN` need to link back to the aggregate that
   * caused them (`InventoryReservation`/`InventoryTransfer`). Optional so
   * every pre-existing call site (Adjustment/Waste, which have no such
   * aggregate to reference) keeps compiling unchanged.
   */
  readonly referenceType?: string | null;
  readonly referenceId?: string | null;
}

/**
 * A single InventoryMovement — "fuente de verdad de existencias"
 * (conceptual-data-model.md). Append-only by construction: there is no
 * update/mutate method, matching "no se actualiza ni elimina; una
 * corrección crea movimiento compensatorio referenciado"
 * (inventory-receiving-schema.md).
 *
 * `lotId` is accepted exactly as given, never validated against a
 * lot-control policy: inventory-schema.md says lot control is "activa por
 * control de Product/Presentation + capability/entitlement + InventoryPolicy
 * efectiva", but this repository has no ProductPresentation aggregate and
 * no InventoryPolicy version to resolve that condition against (Product,
 * Block 5, only carries `lotControlled` for the whole product, and the
 * schema is explicit that lot/location/quantity are NOT duplicated onto
 * Product) — enforcing "lot required when the presentation demands it" here
 * would mean inventing which source resolves it. Documented gap, not a
 * silently-skipped check.
 */
export class InventoryMovement {
  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly lotId: string | null,
    readonly movementType: InventoryMovementType,
    readonly direction: InventoryMovementDirection,
    readonly quantity: Quantity,
    readonly reasonCode: string | null,
    readonly status: InventoryMovementStatus,
    readonly occurredAt: Date,
    readonly referenceType: string | null,
    readonly referenceId: string | null,
  ) {}

  static register(input: RegisterInventoryMovementInput): InventoryMovement {
    if (!input.quantity.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "movement quantity must be strictly positive");
    }
    return new InventoryMovement(
      input.id, input.scope, input.inventoryLocationId, input.presentationId, input.lotId,
      input.movementType, input.direction, input.quantity, input.reasonCode, "POSTED", input.occurredAt,
      input.referenceType ?? null, input.referenceId ?? null,
    );
  }

  /**
   * "Ajustes de inventario" (UC-INVENTORY-002): reason_code is required
   * ("se exige reason_code") for both adjustment directions — a rule this
   * document states unconditionally, unlike the separate approval
   * requirement ("puede exigirse... según monto, producto o riesgo"),
   * which has no defined threshold anywhere and is deliberately NOT
   * enforced here.
   */
  static positiveAdjustment(
    input: Omit<RegisterInventoryMovementInput, "movementType" | "direction" | "reasonCode"> & { readonly reasonCode: string },
  ): InventoryMovement {
    return InventoryMovement.registerAdjustment(input, "POSITIVE_ADJUSTMENT", "IN");
  }

  static negativeAdjustment(
    input: Omit<RegisterInventoryMovementInput, "movementType" | "direction" | "reasonCode"> & { readonly reasonCode: string },
  ): InventoryMovement {
    return InventoryMovement.registerAdjustment(input, "NEGATIVE_ADJUSTMENT", "OUT");
  }

  private static registerAdjustment(
    input: Omit<RegisterInventoryMovementInput, "movementType" | "direction" | "reasonCode"> & { readonly reasonCode: string },
    movementType: "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT",
    direction: InventoryMovementDirection,
  ): InventoryMovement {
    if (!input.reasonCode.trim()) {
      throw new InventoryDomainError("EMPTY_REASON_CODE", "an inventory adjustment requires a non-empty reason code");
    }
    return InventoryMovement.register({ ...input, movementType, direction, reasonCode: input.reasonCode });
  }

  /** IN adds, OUT subtracts — used by the on-hand quantity fold. */
  signedQuantity(): Quantity {
    return this.direction === "IN" ? this.quantity : Quantity.zero().subtract(this.quantity);
  }
}
