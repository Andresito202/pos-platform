import type { CompanyScope } from "../company-scope.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";
import type { ConversionFactor } from "./conversion-factor.js";

/** `catalog.unit_conversions.status`: closed 2-value set (catalog-schema.md). */
export type UnitConversionStatus = "ACTIVE" | "INACTIVE";

export interface DefineUnitConversionInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly variantId: string | null;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  readonly factor: ConversionFactor;
  readonly reversible: boolean;
  readonly requiresAuthorization: boolean;
  /**
   * `waste_policy`/`cost_policy`/`lot_policy` are "código estable" per
   * DEC-004 — the document names the concepts but never enumerates values,
   * unlike `stock_mode`/`variant_policy`. Modeled as opaque non-empty
   * strings, the same treatment `reasonCode` already gets in Cash/Inventory
   * (a real caller-supplied value, not a closed enum this repository has
   * evidence for).
   */
  readonly wastePolicy: string | null;
  readonly costPolicy: string | null;
  readonly lotPolicy: string | null;
  readonly validFrom: Date;
}

export interface RestoreUnitConversionInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly variantId: string | null;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  readonly factor: ConversionFactor;
  readonly reversible: boolean;
  readonly requiresAuthorization: boolean;
  readonly wastePolicy: string | null;
  readonly costPolicy: string | null;
  readonly lotPolicy: string | null;
  readonly validFrom: Date;
  readonly status: UnitConversionStatus;
  readonly version: number;
}

/**
 * UnitConversion — the DEFINITION of a conversion rule between two
 * Presentations of the same Product (and, when present, the same
 * Variant). Only the domain-level invariants that can be checked from the
 * fields this aggregate itself holds live here (`factor > 0`, source !=
 * target). Cross-aggregate invariants (source/target actually belong to
 * the same Product/Variant) need the loaded Presentations and are
 * validated by `CreateConversionUseCase` (application layer) — same
 * separation ProductPresentation uses for its own variant-ownership check.
 *
 * Graph-level invariants (no conversion cycles) and persistence-level
 * invariants (no two conflicting active conversions committed
 * concurrently) are explicitly OUT of scope here — B25/B26 already flagged
 * "equivalencia/ciclos bajo concurrencia real" as a condition that can
 * only be closed once a physical adapter exists to test it.
 */
export class UnitConversion {
  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly productId: string,
    readonly variantId: string | null,
    readonly sourcePresentationId: string,
    readonly targetPresentationId: string,
    readonly factor: ConversionFactor,
    readonly reversible: boolean,
    readonly requiresAuthorization: boolean,
    readonly wastePolicy: string | null,
    readonly costPolicy: string | null,
    readonly lotPolicy: string | null,
    readonly validFrom: Date,
    readonly status: UnitConversionStatus,
    readonly version: number,
  ) {}

  static define(input: DefineUnitConversionInput): UnitConversion {
    // "Origen y destino no son iguales" — DEC-004 restricciones conceptuales #8.
    if (input.sourcePresentationId === input.targetPresentationId) {
      throw new CatalogDomainError("CONVERSION_SAME_PRESENTATION", "source and target presentation must differ");
    }
    if (!input.factor.isPositive()) {
      throw new CatalogDomainError("CATALOG_CONVERSION_FACTOR_INVALID", "conversion factor must be strictly positive");
    }
    return new UnitConversion(
      input.id, input.scope, input.productId, input.variantId, input.sourcePresentationId,
      input.targetPresentationId, input.factor, input.reversible, input.requiresAuthorization,
      input.wastePolicy, input.costPolicy, input.lotPolicy, input.validFrom, "ACTIVE", 1,
    );
  }

  /** B29: reconstructs a UnitConversion from an already-persisted row — same posture as `Product.restore()`. */
  static restore(input: RestoreUnitConversionInput): UnitConversion {
    return new UnitConversion(
      input.id, input.scope, input.productId, input.variantId, input.sourcePresentationId,
      input.targetPresentationId, input.factor, input.reversible, input.requiresAuthorization,
      input.wastePolicy, input.costPolicy, input.lotPolicy, input.validFrom, input.status, input.version,
    );
  }
}
