import type { Product } from "./product.js";

/** UC-CAT-002 "Flujo de desactivación" step 6. */
export class ProductDeactivated {
  readonly type = "ProductDeactivated";
  private constructor(readonly productId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(product: Product, now: Date): ProductDeactivated {
    return new ProductDeactivated(product.id, product.scope.companyId, now);
  }
}
