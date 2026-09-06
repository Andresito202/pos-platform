import type { CompanyScope } from "../company-scope.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";

/** Closed set from docs/architecture/physical-model/catalog-schema.md, transcribed. */
export type ProductType = "STANDARD" | "WEIGHTED" | "SERVICE" | "COMPOSITE" | "PREPARED" | "RETURNABLE" | "REGULATED";

/**
 * `catalog.products.status` (catalog-schema.md) is closed as a 3-value set.
 * `DRAFT` is included for schema fidelity but no code path in this
 * repository ever produces it: UC-CAT-001's "Datos incompletos -> guardarse
 * como borrador si la política lo permite" depends on a draft-eligibility
 * policy this repository never defines (which fields, who decides) — B26
 * HD-09, still open. `Product.create()` always produces `ACTIVE`.
 */
export type ProductStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

/**
 * `catalog.products.variant_policy` (catalog-schema.md), closed 3-value set
 * per DEC-004. Set once at creation; there is no operation to change it
 * after the fact — DEC-004 lists "estructura de variantes" as a
 * high-impact change (UC-CAT-002) without defining a transition rule
 * (whether it may change with Variants already created, who authorizes it),
 * B26 HD-05. Rather than invent that rule, this repository simply does not
 * offer a mutator for it yet.
 */
export type VariantPolicy = "NO_VARIANTS" | "OPTIONAL_VARIANTS" | "REQUIRED_VARIANTS";

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
  readonly variantPolicy: VariantPolicy;
}

/**
 * UC-CAT-002 "Campos normalmente editables": nombre comercial, descripción,
 * categoría, marca — `imagen` is excluded (no domain representation exists
 * anywhere in this repository, NOT FOUND) and `business_attributes` stays
 * out (no published contract, catalog-schema.md). High-impact fields
 * (unidad base, controles de lote/vencimiento, product_type,
 * variant_policy, stock_controlled) are deliberately NOT part of this
 * input: UC-CAT-002 requires validating them against "inconsistencias con
 * inventario existente" before allowing the change, which needs an
 * Inventory query capability this block does not introduce (Inventory
 * stays untouched, per B27 scope) — registered as a remaining gap, not
 * silently permitted.
 */
export interface UpdateProductInput {
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly brandId: string | null;
}

export interface RestoreProductInput {
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
  readonly variantPolicy: VariantPolicy;
  readonly status: ProductStatus;
  readonly version: number;
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
 *
 * Immutable — every mutation (`update`, `deactivate`) returns a new
 * instance with `version + 1`, matching CashShift's version-per-write
 * discipline (B26: this is an architectural decision, reusing an existing
 * precedent, not a new business rule) and UC-CAT-002's own text
 * ("verifica la versión actual... incrementa la versión").
 */
export class Product {
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
    readonly variantPolicy: VariantPolicy,
    readonly status: ProductStatus,
    readonly version: number,
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
      input.taxCategoryId, input.baseUnitId, input.variantPolicy, "ACTIVE", 1,
    );
  }

  /**
   * B29 (Catalog persistence): reconstructs a Product from an already-
   * persisted row — no invariant re-checking, because a row read back from
   * storage already satisfied every invariant `create()`/`update()`/
   * `deactivate()` enforce at the moment it was written. Adapters use this,
   * application/domain business flows never should — same posture as
   * `CashShift.restore()`.
   */
  static restore(input: RestoreProductInput): Product {
    return new Product(
      input.id, input.scope, input.internalCode, input.name, input.description,
      input.categoryId, input.brandId, input.productType, input.stockControlled,
      input.lotControlled, input.expirationControlled, input.serialControlled,
      input.taxCategoryId, input.baseUnitId, input.variantPolicy, input.status, input.version,
    );
  }

  /** UC-CAT-002 flow step 2 + rule 6: every write validates expected_version. */
  private assertVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new CatalogDomainError("PRODUCT_VERSION_CONFLICT", `expected version ${expectedVersion}, product is at ${this.version}`);
    }
  }

  /** UC-CAT-002 "Flujo de actualización" — only the fields confirmed editable (see UpdateProductInput). */
  update(input: UpdateProductInput, expectedVersion: number): Product {
    this.assertVersion(expectedVersion);
    if (!input.name.trim()) {
      throw new CatalogDomainError("EMPTY_PRODUCT_NAME", "product name must not be empty");
    }
    return new Product(
      this.id, this.scope, this.internalCode, input.name, input.description,
      input.categoryId, input.brandId, this.productType, this.stockControlled,
      this.lotControlled, this.expirationControlled, this.serialControlled,
      this.taxCategoryId, this.baseUnitId, this.variantPolicy, this.status, this.version + 1,
    );
  }

  /**
   * UC-CAT-002 "Flujo de desactivación" — "Desactivar no elimina" (regla 1),
   * identity stays stable. Rejects a repeated deactivation of an already-
   * INACTIVE product with a domain error rather than silently no-op'ing:
   * same guard-on-terminal-state posture as `CashShift.close()`'s
   * `SHIFT_NOT_OPEN` check (an architectural precedent, not an invented
   * business rule) — UC-CAT-002 never defines what a repeat deactivation
   * outside of idempotent replay should do, so this fails loud instead of
   * guessing "success" or silently doing nothing.
   */
  deactivate(expectedVersion: number): Product {
    this.assertVersion(expectedVersion);
    if (this.status === "INACTIVE") {
      throw new CatalogDomainError("PRODUCT_ALREADY_INACTIVE", `product ${this.id} is already inactive`);
    }
    return new Product(
      this.id, this.scope, this.internalCode, this.name, this.description,
      this.categoryId, this.brandId, this.productType, this.stockControlled,
      this.lotControlled, this.expirationControlled, this.serialControlled,
      this.taxCategoryId, this.baseUnitId, this.variantPolicy, "INACTIVE", this.version + 1,
    );
  }
}
