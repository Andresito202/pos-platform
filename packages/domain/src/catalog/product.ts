import type { CompanyScope } from "../company-scope.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";

/** Closed set from docs/architecture/physical-model/catalog-schema.md, transcribed. */
export type ProductType = "STANDARD" | "WEIGHTED" | "SERVICE" | "COMPOSITE" | "PREPARED" | "RETURNABLE" | "REGULATED";
export type ProductStatus = "ACTIVE";

export interface CreateProductInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly internalCode: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly brandId: string | null;
  readonly productType: ProductType;
  readonly stockControlled: boolean;
  readonly lotControlled: boolean;
  readonly expirationControlled: boolean;
  readonly serialControlled: boolean;
  readonly taxCategoryId: string | null;
  readonly baseUnitId: string;
}

/**
 * Product aggregate root, scoped to UC-CAT-001's main flow only (steps
 * 1-9). The "Datos incompletos -> guardarse como borrador si la política
 * lo permite" alternate flow is deliberately NOT implemented: "la
 * política" is never defined anywhere in this repository (which fields
 * are draft-eligible, who decides), so Product.create() always produces
 * `status: 'ACTIVE'` and requires every field UC-CAT-001 lists as
 * required. `business_attributes` (catalog-schema.md) is also not
 * modeled: that document says "mientras no exista contrato publicado
 * solo admite el objeto vacío" — there is no published contract.
 */
export class Product {
  readonly status: ProductStatus = "ACTIVE";

  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly internalCode: string | null,
    readonly name: string,
    readonly description: string | null,
    readonly categoryId: string,
    readonly brandId: string | null,
    readonly productType: ProductType,
    readonly stockControlled: boolean,
    readonly lotControlled: boolean,
    readonly expirationControlled: boolean,
    readonly serialControlled: boolean,
    readonly taxCategoryId: string | null,
    readonly baseUnitId: string,
  ) {}

  static create(input: CreateProductInput): Product {
    if (!input.name.trim()) {
      throw new CatalogDomainError("EMPTY_PRODUCT_NAME", "product name must not be empty");
    }
    // "Un producto con vencimiento debe permitir lotes" — UC-CAT-001
    // "Validaciones", matching catalog-schema.md's own CHECK constraint.
    if (input.expirationControlled && !input.lotControlled) {
      throw new CatalogDomainError("EXPIRATION_REQUIRES_LOT_CONTROL", "expiration control requires lot control");
    }
    return new Product(
      input.id, input.scope, input.internalCode, input.name, input.description,
      input.categoryId, input.brandId, input.productType, input.stockControlled,
      input.lotControlled, input.expirationControlled, input.serialControlled,
      input.taxCategoryId, input.baseUnitId,
    );
  }
}
