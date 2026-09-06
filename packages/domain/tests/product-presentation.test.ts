import { describe, expect, it } from "vitest";
import { CatalogDomainError, CompanyScope, ProductPresentation, ProductPresentationCreated, Quantity, type CreateProductPresentationInput } from "../src/index.js";

const scope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
);
const productId = "018f0000-0000-7000-8000-000000000500";

function validInput(overrides: Partial<CreateProductPresentationInput> = {}): CreateProductPresentationInput {
  return {
    id: "018f0000-0000-7000-8000-000000000700",
    scope,
    productId,
    variantId: null,
    name: "unidad",
    internalSku: "ARROZ-500-UND",
    unitId: "018f0000-0000-7000-8000-000000000800",
    containedQuantity: Quantity.fromString("1"),
    variableQuantity: false,
    salesEnabled: true,
    purchasingEnabled: true,
    breakable: false,
    stockMode: "INDEPENDENT",
    ...overrides,
  };
}

describe("ProductPresentation.create", () => {
  it("creates an ACTIVE presentation at version 1 with inventoryEnabled derived from stockMode", () => {
    const presentation = ProductPresentation.create(validInput());
    expect(presentation.status).toBe("ACTIVE");
    expect(presentation.version).toBe(1);
    expect(presentation.inventoryEnabled).toBe(true);
  });

  it("derives inventoryEnabled=false for NON_STOCK (catalog-schema.md: 'NON_STOCK implica inventory_enabled = false')", () => {
    const presentation = ProductPresentation.create(validInput({ stockMode: "NON_STOCK", salesEnabled: true, purchasingEnabled: false }));
    expect(presentation.inventoryEnabled).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(() => ProductPresentation.create(validInput({ name: "   " }))).toThrow(CatalogDomainError);
  });

  it("rejects a zero contained quantity (UC-CAT-005 rule 1: 'contained_quantity debe ser mayor que cero')", () => {
    expect(() => ProductPresentation.create(validInput({ containedQuantity: Quantity.zero() }))).toThrow(CatalogDomainError);
  });

  it("rejects a presentation with NO capability at all (NON_STOCK + not sellable + not purchasable)", () => {
    expect(() =>
      ProductPresentation.create(validInput({ stockMode: "NON_STOCK", salesEnabled: false, purchasingEnabled: false })),
    ).toThrow(CatalogDomainError);
  });

  it("accepts a purchase-only presentation (UC-CAT-005 pruebas mínimas: 'compra solamente')", () => {
    expect(() =>
      ProductPresentation.create(validInput({ salesEnabled: false, purchasingEnabled: true, stockMode: "NON_STOCK" })),
    ).not.toThrow();
  });

  it("accepts a variantId (cross-aggregate product/variant match is validated by the use case, not this class)", () => {
    const presentation = ProductPresentation.create(validInput({ variantId: "018f0000-0000-7000-8000-000000000900" }));
    expect(presentation.variantId).toBe("018f0000-0000-7000-8000-000000000900");
  });

  it("accepts a null internalSku — not every presentation is assigned one at creation", () => {
    const presentation = ProductPresentation.create(validInput({ internalSku: null }));
    expect(presentation.internalSku).toBeNull();
  });

  it("emits ProductPresentationCreated", () => {
    const presentation = ProductPresentation.create(validInput());
    const event = ProductPresentationCreated.from(presentation, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductPresentationCreated", presentationId: presentation.id, productId, companyId: scope.companyId });
  });
});
