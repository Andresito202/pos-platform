import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteInventoryStore } from "./sqlite-inventory-store.js";

/**
 * Manual reservation / release on the ORIGINAL inventory store.
 * Sale create already reserves stock-controlled lines; these use cases cover
 * authorized MANUAL holds and frees outside the payment path (INV-015).
 * P0: releasing a SALE-bound reservation via this IPC path is rejected at the
 * store (`CONFLICT`); Sales CANCELLED/EXPIRED transitions own that release.
 */
export class CreateInventoryReservationUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      presentationId: string;
      quantity: string;
      referenceId: string;
      expiresAt: string | null;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
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
        presentation_id: request.presentationId,
        quantity: request.quantity,
        reference_type: "MANUAL",
        reference_id: request.referenceId,
        expires_at: request.expiresAt,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: request.idempotencyKey,
      }))
      .digest("hex");

    const result = this.inventoryStore.createReservationInTransaction({
      scope,
      sessionId,
      actorId: authSnapshot.claims.user_id,
      presentationId: request.presentationId,
      quantity: request.quantity,
      referenceType: "MANUAL",
      referenceId: request.referenceId,
      idempotencyKey: request.idempotencyKey,
      requestChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
      expiresAt: request.expiresAt,
    });

    if (result.kind === "RESERVED" || result.kind === "IDEMPOTENT") {
      return { kind: result.kind, reservationId: result.reservationId };
    }
    if (result.kind === "INSUFFICIENT_STOCK") {
      return { kind: "INSUFFICIENT_STOCK" as const, available: result.available };
    }
    return { kind: result.kind };
  }
}

export class ReleaseInventoryReservationUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      reservationId: string;
      reasonCode: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
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
        reservation_id: request.reservationId,
        reason_code: request.reasonCode,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: request.idempotencyKey,
      }))
      .digest("hex");

    return {
      kind: this.inventoryStore.releaseReservationInTransaction({
        scope,
        sessionId,
        actorId: authSnapshot.claims.user_id,
        reservationId: request.reservationId,
        reasonCode: request.reasonCode,
        idempotencyKey: request.idempotencyKey,
        requestChecksum,
        correlationId: request.correlationId,
        causationId: request.causationId,
      }),
    };
  }
}
