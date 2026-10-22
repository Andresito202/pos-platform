import { CanonicalPermission } from "@pos-platform/contracts";
import { createHash, randomUUID } from "node:crypto";
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
import type { CatalogFiscalAttribute, RegisterProductOutcome, SqliteCatalogStore } from "./sqlite-catalog-store.js";

export const PERMISSION_CATALOG_PRODUCT_REGISTER = CanonicalPermission.CATALOG_PRODUCT_REGISTER;

export interface RegisterProductRequest {
  readonly code: string;
  readonly name: string;
  readonly stockControlled: boolean;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly fiscalAttributes?: CatalogFiscalAttribute;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterProductResult =
  | RegisterProductOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: RegisterProductRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      barcode: request.barcode,
      code: request.code,
      currency_code: request.currencyCode,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      price_amount: request.priceAmount,
      unit_code: request.unitCode,
      unit_precision: request.unitPrecision,
      ...(request.fiscalAttributes === undefined ? {} : { fiscal_attributes: request.fiscalAttributes }),
    }))
    .digest("hex");
}

export class RegisterProductUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterProductRequest,
    at: Date = new Date(),
  ): RegisterProductResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.catalogStore.register({
      scope,
      sessionId,
      operatorUserId,
      productId: randomUUID(),
      presentationId: randomUUID(),
      priceId: randomUUID(),
      operationId: uuidV7(),
      code: request.code,
      name: request.name,
      stockControlled: request.stockControlled,
      presentationName: request.presentationName,
      unitCode: request.unitCode,
      unitPrecision: request.unitPrecision,
      barcode: request.barcode,
      priceAmount: request.priceAmount,
      currencyCode: request.currencyCode,
      ...(request.fiscalAttributes === undefined ? {} : { fiscalAttributes: request.fiscalAttributes }),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
