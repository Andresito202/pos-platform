import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../../authorization/authorization-snapshot-store.js";
import { PERMISSION_PAYMENTS_PAYMENT_REGISTER } from "../../payments/register-cash-payment-use-case.js";
import type { SyncScope } from "../../sync/durable-sync-store.js";
import type { CommandResult, DeviceAdapter } from "../device-port.js";
import type { AttemptOutcome } from "../print-queue/sqlite-print-queue-store.js";
import type { DrawerCommand } from "./cash-drawer.js";
import type { DrawerTrigger, SqliteDrawerStore } from "./sqlite-drawer-store.js";

/**
 * Permiso de la apertura manual. Ratificado por el propietario el 2026-09-26
 * para OWNER y GENERAL_ADMIN; los roles que la matriz marca `Condicional` o
 * `Autorizar` no lo reciben mientras no exista un flujo local de aprobación.
 * Quién lo lleva lo decide el snapshot de autorización firmado, no este
 * servicio.
 */
export const PERMISSION_CASH_DRAWER_OPEN_MANUAL = "CASH_DRAWER_OPEN_MANUAL";

export type DrawerOutcome = "OPENED" | "OPEN_FAILED" | "OPEN_REJECTED" | "OPEN_UNCERTAIN";

export type OpenCashDrawerResult =
  | { readonly kind: DrawerOutcome; readonly openingId: string; readonly diagnosticCode: string | null; readonly replayed: boolean }
  | { readonly kind: "ALREADY_OPENED" | "IN_PROGRESS"; readonly openingId: string }
  | { readonly kind: "NOT_ELIGIBLE" | "NOT_CONFIGURED" | "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function outcomeOf(outcome: AttemptOutcome, retryable: boolean): DrawerOutcome {
  if (outcome === "SUCCEEDED") return "OPENED";
  if (outcome === "UNKNOWN" || outcome === "INTERRUPTED") return "OPEN_UNCERTAIN";
  return retryable ? "OPEN_FAILED" : "OPEN_REJECTED";
}

/**
 * Abrir el cajón (`D-46`, política del 2026-09-26).
 *
 * - Automática: la pide la caja tras un cobro en efectivo que completó la
 *   venta, con el permiso de quien cobra; **el servicio comprueba** que ese
 *   cobro existe, es efectivo, está confirmado y cerró la venta. Un pulso por
 *   cobro.
 * - Manual: permiso propio, motivo del catálogo y auditoría antes del pulso.
 *
 * Nunca toca venta, cobro ni caja: sólo su propia tabla y, en manual, la de
 * auditoría.
 */
export class OpenCashDrawerUseCase {
  constructor(
    private readonly store: SqliteDrawerStore,
    private readonly drawer: DeviceAdapter<DrawerCommand> | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    sessionId: string,
    input: {
      readonly trigger: DrawerTrigger;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly causationId: string | null;
    },
  ): Promise<OpenCashDrawerResult> {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: input.trigger.kind === "MANUAL" ? PERMISSION_CASH_DRAWER_OPEN_MANUAL : PERMISSION_PAYMENTS_PAYMENT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };
    if (this.drawer === null) return { kind: "NOT_CONFIGURED" };

    const attempt = this.store.openAttempt(scope, {
      trigger: input.trigger,
      userId: authSnapshot.claims.user_id,
      sessionId,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    switch (attempt.kind) {
      case "REPLAY":
        if (!attempt.sameRequest) return { kind: "IDEMPOTENCY_CONFLICT" };
        if (attempt.outcome === null) return { kind: "IN_PROGRESS", openingId: attempt.openingId };
        return { kind: outcomeOf(attempt.outcome, attempt.retryable), openingId: attempt.openingId, diagnosticCode: attempt.diagnosticCode, replayed: true };
      case "NOT_ELIGIBLE":
        return attempt;
      case "ALREADY_OPENED":
      case "IN_PROGRESS":
        return attempt;
      case "OPENED":
        break;
    }

    let result: Pick<CommandResult, "status" | "retryable" | "diagnosticCode">;
    try {
      result = await this.drawer.execute({ commandId: attempt.openingId });
    } catch {
      result = { status: "UNKNOWN", retryable: false, diagnosticCode: "ADAPTER_ERROR" };
    }
    this.store.closeAttempt(scope, attempt.openingId, result);
    return { kind: outcomeOf(result.status, result.retryable), openingId: attempt.openingId, diagnosticCode: result.diagnosticCode, replayed: false };
  }
}
