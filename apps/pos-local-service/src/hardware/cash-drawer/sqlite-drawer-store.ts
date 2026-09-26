import { uuidV7 } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../../channel/canonical-json.js";
import type { SyncScope } from "../../sync/durable-sync-store.js";
import type { CommandResult } from "../device-port.js";
import type { AttemptOutcome } from "../print-queue/sqlite-print-queue-store.js";

/** Catálogo ratificado por el propietario el 2026-09-26. */
export const DRAWER_REASONS = ["DAR_CAMBIO", "ARQUEO", "CORRECCION_ENTREGA", "OTRO"] as const;
export type DrawerReason = (typeof DRAWER_REASONS)[number];

export type DrawerTrigger =
  | { readonly kind: "AUTO_CASH_PAYMENT"; readonly paymentId: string }
  | { readonly kind: "MANUAL"; readonly reasonCode: DrawerReason; readonly reasonText: string | null };

export type OpenDrawerAttempt =
  | { readonly kind: "OPENED"; readonly openingId: string }
  | {
    readonly kind: "REPLAY";
    readonly openingId: string;
    readonly sameRequest: boolean;
    readonly outcome: AttemptOutcome | null;
    readonly retryable: boolean;
    readonly diagnosticCode: string | null;
  }
  /** Automática sin un cobro en efectivo que haya completado su venta. */
  | { readonly kind: "NOT_ELIGIBLE" }
  /** Este cobro ya dio su pulso (o su desenlace es incierto): no hay segundo. */
  | { readonly kind: "ALREADY_OPENED"; readonly openingId: string }
  | { readonly kind: "IN_PROGRESS"; readonly openingId: string };

interface OpeningRow {
  id: string; trigger_kind: string; payment_id: string | null; reason_code: string | null; reason_text: string | null;
  outcome: AttemptOutcome | null; retryable: number | null; diagnostic_code: string | null;
}

/**
 * Aperturas del cajón (`MIGRATION_033`). Único escritor de
 * `hardware_drawer_opening`; lee —nunca escribe— cobros y ventas para decidir
 * si una apertura automática es legítima.
 */
export class SqliteDrawerStore {
  constructor(private readonly database: LocalDatabase, private readonly now: () => Date = () => new Date()) {}

  openAttempt(
    scope: SyncScope,
    input: {
      readonly trigger: DrawerTrigger;
      readonly userId: string;
      readonly sessionId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly causationId: string | null;
    },
  ): OpenDrawerAttempt {
    const at = this.now().toISOString();
    const db = this.database.native;
    return db.transaction((): OpenDrawerAttempt => {
      const previous = db.prepare(
        `SELECT id, trigger_kind, payment_id, reason_code, reason_text, outcome, retryable, diagnostic_code
           FROM hardware_drawer_opening WHERE tenant_id = ? AND idempotency_key = ?`,
      ).get(scope.tenantId, input.idempotencyKey) as OpeningRow | undefined;
      if (previous !== undefined) {
        const trigger = input.trigger;
        const sameRequest = trigger.kind === "AUTO_CASH_PAYMENT"
          ? previous.trigger_kind === "AUTO_CASH_PAYMENT" && previous.payment_id === trigger.paymentId
          : previous.trigger_kind === "MANUAL" && previous.reason_code === trigger.reasonCode && previous.reason_text === trigger.reasonText;
        return {
          kind: "REPLAY", openingId: previous.id, sameRequest, outcome: previous.outcome,
          retryable: previous.retryable === 1, diagnosticCode: previous.diagnostic_code,
        };
      }

      if (input.trigger.kind === "AUTO_CASH_PAYMENT") {
        // El cobro y el cierre de la venta ocurren en la misma transacción y
        // con la misma hora: es lo que distingue «el efectivo que completó la
        // venta» de un abono en efectivo que no la completó.
        const eligible = db.prepare(
          `SELECT 1 FROM payments_payments p
             JOIN payments_payment_allocations a
               ON a.tenant_id = p.tenant_id AND a.payment_id = p.id AND a.collection_subject_type = 'SALE'
             JOIN sales_sales s ON s.tenant_id = a.tenant_id AND s.id = a.collection_subject_id
            WHERE p.tenant_id = ? AND p.company_id = ? AND p.branch_id = ? AND p.id = ?
              AND p.payment_method = 'CASH' AND p.status = 'CONFIRMED'
              AND s.status = 'COMPLETED' AND s.completed_at = p.confirmed_at`,
        ).get(scope.tenantId, scope.companyId, scope.branchId, input.trigger.paymentId);
        if (eligible === undefined) return { kind: "NOT_ELIGIBLE" };

        const blocking = db.prepare(
          `SELECT id, outcome FROM hardware_drawer_opening
            WHERE tenant_id = ? AND payment_id = ?
              AND (outcome IS NULL OR outcome IN ('SUCCEEDED','UNKNOWN','INTERRUPTED'))`,
        ).get(scope.tenantId, input.trigger.paymentId) as { id: string; outcome: string | null } | undefined;
        if (blocking !== undefined) {
          return blocking.outcome === null
            ? { kind: "IN_PROGRESS", openingId: blocking.id }
            : { kind: "ALREADY_OPENED", openingId: blocking.id };
        }
      }

      const openingId = uuidV7();
      const trigger = input.trigger;
      db.prepare(
        `INSERT INTO hardware_drawer_opening(tenant_id,id,company_id,branch_id,trigger_kind,payment_id,reason_code,
           reason_text,idempotency_key,requested_by_user_id,requested_at,outcome,retryable,diagnostic_code,finished_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)`,
      ).run(
        scope.tenantId, openingId, scope.companyId, scope.branchId, trigger.kind,
        trigger.kind === "AUTO_CASH_PAYMENT" ? trigger.paymentId : null,
        trigger.kind === "MANUAL" ? trigger.reasonCode : null,
        trigger.kind === "MANUAL" ? trigger.reasonText : null,
        input.idempotencyKey, input.userId, at,
      );

      // `integration-contracts.md` §Aislamiento 5: la apertura manual se audita
      // **antes** del pulso. Si el pulso no llega, el rastro de quién lo pidió
      // y por qué ya existe.
      if (trigger.kind === "MANUAL") {
        db.prepare(
          `INSERT INTO local_operation_audit(
             tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
             action_code, resource_type, resource_id, correlation_id, causation_id, reason_code, details_json, created_at
           ) VALUES (?,?,?,?,'USER',?,?,'CASH_DRAWER_OPENED_MANUALLY','CASH_DRAWER',?,?,?,?,?,?)`,
        ).run(
          scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, input.userId, input.sessionId,
          openingId, input.correlationId, input.causationId, trigger.reasonCode,
          canonicalJson({ opening_id: openingId, reason_text: trigger.reasonText }), at,
        );
      }
      return { kind: "OPENED", openingId };
    }).immediate();
  }

  closeAttempt(scope: SyncScope, openingId: string, result: Pick<CommandResult, "status" | "retryable" | "diagnosticCode">): void {
    this.database.native.prepare(
      `UPDATE hardware_drawer_opening SET outcome = ?, retryable = ?, diagnostic_code = ?, finished_at = ?
        WHERE tenant_id = ? AND id = ? AND outcome IS NULL`,
    ).run(result.status, result.retryable ? 1 : 0, result.diagnosticCode, this.now().toISOString(), scope.tenantId, openingId);
  }

  /** Igual que la impresión: un pulso a medio pedir al arrancar es incierto, nunca se repite. */
  interruptOpenAttempts(): number {
    return this.database.native.prepare(
      `UPDATE hardware_drawer_opening SET outcome = 'INTERRUPTED', retryable = 0, diagnostic_code = 'INTERRUPTED', finished_at = ?
        WHERE outcome IS NULL`,
    ).run(this.now().toISOString()).changes;
  }
}
