import { describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RoleBasedCashAuthorization } from "../src/index.js";
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

describe("RoleBasedCashAuthorization.canOpenShift", () => {
  it("allows an authenticated user with an operational role covering the exact scope", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CASHIER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeA)).toBe(true);
  });

  it("denies a user with no assignment at all (missing authorization)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("denies a role that is not in the 'Abrir caja propia' matrix row (e.g. CUSTOMER)", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CUSTOMER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeA)).toBe(false);
  });

  it("TENANT ESCAPE: an assignment valid in tenant A does not authorize an operation in tenant B", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeB)).toBe(false);
  });

  it("PRIVILEGE ESCALATION: an assignment scoped to one branch does not authorize a different branch in the same tenant", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CASHIER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeAOtherBranch)).toBe(false);
  });

  it("AUTHENTICATION CONFUSION: a device actor is never authorized, even with a matching role assignment on record for the same id", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    // Actor.device(userId) reuses the same raw id on purpose — proves the
    // check is actor.type, not "does some assignment exist for this id".
    expect(await authorization.canOpenShift(Actor.device(userId), scopeA)).toBe(false);
  });

  it("MULTIPLE ASSIGNMENTS: authorized if ANY covering assignment has an allowed role, even if others do not", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CUSTOMER", scopeA);
    repository.grant(userId, "SUPERVISOR", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canOpenShift(Actor.forUser(userId), scopeA)).toBe(true);
  });
});

describe("RoleBasedCashAuthorization.canRegisterMovement", () => {
  it("allows OWNER to withdraw (unconditional 'Sí')", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canRegisterMovement(Actor.forUser(userId), "CASH_WITHDRAWAL", scopeA)).toBe(true);
  });

  it("fails closed for CASHIER withdrawal — matrix says 'dentro de límite', no limit policy exists", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "CASHIER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canRegisterMovement(Actor.forUser(userId), "CASH_WITHDRAWAL", scopeA)).toBe(false);
  });

  it("fails closed for any movement type other than CASH_WITHDRAWAL, even for OWNER — no rule is encoded for the other 15 types", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canRegisterMovement(Actor.forUser(userId), "CASH_DEPOSIT", scopeA)).toBe(false);
  });

  it("still enforces tenant escape and authentication confusion for movements, not just for opening", async () => {
    const repository = new InMemoryUserRoleAssignmentRepository();
    repository.grant(userId, "OWNER", scopeA);
    const authorization = new RoleBasedCashAuthorization(repository);

    expect(await authorization.canRegisterMovement(Actor.forUser(userId), "CASH_WITHDRAWAL", scopeB)).toBe(false);
    expect(await authorization.canRegisterMovement(Actor.device(userId), "CASH_WITHDRAWAL", scopeA)).toBe(false);
  });
});
