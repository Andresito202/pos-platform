import { describe, expect, it } from "vitest";
import { CatalogDomainError, CompanyScope, ProductVariant, ProductVariantCreated, VariantAttributes } from "../src/index.js";

const scope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
);
const productId = "018f0000-0000-7000-8000-000000000500";

describe("VariantAttributes.fromRecord", () => {
  it("accepts a valid, non-empty attribute set", () => {
    const attributes = VariantAttributes.fromRecord({ color: "azul", talla: "M" });
    expect(attributes.toRecord()).toEqual({ color: "azul", talla: "M" });
  });

  it("rejects an empty attribute set (a variant must combine at least one attribute)", () => {
    expect(() => VariantAttributes.fromRecord({})).toThrow(CatalogDomainError);
  });

  it("rejects an empty attribute value", () => {
    expect(() => VariantAttributes.fromRecord({ color: "" })).toThrow(CatalogDomainError);
  });

  it("equals() compares content, not object identity", () => {
    const a = VariantAttributes.fromRecord({ color: "azul", talla: "M" });
    const b = VariantAttributes.fromRecord({ talla: "M", color: "azul" });
    expect(a.equals(b)).toBe(true);
  });

  it("equals() detects a real difference", () => {
    const a = VariantAttributes.fromRecord({ color: "azul" });
    const b = VariantAttributes.fromRecord({ color: "roja" });
    expect(a.equals(b)).toBe(false);
  });
});

describe("ProductVariant.create", () => {
  it("creates an ACTIVE variant at version 1, trusting the pre-computed canonical key", () => {
    const attributes = VariantAttributes.fromRecord({ color: "azul", talla: "M" });
    const variant = ProductVariant.create({ id: "018f0000-0000-7000-8000-000000000600", scope, productId, attributes, canonicalKey: "color=azul|talla=M" });
    expect(variant.status).toBe("ACTIVE");
    expect(variant.version).toBe(1);
    expect(variant.productId).toBe(productId);
    expect(variant.canonicalKey).toBe("color=azul|talla=M");
  });

  it("rejects an empty canonical key — the aggregate never derives one itself (B26 HD-06 stays with the application-layer policy)", () => {
    const attributes = VariantAttributes.fromRecord({ color: "azul" });
    expect(() =>
      ProductVariant.create({ id: "018f0000-0000-7000-8000-000000000600", scope, productId, attributes, canonicalKey: "" }),
    ).toThrow(CatalogDomainError);
  });

  it("emits ProductVariantCreated referencing the variant, product, and company", () => {
    const attributes = VariantAttributes.fromRecord({ color: "azul" });
    const variant = ProductVariant.create({ id: "018f0000-0000-7000-8000-000000000600", scope, productId, attributes, canonicalKey: "color=azul" });
    const event = ProductVariantCreated.from(variant, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductVariantCreated", variantId: variant.id, productId, companyId: scope.companyId });
  });
});
