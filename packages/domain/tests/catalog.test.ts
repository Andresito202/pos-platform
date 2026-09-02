import { describe, expect, it } from "vitest";
import {
  CatalogDomainError,
  CompanyScope,
  Product,
  ProductCreated,
  TenantMembership,
  TenantScope,
  UserRoleAssignment,
  roleMayCreateProduct,
  type CreateProductInput,
} from "../src/index.js";

const scope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
);
const otherCompanyScope = new CompanyScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-0000000000cc",
);

function validInput(overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return {
    id: "018f0000-0000-7000-8000-000000000500",
    scope,
    internalCode: "SKU-1",
    name: "Arroz 500g",
    description: null,
    categoryId: "018f0000-0000-7000-8000-000000000600",
    brandId: null,
    productType: "STANDARD",
    stockControlled: true,
    lotControlled: false,
    expirationControlled: false,
    serialControlled: false,
    taxCategoryId: null,
    baseUnitId: "018f0000-0000-7000-8000-000000000700",
    ...overrides,
  };
}

describe("Product.create", () => {
  it("creates an ACTIVE product with valid input", () => {
    const product = Product.create(validInput());
    expect(product.status).toBe("ACTIVE");
    expect(product.name).toBe("Arroz 500g");
  });

  it("rejects an empty name", () => {
    expect(() => Product.create(validInput({ name: "" }))).toThrow(CatalogDomainError);
    expect(() => Product.create(validInput({ name: "   " }))).toThrow(CatalogDomainError);
  });

  it("rejects expiration control without lot control (UC-CAT-001 validation, matches catalog-schema.md's CHECK)", () => {
    expect(() => Product.create(validInput({ expirationControlled: true, lotControlled: false })))
      .toThrow(CatalogDomainError);
  });

  it("accepts expiration control WITH lot control", () => {
    expect(() => Product.create(validInput({ expirationControlled: true, lotControlled: true }))).not.toThrow();
  });

  it("accepts a SERVICE product with stockControlled=true — 'salvo configuración expresa' is an explicit escape hatch, not a hard invariant", () => {
    expect(() => Product.create(validInput({ productType: "SERVICE", stockControlled: true }))).not.toThrow();
  });

  it("emits ProductCreated referencing the product and its company", () => {
    const product = Product.create(validInput());
    const event = ProductCreated.from(product, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductCreated", productId: product.id, companyId: scope.companyId });
  });
});

describe("roleMayCreateProduct (permission-matrix.md, 'Crear producto')", () => {
  it.each(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "INVENTORY_OPERATOR"] as const)(
    "allows %s (unconditional 'Sí')",
    (role) => { expect(roleMayCreateProduct(role)).toBe(true); },
  );

  it.each(["SUPERVISOR", "CASHIER", "COURIER", "CUSTOMER"] as const)(
    "fails closed for %s (Condicional/No, or absent from the row)",
    (role) => { expect(roleMayCreateProduct(role)).toBe(false); },
  );
});

describe("UserRoleAssignment.coversCompany", () => {
  it("a branch-scoped assignment covers company-wide catalog actions in the SAME company", () => {
    const membership = TenantMembership.active("018f0000-0000-7000-8000-000000000040", scope.tenantId, "MEMBER");
    const assignment = UserRoleAssignment.within(
      membership, "BRANCH_MANAGER",
      new TenantScope(scope.tenantId, scope.companyId, "018f0000-0000-7000-8000-000000000012"),
    );
    expect(assignment.coversCompany(scope)).toBe(true);
  });

  it("does NOT cover a different company in the same tenant (privilege escalation guard)", () => {
    const membership = TenantMembership.active("018f0000-0000-7000-8000-000000000040", scope.tenantId, "MEMBER");
    const assignment = UserRoleAssignment.within(
      membership, "BRANCH_MANAGER",
      new TenantScope(scope.tenantId, scope.companyId, "018f0000-0000-7000-8000-000000000012"),
    );
    expect(assignment.coversCompany(otherCompanyScope)).toBe(false);
  });
});
