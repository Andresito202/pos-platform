/** Closed set from docs/domain/payment-lifecycle.md "PaymentMethod", transcribed verbatim. */
export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "STATIC_QR"
  | "DYNAMIC_QR"
  | "CARD"
  | "DIGITAL_WALLET"
  | "CUSTOMER_CREDIT"
  | "GIFT_CREDIT"
  | "OTHER_AUTHORIZED";

/**
 * `payments.payments.authority_type`/`payments.payment_attempts.authority_type`
 * (payments-schema.md): "texto estable" described as "local, central o
 * proveedor externo según operación" — transcribed as stable codes, not a
 * literal enum spelled out anywhere, but a direct 1:1 translation of the
 * three words given, not an invention.
 */
export type PaymentAuthorityType = "LOCAL" | "CENTRAL" | "EXTERNAL_PROVIDER";
