import type { Actor, CashCount, CashDifferenceReview, CashMovement, CashShift, TenantScope } from "@pos-platform/domain";

/**
 * Bloque 22 (materialization): `cash_shifts`/`cash_movements` (cash-counting-
 * schema.md:48,72) carry `business_date`, `timezone_id`, `utc_offset_minutes`
 * and `currency_code` as NOT NULL — physical bookkeeping the DDL requires but
 * that no domain object models (CashShift/CashMovement are currency- and
 * calendar-agnostic on purpose). Neither `OpenCashShiftCommand` nor the
 * domain layer had ever carried these before this block; writing a real row
 * without them would mean inventing values with no source, which this
 * project's rules forbid. The caller (POS Local Service, which already owns
 * device/branch configuration) supplies this alongside the command instead.
 * Kept out of `CashShift`/`CashMovement` themselves: they are operational
 * metadata about the write, not business state the aggregate reasons about.
 */
export interface CashShiftPhysicalContext {
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly currencyCode: string;
}

/**
 * Bloque 23 (CASH-002 materialization): same category of gap as
 * `CashShiftPhysicalContext` — `cash_shifts.closing_idempotency_key`'s own
 * UNIQUE tuple and `cash_counts`/`cash_difference_reviews` need
 * `origin_device_id`/`currency_code`, which `CloseCashShiftCommand` never
 * carried (CLOSE has no device-identity concept at all today). `businessDate`
 * isn't needed here — `cash_counts` has no such column.
 */
export interface CashClosePhysicalContext {
  readonly originDeviceId: string;
  readonly currencyCode: string;
  /**
   * `cash_counts.started_by_actor_type/id` is `NOT NULL`, but neither
   * `CashShift.close()` nor `CashCount.closing()` carries an actor — CLOSE
   * has no separate "start" step, so `command.actor` (already real data on
   * `CloseCashShiftCommand`) fills both started_by and completed_by.
   */
  readonly closedByActor: Actor;
}

/**
 * Bloque 23 (CASH-003 materialization): `cash_movements` needs
 * `origin_device_id`/`currency_code`/`reason_code`, none of which
 * `RegisterCashMovementCommand` carried. `reasonCode` is real caller-
 * supplied data (why this specific movement was made), not a policy value —
 * unlike the columns MIGRATION_007 relaxed to nullable, this one has an
 * obvious source, it was just never wired through.
 */
export interface CashMovementPhysicalContext {
  readonly originDeviceId: string;
  readonly currencyCode: string;
  readonly reasonCode: string;
  /** `cash_movements.actor_type` is `NOT NULL`, but `CashMovement` doesn't carry one — only the command does. */
  readonly actor: Actor;
}

/**
 * Bloque 22 (materialization): the physical signal that closes the
 * concurrency gap Bloque 17-19 correctly left as PHYSICAL GUARANTEE
 * DEFERRED. `save()` returns `void` — it has no way to tell the caller
 * "someone else's concurrent request already won this exact idempotency
 * key" other than throwing. A real adapter backed by the
 * `UNIQUE(tenant_id, origin_device_id, opening_idempotency_key)` designed
 * in Bloque 17 detects this at INSERT time and throws this error instead
 * of silently succeeding or silently overwriting. `OpenCashShiftUseCase`
 * catches it and re-runs the same replay/conflict decision it already
 * makes for the non-concurrent case — no new decision logic, just applied
 * a second time when the race is discovered at commit instead of at
 * lookup.
 */
export class IdempotencyKeyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyKeyConflictError";
  }
}

/**
 * Bloque 22 (materialization): a second, distinct physical race discovered
 * while writing the real SQLite adapter's concurrency test — not the one
 * Bloque 17-19 anticipated. `cash_shifts` carries TWO unique constraints a
 * concurrent `save()` can hit: `opening_idempotency_key` (handled by
 * `IdempotencyKeyConflictError` above) and `cash_shifts_incompatible_idx`
 * (tenant, branch, register, device, `status IN ('OPEN','CLOSING')` —
 * `hasIncompatibleOpenShift`'s own physical backing). Two truly concurrent
 * requests can both pass the pre-check before either commits, exactly like
 * the idempotency race; which of the two constraints SQLite reports first is
 * an implementation detail, not something a caller can rely on — so
 * `OpenCashShiftUseCase` treats both errors identically: always re-run the
 * idempotency replay/conflict check first (it is authoritative whenever it
 * resolves), and only fall back to `INCOMPATIBLE_SHIFT_OPEN` when that
 * lookup finds nothing, meaning the conflict was never about our own key.
 */
export class IncompatibleShiftOpenConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleShiftOpenConflictError";
  }
}

/**
 * Bloque 23: the CASH-002 analogue of the two OPEN conflict errors above.
 * `saveClose()`'s write touches two constraints that a genuinely concurrent
 * close can lose: `cash_shifts`'s own `closing_idempotency_key` UNIQUE (or
 * `cash_counts.completion_idempotency_key`'s UNIQUE) on a same-key race, and
 * the shift's optimistic-version guard (`UPDATE ... WHERE id = ? AND
 * version = ?`, checked via the affected-row count) on a different-key race
 * against the same shift — e.g. two different close attempts, or a close
 * racing a concurrent movement. Same reasoning as
 * `IncompatibleShiftOpenConflictError`: which one fires is not something a
 * caller can rely on, so `CloseCashShiftUseCase` always re-checks the
 * idempotency lookup first and only falls back to `VERSION_CONFLICT` when
 * that lookup finds nothing.
 */
export class CashCloseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashCloseConflictError";
  }
}

/**
 * Bloque 23: the CASH-003 analogue. `saveMovement()`'s write can lose on
 * `cash_movements`'s `UNIQUE(tenant_id, origin_device_id, idempotency_key)`
 * (same-key race), `UNIQUE(tenant_id, cash_shift_id, shift_sequence)` (two
 * writers computed the same `nextMovementSequence()` before either
 * committed), or the shift's optimistic-version guard — all three collapse
 * to the same recovery: re-check `findMovementByIdempotencyKey` first,
 * `VERSION_CONFLICT` otherwise.
 */
export class CashMovementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashMovementConflictError";
  }
}

/**
 * Extended for CASH-002 (close) / CASH-003 (movements) beyond CASH-001's
 * original two methods. Kept as ONE repository, not split into
 * CashMovementRepository/CashCountRepository: CashShift is the aggregate
 * root that owns its movements and its closing count (per
 * cash-counting-schema.md's own "Fronteras transaccionales" — a movement or
 * a close always commits together with the shift's version bump), so
 * splitting by entity would cut across a single transactional boundary for
 * no real benefit. `SqliteCashShiftRepository` implements CASH-001 (Bloque
 * 22), CASH-002 and CASH-003 (Bloque 23) for real, all over the same local
 * ledger — see docs/migration/cash-materialization-result.md for exactly
 * what each vertical's physical guarantees cover.
 */
export interface CashShiftRepository {
  /**
   * "Solo existe un turno OPEN o CLOSING incompatible por tenant, sucursal,
   * caja y dispositivo" (cash-counting-schema.md:59) — four dimensions,
   * `originDeviceId` included. Widened in Bloque 18: the Bloque 17 review
   * found this method never received it, contradicting the schema's own
   * text and this project's own physical design (cash-physical-design.md
   * §7 already specified the 4-column partial unique index). Textually,
   * this means incompatibility is scoped to the exact 4-tuple — a
   * different device opening the same register is a different tuple, not
   * blocked by this specific check. That reading is surprising for a
   * single physical cash drawer and is flagged, not silently resolved —
   * see this block's report.
   */
  hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string, originDeviceId: string): Promise<boolean>;

  /**
   * Idempotent-replay lookup for OPEN. Returns the checksum alongside the
   * shift so the use case can distinguish a same-key-same-payload replay
   * from a same-key-different-payload conflict (Bloque 17, D5) — unlike
   * findMovementByIdempotencyKey/findCloseByIdempotencyKey, which only
   * support replay, not conflict detection, because no real adapter has
   * ever backed them. This one can: the comparison happens entirely
   * against this in-memory fake, with no physical persistence dependency.
   *
   * Takes `originDeviceId` explicitly, unlike its movement/close siblings
   * (Bloque 19 correction): the Bloque 17 identity tuple for OPEN is
   * `(tenant_id, origin_device_id, opening_idempotency_key)` — omitting
   * device from the lookup itself (as Bloque 18 originally did, mirroring
   * the movement/close pattern) meant two different devices generating
   * the same raw key string would collide and one would be wrongly
   * rejected as IDEMPOTENCY_CONFLICT for a request that was never a
   * duplicate. That asymmetry with movement/close is deliberate and
   * documented, not fixed here — those two are unrelated to this block's
   * scope (Bloque 19 §9, OPEN vs CLOSE cross-audit).
   */
  findOpenByIdempotencyKey(scope: TenantScope, originDeviceId: string, idempotencyKey: string): Promise<{ shift: CashShift; checksum: string } | null>;
  save(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string, physicalContext: CashShiftPhysicalContext): Promise<void>;

  /** Finds by id regardless of status — callers check `.status` themselves. */
  findById(scope: TenantScope, cashShiftId: string): Promise<CashShift | null>;
  listPostedMovements(cashShiftId: string): Promise<readonly CashMovement[]>;
  nextMovementSequence(cashShiftId: string): Promise<number>;
  /**
   * Idempotent-replay lookup only — returns the previously registered
   * movement so the use case can return the same result again. Does NOT
   * detect a same-key-different-content conflict (UC-CASH-003 step 16):
   * that needs a persisted checksum to compare against, which only a real
   * adapter can own. Deferred, not fabricated — see this block's report.
   * Scoped by full `TenantScope`, not `(tenant_id, origin_device_id)` like
   * OPEN's D5 tuple — that narrower tuple was a specific, evidenced,
   * owner-approved decision for OPEN only (Bloque 17); it was never made
   * for MOVEMENT/CLOSE, and this deliberately does not extend it by
   * inference (Bloque 19 §9, still true in Bloque 23).
   */
  findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null>;
  saveMovement(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string, physicalContext: CashMovementPhysicalContext): Promise<void>;

  /** Same full-`TenantScope` lookup reasoning as `findMovementByIdempotencyKey` above. */
  findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null>;
  saveClose(shift: CashShift, count: CashCount, review: CashDifferenceReview | null, idempotencyKey: string, checksum: string, physicalContext: CashClosePhysicalContext): Promise<void>;
}
