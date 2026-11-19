import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { FiscalCustomer } from "@pos-platform/fiscal-adapters";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteCustomerStore } from "./sqlite-customer-store.js";

export const PERMISSION_CUSTOMERS_CUSTOMER_READ = "CUSTOMERS_CUSTOMER_READ";

/**
 * Se puede consultar por identificador interno o por identidad fiscal. La
 * segunda forma es la que usa una caja: el cliente da su cédula, no un UUID.
 */
export type GetCustomerRequest =
  | { readonly by: "ID"; readonly customerId: string }
  | {
      readonly by: "IDENTITY";
      readonly identificationDocumentCode: string;
      readonly identification: string;
    };

export type GetCustomerResult =
  | {
      readonly kind: "FOUND";
      readonly customerId: string;
      readonly customer: FiscalCustomer;
      readonly version: number;
    }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

export class GetCustomerUseCase {
  constructor(private readonly customerStore: SqliteCustomerStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: GetCustomerRequest,
    at: Date = new Date(),
  ): GetCustomerResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_CUSTOMERS_CUSTOMER_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    // El alcance de lectura es la compañía, igual que el de escritura: un
    // tercero registrado en otra caja de la misma compañía es el mismo tercero.
    const customerScope = { tenantId: scope.tenantId, companyId: scope.companyId };
    const stored = request.by === "ID"
      ? this.customerStore.get(customerScope, request.customerId)
      : this.customerStore.findByIdentity(
          customerScope,
          request.identificationDocumentCode,
          request.identification,
        );

    if (stored === null) return { kind: "NOT_FOUND" };
    return {
      kind: "FOUND",
      customerId: stored.customerId,
      customer: stored.customer,
      version: stored.version,
    };
  }
}
