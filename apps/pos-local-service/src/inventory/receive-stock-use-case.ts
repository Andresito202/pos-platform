import { createHash, randomUUID } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { uuidV7, PermissionCode } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type {
  AppendMovementOutcome,
  InventoryMovementType,
  SqliteInventoryStore,
} from "./sqlite-inventory-store.js";

export const PERMISSION_INVENTORY_STOCK_RECEIVE = PermissionCode.INVENTORY_STOCK_RECEIVE;

/**
 * Entradas de existencia que **no** son un ajuste.
 *
 * Recibir mercancía es rutina de cualquier tienda; ajustar es corregir la
 * verdad. Separarlos en dos permisos es deliberado: el cajero que recibe el
 * pedido del proveedor no tiene por qué poder cuadrar el inventario a mano.
 */
export type ReceiveMovementType = Extract<
  InventoryMovementType,
  "OPENING_COUNT" | "PURCHASE_RECEIPT" | "TRANSFER_IN"
>;

export interface ReceiveStockRequest {
  readonly presentationId: string;
  readonly movementType: ReceiveMovementType;
  /** TEXT a escala 6, mayor que cero. */
  readonly quantity: string;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ReceiveStockResult =
  | AppendMovementOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(
  request: ReceiveStockRequest,
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

/** Dar entrada a existencia: conteo inicial, recepción de compra o traslado recibido. */
export class ReceiveStockUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ReceiveStockRequest,
    at: Date = new Date(),
  ): ReceiveStockResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_INVENTORY_STOCK_RECEIVE,
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
