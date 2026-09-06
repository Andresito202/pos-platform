import {
  InventoryDeducted,
  InventoryDomainError,
  InventoryMovement,
  InventoryReservation,
  Quantity,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { InventoryReservationRepository } from "../ports/inventory-reservation-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { InventoryReservationConflictError } from "../ports/inventory-conflict-errors.js";

export interface ConsumeInventoryReservationCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly reservationId: string;
  readonly quantity: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type ConsumeInventoryReservationResult =
  | { readonly kind: "CONSUMED"; readonly reservation: InventoryReservation; readonly movement: InventoryMovement; readonly event: InventoryDeducted }
  | { readonly kind: "ALREADY_CONSUMED"; readonly reservation: InventoryReservation }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "RESERVATION_NOT_FOUND" | "INVALID_QUANTITY" | "VERSION_CONFLICT" | "NOT_CONSUMABLE" | "EXCEEDS_RESERVATION" };

/**
 * UC-INVENTORY-002 §"Salidas de inventario" (the reservation-backed
 * path) + "Fronteras transaccionales" §"Consumo": the outbound
 * `InventoryMovement` (`movementType = RESERVATION_CONSUMPTION`,
 * `reference_type/reference_id` pointing back to this reservation) and
 * the reservation's own state transition are described as sharing ONE
 * transaction — "si cualquiera falla, no queda consumo parcial". B32 has
 * no adapter to enforce that atomically yet (DDL gate NO-GO); this use
 * case sequences both writes so a real adapter's transaction wrapper
 * (B33) has exactly one place to wrap, same posture Adjustment/Waste
 * already have for their own single write.
 */
export class ConsumeInventoryReservationUseCase {
  constructor(
    private readonly movementRepository: InventoryMovementRepository,
    private readonly reservationRepository: InventoryReservationRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: ConsumeInventoryReservationCommand): Promise<ConsumeInventoryReservationResult> {
    const authorized = await this.authorization.canConsumeInventoryReservation(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.reservationRepository.findConsumptionByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_CONSUMED", reservation: replay };

    const reservation = await this.reservationRepository.findById(command.scope, command.reservationId);
    if (!reservation) return { kind: "REJECTED", reason: "RESERVATION_NOT_FOUND" };

    let quantity: Quantity;
    try {
      quantity = Quantity.fromString(command.quantity);
      if (!quantity.isPositive()) throw new Error("non-positive");
    } catch {
      return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
    }

    let consumed: InventoryReservation;
    try {
      consumed = reservation.consume(quantity, command.expectedVersion);
    } catch (error) {
      if (error instanceof InventoryDomainError) {
        if (error.code === "RESERVATION_VERSION_CONFLICT") return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
        if (error.code === "RESERVATION_NOT_CONSUMABLE") return { kind: "REJECTED", reason: "NOT_CONSUMABLE" };
        if (error.code === "CONSUMPTION_EXCEEDS_RESERVATION") return { kind: "REJECTED", reason: "EXCEEDS_RESERVATION" };
      }
      throw error;
    }

    const movement = InventoryMovement.register({
      id: this.idGenerator.newId(),
      scope: command.scope,
      inventoryLocationId: reservation.inventoryLocationId,
      presentationId: reservation.presentationId,
      lotId: reservation.lotId,
      movementType: "RESERVATION_CONSUMPTION",
      direction: "OUT",
      quantity,
      reasonCode: null,
      occurredAt: this.clock.now(),
      referenceType: "INVENTORY_RESERVATION",
      referenceId: reservation.id,
    });

    try {
      // Same idempotency_key used against two different repositories' own
      // uniqueness domains (movement vs. reservation-consumption-log) — no
      // collision risk, and it keeps "one command, one idempotency key"
      // instead of inventing a derived/suffixed key.
      await this.movementRepository.save(movement, command.idempotencyKey);
      await this.reservationRepository.saveConsumption(consumed, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.reservationRepository.findConsumptionByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_CONSUMED", reservation: replay };
      }
      if (error instanceof InventoryReservationConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "CONSUMED", reservation: consumed, movement, event: InventoryDeducted.from(consumed, quantity.toString()) };
  }
}
