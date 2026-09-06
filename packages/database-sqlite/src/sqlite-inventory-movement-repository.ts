import { InventoryMovement, Quantity, TenantScope, type InventoryMovementDirection, type InventoryMovementType } from "@pos-platform/domain";
import { IdempotencyKeyConflictError, type InventoryMovementRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface InventoryMovementRow {
  id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  inventory_location_id: string;
  presentation_id: string;
  lot_id: string | null;
  movement_type: string;
  direction: string;
  quantity: string;
  reason_code: string | null;
  occurred_at: string;
  reference_type: string | null;
  reference_id: string | null;
}

/** B33: real SQLite adapter for `InventoryMovementRepository` over `MIGRATION_010`. Genuinely append-only — no mutation log needed. */
export class SqliteInventoryMovementRepository implements InventoryMovementRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryMovement | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM inventory_movements WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, idempotencyKey) as InventoryMovementRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async listPostedMovements(scope: TenantScope, inventoryLocationId: string, presentationId: string, lotId: string | null): Promise<readonly InventoryMovement[]> {
    const rows = (
      lotId === null
        ? this.database.native
            .prepare(`SELECT * FROM inventory_movements WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND inventory_location_id = ? AND presentation_id = ? AND lot_id IS NULL`)
            .all(scope.tenantId, scope.companyId, scope.branchId, inventoryLocationId, presentationId)
        : this.database.native
            .prepare(`SELECT * FROM inventory_movements WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND inventory_location_id = ? AND presentation_id = ? AND lot_id = ?`)
            .all(scope.tenantId, scope.companyId, scope.branchId, inventoryLocationId, presentationId, lotId)
    ) as InventoryMovementRow[];
    return rows.map((row) => this.toDomain(row));
  }

  async save(movement: InventoryMovement, idempotencyKey: string): Promise<void> {
    try {
      this.database.native
        .prepare(
          `INSERT INTO inventory_movements (
            id, tenant_id, company_id, branch_id, inventory_location_id, presentation_id, lot_id,
            movement_type, direction, quantity, reason_code, status, occurred_at, reference_type, reference_id,
            idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          movement.id, movement.scope.tenantId, movement.scope.companyId, movement.scope.branchId,
          movement.inventoryLocationId, movement.presentationId, movement.lotId, movement.movementType,
          movement.direction, movement.quantity.toString(), movement.reasonCode, movement.status,
          movement.occurredAt.toISOString(), movement.referenceType, movement.referenceId,
          idempotencyKey, new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed idempotency_key for tenant ${movement.scope.tenantId}`);
      }
      throw error;
    }
  }

  private toDomain(row: InventoryMovementRow): InventoryMovement {
    return InventoryMovement.register({
      id: row.id,
      scope: new TenantScope(row.tenant_id, row.company_id, row.branch_id),
      inventoryLocationId: row.inventory_location_id,
      presentationId: row.presentation_id,
      lotId: row.lot_id,
      movementType: row.movement_type as InventoryMovementType,
      direction: row.direction as InventoryMovementDirection,
      quantity: Quantity.fromString(row.quantity),
      reasonCode: row.reason_code,
      occurredAt: new Date(row.occurred_at),
      referenceType: row.reference_type,
      referenceId: row.reference_id,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
