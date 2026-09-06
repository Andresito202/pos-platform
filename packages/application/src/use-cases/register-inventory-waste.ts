import {
  InventoryDomainError,
  InventoryLossRecorded,
  InventoryMovement,
  Quantity,
  calculateOnHandQuantity,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { validateInventoryPresentation } from "../inventory/validate-inventory-presentation.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";

/** UC-INVENTORY-002 §"Mermas" — closed enumeration, not inventable per movement. */
export type InventoryWasteReasonCode = "DAMAGED" | "EXPIRED" | "SPOILAGE" | "LOSS" | "BREAKAGE" | "QUALITY_REJECTION" | "OTHER_AUTHORIZED";

export interface RegisterInventoryWasteCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly inventoryLocationId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly quantity: string;
  readonly reasonCode: InventoryWasteReasonCode;
  readonly idempotencyKey: string;
}

export type RegisterInventoryWasteResult =
  | { readonly kind: "REGISTERED"; readonly movement: InventoryMovement; readonly onHandQuantity: Quantity; readonly event: InventoryLossRecorded }
  | { readonly kind: "ALREADY_REGISTERED"; readonly movement: InventoryMovement }
  | {
      readonly kind: "REJECTED";
      readonly reason:
        | "NOT_AUTHORIZED"
        | "INVALID_QUANTITY"
        | "PRESENTATION_NOT_FOUND"
        | "PRESENTATION_NOT_INVENTORY_ENABLED"
        | "PRESENTATION_STOCK_MODE_NOT_SUPPORTED"
        | "INSUFFICIENT_STOCK";
    };

/**
 * UC-INVENTORY-002 §"Mermas" — same shape as Adjustment (single append-
 * only OUT movement, non-negative on-hand guard, presentation
 * validation) but its OWN authorization row (`roleMayRegisterWaste`,
 * B31: distinct from `roleMayAdjustInventory`) and its own closed reason
 * enumeration, never `EMPTY_REASON_CODE`-checked freeform text like
 * Adjustment — `InventoryWasteReasonCode` is closed by the type system
 * itself.
 */
export class RegisterInventoryWasteUseCase {
  constructor(
    private readonly repository: InventoryMovementRepository,
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterInventoryWasteCommand): Promise<RegisterInventoryWasteResult> {
    const authorized = await this.authorization.canRegisterWaste(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_REGISTERED", movement: existing };

    const presentationCheck = await validateInventoryPresentation(this.presentationRepository, command.scope, command.presentationId);
    if (presentationCheck.kind === "NOT_FOUND") return { kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" };
    if (presentationCheck.kind === "NOT_INVENTORY_ENABLED") return { kind: "REJECTED", reason: "PRESENTATION_NOT_INVENTORY_ENABLED" };
    if (presentationCheck.kind === "STOCK_MODE_NOT_SUPPORTED") return { kind: "REJECTED", reason: "PRESENTATION_STOCK_MODE_NOT_SUPPORTED" };

    let quantity: Quantity;
    try {
      quantity = Quantity.fromString(command.quantity);
      if (!quantity.isPositive()) {
        throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "quantity must be strictly positive");
      }
    } catch {
      return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
    }

    const movement = InventoryMovement.register({
      id: this.idGenerator.newId(),
      scope: command.scope,
      inventoryLocationId: command.inventoryLocationId,
      presentationId: command.presentationId,
      lotId: command.lotId,
      movementType: "WASTE",
      direction: "OUT",
      quantity,
      reasonCode: command.reasonCode,
      occurredAt: this.clock.now(),
    });

    const postedBefore = await this.repository.listPostedMovements(command.scope, command.inventoryLocationId, command.presentationId, command.lotId);
    const onHandBefore = calculateOnHandQuantity(postedBefore);
    const onHandAfter = onHandBefore.add(movement.signedQuantity());
    if (!onHandAfter.isPositive() && !onHandAfter.equals(Quantity.zero())) {
      return { kind: "REJECTED", reason: "INSUFFICIENT_STOCK" };
    }

    try {
      await this.repository.save(movement, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_REGISTERED", movement: replay };
      }
      throw error;
    }

    return { kind: "REGISTERED", movement, onHandQuantity: onHandAfter, event: InventoryLossRecorded.from(movement) };
  }
}
