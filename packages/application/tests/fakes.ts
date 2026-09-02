import {
  TenantMembership,
  UserRoleAssignment,
  type Actor,
  type CashCount,
  type CashDifferenceReview,
  type CashMovement,
  type CashMovementType,
  type CashShift,
  type CompanyScope,
  type InventoryMovement,
  type Product,
  type Role,
  type TenantScope,
} from "@pos-platform/domain";
import type {
  CashAuthorizationPort,
  CashShiftRepository,
  CatalogAuthorizationPort,
  Clock,
  IdGenerator,
  InventoryAuthorizationPort,
  InventoryMovementRepository,
  ProductRepository,
  UserRoleAssignmentRepository,
} from "../src/index.js";

function scopeKey(scope: TenantScope, suffix: string): string {
  return `${scope.tenantId}:${scope.companyId}:${scope.branchId}:${suffix}`;
}

function companyScopeKey(scope: CompanyScope, suffix: string): string {
  return `${scope.tenantId}:${scope.companyId}:${suffix}`;
}

/**
 * One in-memory test double for all three Cash use cases, shared across
 * test files instead of duplicated per file. This is a test double
 * (PASO 11 of Block 3 explicitly allows it) — it is not, and must never
 * become, a production adapter: no SQLite/PostgreSQL implementation of
 * CashShiftRepository exists, blocked by the first-migration DDL gate.
 */
export class InMemoryCashShiftRepository implements CashShiftRepository {
  private readonly openRegisterKeys = new Set<string>();
  private readonly shiftsById = new Map<string, CashShift>();
  private readonly movementsByShift = new Map<string, CashMovement[]>();
  private readonly movementsByIdempotencyKey = new Map<string, CashMovement>();
  private readonly closesByIdempotencyKey = new Map<string, CashCount>();
  private readonly opensByIdempotencyKey = new Map<string, { shift: CashShift; checksum: string }>();

  readonly savedOpens: { shift: CashShift; movement: CashMovement }[] = [];
  readonly savedMovements: { shift: CashShift; movement: CashMovement }[] = [];
  readonly savedCloses: { shift: CashShift; count: CashCount; review: CashDifferenceReview | null }[] = [];

  seedOpenRegister(scope: TenantScope, cashRegisterId: string, originDeviceId: string): void {
    this.openRegisterKeys.add(scopeKey(scope, `${cashRegisterId}:${originDeviceId}`));
  }

  seedShift(shift: CashShift): void {
    this.shiftsById.set(shift.id, shift);
  }

  seedPostedMovement(movement: CashMovement): void {
    const list = this.movementsByShift.get(movement.cashShiftId) ?? [];
    list.push(movement);
    this.movementsByShift.set(movement.cashShiftId, list);
  }

  async hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string, originDeviceId: string): Promise<boolean> {
    return this.openRegisterKeys.has(scopeKey(scope, `${cashRegisterId}:${originDeviceId}`));
  }

  async findOpenByIdempotencyKey(scope: TenantScope, originDeviceId: string, idempotencyKey: string): Promise<{ shift: CashShift; checksum: string } | null> {
    return this.opensByIdempotencyKey.get(scopeKey(scope, `${originDeviceId}:${idempotencyKey}`)) ?? null;
  }

  async save(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string): Promise<void> {
    this.openRegisterKeys.add(scopeKey(shift.scope, `${shift.cashRegisterId}:${shift.originDeviceId}`));
    this.shiftsById.set(shift.id, shift);
    this.movementsByShift.set(shift.id, [movement]);
    this.opensByIdempotencyKey.set(scopeKey(shift.scope, `${shift.originDeviceId}:${idempotencyKey}`), { shift, checksum });
    this.savedOpens.push({ shift, movement });
  }

  async findById(scope: TenantScope, cashShiftId: string): Promise<CashShift | null> {
    const shift = this.shiftsById.get(cashShiftId);
    return shift && shift.scope.equals(scope) ? shift : null;
  }

  async listPostedMovements(cashShiftId: string): Promise<readonly CashMovement[]> {
    return this.movementsByShift.get(cashShiftId) ?? [];
  }

  async nextMovementSequence(cashShiftId: string): Promise<number> {
    return (this.movementsByShift.get(cashShiftId)?.length ?? 0) + 1;
  }

  async findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null> {
    return this.movementsByIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveMovement(shift: CashShift, movement: CashMovement, idempotencyKey: string): Promise<void> {
    this.shiftsById.set(shift.id, shift);
    const list = this.movementsByShift.get(shift.id) ?? [];
    list.push(movement);
    this.movementsByShift.set(shift.id, list);
    this.movementsByIdempotencyKey.set(scopeKey(shift.scope, idempotencyKey), movement);
    this.savedMovements.push({ shift, movement });
  }

  async findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null> {
    return this.closesByIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveClose(shift: CashShift, count: CashCount, review: CashDifferenceReview | null, idempotencyKey: string): Promise<void> {
    this.shiftsById.set(shift.id, shift);
    this.closesByIdempotencyKey.set(scopeKey(shift.scope, idempotencyKey), count);
    this.savedCloses.push({ shift, count, review });
  }
}

export class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date { return this.at; }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  newId(): string { this.counter += 1; return `018f0000-0000-7000-8000-00000000${String(this.counter).padStart(4, "0")}`; }
}

export class FixedAuthorization implements CashAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canOpenShift(_actor: Actor, _scope: TenantScope): Promise<boolean> { return this.allow; }
  async canRegisterMovement(_actor: Actor, _movementType: CashMovementType, _scope: TenantScope): Promise<boolean> { return this.allow; }
  async canCloseShift(_actor: Actor, _scope: TenantScope): Promise<boolean> { return this.allow; }
}

export class FixedCatalogAuthorization implements CatalogAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canCreateProduct(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
}

/**
 * Shared by both RoleBasedCashAuthorization and RoleBasedCatalogAuthorization
 * tests — one real rule engine, two ports, no reason to duplicate the fake
 * that feeds it real UserRoleAssignments.
 */
export class InMemoryUserRoleAssignmentRepository implements UserRoleAssignmentRepository {
  private readonly assignments: UserRoleAssignment[] = [];

  grant(userId: string, role: Role, scope: TenantScope): void {
    const membership = TenantMembership.active(userId, scope.tenantId, "MEMBER");
    this.assignments.push(UserRoleAssignment.within(membership, role, scope));
  }

  async listActiveAssignments(forUserId: string, scope: TenantScope): Promise<readonly UserRoleAssignment[]> {
    return this.assignments.filter((a) => a.userId === forUserId && a.scope.tenantId === scope.tenantId);
  }

  async listActiveAssignmentsForCompany(forUserId: string, scope: CompanyScope): Promise<readonly UserRoleAssignment[]> {
    return this.assignments.filter((a) => a.userId === forUserId && a.scope.tenantId === scope.tenantId);
  }
}

export class InMemoryProductRepository implements ProductRepository {
  private readonly byIdempotencyKey = new Map<string, Product>();
  private readonly internalCodes = new Set<string>();
  readonly saved: Product[] = [];

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean> {
    return this.internalCodes.has(companyScopeKey(scope, internalCode));
  }

  async save(product: Product, idempotencyKey: string): Promise<void> {
    this.byIdempotencyKey.set(companyScopeKey(product.scope, idempotencyKey), product);
    if (product.internalCode) this.internalCodes.add(companyScopeKey(product.scope, product.internalCode));
    this.saved.push(product);
  }
}

export class InMemoryInventoryMovementRepository implements InventoryMovementRepository {
  private readonly movements: InventoryMovement[] = [];
  private readonly byIdempotencyKey = new Map<string, InventoryMovement>();
  readonly saved: InventoryMovement[] = [];

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryMovement | null> {
    return this.byIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async listPostedMovements(
    scope: TenantScope,
    inventoryLocationId: string,
    presentationId: string,
    lotId: string | null,
  ): Promise<readonly InventoryMovement[]> {
    return this.movements.filter(
      (movement) =>
        movement.scope.equals(scope) &&
        movement.inventoryLocationId === inventoryLocationId &&
        movement.presentationId === presentationId &&
        movement.lotId === lotId,
    );
  }

  async save(movement: InventoryMovement, idempotencyKey: string): Promise<void> {
    this.movements.push(movement);
    this.byIdempotencyKey.set(scopeKey(movement.scope, idempotencyKey), movement);
    this.saved.push(movement);
  }
}

export class FixedInventoryAuthorization implements InventoryAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canAdjustInventory(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
}
