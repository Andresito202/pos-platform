import type { CompanyScope } from "../company-scope.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";
import type { VariantAttributes } from "./variant-attributes.js";

/** `catalog.product_variants.status` (catalog-schema.md): closed 2-value set. */
export type ProductVariantStatus = "ACTIVE" | "RETIRED";

export interface CreateProductVariantInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly attributes: VariantAttributes;
  /**
   * Pre-computed by `VariantCanonicalKeyPolicy` (application layer) before
   * this factory runs — same externalization pattern `CreateProductUseCase`
   * already uses for `id` (via `IdGenerator`): the aggregate trusts a given
   * value, it does not decide how the value was derived. This is what lets
   * ProductVariant exist today without resolving B26 HD-06.
   */
  readonly canonicalKey: string;
}

export interface RestoreProductVariantInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly attributes: VariantAttributes;
  readonly canonicalKey: string;
  readonly status: ProductVariantStatus;
  readonly version: number;
}

/**
 * ProductVariant — "combinación opcional de atributos comerciales", never a
 * package/quantity/presentation (DEC-004, closed). Deliberately narrow:
 * `catalog.product_variants` (catalog-schema.md) does not carry unit, SKU,
 * price, stock or an operational identifier — those live on
 * ProductPresentation. `internal_reference`/`display_name`, which DEC-004's
 * conceptual attribute list mentions but catalog-schema.md's physical
 * column list omits, are likewise not modeled here — see B27 report for
 * this documented desync between the two sources.
 */
export class ProductVariant {
  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly productId: string,
    readonly attributes: VariantAttributes,
    readonly canonicalKey: string,
    readonly status: ProductVariantStatus,
    readonly version: number,
  ) {}

  static create(input: CreateProductVariantInput): ProductVariant {
    if (!input.canonicalKey.trim()) {
      throw new CatalogDomainError("EMPTY_VARIANT_ATTRIBUTES", "a variant requires a non-empty canonical key");
    }
    return new ProductVariant(input.id, input.scope, input.productId, input.attributes, input.canonicalKey, "ACTIVE", 1);
  }

  /** B29: reconstructs a ProductVariant from an already-persisted row — same posture as `Product.restore()`/`CashShift.restore()`. */
  static restore(input: RestoreProductVariantInput): ProductVariant {
    return new ProductVariant(input.id, input.scope, input.productId, input.attributes, input.canonicalKey, input.status, input.version);
  }
}
