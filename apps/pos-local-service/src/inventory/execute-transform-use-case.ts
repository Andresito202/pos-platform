import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteInventoryStore, TransformOrderInput } from "./sqlite-inventory-store.js";

/**
 * Multi-output butcher/transform order on the shared inventory ledger.
 * Requires INVENTORY_STOCK_ADJUST. Does not invent stock or percentage yields.
 */
export class ExecuteTransformUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: Omit<TransformOrderInput, "scope" | "sessionId" | "actorId" | "requestChecksum"> & {
      idempotencyKey: string;
    },
    at: Date = new Date(),
  ) {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.INVENTORY_STOCK_ADJUST,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED" as const };

    const requestChecksum = createHash("sha256")
      .update(canonicalJson({
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        branch_id: scope.branchId,
        reason_code: request.reasonCode,
        canonical_mass_unit: request.canonicalMassUnit,
        inputs: request.inputs,
        outputs: request.outputs,
        shrinkage: request.shrinkage,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: request.idempotencyKey,
      }))
      .digest("hex");

    return this.inventoryStore.executeTransform({
      scope,
      sessionId,
      actorId: authSnapshot.claims.user_id,
      reasonCode: request.reasonCode,
      businessDate: request.businessDate,
      canonicalMassUnit: request.canonicalMassUnit,
      inputs: request.inputs,
      outputs: request.outputs,
      shrinkage: request.shrinkage,
      idempotencyKey: request.idempotencyKey,
      requestChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
