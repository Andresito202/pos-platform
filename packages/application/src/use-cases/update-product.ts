import { CatalogDomainError, Product, ProductUpdated, type Actor, type CompanyScope } from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { ProductConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import type { ProductRepository } from "../ports/product-repository.js";

export interface UpdateProductCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly productId: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly brandId: string | null;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export type UpdateProductResult =
  | { readonly kind: "UPDATED"; readonly product: Product; readonly event: ProductUpdated }
  | { readonly kind: "ALREADY_APPLIED"; readonly product: Product }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "NOT_FOUND" | "EMPTY_NAME" | "VERSION_CONFLICT" };

/**
 * UC-CAT-002 "Flujo de actualización", narrowed to the confirmed-editable
 * fields (see `UpdateProductInput`'s doc comment). Order: authorization ->
 * idempotency replay (bypasses version checking entirely, same as
 * CreateProduct's replay) -> load -> scope check -> domain mutation
 * (which itself asserts `expectedVersion`) -> persist. A stale
 * `expectedVersion` on a genuinely NEW request (not a replay) surfaces as
 * `VERSION_CONFLICT` — idempotency and optimistic concurrency are
 * deliberately different mechanisms here (B27 §32).
 */
export class UpdateProductUseCase {
  constructor(
    private readonly repository: ProductRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly clock: Clock,
  ) {}

  async execute(command: UpdateProductCommand): Promise<UpdateProductResult> {
    const authorized = await this.authorization.canUpdateProduct(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.repository.findUpdateByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_APPLIED", product: replay };

    const existing = await this.repository.findById(command.scope, command.productId);
    if (!existing || !existing.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "NOT_FOUND" };
    }

    let updated: Product;
    try {
      updated = existing.update(
        { name: command.name, description: command.description, categoryId: command.categoryId, brandId: command.brandId },
        command.expectedVersion,
      );
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "EMPTY_PRODUCT_NAME") {
        return { kind: "REJECTED", reason: "EMPTY_NAME" };
      }
      if (error instanceof CatalogDomainError && error.code === "PRODUCT_VERSION_CONFLICT") {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    try {
      await this.repository.saveUpdate(updated, command.idempotencyKey);
    } catch (error) {
      // B29: the physical version guard can lose a race even though this
      // use case's own in-memory `expectedVersion` check just passed — a
      // concurrent writer committed between our read and our write. Same
      // observable outcome as the domain-level check above.
      if (error instanceof ProductConflictError) {
        return { kind: "REJECTED", reason: "VERSION_CONFLICT" };
      }
      throw error;
    }

    return { kind: "UPDATED", product: updated, event: ProductUpdated.from(existing, updated, this.clock.now()) };
  }
}
