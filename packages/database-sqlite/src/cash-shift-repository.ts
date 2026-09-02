import {
  Actor,
  CashCount,
  CashMovement,
  CashShift,
  Money,
  TenantScope,
  type ActorType,
  type CashCountDifferenceType,
  type CashDifferenceReview,
  type CashMovementDirection,
  type CashMovementStatus,
  type CashMovementType,
  type CashShiftStatus,
} from "@pos-platform/domain";
import {
  CashCloseConflictError,
  CashMovementConflictError,
  IdempotencyKeyConflictError,
  IncompatibleShiftOpenConflictError,
  type CashClosePhysicalContext,
  type CashMovementPhysicalContext,
  type CashShiftPhysicalContext,
  type CashShiftRepository,
} from "@pos-platform/application";
import {
  CASH_CALCULATION_BEHAVIOR_CHECKSUM,
  CASH_NO_POLICY_SENTINEL_UUID,
  CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
  type LocalDatabase,
} from "./local-database.js";

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
  business_date: string;
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

interface CashCountRow {
  id: string;
  cash_shift_id: string;
  expected_amount: string;
  counted_amount: string;
  difference_amount: string;
  difference_type: string;
  movement_cutoff_sequence: number;
  completed_at: string;
}

const OPENING_MOVEMENT_SEQUENCE = 1;

/**
 * Bloque 22 (CASH-001) + Bloque 23 (CASH-002/CASH-003): real SQLite adapter
 * for `CashShiftRepository`, backing all three Cash use cases with genuine
 * physical persistence over `MIGRATION_006`/`MIGRATION_007`
 * (local-database.ts). Uses raw `better-sqlite3` prepared statements,
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

  async findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null> {
    // Full TenantScope, not the (tenant_id, origin_device_id) tuple OPEN
    // uses — see the port doc comment: that narrower tuple was a specific,
    // evidenced decision for OPEN only (Bloque 17 D5), never made here.
    const row = this.database.native
      .prepare(`SELECT * FROM cash_movements WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, scope.branchId, idempotencyKey) as CashMovementRow | undefined;
    return row ? this.toDomainMovement(row) : null;
  }

  async saveMovement(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string, physicalContext: CashMovementPhysicalContext): Promise<void> {
    const priorVersion = shift.version - 1;
    const occurredAt = movement.occurredAt.toISOString();

    const run = this.database.native.transaction(() => {
      // businessDate is derived from the owning shift, not re-asked of the
      // caller: a movement always happens within an already-open shift, and
      // RegisterCashMovementCommand has no business-date concept of its own.
      const shiftRow = this.database.native
        .prepare(`SELECT business_date FROM cash_shifts WHERE id = ?`)
        .get(shift.id) as { business_date: string } | undefined;
      if (!shiftRow) throw new Error(`cash shift ${shift.id} not found while saving its movement`);

      const updateResult = this.database.native
        .prepare(`UPDATE cash_shifts SET version = ?, last_movement_sequence = ? WHERE id = ? AND version = ?`)
        .run(shift.version, movement.shiftSequence, shift.id, priorVersion);
      if (updateResult.changes === 0) {
        throw new CashMovementConflictError(`cash shift ${shift.id} version moved before this movement could be saved (expected prior version ${priorVersion})`);
      }

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
          // reference_type: no external reference entity is modeled for a
          // manually-registered movement (register-cash-movement.ts's own
          // doc comment: no CashRegister/approval-policy source exists).
          "CASH_MOVEMENT",
          physicalContext.reasonCode,
          physicalContext.actor.type,
          physicalContext.actor.id,
          shiftRow.business_date,
          occurredAt,
          // device_reported_at: same reasoning as OPENING_FLOAT in save() —
          // this movement is constructed and persisted in the same local
          // transaction, no reporting delay is possible here.
          occurredAt,
          physicalContext.originDeviceId,
          idempotencyKey,
          checksum,
          // correlation_id: the movement's own id — a standalone event with
          // no richer operation to anchor to, unlike OPEN's shift-anchored
          // OPENING_FLOAT or CLOSE's count-anchored review.
          movement.id,
          1,
          occurredAt,
        );
    });

    try {
      run();
    } catch (error) {
      if (error instanceof CashMovementConflictError) throw error;
      if (isAnyUniqueConstraintViolation(error)) {
        throw new CashMovementConflictError(`a concurrent write already claimed this movement's idempotency key or sequence for shift ${shift.id}`);
      }
      throw error;
    }
  }

  async findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null> {
    // Full TenantScope, same reasoning as findMovementByIdempotencyKey.
    // start_idempotency_key used (not completion_idempotency_key): it is the
    // NOT NULL column, guaranteed populated on every row saveClose() writes.
    const row = this.database.native
      .prepare(`SELECT * FROM cash_counts WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND start_idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, scope.branchId, idempotencyKey) as CashCountRow | undefined;
    return row ? this.toDomainCount(row) : null;
  }

  async saveClose(
    shift: CashShift,
    count: CashCount,
    review: CashDifferenceReview | null,
    idempotencyKey: string,
    checksum: string,
    physicalContext: CashClosePhysicalContext,
  ): Promise<void> {
    const priorVersion = shift.version - 1;
    const closedAt = shift.closedAt ? shift.closedAt.toISOString() : (() => { throw new Error(`shift ${shift.id} passed to saveClose has no closedAt`); })();

    const run = this.database.native.transaction(() => {
      const updateResult = this.database.native
        .prepare(
          `UPDATE cash_shifts
           SET status = ?, closed_by_actor_type = ?, closed_by_actor_id = ?, closed_at = ?, version = ?,
               closing_idempotency_key = ?, closing_request_checksum = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          shift.status,
          physicalContext.closedByActor.type,
          physicalContext.closedByActor.id,
          closedAt,
          shift.version,
          idempotencyKey,
          checksum,
          shift.id,
          priorVersion,
        );
      if (updateResult.changes === 0) {
        throw new CashCloseConflictError(`cash shift ${shift.id} version moved before this close could be saved (expected prior version ${priorVersion})`);
      }

      this.database.native
        .prepare(
          `INSERT INTO cash_counts (
            id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, count_type, status,
            started_shift_version, movement_cutoff_sequence, calculation_policy_version,
            calculation_checksum, expected_amount, counted_amount,
            difference_amount, difference_type, currency_code, denomination_breakdown_status,
            tolerance_policy_version, tolerance_policy_checksum,
            started_by_actor_type, started_by_actor_id, started_at, completed_by_actor_type,
            completed_by_actor_id, completed_at, origin_device_id, start_idempotency_key,
            start_request_checksum, completion_idempotency_key, completion_request_checksum,
            correlation_id, version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          count.id,
          shift.scope.tenantId,
          shift.scope.companyId,
          shift.scope.branchId,
          shift.cashRegisterId,
          count.cashShiftId,
          // count_type/status: CashCount.closing() only ever models this one
          // case (its own doc comment: "Scoped to the CLOSING count only").
          "CLOSING",
          "COMPLETED",
          priorVersion,
          count.movementCutoffSequence,
          // Bloque 23-D: D1 (cash-human-decisions.md, RESOLVED) requires
          // these NOT NULL as references toward a future, unmaterialized
          // CashPolicyVersion — not a new entity, not fabricated business
          // data. See local-database.ts's doc comment on these constants.
          CASH_NO_POLICY_SENTINEL_UUID,
          CASH_CALCULATION_BEHAVIOR_CHECKSUM,
          count.expectedAmount.toString(),
          count.countedAmount.toString(),
          count.differenceAmount.toString(),
          count.differenceType,
          physicalContext.currencyCode,
          // denomination_breakdown_status: CashCount has no denomination
          // field at all (close-cash-shift.ts's own doc comment) — this
          // accurately states none was provided, not an invented default.
          "NOT_PROVIDED",
          CASH_NO_POLICY_SENTINEL_UUID,
          CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
          physicalContext.closedByActor.type,
          physicalContext.closedByActor.id,
          closedAt,
          physicalContext.closedByActor.type,
          physicalContext.closedByActor.id,
          closedAt,
          physicalContext.originDeviceId,
          // start/completion idempotency key+checksum: the same value twice
          // — CloseCashShiftUseCase has no separate start phase, both
          // happen atomically in this one call.
          idempotencyKey,
          checksum,
          idempotencyKey,
          checksum,
          // correlation_id: the count's own id ties the (optional) review
          // back to the same logical close operation.
          count.id,
          1,
          closedAt,
        );

      if (review) {
        this.database.native
          .prepare(
            `INSERT INTO cash_difference_reviews (
              id, tenant_id, company_id, branch_id, cash_shift_id, cash_count_id, status,
              tolerance_policy_version, tolerance_policy_checksum,
              requires_segregation, created_at, version, correlation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            review.id,
            shift.scope.tenantId,
            shift.scope.companyId,
            shift.scope.branchId,
            review.cashShiftId,
            review.cashCountId,
            review.status,
            // Bloque 23-D: same D1 sentinel as cash_counts above.
            CASH_NO_POLICY_SENTINEL_UUID,
            CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
            // requires_segregation: no segregation-of-duties policy exists
            // anywhere in this codebase (MIGRATION_007) — left absent
            // rather than asserting a false "never required".
            null,
            review.createdAt.toISOString(),
            1,
            count.id,
          );
      }
    });

    try {
      run();
    } catch (error) {
      if (error instanceof CashCloseConflictError) throw error;
      if (isAnyUniqueConstraintViolation(error)) {
        throw new CashCloseConflictError(`a concurrent write already claimed this close's idempotency key for shift ${shift.id}`);
      }
      throw error;
    }
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

  private toDomainCount(row: CashCountRow): CashCount {
    return CashCount.restore({
      id: row.id,
      cashShiftId: row.cash_shift_id,
      expectedAmount: Money.fromString(row.expected_amount),
      countedAmount: Money.fromString(row.counted_amount),
      differenceAmount: Money.fromString(row.difference_amount),
      differenceType: row.difference_type as CashCountDifferenceType,
      movementCutoffSequence: row.movement_cutoff_sequence,
      completedAt: new Date(row.completed_at),
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}

function isAnyUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}
