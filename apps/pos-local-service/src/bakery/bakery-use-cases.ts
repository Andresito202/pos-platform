import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { RecipeLineInput, SqliteBakeryStore } from "./sqlite-bakery-store.js";

function authorized(
  scope: SyncScope,
  snapshot: StoredAuthorizationSnapshot,
  permission: string,
  at: Date,
): boolean {
  return evaluatePermission({
    actor: createActor("USER", snapshot.claims.user_id),
    permission,
    scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
    at,
    assignments: toRoleAssignments(snapshot.claims),
  }).allowed;
}

export const PERMISSION_BAKERY_RECIPE_MANAGE = CanonicalPermission.BAKERY_RECIPE_MANAGE;
export const PERMISSION_BAKERY_PRODUCTION_EXECUTE = CanonicalPermission.BAKERY_PRODUCTION_EXECUTE;
export const PERMISSION_BAKERY_PRODUCTION_READ = CanonicalPermission.BAKERY_PRODUCTION_READ;

export class UpsertBakeryIngredientProfileUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      purchasePresentationId: string;
      consumptionUnitCode: string;
      consumptionUnitPrecision: number;
      approvedConversionFactor: string | null;
      approvedConversionFromUnit: string | null;
      approvedConversionToUnit: string | null;
      conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
      requiresLotTracking: boolean;
      requiresExpiry: boolean;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_RECIPE_MANAGE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, company_id: scope.companyId, branch_id: scope.branchId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.upsertIngredientProfile({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class UpsertBakeryFinishedPolicyUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      shelfLifeDays: number;
      conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
      releaseRequired: boolean;
      policyBasis: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_RECIPE_MANAGE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, company_id: scope.companyId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.upsertFinishedPolicy({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class CreateBakeryRecipeDraftUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      recipeFamilyId: string | null;
      name: string;
      finishedProductId: string;
      finishedPresentationId: string;
      baseBatchQuantity: string;
      expectedYieldQuantity: string;
      expectedShrinkageQuantity: string;
      canonicalMassUnit: "G" | "KG" | null;
      instructions: string | null;
      lines: ReadonlyArray<RecipeLineInput>;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_RECIPE_MANAGE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, company_id: scope.companyId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.createRecipeDraft({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class ApproveBakeryRecipeUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      recipeId: string;
      expectedVersion: number;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_RECIPE_MANAGE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.approveRecipe({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class RecordBakeryLotAcquisitionCostUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      lotId: string;
      unitCostAmount: string;
      currencyCode: string;
      sourceKind: "GOODS_RECEIPT" | "MANUAL_AUTHORIZED" | "PRODUCTION_TRANSFER";
      sourceDocument: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    // Cost facts are inventory acquisition records; bakery execute may read them.
    // Recording requires bakery production execute OR inventory receive — not catalog price.
    const ok = authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)
      || authorized(scope, authSnapshot, CanonicalPermission.INVENTORY_STOCK_RECEIVE, at);
    if (!ok) return { kind: "UNAUTHORIZED" as const };
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.recordLotAcquisitionCost({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class CreateBakeryProductionOrderUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      recipeId: string;
      plannedQuantity: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.createProductionOrder({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class PlanBakeryProductionOrderUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: { orderId: string; correlationId: string; causationId: string | null },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    return this.store.planProductionOrder({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request,
    });
  }
}

export class CancelBakeryProductionOrderUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: { orderId: string; correlationId: string; causationId: string | null },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    return this.store.cancelProductionOrder({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request,
    });
  }
}

export class ConfirmBakeryProductionUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      orderId: string;
      actualQuantity: string;
      shrinkageQuantity: string;
      shrinkageReason: string | null;
      productionDate: string;
      finishedBatchCode: string;
      consumptions: ReadonlyArray<{
        ingredientPresentationId: string;
        lotId: string;
        plannedQuantity: string;
        actualQuantity: string;
        massQuantity: string | null;
      }>;
      directCosts: ReadonlyArray<{
        costKind: "LABOR" | "ENERGY" | "PACKAGING" | "OTHER";
        amount: string;
        sourceNote: string;
      }>;
      shrinkageAttributions: ReadonlyArray<{
        presentationId: string;
        lotId: string;
        quantity: string;
        massQuantity: string | null;
      }>;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    // Bakery production posts via inventory transform internally; does NOT grant
    // INVENTORY_STOCK_ADJUST to the operator for arbitrary adjustments.
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.confirmProduction({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class ReleaseBakeryFinishedLotUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      orderId: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request, tenant_id: scope.tenantId, actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.releaseFinishedLot({
      scope, sessionId, operatorUserId: authSnapshot.claims.user_id, ...request, requestChecksum,
    });
  }
}

export class GetBakeryProductionTraceUseCase {
  constructor(private readonly store: SqliteBakeryStore) {}
  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    orderId: string,
    at: Date = new Date(),
  ) {
    const ok = authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_READ, at)
      || authorized(scope, authSnapshot, CanonicalPermission.BAKERY_PRODUCTION_EXECUTE, at);
    if (!ok) return { kind: "UNAUTHORIZED" as const };
    return this.store.getTraceability(scope, orderId);
  }
}
