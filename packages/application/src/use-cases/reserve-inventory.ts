import {
  InventoryDomainError,
  InventoryReservation,
  InventoryReserved,
  Quantity,
  StockBalance,
  calculateOnHandQuantity,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { InventoryReservationRepository } from "../ports/inventory-reservation-repository.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { validateInventoryPresentation } from "../inventory/validate-inventory-presentation.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";

export interface ReserveInventoryCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly inventoryLocationId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly quantity: string;
  readonly expiresAt: Date | null;
  readonly idempotencyKey: string;
}

export type ReserveInventoryResult =
  | { readonly kind: "RESERVED"; readonly reservation: InventoryReservation; readonly event: InventoryReserved }
  | { readonly kind: "ALREADY_RESERVED"; readonly reservation: InventoryReservation }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "INVALID_QUANTITY" | "PRESENTATION_NOT_FOUND" | "PRESENTATION_NOT_INVENTORY_ENABLED" | "PRESENTATION_STOCK_MODE_NOT_SUPPORTED" | "INSUFFICIENT_AVAILABLE" };

/**
 * UC-INVENTORY-002 §"Reservas de inventario", steps 1-10: identify scope
 * -> validate presentation/lot -> determine available quantity ->
 * evaluate existing reservations -> verify the new reservation does not
 * exceed effective availability -> create -> persist. `StockBalance`
 * (B32, pure fold) supplies both terms of that check from the SAME two
 * repositories this use case already needs — no third, persisted
 * projection.
 */
export class ReserveInventoryUseCase {
  constructor(
    private readonly movementRepository: InventoryMovementRepository,
    private readonly reservationRepository: InventoryReservationRepository,
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: ReserveInventoryCommand): Promise<ReserveInventoryResult> {
    const authorized = await this.authorization.canReserveInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.reservationRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_RESERVED", reservation: existing };

    const presentationCheck = await validateInventoryPresentation(this.presentationRepository, command.scope, command.presentationId);
    if (presentationCheck.kind === "NOT_FOUND") return { kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" };
    if (presentationCheck.kind === "NOT_INVENTORY_ENABLED") return { kind: "REJECTED", reason: "PRESENTATION_NOT_INVENTORY_ENABLED" };
    if (presentationCheck.kind === "STOCK_MODE_NOT_SUPPORTED") return { kind: "REJECTED", reason: "PRESENTATION_STOCK_MODE_NOT_SUPPORTED" };

    let quantity: Quantity;
    try {
      quantity = Quantity.fromString(command.quantity);
      if (!quantity.isPositive()) throw new Error("non-positive");
    } catch {
      return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
    }

    const [postedMovements, outstandingReservations] = await Promise.all([
      this.movementRepository.listPostedMovements(command.scope, command.inventoryLocationId, command.presentationId, command.lotId),
      this.reservationRepository.listOutstanding(command.scope, command.inventoryLocationId, command.presentationId, command.lotId),
    ]);
    const balance = StockBalance.compute(postedMovements, outstandingReservations);
    const available = balance.availableQuantity();
    const remainder = available.subtract(quantity);
    if (!remainder.isPositive() && !remainder.equals(Quantity.zero())) {
      return { kind: "REJECTED", reason: "INSUFFICIENT_AVAILABLE" };
    }

    let reservation: InventoryReservation;
    try {
      reservation = InventoryReservation.create({
        id: this.idGenerator.newId(),
        scope: command.scope,
        inventoryLocationId: command.inventoryLocationId,
        presentationId: command.presentationId,
        lotId: command.lotId,
        referenceType: command.referenceType,
        referenceId: command.referenceId,
        quantity,
        expiresAt: command.expiresAt,
      });
    } catch (error) {
      if (error instanceof InventoryDomainError) return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
      throw error;
    }

    try {
      await this.reservationRepository.save(reservation, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.reservationRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_RESERVED", reservation: replay };
      }
      throw error;
    }

    return { kind: "RESERVED", reservation, event: InventoryReserved.from(reservation) };
  }
}
