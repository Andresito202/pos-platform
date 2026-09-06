import { InventoryDomainError, InventoryTransfer, type Actor, type CompanyScope } from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryTransferRepository } from "../ports/inventory-transfer-repository.js";
import type { Clock } from "../ports/clock.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { InventoryTransferConflictError } from "../ports/inventory-conflict-errors.js";

export interface CancelInventoryTransferCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly transferId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type CancelInventoryTransferResult =
  | { readonly kind: "CANCELLED"; readonly transfer: InventoryTransfer }
  | { readonly kind: "ALREADY_CANCELLED"; readonly transfer: InventoryTransfer }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "TRANSFER_NOT_FOUND" | "VERSION_CONFLICT" | "NOT_CANCELLABLE" | "EMPTY_REASON" };

/**
 * UC-INVENTORY-002 §"Traslados" regla 9. Only pre-dispatch cancellation
 * (`REQUESTED`/`APPROVED`) — see `InventoryTransfer.cancel()`'s own doc
 * comment for why post-dispatch cancellation is out of scope for B32.
 */
export class CancelInventoryTransferUseCase {
  constructor(
    private readonly repository: InventoryTransferRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
  ) {}

  async execute(command: CancelInventoryTransferCommand): Promise<CancelInventoryTransferResult> {
    const authorized = await this.authorization.canTransferInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    if (!command.reason.trim()) return { kind: "REJECTED", reason: "EMPTY_REASON" };

    const replay = await this.repository.findCancellationByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_CANCELLED", transfer: replay };

    const transfer = await this.repository.findById(command.scope, command.transferId);
    if (!transfer) return { kind: "REJECTED", reason: "TRANSFER_NOT_FOUND" };

    let cancelled: InventoryTransfer;
    try {
      cancelled = transfer.cancel(command.reason, this.clock.now(), command.expectedVersion);
    } catch (error) {
      if (error instanceof InventoryDomainError) {
        if (error.code === "TRANSFER_VERSION_CONFLICT") return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
        if (error.code === "TRANSFER_NOT_CANCELLABLE") return { kind: "REJECTED", reason: "NOT_CANCELLABLE" };
      }
      throw error;
    }

    try {
      await this.repository.saveCancellation(cancelled, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.repository.findCancellationByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_CANCELLED", transfer: replay };
      }
      if (error instanceof InventoryTransferConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "CANCELLED", transfer: cancelled };
  }
}
