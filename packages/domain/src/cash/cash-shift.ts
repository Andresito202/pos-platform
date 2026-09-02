import { Actor } from "../actor.js";
import { Money } from "../money.js";
import { TenantScope } from "../tenant-scope.js";
import { CashDomainError } from "./cash-domain-errors.js";

/**
 * 'CLOSING' (an externally-observable intermediate state while a close is
 * in flight, per cash-counting-schema.md) is deliberately not modeled: this
 * implementation's CloseCashShiftUseCase closes atomically in one call, so
 * nothing here ever needs to represent "closing in progress". Add it only
 * when a real concurrent-access boundary needs to observe that state.
 */
export type CashShiftStatus = "OPEN" | "CLOSED";

export interface OpenCashShiftInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly cashRegisterId: string;
  readonly originDeviceId: string;
  readonly openedByActor: Actor;
  readonly openedAt: Date;
  readonly openingAmount: Money;
}

export interface RestoreCashShiftInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly cashRegisterId: string;
  readonly originDeviceId: string;
  readonly openedByActor: Actor;
  readonly openedAt: Date;
  readonly openingAmount: Money;
  readonly status: CashShiftStatus;
  readonly version: number;
  readonly closedAt: Date | null;
}

/**
 * CashShift aggregate root. Immutable — every state change (registering a
 * movement, closing) returns a new instance, matching the version-per-write
 * discipline UC-CASH-002/003 both require ("expected_version", "la versión
 * del turno aumenta").
 */
export class CashShift {
  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly cashRegisterId: string,
    readonly originDeviceId: string,
    readonly openedByActor: Actor,
    readonly openedAt: Date,
    readonly openingAmount: Money,
    readonly status: CashShiftStatus,
    readonly version: number,
    readonly closedAt: Date | null,
  ) {}

  static open(input: OpenCashShiftInput): CashShift {
    if (!input.openingAmount.isNonNegative()) {
      throw new CashDomainError("NEGATIVE_OPENING_AMOUNT", "opening amount must be non-negative");
    }
    return new CashShift(
      input.id, input.scope, input.cashRegisterId, input.originDeviceId,
      input.openedByActor, input.openedAt, input.openingAmount, "OPEN", 1, null,
    );
  }

  /**
   * Bloque 22 (materialization): reconstructs a shift from already-persisted
   * fields — no invariant re-checking, because a row read back from storage
   * already satisfied every invariant `open()`/`close()` enforce at the
   * moment it was written. Adapters use this, application/domain business
   * flows never should — `open()` remains the only way to create a shift
   * that didn't already exist.
   */
  static restore(input: RestoreCashShiftInput): CashShift {
    return new CashShift(
      input.id, input.scope, input.cashRegisterId, input.originDeviceId,
      input.openedByActor, input.openedAt, input.openingAmount, input.status, input.version, input.closedAt,
    );
  }

  /** UC-CASH-003 flow step 17 + concurrency rule 1: every write validates expected_version. */
  assertOpenAtVersion(expectedVersion: number): void {
    if (this.status !== "OPEN") {
      throw new CashDomainError("SHIFT_NOT_OPEN", `cash shift ${this.id} is not open`);
    }
    if (this.version !== expectedVersion) {
      throw new CashDomainError("SHIFT_VERSION_CONFLICT", `expected version ${expectedVersion}, shift is at ${this.version}`);
    }
  }

  /** Returns the shift as it is after one accepted movement (UC-CASH-003 step 22). */
  withNextVersion(): CashShift {
    return new CashShift(
      this.id, this.scope, this.cashRegisterId, this.originDeviceId,
      this.openedByActor, this.openedAt, this.openingAmount, this.status, this.version + 1, this.closedAt,
    );
  }

  /** UC-CASH-002 frontier: OPEN -> CLOSED, version advances, closedAt fixed. */
  close(closedAt: Date): CashShift {
    if (this.status !== "OPEN") {
      throw new CashDomainError("SHIFT_NOT_OPEN", `cash shift ${this.id} is not open`);
    }
    return new CashShift(
      this.id, this.scope, this.cashRegisterId, this.originDeviceId,
      this.openedByActor, this.openedAt, this.openingAmount, "CLOSED", this.version + 1, closedAt,
    );
  }
}
