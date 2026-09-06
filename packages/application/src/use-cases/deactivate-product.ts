import { CatalogDomainError, Product, ProductDeactivated, type Actor, type CompanyScope } from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { ProductConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import type { ProductRepository } from "../ports/product-repository.js";

export interface DeactivateProductCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly productId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type DeactivateProductResult =
  | { readonly kind: "DEACTIVATED"; readonly product: Product; readonly event: ProductDeactivated }
  | { readonly kind: "ALREADY_APPLIED"; readonly product: Product }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "NOT_FOUND" | "VERSION_CONFLICT" | "ALREADY_INACTIVE" };

/** UC-CAT-002 "Flujo de desactivación". Same replay-before-version-check ordering as UpdateProductUseCase. */
export class DeactivateProductUseCase {
  constructor(
    private readonly repository: ProductRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly clock: Clock,
  ) {}

  async execute(command: DeactivateProductCommand): Promise<DeactivateProductResult> {
    const authorized = await this.authorization.canDeactivateProduct(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.repository.findDeactivationByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_APPLIED", product: replay };

    const existing = await this.repository.findById(command.scope, command.productId);
    if (!existing || !existing.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "NOT_FOUND" };
    }

    let deactivated: Product;
    try {
      deactivated = existing.deactivate(command.expectedVersion);
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "PRODUCT_VERSION_CONFLICT") {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      if (error instanceof CatalogDomainError && error.code === "PRODUCT_ALREADY_INACTIVE") {
        return { kind: "REJECTED", reason: "ALREADY_INACTIVE" };
      }
      throw error;
    }

    try {
      await this.repository.saveDeactivation(deactivated, command.idempotencyKey);
    } catch (error) {
      if (error instanceof ProductConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "DEACTIVATED", product: deactivated, event: ProductDeactivated.from(deactivated, this.clock.now()) };
  }
}
