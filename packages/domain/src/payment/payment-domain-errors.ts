export type PaymentDomainErrorCode =
  | "NON_POSITIVE_PAYMENT_AMOUNT"
  | "EMPTY_CURRENCY_CODE"
  | "PAYMENT_NOT_PENDING"
  | "PAYMENT_VERSION_CONFLICT"
  | "ATTEMPT_NOT_PENDING"
  | "ATTEMPT_VERSION_CONFLICT"
  | "EMPTY_PROVIDER_CODE"
  | "EMPTY_PROVIDER_REFERENCE"
  | "EMPTY_COLLECTION_IDENTIFIER_VALUE";

export class PaymentDomainError extends Error {
  constructor(readonly code: PaymentDomainErrorCode, message: string) {
    super(message);
    this.name = "PaymentDomainError";
  }
}
