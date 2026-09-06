import type { Product, UpdateProductInput } from "./product.js";

/** UC-CAT-002 flow step 7: "Registra valores anteriores y nuevos" — limited to the fields UpdateProductInput actually mutates. */
export class ProductUpdated {
  readonly type = "ProductUpdated";
  private constructor(
    readonly productId: string,
    readonly companyId: string,
    readonly occurredAt: Date,
    readonly before: UpdateProductInput,
    readonly after: UpdateProductInput,
  ) {}

  static from(before: Product, after: Product, now: Date): ProductUpdated {
    return new ProductUpdated(
      after.id,
      after.scope.companyId,
      now,
      { name: before.name, description: before.description, categoryId: before.categoryId, brandId: before.brandId },
      { name: after.name, description: after.description, categoryId: after.categoryId, brandId: after.brandId },
    );
  }
}
