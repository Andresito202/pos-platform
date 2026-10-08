import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7, PermissionCode } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SqliteMasterSnapshotStore } from "../master-data/sqlite-master-snapshot-store.js";
import type { SqliteCashShiftStore } from "./sqlite-cash-shift-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

export const PERMISSION_CASH_SHIFT_OPEN = PermissionCode.CASH_SHIFT_OPEN;

export interface OpenCashShiftRequest {
  readonly cashRegisterId: string;
  readonly openingAmount: string;
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type OpenCashShiftResult =
  | { readonly kind: "OPENED"; readonly shiftId: string; readonly version: number }
  | { readonly kind: "IDEMPOTENT"; readonly shiftId: string; readonly version: number }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "REGISTER_NOT_FOUND" }
  | { readonly kind: "REGISTER_INACTIVE" }
  | { readonly kind: "NEGATIVE_OPENING_AMOUNT" }
  | { readonly kind: "INCOMPATIBLE_SHIFT" }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

function requestChecksum(request: OpenCashShiftRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      business_date: request.businessDate,
      cash_register_id: request.cashRegisterId,
      idempotency_key: request.idempotencyKey,
      opening_amount: request.openingAmount,
      operator_user_id: operatorUserId,
      timezone_id: request.timezoneId,
      utc_offset_minutes: request.utcOffsetMinutes,
    }))
    .digest("hex");
}

export class OpenCashShiftUseCase {
  constructor(
    private readonly masterSnapshotStore: SqliteMasterSnapshotStore,
    private readonly cashShiftStore: SqliteCashShiftStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: OpenCashShiftRequest,
  ): OpenCashShiftResult {
    const at = this.now();

    // 1. Actor USER derivado del snapshot autorizado — nunca del caller
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    // 2. Autorización: CASH_SHIFT_OPEN
    const assignments = toRoleAssignments(authSnapshot.claims);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_CASH_SHIFT_OPEN,
      scope: operationScope,
      at,
      assignments,
    });

    if (!decision.allowed) {
      return { kind: "UNAUTHORIZED", reason: decision.reason };
    }

    // 3. opening_amount >= 0 (scale-6; un signo '-' al inicio indica negativo)
    if (request.openingAmount.startsWith("-")) {
      return { kind: "NEGATIVE_OPENING_AMOUNT" };
    }

    // 4. Verificar caja activa en la proyección del snapshot maestro (DA-3)
    const masterScope = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId };
    const registers = this.masterSnapshotStore.activeRegisters(masterScope);
    const register = registers.find((r) => r.id === request.cashRegisterId);

    if (!register) {
      return { kind: "REGISTER_NOT_FOUND" };
    }
    if (register.status !== "ACTIVE") {
      return { kind: "REGISTER_INACTIVE" };
    }

    // 5. Projection sequence congelado en apertura (B4 / DEC-012 §27)
    const projectionSequence = this.masterSnapshotStore.highestAcceptedSequence(masterScope);
    if (projectionSequence === null) {
      return { kind: "REGISTER_NOT_FOUND" };
    }

    // 6. Checksum determinista del request
    const checksum = requestChecksum(request, operatorUserId);

    // 7. Persistencia atómica delegada al store
    const result = this.cashShiftStore.open({
      shiftId: randomUUID(),
      movementId: randomUUID(),
      operationId: uuidV7(),
      scope,
      sessionId,
      operatorUserId,
      cashRegisterId: request.cashRegisterId,
      currencyCode: register.currency_code,
      openingAmount: request.openingAmount,
      businessDate: request.businessDate,
      timezoneId: request.timezoneId,
      utcOffsetMinutes: request.utcOffsetMinutes,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: checksum,
      cashRegisterProjectionSequence: projectionSequence,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    if (result.kind === "OPENED") {
      return { kind: "OPENED", shiftId: result.shiftId, version: result.version };
    }
    if (result.kind === "IDEMPOTENT") {
      return { kind: "IDEMPOTENT", shiftId: result.shiftId, version: result.version };
    }
    if (result.kind === "INCOMPATIBLE_SHIFT") return { kind: "INCOMPATIBLE_SHIFT" };
    return { kind: "IDEMPOTENCY_CONFLICT" };
  }
}
