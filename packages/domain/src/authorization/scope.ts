import { AuthorizationModelError } from "./errors.js";

/**
 * Ámbito concreto en el que se ejecuta una operación. Una operación siempre
 * ocurre en un tenant, y opcionalmente en una empresa y una sucursal.
 */
export interface OperationScope {
  readonly tenantId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
}

/**
 * Ámbito de una asignación de rol. Comparte forma con `OperationScope`, pero su
 * semántica es distinta: aquí `null` significa "cualquiera", no "ninguno".
 */
export type AssignmentScope = OperationScope;

function assertScopeShape(scope: OperationScope, label: string): void {
  if (scope.tenantId.trim() === "") {
    throw new AuthorizationModelError(`${label} requires a tenant`);
  }
  // `user_role_assignments_branch_scope_ck`: una sucursal sin empresa no es un
  // ámbito expresable en el modelo.
  if (scope.branchId !== null && scope.companyId === null) {
    throw new AuthorizationModelError(`${label} cannot name a branch without a company`);
  }
  if (scope.companyId !== null && scope.companyId.trim() === "") {
    throw new AuthorizationModelError(`${label} company must not be blank`);
  }
  if (scope.branchId !== null && scope.branchId.trim() === "") {
    throw new AuthorizationModelError(`${label} branch must not be blank`);
  }
}

export function createOperationScope(
  tenantId: string,
  companyId: string | null,
  branchId: string | null,
): OperationScope {
  const scope: OperationScope = { tenantId, companyId, branchId };
  assertScopeShape(scope, "operation scope");
  return scope;
}

export function createAssignmentScope(
  tenantId: string,
  companyId: string | null,
  branchId: string | null,
): AssignmentScope {
  const scope: AssignmentScope = { tenantId, companyId, branchId };
  assertScopeShape(scope, "assignment scope");
  return scope;
}

/**
 * Decide si una asignación alcanza el ámbito de la operación.
 *
 * El tenant debe coincidir siempre: nunca se cruza el aislamiento multi-tenant.
 * Una empresa nula en la asignación cubre cualquier empresa del tenant, y una
 * sucursal nula cubre cualquier sucursal de la empresa alcanzada. La relación
 * no es simétrica: una asignación acotada a una sucursal no cubre una operación
 * que ocurre a nivel de empresa, porque esa operación es más amplia que el
 * permiso concedido.
 */
export function assignmentCoversOperation(
  assignment: AssignmentScope,
  operation: OperationScope,
): boolean {
  if (assignment.tenantId !== operation.tenantId) return false;

  if (assignment.companyId !== null) {
    if (operation.companyId === null) return false;
    if (assignment.companyId !== operation.companyId) return false;
  }

  if (assignment.branchId !== null) {
    if (operation.branchId === null) return false;
    if (assignment.branchId !== operation.branchId) return false;
  }

  return true;
}
