import {
  CompanyScope,
  InventoryDomainError,
  InventoryMovement,
  InventoryTransfer,
  InventoryTransferLine,
  Quantity,
  TenantScope,
  calculateOnHandQuantity,
  type Actor,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { InventoryTransferRepository } from "../ports/inventory-transfer-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { InventoryTransferConflictError } from "../ports/inventory-conflict-errors.js";

export interface DispatchInventoryTransferLineCommand {
  readonly lineId: string;
  readonly quantity: string;
}

export interface DispatchInventoryTransferCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly transferId: string;
  readonly lines: readonly DispatchInventoryTransferLineCommand[];
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type DispatchInventoryTransferResult =
  | { readonly kind: "DISPATCHED"; readonly transfer: InventoryTransfer; readonly lines: readonly InventoryTransferLine[] }
  | { readonly kind: "ALREADY_DISPATCHED"; readonly transfer: InventoryTransfer }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "TRANSFER_NOT_FOUND" | "VERSION_CONFLICT" | "NOT_DISPATCHABLE" | "LINE_NOT_FOUND" | "INVALID_QUANTITY" | "EXCEEDS_REQUESTED" | "INSUFFICIENT_STOCK" };

/**
 * UC-INVENTORY-002 §"Traslados" pasos 6-7: "se registra salida del
 * origen" + "se registra estado IN_TRANSIT" — one `InventoryMovement`
 * (`TRANSFER_OUT`, `reference_type = INVENTORY_TRANSFER`, `reference_id
 * = transfer.id`) per line, at `transfer.sourceLocationId`, same
 * non-negative on-hand guard Adjustment/Waste already enforce.
 */
export class DispatchInventoryTransferUseCase {
  constructor(
    private readonly transferRepository: InventoryTransferRepository,
    private readonly movementRepository: InventoryMovementRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: DispatchInventoryTransferCommand): Promise<DispatchInventoryTransferResult> {
    const authorized = await this.authorization.canTransferInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.transferRepository.findDispatchByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_DISPATCHED", transfer: replay };

    const transfer = await this.transferRepository.findById(command.scope, command.transferId);
    if (!transfer) return { kind: "REJECTED", reason: "TRANSFER_NOT_FOUND" };
    const existingLines = await this.transferRepository.findLines(command.scope, command.transferId);

    let dispatchedTransfer: InventoryTransfer;
    try {
      dispatchedTransfer = transfer.dispatch(command.actor, this.clock.now(), command.expectedVersion);
    } catch (error) {
      if (error instanceof InventoryDomainError) {
        if (error.code === "TRANSFER_VERSION_CONFLICT") return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
        if (error.code === "TRANSFER_NOT_DISPATCHABLE") return { kind: "REJECTED", reason: "NOT_DISPATCHABLE" };
      }
      throw error;
    }

    const tenantScope = new TenantScope(command.scope.tenantId, command.scope.companyId, transfer.sourceBranchId);
    const updatedLines: InventoryTransferLine[] = [];
    const movements: InventoryMovement[] = [];
    for (const lineCommand of command.lines) {
      const line = existingLines.find((candidate) => candidate.id === lineCommand.lineId);
      if (!line) return { kind: "REJECTED", reason: "LINE_NOT_FOUND" };

      let quantity: Quantity;
      try {
        quantity = Quantity.fromString(lineCommand.quantity);
        if (!quantity.isPositive()) throw new Error("non-positive");
      } catch {
        return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
      }

      let dispatchedLine: InventoryTransferLine;
      try {
        dispatchedLine = line.dispatch(quantity);
      } catch (error) {
        if (error instanceof InventoryDomainError && error.code === "RECEIVED_QUANTITY_EXCEEDS_DISPATCHED") {
          return { kind: "REJECTED", reason: "EXCEEDS_REQUESTED" };
        }
        throw error;
      }

      const posted = await this.movementRepository.listPostedMovements(tenantScope, transfer.sourceLocationId, line.presentationId, line.lotId);
      const onHandAfter = calculateOnHandQuantity(posted).subtract(quantity);
      if (!onHandAfter.isPositive() && !onHandAfter.equals(Quantity.zero())) {
        return { kind: "REJECTED", reason: "INSUFFICIENT_STOCK" };
      }

      movements.push(InventoryMovement.register({
        id: this.idGenerator.newId(),
        scope: tenantScope,
        inventoryLocationId: transfer.sourceLocationId,
        presentationId: line.presentationId,
        lotId: line.lotId,
        movementType: "TRANSFER_OUT",
        direction: "OUT",
        quantity,
        reasonCode: null,
        occurredAt: this.clock.now(),
        referenceType: "INVENTORY_TRANSFER",
        referenceId: transfer.id,
      }));
      updatedLines.push(dispatchedLine);
    }

    try {
      // Unlike Consume (one command -> exactly one movement, safe to reuse
      // the caller's idempotencyKey as-is against a different repository's
      // namespace), a dispatch can produce N movements — one per line —
      // from the SAME command idempotencyKey, so each needs its own
      // derived, deterministic key within InventoryMovementRepository's
      // own namespace to avoid colliding with each other.
      for (const movement of movements) {
        await this.movementRepository.save(movement, `${command.idempotencyKey}:${movement.presentationId}:${movement.lotId ?? "no-lot"}`);
      }
      await this.transferRepository.saveDispatch(dispatchedTransfer, updatedLines, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.transferRepository.findDispatchByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_DISPATCHED", transfer: replay };
      }
      if (error instanceof InventoryTransferConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "DISPATCHED", transfer: dispatchedTransfer, lines: updatedLines };
  }
}
