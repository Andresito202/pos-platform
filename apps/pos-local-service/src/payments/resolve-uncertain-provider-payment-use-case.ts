import { createHash } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentProviderEvidence } from "./payment-provider-port.js";
import type { ConfirmProviderPaymentUseCase } from "./confirm-provider-payment-use-case.js";
import type {
  ConfirmProviderPaymentOutcome,
  DeclineUncertainPaymentOutcome,
  SqlitePaymentStore,
} from "./sqlite-payment-store.js";

export interface ResolveUncertainProviderPaymentRequest {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly evidence: PaymentProviderEvidence;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ResolveUncertainProviderPaymentOutcome =
  | { readonly kind: "CONFIRMED"; readonly outcome: ConfirmProviderPaymentOutcome }
  | { readonly kind: "DECLINED"; readonly outcome: DeclineUncertainPaymentOutcome }
  /**
   * El proveedor respondió, pero sigue sin veredicto. `PAY-007` no autoriza
   * `UNKNOWN → PENDING`, así que esto **no muta el intento**: sigue
   * `UNKNOWN`, esperando una evidencia que sí resuelva.
   */
  | { readonly kind: "STILL_UNCERTAIN" }
  | { readonly kind: "EVIDENCE_NOT_AUTHORIZED" };

function requestChecksum(request: ResolveUncertainProviderPaymentRequest): string {
  return createHash("sha256")
    .update(canonicalJson({
      idempotency_key: request.idempotencyKey,
      payment_id: request.paymentId,
      provider_code: request.evidence.providerCode,
      provider_transaction_id: request.evidence.providerTransactionId,
      received_at: request.evidence.receivedAt,
      status: request.evidence.status,
    }))
    .digest("hex");
}

/**
 * Resuelve un intento que quedó `UNKNOWN` cuando aparece evidencia
 * normalizada del proveedor.
 *
 * **Recibe la evidencia; no la busca.** De dónde salga —una consulta, un
 * webhook verificado, un barrido futuro— es responsabilidad de la capa de
 * proveedor y del transporte. Aquí sólo se aplica el veredicto, de modo que
 * esta pieza sirva igual a cualquiera de esos orígenes sin conocerlos.
 *
 * No introduce una segunda máquina de estados: `APPROVED` delega en la
 * confirmación existente, con sus invariantes comerciales intactas, y
 * `REJECTED` usa la transición `UNKNOWN → DECLINED` que `PAY-007` ya define.
 */
export class ResolveUncertainProviderPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly confirmProviderPayment: ConfirmProviderPaymentUseCase,
  ) {}

  execute(
    scope: SyncScope,
    request: ResolveUncertainProviderPaymentRequest,
  ): ResolveUncertainProviderPaymentOutcome {
    const { evidence } = request;

    if (evidence.providerCode.trim() === ""
      || evidence.providerReference.trim() === ""
      || evidence.providerTransactionId.trim() === "") {
      return { kind: "EVIDENCE_NOT_AUTHORIZED" };
    }

    if (evidence.status === "PENDING") return { kind: "STILL_UNCERTAIN" };

    if (evidence.status === "APPROVED") {
      return {
        kind: "CONFIRMED",
        outcome: this.confirmProviderPayment.execute(scope, {
          paymentId: request.paymentId,
          expectedVersion: request.expectedVersion,
          evidence,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
          causationId: request.causationId,
        }),
      };
    }

    return {
      kind: "DECLINED",
      outcome: this.paymentStore.declineUncertainProviderPayment({
        scope,
        // Igual que la confirmación: una resolución no tiene sesión
        // interactiva, y el contrato de sync exige un identificador válido.
        sessionId: uuidV7(),
        operatorUserId: scope.deviceId,
        auditActorType: "SYSTEM",
        auditActorId: null,
        paymentId: request.paymentId,
        providerCode: evidence.providerCode,
        providerTransactionId: evidence.providerTransactionId,
        receivedAt: evidence.receivedAt,
        operationId: uuidV7(),
        idempotencyKey: request.idempotencyKey,
        requestChecksum: requestChecksum(request),
        correlationId: request.correlationId,
        causationId: request.causationId,
      }),
    };
  }
}
