import { describe, expect, it } from "vitest";
import { AuthorizationSnapshotClaimsSchema } from "@pos-platform/contracts";
import {
  AuthorizationModelError,
  createActor,
  createOperationScope,
  evaluatePermission,
} from "@pos-platform/domain";
import { toRoleAssignments } from "../src/index.js";

const USER = "018f0000-0000-7000-8000-0000000000a1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";

const PERMISSION = "CASH_SHIFT_OPEN";
const NOW = new Date("2026-09-03T12:00:00Z");

function assignment(overrides: Record<string, unknown> = {}): unknown {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    status: "ACTIVE",
    valid_from: "2026-09-01T00:00:00Z",
    valid_until: null,
    role_status: "ACTIVE",
    permissions: [{ code: PERMISSION, status: "ACTIVE" }],
    ...overrides,
  };
}

function claims(assignments: unknown[] = [assignment()]) {
  return AuthorizationSnapshotClaimsSchema.parse({
    snapshot_id: "018f0000-0000-7000-8000-0000000000a0",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-03T00:00:00Z",
    expires_at: "2026-09-04T00:00:00Z",
    assignments,
    key_id: "AUTHZ_KEY_1",
  });
}

function decide(assignments: unknown[], overrides: Record<string, unknown> = {}) {
  return evaluatePermission({
    actor: createActor("USER", USER),
    permission: PERMISSION,
    scope: createOperationScope(TENANT, COMPANY, BRANCH),
    at: NOW,
    assignments: toRoleAssignments(claims(assignments)),
    ...overrides,
  });
}

describe("toRoleAssignments", () => {
  it("rebuilds every assignment carried by the snapshot", () => {
    const projected = toRoleAssignments(claims([assignment(), assignment({ branch_id: null })]));
    expect(projected).toHaveLength(2);
  });

  it("maps scope, statuses and permissions onto the domain shape", () => {
    const [projected] = toRoleAssignments(claims());
    expect(projected?.scope).toEqual({ tenantId: TENANT, companyId: COMPANY, branchId: BRANCH });
    expect(projected?.status).toBe("ACTIVE");
    expect(projected?.roleStatus).toBe("ACTIVE");
    expect(projected?.permissions).toEqual([{ code: PERMISSION, status: "ACTIVE" }]);
  });

  it("converts timestamps into instants the domain can compare", () => {
    const [projected] = toRoleAssignments(claims());
    expect(projected?.validFrom).toBeInstanceOf(Date);
    expect(projected?.validFrom.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(projected?.validUntil).toBeNull();
  });

  it("preserves a bounded validity window", () => {
    const [projected] = toRoleAssignments(
      claims([assignment({ valid_until: "2026-12-01T00:00:00Z" })]),
    );
    expect(projected?.validUntil?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("projects an empty snapshot to no assignments at all", () => {
    expect(toRoleAssignments(claims([]))).toEqual([]);
  });

  it("validates domain invariants instead of trusting the issuer", () => {
    // El contrato admite el rango porque el emisor lo declaró; la factory del
    // dominio es la que rechaza una vigencia imposible.
    const impossible = claims([assignment()]);
    const tampered = {
      ...impossible,
      assignments: [{
        ...impossible.assignments[0]!,
        valid_from: "2026-12-01T00:00:00Z",
        valid_until: "2026-01-01T00:00:00Z",
      }],
    };
    expect(() => toRoleAssignments(tampered)).toThrow(AuthorizationModelError);
  });
});

describe("toRoleAssignments — decisión con evaluatePermission", () => {
  it("grants a permission carried by an active assignment", () => {
    expect(decide([assignment()])).toEqual({ allowed: true });
  });

  it("does not grant a permission the snapshot never carried", () => {
    const result = decide([assignment()], { permission: "CASH_SHIFT_CLOSE" });
    expect(result.allowed).toBe(false);
  });

  it("grants nothing when the snapshot carries no assignments", () => {
    expect(decide([]).allowed).toBe(false);
  });

  it("does not grant a revoked assignment", () => {
    expect(decide([assignment({ status: "REVOKED" })]).allowed).toBe(false);
  });

  it("does not grant through a retired role", () => {
    expect(decide([assignment({ role_status: "RETIRED" })]).allowed).toBe(false);
  });

  it("does not grant a retired permission", () => {
    const retired = assignment({ permissions: [{ code: PERMISSION, status: "RETIRED" }] });
    expect(decide([retired]).allowed).toBe(false);
  });

  it("never lets a DEVICE actor gain a business permission from a snapshot", () => {
    const result = decide([assignment()], { actor: createActor("DEVICE", DEVICE) });
    expect(result).toEqual({ allowed: false, reason: "ACTOR_TYPE_CANNOT_HOLD_PERMISSIONS" });
  });

  it("never lets a SYSTEM actor gain a business permission from a snapshot", () => {
    const result = decide([assignment()], { actor: createActor("SYSTEM", null) });
    expect(result.allowed).toBe(false);
  });

  it("does not cross tenants", () => {
    const other = "018f0000-0000-7000-8000-0000000000bb";
    const result = decide([assignment()], { scope: createOperationScope(other, COMPANY, BRANCH) });
    expect(result.allowed).toBe(false);
  });

  it("does not grant outside the assignment validity window", () => {
    const expired = assignment({ valid_until: "2026-09-02T00:00:00Z" });
    expect(decide([expired]).allowed).toBe(false);
  });
});
