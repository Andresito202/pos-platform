import {
  CashCount,
  CashCountCompleted,
  CashDifferenceDetected,
  CashDifferenceReview,
  CashDomainError,
  CashShiftClosed,
  Money,
  calculateExpectedCash,
  type Actor,
  type CashShift,
  type TenantScope,
} from "@pos-platform/domain";
import type { CashAuthorizationPort } from "../ports/cash-authorization-port.js";
import type { CashShiftRepository } from "../ports/cash-shift-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface CloseCashShiftCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly cashShiftId: string;
  readonly expectedVersion: number;
  readonly countedAmount: string;
  readonly idempotencyKey: string;
}

export type CloseCashShiftResult =
  | {
      readonly kind: "CLOSED";
      readonly shift: CashShift;
      readonly count: CashCount;
      readonly review: CashDifferenceReview | null;
      readonly countCompleted: CashCountCompleted;
      readonly differenceDetected: CashDifferenceDetected | null;
      readonly shiftClosed: CashShiftClosed;
    }
  | { readonly kind: "ALREADY_CLOSED"; readonly count: CashCount }
  | {
      readonly kind: "REJECTED";
      readonly reason: "SHIFT_NOT_FOUND" | "NOT_AUTHORIZED" | "SHIFT_NOT_OPEN" | "VERSION_CONFLICT" | "INVALID_COUNTED_AMOUNT";
    };

/**
 * UC-CASH-002, flow steps 1-9, narrowed to what has evidence:
 *
 * NOT implemented (identified gaps, not skipped silently):
 * - denomination breakdown (step 4's "cuando corresponda") — optional per
 *   the UC itself, and CashCount here has no denomination field at all.
 * - categorized breakdown of expected cash (step 3: base/ventas/ingresos/
 *   egresos/retiros/devoluciones/recaudos) — the total is exact and
 *   correct (calculateExpectedCash folds every POSTED movement), the
 *   per-category split is a reporting concern with no test/consumer here.
 * - threshold-gated "observación o referencia de autorización" (step 6,
 *   second half) — no tolerance policy value exists anywhere in this
 *   repository to gate against. A CashDifferenceReview is always created
 *   when difference != 0 (step 6, first half), unconditionally.
 *
 * Idempotency is checked BEFORE the open/version checks, not after: a
 * legitimate retry of an already-completed close must return the same
 * CashCount even though the shift is now CLOSED — checking "is it open"
 * first would incorrectly reject every successful retry.
 *
 * Authorization (Bloque 10 remediation of a Bloque 9 finding:
 * permission-matrix.md's "Cerrar caja propia" was never wired in) sits
 * right after the shift lookup, BEFORE the idempotency-replay lookup —
 * not copied from OpenCashShiftUseCase or RegisterCashMovementUseCase,
 * but chosen deliberately: an unauthorized actor must not be able to
 * learn a shift's close state (via ALREADY_CLOSED) by replaying a key it
 * never legitimately held. UC-CASH-002's own precondition order agrees
 * ("1. Existe un turno abierto. 2. El usuario tiene acceso al turno.") —
 * existence first, access second, before anything else proceeds.
 */
export class CloseCashShiftUseCase {
  constructor(
    private readonly repository: CashShiftRepository,
    private readonly authorization: CashAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CloseCashShiftCommand): Promise<CloseCashShiftResult> {
    const shift = await this.repository.findById(command.scope, command.cashShiftId);
    if (!shift) return { kind: "REJECTED", reason: "SHIFT_NOT_FOUND" };

    const authorized = await this.authorization.canCloseShift(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existingClose = await this.repository.findCloseByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existingClose) return { kind: "ALREADY_CLOSED", count: existingClose };

    if (shift.status !== "OPEN") return { kind: "REJECTED", reason: "SHIFT_NOT_OPEN" };

    try {
      shift.assertOpenAtVersion(command.expectedVersion);
    } catch (error) {
      if (error instanceof CashDomainError && error.code === "SHIFT_VERSION_CONFLICT") {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    let countedAmount: Money;
    try {
      countedAmount = Money.fromString(command.countedAmount);
      if (!countedAmount.isNonNegative()) throw new TypeError("counted amount must be non-negative");
    } catch {
      return { kind: "REJECTED", reason: "INVALID_COUNTED_AMOUNT" };
    }

    const postedMovements = await this.repository.listPostedMovements(shift.id);
    const expectedAmount = calculateExpectedCash(postedMovements);
    const cutoffSequence = postedMovements.reduce((max, m) => Math.max(max, m.shiftSequence), 0);
    const now = this.clock.now();

    const count = CashCount.closing(shift, this.idGenerator.newId(), countedAmount, expectedAmount, cutoffSequence, now);
    const review = count.differenceType === "EXACT" ? null : CashDifferenceReview.required(count, this.idGenerator.newId(), now);
    const closedShift = shift.close(now);

    await this.repository.saveClose(closedShift, count, review, command.idempotencyKey);

    return {
      kind: "CLOSED",
      shift: closedShift,
      count,
      review,
      countCompleted: new CashCountCompleted(count.id, shift.id, now),
      differenceDetected: review ? new CashDifferenceDetected(count.id, shift.id, now) : null,
      shiftClosed: CashShiftClosed.from(closedShift),
    };
  }
}
