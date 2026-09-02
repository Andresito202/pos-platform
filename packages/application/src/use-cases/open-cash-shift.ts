import {
  Actor,
  CashDomainError,
  CashMovement,
  CashShift,
  CashShiftOpened,
  Money,
  TenantScope,
} from "@pos-platform/domain";
import type { CashAuthorizationPort } from "../ports/cash-authorization-port.js";
import {
  IdempotencyKeyConflictError,
  IncompatibleShiftOpenConflictError,
  type CashShiftPhysicalContext,
  type CashShiftRepository,
} from "../ports/cash-shift-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface OpenCashShiftCommand {
  readonly scope: TenantScope;
  readonly cashRegisterId: string;
  readonly originDeviceId: string;
  readonly openedByActor: Actor;
  readonly openingAmount: string;
  readonly idempotencyKey: string;
  /**
   * Bloque 22: physical bookkeeping required by `cash_shifts`/
   * `cash_movements` (see CashShiftPhysicalContext) that no domain object
   * carries. Not part of the idempotency checksum (Bloque 17 D5) — these
   * describe the device/branch's operating context at write time, the same
   * category as `scope`/`originDeviceId`, which the checksum already
   * excludes as routing metadata rather than operation payload.
   */
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly currencyCode: string;
}

export type OpenCashShiftResult =
  | { readonly kind: "OPENED"; readonly shift: CashShift; readonly event: CashShiftOpened }
  | { readonly kind: "ALREADY_OPENED"; readonly shift: CashShift }
  | {
      readonly kind: "REJECTED";
      readonly reason: "NOT_AUTHORIZED" | "IDEMPOTENCY_CONFLICT" | "INCOMPATIBLE_SHIFT_OPEN" | "NEGATIVE_OPENING_AMOUNT";
    };

/**
 * Checksum content per Bloque 17 (D5): cashRegisterId, actor type/id,
 * openingAmount — the fields that make two OPEN requests semantically
 * different operations. `scope` and `originDeviceId` are excluded: they
 * are the idempotency key's own namespace/partition, not payload content.
 *
 * Bloque 19 correction: `openingAmount` is canonicalized through
 * `Money.fromString()` before joining, not used as the raw command
 * string. Money's own normalization rule (physical-conventions.md,
 * verified by money.test.ts's "compares by canonical value, not by input
 * formatting") already establishes "100", "100.0" and "100.00" as the
 * same value — this checksum's stated job is detecting whether two
 * requests are the SAME semantic operation, so using the raw string
 * instead of Money's existing canonical form was an objective
 * contradiction with that stated purpose (Bloque 18 traded correctness
 * for avoiding a reorder; Bloque 19 found real evidence the trade wasn't
 * necessary — parsing here doesn't change when NEGATIVE_OPENING_AMOUNT
 * or a malformed-amount failure is reported, both still happen at
 * `CashShift.open()` below, unchanged). A parse failure here falls back
 * to the raw string for checksum purposes only, since a malformed amount
 * will fail domain validation on the very next step regardless of what
 * the checksum recorded.
 *
 * This is a canonical-string comparison, not a cryptographic hash: no
 * source in this repository picks a hashing algorithm for any Cash
 * "checksum" field (they are described as "checksum del request canónico"
 * everywhere, never further specified), and inventing one now would risk
 * locking in a choice a future real adapter might need to make
 * differently. Equality of this string is enough to detect payload drift
 * under an identical idempotency key, which is this function's only job.
 */
function canonicalizeOpenPayload(command: Pick<OpenCashShiftCommand, "cashRegisterId" | "openedByActor" | "openingAmount">): string {
  let canonicalAmount: string;
  try {
    canonicalAmount = Money.fromString(command.openingAmount).toString();
  } catch {
    canonicalAmount = command.openingAmount;
  }
  return [command.cashRegisterId, command.openedByActor.type, command.openedByActor.id, canonicalAmount].join("|");
}

/**
 * UC-CASH-001, flow steps 1-9, open only.
 *
 * Order (Bloque 18, implementing the Bloque 17 contract): authorization ->
 * checksum -> idempotency lookup -> incompatible-shift check -> domain
 * validation -> persist. Authorization stays first for the same reason
 * CloseCashShiftUseCase's does (Bloque 10): an unauthorized actor must not
 * be able to learn ALREADY_OPENED or IDEMPOTENCY_CONFLICT by replaying a
 * key it never legitimately held. The incompatible-shift check moves
 * after the idempotency lookup — a genuine retry of an already-opened
 * shift must return ALREADY_OPENED, not INCOMPATIBLE_SHIFT_OPEN, exactly
 * mirroring why CloseCashShiftUseCase checks idempotency before its own
 * state checks.
 *
 * Concurrency (Bloque 17 §9, mandatory): this find-then-save sequence is
 * NOT atomic. Two truly concurrent OPEN calls with the same idempotency
 * key could both pass the lookup before either saves, producing two
 * shifts — this in-memory repository does not (and, without a real
 * transaction, cannot) prevent that. APPLICATION GUARANTEE: sequential
 * requests (including retries arriving after the first has completed,
 * which is what SQLite's single-writer BEGIN IMMEDIATE model guarantees
 * in practice) are correctly idempotent, per the tests in this file.
 * PHYSICAL GUARANTEE: DEFERRED — depends on the
 * UNIQUE(tenant_id, origin_device_id, opening_idempotency_key) designed
 * in Bloque 17, not yet materialized (DDL gate NO-GO). This code does not
 * simulate a guarantee it cannot provide.
 */
export class OpenCashShiftUseCase {
  constructor(
    private readonly repository: CashShiftRepository,
    private readonly authorization: CashAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: OpenCashShiftCommand): Promise<OpenCashShiftResult> {
    const authorized = await this.authorization.canOpenShift(command.openedByActor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const checksum = canonicalizeOpenPayload(command);

    const replay = await this.replayOrConflict(command, checksum);
    if (replay) return replay;

    const incompatible = await this.repository.hasIncompatibleOpenShift(command.scope, command.cashRegisterId, command.originDeviceId);
    if (incompatible) return { kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" };

    let shift: CashShift;
    try {
      shift = CashShift.open({
        id: this.idGenerator.newId(),
        scope: command.scope,
        cashRegisterId: command.cashRegisterId,
        originDeviceId: command.originDeviceId,
        openedByActor: command.openedByActor,
        openedAt: this.clock.now(),
        openingAmount: Money.fromString(command.openingAmount),
      });
    } catch (error) {
      if (error instanceof CashDomainError && error.code === "NEGATIVE_OPENING_AMOUNT") {
        return { kind: "REJECTED", reason: "NEGATIVE_OPENING_AMOUNT" };
      }
      throw error;
    }

    const movement = CashMovement.openingFloat(shift, this.idGenerator.newId(), shift.openedAt);
    const physicalContext: CashShiftPhysicalContext = {
      businessDate: command.businessDate,
      timezoneId: command.timezoneId,
      utcOffsetMinutes: command.utcOffsetMinutes,
      currencyCode: command.currencyCode,
    };
    try {
      await this.repository.save(shift, movement, command.idempotencyKey, checksum, physicalContext);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError || error instanceof IncompatibleShiftOpenConflictError) {
        // Bloque 22: a truly concurrent request won one of two possible
        // physical UNIQUE races between our lookups above and this save —
        // re-run the exact same replay/conflict decision now that the row
        // genuinely exists, instead of letting a legitimate retry surface
        // as an unhandled exception. The idempotency lookup is always
        // authoritative when it resolves, regardless of which constraint
        // the adapter actually reported: which of the two fires first
        // under a true race is an implementation detail neither error
        // type can rely on (see IncompatibleShiftOpenConflictError).
        const resolved = await this.replayOrConflict(command, checksum);
        if (resolved) return resolved;
        if (error instanceof IncompatibleShiftOpenConflictError) {
          return { kind: "REJECTED", reason: "INCOMPATIBLE_SHIFT_OPEN" };
        }
      }
      throw error;
    }

    return { kind: "OPENED", shift, event: CashShiftOpened.from(shift) };
  }

  private async replayOrConflict(command: OpenCashShiftCommand, checksum: string): Promise<OpenCashShiftResult | null> {
    const existing = await this.repository.findOpenByIdempotencyKey(command.scope, command.originDeviceId, command.idempotencyKey);
    if (!existing) return null;
    if (existing.checksum === checksum) return { kind: "ALREADY_OPENED", shift: existing.shift };
    return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" };
  }
}
