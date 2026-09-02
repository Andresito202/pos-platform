import type { Actor, TenantScope } from "@pos-platform/domain";

export interface InventoryAuthorizationPort {
  canAdjustInventory(actor: Actor, scope: TenantScope): Promise<boolean>;
}
