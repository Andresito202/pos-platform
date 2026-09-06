import type { Actor, TenantScope } from "@pos-platform/domain";

/**
 * UC-PAY-001 precondition: permission `payments.transfer.report` to
 * initiate a QR/transfer payment. There is no port method for confirming
 * a payment here — the automated confirmation flow (`ConfirmPaymentUseCase`)
 * is system-to-system (per UC-PAY-001's own actor list: "servicio de
 * pagos", "integración externa autenticada"), so its gate is
 * `PaymentConfirmationAuthenticityPort`, not a human role check. Adding a
 * role-based `canConfirmPayment` here would misrepresent who actually
 * authorizes that step.
 */
export interface PaymentAuthorizationPort {
  canInitiatePayment(actor: Actor, scope: TenantScope): Promise<boolean>;
}
