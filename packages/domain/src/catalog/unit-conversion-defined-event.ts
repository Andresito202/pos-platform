import type { UnitConversion } from "./unit-conversion.js";

/** DEC-004 "Eventos de dominio": `ProductPresentationConversionDefined`. */
export class ProductPresentationConversionDefined {
  readonly type = "ProductPresentationConversionDefined";
  private constructor(
    readonly conversionId: string,
    readonly sourcePresentationId: string,
    readonly targetPresentationId: string,
    readonly companyId: string,
    readonly occurredAt: Date,
  ) {}
  static from(conversion: UnitConversion, now: Date): ProductPresentationConversionDefined {
    return new ProductPresentationConversionDefined(
      conversion.id, conversion.sourcePresentationId, conversion.targetPresentationId, conversion.scope.companyId, now,
    );
  }
}
