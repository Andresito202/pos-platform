/**
 * The raw, structured evidence a confirmation source (webhook, polling
 * response — resolved to an internal `paymentId` upstream, outside this
 * block's scope) presents. Not a domain object: it is untrusted input,
 * validated field-by-field by `ConfirmPaymentUseCase` before anything in
 * it is trusted.
 */
export interface PaymentConfirmationEvidence {
  readonly providerCode: string;
  readonly providerReferenceType: string;
  readonly providerReference: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly occurredAt: Date;
}

/**
 * `payments-schema.md`: "Webhook y polling son entradas no confiables al
 * adapter: verifican autenticidad, replay..." — this port is that
 * authenticity check. FASE 4 of B28-PAYNOTIF is explicit: no document in
 * this repository defines a concrete signature/HMAC scheme (confirmed by
 * `provider-integration-matrix.md`, where every already-audited provider
 * marks "firma de webhook"/"firma/autenticidad de callback" as
 * `UNVERIFIED`), so this port has NO production implementation — it is
 * the explicit, pending gate FASE 4 asks to leave in place rather than
 * invent. `SEC-G04/05` (autenticidad/replay) remains the eventual owner
 * of a real implementation.
 */
export interface PaymentConfirmationAuthenticityPort {
  verify(evidence: PaymentConfirmationEvidence): Promise<boolean>;
}
