import {
  Actor,
  CashMovement,
  CashShift,
  Money,
  TenantScope,
  type ActorType,
  type CashCount,
  type CashMovementDirection,
  type CashMovementStatus,
  type CashMovementType,
  type CashShiftStatus,
} from "@pos-platform/domain";
import {
  IdempotencyKeyConflictError,
  IncompatibleShiftOpenConflictError,
  type CashShiftPhysicalContext,
  type CashShiftRepository,
} from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface CashShiftRow {
  id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  cash_register_id: string;
  origin_device_id: string;
  opened_by_actor_type: string;
  opened_by_actor_id: string;
  opened_at: string;
  status: string;
  closed_at: string | null;
  version: number;
  opening_idempotency_key: string;
  opening_request_checksum: string;
}

interface CashMovementRow {
  id: string;
  cash_shift_id: string;
  shift_sequence: number;
  movement_type: string;
  direction: string;
  amount: string;
  status: string;
  occurred_at: string;
}

const OPENING_MOVEMENT_SEQUENCE = 1;

const NOT_IMPLEMENTED_MOVEMENT =
  "SqliteCashShiftRepository does not implement movement persistence: RegisterCashMovementCommand does not carry the " +
  "physical bookkeeping cash_movements requires as NOT NULL beyond what OPENING_FLOAT derives internally (currency_code, " +
  "business_date, reason_code, correlation_id, device_reported_at). Deferred, not fabricated — see " +
  "docs/migration/cash-materialization-result.md.";

const NOT_IMPLEMENTED_CLOSE =
  "SqliteCashShiftRepository does not implement close persistence: no close command carries the physical bookkeeping " +
  "cash_counts/cash_difference_reviews require as NOT NULL (calculation/tolerance policy versions and checksums, " +
  "correlation_id, severity...). Deferred, not fabricated — see docs/migration/cash-materialization-result.md.";

/**
 * Bloque 22 (materialization): real SQLite adapter for `CashShiftRepository`,
 * backing the CASH-001 OPEN vertical with genuine physical persistence over
 * `MIGRATION_006` (local-database.ts). Movement/close methods are present
 * for interface compliance but throw explicitly — see the two constants
 * above — rather than insert rows with invented data, per this project's
 * no-fabrication rule. Uses raw `better-sqlite3` prepared statements,
 * matching this package's only established pattern (no adapter in this repo
 * uses the `kysely` dependency despite it being declared).
 */
export class SqliteCashShiftRepository implements CashShiftRepository {
  constructor(private readonly database: LocalDatabase) {}

  async hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string, originDeviceId: string): Promise<boolean> {
    // Mirrors cash_shifts_incompatible_idx exactly (tenant, branch, register,
    // device — no company_id, per cash-counting-schema.md rule 2: "por
    // tenant, sucursal, caja y dispositivo"). Filtering by company_id here
    // would be stricter than the physical constraint and could produce a
    // false negative against a real collision.
    const row = this.database.native
      .prepare(
        `SELECT 1 FROM cash_shifts
         WHERE tenant_id = ? AND branch_id = ? AND cash_register_id = ? AND origin_device_id = ?
           AND status IN ('OPEN', 'CLOSING')
         LIMIT 1`,
      )
      .get(scope.tenantId, scope.branchId, cashRegisterId, originDeviceId);
    return row !== undefined;
  }

  async findOpenByIdempotencyKey(
    scope: TenantScope,
    originDeviceId: string,
    idempotencyKey: string,
  ): Promise<{ shift: CashShift; checksum: string } | null> {
    // Tuple is (tenant_id, origin_device_id, opening_idempotency_key) per
    // Bloque 17 D5 (cash-owner-decisions-resolved.md) — deliberately not
    // scoped by company/branch, matching the physical UNIQUE constraint
    // exactly. The returned shift carries its own real company/branch from
    // the row, not the caller's — a genuine cross-branch collision (only
    // reachable if the same device coincidentally reuses a key across two
    // branches) surfaces honestly instead of being silently coerced into
    // the caller's scope.
    const row = this.database.native
      .prepare(`SELECT * FROM cash_shifts WHERE tenant_id = ? AND origin_device_id = ? AND opening_idempotency_key = ?`)
      .get(scope.tenantId, originDeviceId, idempotencyKey) as CashShiftRow | undefined;
    if (!row) return null;
    return { shift: this.toDomainShift(row), checksum: row.opening_request_checksum };
  }

  async save(
    shift: CashShift,
    movement: CashMovement,
    idempotencyKey: string,
    checksum: string,
    physicalContext: CashShiftPhysicalContext,
  ): Promise<void> {
    const openedAt = shift.openedAt.toISOString();
    const occurredAt = movement.occurredAt.toISOString();

    const run = this.database.native.transaction(() => {
      this.database.native
        .prepare(
          `INSERT INTO cash_shifts (
            id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
            opened_by_actor_type, opened_by_actor_id, opened_at, business_date, timezone_id,
            utc_offset_minutes, currency_code, status, opening_idempotency_key,
            opening_request_checksum, last_movement_sequence, version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          shift.id,
          shift.scope.tenantId,
          shift.scope.companyId,
          shift.scope.branchId,
          shift.cashRegisterId,
          shift.originDeviceId,
          shift.openedByActor.type,
          shift.openedByActor.id,
          openedAt,
          physicalContext.businessDate,
          physicalContext.timezoneId,
          physicalContext.utcOffsetMinutes,
          physicalContext.currencyCode,
          shift.status,
          idempotencyKey,
          checksum,
          movement.shiftSequence,
          shift.version,
          openedAt,
        );

      this.database.native
        .prepare(
          `INSERT INTO cash_movements (
            id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, shift_sequence,
            movement_type, direction, amount, currency_code, status, reference_type, reason_code,
            actor_type, actor_id, business_date, occurred_at, device_reported_at, origin_device_id,
            idempotency_key, request_checksum, correlation_id, version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          movement.id,
          shift.scope.tenantId,
          shift.scope.companyId,
          shift.scope.branchId,
          shift.cashRegisterId,
          movement.cashShiftId,
          movement.shiftSequence,
          movement.movementType,
          movement.direction,
          movement.amount.toString(),
          physicalContext.currencyCode,
          movement.status,
          // reference_type/reason_code: OPENING_FLOAT has no external
          // referenced entity (unlike e.g. a sale-triggered movement) — a
          // fixed constant describing the movement's own cause, not an
          // invented business value. Derived, documented, not owner-decided.
          "CASH_SHIFT_OPEN",
          "CASH_SHIFT_OPENED",
          shift.openedByActor.type,
          shift.openedByActor.id,
          physicalContext.businessDate,
          occurredAt,
          // device_reported_at: identical to occurred_at for this specific
          // movement — it is constructed and persisted in the same local
          // transaction with no reporting delay possible, unlike a general
          // movement a device could queue and report later.
          occurredAt,
          shift.originDeviceId,
          idempotencyKey,
          checksum,
          // correlation_id: the shift's own id — opening the shift and
          // creating its OPENING_FLOAT movement are one logical operation,
          // and no other correlation source exists on OpenCashShiftCommand.
          shift.id,
          1,
          occurredAt,
        );
    });

    try {
      run();
    } catch (error) {
      if (isUniqueConstraintViolation(error, "opening_idempotency_key")) {
        throw new IdempotencyKeyConflictError(
          `opening_idempotency_key already exists for tenant ${shift.scope.tenantId}, device ${shift.originDeviceId}`,
        );
      }
      // cash_shifts_incompatible_idx: the same physical race as above, on
      // the OTHER unique constraint a concurrent save() can hit (see
      // IncompatibleShiftOpenConflictError's doc comment on the port).
      // better-sqlite3's message lists the violated columns, not the index
      // name — "opening_idempotency_key" is already ruled out above, so a
      // remaining "origin_device_id" mention can only mean this constraint
      // (cash_shifts.tenant_id, branch_id, cash_register_id, origin_device_id).
      if (isUniqueConstraintViolation(error, "origin_device_id")) {
        throw new IncompatibleShiftOpenConflictError(
          `an incompatible OPEN/CLOSING shift already exists for tenant ${shift.scope.tenantId}, branch ${shift.scope.branchId}, register ${shift.cashRegisterId}, device ${shift.originDeviceId}`,
        );
      }
      throw error;
    }
  }

  async findById(scope: TenantScope, cashShiftId: string): Promise<CashShift | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM cash_shifts WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, scope.branchId, cashShiftId) as CashShiftRow | undefined;
    if (!row) return null;
    return this.toDomainShift(row);
  }

  async listPostedMovements(cashShiftId: string): Promise<readonly CashMovement[]> {
    const rows = this.database.native
      .prepare(`SELECT * FROM cash_movements WHERE cash_shift_id = ? AND status = 'POSTED' ORDER BY shift_sequence ASC`)
      .all(cashShiftId) as CashMovementRow[];
    return rows.map((row) => this.toDomainMovement(row));
  }

  async nextMovementSequence(cashShiftId: string): Promise<number> {
    const row = this.database.native
      .prepare(`SELECT COALESCE(MAX(shift_sequence), 0) AS maxSequence FROM cash_movements WHERE cash_shift_id = ?`)
      .get(cashShiftId) as { maxSequence: number };
    return row.maxSequence + 1;
  }

  async findMovementByIdempotencyKey(): Promise<CashMovement | null> {
    throw new Error(NOT_IMPLEMENTED_MOVEMENT);
  }

  async saveMovement(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_MOVEMENT);
  }

  async findCloseByIdempotencyKey(): Promise<CashCount | null> {
    throw new Error(NOT_IMPLEMENTED_CLOSE);
  }

  async saveClose(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_CLOSE);
  }

  private toDomainShift(row: CashShiftRow): CashShift {
    if (row.status !== "OPEN" && row.status !== "CLOSED") {
      throw new Error(`cash_shifts.status '${row.status}' has no CashShiftStatus representation (domain models OPEN/CLOSED only)`);
    }
    const status = row.status as CashShiftStatus;

    const openingMovement = this.database.native
      .prepare(`SELECT amount FROM cash_movements WHERE cash_shift_id = ? AND shift_sequence = ?`)
      .get(row.id, OPENING_MOVEMENT_SEQUENCE) as { amount: string } | undefined;
    if (!openingMovement) {
      throw new Error(`cash shift ${row.id} has no shift_sequence=1 movement to derive its opening amount from`);
    }

    return CashShift.restore({
      id: row.id,
      scope: new TenantScope(row.tenant_id, row.company_id, row.branch_id),
      cashRegisterId: row.cash_register_id,
      originDeviceId: row.origin_device_id,
      openedByActor: Actor.restore(row.opened_by_actor_type as ActorType, row.opened_by_actor_id),
      openedAt: new Date(row.opened_at),
      openingAmount: Money.fromString(openingMovement.amount),
      status,
      version: row.version,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
    });
  }

  private toDomainMovement(row: CashMovementRow): CashMovement {
    return CashMovement.restore({
      id: row.id,
      cashShiftId: row.cash_shift_id,
      shiftSequence: row.shift_sequence,
      movementType: row.movement_type as CashMovementType,
      direction: row.direction as CashMovementDirection,
      amount: Money.fromString(row.amount),
      status: row.status as CashMovementStatus,
      occurredAt: new Date(row.occurred_at),
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
