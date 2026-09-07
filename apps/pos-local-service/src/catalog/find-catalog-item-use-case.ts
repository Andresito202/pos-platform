import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { CatalogItem, SqliteCatalogStore } from "./sqlite-catalog-store.js";

export const PERMISSION_CATALOG_PRODUCT_READ = "CATALOG_PRODUCT_READ";

/**
 * Dos formas de buscar, y son las dos que ocurren en un mostrador: se escanea
 * un código de barras, o se recupera una presentación que ya se conoce.
 */
export type FindCatalogItemRequest =
  | { readonly by: "BARCODE"; readonly barcode: string }
  | { readonly by: "PRESENTATION"; readonly presentationId: string };

export type FindCatalogItemResult =
  | { readonly kind: "FOUND"; readonly item: CatalogItem }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

export class FindCatalogItemUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: FindCatalogItemRequest,
    at: Date = new Date(),
  ): FindCatalogItemResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_CATALOG_PRODUCT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const catalogScope = { tenantId: scope.tenantId, companyId: scope.companyId };
    const item = request.by === "BARCODE"
      ? this.catalogStore.findByBarcode(catalogScope, request.barcode)
      : this.catalogStore.findItemByPresentation(catalogScope, request.presentationId);

    return item === null ? { kind: "NOT_FOUND" } : { kind: "FOUND", item };
  }
}
