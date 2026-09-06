import {
  InventoryDomainError,
  InventoryReservation,
  InventoryReservationReleased,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryReservationRepository } from "../ports/inventory-reservation-repository.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { InventoryReservationConflictError } from "../ports/inventory-conflict-errors.js";

export interface ReleaseInventoryReservationCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly reservationId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type ReleaseInventoryReservationResult =
  | { readonly kind: "RELEASED"; readonly reservation: InventoryReservation; readonly event: InventoryReservationReleased }
  | { readonly kind: "ALREADY_RELEASED"; readonly reservation: InventoryReservation }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "RESERVATION_NOT_FOUND" | "VERSION_CONFLICT" | "NOT_RELEASABLE" };

/**
 * UC-INVENTORY-002 §"Reservas de inventario" regla 3/8: "una reserva
 * liberada no disminuye stock físico" — release touches only the
 * reservation's own state, never `InventoryMovement`. No physical
 * quantity is deducted; it becomes available again purely because
 * `StockBalance.compute` stops counting a `RELEASED` reservation as
 * outstanding.
 */
export class ReleaseInventoryReservationUseCase {
  constructor(
    private readonly reservationRepository: InventoryReservationRepository,
    private readonly authorization: InventoryAuthorizationPort,
  ) {}

  async execute(command: ReleaseInventoryReservationCommand): Promise<ReleaseInventoryReservationResult> {
    const authorized = await this.authorization.canReleaseInventoryReservation(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.reservationRepository.findReleaseByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_RELEASED", reservation: replay };

    const reservation = await this.reservationRepository.findById(command.scope, command.reservationId);
    if (!reservation) return { kind: "REJECTED", reason: "RESERVATION_NOT_FOUND" };

    let released: InventoryReservation;
    try {
      released = reservation.release(command.expectedVersion);
    } catch (error) {
      if (error instanceof InventoryDomainError) {
        if (error.code === "RESERVATION_VERSION_CONFLICT") return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
        if (error.code === "RESERVATION_NOT_RELEASABLE") return { kind: "REJECTED", reason: "NOT_RELEASABLE" };
      }
      throw error;
    }

    try {
      await this.reservationRepository.saveRelease(released, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.reservationRepository.findReleaseByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_RELEASED", reservation: replay };
      }
      if (error instanceof InventoryReservationConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "RELEASED", reservation: released, event: InventoryReservationReleased.from(released) };
  }
}
