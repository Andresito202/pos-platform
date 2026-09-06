import {
  CatalogDomainError,
  ProductVariant,
  ProductVariantCreated,
  VariantAttributes,
  type Actor,
  type CompanyScope,
} from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { CatalogDuplicateConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ProductRepository } from "../ports/product-repository.js";
import type { ProductVariantRepository } from "../ports/product-variant-repository.js";
import type { VariantCanonicalKeyPolicy } from "../ports/variant-canonical-key-policy.js";

export interface CreateVariantCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly productId: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

export type CreateVariantResult =
  | { readonly kind: "CREATED"; readonly variant: ProductVariant; readonly event: ProductVariantCreated }
  | { readonly kind: "ALREADY_CREATED"; readonly variant: ProductVariant }
  | {
      readonly kind: "REJECTED";
      readonly reason: "NOT_AUTHORIZED" | "PRODUCT_NOT_FOUND" | "PRODUCT_INACTIVE" | "VARIANT_NOT_ALLOWED" | "EMPTY_ATTRIBUTES" | "VARIANT_ALREADY_EXISTS";
    };

/**
 * UC-CAT-004, main flow. Pipeline: authorization -> idempotency replay ->
 * load Product -> verify scope -> validate Product is ACTIVE (UC-CAT-004
 * exception "producto inactivo") -> validate `variant_policy !=
 * NO_VARIANTS` (DEC-004: "el producto no admite variantes", closed) ->
 * validate attributes -> canonicalize (via the still-undecided B26 HD-06
 * policy) -> uniqueness check (rule 1/DEC-004 escenario 3) -> create ->
 * persist -> result.
 */
export class CreateVariantUseCase {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly variantRepository: ProductVariantRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly canonicalKeyPolicy: VariantCanonicalKeyPolicy,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CreateVariantCommand): Promise<CreateVariantResult> {
    const authorized = await this.authorization.canCreateVariant(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.variantRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_CREATED", variant: replay };

    const product = await this.productRepository.findById(command.scope, command.productId);
    if (!product || !product.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "PRODUCT_NOT_FOUND" };
    }
    if (product.status === "INACTIVE") {
      return { kind: "REJECTED", reason: "PRODUCT_INACTIVE" };
    }
    if (product.variantPolicy === "NO_VARIANTS") {
      return { kind: "REJECTED", reason: "VARIANT_NOT_ALLOWED" };
    }

    let attributes: VariantAttributes;
    try {
      attributes = VariantAttributes.fromRecord(command.attributes);
    } catch (error) {
      if (error instanceof CatalogDomainError) return { kind: "REJECTED", reason: "EMPTY_ATTRIBUTES" };
      throw error;
    }

    const canonicalKey = this.canonicalKeyPolicy.canonicalize(attributes);

    const existingVariant = await this.variantRepository.findByProductAndCanonicalKey(command.scope, command.productId, canonicalKey);
    if (existingVariant) {
      return { kind: "REJECTED", reason: "VARIANT_ALREADY_EXISTS" };
    }

    const variant = ProductVariant.create({
      id: this.idGenerator.newId(),
      scope: command.scope,
      productId: command.productId,
      attributes,
      canonicalKey,
    });

    try {
      await this.variantRepository.save(variant, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replayed = await this.variantRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replayed) return { kind: "ALREADY_CREATED", variant: replayed };
      }
      if (error instanceof CatalogDuplicateConflictError) {
        return { kind: "REJECTED", reason: "VARIANT_ALREADY_EXISTS" };
      }
      throw error;
    }

    return { kind: "CREATED", variant, event: ProductVariantCreated.from(variant, this.clock.now()) };
  }
}
