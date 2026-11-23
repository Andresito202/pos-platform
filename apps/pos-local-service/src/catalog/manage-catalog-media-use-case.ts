import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { CatalogMediaStore } from "./catalog-media-store.js";
import type { SqliteCatalogStore } from "./sqlite-catalog-store.js";

export type PutCatalogMediaResult =
  | { readonly kind: "ATTACHED"; readonly mediaId: string | null; readonly productId: string; readonly version: number }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "VERSION_CONFLICT"; readonly currentVersion: number }
  | { readonly kind: "INVALID"; readonly reason: string };

export type GetCatalogMediaResult =
  | {
      readonly kind: "FOUND";
      readonly mediaId: string;
      readonly mimeType: string;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly contentBase64: string;
    }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Stage → confirm → attach. Failures after staging abandon provisional files;
 * failures after confirm retire unattached ACTIVE rows so no orphan photos remain.
 */
export class ManageCatalogMediaUseCase {
  constructor(
    private readonly catalogStore: SqliteCatalogStore,
    private readonly mediaStore: CatalogMediaStore,
  ) {}

  put(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    input: {
      readonly productId: string;
      readonly expectedVersion: number;
      readonly contentBase64: string;
    },
    at: Date = new Date(),
  ): PutCatalogMediaResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_MEDIA_MANAGE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.contentBase64, "base64");
    } catch {
      return { kind: "INVALID", reason: "IMAGE_BASE64_INVALID" };
    }
    if (bytes.length === 0) return { kind: "INVALID", reason: "IMAGE_SIZE_INVALID" };

    // Preflight concurrency — avoid writing when the product cannot attach.
    // Re-checked again inside attachPrimaryMedia under the writer path.
    const product = this.catalogStore.findActiveProduct(scope, input.productId);
    if (product === null) return { kind: "NOT_FOUND" };
    if (product.version !== input.expectedVersion) {
      return { kind: "VERSION_CONFLICT", currentVersion: product.version };
    }

    const staged = this.mediaStore.stage({
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      actorId: authSnapshot.claims.user_id,
      bytes,
    });
    if (staged.kind === "INVALID") return { kind: "INVALID", reason: staged.reason };

    const previousMediaId = product.primaryMediaId;

    const confirmed = this.mediaStore.confirmStaged(staged.staged);
    if (confirmed.kind === "INVALID") {
      this.mediaStore.abandonStaged(staged.staged);
      return { kind: "INVALID", reason: confirmed.reason };
    }

    const attached = this.catalogStore.attachPrimaryMedia({
      scope,
      productId: input.productId,
      expectedVersion: input.expectedVersion,
      mediaId: confirmed.media.id,
      operatorUserId: authSnapshot.claims.user_id,
    });

    if (attached.kind !== "ATTACHED") {
      // Product did not take the reference — retire the just-confirmed row and
      // reclaim the file when unshared.
      this.mediaStore.retire(scope.tenantId, scope.companyId, confirmed.media.id);
      this.mediaStore.reclaimOrphans({
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        mediaId: confirmed.media.id,
      });
      return attached;
    }

    if (previousMediaId !== null && previousMediaId !== confirmed.media.id) {
      this.mediaStore.retire(scope.tenantId, scope.companyId, previousMediaId);
    }

    return {
      kind: "ATTACHED",
      mediaId: confirmed.media.id,
      productId: input.productId,
      version: attached.version,
    };
  }

  clear(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    input: { readonly productId: string; readonly expectedVersion: number },
    at: Date = new Date(),
  ): PutCatalogMediaResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_MEDIA_MANAGE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const cleared = this.catalogStore.clearPrimaryMedia({
      scope,
      productId: input.productId,
      expectedVersion: input.expectedVersion,
      operatorUserId: authSnapshot.claims.user_id,
      retireMedia: (mediaId) => this.mediaStore.retire(scope.tenantId, scope.companyId, mediaId),
    });
    if (cleared.kind !== "ATTACHED") return cleared;
    return {
      kind: "ATTACHED",
      mediaId: null,
      productId: input.productId,
      version: cleared.version,
    };
  }

  get(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    mediaId: string,
    at: Date = new Date(),
  ): GetCatalogMediaResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_PRODUCT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const loaded = this.mediaStore.getActive(scope.tenantId, scope.companyId, mediaId);
    if (loaded === null) return { kind: "NOT_FOUND" };
    return {
      kind: "FOUND",
      mediaId: loaded.record.id,
      mimeType: loaded.record.mimeType,
      widthPx: loaded.record.widthPx,
      heightPx: loaded.record.heightPx,
      contentBase64: loaded.bytes.toString("base64"),
    };
  }
}
