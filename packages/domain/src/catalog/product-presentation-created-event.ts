import type { ProductPresentation } from "./product-presentation.js";

/** UC-CAT-005 flow step 8. */
export class ProductPresentationCreated {
  readonly type = "ProductPresentationCreated";
  private constructor(readonly presentationId: string, readonly productId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(presentation: ProductPresentation, now: Date): ProductPresentationCreated {
    return new ProductPresentationCreated(presentation.id, presentation.productId, presentation.scope.companyId, now);
  }
}
