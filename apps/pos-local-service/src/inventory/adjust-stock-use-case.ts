import { createHash, randomUUID } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { uuidV7, CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type {
  AppendMovementOutcome,
  InventoryMovementType,
  SqliteInventoryStore,
} from "./sqlite-inventory-store.js";

export const PERMISSION_INVENTORY_STOCK_ADJUST = CanonicalPermission.INVENTORY_STOCK_ADJUST;

/**
 * Movimientos que **corrigen** la existencia en lugar de reflejar una compra.
 *
 * Es la vía por la que se roba en un POS: quien puede ajustar puede hacer
 * desaparecer mercancía sin que falte dinero en caja. Por eso va con permiso
 * propio, motivo obligatorio y rastro con actor — los tres, no dos.
 */
export type AdjustMovementType = Extract<
  InventoryMovementType,
  "ADJUSTMENT_POSITIVE" | "ADJUSTMENT_NEGATIVE" | "SHRINKAGE" | "TRANSFER_OUT"
>;

export interface AdjustStockRequest {
  readonly presentationId: string;
  readonly movementType: AdjustMovementType;
  /** TEXT a escala 6, mayor que cero. El signo lo da el tipo, no la cantidad. */
  readonly quantity: string;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type AdjustStockResult =
  | AppendMovementOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(
  request: AdjustStockRequest,
  operatorUserId: string,
  branchId: string,
): string {
  return createHash("sha256")
    .update(canonicalJson({
      branch_id: branchId,
      business_date: request.businessDate,
      idempotency_key: request.idempotencyKey,
      movement_type: request.movementType,
      operator_user_id: operatorUserId,
      presentation_id: request.presentationId,
      quantity: request.quantity,
      reason_code: request.reasonCode,
    }))
    .digest("hex");
}

/** Ajustar existencia: corrección, merma o traslado enviado. */
export class AdjustStockUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: AdjustStockRequest,
    at: Date = new Date(),
  ): AdjustStockResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_INVENTORY_STOCK_ADJUST,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.inventoryStore.appendMovementInTransaction({
      scope,
      sessionId,
      operatorUserId,
      movementId: randomUUID(),
      operationId: uuidV7(),
      presentationId: request.presentationId,
      movementType: request.movementType,
      quantity: request.quantity,
      reasonCode: request.reasonCode,
      saleId: null,
      businessDate: request.businessDate,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId, scope.branchId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
