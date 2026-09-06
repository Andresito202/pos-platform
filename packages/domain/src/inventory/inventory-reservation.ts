import { Quantity } from "../quantity.js";
import type { TenantScope } from "../tenant-scope.js";
import { InventoryDomainError } from "./inventory-domain-errors.js";

/**
 * B31 HD-INV-06 (`traceability.md`): `UC-INVENTORY-002:109-114` lists six
 * states including `CANCELLED`; `conceptual-data-model.md:1539-1543` lists
 * five, omitting it — a real `CONTRADICTION` between two normative
 * documents, not resolved by inference. B32 implements only the five
 * states BOTH documents agree on. There is deliberately no `cancel()`
 * method on this class: adding one would silently resolve HD-INV-06 by
 * picking a side. When the owner resolves it, this type (and a `cancel()`
 * method if confirmed) can be added without redesigning the rest.
 */
export type InventoryReservationStatus = "ACTIVE" | "PARTIALLY_CONSUMED" | "CONSUMED" | "RELEASED" | "EXPIRED";

export interface CreateInventoryReservationInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly inventoryLocationId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly quantity: Quantity;
  readonly expiresAt: Date | null;
}

export interface RestoreInventoryReservationInput extends CreateInventoryReservationInput {
  readonly consumedQuantity: Quantity;
  readonly releasedQuantity: Quantity;
  readonly status: InventoryReservationStatus;
  readonly version: number;
}

/**
 * `InventoryReservation` — "compromete cantidad disponible... sin
 * registrar todavía una salida definitiva" (UC-INVENTORY-002). A real
 * mutable aggregate (unlike `StockBalance`): its own lifecycle IS the
 * source of truth for "how much of this reservation is still
 * outstanding", so it carries `expected_version` optimistic concurrency,
 * same precedent as `CashShift`/`Product`.
 */
export class InventoryReservation {
  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly inventoryLocationId: string,
    readonly presentationId: string,
    readonly lotId: string | null,
    readonly referenceType: string,
    readonly referenceId: string,
    readonly quantity: Quantity,
    readonly consumedQuantity: Quantity,
    readonly releasedQuantity: Quantity,
    readonly status: InventoryReservationStatus,
    readonly expiresAt: Date | null,
    readonly version: number,
  ) {}

  static create(input: CreateInventoryReservationInput): InventoryReservation {
    if (!input.quantity.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_RESERVATION_QUANTITY", "reservation quantity must be strictly positive");
    }
    return new InventoryReservation(
      input.id, input.scope, input.inventoryLocationId, input.presentationId, input.lotId,
      input.referenceType, input.referenceId, input.quantity, Quantity.zero(), Quantity.zero(),
      "ACTIVE", input.expiresAt, 1,
    );
  }

  /** B32: reconstructs a reservation from an already-persisted row — same posture as `CashShift.restore()`. */
  static restore(input: RestoreInventoryReservationInput): InventoryReservation {
    return new InventoryReservation(
      input.id, input.scope, input.inventoryLocationId, input.presentationId, input.lotId,
      input.referenceType, input.referenceId, input.quantity, input.consumedQuantity, input.releasedQuantity,
      input.status, input.expiresAt, input.version,
    );
  }

  /** Quantity still compromising availability: not yet consumed and not yet released. */
  outstandingQuantity(): Quantity {
    return this.quantity.subtract(this.consumedQuantity).subtract(this.releasedQuantity);
  }

  /**
   * UC-INVENTORY-002 regla 2/9: "una reserva consumida no puede
   * consumirse nuevamente" — only `ACTIVE`/`PARTIALLY_CONSUMED` accept
   * consumption. Partial vs full consumption is derived, never a caller
   * input.
   */
  consume(amount: Quantity, expectedVersion: number): InventoryReservation {
    this.guardVersion(expectedVersion);
    if (this.status !== "ACTIVE" && this.status !== "PARTIALLY_CONSUMED") {
      throw new InventoryDomainError("RESERVATION_NOT_CONSUMABLE", `reservation ${this.id} is ${this.status}, not consumable`);
    }
    if (!amount.isPositive()) {
      throw new InventoryDomainError("NON_POSITIVE_RESERVATION_QUANTITY", "consumption amount must be strictly positive");
    }
    const newConsumed = this.consumedQuantity.add(amount);
    if (newConsumed.add(this.releasedQuantity).subtract(this.quantity).isPositive()) {
      throw new InventoryDomainError("CONSUMPTION_EXCEEDS_RESERVATION", `consuming ${amount.toString()} would exceed reservation ${this.id}`);
    }
    const fullyConsumed = newConsumed.add(this.releasedQuantity).equals(this.quantity);
    return new InventoryReservation(
      this.id, this.scope, this.inventoryLocationId, this.presentationId, this.lotId,
      this.referenceType, this.referenceId, this.quantity, newConsumed, this.releasedQuantity,
      fullyConsumed ? "CONSUMED" : "PARTIALLY_CONSUMED", this.expiresAt, this.version + 1,
    );
  }

  /**
   * Releasable from `ACTIVE`/`PARTIALLY_CONSUMED`/`EXPIRED` — an expired
   * reservation still holds its outstanding quantity until an explicit
   * release (UC-INVENTORY-002 regla 4 under "Reservas de inventario").
   * Releasing the remaining, not-yet-consumed quantity — a partially
   * consumed reservation keeps its `CONSUMED` portion untouched.
   */
  release(expectedVersion: number): InventoryReservation {
    this.guardVersion(expectedVersion);
    if (this.status !== "ACTIVE" && this.status !== "PARTIALLY_CONSUMED" && this.status !== "EXPIRED") {
      throw new InventoryDomainError("RESERVATION_NOT_RELEASABLE", `reservation ${this.id} is ${this.status}, not releasable`);
    }
    const remaining = this.quantity.subtract(this.consumedQuantity).subtract(this.releasedQuantity);
    return new InventoryReservation(
      this.id, this.scope, this.inventoryLocationId, this.presentationId, this.lotId,
      this.referenceType, this.referenceId, this.quantity, this.consumedQuantity,
      this.releasedQuantity.add(remaining), "RELEASED", this.expiresAt, this.version + 1,
    );
  }

  /** Only marks the reservation unusable for future consumption — does NOT release capacity by itself (see class doc). */
  expire(expectedVersion: number): InventoryReservation {
    this.guardVersion(expectedVersion);
    if (this.status !== "ACTIVE" && this.status !== "PARTIALLY_CONSUMED") {
      throw new InventoryDomainError("RESERVATION_NOT_EXPIRABLE", `reservation ${this.id} is ${this.status}, not expirable`);
    }
    return new InventoryReservation(
      this.id, this.scope, this.inventoryLocationId, this.presentationId, this.lotId,
      this.referenceType, this.referenceId, this.quantity, this.consumedQuantity, this.releasedQuantity,
      "EXPIRED", this.expiresAt, this.version + 1,
    );
  }

  private guardVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new InventoryDomainError("RESERVATION_VERSION_CONFLICT", `reservation ${this.id} version moved (expected ${expectedVersion}, actual ${this.version})`);
    }
  }
}
