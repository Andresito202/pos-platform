import type { InventoryMovement, TenantScope } from "@pos-platform/domain";

/**
 * No SQLite/PostgreSQL adapter implements this — same DDL NO-GO gate as
 * every other repository in this project (inventory-schema.md itself is
 * documentally CLOSED but carries no DDL authorization). This port exists
 * so RegisterInventoryAdjustmentUseCase is a real, testable use case today.
 */
export interface InventoryMovementRepository {
  findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryMovement | null>;

  listPostedMovements(
    scope: TenantScope,
    inventoryLocationId: string,
    presentationId: string,
    lotId: string | null,
  ): Promise<readonly InventoryMovement[]>;

  save(movement: InventoryMovement, idempotencyKey: string): Promise<void>;
}
