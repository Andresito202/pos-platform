import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteSaleStore } from "./sqlite-sale-store.js";

export const PERMISSION_SALES_SALE_CANCEL = CanonicalPermission.SALES_SALE_CANCEL;

export interface CancelSaleRequest {
  readonly saleId: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type CancelSaleResult =
  | { readonly kind: "CANCELLED"; readonly saleId: string; readonly released: number }
  | { readonly kind: "IDEMPOTENT"; readonly saleId: string; readonly released: number }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "CONFLICT"; readonly status: string }
  | { readonly kind: "CONFIRMED_COVERAGE_REQUIRES_RECONCILIATION" }
  | { readonly kind: "PENDING_PAYMENTS_MUST_CANCEL" };

function requestChecksum(request: CancelSaleRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      reason_code: request.reasonCode,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

/**
 * Authorized recovery for unpaid sales blocked by inventory (e.g. lot expired
 * after reservation). Releases SALE holds only after the sale is CANCELLED.
 */
export class CancelSaleUseCase {
  constructor(
    private readonly saleStore: SqliteSaleStore,
    private readonly inventoryStore: SqliteInventoryStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: CancelSaleRequest,
  ): CancelSaleResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_SALES_SALE_CANCEL,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    let releasedCount = 0;
    const outcome = this.saleStore.cancelReadyForPayment({
      scope,
      saleId: request.saleId,
      operatorUserId,
      sessionId,
      correlationId: request.correlationId,
      causationId: request.causationId,
      reasonCode: request.reasonCode,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      releaseHolds: (saleId) => {
        const freed = this.inventoryStore.releaseReservationsBoundToSale({
          scope,
          sessionId,
          actorId: operatorUserId,
          saleId,
          reasonCode: "SALE_CANCELLED",
          correlationId: request.correlationId,
          causationId: request.causationId,
        });
        if (freed.kind === "CONFLICT") {
          throw new Error(`RESERVATION_RELEASE_FAILED:${freed.reason}`);
        }
        if (freed.kind === "NOT_FOUND") {
          throw new Error("RESERVATION_RELEASE_SALE_MISSING");
        }
        releasedCount = freed.released;
      },
    });

    if (outcome.kind === "CANCELLED") {
      return { kind: "CANCELLED", saleId: outcome.saleId, released: releasedCount };
    }
    if (outcome.kind === "IDEMPOTENT") {
      return { kind: "IDEMPOTENT", saleId: outcome.saleId, released: 0 };
    }
    if (outcome.kind === "CONFLICT" && outcome.status === "IDEMPOTENCY_CONFLICT") {
      return { kind: "IDEMPOTENCY_CONFLICT" };
    }
    return outcome;
  }
}
