import { describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RoleBasedPaymentAuthorization } from "../src/index.js";
import { InMemoryUserRoleAssignmentRepository } from "./fakes.js";

const tenantA = "018f0000-0000-7000-8000-000000000010";
const companyId = "018f0000-0000-7000-8000-000000000011";
const branchId = "018f0000-0000-7000-8000-000000000012";
const tenantB = "018f0000-0000-7000-8000-0000000000ff";
const userId = "018f0000-0000-7000-8000-000000000040";

const scopeA = new TenantScope(tenantA, companyId, branchId);
const scopeB = new TenantScope(tenantB, companyId, branchId);

describe("RoleBasedPaymentAuthorization.canInitiatePayment — fails closed unconditionally (no permission-matrix.md row for payments.transfer.report)", () => {
  const roles = ["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER"] as const;

  it.each(roles)("denies %s even with a covering assignment", async (role) => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, role, scopeA);
    const authorization = new RoleBasedPaymentAuthorization(repository);

    expect(await authorization.canInitiatePayment(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("denies a user with no assignment at all", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    const authorization = new RoleBasedPaymentAuthorization(repository);

    expect(await authorization.canInitiatePayment(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("AUTHENTICATION CONFUSION: a device actor is never authorized, even with a matching role assignment on record for the same id", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedPaymentAuthorization(repository);

    expect(await authorization.canInitiatePayment(Actor.device(userId), scopeA)).toBe(false);
  });

  it("TENANT ESCAPE: an assignment valid in tenant A does not authorize an operation in tenant B", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedPaymentAuthorization(repository);

    expect(await authorization.canInitiatePayment(Actor.forUser(userId), scopeB)).toBe(false);
  });
});
