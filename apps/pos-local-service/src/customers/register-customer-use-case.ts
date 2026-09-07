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

/**
 * El checksum se calcula sobre la **identidad fiscal**, no sobre el objeto
 * entero. Repetir el registro cambiando sólo el teléfono no es una operación
 * distinta que deba entrar en conflicto: es el mismo tercero. Lo que sí lo
 * cambia es el documento, la identificación o la naturaleza jurídica.
 */
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

/**
 * Registrar un adquiriente — segunda pieza de `D-9`.
 *
 * El orden importa y no es casual: **se valida contra las tablas DIAN antes de
 * tocar la base**. Un adquiriente con un código no verificado no debe llegar
 * nunca a `customers_customers`, porque desde ahí se emitirían facturas.
 * Descubrirlo en el momento de emitir sería tarde: la venta ya está cobrada.
 */
export class RegisterCustomerUseCase {
  constructor(private readonly customerStore: SqliteCustomerStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterCustomerRequest,
    at: Date = new Date(),
  ): RegisterCustomerResult {
    // 1. Actor USER del snapshot verificado — nunca del llamador.
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CUSTOMERS_CUSTOMER_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    // 2. Reglas fiscales antes de escribir. Se devuelven **todos** los
    //    hallazgos: quien captura en una caja corrige de una vez, no descubre
    //    un error por intento.
    const findings = validateFiscalCustomer(request.customer);
    if (findings.length > 0) return { kind: "INVALID", findings };

    const outcome = this.customerStore.register({
      scope,
      sessionId,
      operatorUserId,
      customerId: randomUUID(),
      operationId: randomUUID(),
      customer: request.customer,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    return outcome;
  }
}
