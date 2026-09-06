import type { ProductVariant } from "./product-variant.js";

/** DEC-004 "Eventos de dominio": `ProductVariantCreated`. */
export class ProductVariantCreated {
  readonly type = "ProductVariantCreated";
  private constructor(readonly variantId: string, readonly productId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(variant: ProductVariant, now: Date): ProductVariantCreated {
    return new ProductVariantCreated(variant.id, variant.productId, variant.scope.companyId, now);
  }
}
