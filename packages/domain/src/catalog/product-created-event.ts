import type { Product } from "./product.js";

/** UC-CAT-001 "Eventos": `ProductCreated`. */
export class ProductCreated {
  readonly type = "ProductCreated";
  private constructor(readonly productId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(product: Product, now: Date): ProductCreated {
    return new ProductCreated(product.id, product.scope.companyId, now);
  }
}
