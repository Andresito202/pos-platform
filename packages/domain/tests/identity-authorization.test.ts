import { describe, expect, it } from "vitest";
import {
  IdentityDomainError,
  TenantMembership,
  TenantScope,
  User,
  UserRoleAssignment,
  roleMayOpenCashShift,
  roleMayRegisterCashWithdrawal,
} from "../src/index.js";

const tenantId = "018f0000-0000-7000-8000-000000000010";
const companyId = "018f0000-0000-7000-8000-000000000011";
const branchId = "018f0000-0000-7000-8000-000000000012";
const otherTenantId = "018f0000-0000-7000-8000-0000000000ff";
const otherBranchId = "018f0000-0000-7000-8000-0000000000ee";
const userId = "018f0000-0000-7000-8000-000000000040";

describe("User", () => {
  it("is active on creation and carries no credential/session field", () => {
    const user = User.active(userId);
    expect(user.isActive()).toBe(true);
    expect(Object.keys(user)).not.toContain("password");
  });
});

describe("TenantMembership", () => {
  it("relates a user to a tenant, active by default", () => {
    const membership = TenantMembership.active(userId, tenantId, "MEMBER");
    expect(membership.isActive()).toBe(true);
    expect(membership.tenantId).toBe(tenantId);
  });
});

describe("UserRoleAssignment.within", () => {
  it("builds successfully when the assignment scope's tenant matches the membership's tenant", () => {
    const membership = TenantMembership.active(userId, tenantId, "MEMBER");
    const scope = new TenantScope(tenantId, companyId, branchId);
    expect(() => UserRoleAssignment.within(membership, "CASHIER", scope)).not.toThrow();
  });

  it("REJECTS AT CONSTRUCTION an assignment scoped to a different tenant than the membership — tenant escape is structurally impossible, not just runtime-checked", () => {
    const membership = TenantMembership.active(userId, tenantId, "MEMBER");
    const foreignScope = new TenantScope(otherTenantId, companyId, branchId);
    expect(() => UserRoleAssignment.within(membership, "CASHIER", foreignScope)).toThrow(IdentityDomainError);
  });

  it("coversScope requires an exact tenant+company+branch match — a branch-scoped assignment does not cover a different branch (privilege escalation guard)", () => {
    const membership = TenantMembership.active(userId, tenantId, "MEMBER");
    const assignment = UserRoleAssignment.within(membership, "CASHIER", new TenantScope(tenantId, companyId, branchId));

    expect(assignment.coversScope(new TenantScope(tenantId, companyId, branchId))).toBe(true);
    expect(assignment.coversScope(new TenantScope(tenantId, companyId, otherBranchId))).toBe(false);
  });
});

describe("roleMayOpenCashShift (permission-matrix.md, 'Abrir caja propia')", () => {
  it.each(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "CASHIER"] as const)(
    "allows %s (unconditional 'Sí' in the matrix)",
    (role) => { expect(roleMayOpenCashShift(role)).toBe(true); },
  );

  it.each(["CUSTOMER", "COURIER", "INVENTORY_OPERATOR", "PURCHASING_OPERATOR", "PLATFORM_OWNER"] as const)(
    "does not allow %s (not in the matrix row at all)",
    (role) => { expect(roleMayOpenCashShift(role)).toBe(false); },
  );
});

describe("roleMayRegisterCashWithdrawal (permission-matrix.md, 'Registrar egreso de caja')", () => {
  it.each(["OWNER", "GENERAL_ADMIN"] as const)(
    "allows %s (unconditional 'Sí')",
    (role) => { expect(roleMayRegisterCashWithdrawal(role)).toBe(true); },
  );

  it.each(["BRANCH_MANAGER", "SUPERVISOR", "CASHIER"] as const)(
    "fails CLOSED for %s — the matrix says Condicional/Autorizar/'dentro de límite', and no policy value exists to resolve that condition",
    (role) => { expect(roleMayRegisterCashWithdrawal(role)).toBe(false); },
  );
});
