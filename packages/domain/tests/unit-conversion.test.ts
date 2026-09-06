import { describe, expect, it } from "vitest";
import { CatalogDomainError, CompanyScope, ConversionFactor, ProductPresentationConversionDefined, UnitConversion, type DefineUnitConversionInput } from "../src/index.js";

const scope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
);
const productId = "018f0000-0000-7000-8000-000000000500";
const sourcePresentationId = "018f0000-0000-7000-8000-000000000700";
const targetPresentationId = "018f0000-0000-7000-8000-000000000710";

describe("ConversionFactor", () => {
  it("preserves up to 10 fractional digits — a different precision tier than Money/Quantity's (19,6)", () => {
    const factor = ConversionFactor.fromString("1.2345678901");
    expect(factor.toString()).toBe("1.2345678901");
  });

  it("rejects an invalid decimal string", () => {
    expect(() => ConversionFactor.fromString("abc")).toThrow(TypeError);
  });

  it("isPositive() is false for zero and negative values", () => {
    expect(ConversionFactor.fromString("0").isPositive()).toBe(false);
    expect(ConversionFactor.fromString("-1").isPositive()).toBe(false);
    expect(ConversionFactor.fromString("12").isPositive()).toBe(true);
  });
});

function validInput(overrides: Partial<DefineUnitConversionInput> = {}): DefineUnitConversionInput {
  return {
    id: "018f0000-0000-7000-8000-000000000b00",
    scope,
    productId,
    variantId: null,
    sourcePresentationId,
    targetPresentationId,
    factor: ConversionFactor.fromString("12"),
    reversible: true,
    requiresAuthorization: false,
    wastePolicy: null,
    costPolicy: null,
    lotPolicy: null,
    validFrom: new Date("2026-09-02T00:00:00Z"),
    ...overrides,
  };
}

describe("UnitConversion.define", () => {
  it("defines an ACTIVE conversion at version 1", () => {
    const conversion = UnitConversion.define(validInput());
    expect(conversion.status).toBe("ACTIVE");
    expect(conversion.version).toBe(1);
    expect(conversion.factor.toString()).toBe("12.0000000000");
  });

  it("rejects source === target (DEC-004 restricciones conceptuales #8)", () => {
    expect(() => UnitConversion.define(validInput({ targetPresentationId: sourcePresentationId }))).toThrow(CatalogDomainError);
  });

  it("rejects a non-positive factor", () => {
    expect(() => UnitConversion.define(validInput({ factor: ConversionFactor.fromString("0") }))).toThrow(CatalogDomainError);
  });

  it("emits ProductPresentationConversionDefined", () => {
    const conversion = UnitConversion.define(validInput());
    const event = ProductPresentationConversionDefined.from(conversion, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({
      type: "ProductPresentationConversionDefined",
      conversionId: conversion.id,
      sourcePresentationId,
      targetPresentationId,
      companyId: scope.companyId,
    });
  });
});
