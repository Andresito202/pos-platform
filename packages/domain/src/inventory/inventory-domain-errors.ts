export type InventoryDomainErrorCode = "NON_POSITIVE_MOVEMENT_QUANTITY" | "EMPTY_REASON_CODE";

export class InventoryDomainError extends Error {
  constructor(readonly code: InventoryDomainErrorCode, message: string) {
    super(message);
    this.name = "InventoryDomainError";
  }
}
