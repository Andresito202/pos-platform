import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SqliteCashShiftStore } from "./sqlite-cash-shift-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

export const PERMISSION_CASH_SHIFT_CLOSE = "CASH_SHIFT_CLOSE";

export interface CloseCashShiftRequest {
  readonly shiftId: string;
  readonly countedAmount: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type CloseCashShiftResult =
  | {
      readonly kind: "CLOSED";
      readonly shiftId: string;
      readonly expectedCash: string;
      readonly countedAmount: string;
      readonly differenceAmount: string;
    }
  | { readonly kind: "IDEMPOTENT"; readonly shiftId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "ALREADY_CLOSED" }
  | { readonly kind: "VERSION_CONFLICT" }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

function requestChecksum(request: CloseCashShiftRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      counted_amount: request.countedAmount,
      expected_version: request.expectedVersion,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      shift_id: request.shiftId,
    }))
    .digest("hex");
}

export class CloseCashShiftUseCase {
  constructor(
    private readonly cashShiftStore: SqliteCashShiftStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: CloseCashShiftRequest,
  ): CloseCashShiftResult {
    const at = this.now();

    // 1. Actor USER derivado del snapshot autorizado — nunca del caller
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    // 2. Autorización: CASH_SHIFT_CLOSE (DEC-012 §33)
    const assignments = toRoleAssignments(authSnapshot.claims);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_CASH_SHIFT_CLOSE,
      scope: operationScope,
      at,
      assignments,
    });

    if (!decision.allowed) {
      return { kind: "UNAUTHORIZED", reason: decision.reason };
    }

    // 3. Checksum determinista del request
    const checksum = requestChecksum(request, operatorUserId);

    // 4. Persistencia atómica delegada al store
    const result = this.cashShiftStore.close({
      operationId: randomUUID(),
      scope,
      sessionId,
      operatorUserId,
      shiftId: request.shiftId,
      countedAmount: request.countedAmount,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: checksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    switch (result.kind) {
      case "CLOSED":
        return {
          kind: "CLOSED",
          shiftId: result.shiftId,
          expectedCash: result.expectedCash,
          countedAmount: result.countedAmount,
          differenceAmount: result.differenceAmount,
        };
      case "IDEMPOTENT":
        return { kind: "IDEMPOTENT", shiftId: result.shiftId };
      case "NOT_FOUND":
        return { kind: "NOT_FOUND" };
      case "ALREADY_CLOSED":
        return { kind: "ALREADY_CLOSED" };
      case "VERSION_CONFLICT":
        return { kind: "VERSION_CONFLICT" };
      case "IDEMPOTENCY_CONFLICT":
        return { kind: "IDEMPOTENCY_CONFLICT" };
    }
  }
}
