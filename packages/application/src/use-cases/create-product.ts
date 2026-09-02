import { CatalogDomainError, Product, ProductCreated, type Actor, type CompanyScope, type ProductType } from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ProductRepository } from "../ports/product-repository.js";

export interface CreateProductCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
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
  readonly idempotencyKey: string;
}

export type CreateProductResult =
  | { readonly kind: "CREATED"; readonly product: Product; readonly event: ProductCreated }
  | { readonly kind: "ALREADY_CREATED"; readonly product: Product }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "EMPTY_NAME" | "EXPIRATION_REQUIRES_LOT_CONTROL" | "INTERNAL_CODE_EXISTS" };

/**
 * UC-CAT-001, main flow (steps 1-9), narrowed exactly like every other
 * use case in this repository: the "Datos incompletos -> borrador" and
 * "Producto similar existente" alternate flows are not implemented (no
 * defined draft policy, no fuzzy-match algorithm specified) — see
 * Product.create()'s own doc comment.
 *
 * Order: authorization (precondition) -> idempotency replay -> domain
 * validation (name, expiration/lot — Product.create()) -> internal-code
 * uniqueness (flow step 4, textually AFTER step 3's field validation) ->
 * persist. UC-CAT-001 does not number idempotency into its main flow at
 * all (it is a separate alternate-flow note, unlike UC-CASH-003's
 * explicit numbered placement) — placing it right after authorization is
 * this use case's own choice, not copied from Cash.
 */
export class CreateProductUseCase {
  constructor(
    private readonly repository: ProductRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CreateProductCommand): Promise<CreateProductResult> {
    const authorized = await this.authorization.canCreateProduct(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_CREATED", product: existing };

    let product: Product;
    try {
      product = Product.create({
        id: this.idGenerator.newId(),
        scope: command.scope,
        internalCode: command.internalCode,
        name: command.name,
        description: command.description,
        categoryId: command.categoryId,
        brandId: command.brandId,
        productType: command.productType,
        stockControlled: command.stockControlled,
        lotControlled: command.lotControlled,
        expirationControlled: command.expirationControlled,
        serialControlled: command.serialControlled,
        taxCategoryId: command.taxCategoryId,
        baseUnitId: command.baseUnitId,
      });
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "EMPTY_PRODUCT_NAME") {
        return { kind: "REJECTED", reason: "EMPTY_NAME" };
      }
      if (error instanceof CatalogDomainError && error.code === "EXPIRATION_REQUIRES_LOT_CONTROL") {
        return { kind: "REJECTED", reason: "EXPIRATION_REQUIRES_LOT_CONTROL" };
      }
      throw error;
    }

    if (command.internalCode) {
      const codeTaken = await this.repository.existsByInternalCode(command.scope, command.internalCode);
      if (codeTaken) return { kind: "REJECTED", reason: "INTERNAL_CODE_EXISTS" };
    }

    await this.repository.save(product, command.idempotencyKey);

    return { kind: "CREATED", product, event: ProductCreated.from(product, this.clock.now()) };
  }
}
