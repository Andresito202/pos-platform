import {
  InventoryDomainError,
  InventoryTransfer,
  InventoryTransferLine,
  Quantity,
  type Actor,
  type CompanyScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryTransferRepository } from "../ports/inventory-transfer-repository.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { Clock } from "../ports/clock.js";
import { validateInventoryPresentation } from "../inventory/validate-inventory-presentation.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";

export interface RequestInventoryTransferLineCommand {
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly quantity: string;
}

export interface RequestInventoryTransferCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly sourceBranchId: string;
  readonly sourceLocationId: string;
  readonly destinationBranchId: string;
  readonly destinationLocationId: string;
  readonly lines: readonly RequestInventoryTransferLineCommand[];
  readonly idempotencyKey: string;
}

export type RequestInventoryTransferResult =
  | { readonly kind: "REQUESTED"; readonly transfer: InventoryTransfer; readonly lines: readonly InventoryTransferLine[] }
  | { readonly kind: "ALREADY_REQUESTED"; readonly transfer: InventoryTransfer }
  | {
      readonly kind: "REJECTED";
      readonly reason: "NOT_AUTHORIZED" | "SAME_LOCATION" | "EMPTY_LINES" | "INVALID_QUANTITY" | "PRESENTATION_NOT_FOUND" | "PRESENTATION_NOT_INVENTORY_ENABLED" | "PRESENTATION_STOCK_MODE_NOT_SUPPORTED";
    };

/**
 * UC-INVENTORY-002 §"Traslados" steps 1-4 + `InventoryTransfer` (B31:
 * `CLOSED` as its own aggregate). B32 implements Request/Dispatch/
 * Receive/Cancel only — Approve/Reject exist on the domain object but
 * have no dedicated use case here, since every role this repository can
 * currently authorize for Traslado (`roleMayTransferInventory`:
 * OWNER/GENERAL_ADMIN/INVENTORY_OPERATOR) is unconditional "Sí", with no
 * policy requiring the two-phase approval workflow HD-INV-03 leaves
 * undefined for BRANCH_MANAGER/SUPERVISOR.
 */
export class RequestInventoryTransferUseCase {
  constructor(
    private readonly repository: InventoryTransferRepository,
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RequestInventoryTransferCommand): Promise<RequestInventoryTransferResult> {
    const authorized = await this.authorization.canTransferInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_REQUESTED", transfer: existing };

    if (command.lines.length === 0) return { kind: "REJECTED", reason: "EMPTY_LINES" };

    let transfer: InventoryTransfer;
    try {
      transfer = InventoryTransfer.request({
        id: this.idGenerator.newId(),
        scope: command.scope,
        sourceBranchId: command.sourceBranchId,
        sourceLocationId: command.sourceLocationId,
        destinationBranchId: command.destinationBranchId,
        destinationLocationId: command.destinationLocationId,
        requestedBy: command.actor,
        requestedAt: this.clock.now(),
      });
    } catch (error) {
      if (error instanceof InventoryDomainError && error.code === "SAME_SOURCE_AND_DESTINATION_LOCATION") {
        return { kind: "REJECTED", reason: "SAME_LOCATION" };
      }
      throw error;
    }

    const lines: InventoryTransferLine[] = [];
    for (const lineCommand of command.lines) {
      const presentationCheck = await validateInventoryPresentation(this.presentationRepository, command.scope, lineCommand.presentationId);
      if (presentationCheck.kind === "NOT_FOUND") return { kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" };
      if (presentationCheck.kind === "NOT_INVENTORY_ENABLED") return { kind: "REJECTED", reason: "PRESENTATION_NOT_INVENTORY_ENABLED" };
      if (presentationCheck.kind === "STOCK_MODE_NOT_SUPPORTED") return { kind: "REJECTED", reason: "PRESENTATION_STOCK_MODE_NOT_SUPPORTED" };

      let quantity: Quantity;
      try {
        quantity = Quantity.fromString(lineCommand.quantity);
        if (!quantity.isPositive()) throw new Error("non-positive");
      } catch {
        return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
      }

      lines.push(InventoryTransferLine.create({
        id: this.idGenerator.newId(),
        transferId: transfer.id,
        presentationId: lineCommand.presentationId,
        lotId: lineCommand.lotId,
        requestedQuantity: quantity,
      }));
    }

    try {
      await this.repository.save(transfer, lines, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_REQUESTED", transfer: replay };
      }
      throw error;
    }

    return { kind: "REQUESTED", transfer, lines };
  }
}
