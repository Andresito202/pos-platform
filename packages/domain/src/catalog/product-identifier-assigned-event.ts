import type { ProductIdentifier } from "./product-identifier.js";

/** UC-CAT-003 flow step 9. */
export class ProductIdentifierAssigned {
  readonly type = "ProductIdentifierAssigned";
  private constructor(readonly identifierId: string, readonly presentationId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(identifier: ProductIdentifier, now: Date): ProductIdentifierAssigned {
    return new ProductIdentifierAssigned(identifier.id, identifier.presentationId, identifier.scope.companyId, now);
  }
}
