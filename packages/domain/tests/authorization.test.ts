import { describe, expect, it } from "vitest";
import {
  ACTOR_TYPES,
  AuthorizationModelError,
  assignmentCoversOperation,
  canHoldBusinessPermissions,
  createActor,
  createAssignmentScope,
  createOperationScope,
  createRoleAssignment,
  evaluatePermission,
  grantsPermission,
  isTemporallyValid,
  type RoleAssignment,
} from "../src/index.js";

const TENANT = "11111111-1111-7111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-7222-8222-222222222222";
const COMPANY = "33333333-3333-7333-8333-333333333333";
const OTHER_COMPANY = "44444444-4444-7444-8444-444444444444";
const BRANCH = "55555555-5555-7555-8555-555555555555";
const OTHER_BRANCH = "66666666-6666-7666-8666-666666666666";
const USER = "77777777-7777-7777-8777-777777777777";

const PERMISSION = "CASH_SHIFT_OPEN";
const NOW = new Date("2026-09-03T12:00:00Z");

function assignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return createRoleAssignment({
    scope: createAssignmentScope(TENANT, COMPANY, BRANCH),
    status: "ACTIVE",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null,
    roleStatus: "ACTIVE",
    permissions: [{ code: PERMISSION, status: "ACTIVE" }],
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    actor: createActor("USER", USER),
    permission: PERMISSION,
    scope: createOperationScope(TENANT, COMPANY, BRANCH),
    at: NOW,
    assignments: [assignment()],
    ...overrides,
  };
}

describe("createActor", () => {
  it("builds a user actor carrying an id", () => {
    expect(createActor("USER", USER)).toEqual({ type: "USER", id: USER });
  });

  it("allows a SYSTEM actor without id", () => {
    expect(createActor("SYSTEM", null).id).toBeNull();
  });

  it("rejects a SYSTEM actor carrying an id", () => {
    expect(() => createActor("SYSTEM", USER)).toThrow(AuthorizationModelError);
  });

  it("rejects a non-system actor without id", () => {
    expect(() => createActor("USER", null)).toThrow(AuthorizationModelError);
  });

  it("rejects a blank actor id", () => {
    expect(() => createActor("DEVICE", "   ")).toThrow(AuthorizationModelError);
  });
});

describe("canHoldBusinessPermissions", () => {
  it("accepts only USER", () => {
    expect(canHoldBusinessPermissions("USER")).toBe(true);
  });

  it("rejects every other actor type", () => {
    for (const type of ACTOR_TYPES.filter((candidate) => candidate !== "USER")) {
      expect(canHoldBusinessPermissions(type)).toBe(false);
    }
  });
});

describe("scope construction", () => {
  it("rejects a branch without a company", () => {
    expect(() => createOperationScope(TENANT, null, BRANCH)).toThrow(AuthorizationModelError);
  });

  it("rejects an empty tenant", () => {
    expect(() => createOperationScope("", COMPANY, BRANCH)).toThrow(AuthorizationModelError);
  });

  it("accepts a tenant-wide assignment scope", () => {
    expect(createAssignmentScope(TENANT, null, null).companyId).toBeNull();
  });
});

describe("assignmentCoversOperation", () => {
  const operation = createOperationScope(TENANT, COMPANY, BRANCH);

  it("covers when tenant, company and branch match exactly", () => {
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, COMPANY, BRANCH), operation))
      .toBe(true);
  });

  it("covers any company when the assignment company is null", () => {
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, null, null), operation))
      .toBe(true);
  });

  it("covers any branch when the assignment branch is null", () => {
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, COMPANY, null), operation))
      .toBe(true);
  });

  it("never crosses tenants even with a wildcard company", () => {
    expect(assignmentCoversOperation(createAssignmentScope(OTHER_TENANT, null, null), operation))
      .toBe(false);
  });

  it("rejects a different company", () => {
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, OTHER_COMPANY, null), operation))
      .toBe(false);
  });

  it("rejects a different branch", () => {
    expect(
      assignmentCoversOperation(createAssignmentScope(TENANT, COMPANY, OTHER_BRANCH), operation),
    ).toBe(false);
  });

  it("does not let a branch-scoped assignment cover a company-wide operation", () => {
    const companyWide = createOperationScope(TENANT, COMPANY, null);
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, COMPANY, BRANCH), companyWide))
      .toBe(false);
  });

  it("does not let a company-scoped assignment cover a tenant-wide operation", () => {
    const tenantWide = createOperationScope(TENANT, null, null);
    expect(assignmentCoversOperation(createAssignmentScope(TENANT, COMPANY, null), tenantWide))
      .toBe(false);
  });
});

describe("temporal validity", () => {
  const base = assignment({
    validFrom: new Date("2026-09-01T00:00:00Z"),
    validUntil: new Date("2026-09-10T00:00:00Z"),
  });

  it("includes the starting instant", () => {
    expect(isTemporallyValid(base, new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });

  it("excludes the ending instant", () => {
    expect(isTemporallyValid(base, new Date("2026-09-10T00:00:00Z"))).toBe(false);
  });

  it("rejects an instant before the start", () => {
    expect(isTemporallyValid(base, new Date("2026-08-31T23:59:59Z"))).toBe(false);
  });

  it("treats a null end as open ended", () => {
    expect(isTemporallyValid(assignment({ validUntil: null }), new Date("2099-01-01T00:00:00Z")))
      .toBe(true);
  });

  it("rejects building an assignment whose validity ends before it starts", () => {
    expect(() =>
      createRoleAssignment({
        ...assignment(),
        validFrom: new Date("2026-09-10T00:00:00Z"),
        validUntil: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toThrow(AuthorizationModelError);
  });

  it("rejects an empty validity range", () => {
    const instant = new Date("2026-09-01T00:00:00Z");
    expect(() =>
      createRoleAssignment({ ...assignment(), validFrom: instant, validUntil: instant }),
    ).toThrow(AuthorizationModelError);
  });
});

describe("grantsPermission", () => {
  it("grants an active permission", () => {
    expect(grantsPermission(assignment(), PERMISSION)).toBe(true);
  });

  it("does not grant a retired permission", () => {
    const retired = assignment({ permissions: [{ code: PERMISSION, status: "RETIRED" }] });
    expect(grantsPermission(retired, PERMISSION)).toBe(false);
  });

  it("does not grant an unrelated permission", () => {
    expect(grantsPermission(assignment(), "CASH_SHIFT_CLOSE")).toBe(false);
  });

  it("rejects building an assignment with a blank permission code", () => {
    expect(() => createRoleAssignment({ ...assignment(), permissions: [{ code: " ", status: "ACTIVE" }] }))
      .toThrow(AuthorizationModelError);
  });
});

describe("evaluatePermission — happy path", () => {
  it("allows a user holding an active matching assignment", () => {
    expect(evaluatePermission(request())).toEqual({ allowed: true });
  });

  it("allows when one of several assignments matches", () => {
    const assignments = [
      assignment({ status: "REVOKED" }),
      assignment({ scope: createAssignmentScope(OTHER_TENANT, null, null) }),
      assignment(),
    ];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(true);
  });

  it("allows through a tenant-wide assignment", () => {
    const assignments = [assignment({ scope: createAssignmentScope(TENANT, null, null) })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(true);
  });
});

describe("evaluatePermission — actor", () => {
  it("denies a DEVICE actor even when assignments are supplied", () => {
    const result = evaluatePermission(request({ actor: createActor("DEVICE", USER) }));
    expect(result).toEqual({ allowed: false, reason: "ACTOR_TYPE_CANNOT_HOLD_PERMISSIONS" });
  });

  it("denies a SYSTEM actor", () => {
    const result = evaluatePermission(request({ actor: createActor("SYSTEM", null) }));
    expect(result.allowed).toBe(false);
  });

  it("denies a PLATFORM_ACCOUNT actor", () => {
    const result = evaluatePermission(request({ actor: createActor("PLATFORM_ACCOUNT", USER) }));
    expect(result.allowed).toBe(false);
  });

  it("denies a hand-assembled user actor without id", () => {
    const result = evaluatePermission(request({ actor: { type: "USER", id: null } }));
    expect(result).toEqual({ allowed: false, reason: "ACTOR_TYPE_CANNOT_HOLD_PERMISSIONS" });
  });
});

describe("evaluatePermission — fail closed", () => {
  it("denies with no assignments at all", () => {
    const result = evaluatePermission(request({ assignments: [] }));
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_ASSIGNMENT" });
  });

  it("denies a revoked assignment", () => {
    expect(evaluatePermission(request({ assignments: [assignment({ status: "REVOKED" })] })).allowed)
      .toBe(false);
  });

  it("denies a retired role", () => {
    expect(
      evaluatePermission(request({ assignments: [assignment({ roleStatus: "RETIRED" })] })).allowed,
    ).toBe(false);
  });

  it("denies a retired permission", () => {
    const assignments = [assignment({ permissions: [{ code: PERMISSION, status: "RETIRED" }] })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("denies an expired assignment", () => {
    const assignments = [assignment({ validUntil: new Date("2026-09-01T00:00:00Z") })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("denies an assignment that is not yet valid", () => {
    const assignments = [assignment({ validFrom: new Date("2027-01-01T00:00:00Z") })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("denies a different permission", () => {
    expect(evaluatePermission(request({ permission: "CASH_SHIFT_CLOSE" })).allowed).toBe(false);
  });

  it("denies an assignment belonging to another tenant", () => {
    const assignments = [assignment({ scope: createAssignmentScope(OTHER_TENANT, null, null) })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("denies an assignment belonging to another branch", () => {
    const assignments = [assignment({ scope: createAssignmentScope(TENANT, COMPANY, OTHER_BRANCH) })];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("does not reveal why the assignment failed", () => {
    const expired = evaluatePermission(
      request({ assignments: [assignment({ validUntil: new Date("2026-09-01T00:00:00Z") })] }),
    );
    const absent = evaluatePermission(request({ assignments: [] }));
    expect(expired).toEqual(absent);
  });

  it("requires every condition simultaneously, not just one", () => {
    // Cada asignación incumple exactamente una condición distinta.
    const assignments = [
      assignment({ status: "REVOKED" }),
      assignment({ roleStatus: "RETIRED" }),
      assignment({ validFrom: new Date("2027-01-01T00:00:00Z") }),
      assignment({ scope: createAssignmentScope(TENANT, OTHER_COMPANY, null) }),
      assignment({ permissions: [{ code: PERMISSION, status: "RETIRED" }] }),
    ];
    expect(evaluatePermission(request({ assignments })).allowed).toBe(false);
  });

  it("rejects a blank permission code as a caller error, not a denial", () => {
    expect(() => evaluatePermission(request({ permission: "  " }))).toThrow(AuthorizationModelError);
  });
});
