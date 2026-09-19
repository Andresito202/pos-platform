import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentProviderPort } from "./payment-provider-port.js";
import type { ResolveUncertainProviderPaymentUseCase } from "./resolve-uncertain-provider-payment-use-case.js";
import type {
  ProviderUncertaintyReason,
  SqlitePaymentStore,
  UncertainProviderQueryResult,
  UncertainProviderSweepCandidate,
  UncertainResolutionAbandonReason,
} from "./sqlite-payment-store.js";
import {
  nextQueryAt,
  uncertaintyWindowEndsAt,
  uncertaintyWindowExpired,
  UNCERTAIN_PAYMENT_MAX_QUERIES,
  UNCERTAIN_PAYMENT_SWEEP_DEFAULT_LIMIT,
} from "./uncertain-payment-sweep-policy.js";

export interface SweepUncertainProviderPaymentsRequest {
  readonly correlationId: string;
  readonly causationId: string | null;
  /** Tope de candidatos de esta invocación. Por defecto, el de la política. */
  readonly limit?: number;
}

/**
 * Lo que hizo **una** invocación. No hay estado entre invocaciones: quien
 * barre repetidamente lo decide fuera, y hoy no lo decide nadie.
 */
export interface SweepUncertainProviderPaymentsStats {
  /** Candidatos que el selector devolvió. */
  readonly scanned: number;
  /** Consultas realmente hechas al proveedor. */
  readonly queried: number;
  readonly confirmed: number;
  readonly declined: number;
  /** Consultas que dejaron el intento incierto y programaron la siguiente. */
  readonly rescheduled: number;
  /** Intentos retirados a `REVIEW_REQUIRED`. */
  readonly abandoned: number;
  /**
   * Candidatos que esta invocación soltó sin consultar: otra invocación los
   * reclamó primero, o la evidencia no bastó para resolver.
   */
  readonly skipped: number;
}

/**
 * Barrido bajo demanda de los intentos que quedaron `UNKNOWN`.
 *
 * **Es un mecanismo invocable, no un proceso.** Una invocación recorre una
 * tanda acotada de candidatos y devuelve. No duerme, no arma temporizadores,
 * no se reencola y no hay bucle que espere: si alguien quiere barrer otra vez
 * tiene que volver a llamar. El planificador —cuándo y con qué frecuencia se
 * invoca— es una decisión que nadie ha tomado, y dejarla fuera es lo que
 * impide darla por tomada.
 *
 * ## El orden importa (`DEC-016` §6 regla 3)
 *
 * ```
 * selecciona → comprueba ventana → reclama (transacción) → pregunta (fuera) → resuelve
 * ```
 *
 * El puerto del proveedor se invoca **fuera de toda transacción**. Por eso el
 * reclamo va antes: es lo único que puede excluir al candidato mientras dura
 * una llamada de red que no se puede sostener con la base abierta. La
 * exclusión es por versión, no por lock — el escritor sigue siendo uno solo.
 *
 * ## Lo que este barrido no es
 *
 * No es conciliación: no compara totales, no cierra periodos y no escribe
 * ninguna tabla nueva. Pregunta por intentos concretos que ya están marcados
 * como inciertos, y todo lo que produce cabe en `local_operation_audit` y
 * `local_sync_outbox`.
 */
export class SweepUncertainProviderPaymentsUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly provider: PaymentProviderPort,
    private readonly resolveUncertain: ResolveUncertainProviderPaymentUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    request: SweepUncertainProviderPaymentsRequest,
  ): Promise<SweepUncertainProviderPaymentsStats> {
    const candidates = this.paymentStore.findUncertainProviderSweepCandidates(scope, {
      now: this.now(),
      limit: request.limit ?? UNCERTAIN_PAYMENT_SWEEP_DEFAULT_LIMIT,
    });

    const stats = {
      scanned: candidates.length,
      queried: 0,
      confirmed: 0,
      declined: 0,
      rescheduled: 0,
      abandoned: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      // `D-6`: la ventana se comprueba **antes** de preguntar. Un candidato
      // vencido no se consulta — se retira. Que siga entrando al selector es
      // lo que hace que alguien lo retire.
      if (uncertaintyWindowExpired(candidate.observedAt, this.now())) {
        this.abandon(scope, request, candidate, "WINDOW_EXHAUSTED");
        stats.abandoned += 1;
        continue;
      }

      if (candidate.attemptCount >= UNCERTAIN_PAYMENT_MAX_QUERIES) {
        this.abandon(scope, request, candidate, "QUERY_BUDGET_EXHAUSTED");
        stats.abandoned += 1;
        continue;
      }

      const claimed = this.paymentStore.claimUncertainProviderQuery({
        scope,
        attemptId: candidate.attemptId,
        expectedAttemptVersion: candidate.attemptVersion,
        parkedUntil: uncertaintyWindowEndsAt(candidate.observedAt),
      });

      if (claimed !== "CLAIMED") {
        stats.skipped += 1;
        continue;
      }

      const attemptNumber = candidate.attemptCount + 1;
      const claimedVersion = candidate.attemptVersion + 1;

      let outcome;
      try {
        outcome = await this.provider.getPaymentStatus({
          providerTransactionId: candidate.providerTransactionId,
        });
      } catch (error: unknown) {
        // Un error tipado del proveedor no es incertidumbre sobre el pago: es
        // un defecto nuestro —credenciales, un id que no reconoce—. No gasta
        // consulta, no reprograma y no se disfraza de `UNKNOWN`: se deshace el
        // reclamo y el error sube tal cual, que es donde se ve.
        this.paymentStore.releaseUncertainProviderQuery({
          scope,
          attemptId: candidate.attemptId,
          expectedAttemptVersion: claimedVersion,
          restoredNextAttemptAt: candidate.nextAttemptAt,
        });
        throw error;
      }

      stats.queried += 1;

      const result: UncertainProviderQueryResult = outcome.kind === "UNKNOWN"
        ? "UNKNOWN"
        : outcome.evidence.status;
      const uncertaintyReason: ProviderUncertaintyReason | null = outcome.kind === "UNKNOWN"
        ? outcome.reason
        : null;
      const resolves = result === "APPROVED" || result === "REJECTED";

      const nextAttemptAt = resolves
        ? null
        : nextQueryAt(candidate.observedAt, attemptNumber, this.now());

      this.paymentStore.recordUncertainProviderQuery({
        scope,
        sessionId: randomUUID(),
        operatorUserId: scope.deviceId,
        auditActorType: "SYSTEM",
        auditActorId: null,
        paymentId: candidate.paymentId,
        attemptId: candidate.attemptId,
        attemptNumber,
        result,
        uncertaintyReason,
        nextAttemptAt,
        operationId: randomUUID(),
        idempotencyKey: `payment-provider-query:${candidate.attemptId}:${attemptNumber}`,
        requestChecksum: queryChecksum(candidate, attemptNumber, result, uncertaintyReason),
        correlationId: request.correlationId,
        causationId: request.causationId,
      });

      if (outcome.kind === "EVIDENCE" && resolves) {
        const resolution = this.resolveUncertain.execute(scope, {
          paymentId: candidate.paymentId,
          expectedVersion: candidate.paymentVersion,
          evidence: outcome.evidence,
          idempotencyKey: `payment-provider-resolution:${candidate.attemptId}:${attemptNumber}`,
          correlationId: request.correlationId,
          causationId: request.causationId,
        });

        if (resolution.kind === "CONFIRMED") stats.confirmed += 1;
        else if (resolution.kind === "DECLINED") stats.declined += 1;
        else stats.skipped += 1;
        continue;
      }

      if (nextAttemptAt === null) {
        // Sin cita siguiente la resolución automática terminó: o se gastaron
        // las seis consultas, o la siguiente caería fuera de la ventana. `D-6`
        // resuelve las dos igual, y nunca hacia `FAILED`.
        this.abandon(
          scope, request, candidate,
          attemptNumber >= UNCERTAIN_PAYMENT_MAX_QUERIES
            ? "QUERY_BUDGET_EXHAUSTED"
            : "WINDOW_EXHAUSTED",
        );
        stats.abandoned += 1;
        continue;
      }

      stats.rescheduled += 1;
    }

    return stats;
  }

  private abandon(
    scope: SyncScope,
    request: SweepUncertainProviderPaymentsRequest,
    candidate: UncertainProviderSweepCandidate,
    reason: UncertainResolutionAbandonReason,
  ): void {
    this.paymentStore.abandonUncertainProviderResolution({
      scope,
      sessionId: randomUUID(),
      operatorUserId: scope.deviceId,
      auditActorType: "SYSTEM",
      auditActorId: null,
      paymentId: candidate.paymentId,
      attemptId: candidate.attemptId,
      reason,
      operationId: randomUUID(),
      idempotencyKey: `payment-provider-abandoned:${candidate.attemptId}`,
      requestChecksum: createHash("sha256")
        .update(canonicalJson({
          attempt_id: candidate.attemptId,
          payment_id: candidate.paymentId,
          reason,
        }))
        .digest("hex"),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}

function queryChecksum(
  candidate: UncertainProviderSweepCandidate,
  attemptNumber: number,
  result: UncertainProviderQueryResult,
  uncertaintyReason: ProviderUncertaintyReason | null,
): string {
  return createHash("sha256")
    .update(canonicalJson({
      attempt_id: candidate.attemptId,
      attempt_number: attemptNumber,
      payment_id: candidate.paymentId,
      provider_transaction_id: candidate.providerTransactionId,
      result,
      uncertainty_reason: uncertaintyReason,
    }))
    .digest("hex");
}
