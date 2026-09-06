import {
  CatalogDomainError,
  ConversionFactor,
  ProductPresentationConversionDefined,
  UnitConversion,
  type Actor,
  type CompanyScope,
} from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";
import { CatalogDuplicateConflictError } from "../ports/catalog-conflict-errors.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { UnitConversionRepository } from "../ports/unit-conversion-repository.js";

export interface DefineConversionCommand {
  readonly scope: CompanyScope;
  readonly actor: Actor;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  readonly factor: string;
  readonly reversible: boolean;
  readonly requiresAuthorization: boolean;
  readonly wastePolicy: string | null;
  readonly costPolicy: string | null;
  readonly lotPolicy: string | null;
  readonly idempotencyKey: string;
}

export type DefineConversionResult =
  | { readonly kind: "DEFINED"; readonly conversion: UnitConversion; readonly event: ProductPresentationConversionDefined }
  | { readonly kind: "ALREADY_DEFINED"; readonly conversion: UnitConversion }
  | {
      readonly kind: "REJECTED";
      readonly reason:
        | "NOT_AUTHORIZED"
        | "SOURCE_NOT_FOUND"
        | "TARGET_NOT_FOUND"
        | "SAME_PRESENTATION"
        | "PRODUCT_MISMATCH"
        | "VARIANT_MISMATCH"
        | "INVALID_FACTOR"
        | "CONVERSION_ALREADY_EXISTS";
    };

/**
 * The Catalog-owned part of UC-CAT-006: DEFINING a conversion rule between
 * two existing Presentations of the same Product (and Variant, when
 * present). UC-CAT-006's actual document describes only Inventory's
 * EXECUTION of an already-defined rule ("el sistema obtiene la regla de
 * conversión vigente" — step 1 presupposes the rule exists); it gives no
 * evidence for a Catalog-side definition flow of its own, so this
 * pipeline is this block's own minimal design, not a UC-CAT-006
 * transcription. No stock movement, deduction, or increment happens here
 * — that is Inventory's job and stays entirely untouched.
 */
export class DefineConversionUseCase {
  constructor(
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly conversionRepository: UnitConversionRepository,
    private readonly authorization: CatalogAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: DefineConversionCommand): Promise<DefineConversionResult> {
    const authorized = await this.authorization.canDefineConversion(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.conversionRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_DEFINED", conversion: replay };

    const source = await this.presentationRepository.findById(command.scope, command.sourcePresentationId);
    if (!source || !source.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "SOURCE_NOT_FOUND" };
    }
    const target = await this.presentationRepository.findById(command.scope, command.targetPresentationId);
    if (!target || !target.scope.equals(command.scope)) {
      return { kind: "REJECTED", reason: "TARGET_NOT_FOUND" };
    }

    // DEC-004 "Invariante de conversión": source.product_id = target.product_id, source.variant_id = target.variant_id.
    if (source.productId !== target.productId) {
      return { kind: "REJECTED", reason: "PRODUCT_MISMATCH" };
    }
    if (source.variantId !== target.variantId) {
      return { kind: "REJECTED", reason: "VARIANT_MISMATCH" };
    }

    let factor: ConversionFactor;
    try {
      factor = ConversionFactor.fromString(command.factor);
    } catch {
      return { kind: "REJECTED", reason: "INVALID_FACTOR" };
    }

    let conversion: UnitConversion;
    try {
      conversion = UnitConversion.define({
        id: this.idGenerator.newId(),
        scope: command.scope,
        productId: source.productId,
        variantId: source.variantId,
        sourcePresentationId: source.id,
        targetPresentationId: target.id,
        factor,
        reversible: command.reversible,
        requiresAuthorization: command.requiresAuthorization,
        wastePolicy: command.wastePolicy,
        costPolicy: command.costPolicy,
        lotPolicy: command.lotPolicy,
        validFrom: this.clock.now(),
      });
    } catch (error) {
      if (error instanceof CatalogDomainError && error.code === "CONVERSION_SAME_PRESENTATION") {
        return { kind: "REJECTED", reason: "SAME_PRESENTATION" };
      }
      if (error instanceof CatalogDomainError && error.code === "CATALOG_CONVERSION_FACTOR_INVALID") {
        return { kind: "REJECTED", reason: "INVALID_FACTOR" };
      }
      throw error;
    }

    try {
      await this.conversionRepository.save(conversion, command.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        const replayed = await this.conversionRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replayed) return { kind: "ALREADY_DEFINED", conversion: replayed };
      }
      // catalog-schema.md: "UNIQUE (tenant_id, company_id, product_id,
      // source_presentation_id, target_presentation_id, version)" — B27
      // never re-versions a conversion (always version 1), so a second
      // DEFINE for the same pair is a genuine physical duplicate, not
      // covered by DEC-004's error registry (no CATALOG_CONVERSION_DUPLICATE
      // code exists there) — a local, evidence-grounded addition.
      if (error instanceof CatalogDuplicateConflictError) {
        return { kind: "REJECTED", reason: "CONVERSION_ALREADY_EXISTS" };
      }
      throw error;
    }

    return { kind: "DEFINED", conversion, event: ProductPresentationConversionDefined.from(conversion, this.clock.now()) };
  }
}
