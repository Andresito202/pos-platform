import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { CreateSaleReturnOutcome, PhysicalCondition, SqliteSaleReturnStore } from "./sqlite-sale-return-store.js";

export const PERMISSION_SALES_RETURN_REQUEST = "SALES_RETURN_REQUEST";
export const PERMISSION_SALES_RETURN_APPROVE = "SALES_RETURN_APPROVE";
export const PERMISSION_SALES_RETURN_EXECUTE = "SALES_RETURN_EXECUTE";
export const PERMISSION_PAYMENTS_REFUND_REQUEST = "PAYMENTS_REFUND_REQUEST";
export const PERMISSION_PAYMENTS_REFUND_APPROVE = "PAYMENTS_REFUND_APPROVE";
export const PERMISSION_PAYMENTS_REFUND_EXECUTE_CASH = "PAYMENTS_REFUND_EXECUTE_CASH";

/**
 * Los seis que exige hacer la devolución entera en una sola operación. Cada
 * módulo autoriza su propio efecto (`permission-matrix.md` §Segregación,
 * regla 5): `SALES_RETURN_*` no concede `PAYMENTS_REFUND_*`.
 */
const REQUIRED_PERMISSIONS = [
  PERMISSION_SALES_RETURN_REQUEST,
  PERMISSION_SALES_RETURN_APPROVE,
  PERMISSION_SALES_RETURN_EXECUTE,
  PERMISSION_PAYMENTS_REFUND_REQUEST,
  PERMISSION_PAYMENTS_REFUND_APPROVE,
  PERMISSION_PAYMENTS_REFUND_EXECUTE_CASH,
] as const;

export interface CreateSaleReturnRequest {
  readonly saleId: string;
  readonly cashRegisterId: string;
  readonly reasonCode: string;
  readonly reasonDetail: string | null;
  readonly lines: readonly { readonly lineNumber: number; readonly physicalCondition: PhysicalCondition }[];
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type CreateSaleReturnResult =
  | CreateSaleReturnOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: CreateSaleReturnRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      cash_register_id: request.cashRegisterId,
      idempotency_key: request.idempotencyKey,
      lines: request.lines.map((line) => ({
        line_number: line.lineNumber,
        physical_condition: line.physicalCondition,
      })),
      operator_user_id: operatorUserId,
      reason_code: request.reasonCode,
      reason_detail: request.reasonDetail,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

/**
 * Devolución comercial con reembolso en efectivo — `B11`, `UC-SALES-002`
 * §Devolución comercial y `UC-PAY-004` §Reembolso en efectivo.
 *
 * Solicitar, aprobar y ejecutar en un solo paso, por quien tiene los seis
 * permisos. El flujo segregado —un cajero solicita, un supervisor aprueba— no
 * existe todavía; un cajero que sólo puede solicitar recibe `UNAUTHORIZED` en
 * vez de una devolución que nadie aprobó.
 */
export class CreateSaleReturnUseCase {
  constructor(
    private readonly store: SqliteSaleReturnStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: CreateSaleReturnRequest,
  ): CreateSaleReturnResult {
    const at = this.now();
    const operatorUserId = authSnapshot.claims.user_id;
    const actor = createActor("USER", operatorUserId);
    const assignments = toRoleAssignments(authSnapshot.claims);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);

    for (const permission of REQUIRED_PERMISSIONS) {
      const decision = evaluatePermission({ actor, permission, scope: operationScope, at, assignments });
      if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };
    }

    return this.store.create({
      scope,
      sessionId,
      operatorUserId,
      saleId: request.saleId,
      cashRegisterId: request.cashRegisterId,
      reasonCode: request.reasonCode,
      reasonDetail: request.reasonDetail,
      lines: request.lines,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
