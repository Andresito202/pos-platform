import {
  CompanyScope,
  InventoryDomainError,
  InventoryMovement,
  InventoryTransfer,
  InventoryTransferLine,
  InventoryTransferred,
  Quantity,
  TenantScope,
  type Actor,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { InventoryTransferRepository } from "../ports/inventory-transfer-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { InventoryTransferConflictError } from "../ports/inventory-conflict-errors.js";

export interface ReceiveInventoryTransferLineCommand {
  readonly lineId: string;
  readonly quantity: string;
}

export interface ReceiveInventoryTransferCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly transferId: string;
  readonly lines: readonly ReceiveInventoryTransferLineCommand[];
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type ReceiveInventoryTransferResult =
  | { readonly kind: "RECEIVED"; readonly transfer: InventoryTransfer; readonly lines: readonly InventoryTransferLine[]; readonly event: InventoryTransferred }
  | { readonly kind: "ALREADY_RECEIVED"; readonly transfer: InventoryTransfer }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "TRANSFER_NOT_FOUND" | "VERSION_CONFLICT" | "NOT_RECEIVABLE" | "LINE_NOT_FOUND" | "INVALID_QUANTITY" | "EXCEEDS_DISPATCHED" };

/**
 * UC-INVENTORY-002 §"Traslados" pasos 8-10: "el destino confirma
 * recepción... se registra entrada en destino... las diferencias se
 * registran explícitamente". One `InventoryMovement` (`TRANSFER_IN`)
 * per line at `transfer.destinationLocationId`. B32 models receive as a
 * single terminal call covering every line at once — it does not support
 * a SECOND receive call completing a line left `PARTIALLY_RECEIVED` by a
 * first one; multi-stage partial receiving is a documented scope trim,
 * not a decision this block resolves.
 */
export class ReceiveInventoryTransferUseCase {
  constructor(
    private readonly transferRepository: InventoryTransferRepository,
    private readonly movementRepository: InventoryMovementRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: ReceiveInventoryTransferCommand): Promise<ReceiveInventoryTransferResult> {
    const authorized = await this.authorization.canTransferInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.transferRepository.findReceiptByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_RECEIVED", transfer: replay };

    const transfer = await this.transferRepository.findById(command.scope, command.transferId);
    if (!transfer) return { kind: "REJECTED", reason: "TRANSFER_NOT_FOUND" };
    const existingLines = await this.transferRepository.findLines(command.scope, command.transferId);

    const tenantScope = new TenantScope(command.scope.tenantId, command.scope.companyId, transfer.destinationBranchId);
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

      let receivedLine: InventoryTransferLine;
      try {
        receivedLine = line.receive(quantity);
      } catch (error) {
        if (error instanceof InventoryDomainError && error.code === "RECEIVED_QUANTITY_EXCEEDS_DISPATCHED") {
          return { kind: "REJECTED", reason: "EXCEEDS_DISPATCHED" };
        }
        throw error;
      }

      movements.push(InventoryMovement.register({
        id: this.idGenerator.newId(),
        scope: tenantScope,
        inventoryLocationId: transfer.destinationLocationId,
        presentationId: line.presentationId,
        lotId: line.lotId,
        movementType: "TRANSFER_IN",
        direction: "IN",
        quantity,
        reasonCode: null,
        occurredAt: this.clock.now(),
        referenceType: "INVENTORY_TRANSFER",
        referenceId: transfer.id,
      }));
      updatedLines.push(receivedLine);
    }

    // Lines this receive command did not mention keep their prior (dispatched-only) state, contributing to "not fully received" below.
    const unmentioned = existingLines.filter((line) => !command.lines.some((lineCommand) => lineCommand.lineId === line.id));
    const allLinesFullyReceived = unmentioned.length === 0 && updatedLines.every((line) => line.isFullyReceived());

    let receivedTransfer: InventoryTransfer;
    try {
      receivedTransfer = transfer.receive(command.actor, this.clock.now(), allLinesFullyReceived, command.expectedVersion);
    } catch (error) {
      if (error instanceof InventoryDomainError) {
        if (error.code === "TRANSFER_VERSION_CONFLICT") return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
        if (error.code === "TRANSFER_NOT_RECEIVABLE") return { kind: "REJECTED", reason: "NOT_RECEIVABLE" };
      }
      throw error;
    }

    try {
      for (const movement of movements) {
        await this.movementRepository.save(movement, `${command.idempotencyKey}:${movement.presentationId}:${movement.lotId ?? "no-lot"}`);
      }
      await this.transferRepository.saveReceipt(receivedTransfer, [...updatedLines, ...unmentioned], command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.transferRepository.findReceiptByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_RECEIVED", transfer: replay };
      }
      if (error instanceof InventoryTransferConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "RECEIVED", transfer: receivedTransfer, lines: updatedLines, event: InventoryTransferred.from(receivedTransfer) };
  }
}
