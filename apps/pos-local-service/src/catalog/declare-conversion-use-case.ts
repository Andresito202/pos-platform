import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { PERMISSION_CATALOG_PRODUCT_REGISTER } from "./register-product-use-case.js";
import type { DeclareConversionOutcome, SqliteCatalogStore } from "./sqlite-catalog-store.js";

/**
 * Declara `1 origen = factor destino` entre dos presentaciones del mismo
 * producto (`DEC-004` §1579).
 *
 * Declarar no convierte nada: deja escrito el factor con el que se podrá
 * convertir. Aplicarlo es `inventory.conversion.apply`, y son dos operaciones
 * porque son dos decisiones distintas —la del que configura el catálogo y la
 * del que abre una paca en el mostrador— con permisos y momentos distintos.
 */
export interface DeclareConversionRequest {
  readonly productId: string;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  readonly factor: string;
  readonly reversible: boolean;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type DeclareConversionResult =
  | DeclareConversionOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: DeclareConversionRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      factor: request.factor,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      product_id: request.productId,
      reversible: request.reversible,
      source_presentation_id: request.sourcePresentationId,
      target_presentation_id: request.targetPresentationId,
    }))
    .digest("hex");
}

export class DeclareConversionUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: DeclareConversionRequest,
    at: Date = new Date(),
  ): DeclareConversionResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.catalogStore.declareConversion({
      scope,
      sessionId,
      operatorUserId,
      conversionId: uuidV7(),
      operationId: uuidV7(),
      productId: request.productId,
      sourcePresentationId: request.sourcePresentationId,
      targetPresentationId: request.targetPresentationId,
      factor: request.factor,
      reversible: request.reversible,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
