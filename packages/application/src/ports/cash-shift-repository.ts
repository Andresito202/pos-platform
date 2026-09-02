import type { CashCount, CashDifferenceReview, CashMovement, CashShift, TenantScope } from "@pos-platform/domain";

/**
 * Extended for CASH-002 (close) / CASH-003 (movements) beyond CASH-001's
 * original two methods. Kept as ONE repository, not split into
 * CashMovementRepository/CashCountRepository: CashShift is the aggregate
 * root that owns its movements and its closing count (per
 * cash-counting-schema.md's own "Fronteras transaccionales" — a movement or
 * a close always commits together with the shift's version bump), so
 * splitting by entity would cut across a single transactional boundary for
 * no real benefit. No SQLite/PostgreSQL adapter implements this yet — same
 * DDL NO-GO gate as CASH-001.
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
  save(shift: CashShift, movement: CashMovement, idempotencyKey: string, checksum: string): Promise<void>;

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
   */
  findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null>;
  saveMovement(shift: CashShift, movement: CashMovement, idempotencyKey: string): Promise<void>;

  findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null>;
  saveClose(shift: CashShift, count: CashCount, review: CashDifferenceReview | null, idempotencyKey: string): Promise<void>;
}
