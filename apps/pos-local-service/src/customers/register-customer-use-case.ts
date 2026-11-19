import { createHash, randomUUID } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import {
  validateFiscalCustomer,
  type FiscalCustomer,
  type FiscalCustomerFinding,
} from "@pos-platform/fiscal-adapters";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteCustomerStore } from "./sqlite-customer-store.js";

export const PERMISSION_CUSTOMERS_CUSTOMER_REGISTER = "CUSTOMERS_CUSTOMER_REGISTER";

export interface RegisterCustomerRequest {
  readonly customer: FiscalCustomer;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterCustomerResult =
  | { readonly kind: "REGISTERED"; readonly customerId: string; readonly version: number }
  | { readonly kind: "IDEMPOTENT"; readonly customerId: string; readonly version: number }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "INVALID"; readonly findings: readonly FiscalCustomerFinding[] }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "IDENTITY_ALREADY_REGISTERED"; readonly customerId: string };

function requestChecksum(request: RegisterCustomerRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      identification: request.customer.identification,
      identification_document_code: request.customer.identificationDocumentCode,
      idempotency_key: request.idempotencyKey,
      legal_organization_code: request.customer.legalOrganizationCode,
      operator_user_id: operatorUserId,
    }))
    .digest("hex");
}

export class RegisterCustomerUseCase {
  constructor(private readonly customerStore: SqliteCustomerStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterCustomerRequest,
    at: Date = new Date(),
  ): RegisterCustomerResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CUSTOMERS_CUSTOMER_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const findings = validateFiscalCustomer(request.customer);
    if (findings.length > 0) return { kind: "INVALID", findings };

    return this.customerStore.register({
      scope,
      sessionId,
      operatorUserId,
      customerId: randomUUID(),
      operationId: uuidV7(),
      customer: request.customer,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
