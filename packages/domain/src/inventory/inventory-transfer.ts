import type { Actor } from "../actor.js";
import type { CompanyScope } from "../company-scope.js";
import { InventoryDomainError } from "./inventory-domain-errors.js";
import type { InventoryTransferLine } from "./inventory-transfer-line.js";

/**
 * `conceptual-data-model.md:1589-1597` and `UC-INVENTORY-002:230-236`
 * agree exactly on these seven states — no contradiction here (unlike
 * `InventoryReservationStatus`, see HD-INV-06).
 */
export type InventoryTransferStatus = "REQUESTED" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "PARTIALLY_RECEIVED" | "CANCELLED" | "REJECTED";

export interface RequestInventoryTransferInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly sourceBranchId: string;
  readonly sourceLocationId: string;
  readonly destinationBranchId: string;
  readonly destinationLocationId: string;
  readonly requestedBy: Actor;
  readonly requestedAt: Date;
}

export interface RestoreInventoryTransferInput extends RequestInventoryTransferInput {
  readonly status: InventoryTransferStatus;
  readonly approvedBy: Actor | null;
  readonly dispatchedBy: Actor | null;
  readonly receivedBy: Actor | null;
  readonly approvedAt: Date | null;
  readonly dispatchedAt: Date | null;
  readonly receivedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly version: number;
}

/**
 * `InventoryTransfer` (`conceptual-data-model.md:1556-1613`) — B31
 * resolved the "should transfer be its own aggregate" question as
 * `CLOSED`: yes, a traslado is never modeled as two independent
 * `InventoryMovement`s. This aggregate owns identity/state/traceability;
 * the movements it produces reference it via
 * `reference_type = INVENTORY_TRANSFER, reference_id = this.id`
 * (regla 6) — orchestrated by the application layer, which alone talks
 * to `InventoryMovementRepository`.
 *
 * Scope is `CompanyScope`, not `TenantScope`: a transfer spans two
 * branches by definition (regla 1: mismo tenant; regla 2: origen ≠
 * destino), so it cannot itself carry a single `branch_id` the way
 * `InventoryMovement`/`InventoryReservation` do.
 */
export class InventoryTransfer {
  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly sourceBranchId: string,
    readonly sourceLocationId: string,
    readonly destinationBranchId: string,
    readonly destinationLocationId: string,
    readonly status: InventoryTransferStatus,
    readonly requestedBy: Actor,
    readonly approvedBy: Actor | null,
    readonly dispatchedBy: Actor | null,
    readonly receivedBy: Actor | null,
    readonly requestedAt: Date,
    readonly approvedAt: Date | null,
    readonly dispatchedAt: Date | null,
    readonly receivedAt: Date | null,
    readonly cancelledAt: Date | null,
    readonly cancellationReason: string | null,
    readonly version: number,
  ) {}

  static request(input: RequestInventoryTransferInput): InventoryTransfer {
    if (input.sourceLocationId === input.destinationLocationId) {
      throw new InventoryDomainError("SAME_SOURCE_AND_DESTINATION_LOCATION", "a transfer requires two different inventory locations");
    }
    return new InventoryTransfer(
      input.id, input.scope, input.sourceBranchId, input.sourceLocationId, input.destinationBranchId, input.destinationLocationId,
      "REQUESTED", input.requestedBy, null, null, null, input.requestedAt, null, null, null, null, null, 1,
    );
  }

  /** B32: reconstructs a transfer from an already-persisted row — same posture as `CashShift.restore()`. */
  static restore(input: RestoreInventoryTransferInput): InventoryTransfer {
    return new InventoryTransfer(
      input.id, input.scope, input.sourceBranchId, input.sourceLocationId, input.destinationBranchId, input.destinationLocationId,
      input.status, input.requestedBy, input.approvedBy, input.dispatchedBy, input.receivedBy,
      input.requestedAt, input.approvedAt, input.dispatchedAt, input.receivedAt, input.cancelledAt, input.cancellationReason, input.version,
    );
  }

  approve(approvedBy: Actor, approvedAt: Date, expectedVersion: number): InventoryTransfer {
    this.guardVersion(expectedVersion);
    if (this.status !== "REQUESTED") {
      throw new InventoryDomainError("TRANSFER_NOT_DISPATCHABLE", `transfer ${this.id} is ${this.status}, not requested`);
    }
    return this.with({ status: "APPROVED", approvedBy, approvedAt, version: this.version + 1 });
  }

  reject(expectedVersion: number): InventoryTransfer {
    this.guardVersion(expectedVersion);
    if (this.status !== "REQUESTED") {
      throw new InventoryDomainError("TRANSFER_NOT_DISPATCHABLE", `transfer ${this.id} is ${this.status}, not requested`);
    }
    return this.with({ status: "REJECTED", version: this.version + 1 });
  }

  /**
   * "Se aprueba cuando la política lo exige" (UC-INVENTORY-002) —
   * approval is conditional, not mandatory: dispatch accepts either
   * `REQUESTED` (no approval required for this actor/policy) or
   * `APPROVED` (approval was completed first). No `InventoryPolicy` is
   * codified yet to decide WHICH case applies for a given transfer — the
   * application layer's authorization for dispatch already limits this
   * to roles with unconditional "Sí" (HD-INV-03), so today only the
   * `REQUESTED`-skip path is reachable in practice.
   */
  dispatch(dispatchedBy: Actor, dispatchedAt: Date, expectedVersion: number): InventoryTransfer {
    this.guardVersion(expectedVersion);
    if (this.status !== "REQUESTED" && this.status !== "APPROVED") {
      throw new InventoryDomainError("TRANSFER_NOT_DISPATCHABLE", `transfer ${this.id} is ${this.status}, not requested/approved`);
    }
    return this.with({ status: "IN_TRANSIT", dispatchedBy, dispatchedAt, version: this.version + 1 });
  }

  /** `allLinesFullyReceived` is computed by the application layer over the transfer's own `InventoryTransferLine`s — this aggregate does not hold them. */
  receive(receivedBy: Actor, receivedAt: Date, allLinesFullyReceived: boolean, expectedVersion: number): InventoryTransfer {
    this.guardVersion(expectedVersion);
    if (this.status !== "IN_TRANSIT") {
      throw new InventoryDomainError("TRANSFER_NOT_RECEIVABLE", `transfer ${this.id} is ${this.status}, not in transit`);
    }
    return this.with({ status: allLinesFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED", receivedBy, receivedAt, version: this.version + 1 });
  }

  /**
   * Regla 9: "una cancelación posterior a la salida requiere
   * compensación explícita" — B32 only implements the simple pre-dispatch
   * cancellation; post-dispatch cancellation (which would need a
   * compensating `InventoryMovement`, a separate concern) is not modeled
   * here, matching HD-INV-03's non-blocking scope for the base flow.
   */
  cancel(reason: string, cancelledAt: Date, expectedVersion: number): InventoryTransfer {
    this.guardVersion(expectedVersion);
    if (this.status !== "REQUESTED" && this.status !== "APPROVED") {
      throw new InventoryDomainError("TRANSFER_NOT_CANCELLABLE", `transfer ${this.id} is ${this.status} — cancellation after dispatch requires explicit compensation, not modeled in B32`);
    }
    if (!reason.trim()) {
      throw new InventoryDomainError("EMPTY_REASON_CODE", "cancelling a transfer requires a non-empty reason");
    }
    return this.with({ status: "CANCELLED", cancellationReason: reason, cancelledAt, version: this.version + 1 });
  }

  private guardVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new InventoryDomainError("TRANSFER_VERSION_CONFLICT", `transfer ${this.id} version moved (expected ${expectedVersion}, actual ${this.version})`);
    }
  }

  private with(changes: Partial<{
    status: InventoryTransferStatus;
    approvedBy: Actor | null;
    dispatchedBy: Actor | null;
    receivedBy: Actor | null;
    approvedAt: Date | null;
    dispatchedAt: Date | null;
    receivedAt: Date | null;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    version: number;
  }>): InventoryTransfer {
    return new InventoryTransfer(
      this.id, this.scope, this.sourceBranchId, this.sourceLocationId, this.destinationBranchId, this.destinationLocationId,
      changes.status ?? this.status,
      this.requestedBy,
      "approvedBy" in changes ? changes.approvedBy! : this.approvedBy,
      "dispatchedBy" in changes ? changes.dispatchedBy! : this.dispatchedBy,
      "receivedBy" in changes ? changes.receivedBy! : this.receivedBy,
      this.requestedAt,
      "approvedAt" in changes ? changes.approvedAt! : this.approvedAt,
      "dispatchedAt" in changes ? changes.dispatchedAt! : this.dispatchedAt,
      "receivedAt" in changes ? changes.receivedAt! : this.receivedAt,
      "cancelledAt" in changes ? changes.cancelledAt! : this.cancelledAt,
      "cancellationReason" in changes ? changes.cancellationReason! : this.cancellationReason,
      changes.version ?? this.version,
    );
  }
}
