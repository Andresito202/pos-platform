import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission, uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { CatalogFiscalAttribute, SqliteCatalogStore } from "./sqlite-catalog-store.js";

/**
 * Commercial secondary presentation on an EXISTING product.
 * Does not create inventory stock — only catalog + optional price + fiscal.
 */
export class AddPresentationUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      presentationName: string;
      unitCode: string;
      unitPrecision: number;
      barcode: string | null;
      priceAmount: string;
      currencyCode: string;
      fiscalAttributes?: CatalogFiscalAttribute;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED" as const };

    const requestChecksum = createHash("sha256")
      .update(canonicalJson({
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        product_id: request.productId,
        presentation_name: request.presentationName,
        unit_code: request.unitCode,
        unit_precision: request.unitPrecision,
        barcode: request.barcode,
        price_amount: request.priceAmount,
        currency_code: request.currencyCode,
        fiscal_attributes: request.fiscalAttributes ?? null,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: request.idempotencyKey,
      }))
      .digest("hex");

    return this.catalogStore.addPresentation({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      productId: request.productId,
      presentationId: uuidV7(),
      priceId: uuidV7(),
      operationId: uuidV7(),
      presentationName: request.presentationName,
      unitCode: request.unitCode,
      unitPrecision: request.unitPrecision,
      barcode: request.barcode,
      priceAmount: request.priceAmount,
      currencyCode: request.currencyCode,
      ...(request.fiscalAttributes === undefined ? {} : { fiscalAttributes: request.fiscalAttributes }),
      idempotencyKey: request.idempotencyKey,
      requestChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}

export class UpsertFoodPolicyUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
      requiresLotTracking: boolean;
      requiresExpiry: boolean;
      notes: string | null;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED" as const };

    const requestChecksum = createHash("sha256")
      .update(canonicalJson({
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        product_id: request.productId,
        conservation_code: request.conservationCode,
        requires_lot_tracking: request.requiresLotTracking,
        requires_expiry: request.requiresExpiry,
        notes: request.notes,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: request.idempotencyKey,
      }))
      .digest("hex");

    return this.catalogStore.upsertFoodPolicy({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      productId: request.productId,
      conservationCode: request.conservationCode,
      requiresLotTracking: request.requiresLotTracking,
      requiresExpiry: request.requiresExpiry,
      notes: request.notes,
      idempotencyKey: request.idempotencyKey,
      requestChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
