import type { CompanyScope } from "../company-scope.js";
import type { Quantity } from "../quantity.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";

/** `catalog.product_presentations.stock_mode` (catalog-schema.md), closed 4-value set per DEC-004. */
export type StockMode = "INDEPENDENT" | "CONVERTED_TO_BASE" | "DERIVED" | "NON_STOCK";

/** `catalog.product_presentations.status` (catalog-schema.md): closed 2-value set. */
export type ProductPresentationStatus = "ACTIVE" | "INACTIVE";

export interface CreateProductPresentationInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  /** Nullable — DEC-004: a presentation belongs directly to Product, or to a Variant of the same Product, never both/neither ambiguously. */
  readonly variantId: string | null;
  readonly name: string;
  /** Nullable — catalog-schema.md's `internal_sku` is nullable; not every presentation is assigned one at creation. */
  readonly internalSku: string | null;
  readonly unitId: string;
  readonly containedQuantity: Quantity;
  readonly variableQuantity: boolean;
  readonly salesEnabled: boolean;
  readonly purchasingEnabled: boolean;
  readonly breakable: boolean;
  readonly stockMode: StockMode;
}

export interface RestoreProductPresentationInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly internalSku: string | null;
  readonly unitId: string;
  readonly containedQuantity: Quantity;
  readonly variableQuantity: boolean;
  readonly salesEnabled: boolean;
  readonly purchasingEnabled: boolean;
  readonly breakable: boolean;
  readonly stockMode: StockMode;
  readonly status: ProductPresentationStatus;
  readonly version: number;
}

/**
 * ProductPresentation — "unidad vendible/operativa final" (DEC-004,
 * closed). SKU, barcode resolution, price, cost, unit and inventory all
 * resolve here, never on Product or ProductVariant. `variantId` cross-
 * checking against the Variant's own `productId` is a cross-aggregate
 * invariant (DEC-004 §"Consistencia entre Product y ProductVariant") and is
 * deliberately NOT done inside this class — it needs the loaded
 * ProductVariant, which this aggregate does not hold; CreatePresentation
 * (application layer) validates it instead.
 *
 * Weight-variable fields (`minimum_quantity`/`maximum_quantity`/
 * `tare_quantity`/`scale_format`) are closed columns in catalog-schema.md
 * but UC-CAT-005's own "Entrada" list never describes their input contract
 * — not modeled in B27, registered as a remaining gap rather than guessed.
 */
export class ProductPresentation {
  /** Derived, not a free input — catalog-schema.md: "NON_STOCK implica inventory_enabled = false; los demás modos requieren inventario habilitado" fully determines this from `stockMode`. */
  readonly inventoryEnabled: boolean;

  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly productId: string,
    readonly variantId: string | null,
    readonly name: string,
    readonly internalSku: string | null,
    readonly unitId: string,
    readonly containedQuantity: Quantity,
    readonly variableQuantity: boolean,
    readonly salesEnabled: boolean,
    readonly purchasingEnabled: boolean,
    readonly breakable: boolean,
    readonly stockMode: StockMode,
    readonly status: ProductPresentationStatus,
    readonly version: number,
  ) {
    this.inventoryEnabled = stockMode !== "NON_STOCK";
  }

  static create(input: CreateProductPresentationInput): ProductPresentation {
    if (!input.name.trim()) {
      throw new CatalogDomainError("EMPTY_PRESENTATION_NAME", "presentation name must not be empty");
    }
    // UC-CAT-005 rule 1: "contained_quantity debe ser mayor que cero".
    if (!input.containedQuantity.isPositive()) {
      throw new CatalogDomainError("NON_POSITIVE_CONTAINED_QUANTITY", "contained quantity must be strictly positive");
    }
    const inventoryEnabled = input.stockMode !== "NON_STOCK";
    // catalog-schema.md: "al menos una de sales_enabled, purchasing_enabled, inventory_enabled debe ser true".
    if (!input.salesEnabled && !input.purchasingEnabled && !inventoryEnabled) {
      throw new CatalogDomainError("PRESENTATION_NO_CAPABILITY", "a presentation must be sellable, purchasable, or inventory-enabled");
    }
    return new ProductPresentation(
      input.id, input.scope, input.productId, input.variantId, input.name, input.internalSku,
      input.unitId, input.containedQuantity, input.variableQuantity, input.salesEnabled,
      input.purchasingEnabled, input.breakable, input.stockMode, "ACTIVE", 1,
    );
  }

  /** B29: reconstructs a ProductPresentation from an already-persisted row — same posture as `Product.restore()`. */
  static restore(input: RestoreProductPresentationInput): ProductPresentation {
    return new ProductPresentation(
      input.id, input.scope, input.productId, input.variantId, input.name, input.internalSku,
      input.unitId, input.containedQuantity, input.variableQuantity, input.salesEnabled,
      input.purchasingEnabled, input.breakable, input.stockMode, input.status, input.version,
    );
  }
}
