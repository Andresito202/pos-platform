import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { CreditAccountView, SqliteCreditStore } from "./sqlite-credit-store.js";

export const PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_READ = "CUSTOMERS_CREDIT_ACCOUNT_READ";

export type GetCreditAccountResult =
  | { readonly kind: "FOUND"; readonly account: CreditAccountView }
  | { readonly kind: "CREDIT_ACCOUNT_NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Lee la cuenta de un cliente con su saldo y su disponible.
 *
 * Los tres números salen del libro, no de una columna: el saldo es
 * `Σ(INCREASE) − Σ(DECREASE)` recomputado al leer. Nadie puede enviarlos.
 */
export class GetCreditAccountUseCase {
  constructor(
    private readonly creditStore: SqliteCreditStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: { readonly customerId: string },
  ): GetCreditAccountResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const account = this.creditStore.findAccountByCustomer(scope, request.customerId);
    if (account === null) return { kind: "CREDIT_ACCOUNT_NOT_FOUND" };
    return { kind: "FOUND", account };
  }
}
