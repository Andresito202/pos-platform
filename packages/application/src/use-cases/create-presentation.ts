import {
  CatalogDomainError,
  ProductPresentation,
  ProductPresentationCreated,
  Quantity,
  type Actor,
  type CompanyScope,
  type StockMode,
} from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { CatalogDuplicateConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { ProductRepository } from "../ports/product-repository.js";
import type { ProductVariantRepository } from "../ports/product-variant-repository.js";

export interface CreatePresentationCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly productId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly internalSku: string | null;
  readonly unitId: string;
  readonly containedQuantity: string;
  readonly variableQuantity: boolean;
  readonly salesEnabled: boolean;
  readonly purchasingEnabled: boolean;
  readonly breakable: boolean;
  readonly stockMode: StockMode;
  readonly idempotencyKey: string;
}

export type CreatePresentationResult =
  | { readonly kind: "CREATED"; readonly presentation: ProductPresentation; readonly event: ProductPresentationCreated }
  | { readonly kind: "ALREADY_CREATED"; readonly presentation: ProductPresentation }
  | {
      readonly kind: "REJECTED";
      readonly reason:
        | "NOT_AUTHORIZED"
        | "PRODUCT_NOT_FOUND"
        | "PRODUCT_INACTIVE"
        | "VARIANT_NOT_FOUND"
        | "VARIANT_PRODUCT_MISMATCH"
        | "EMPTY_NAME"
        | "INVALID_QUANTITY"
        | "NON_POSITIVE_QUANTITY"
        | "NO_CAPABILITY"
        | "SKU_ALREADY_EXISTS";
    };

/**
 * UC-CAT-005 main flow, exactly the 10-step pipeline this block specifies.
 * Bundling an optional `UnitConversion` definition (catalog-schema.md:
 * "el input base_presentation_id/conversion_factor... crea Presentation y
 * esta regla dentro de una sola transacción") is deliberately NOT done
 * here — that transactional coupling is a persistence-layer concern with
 * no adapter yet to honor it, and this exact pipeline never lists it as a
 * step. `DefineConversionUseCase` covers UC-CAT-006's Catalog-owned part
 * as its own, separately authorized operation instead — see that file.
 */
export class CreatePresentationUseCase {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly variantRepository: ProductVariantRepository,
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CreatePresentationCommand): Promise<CreatePresentationResult> {
    const authorized = await this.authorization.canCreatePresentation(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.presentationRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_CREATED", presentation: replay };

    const product = await this.productRepository.findById(command.scope, command.productId);
    if (!product || !product.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "PRODUCT_NOT_FOUND" };
    }
    // UC-CAT-005 precondition: "Producto activo".
    if (product.status !== "ACTIVE") {
      return { kind: "REJECTED", reason: "PRODUCT_INACTIVE" };
    }

    if (command.variantId !== null) {
      const variant = await this.variantRepository.findById(command.scope, command.variantId);
      if (!variant || !variant.scope.equals(command.scope)) {
        return { kind: "REJECTED", reason: "VARIANT_NOT_FOUND" };
      }
      // DEC-004 "Consistencia entre Product y ProductVariant" — CATALOG_VARIANT_PRODUCT_MISMATCH.
      if (variant.productId !== command.productId) {
        return { kind: "REJECTED", reason: "VARIANT_PRODUCT_MISMATCH" };
      }
    }

    let containedQuantity: Quantity;
    try {
      containedQuantity = Quantity.fromString(command.containedQuantity);
    } catch {
      return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
    }

    if (command.internalSku) {
      const skuTaken = await this.presentationRepository.existsBySku(command.scope, command.internalSku);
      if (skuTaken) return { kind: "REJECTED", reason: "SKU_ALREADY_EXISTS" };
    }

    let presentation: ProductPresentation;
    try {
      presentation = ProductPresentation.create({
        id: this.idGenerator.newId(),
        scope: command.scope,
        productId: command.productId,
        variantId: command.variantId,
        name: command.name,
        internalSku: command.internalSku,
        unitId: command.unitId,
        containedQuantity,
        variableQuantity: command.variableQuantity,
        salesEnabled: command.salesEnabled,
        purchasingEnabled: command.purchasingEnabled,
        breakable: command.breakable,
        stockMode: command.stockMode,
      });
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "EMPTY_PRESENTATION_NAME") {
        return { kind: "REJECTED", reason: "EMPTY_NAME" };
      }
      if (error instanceof CatalogDomainError && error.code === "NON_POSITIVE_CONTAINED_QUANTITY") {
        return { kind: "REJECTED", reason: "NON_POSITIVE_QUANTITY" };
      }
      if (error instanceof CatalogDomainError && error.code === "PRESENTATION_NO_CAPABILITY") {
        return { kind: "REJECTED", reason: "NO_CAPABILITY" };
      }
      throw error;
    }

    try {
      await this.presentationRepository.save(presentation, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replayed = await this.presentationRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replayed) return { kind: "ALREADY_CREATED", presentation: replayed };
      }
      if (error instanceof CatalogDuplicateConflictError) {
        return { kind: "REJECTED", reason: "SKU_ALREADY_EXISTS" };
      }
      throw error;
    }

    return { kind: "CREATED", presentation, event: ProductPresentationCreated.from(presentation, this.clock.now()) };
  }
}
