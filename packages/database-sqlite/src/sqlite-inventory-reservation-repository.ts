import { randomUUID } from "node:crypto";
import { InventoryReservation, Quantity, TenantScope, type InventoryReservationStatus } from "@pos-platform/domain";
import { IdempotencyKeyConflictError, InventoryReservationConflictError, type InventoryReservationRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface InventoryReservationRow {
  id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  inventory_location_id: string;
  presentation_id: string;
  lot_id: string | null;
  reference_type: string;
  reference_id: string;
  quantity: string;
  consumed_quantity: string;
  released_quantity: string;
  status: string;
  expires_at: string | null;
  version: number;
}

interface MutationLogRow {
  snapshot_json: string;
}

interface ReservationSnapshot {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string;
  inventoryLocationId: string;
  presentationId: string;
  lotId: string | null;
  referenceType: string;
  referenceId: string;
  quantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
  status: InventoryReservationStatus;
  expiresAt: string | null;
  version: number;
}

/**
 * B33: real SQLite adapter for `InventoryReservationRepository` over
 * `MIGRATION_010`. Same mutation-log pattern `SqliteProductRepository`
 * established for Product: `create`/`consume`/`release` all mutate the
 * SAME physical row, so an old idempotency key replayed after a LATER
 * mutation must return its OWN historical snapshot, not the current
 * (drifted) row.
 */
export class SqliteInventoryReservationRepository implements InventoryReservationRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findById(scope: TenantScope, reservationId: string): Promise<InventoryReservation | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM inventory_reservations WHERE tenant_id = ? AND company_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, reservationId) as InventoryReservationRow | undefined;
    return row && row.branch_id === scope.branchId ? this.toDomain(row) : null;
  }

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.findLogged(scope, "CREATE", idempotencyKey);
  }

  async save(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const run = this.database.native.transaction(() => {
      this.database.native
        .prepare(
          `INSERT INTO inventory_reservations (
            id, tenant_id, company_id, branch_id, inventory_location_id, presentation_id, lot_id,
            reference_type, reference_id, quantity, consumed_quantity, released_quantity, status,
            expires_at, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reservation.id, reservation.scope.tenantId, reservation.scope.companyId, reservation.scope.branchId,
          reservation.inventoryLocationId, reservation.presentationId, reservation.lotId,
          reservation.referenceType, reservation.referenceId, reservation.quantity.toString(),
          reservation.consumedQuantity.toString(), reservation.releasedQuantity.toString(), reservation.status,
          reservation.expiresAt?.toISOString() ?? null, reservation.version, now, now,
        );
      this.insertLog(reservation, "CREATE", idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${reservation.scope.tenantId}`);
      }
      throw error;
    }
  }

  async findConsumptionByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.findLogged(scope, "CONSUME", idempotencyKey);
  }

  async saveConsumption(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    await this.saveMutation(reservation, "CONSUME", idempotencyKey);
  }

  async findReleaseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<InventoryReservation | null> {
    return this.findLogged(scope, "RELEASE", idempotencyKey);
  }

  async saveRelease(reservation: InventoryReservation, idempotencyKey: string): Promise<void> {
    await this.saveMutation(reservation, "RELEASE", idempotencyKey);
  }

  async listOutstanding(scope: TenantScope, inventoryLocationId: string, presentationId: string, lotId: string | null): Promise<readonly InventoryReservation[]> {
    const rows = (
      lotId === null
        ? this.database.native
            .prepare(`SELECT * FROM inventory_reservations WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND inventory_location_id = ? AND presentation_id = ? AND lot_id IS NULL`)
            .all(scope.tenantId, scope.companyId, scope.branchId, inventoryLocationId, presentationId)
        : this.database.native
            .prepare(`SELECT * FROM inventory_reservations WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND inventory_location_id = ? AND presentation_id = ? AND lot_id = ?`)
            .all(scope.tenantId, scope.companyId, scope.branchId, inventoryLocationId, presentationId, lotId)
    ) as InventoryReservationRow[];
    return rows.map((row) => this.toDomain(row));
  }

  private async saveMutation(reservation: InventoryReservation, operation: "CONSUME" | "RELEASE", idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const priorVersion = reservation.version - 1;
    const run = this.database.native.transaction(() => {
      const result = this.database.native
        .prepare(
          `UPDATE inventory_reservations
           SET consumed_quantity = ?, released_quantity = ?, status = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(reservation.consumedQuantity.toString(), reservation.releasedQuantity.toString(), reservation.status, reservation.version, now, reservation.id, priorVersion);
      if (result.changes === 0) {
        throw new InventoryReservationConflictError(`reservation ${reservation.id} version moved before this ${operation.toLowerCase()} could be saved (expected prior version ${priorVersion})`);
      }
      this.insertLog(reservation, operation, idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (error instanceof InventoryReservationConflictError) throw error;
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed ${operation} idempotency_key for reservation ${reservation.id}`);
      }
      throw error;
    }
  }

  private insertLog(reservation: InventoryReservation, operation: "CREATE" | "CONSUME" | "RELEASE", idempotencyKey: string, now: string): void {
    this.database.native
      .prepare(
        `INSERT INTO inventory_reservation_mutation_log (id, tenant_id, company_id, operation, idempotency_key, reservation_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), reservation.scope.tenantId, reservation.scope.companyId, operation, idempotencyKey, reservation.id, JSON.stringify(this.toSnapshot(reservation)), now);
  }

  private findLogged(scope: TenantScope, operation: "CREATE" | "CONSUME" | "RELEASE", idempotencyKey: string): InventoryReservation | null {
    const row = this.database.native
      .prepare(`SELECT snapshot_json FROM inventory_reservation_mutation_log WHERE tenant_id = ? AND company_id = ? AND operation = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, operation, idempotencyKey) as MutationLogRow | undefined;
    if (!row) return null;
    return this.fromSnapshot(JSON.parse(row.snapshot_json) as ReservationSnapshot);
  }

  private toSnapshot(reservation: InventoryReservation): ReservationSnapshot {
    return {
      id: reservation.id, tenantId: reservation.scope.tenantId, companyId: reservation.scope.companyId, branchId: reservation.scope.branchId,
      inventoryLocationId: reservation.inventoryLocationId, presentationId: reservation.presentationId, lotId: reservation.lotId,
      referenceType: reservation.referenceType, referenceId: reservation.referenceId, quantity: reservation.quantity.toString(),
      consumedQuantity: reservation.consumedQuantity.toString(), releasedQuantity: reservation.releasedQuantity.toString(),
      status: reservation.status, expiresAt: reservation.expiresAt?.toISOString() ?? null, version: reservation.version,
    };
  }

  private fromSnapshot(snapshot: ReservationSnapshot): InventoryReservation {
    return InventoryReservation.restore({
      id: snapshot.id,
      scope: new TenantScope(snapshot.tenantId, snapshot.companyId, snapshot.branchId),
      inventoryLocationId: snapshot.inventoryLocationId,
      presentationId: snapshot.presentationId,
      lotId: snapshot.lotId,
      referenceType: snapshot.referenceType,
      referenceId: snapshot.referenceId,
      quantity: Quantity.fromString(snapshot.quantity),
      consumedQuantity: Quantity.fromString(snapshot.consumedQuantity),
      releasedQuantity: Quantity.fromString(snapshot.releasedQuantity),
      status: snapshot.status,
      expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
      version: snapshot.version,
    });
  }

  private toDomain(row: InventoryReservationRow): InventoryReservation {
    return InventoryReservation.restore({
      id: row.id,
      scope: new TenantScope(row.tenant_id, row.company_id, row.branch_id),
      inventoryLocationId: row.inventory_location_id,
      presentationId: row.presentation_id,
      lotId: row.lot_id,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      quantity: Quantity.fromString(row.quantity),
      consumedQuantity: Quantity.fromString(row.consumed_quantity),
      releasedQuantity: Quantity.fromString(row.released_quantity),
      status: row.status as InventoryReservationStatus,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      version: row.version,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
