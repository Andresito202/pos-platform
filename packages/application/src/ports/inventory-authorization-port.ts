import type { Actor, CompanyScope, TenantScope } from "@pos-platform/domain";

export interface InventoryAuthorizationPort {
  canAdjustInventory(actor: Actor, scope: TenantScope): Promise<boolean>;
  canRegisterWaste(actor: Actor, scope: TenantScope): Promise<boolean>;
  /** `InventoryTransfer` is `CompanyScope`-keyed (spans branches) — see `inventory-transfer.ts`'s own doc comment. */
  canTransferInventory(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canReserveInventory(actor: Actor, scope: TenantScope): Promise<boolean>;
  canConsumeInventoryReservation(actor: Actor, scope: TenantScope): Promise<boolean>;
  canReleaseInventoryReservation(actor: Actor, scope: TenantScope): Promise<boolean>;
}
