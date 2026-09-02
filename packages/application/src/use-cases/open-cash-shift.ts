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
}

export type OpenCashShiftResult =
  | { readonly kind: "OPENED"; readonly shift: CashShift; readonly event: CashShiftOpened }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "INCOMPATIBLE_SHIFT_OPEN" | "NEGATIVE_OPENING_AMOUNT" };

/**
 * UC-CASH-001, flow steps 1-9, open only. Follows the UC's own order:
 * permission (2) before the incompatible-shift check (3) before validating
 * the amount (5) before creating the shift+movement (6-7). Audit (step 8)
 * and outbox are the caller's job (infrastructure, injected via the
 * repository port) — this use case only decides and constructs.
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

    const incompatible = await this.repository.hasIncompatibleOpenShift(command.scope, command.cashRegisterId);
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
    await this.repository.save(shift, movement);

    return { kind: "OPENED", shift, event: CashShiftOpened.from(shift) };
  }
}
