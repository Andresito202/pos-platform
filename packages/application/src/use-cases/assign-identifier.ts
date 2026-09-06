import {
  CatalogDomainError,
  ProductIdentifier,
  ProductIdentifierAssigned,
  type Actor,
  type CompanyScope,
  type IdentifierType,
} from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { CatalogDuplicateConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { IdentifierNormalizationPolicy } from "../ports/identifier-normalization-policy.js";
import type { ProductIdentifierRepository } from "../ports/product-identifier-repository.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";

export interface AssignIdentifierCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly presentationId: string;
  readonly identifierType: IdentifierType;
  readonly rawValue: string;
  readonly idempotencyKey: string;
}

export type AssignIdentifierResult =
  | { readonly kind: "ASSIGNED"; readonly identifier: ProductIdentifier; readonly event: ProductIdentifierAssigned }
  | { readonly kind: "ALREADY_ASSIGNED"; readonly identifier: ProductIdentifier }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "PRESENTATION_NOT_FOUND" | "EMPTY_VALUE" | "IDENTIFIER_ALREADY_EXISTS" };

/**
 * UC-CAT-003 main flow. `productId`/`variantId` on the resulting
 * ProductIdentifier are derived from the loaded Presentation (denormalized
 * per catalog-schema.md's own column list), never accepted as separate
 * caller input — this keeps the "identifier always resolves to a
 * presentation" invariant structural instead of re-validated by hand
 * (B27 §20: "Identifier -> Presentation, NOT Identifier -> Product").
 */
export class AssignIdentifierUseCase {
  constructor(
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly identifierRepository: ProductIdentifierRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly normalizationPolicy: IdentifierNormalizationPolicy,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: AssignIdentifierCommand): Promise<AssignIdentifierResult> {
    const authorized = await this.authorization.canAssignIdentifier(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.identifierRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_ASSIGNED", identifier: replay };

    const presentation = await this.presentationRepository.findById(command.scope, command.presentationId);
    if (!presentation || !presentation.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" };
    }

    if (!command.rawValue.trim()) {
      return { kind: "REJECTED", reason: "EMPTY_VALUE" };
    }

    const normalizedValue = this.normalizationPolicy.normalize(command.identifierType, command.rawValue);

    // UC-CAT-003 rule 1: an active identifier may not resolve to two sellable items within the same company.
    const alreadyTaken = await this.identifierRepository.existsByTypeAndNormalizedValue(command.scope, command.identifierType, normalizedValue);
    if (alreadyTaken) {
      return { kind: "REJECTED", reason: "IDENTIFIER_ALREADY_EXISTS" };
    }

    let identifier: ProductIdentifier;
    try {
      identifier = ProductIdentifier.assign({
        id: this.idGenerator.newId(),
        scope: command.scope,
        productId: presentation.productId,
        variantId: presentation.variantId,
        presentationId: presentation.id,
        identifierType: command.identifierType,
        rawValue: command.rawValue,
        normalizedValue,
      });
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "EMPTY_IDENTIFIER_VALUE") {
        return { kind: "REJECTED", reason: "EMPTY_VALUE" };
      }
      throw error;
    }

    try {
      await this.identifierRepository.save(identifier, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replayed = await this.identifierRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replayed) return { kind: "ALREADY_ASSIGNED", identifier: replayed };
      }
      if (error instanceof CatalogDuplicateConflictError) {
        return { kind: "REJECTED", reason: "IDENTIFIER_ALREADY_EXISTS" };
      }
      throw error;
    }

    return { kind: "ASSIGNED", identifier, event: ProductIdentifierAssigned.from(identifier, this.clock.now()) };
  }
}
