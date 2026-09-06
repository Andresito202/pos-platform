import type { CompanyScope, InventoryTransfer, InventoryTransferLine } from "@pos-platform/domain";

/**
 * B32. `InventoryTransfer` + its `InventoryTransferLine`s always cross a
 * transactional boundary together (request/dispatch/receive all touch
 * both), same reasoning `CashShiftRepository` used for shift+count+review
 * — one port, lines passed alongside the transfer at each mutation. No
 * SQLite/PostgreSQL adapter implements this — DDL gate is NO-GO.
 */
export interface InventoryTransferRepository {
  findById(scope: CompanyScope, transferId: string): Promise<InventoryTransfer | null>;
  findLines(scope: CompanyScope, transferId: string): Promise<readonly InventoryTransferLine[]>;

  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null>;
  save(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void>;

  findDispatchByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null>;
  saveDispatch(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void>;

  findReceiptByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null>;
  saveReceipt(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void>;

  findCancellationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null>;
  saveCancellation(transfer: InventoryTransfer, idempotencyKey: string): Promise<void>;
}
