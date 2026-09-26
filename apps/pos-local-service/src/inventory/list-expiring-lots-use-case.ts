import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { LOT_EXPIRING_MAX, NEAR_EXPIRY_DAYS } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { PERMISSION_INVENTORY_STOCK_READ } from "./get-stock-use-case.js";
import { addCalendarDays, lotExpiryState } from "./receive-lot-use-case.js";
import type { ExpiringLotRow, SqliteInventoryStore } from "./sqlite-inventory-store.js";

export type ListExpiringLotsResult =
  | {
      readonly kind: "LISTED";
      readonly nearExpiryDays: number;
      readonly lots: readonly (ExpiringLotRow & { readonly expiryState: "NEAR_EXPIRY" | "EXPIRED" })[];
      readonly truncated: boolean;
    }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Lo que vence esta semana en toda la sucursal — `UC-INVENTORY-002`
 * §Vencimientos regla 3.
 *
 * Es lectura y va con el permiso de leer existencia, como el rastro. El
 * horizonte es la fecha de negocio más `NEAR_EXPIRY_DAYS` —la misma frontera
 * que `lotExpiryState`, que es quien pone el estado a cada fila—: una tanda
 * sale aquí si y sólo si la lista por producto la marcaría `NEAR_EXPIRY` o
 * `EXPIRED`.
 */
export class ListExpiringLotsUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    businessDate: string,
    at: Date = new Date(),
  ): ListExpiringLotsResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_INVENTORY_STOCK_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const horizon = addCalendarDays(businessDate, NEAR_EXPIRY_DAYS);
    const found = this.inventoryStore.listExpiringLots(
      scope.tenantId, scope.branchId, horizon, LOT_EXPIRING_MAX,
    );
    return {
      kind: "LISTED",
      nearExpiryDays: NEAR_EXPIRY_DAYS,
      lots: found.lots.map((lot) => ({
        ...lot,
        // El horizonte ya excluye lo vigente y lo que no vence: sólo quedan dos.
        expiryState: lotExpiryState(lot.expiryDate, businessDate) === "EXPIRED" ? "EXPIRED" : "NEAR_EXPIRY",
      })),
      truncated: found.truncated,
    };
  }
}
