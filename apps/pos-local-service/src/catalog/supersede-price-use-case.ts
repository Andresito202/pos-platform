import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { CanonicalPermission, uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteCatalogStore } from "./sqlite-catalog-store.js";

export interface SupersedePriceRequest {
  readonly presentationId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type SupersedePriceResult =
  | { readonly kind: "PUBLISHED"; readonly priceId: string; readonly presentationId: string }
  | { readonly kind: "IDEMPOTENT"; readonly priceId: string; readonly presentationId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "INVALID_AMOUNT" }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

/** Authorized price publish — never mutates historical ACTIVE rows in place. */
export class SupersedePriceUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: SupersedePriceRequest,
    at: Date = new Date(),
  ): SupersedePriceResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: CanonicalPermission.CATALOG_PRICE_PUBLISH,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };
    if (!/^(?:0|[1-9]\d{0,14})\.\d{6}$/.test(request.amount) || !/[1-9]/.test(request.amount)) {
      return { kind: "INVALID_AMOUNT" };
    }

    const checksum = createHash("sha256").update(canonicalJson({
      amount: request.amount,
      currency_code: request.currencyCode,
      idempotency_key: request.idempotencyKey,
      presentation_id: request.presentationId,
    })).digest("hex");

    return this.catalogStore.supersedePrice({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      operationId: uuidV7(),
      priceId: uuidV7(),
      presentationId: request.presentationId,
      amount: request.amount,
      currencyCode: request.currencyCode,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: checksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
