export type CashDomainErrorCode =
  | "NEGATIVE_OPENING_AMOUNT"
  | "NON_POSITIVE_MOVEMENT_AMOUNT"
  | "MOVEMENT_DIRECTION_MISMATCH"
  | "SHIFT_NOT_OPEN"
  | "SHIFT_VERSION_CONFLICT";

export class CashDomainError extends Error {
  constructor(readonly code: CashDomainErrorCode, message: string) {
    super(message);
    this.name = "CashDomainError";
  }
}
