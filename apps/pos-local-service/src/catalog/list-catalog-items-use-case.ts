import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SellableCatalogItem, SqliteCatalogStore } from "./sqlite-catalog-store.js";

export const PERMISSION_CATALOG_PRODUCT_READ = "CATALOG_PRODUCT_READ";

export interface ListCatalogItemsRequest {
  readonly query: string;
  readonly limit: number;
  readonly offset: number;
}

export type ListCatalogItemsResult =
  | { readonly kind: "FOUND"; readonly items: readonly SellableCatalogItem[]; readonly hasMore: boolean }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

export class ListCatalogItemsUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ListCatalogItemsRequest,
    at: Date = new Date(),
  ): ListCatalogItemsResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_CATALOG_PRODUCT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const result = this.catalogStore.listSellableItems(
      { tenantId: scope.tenantId, companyId: scope.companyId },
      request.query,
      request.limit,
      request.offset,
    );
    return { kind: "FOUND", ...result };
  }
}
