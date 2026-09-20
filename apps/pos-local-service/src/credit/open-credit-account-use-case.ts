import { createHash, randomUUID } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { OpenCreditAccountOutcome, SqliteCreditStore } from "./sqlite-credit-store.js";

export const PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_MANAGE = "CUSTOMERS_CREDIT_ACCOUNT_MANAGE";

export interface OpenCreditAccountRequest {
  readonly customerId: string;
  readonly creditLimit: string;
  readonly currencyCode: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type OpenCreditAccountResult =
  | OpenCreditAccountOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "CURRENCY_MISMATCH" };

function requestChecksum(request: OpenCreditAccountRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      credit_limit: request.creditLimit,
      currency_code: request.currencyCode,
      customer_id: request.customerId,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
    }))
    .digest("hex");
}

/**
 * Abre la cuenta de crédito de un cliente con un cupo **explícito**.
 *
 * `DEC-005` no admite cupo por defecto del comercio: fiar exige una decisión
 * deliberada por cliente, y no tener cuenta es no tener crédito. Por eso este
 * caso de uso no crea cuentas implícitamente en ningún otro flujo — la venta a
 * crédito falla con `CREDIT_ACCOUNT_NOT_FOUND` en vez de abrir una sola.
 *
 * Administrar cupos es una facultad distinta de autorizar una venta fiada:
 * quien decide cuánto puede deber un cliente no es necesariamente quien
 * despacha en el mostrador. Por eso el permiso es propio.
 */
export class OpenCreditAccountUseCase {
  constructor(
    private readonly creditStore: SqliteCreditStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: OpenCreditAccountRequest,
  ): OpenCreditAccountResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_MANAGE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    // V1 opera en pesos colombianos, igual que la venta y la caja. Admitir otra
    // moneda aquí crearía una cuenta que ninguna venta podría usar.
    if (request.currencyCode !== "COP") return { kind: "CURRENCY_MISMATCH" };

    return this.creditStore.openAccount({
      scope,
      sessionId,
      operatorUserId,
      accountId: randomUUID(),
      customerId: request.customerId,
      creditLimit: request.creditLimit,
      currencyCode: request.currencyCode,
      operationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
