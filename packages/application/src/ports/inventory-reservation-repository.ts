import type { InventoryReservation, TenantScope } from "@pos-platform/domain";

/**
 * B32. Mirrors `ProductRepository`'s granular-idempotency-namespace-per-
 * mutation shape: `InventoryReservation` has three distinct mutations
 * (create/consume/release) touching the same row, same posture as
 * Product's create/update/deactivate split. No SQLite/PostgreSQL adapter
 * implements this — DDL gate is NO-GO for Inventory.
 */
export interface InventoryReservationRepository {
  findById(scope: TenantScope, reservationId: string): Promise<InventoryReservation | null>;

  findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null>;
  save(reservation: InventoryReservation, idempotencyKey: string): Promise<void>;

  findConsumptionByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null>;
  saveConsumption(reservation: InventoryReservation, idempotencyKey: string): Promise<void>;

  findReleaseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null>;
  saveRelease(reservation: InventoryReservation, idempotencyKey: string): Promise<void>;

  /**
   * Every reservation for the same key, regardless of status — feeds
   * `StockBalance.compute`, which derives outstanding capacity from
   * `outstandingQuantity()` itself (zero for `RELEASED`/`CONSUMED`, still
   * positive for `EXPIRED` until an explicit release). Do not pre-filter
   * by status here; that would have to independently track which
   * statuses still hold capacity instead of leaving it to the quantity
   * math.
   */
  listOutstanding(scope: TenantScope, inventoryLocationId: string, presentationId: string, lotId: string | null): Promise<readonly InventoryReservation[]>;
}
