import { describe, expect, it } from "vitest";
import { CatalogDomainError, CompanyScope, ProductIdentifier, ProductIdentifierAssigned, type AssignProductIdentifierInput } from "../src/index.js";

const scope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
);
const presentationId = "018f0000-0000-7000-8000-000000000700";

function validInput(overrides: Partial<AssignProductIdentifierInput> = {}): AssignProductIdentifierInput {
  return {
    id: "018f0000-0000-7000-8000-000000000a00",
    scope,
    productId: "018f0000-0000-7000-8000-000000000500",
    variantId: null,
    presentationId,
    identifierType: "EAN_13",
    rawValue: "7701234567890",
    normalizedValue: "7701234567890",
    ...overrides,
  };
}

describe("ProductIdentifier.assign", () => {
  it("assigns an ACTIVE identifier resolving to a Presentation", () => {
    const identifier = ProductIdentifier.assign(validInput());
    expect(identifier.status).toBe("ACTIVE");
    expect(identifier.presentationId).toBe(presentationId);
  });

  it("rejects an empty raw value", () => {
    expect(() => ProductIdentifier.assign(validInput({ rawValue: "   " }))).toThrow(CatalogDomainError);
  });

  it("rejects an empty normalized value", () => {
    expect(() => ProductIdentifier.assign(validInput({ normalizedValue: "" }))).toThrow(CatalogDomainError);
  });

  it.each(["INTERNAL", "EAN_8", "EAN_13", "UPC", "PLU", "SUPPLIER_CODE", "SCALE_BARCODE", "INTERNAL_QR", "MANUAL_CODE"] as const)(
    "accepts the closed identifier type %s (UC-CAT-003 'Tipos iniciales')",
    (identifierType) => {
      const identifier = ProductIdentifier.assign(validInput({ identifierType }));
      expect(identifier.identifierType).toBe(identifierType);
    },
  );

  it("carries variantId when supplied, but does not require it (barcode != SKU, resolution always includes presentationId)", () => {
    const identifier = ProductIdentifier.assign(validInput({ variantId: "018f0000-0000-7000-8000-000000000900" }));
    expect(identifier.variantId).toBe("018f0000-0000-7000-8000-000000000900");
    expect(identifier.presentationId).toBe(presentationId);
  });

  it("emits ProductIdentifierAssigned", () => {
    const identifier = ProductIdentifier.assign(validInput());
    const event = ProductIdentifierAssigned.from(identifier, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductIdentifierAssigned", identifierId: identifier.id, presentationId, companyId: scope.companyId });
  });
});
