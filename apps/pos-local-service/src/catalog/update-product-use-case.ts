import { createHash, randomUUID } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { CanonicalPermission, uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteCatalogStore } from "./sqlite-catalog-store.js";

export interface UpdateProductRequest {
  readonly productId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly code?: string;
  readonly description?: string | null;
  readonly brand?: string | null;
  readonly category?: string | null;
  readonly status?: "ACTIVE" | "INACTIVE";
  readonly presentationId?: string;
  readonly presentationExpectedVersion?: number;
  readonly presentationName?: string;
  readonly barcode?: string | null;
  readonly reason?: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type UpdateProductResult =
  | { readonly kind: "UPDATED"; readonly productId: string; readonly version: number; readonly presentationVersion: number | null }
  | { readonly kind: "IDEMPOTENT"; readonly productId: string; readonly version: number; readonly presentationVersion: number | null }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "VERSION_CONFLICT"; readonly currentVersion: number }
  | { readonly kind: "PRESENTATION_VERSION_CONFLICT"; readonly currentVersion: number }
  | { readonly kind: "CODE_ALREADY_REGISTERED"; readonly productId: string }
  | { readonly kind: "BARCODE_ALREADY_REGISTERED"; readonly presentationId: string }
  | { readonly kind: "UNIT_CHANGE_FORBIDDEN" }
  | { readonly kind: "INVALID_INPUT" }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

/**
 * UC-CAT-002 — commercial fields only. Does not change stock, price, unit_code,
 * unit_precision, or invent media bytes.
 */
export class UpdateProductUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: UpdateProductRequest,
    at: Date = new Date(),
  ): UpdateProductResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_PRODUCT_UPDATE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const hasProductChange = request.name !== undefined
      || request.code !== undefined
      || request.description !== undefined
      || request.brand !== undefined
      || request.category !== undefined
      || request.status !== undefined;
    const hasPresentationChange = request.presentationName !== undefined
      || request.barcode !== undefined;
    if (!hasProductChange && !hasPresentationChange) return { kind: "INVALID_INPUT" };
    if (hasPresentationChange && (request.presentationId === undefined || request.presentationExpectedVersion === undefined)) {
      return { kind: "INVALID_INPUT" };
    }
    if (request.name !== undefined && request.name.trim().length === 0) return { kind: "INVALID_INPUT" };
    if (request.code !== undefined && request.code.trim().length === 0) return { kind: "INVALID_INPUT" };

    const checksum = createHash("sha256").update(canonicalJson({
      barcode: request.barcode ?? null,
      brand: request.brand === undefined ? null : request.brand,
      category: request.category === undefined ? null : request.category,
      code: request.code ?? null,
      description: request.description === undefined ? null : request.description,
      expected_version: request.expectedVersion,
      idempotency_key: request.idempotencyKey,
      name: request.name ?? null,
      presentation_expected_version: request.presentationExpectedVersion ?? null,
      presentation_id: request.presentationId ?? null,
      presentation_name: request.presentationName ?? null,
      product_id: request.productId,
      reason: request.reason ?? null,
      status: request.status ?? null,
    })).digest("hex");

    return this.catalogStore.updateProduct({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      operationId: uuidV7(),
      productId: request.productId,
      expectedVersion: request.expectedVersion,
      ...(request.name !== undefined ? { name: request.name.trim() } : {}),
      ...(request.code !== undefined ? { code: request.code.trim() } : {}),
      ...(request.description !== undefined
        ? { description: request.description?.trim() || null }
        : {}),
      ...(request.brand !== undefined ? { brand: request.brand?.trim() || null } : {}),
      ...(request.category !== undefined ? { category: request.category?.trim() || null } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.presentationId !== undefined ? { presentationId: request.presentationId } : {}),
      ...(request.presentationExpectedVersion !== undefined
        ? { presentationExpectedVersion: request.presentationExpectedVersion }
        : {}),
      ...(request.presentationName !== undefined
        ? { presentationName: request.presentationName.trim() }
        : {}),
      ...(request.barcode !== undefined ? { barcode: request.barcode } : {}),
      reason: request.reason ?? null,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: checksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
