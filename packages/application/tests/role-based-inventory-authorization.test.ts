import { describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RoleBasedInventoryAuthorization } from "../src/index.js";
import { InMemoryUserRoleAssignmentRepository } from "./fakes.js";

const tenantA = "018f0000-0000-7000-8000-000000000010";
const companyId = "018f0000-0000-7000-8000-000000000011";
const branchId = "018f0000-0000-7000-8000-000000000012";
const otherBranch = "018f0000-0000-7000-8000-0000000000ee";
const tenantB = "018f0000-0000-7000-8000-0000000000ff";
const userId = "018f0000-0000-7000-8000-000000000040";
const scopeA = new TenantScope(tenantA, companyId, branchId);
const scopeAOtherBranch = new TenantScope(tenantA, companyId, otherBranch);
const scopeB = new TenantScope(tenantB, companyId, branchId);

describe("RoleBasedInventoryAuthorization.canAdjustInventory", () => {
  it("allows an authenticated user with an operational role covering the exact scope", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeA)).toBe(true);
  });

  it("denies a user with no assignment at all (missing authorization)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("fails closed for BRANCH_MANAGER — matrix says 'Condicional', no policy value resolves the condition", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "BRANCH_MANAGER", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("fails closed for SUPERVISOR — matrix says 'Autorizar' (approval authority in a separate, unimplemented workflow), not direct execution", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "SUPERVISOR", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("TENANT ESCAPE: an assignment valid in tenant A does not authorize an operation in tenant B", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeB)).toBe(false);
  });

  it("PRIVILEGE ESCALATION: an assignment scoped to one branch does not authorize a different branch in the same tenant", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeAOtherBranch)).toBe(false);
  });

  it("AUTHENTICATION CONFUSION: a device actor is never authorized, even with a matching role assignment on record for the same id", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.device(userId), scopeA)).toBe(false);
  });

  it("MULTIPLE ASSIGNMENTS: authorized if ANY covering assignment has an allowed role, even if others do not", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "INVENTORY_OPERATOR", scopeA);
    repository.grant(userId, "GENERAL_ADMIN", scopeA);
    const authorization = new RoleBasedInventoryAuthorization(repository);

    expect(await authorization.canAdjustInventory(Actor.forUser(userId), scopeA)).toBe(true);
  });
});
