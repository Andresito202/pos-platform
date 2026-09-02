export type CashDomainErrorCode = "NEGATIVE_OPENING_AMOUNT";

export class CashDomainError extends Error {
  constructor(readonly code: CashDomainErrorCode, message: string) {
    super(message);
    this.name = "CashDomainError";
  }
}
