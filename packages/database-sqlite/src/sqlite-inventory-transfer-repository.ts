import { randomUUID } from "node:crypto";
import { Actor, CompanyScope, InventoryTransfer, InventoryTransferLine, Quantity, type ActorType, type InventoryTransferStatus } from "@pos-platform/domain";
import { IdempotencyKeyConflictError, InventoryTransferConflictError, type InventoryTransferRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface InventoryTransferRow {
  id: string;
  tenant_id: string;
  company_id: string;
  source_branch_id: string;
  source_location_id: string;
  destination_branch_id: string;
  destination_location_id: string;
  status: string;
  requested_by_actor_type: string;
  requested_by_actor_id: string;
  approved_by_actor_type: string | null;
  approved_by_actor_id: string | null;
  dispatched_by_actor_type: string | null;
  dispatched_by_actor_id: string | null;
  received_by_actor_type: string | null;
  received_by_actor_id: string | null;
  requested_at: string;
  approved_at: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  version: number;
}

interface InventoryTransferLineRow {
  id: string;
  transfer_id: string;
  presentation_id: string;
  lot_id: string | null;
  requested_quantity: string;
  dispatched_quantity: string;
  received_quantity: string;
}

interface MutationLogRow {
  snapshot_json: string;
}

interface TransferSnapshot {
  transfer: {
    id: string; tenantId: string; companyId: string; sourceBranchId: string; sourceLocationId: string;
    destinationBranchId: string; destinationLocationId: string; status: InventoryTransferStatus;
    requestedByActorType: ActorType; requestedByActorId: string;
    approvedByActorType: ActorType | null; approvedByActorId: string | null;
    dispatchedByActorType: ActorType | null; dispatchedByActorId: string | null;
    receivedByActorType: ActorType | null; receivedByActorId: string | null;
    requestedAt: string; approvedAt: string | null; dispatchedAt: string | null; receivedAt: string | null;
    cancelledAt: string | null; cancellationReason: string | null; version: number;
  };
  lines: Array<{ id: string; transferId: string; presentationId: string; lotId: string | null; requestedQuantity: string; dispatchedQuantity: string; receivedQuantity: string }>;
}

/**
 * B33: real SQLite adapter for `InventoryTransferRepository` over
 * `MIGRATION_010`. `InventoryTransfer` has FOUR mutation types touching
 * the same row (request/dispatch/receipt/cancellation) — same mutation-
 * log pattern as Reservation/Product, extended to snapshot the child
 * `InventoryTransferLine`s alongside the transfer, since a replay of any
 * step must return both exactly as they were at that step.
 */
export class SqliteInventoryTransferRepository implements InventoryTransferRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findById(scope: CompanyScope, transferId: string): Promise<InventoryTransfer | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM inventory_transfers WHERE tenant_id = ? AND company_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, transferId) as InventoryTransferRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async findLines(scope: CompanyScope, transferId: string): Promise<readonly InventoryTransferLine[]> {
    const rows = this.database.native
      .prepare(`SELECT l.* FROM inventory_transfer_lines l JOIN inventory_transfers t ON t.id = l.transfer_id WHERE t.tenant_id = ? AND t.company_id = ? AND l.transfer_id = ?`)
      .all(scope.tenantId, scope.companyId, transferId) as InventoryTransferLineRow[];
    return rows.map((row) => this.lineToDomain(row));
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.findLogged(scope, "REQUEST", idempotencyKey);
  }

  async save(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const run = this.database.native.transaction(() => {
      this.insertTransfer(transfer, now);
      for (const line of lines) this.insertLine(line, transfer.scope.tenantId);
      this.insertLog(transfer, lines, "REQUEST", idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed request idempotency_key for tenant ${transfer.scope.tenantId}`);
      }
      throw error;
    }
  }

  async findDispatchByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.findLogged(scope, "DISPATCH", idempotencyKey);
  }

  async saveDispatch(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    await this.saveMutation(transfer, lines, "DISPATCH", idempotencyKey);
  }

  async findReceiptByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.findLogged(scope, "RECEIPT", idempotencyKey);
  }

  async saveReceipt(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    await this.saveMutation(transfer, lines, "RECEIPT", idempotencyKey);
  }

  async findCancellationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.findLogged(scope, "CANCELLATION", idempotencyKey);
  }

  async saveCancellation(transfer: InventoryTransfer, idempotencyKey: string): Promise<void> {
    await this.saveMutation(transfer, [], "CANCELLATION", idempotencyKey);
  }

  private async saveMutation(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], operation: "DISPATCH" | "RECEIPT" | "CANCELLATION", idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const priorVersion = transfer.version - 1;
    const run = this.database.native.transaction(() => {
      const result = this.database.native
        .prepare(
          `UPDATE inventory_transfers SET
             status = ?, approved_by_actor_type = ?, approved_by_actor_id = ?,
             dispatched_by_actor_type = ?, dispatched_by_actor_id = ?,
             received_by_actor_type = ?, received_by_actor_id = ?,
             approved_at = ?, dispatched_at = ?, received_at = ?,
             cancelled_at = ?, cancellation_reason = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          transfer.status,
          transfer.approvedBy?.type ?? null, transfer.approvedBy?.id ?? null,
          transfer.dispatchedBy?.type ?? null, transfer.dispatchedBy?.id ?? null,
          transfer.receivedBy?.type ?? null, transfer.receivedBy?.id ?? null,
          transfer.approvedAt?.toISOString() ?? null, transfer.dispatchedAt?.toISOString() ?? null, transfer.receivedAt?.toISOString() ?? null,
          transfer.cancelledAt?.toISOString() ?? null, transfer.cancellationReason, transfer.version, now,
          transfer.id, priorVersion,
        );
      if (result.changes === 0) {
        throw new InventoryTransferConflictError(`transfer ${transfer.id} version moved before this ${operation.toLowerCase()} could be saved (expected prior version ${priorVersion})`);
      }
      for (const line of lines) {
        this.database.native
          .prepare(`UPDATE inventory_transfer_lines SET dispatched_quantity = ?, received_quantity = ? WHERE id = ?`)
          .run(line.dispatchedQuantity.toString(), line.receivedQuantity.toString(), line.id);
      }
      const allLines = this.database.native
        .prepare(`SELECT * FROM inventory_transfer_lines WHERE transfer_id = ?`)
        .all(transfer.id) as InventoryTransferLineRow[];
      this.insertLog(transfer, allLines.map((row) => this.lineToDomain(row)), operation, idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (error instanceof InventoryTransferConflictError) throw error;
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed ${operation} idempotency_key for transfer ${transfer.id}`);
      }
      throw error;
    }
  }

  private insertTransfer(transfer: InventoryTransfer, now: string): void {
    this.database.native
      .prepare(
        `INSERT INTO inventory_transfers (
          id, tenant_id, company_id, source_branch_id, source_location_id, destination_branch_id, destination_location_id,
          status, requested_by_actor_type, requested_by_actor_id, approved_by_actor_type, approved_by_actor_id,
          dispatched_by_actor_type, dispatched_by_actor_id, received_by_actor_type, received_by_actor_id,
          requested_at, approved_at, dispatched_at, received_at, cancelled_at, cancellation_reason,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        transfer.id, transfer.scope.tenantId, transfer.scope.companyId, transfer.sourceBranchId, transfer.sourceLocationId,
        transfer.destinationBranchId, transfer.destinationLocationId, transfer.status,
        transfer.requestedBy.type, transfer.requestedBy.id,
        transfer.approvedBy?.type ?? null, transfer.approvedBy?.id ?? null,
        transfer.dispatchedBy?.type ?? null, transfer.dispatchedBy?.id ?? null,
        transfer.receivedBy?.type ?? null, transfer.receivedBy?.id ?? null,
        transfer.requestedAt.toISOString(), transfer.approvedAt?.toISOString() ?? null, transfer.dispatchedAt?.toISOString() ?? null,
        transfer.receivedAt?.toISOString() ?? null, transfer.cancelledAt?.toISOString() ?? null, transfer.cancellationReason,
        transfer.version, now, now,
      );
  }

  private insertLine(line: InventoryTransferLine, tenantId: string): void {
    this.database.native
      .prepare(
        `INSERT INTO inventory_transfer_lines (id, tenant_id, transfer_id, presentation_id, lot_id, requested_quantity, dispatched_quantity, received_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(line.id, tenantId, line.transferId, line.presentationId, line.lotId, line.requestedQuantity.toString(), line.dispatchedQuantity.toString(), line.receivedQuantity.toString());
  }

  private insertLog(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], operation: "REQUEST" | "DISPATCH" | "RECEIPT" | "CANCELLATION", idempotencyKey: string, now: string): void {
    this.database.native
      .prepare(
        `INSERT INTO inventory_transfer_mutation_log (id, tenant_id, company_id, operation, idempotency_key, transfer_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), transfer.scope.tenantId, transfer.scope.companyId, operation, idempotencyKey, transfer.id, JSON.stringify(this.toSnapshot(transfer, lines)), now);
  }

  private findLogged(scope: CompanyScope, operation: "REQUEST" | "DISPATCH" | "RECEIPT" | "CANCELLATION", idempotencyKey: string): InventoryTransfer | null {
    const row = this.database.native
      .prepare(`SELECT snapshot_json FROM inventory_transfer_mutation_log WHERE tenant_id = ? AND company_id = ? AND operation = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, operation, idempotencyKey) as MutationLogRow | undefined;
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as TransferSnapshot;
    return this.fromSnapshot(snapshot);
  }

  private toSnapshot(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[]): TransferSnapshot {
    return {
      transfer: {
        id: transfer.id, tenantId: transfer.scope.tenantId, companyId: transfer.scope.companyId,
        sourceBranchId: transfer.sourceBranchId, sourceLocationId: transfer.sourceLocationId,
        destinationBranchId: transfer.destinationBranchId, destinationLocationId: transfer.destinationLocationId,
        status: transfer.status,
        requestedByActorType: transfer.requestedBy.type, requestedByActorId: transfer.requestedBy.id,
        approvedByActorType: transfer.approvedBy?.type ?? null, approvedByActorId: transfer.approvedBy?.id ?? null,
        dispatchedByActorType: transfer.dispatchedBy?.type ?? null, dispatchedByActorId: transfer.dispatchedBy?.id ?? null,
        receivedByActorType: transfer.receivedBy?.type ?? null, receivedByActorId: transfer.receivedBy?.id ?? null,
        requestedAt: transfer.requestedAt.toISOString(), approvedAt: transfer.approvedAt?.toISOString() ?? null,
        dispatchedAt: transfer.dispatchedAt?.toISOString() ?? null, receivedAt: transfer.receivedAt?.toISOString() ?? null,
        cancelledAt: transfer.cancelledAt?.toISOString() ?? null, cancellationReason: transfer.cancellationReason,
        version: transfer.version,
      },
      lines: lines.map((line) => ({
        id: line.id, transferId: line.transferId, presentationId: line.presentationId, lotId: line.lotId,
        requestedQuantity: line.requestedQuantity.toString(), dispatchedQuantity: line.dispatchedQuantity.toString(), receivedQuantity: line.receivedQuantity.toString(),
      })),
    };
  }

  private fromSnapshot(snapshot: TransferSnapshot): InventoryTransfer {
    const t = snapshot.transfer;
    return InventoryTransfer.restore({
      id: t.id,
      scope: new CompanyScope(t.tenantId, t.companyId),
      sourceBranchId: t.sourceBranchId,
      sourceLocationId: t.sourceLocationId,
      destinationBranchId: t.destinationBranchId,
      destinationLocationId: t.destinationLocationId,
      status: t.status,
      requestedBy: Actor.restore(t.requestedByActorType, t.requestedByActorId),
      approvedBy: t.approvedByActorType && t.approvedByActorId ? Actor.restore(t.approvedByActorType, t.approvedByActorId) : null,
      dispatchedBy: t.dispatchedByActorType && t.dispatchedByActorId ? Actor.restore(t.dispatchedByActorType, t.dispatchedByActorId) : null,
      receivedBy: t.receivedByActorType && t.receivedByActorId ? Actor.restore(t.receivedByActorType, t.receivedByActorId) : null,
      requestedAt: new Date(t.requestedAt),
      approvedAt: t.approvedAt ? new Date(t.approvedAt) : null,
      dispatchedAt: t.dispatchedAt ? new Date(t.dispatchedAt) : null,
      receivedAt: t.receivedAt ? new Date(t.receivedAt) : null,
      cancelledAt: t.cancelledAt ? new Date(t.cancelledAt) : null,
      cancellationReason: t.cancellationReason,
      version: t.version,
    });
  }

  private toDomain(row: InventoryTransferRow): InventoryTransfer {
    return InventoryTransfer.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      sourceBranchId: row.source_branch_id,
      sourceLocationId: row.source_location_id,
      destinationBranchId: row.destination_branch_id,
      destinationLocationId: row.destination_location_id,
      status: row.status as InventoryTransferStatus,
      requestedBy: Actor.restore(row.requested_by_actor_type as ActorType, row.requested_by_actor_id),
      approvedBy: row.approved_by_actor_type && row.approved_by_actor_id ? Actor.restore(row.approved_by_actor_type as ActorType, row.approved_by_actor_id) : null,
      dispatchedBy: row.dispatched_by_actor_type && row.dispatched_by_actor_id ? Actor.restore(row.dispatched_by_actor_type as ActorType, row.dispatched_by_actor_id) : null,
      receivedBy: row.received_by_actor_type && row.received_by_actor_id ? Actor.restore(row.received_by_actor_type as ActorType, row.received_by_actor_id) : null,
      requestedAt: new Date(row.requested_at),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at) : null,
      receivedAt: row.received_at ? new Date(row.received_at) : null,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
      cancellationReason: row.cancellation_reason,
      version: row.version,
    });
  }

  private lineToDomain(row: InventoryTransferLineRow): InventoryTransferLine {
    return InventoryTransferLine.restore({
      id: row.id,
      transferId: row.transfer_id,
      presentationId: row.presentation_id,
      lotId: row.lot_id,
      requestedQuantity: Quantity.fromString(row.requested_quantity),
      dispatchedQuantity: Quantity.fromString(row.dispatched_quantity),
      receivedQuantity: Quantity.fromString(row.received_quantity),
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
