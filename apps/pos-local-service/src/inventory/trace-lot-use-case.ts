import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { LOT_TRACE_MAX_OUTFLOWS } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { PERMISSION_INVENTORY_STOCK_READ } from "./get-stock-use-case.js";
import type { LotTrace, SqliteInventoryStore } from "./sqlite-inventory-store.js";

export type TraceLotResult =
  | ({ readonly kind: "FOUND" } & LotTrace)
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Rastro de un lote — `UC-INVENTORY-002` §Lotes regla 2.
 *
 * Es una lectura, y va con el permiso de leer existencia: quien puede ver
 * cuánto hay puede ver por dónde salió. No se inventa un permiso nuevo —dejaría
 * sin rastro a todo comercio ya configurado hasta reconciliar sus roles, que
 * es justo cuando un retiro sanitario no puede esperar—.
 *
 * La sucursal es la del contexto autorizado. El código de lote lo teclea el
 * operador; buscarlo sólo por tenant devolvería la tanda de otra sucursal.
 */
export class TraceLotUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    presentationId: string,
    lotCode: string,
    at: Date = new Date(),
  ): TraceLotResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_INVENTORY_STOCK_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const trace = this.inventoryStore.traceLot(
      scope.tenantId, scope.branchId, presentationId, lotCode, LOT_TRACE_MAX_OUTFLOWS,
    );
    return trace === null ? { kind: "NOT_FOUND" } : { kind: "FOUND", ...trace };
  }
}
