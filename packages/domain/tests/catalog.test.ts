import { describe, expect, it } from "vitest";
import {
  CatalogDomainError,
  CompanyScope,
  Product,
  ProductCreated,
  ProductDeactivated,
  ProductUpdated,
  TenantMembership,
  TenantScope,
  UserRoleAssignment,
  roleMayAssignIdentifier,
  roleMayCreatePresentation,
  roleMayCreateProduct,
  roleMayCreateVariant,
  roleMayDeactivateProduct,
  roleMayDefineConversion,
  roleMayUpdateProduct,
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
    variantPolicy: "NO_VARIANTS",
    ...overrides,
  };
}

describe("Product.create", () => {
  it("creates an ACTIVE product at version 1 with valid input", () => {
    const product = Product.create(validInput());
    expect(product.status).toBe("ACTIVE");
    expect(product.version).toBe(1);
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

  it.each(["NO_VARIANTS", "OPTIONAL_VARIANTS", "REQUIRED_VARIANTS"] as const)(
    "accepts the closed variantPolicy value %s (DEC-004)",
    (variantPolicy) => {
      const product = Product.create(validInput({ variantPolicy }));
      expect(product.variantPolicy).toBe(variantPolicy);
    },
  );

  it("emits ProductCreated referencing the product and its company", () => {
    const product = Product.create(validInput());
    const event = ProductCreated.from(product, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductCreated", productId: product.id, companyId: scope.companyId });
  });
});

describe("Product.update", () => {
  it("applies editable fields and increments version", () => {
    const product = Product.create(validInput());
    const updated = product.update({ name: "Arroz Roa 500g", description: "actualizado", categoryId: product.categoryId, brandId: null }, 1);
    expect(updated.name).toBe("Arroz Roa 500g");
    expect(updated.version).toBe(2);
    expect(updated.id).toBe(product.id);
  });

  it("rejects a stale expectedVersion with PRODUCT_VERSION_CONFLICT", () => {
    const product = Product.create(validInput());
    expect(() => product.update({ name: "x", description: null, categoryId: product.categoryId, brandId: null }, 99))
      .toThrow(CatalogDomainError);
    try {
      product.update({ name: "x", description: null, categoryId: product.categoryId, brandId: null }, 99);
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogDomainError);
      expect((error as CatalogDomainError).code).toBe("PRODUCT_VERSION_CONFLICT");
    }
  });

  it("rejects an empty name on update, same rule as create", () => {
    const product = Product.create(validInput());
    expect(() => product.update({ name: "   ", description: null, categoryId: product.categoryId, brandId: null }, 1))
      .toThrow(CatalogDomainError);
  });

  it("emits ProductUpdated with before/after values", () => {
    const product = Product.create(validInput());
    const updated = product.update({ name: "new name", description: null, categoryId: product.categoryId, brandId: null }, 1);
    const event = ProductUpdated.from(product, updated, new Date("2026-09-02T10:00:00Z"));
    expect(event.before.name).toBe("Arroz 500g");
    expect(event.after.name).toBe("new name");
  });
});

describe("Product.deactivate", () => {
  it("transitions ACTIVE -> INACTIVE and increments version", () => {
    const product = Product.create(validInput());
    const deactivated = product.deactivate(1);
    expect(deactivated.status).toBe("INACTIVE");
    expect(deactivated.version).toBe(2);
  });

  it("rejects a stale expectedVersion with PRODUCT_VERSION_CONFLICT", () => {
    const product = Product.create(validInput());
    expect(() => product.deactivate(99)).toThrow(CatalogDomainError);
  });

  it("rejects deactivating an already-INACTIVE product with PRODUCT_ALREADY_INACTIVE (CashShift.close() precedent, not an invented rule)", () => {
    const product = Product.create(validInput());
    const deactivated = product.deactivate(1);
    try {
      deactivated.deactivate(2);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogDomainError);
      expect((error as CatalogDomainError).code).toBe("PRODUCT_ALREADY_INACTIVE");
    }
  });

  it("emits ProductDeactivated", () => {
    const product = Product.create(validInput());
    const deactivated = product.deactivate(1);
    const event = ProductDeactivated.from(deactivated, new Date("2026-09-02T10:00:00Z"));
    expect(event).toMatchObject({ type: "ProductDeactivated", productId: product.id, companyId: scope.companyId });
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

describe("roleMayUpdateProduct (permission-matrix.md, 'Editar producto')", () => {
  it.each(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER"] as const)("allows %s (unconditional 'Sí')", (role) => {
    expect(roleMayUpdateProduct(role)).toBe(true);
  });
  it.each(["SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const)("fails closed for %s (Condicional/No)", (role) => {
    expect(roleMayUpdateProduct(role)).toBe(false);
  });
});

describe("roleMayDeactivateProduct (permission-matrix.md, 'Desactivar producto')", () => {
  it.each(["OWNER", "GENERAL_ADMIN"] as const)("allows %s (unconditional 'Sí')", (role) => {
    expect(roleMayDeactivateProduct(role)).toBe(true);
  });
  it.each(["BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const)("fails closed for %s (Condicional/No)", (role) => {
    expect(roleMayDeactivateProduct(role)).toBe(false);
  });
});

describe("B26 HD-01/HD-02/HD-03 and the B27 conversion-definition finding fail closed unconditionally", () => {
  const allRoles = ["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const;

  it.each(allRoles)("roleMayCreateVariant denies %s — no permission-matrix.md row exists", (role) => {
    expect(roleMayCreateVariant(role)).toBe(false);
  });
  it.each(allRoles)("roleMayCreatePresentation denies %s — no permission-matrix.md row exists", (role) => {
    expect(roleMayCreatePresentation(role)).toBe(false);
  });
  it.each(allRoles)("roleMayAssignIdentifier denies %s — no permission-matrix.md row exists", (role) => {
    expect(roleMayAssignIdentifier(role)).toBe(false);
  });
  it.each(allRoles)("roleMayDefineConversion denies %s — no permission-matrix.md row exists", (role) => {
    expect(roleMayDefineConversion(role)).toBe(false);
  });
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
