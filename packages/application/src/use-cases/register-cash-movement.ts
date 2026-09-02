import {
  CashDomainError,
  CashMovement,
  CashMovementPosted,
  Money,
  type Actor,
  type CashMovementDirection,
  type CashMovementType,
  type CashShift,
  type TenantScope,
} from "@pos-platform/domain";
import type { CashAuthorizationPort } from "../ports/cash-authorization-port.js";
import type { CashShiftRepository } from "../ports/cash-shift-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface RegisterCashMovementCommand {
  readonly scope: TenantScope;
  readonly cashShiftId: string;
  readonly actor: Actor;
  readonly movementType: CashMovementType;
  readonly direction: CashMovementDirection;
  readonly amount: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type RegisterCashMovementResult =
  | { readonly kind: "REGISTERED"; readonly shift: CashShift; readonly movement: CashMovement; readonly event: CashMovementPosted }
  | { readonly kind: "ALREADY_REGISTERED"; readonly movement: CashMovement }
  | {
      readonly kind: "REJECTED";
      readonly reason: "SHIFT_NOT_FOUND" | "SHIFT_NOT_OPEN" | "NOT_AUTHORIZED" | "NON_POSITIVE_AMOUNT" | "VERSION_CONFLICT";
    };

/**
 * UC-CASH-003, "Flujo principal — Registrar movimiento de caja" (steps
 * 1-25), narrowed to what is actually reachable without a CashRegister
 * aggregate, currency modeling, or an approval-policy port:
 *
 *   shift exists & open (7)  ->  permission (8)  ->  amount valid (10)
 *   ->  idempotency lookup (14-16)  ->  expected_version (17)  ->  persist (19-22)
 *
 * This order is NOT copied from OpenCashShiftUseCase — UC-CASH-003 checks
 * shift-open BEFORE permission, the reverse of UC-CASH-001's own order, and
 * a test asserts exactly that. "Moneda" (step 9) and "requiere aprobación"
 * (18) are not implemented: no CashRegister carries a currency to validate
 * against, and no approval-policy source exists anywhere in this
 * repository — both are identified gaps, not silently skipped.
 */
export class RegisterCashMovementUseCase {
  constructor(
    private readonly repository: CashShiftRepository,
    private readonly authorization: CashAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterCashMovementCommand): Promise<RegisterCashMovementResult> {
    const shift = await this.repository.findById(command.scope, command.cashShiftId);
    if (!shift) return { kind: "REJECTED", reason: "SHIFT_NOT_FOUND" };
    if (shift.status !== "OPEN") return { kind: "REJECTED", reason: "SHIFT_NOT_OPEN" };

    const authorized = await this.authorization.canRegisterMovement(command.actor, command.movementType);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    let amount: Money;
    try {
      amount = Money.fromString(command.amount);
      if (!amount.isPositive()) throw new CashDomainError("NON_POSITIVE_MOVEMENT_AMOUNT", "amount must be strictly positive");
    } catch {
      return { kind: "REJECTED", reason: "NON_POSITIVE_AMOUNT" };
    }

    const existing = await this.repository.findMovementByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_REGISTERED", movement: existing };

    try {
      shift.assertOpenAtVersion(command.expectedVersion);
    } catch (error) {
      if (error instanceof CashDomainError && error.code === "SHIFT_VERSION_CONFLICT") {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    const sequence = await this.repository.nextMovementSequence(shift.id);
    const movement = CashMovement.register({
      id: this.idGenerator.newId(),
      shift,
      shiftSequence: sequence,
      movementType: command.movementType,
      direction: command.direction,
      amount,
      occurredAt: this.clock.now(),
    });
    const advancedShift = shift.withNextVersion();
    await this.repository.saveMovement(advancedShift, movement, command.idempotencyKey);

    return { kind: "REGISTERED", shift: advancedShift, movement, event: CashMovementPosted.from(movement) };
  }
}
