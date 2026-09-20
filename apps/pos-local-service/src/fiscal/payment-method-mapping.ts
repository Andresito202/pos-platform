import { PAYMENT_FORM_CODES, PAYMENT_METHOD_CODES, isVerifiedCode } from "@pos-platform/fiscal-adapters";

/**
 * Traduce la forma de pago local al código DIAN (`DEC-021` F4).
 *
 * Mismo idioma que `dian/codes.ts`: **verificar y bloquear, nunca adivinar**.
 * `payments_payments.payment_method` admite cinco valores
 * (`CASH,CARD,TRANSFER,QR,CUSTOMER_CREDIT`); `PAYMENT_METHOD_CODES` sólo tiene
 * dos verificados contra documentación oficial (`"10"` efectivo, `"42"`
 * consignación). No existe código DIAN verificado para `CARD`, `QR` ni
 * `CUSTOMER_CREDIT` en este repositorio, así que esta función no lo inventa:
 * los deja `null` y el llamador bloquea con el mismo motivo que un código de
 * catálogo no verificado.
 */

export interface DianPaymentMapping {
  readonly paymentFormCode: string;
  readonly paymentMethodCode: string;
}

const METHOD_CODE: Readonly<Partial<Record<string, string>>> = {
  CASH: "10",
  TRANSFER: "42",
};

/**
 * `CUSTOMER_CREDIT` sería forma «Crédito» (`"2"`); las demás, «Contado»
 * (`"1"`), porque una venta del POS sólo llega a `COMPLETED` con el dinero ya
 * recibido o con el crédito ya otorgado — nunca con una promesa de pago futura
 * sin ese estado. `CUSTOMER_CREDIT` no tiene código de **método** verificado,
 * así que la forma nunca llega a usarse en la práctica hasta que ese código
 * exista.
 */
function paymentFormFor(method: string): string {
  return method === "CUSTOMER_CREDIT" ? "2" : "1";
}

export function mapPaymentMethodToDian(localMethod: string): DianPaymentMapping | null {
  const methodCode = METHOD_CODE[localMethod];
  if (methodCode === undefined) return null;
  if (!isVerifiedCode(PAYMENT_METHOD_CODES, methodCode)) return null;
  const paymentFormCode = paymentFormFor(localMethod);
  if (!isVerifiedCode(PAYMENT_FORM_CODES, paymentFormCode)) return null;
  return { paymentFormCode, paymentMethodCode: methodCode };
}
