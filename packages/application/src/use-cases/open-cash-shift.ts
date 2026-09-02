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
import type { CashShiftRepository } from "../ports/cash-shift-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface OpenCashShiftCommand {
  readonly scope: TenantScope;
  readonly cashRegisterId: string;
  readonly originDeviceId: string;
  readonly openedByActor: Actor;
  readonly openingAmount: string;
  readonly idempotencyKey: string;
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
 * Uses `openingAmount` as the raw command string, not its parsed Money
 * canonical form — computing this before Money.fromString() would mean
 * reordering the existing amount-validation step for no functional gain
 * (a genuine retry from the same caller resends the identical string; a
 * caller that reformats "50000" as "50000.00" between calls is an edge
 * case this trade-off accepts, not a case this project's sources define).
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
  return [command.cashRegisterId, command.openedByActor.type, command.openedByActor.id, command.openingAmount].join("|");
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

    const existing = await this.repository.findOpenByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) {
      if (existing.checksum === checksum) return { kind: "ALREADY_OPENED", shift: existing.shift };
      return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" };
    }

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
    await this.repository.save(shift, movement, command.idempotencyKey, checksum);

    return { kind: "OPENED", shift, event: CashShiftOpened.from(shift) };
  }
}
