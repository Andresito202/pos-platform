import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentProviderPort, PaymentProviderUncertainty } from "./payment-provider-port.js";
import type {
  ResolveUncertainProviderPaymentOutcome,
  ResolveUncertainProviderPaymentUseCase,
} from "./resolve-uncertain-provider-payment-use-case.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";

export interface QueryProviderForUncertainPaymentRequest {
  readonly paymentId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type QueryProviderForUncertainPaymentOutcome =
  /** El proveedor respondió y la resolución se aplicó; su veredicto va dentro. */
  | { readonly kind: "RESOLVED"; readonly resolution: ResolveUncertainProviderPaymentOutcome }
  /**
   * Se preguntó y sigue sin poder determinarse. El intento no se toca: la
   * razón original de la incertidumbre sobrevive, y ésta es la de esta
   * consulta.
   */
  | { readonly kind: "STILL_UNKNOWN"; readonly reason: PaymentProviderUncertainty }
  /**
   * El intento es incierto pero nunca llegó a tener identidad ante el
   * proveedor. No hay nada por lo que preguntar: `GET /v1/transactions/{id}`
   * necesita el id del proveedor, y la referencia comercial no lo resuelve
   * (`DEC-016` §21). Inventar uno sería fabricar evidencia.
   */
  | { readonly kind: "PROVIDER_IDENTITY_MISSING"; readonly uncertaintyReason: string | null }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_UNCERTAIN" };

/**
 * Le pregunta al proveedor por un intento que quedó `UNKNOWN` y entrega la
 * respuesta a la resolución.
 *
 * Es **una consulta por invocación**, disparada por quien llama. No hay
 * temporizador, ni barrido, ni reintento: el barrido periódico necesitaría
 * además una política de frecuencia y de abandono que nadie ha decidido, y
 * construirlo aquí lo daría por decidido.
 *
 * Las tres capas siguen separadas: el adapter obtiene y normaliza la
 * evidencia (`D-3`), este caso de uso aporta la identidad persistida
 * (`D-2-bis`) y decide si hay algo que preguntar, y la resolución aplica el
 * veredicto sin saber de quién vino. Los errores tipados del cliente del
 * proveedor se propagan tal cual: un fallo de configuración no se disfraza
 * de evidencia.
 */
export class QueryProviderForUncertainPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly provider: PaymentProviderPort,
    private readonly resolveUncertain: ResolveUncertainProviderPaymentUseCase,
  ) {}

  async execute(
    scope: SyncScope,
    request: QueryProviderForUncertainPaymentRequest,
  ): Promise<QueryProviderForUncertainPaymentOutcome> {
    const found = this.paymentStore.findUncertainProviderAttempt(scope, request.paymentId);
    if (found.kind !== "FOUND") return { kind: found.kind };

    const { providerTransactionId, uncertaintyReason } = found.attempt;
    if (providerTransactionId === null) {
      return { kind: "PROVIDER_IDENTITY_MISSING", uncertaintyReason };
    }

    const outcome = await this.provider.getPaymentStatus({ providerTransactionId });
    if (outcome.kind === "UNKNOWN") return { kind: "STILL_UNKNOWN", reason: outcome.reason };

    return {
      kind: "RESOLVED",
      resolution: this.resolveUncertain.execute(scope, {
        paymentId: found.attempt.paymentId,
        expectedVersion: found.attempt.paymentVersion,
        evidence: outcome.evidence,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.correlationId,
        causationId: request.causationId,
      }),
    };
  }
}
