import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, TenantScope } from "@pos-platform/domain";
import { RoleBasedCatalogAuthorization } from "../src/index.js";
import { InMemoryUserRoleAssignmentRepository } from "./fakes.js";

const tenantA = "018f0000-0000-7000-8000-000000000010";
const companyId = "018f0000-0000-7000-8000-000000000011";
const otherCompanyId = "018f0000-0000-7000-8000-0000000000cc";
const branchId = "018f0000-0000-7000-8000-000000000012";
const otherBranch = "018f0000-0000-7000-8000-0000000000ee";
const tenantB = "018f0000-0000-7000-8000-0000000000ff";
const userId = "018f0000-0000-7000-8000-000000000040";

// UserRoleAssignment.within() always assigns at a TenantScope (branch-grained) —
// there is no branch-less assignment shape in the domain model. What makes
// Catalog different from Cash is that canCreateProduct checks coverage at the
// coarser CompanyScope (coversCompany), not the exact TenantScope.
const scopeA = new TenantScope(tenantA, companyId, branchId);
const scopeAOtherBranch = new TenantScope(tenantA, companyId, otherBranch);

const companyScopeA = new CompanyScope(tenantA, companyId);
const companyScopeOtherCompany = new CompanyScope(tenantA, otherCompanyId);
const companyScopeB = new CompanyScope(tenantB, companyId);

describe("RoleBasedCatalogAuthorization.canCreateProduct", () => {
  it("allows an authenticated user with a role covering the exact company scope", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(true);
  });

  it("denies a user with no assignment at all (missing authorization)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it("denies a role that is not in the 'Crear producto' matrix row (CASHIER = No)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CASHIER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it("fails closed for SUPERVISOR — matrix says 'Condicional', no policy value exists to resolve the condition", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "SUPERVISOR", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it("TENANT ESCAPE: an assignment valid in tenant A does not authorize an operation in tenant B", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeB)).toBe(false);
  });

  it("COMPANY ISOLATION: an assignment scoped to one company does not authorize a different company in the same tenant", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeOtherCompany)).toBe(false);
  });

  it("COMPANY-WIDE COVERAGE: an assignment scoped to one branch authorizes catalog actions company-wide (Catalog is not branch-scoped, unlike Cash)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeAOtherBranch);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(true);
  });

  it("AUTHENTICATION CONFUSION: a device actor is never authorized, even with a matching role assignment on record for the same id", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    // Actor.device(userId) reuses the same raw id on purpose — proves the
    // check is actor.type, not "does some assignment exist for this id".
    expect(await authorization.canCreateProduct(Actor.device(userId), companyScopeA)).toBe(false);
  });

  it("MULTIPLE ASSIGNMENTS: authorized if ANY covering assignment has an allowed role, even if others do not", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CASHIER", scopeA);
    repository.grant(userId, "INVENTORY_OPERATOR", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);

    expect(await authorization.canCreateProduct(Actor.forUser(userId), companyScopeA)).toBe(true);
  });
});

describe("RoleBasedCatalogAuthorization.canUpdateProduct ('Editar producto')", () => {
  it("allows OWNER", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canUpdateProduct(Actor.forUser(userId), companyScopeA)).toBe(true);
  });

  it("fails closed for INVENTORY_OPERATOR — 'Editar producto' marks it Condicional, unlike 'Crear producto' which marks it Sí", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "INVENTORY_OPERATOR", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canUpdateProduct(Actor.forUser(userId), companyScopeA)).toBe(false);
  });
});

describe("RoleBasedCatalogAuthorization.canDeactivateProduct ('Desactivar producto')", () => {
  it("allows GENERAL_ADMIN", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "GENERAL_ADMIN", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canDeactivateProduct(Actor.forUser(userId), companyScopeA)).toBe(true);
  });

  it("fails closed for BRANCH_MANAGER — 'Desactivar producto' marks it Condicional, unlike 'Crear/Editar producto' which mark it Sí", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "BRANCH_MANAGER", scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canDeactivateProduct(Actor.forUser(userId), companyScopeA)).toBe(false);
  });
});

describe("RoleBasedCatalogAuthorization fails closed unconditionally for B26 HD-01/02/03 + the B27 conversion-definition finding", () => {
  const roles = ["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const;

  it.each(roles)("canCreateVariant denies %s even though no permission-matrix.md row exists to check against", async (role) => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, role, scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canCreateVariant(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it.each(roles)("canCreatePresentation denies %s", async (role) => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, role, scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canCreatePresentation(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it.each(roles)("canAssignIdentifier denies %s", async (role) => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, role, scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canAssignIdentifier(Actor.forUser(userId), companyScopeA)).toBe(false);
  });

  it.each(roles)("canDefineConversion denies %s", async (role) => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, role, scopeA);
    const authorization = new RoleBasedCatalogAuthorization(repository);
    expect(await authorization.canDefineConversion(Actor.forUser(userId), companyScopeA)).toBe(false);
  });
});
