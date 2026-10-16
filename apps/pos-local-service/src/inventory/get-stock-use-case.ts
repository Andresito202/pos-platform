import { CanonicalPermission } from "@pos-platform/contracts";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { InventoryStock, SqliteInventoryStore } from "./sqlite-inventory-store.js";

export const PERMISSION_INVENTORY_STOCK_READ = CanonicalPermission.INVENTORY_STOCK_READ;

export type GetStockResult =
  | { readonly kind: "FOUND"; readonly stock: InventoryStock }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Consultar la existencia de una presentación en la sucursal de la sesión.
 *
 * `NOT_FOUND` y «cero» no son lo mismo y no se colapsan: una presentación que
 * nunca tuvo movimiento no es una que se agotó, y la diferencia es la que
 * distingue «no lo manejamos» de «hay que reponer».
 */
export class GetStockUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    presentationId: string,
    at: Date = new Date(),
  ): GetStockResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_INVENTORY_STOCK_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const stock = this.inventoryStore.getStock(scope, presentationId);
    return stock === null ? { kind: "NOT_FOUND" } : { kind: "FOUND", stock };
  }
}
