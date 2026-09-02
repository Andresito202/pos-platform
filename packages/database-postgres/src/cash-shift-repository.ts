import type { PoolClient } from "pg";
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
import { CASH_CALCULATION_BEHAVIOR_CHECKSUM, CASH_NO_POLICY_SENTINEL_UUID, CASH_TOLERANCE_BEHAVIOR_CHECKSUM } from "./cash-policy-sentinel.js";
import type { PostgresDatabase } from "./postgres-database.js";

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
 * Bloque 24-B: real PostgreSQL adapter for `CashShiftRepository`, the same
 * port `SqliteCashShiftRepository` implements — proving PostgreSQL can back
 * the identical Cash contract (idempotency, optimistic concurrency,
 * transactions, D1's sentinel), not a parallel design. Behavior mirrors the
 * SQLite adapter method-for-method; only the storage mechanics differ
 * (parameterized `$n` queries via `pg`, PostgreSQL error codes instead of
 * SQLite's, RLS via `SET LOCAL app.tenant_id`).
 *
 * Lifecycle difference from `SqliteCashShiftRepository` (deliberate, not an
 * oversight): SQLite has no RLS, so one long-lived adapter instance safely
 * serves every tenant. PostgreSQL's `FORCE ROW LEVEL SECURITY` requires
 * `app.tenant_id` set on every connection before a tenant-scoped table is
 * even visible to `pos_app` — including `nextMovementSequence`/
 * `listPostedMovements`, the two port methods that don't receive a `scope`
 * parameter (SQLite never needed one). Rather than widen the shared port
 * (a contract change affecting the SQLite adapter too, for a PostgreSQL-only
 * constraint), this adapter is constructed per tenant: the caller — which
 * already knows the tenant from the command it's about to execute — passes
 * `tenantId` once, and every method call sets that same RLS context. Methods
 * that DO receive an explicit `scope` still use its `tenantId` (not the
 * constructor's) for the actual query, so a genuine caller bug (constructing
 * the repository for one tenant, then calling it with another) fails via RLS
 * rather than silently succeeding.
 */
export class PostgresCashShiftRepository implements CashShiftRepository {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly tenantId: string,
  ) {}

  async hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string, originDeviceId: string): Promise<boolean> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM cash.cash_shifts
         WHERE tenant_id = $1 AND branch_id = $2 AND cash_register_id = $3 AND origin_device_id = $4
           AND status IN ('OPEN', 'CLOSING')
         LIMIT 1`,
        [scope.tenantId, scope.branchId, cashRegisterId, originDeviceId],
      );
      return result.rows.length > 0;
    });
  }

  async findOpenByIdempotencyKey(
    scope: TenantScope,
    originDeviceId: string,
    idempotencyKey: string,
  ): Promise<{ shift: CashShift; checksum: string } | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<CashShiftRow>(
        `SELECT id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id, opened_by_actor_type,
                opened_by_actor_id, opened_at, business_date, status, closed_at, version, opening_request_checksum
         FROM cash.cash_shifts WHERE tenant_id = $1 AND origin_device_id = $2 AND opening_idempotency_key = $3`,
        [scope.tenantId, originDeviceId, idempotencyKey],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { shift: await this.toDomainShift(client, row), checksum: row.opening_request_checksum };
    });
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
    try {
      await this.database.withTenantTransaction(shift.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO cash.cash_shifts (
            id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
            opened_by_actor_type, opened_by_actor_id, opened_at, business_date, timezone_id,
            utc_offset_minutes, currency_code, status, opening_idempotency_key,
            opening_request_checksum, last_movement_sequence, version, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            shift.id, shift.scope.tenantId, shift.scope.companyId, shift.scope.branchId, shift.cashRegisterId,
            shift.originDeviceId, shift.openedByActor.type, shift.openedByActor.id, openedAt,
            physicalContext.businessDate, physicalContext.timezoneId, physicalContext.utcOffsetMinutes,
            physicalContext.currencyCode, shift.status, idempotencyKey, checksum, movement.shiftSequence,
            shift.version, openedAt,
          ],
        );
        await client.query(
          `INSERT INTO cash.cash_movements (
            id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, shift_sequence,
            movement_type, direction, amount, currency_code, status, reference_type, reason_code,
            actor_type, actor_id, business_date, occurred_at, device_reported_at, origin_device_id,
            idempotency_key, request_checksum, correlation_id, version, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [
            movement.id, shift.scope.tenantId, shift.scope.companyId, shift.scope.branchId, shift.cashRegisterId,
            movement.cashShiftId, movement.shiftSequence, movement.movementType, movement.direction,
            movement.amount.toString(), physicalContext.currencyCode, movement.status,
            "CASH_SHIFT_OPEN", "CASH_SHIFT_OPENED", shift.openedByActor.type, shift.openedByActor.id,
            physicalContext.businessDate, occurredAt, occurredAt, shift.originDeviceId, idempotencyKey,
            checksum, shift.id, 1, occurredAt,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "cash_shifts_opening_idempotency_uq")) {
        throw new IdempotencyKeyConflictError(
          `opening_idempotency_key already exists for tenant ${shift.scope.tenantId}, device ${shift.originDeviceId}`,
        );
      }
      if (isUniqueViolation(error, "cash_shifts_incompatible_idx")) {
        throw new IncompatibleShiftOpenConflictError(
          `an incompatible OPEN/CLOSING shift already exists for tenant ${shift.scope.tenantId}, branch ${shift.scope.branchId}, register ${shift.cashRegisterId}, device ${shift.originDeviceId}`,
        );
      }
      throw error;
    }
  }

  async findById(scope: TenantScope, cashShiftId: string): Promise<CashShift | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<CashShiftRow>(
        `SELECT id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id, opened_by_actor_type,
                opened_by_actor_id, opened_at, business_date, status, closed_at, version, opening_request_checksum
         FROM cash.cash_shifts WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND id = $4`,
        [scope.tenantId, scope.companyId, scope.branchId, cashShiftId],
      );
      const row = result.rows[0];
      return row ? this.toDomainShift(client, row) : null;
    });
  }

  async listPostedMovements(cashShiftId: string): Promise<readonly CashMovement[]> {
    return this.database.withTenantTransaction(this.tenantId, async (client) => {
      const result = await client.query<CashMovementRow>(
        `SELECT id, cash_shift_id, shift_sequence, movement_type, direction, amount, status, occurred_at
         FROM cash.cash_movements WHERE cash_shift_id = $1 AND status = 'POSTED' ORDER BY shift_sequence ASC`,
        [cashShiftId],
      );
      return result.rows.map((row) => this.toDomainMovement(row));
    });
  }

  async nextMovementSequence(cashShiftId: string): Promise<number> {
    return this.database.withTenantTransaction(this.tenantId, async (client) => {
      const result = await client.query<{ max_sequence: number }>(
        `SELECT COALESCE(MAX(shift_sequence), 0) AS max_sequence FROM cash.cash_movements WHERE cash_shift_id = $1`,
        [cashShiftId],
      );
      return Number(result.rows[0]!.max_sequence) + 1;
    });
  }

  async findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<CashMovementRow>(
        `SELECT id, cash_shift_id, shift_sequence, movement_type, direction, amount, status, occurred_at
         FROM cash.cash_movements WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND idempotency_key = $4`,
        [scope.tenantId, scope.companyId, scope.branchId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomainMovement(row) : null;
    });
  }

  async saveMovement(
    shift: CashShift,
    movement: CashMovement,
    idempotencyKey: string,
    checksum: string,
    physicalContext: CashMovementPhysicalContext,
  ): Promise<void> {
    const priorVersion = shift.version - 1;
    const occurredAt = movement.occurredAt.toISOString();
    try {
      await this.database.withTenantTransaction(shift.scope.tenantId, async (client) => {
        const shiftRow = await client.query<{ business_date: string }>(
          `SELECT business_date FROM cash.cash_shifts WHERE id = $1`,
          [shift.id],
        );
        const businessDate = shiftRow.rows[0]?.business_date;
        if (businessDate === undefined) throw new Error(`cash shift ${shift.id} not found while saving its movement`);

        const updateResult = await client.query(
          `UPDATE cash.cash_shifts SET version = $1, last_movement_sequence = $2 WHERE id = $3 AND version = $4`,
          [shift.version, movement.shiftSequence, shift.id, priorVersion],
        );
        if (updateResult.rowCount === 0) {
          throw new CashMovementConflictError(`cash shift ${shift.id} version moved before this movement could be saved (expected prior version ${priorVersion})`);
        }

        await client.query(
          `INSERT INTO cash.cash_movements (
            id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, shift_sequence,
            movement_type, direction, amount, currency_code, status, reference_type, reason_code,
            actor_type, actor_id, business_date, occurred_at, device_reported_at, origin_device_id,
            idempotency_key, request_checksum, correlation_id, version, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [
            movement.id, shift.scope.tenantId, shift.scope.companyId, shift.scope.branchId, shift.cashRegisterId,
            movement.cashShiftId, movement.shiftSequence, movement.movementType, movement.direction,
            movement.amount.toString(), physicalContext.currencyCode, movement.status,
            "CASH_MOVEMENT", physicalContext.reasonCode, physicalContext.actor.type, physicalContext.actor.id,
            businessDate, occurredAt, occurredAt, physicalContext.originDeviceId, idempotencyKey, checksum,
            movement.id, 1, occurredAt,
          ],
        );
      });
    } catch (error) {
      if (error instanceof CashMovementConflictError) throw error;
      if (isAnyUniqueViolation(error)) {
        throw new CashMovementConflictError(`a concurrent write already claimed this movement's idempotency key or sequence for shift ${shift.id}`);
      }
      throw error;
    }
  }

  async findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<CashCountRow>(
        `SELECT id, cash_shift_id, expected_amount, counted_amount, difference_amount, difference_type,
                movement_cutoff_sequence, completed_at
         FROM cash.cash_counts WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND start_idempotency_key = $4`,
        [scope.tenantId, scope.companyId, scope.branchId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomainCount(row) : null;
    });
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
    try {
      await this.database.withTenantTransaction(shift.scope.tenantId, async (client) => {
        const updateResult = await client.query(
          `UPDATE cash.cash_shifts
           SET status = $1, closed_by_actor_type = $2, closed_by_actor_id = $3, closed_at = $4, version = $5,
               closing_idempotency_key = $6, closing_request_checksum = $7
           WHERE id = $8 AND version = $9`,
          [shift.status, physicalContext.closedByActor.type, physicalContext.closedByActor.id, closedAt, shift.version, idempotencyKey, checksum, shift.id, priorVersion],
        );
        if (updateResult.rowCount === 0) {
          throw new CashCloseConflictError(`cash shift ${shift.id} version moved before this close could be saved (expected prior version ${priorVersion})`);
        }

        await client.query(
          `INSERT INTO cash.cash_counts (
            id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, count_type, status,
            started_shift_version, movement_cutoff_sequence, calculation_policy_version,
            calculation_checksum, expected_amount, counted_amount,
            difference_amount, difference_type, currency_code, denomination_breakdown_status,
            tolerance_policy_version, tolerance_policy_checksum,
            started_by_actor_type, started_by_actor_id, started_at, completed_by_actor_type,
            completed_by_actor_id, completed_at, origin_device_id, start_idempotency_key,
            start_request_checksum, completion_idempotency_key, completion_request_checksum,
            correlation_id, version, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
          [
            count.id, shift.scope.tenantId, shift.scope.companyId, shift.scope.branchId, shift.cashRegisterId,
            count.cashShiftId, "CLOSING", "COMPLETED", priorVersion, count.movementCutoffSequence,
            CASH_NO_POLICY_SENTINEL_UUID, CASH_CALCULATION_BEHAVIOR_CHECKSUM,
            count.expectedAmount.toString(), count.countedAmount.toString(), count.differenceAmount.toString(),
            count.differenceType, physicalContext.currencyCode, "NOT_PROVIDED",
            CASH_NO_POLICY_SENTINEL_UUID, CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
            physicalContext.closedByActor.type, physicalContext.closedByActor.id, closedAt,
            physicalContext.closedByActor.type, physicalContext.closedByActor.id, closedAt,
            physicalContext.originDeviceId, idempotencyKey, checksum, idempotencyKey, checksum,
            count.id, 1, closedAt,
          ],
        );

        if (review) {
          await client.query(
            `INSERT INTO cash.cash_difference_reviews (
              id, tenant_id, company_id, branch_id, cash_shift_id, cash_count_id, status,
              tolerance_policy_version, tolerance_policy_checksum,
              requires_segregation, created_at, version, correlation_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              review.id, shift.scope.tenantId, shift.scope.companyId, shift.scope.branchId, review.cashShiftId,
              review.cashCountId, review.status, CASH_NO_POLICY_SENTINEL_UUID, CASH_TOLERANCE_BEHAVIOR_CHECKSUM,
              null, review.createdAt.toISOString(), 1, count.id,
            ],
          );
        }
      });
    } catch (error) {
      if (error instanceof CashCloseConflictError) throw error;
      if (isAnyUniqueViolation(error)) {
        throw new CashCloseConflictError(`a concurrent write already claimed this close's idempotency key for shift ${shift.id}`);
      }
      throw error;
    }
  }

  private async toDomainShift(client: PoolClient, row: CashShiftRow): Promise<CashShift> {
    if (row.status !== "OPEN" && row.status !== "CLOSED") {
      throw new Error(`cash.cash_shifts.status '${row.status}' has no CashShiftStatus representation (domain models OPEN/CLOSED only)`);
    }
    const status = row.status as CashShiftStatus;

    const openingMovement = await client.query<{ amount: string }>(
      `SELECT amount FROM cash.cash_movements WHERE cash_shift_id = $1 AND shift_sequence = $2`,
      [row.id, OPENING_MOVEMENT_SEQUENCE],
    );
    const amount = openingMovement.rows[0]?.amount;
    if (amount === undefined) {
      throw new Error(`cash shift ${row.id} has no shift_sequence=1 movement to derive its opening amount from`);
    }

    return CashShift.restore({
      id: row.id,
      scope: new TenantScope(row.tenant_id, row.company_id, row.branch_id),
      cashRegisterId: row.cash_register_id,
      originDeviceId: row.origin_device_id,
      openedByActor: Actor.restore(row.opened_by_actor_type as ActorType, row.opened_by_actor_id),
      openedAt: new Date(row.opened_at),
      openingAmount: Money.fromString(amount),
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

/** PostgreSQL unique_violation. `error.constraint` names the exact constraint — no message parsing needed. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}

function isAnyUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as { code?: string }).code === "23505";
}
