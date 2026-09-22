import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import { PERMISSION_INVENTORY_STOCK_RECEIVE } from "./receive-stock-use-case.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { LotRow, ReceiveLotOutcome, SqliteInventoryStore } from "./sqlite-inventory-store.js";

/**
 * Recepción con lote y consulta de lotes — `UC-INVENTORY-002` §Lotes.
 *
 * ## Por qué reusa el permiso de recibir
 *
 * Recibir un lote **es** recibir mercancía: el mismo acto, con más datos. Un
 * permiso propio obligaría a sembrarlo en los roles existentes y dejaría a los
 * comercios que ya reciben sin poder recibir por lote hasta que alguien
 * reconciliara sus asignaciones. Quien puede dar entrada a existencia puede
 * declarar de qué tanda es.
 *
 * Ajustar sigue siendo otro permiso, por la razón de siempre: recibir es
 * rutina y ajustar es corregir la verdad.
 */

export interface ReceiveLotRequest {
  readonly presentationId: string;
  readonly lotCode: string;
  readonly quantity: string;
  readonly manufacturedDate: string | null;
  readonly expiryDate: string | null;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ReceiveLotResult =
  | ReceiveLotOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Estado de vencimiento **derivado** de la fecha del negocio.
 *
 * `NEAR_EXPIRY` no se calcula: exige un umbral —tres días, siete, treinta—
 * que es política versionada y **nadie la ha decidido**. Elegir un número aquí
 * sería inventar la política en el sitio donde menos se ve. Lo que sí se puede
 * afirmar sin decidir nada es si ya venció.
 */
export function lotExpiryState(
  expiryDate: string | null,
  businessDate: string,
): "NO_EXPIRY" | "VALID" | "EXPIRED" {
  if (expiryDate === null) return "NO_EXPIRY";
  // Comparación lexicográfica de dos `YYYY-MM-DD`: equivale a la cronológica
  // y no depende de husos. Vence AL FINAL del día declarado, de modo que un
  // lote con vencimiento hoy todavía se puede vender hoy.
  return expiryDate < businessDate ? "EXPIRED" : "VALID";
}

export class ReceiveLotUseCase {
  constructor(private readonly inventoryStore: SqliteInventoryStore) {}

  private authorize(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    at: Date,
  ): { readonly kind: "UNAUTHORIZED"; readonly reason: string } | null {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_INVENTORY_STOCK_RECEIVE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    return decision.allowed ? null : { kind: "UNAUTHORIZED", reason: decision.reason };
  }

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ReceiveLotRequest,
    at: Date = new Date(),
  ): ReceiveLotResult {
    const denied = this.authorize(scope, authSnapshot, at);
    if (denied !== null) return denied;

    return this.inventoryStore.receiveLot({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      presentationId: request.presentationId,
      lotCode: request.lotCode,
      quantity: request.quantity,
      manufacturedDate: request.manufacturedDate,
      expiryDate: request.expiryDate,
      reasonCode: request.reasonCode,
      businessDate: request.businessDate,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: createHash("sha256")
        .update(canonicalJson({
          branch_id: scope.branchId,
          business_date: request.businessDate,
          expiry_date: request.expiryDate,
          idempotency_key: request.idempotencyKey,
          lot_code: request.lotCode,
          manufactured_date: request.manufacturedDate,
          operator_user_id: authSnapshot.claims.user_id,
          presentation_id: request.presentationId,
          quantity: request.quantity,
          reason_code: request.reasonCode,
        }))
        .digest("hex"),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }

  list(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    presentationId: string,
    at: Date = new Date(),
  ): { readonly kind: "LISTED"; readonly lots: readonly LotRow[] }
    | { readonly kind: "UNAUTHORIZED"; readonly reason: string } {
    const denied = this.authorize(scope, authSnapshot, at);
    if (denied !== null) return denied;
    return {
      kind: "LISTED",
      lots: this.inventoryStore.listLots(scope.tenantId, scope.branchId, presentationId),
    };
  }
}
