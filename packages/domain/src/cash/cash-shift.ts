import { Actor } from "../actor.js";
import { Money } from "../money.js";
import { TenantScope } from "../tenant-scope.js";
import { CashDomainError } from "./cash-domain-errors.js";

export type CashShiftStatus = "OPEN";

export interface OpenCashShiftInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly cashRegisterId: string;
  readonly originDeviceId: string;
  readonly openedByActor: Actor;
  readonly openedAt: Date;
  readonly openingAmount: Money;
}

/**
 * CashShift aggregate root, scoped deliberately to CASH-001 (open only).
 * Deferred on purpose, not by oversight: status transitions beyond OPEN
 * (CLOSING/CLOSED), expected_version optimistic concurrency, and
 * business_date/timezone columns all belong to CASH-002/CASH-003, which
 * this vertical does not implement — adding them now with no real consumer
 * would be exactly the speculative interface this project's own rules
 * forbid. The invariant this type enforces today
 * (cash-counting-schema.md, "Reglas" 1: base inicial de un CashMovement
 * OPENING_FLOAT POSTED) is opening amount >= 0; "no otro turno abierto
 * incompatible" is a cross-aggregate rule and lives in the application
 * use case, not here, because a single aggregate cannot see its siblings.
 */
export class CashShift {
  readonly status: CashShiftStatus = "OPEN";

  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly cashRegisterId: string,
    readonly originDeviceId: string,
    readonly openedByActor: Actor,
    readonly openedAt: Date,
    readonly openingAmount: Money,
  ) {}

  static open(input: OpenCashShiftInput): CashShift {
    if (!input.openingAmount.isNonNegative()) {
      throw new CashDomainError("NEGATIVE_OPENING_AMOUNT", "opening amount must be non-negative");
    }
    return new CashShift(
      input.id,
      input.scope,
      input.cashRegisterId,
      input.originDeviceId,
      input.openedByActor,
      input.openedAt,
      input.openingAmount,
    );
  }
}
