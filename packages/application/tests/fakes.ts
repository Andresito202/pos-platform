import {
  TenantMembership,
  UserRoleAssignment,
  type Actor,
  type CashCount,
  type CashDifferenceReview,
  type CashMovement,
  type CashMovementType,
  type CashShift,
  CompanyScope,
  type IdentifierType,
  type InventoryMovement,
  type InventoryReservation,
  type InventoryTransfer,
  type InventoryTransferLine,
  Quantity,
  type Payment,
  type PaymentAttempt,
  type PaymentConfirmedNotificationRequested,
  type Product,
  type ProductIdentifier,
  ProductPresentation,
  type ProductVariant,
  type Role,
  type TenantScope,
  type UnitConversion,
  type VariantAttributes,
} from "@pos-platform/domain";
import {
  IdempotencyKeyConflictError,
  type CashAuthorizationPort,
  type CashShiftPhysicalContext,
  type CashShiftRepository,
  type CatalogAuthorizationPort,
  type Clock,
  type IdGenerator,
  type IdentifierNormalizationPolicy,
  type InventoryAuthorizationPort,
  type InventoryMovementRepository,
  type InventoryReservationRepository,
  type InventoryTransferRepository,
  type PaymentAttemptRepository,
  type PaymentAuthorizationPort,
  type PaymentConfirmationAuthenticityPort,
  type PaymentConfirmationEvidence,
  type PaymentRepository,
  type PosNotificationPort,
  type ProductIdentifierRepository,
  type ProductPresentationRepository,
  type ProductRepository,
  type ProductVariantRepository,
  type UnitConversionRepository,
  type UserRoleAssignmentRepository,
  type VariantCanonicalKeyPolicy,
} from "../src/index.js";

function scopeKey(scope: TenantScope, suffix: string): string {
  return `${scope.tenantId}:${scope.companyId}:${scope.branchId}:${suffix}`;
}

function companyScopeKey(scope: CompanyScope, suffix: string): string {
  return `${scope.tenantId}:${scope.companyId}:${suffix}`;
}

/**
 * Shared by every Inventory application test: seeds a real, valid
 * `ACTIVE`/`INDEPENDENT` presentation so `validateInventoryPresentation`
 * (B32) has something real to find — Inventory tests are not exempt
 * from Catalog's own repository just because they predate B29.
 */
export async function seedInventoryPresentation(
  repository: InMemoryProductPresentationRepository,
  scope: { readonly tenantId: string; readonly companyId: string },
  presentationId: string,
  productId = "018f0000-0000-7000-8000-000000000900",
): Promise<void> {
  const presentation = ProductPresentation.create({
    id: presentationId,
    scope: new CompanyScope(scope.tenantId, scope.companyId),
    productId,
    variantId: null,
    name: "unidad",
    internalSku: null,
    unitId: "018f0000-0000-7000-8000-000000000060",
    containedQuantity: Quantity.fromString("1"),
    variableQuantity: false,
    salesEnabled: true,
    purchasingEnabled: true,
    breakable: false,
    stockMode: "INDEPENDENT",
  });
  await repository.save(presentation, `seed:${presentationId}`);
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

  async save(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string, _physicalContext: CashShiftPhysicalContext): Promise<void> {
    // Bloque 22: simulates the real adapter's physical UNIQUE at save
    // time, not just at lookup — a genuinely concurrent caller may have
    // already committed under this exact key between our caller's lookup
    // and this call. `_physicalContext` (business_date/timezone/currency)
    // has no in-memory column to land in — this fake models application
    // behavior, not physical storage, so it is accepted and ignored.
    const key = scopeKey(shift.scope, `${shift.originDeviceId}:${idempotencyKey}`);
    if (this.opensByIdempotencyKey.has(key)) {
      throw new IdempotencyKeyConflictError(`opening_idempotency_key already exists for ${key}`);
    }
    this.openRegisterKeys.add(scopeKey(shift.scope, `${shift.cashRegisterId}:${shift.originDeviceId}`));
    this.shiftsById.set(shift.id, shift);
    this.movementsByShift.set(shift.id, [movement]);
    this.opensByIdempotencyKey.set(key, { shift, checksum });
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
  private counter: number;
  /** `start` lets two independently-constructed generators feeding the SAME repository produce non-colliding ids — needed whenever a test seeds two distinct aggregates via two separate use-case instances. */
  constructor(start = 0) { this.counter = start; }
  newId(): string { this.counter += 1; return `018f0000-0000-7000-8000-00000000${String(this.counter).padStart(4, "0")}`; }
}

export class FixedAuthorization implements CashAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canOpenShift(_actor: Actor, _scope: TenantScope): Promise<boolean> { return this.allow; }
  async canRegisterMovement(_actor: Actor, _movementType: CashMovementType, _scope: TenantScope): Promise<boolean> { return this.allow; }
  async canCloseShift(_actor: Actor, _scope: TenantScope): Promise<boolean> { return this.allow; }
}

/**
 * Bloque 27: extended beyond CreateProduct's single method. `allow` gates
 * every Catalog operation uniformly for this fake — real, per-operation
 * fail-closed behavior for the still-undecided operations (HD-01..04) is
 * `RoleBasedCatalogAuthorization`'s job, exercised in its own test file,
 * not this fake's.
 */
export class FixedCatalogAuthorization implements CatalogAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canCreateProduct(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canUpdateProduct(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canDeactivateProduct(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canCreateVariant(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canCreatePresentation(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canAssignIdentifier(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
  async canDefineConversion(_actor: Actor, _scope: CompanyScope): Promise<boolean> { return this.allow; }
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
  private readonly byUpdateIdempotencyKey = new Map<string, Product>();
  private readonly byDeactivationIdempotencyKey = new Map<string, Product>();
  private readonly internalCodes = new Set<string>();
  private readonly byId = new Map<string, Product>();
  readonly saved: Product[] = [];
  readonly savedUpdates: Product[] = [];
  readonly savedDeactivations: Product[] = [];

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean> {
    return this.internalCodes.has(companyScopeKey(scope, internalCode));
  }

  async save(product: Product, idempotencyKey: string): Promise<void> {
    this.byIdempotencyKey.set(companyScopeKey(product.scope, idempotencyKey), product);
    if (product.internalCode) this.internalCodes.add(companyScopeKey(product.scope, product.internalCode));
    this.byId.set(product.id, product);
    this.saved.push(product);
  }

  async findById(scope: CompanyScope, productId: string): Promise<Product | null> {
    const product = this.byId.get(productId);
    return product && product.scope.equals(scope) ? product : null;
  }

  async findUpdateByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.byUpdateIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveUpdate(product: Product, idempotencyKey: string): Promise<void> {
    this.byId.set(product.id, product);
    this.byUpdateIdempotencyKey.set(companyScopeKey(product.scope, idempotencyKey), product);
    this.savedUpdates.push(product);
  }

  async findDeactivationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.byDeactivationIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveDeactivation(product: Product, idempotencyKey: string): Promise<void> {
    this.byId.set(product.id, product);
    this.byDeactivationIdempotencyKey.set(companyScopeKey(product.scope, idempotencyKey), product);
    this.savedDeactivations.push(product);
  }
}

export class InMemoryProductVariantRepository implements ProductVariantRepository {
  private readonly byId = new Map<string, ProductVariant>();
  private readonly byProductAndCanonicalKey = new Map<string, ProductVariant>();
  private readonly byIdempotencyKey = new Map<string, ProductVariant>();
  readonly saved: ProductVariant[] = [];

  async findByProductAndCanonicalKey(scope: CompanyScope, productId: string, canonicalKey: string): Promise<ProductVariant | null> {
    return this.byProductAndCanonicalKey.get(companyScopeKey(scope, `${productId}:${canonicalKey}`)) ?? null;
  }

  async findById(scope: CompanyScope, variantId: string): Promise<ProductVariant | null> {
    const variant = this.byId.get(variantId);
    return variant && variant.scope.equals(scope) ? variant : null;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductVariant | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(variant: ProductVariant, idempotencyKey: string): Promise<void> {
    this.byId.set(variant.id, variant);
    this.byProductAndCanonicalKey.set(companyScopeKey(variant.scope, `${variant.productId}:${variant.canonicalKey}`), variant);
    this.byIdempotencyKey.set(companyScopeKey(variant.scope, idempotencyKey), variant);
    this.saved.push(variant);
  }
}

export class InMemoryProductPresentationRepository implements ProductPresentationRepository {
  private readonly byId = new Map<string, ProductPresentation>();
  private readonly skus = new Set<string>();
  private readonly byIdempotencyKey = new Map<string, ProductPresentation>();
  readonly saved: ProductPresentation[] = [];

  async existsBySku(scope: CompanyScope, sku: string): Promise<boolean> {
    return this.skus.has(companyScopeKey(scope, sku));
  }

  async findById(scope: CompanyScope, presentationId: string): Promise<ProductPresentation | null> {
    const presentation = this.byId.get(presentationId);
    return presentation && presentation.scope.equals(scope) ? presentation : null;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductPresentation | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(presentation: ProductPresentation, idempotencyKey: string): Promise<void> {
    this.byId.set(presentation.id, presentation);
    if (presentation.internalSku) this.skus.add(companyScopeKey(presentation.scope, presentation.internalSku));
    this.byIdempotencyKey.set(companyScopeKey(presentation.scope, idempotencyKey), presentation);
    this.saved.push(presentation);
  }
}

export class InMemoryProductIdentifierRepository implements ProductIdentifierRepository {
  private readonly byTypeAndValue = new Set<string>();
  private readonly byIdempotencyKey = new Map<string, ProductIdentifier>();
  readonly saved: ProductIdentifier[] = [];

  async existsByTypeAndNormalizedValue(scope: CompanyScope, identifierType: IdentifierType, normalizedValue: string): Promise<boolean> {
    return this.byTypeAndValue.has(companyScopeKey(scope, `${identifierType}:${normalizedValue}`));
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductIdentifier | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(identifier: ProductIdentifier, idempotencyKey: string): Promise<void> {
    this.byTypeAndValue.add(companyScopeKey(identifier.scope, `${identifier.identifierType}:${identifier.normalizedValue}`));
    this.byIdempotencyKey.set(companyScopeKey(identifier.scope, idempotencyKey), identifier);
    this.saved.push(identifier);
  }
}

export class InMemoryUnitConversionRepository implements UnitConversionRepository {
  private readonly byIdempotencyKey = new Map<string, UnitConversion>();
  readonly saved: UnitConversion[] = [];

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<UnitConversion | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(conversion: UnitConversion, idempotencyKey: string): Promise<void> {
    this.byIdempotencyKey.set(companyScopeKey(conversion.scope, idempotencyKey), conversion);
    this.saved.push(conversion);
  }
}

/**
 * Test-only stand-in for B26 HD-06: joins sorted `key=value` pairs with
 * `|`. This is exactly the kind of concrete algorithm the real port must
 * NOT ship until the human decision closes — it exists here only so
 * `CreateVariantUseCase` has something to canonicalize with in tests.
 */
export class FixedVariantCanonicalKeyPolicy implements VariantCanonicalKeyPolicy {
  canonicalize(attributes: VariantAttributes): string {
    const record = attributes.toRecord();
    return Object.keys(record).sort().map((key) => `${key}=${record[key]}`).join("|");
  }
}

/** Test-only stand-in for the B27 identifier-normalization finding — identity function (no invented per-type algorithm). */
export class FixedIdentifierNormalizationPolicy implements IdentifierNormalizationPolicy {
  normalize(_identifierType: IdentifierType, rawValue: string): string {
    return rawValue;
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
  async canRegisterWaste(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
  async canTransferInventory(_actor: Actor, _scope: CompanyScope): Promise<boolean> {
    return this.allow;
  }
  async canReserveInventory(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
  async canConsumeInventoryReservation(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
  async canReleaseInventoryReservation(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
}

export class InMemoryInventoryReservationRepository implements InventoryReservationRepository {
  private readonly byId = new Map<string, InventoryReservation>();
  private readonly byIdempotencyKey = new Map<string, InventoryReservation>();
  private readonly byConsumptionIdempotencyKey = new Map<string, InventoryReservation>();
  private readonly byReleaseIdempotencyKey = new Map<string, InventoryReservation>();
  readonly saved: InventoryReservation[] = [];

  async findById(scope: TenantScope, reservationId: string): Promise<InventoryReservation | null> {
    const reservation = this.byId.get(reservationId);
    return reservation && reservation.scope.equals(scope) ? reservation : null;
  }

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.byIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    this.byId.set(reservation.id, reservation);
    this.byIdempotencyKey.set(scopeKey(reservation.scope, idempotencyKey), reservation);
    this.saved.push(reservation);
  }

  async findConsumptionByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.byConsumptionIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveConsumption(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    this.byId.set(reservation.id, reservation);
    this.byConsumptionIdempotencyKey.set(scopeKey(reservation.scope, idempotencyKey), reservation);
    this.saved.push(reservation);
  }

  async findReleaseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.byReleaseIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveRelease(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    this.byId.set(reservation.id, reservation);
    this.byReleaseIdempotencyKey.set(scopeKey(reservation.scope, idempotencyKey), reservation);
    this.saved.push(reservation);
  }

  async listOutstanding(scope: TenantScope, inventoryLocationId: string, presentationId: string, lotId: string | null): Promise<readonly InventoryReservation[]> {
    return [...this.byId.values()].filter(
      (reservation) =>
        reservation.scope.equals(scope) &&
        reservation.inventoryLocationId === inventoryLocationId &&
        reservation.presentationId === presentationId &&
        reservation.lotId === lotId,
    );
  }
}

export class InMemoryInventoryTransferRepository implements InventoryTransferRepository {
  private readonly byId = new Map<string, InventoryTransfer>();
  private readonly linesByTransfer = new Map<string, InventoryTransferLine[]>();
  private readonly byIdempotencyKey = new Map<string, InventoryTransfer>();
  private readonly byDispatchIdempotencyKey = new Map<string, InventoryTransfer>();
  private readonly byReceiptIdempotencyKey = new Map<string, InventoryTransfer>();
  private readonly byCancellationIdempotencyKey = new Map<string, InventoryTransfer>();
  readonly saved: InventoryTransfer[] = [];

  async findById(scope: CompanyScope, transferId: string): Promise<InventoryTransfer | null> {
    const transfer = this.byId.get(transferId);
    return transfer && transfer.scope.equals(scope) ? transfer : null;
  }

  async findLines(_scope: CompanyScope, transferId: string): Promise<readonly InventoryTransferLine[]> {
    return this.linesByTransfer.get(transferId) ?? [];
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.byIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    this.byId.set(transfer.id, transfer);
    this.linesByTransfer.set(transfer.id, [...lines]);
    this.byIdempotencyKey.set(companyScopeKey(transfer.scope, idempotencyKey), transfer);
    this.saved.push(transfer);
  }

  async findDispatchByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.byDispatchIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveDispatch(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    this.byId.set(transfer.id, transfer);
    this.linesByTransfer.set(transfer.id, [...lines]);
    this.byDispatchIdempotencyKey.set(companyScopeKey(transfer.scope, idempotencyKey), transfer);
    this.saved.push(transfer);
  }

  async findReceiptByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.byReceiptIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveReceipt(transfer: InventoryTransfer, lines: readonly InventoryTransferLine[], idempotencyKey: string): Promise<void> {
    this.byId.set(transfer.id, transfer);
    this.linesByTransfer.set(transfer.id, [...lines]);
    this.byReceiptIdempotencyKey.set(companyScopeKey(transfer.scope, idempotencyKey), transfer);
    this.saved.push(transfer);
  }

  async findCancellationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<InventoryTransfer | null> {
    return this.byCancellationIdempotencyKey.get(companyScopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveCancellation(transfer: InventoryTransfer, idempotencyKey: string): Promise<void> {
    this.byId.set(transfer.id, transfer);
    this.byCancellationIdempotencyKey.set(companyScopeKey(transfer.scope, idempotencyKey), transfer);
    this.saved.push(transfer);
  }
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();
  private readonly byIdempotencyKey = new Map<string, Payment>();
  private readonly byConfirmationIdempotencyKey = new Map<string, Payment>();
  readonly saved: Payment[] = [];
  readonly savedConfirmations: Payment[] = [];

  async findById(scope: TenantScope, paymentId: string): Promise<Payment | null> {
    const payment = this.byId.get(paymentId);
    return payment && payment.scope.equals(scope) ? payment : null;
  }

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<Payment | null> {
    return this.byIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async save(payment: Payment, idempotencyKey: string): Promise<void> {
    this.byId.set(payment.id, payment);
    this.byIdempotencyKey.set(scopeKey(payment.scope, idempotencyKey), payment);
    this.saved.push(payment);
  }

  async findConfirmationByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<Payment | null> {
    return this.byConfirmationIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveConfirmation(payment: Payment, idempotencyKey: string): Promise<void> {
    this.byId.set(payment.id, payment);
    this.byConfirmationIdempotencyKey.set(scopeKey(payment.scope, idempotencyKey), payment);
    this.savedConfirmations.push(payment);
  }
}

export class InMemoryPaymentAttemptRepository implements PaymentAttemptRepository {
  private readonly byPaymentId = new Map<string, PaymentAttempt>();
  private readonly byProviderReference = new Map<string, PaymentAttempt>();
  private readonly byConfirmationIdempotencyKey = new Map<string, PaymentAttempt>();
  readonly saved: PaymentAttempt[] = [];
  readonly savedConfirmations: PaymentAttempt[] = [];

  async findPendingByPaymentId(scope: TenantScope, paymentId: string): Promise<PaymentAttempt | null> {
    const attempt = this.byPaymentId.get(paymentId);
    return attempt && attempt.scope.equals(scope) && attempt.status === "PENDING" ? attempt : null;
  }

  async findByProviderReference(
    scope: TenantScope,
    providerCode: string,
    providerReferenceType: string,
    providerReference: string,
  ): Promise<PaymentAttempt | null> {
    const attempt = this.byProviderReference.get(scopeKey(scope, `${providerCode}:${providerReferenceType}:${providerReference}`));
    return attempt ?? null;
  }

  async save(attempt: PaymentAttempt, _idempotencyKey: string): Promise<void> {
    this.byPaymentId.set(attempt.paymentId, attempt);
    this.saved.push(attempt);
  }

  async findConfirmationByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<PaymentAttempt | null> {
    return this.byConfirmationIdempotencyKey.get(scopeKey(scope, idempotencyKey)) ?? null;
  }

  async saveConfirmation(attempt: PaymentAttempt, idempotencyKey: string): Promise<void> {
    this.byPaymentId.set(attempt.paymentId, attempt);
    if (attempt.providerCode && attempt.providerReferenceType && attempt.providerReference) {
      this.byProviderReference.set(
        scopeKey(attempt.scope, `${attempt.providerCode}:${attempt.providerReferenceType}:${attempt.providerReference}`),
        attempt,
      );
    }
    this.byConfirmationIdempotencyKey.set(scopeKey(attempt.scope, idempotencyKey), attempt);
    this.savedConfirmations.push(attempt);
  }
}

export class FixedPaymentAuthorization implements PaymentAuthorizationPort {
  constructor(private readonly allow: boolean) {}
  async canInitiatePayment(_actor: Actor, _scope: TenantScope): Promise<boolean> {
    return this.allow;
  }
}

/**
 * Test-only stand-in for FASE 4's explicitly-pending gate: no real
 * signature/HMAC scheme exists anywhere in this repository to implement
 * for real (confirmed during B28-PAYNOTIF's Fase 1 audit against
 * `provider-integration-matrix.md`). `allow` simulates "the evidence
 * passed / failed authenticity verification" — never a real check.
 */
export class FixedPaymentConfirmationAuthenticityPort implements PaymentConfirmationAuthenticityPort {
  constructor(private readonly allow: boolean) {}
  async verify(_evidence: PaymentConfirmationEvidence): Promise<boolean> {
    return this.allow;
  }
}

/**
 * In-memory stand-in for the still-undecided realtime transport (FASE
 * 2-G — no WebSocket/SSE/local-channel adapter exists yet). Tracks
 * dispatched `notificationId`s to exercise the FASE 2-F dedup contract
 * directly: calling `notify()` twice with the same notification returns
 * `DELIVERED` then `ALREADY_DELIVERED`, without needing a second full
 * payment confirmation.
 */
export class InMemoryPosNotificationPort implements PosNotificationPort {
  private readonly dispatched = new Set<string>();
  readonly notifications: PaymentConfirmedNotificationRequested[] = [];

  async notify(notification: PaymentConfirmedNotificationRequested): Promise<"DELIVERED" | "ALREADY_DELIVERED"> {
    if (this.dispatched.has(notification.notificationId)) return "ALREADY_DELIVERED";
    this.dispatched.add(notification.notificationId);
    this.notifications.push(notification);
    return "DELIVERED";
  }
}
