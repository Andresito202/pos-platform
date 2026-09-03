import { describe, expect, it } from "vitest";
import {
  AuthorizationSnapshotClaimsSchema,
  GrantedPermissionSchema,
  SignedAuthorizationSnapshotSchema,
  SnapshotAssignmentSchema,
  type AuthorizationSnapshotClaims,
  type SnapshotAssignment,
} from "../src/index.js";

const SNAPSHOT = "018f0000-0000-7000-8000-0000000000a0";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";

function assignment(overrides: Record<string, unknown> = {}): unknown {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    status: "ACTIVE",
    valid_from: "2026-09-01T00:00:00Z",
    valid_until: null,
    role_status: "ACTIVE",
    permissions: [{ code: "CASH_SHIFT_OPEN", status: "ACTIVE" }],
    ...overrides,
  };
}

function claims(overrides: Record<string, unknown> = {}): unknown {
  return {
    snapshot_id: SNAPSHOT,
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-03T00:00:00Z",
    expires_at: "2026-09-04T00:00:00Z",
    assignments: [assignment()],
    key_id: "AUTHZ_KEY_1",
    ...overrides,
  };
}

const SIGNATURE = "a".repeat(86);

describe("SnapshotAssignmentSchema", () => {
  it("accepts a fully scoped active assignment", () => {
    const parsed = SnapshotAssignmentSchema.parse(assignment()) as SnapshotAssignment;
    expect(parsed.branch_id).toBe(BRANCH);
  });

  it("accepts a tenant-wide assignment", () => {
    const parsed = SnapshotAssignmentSchema.parse(
      assignment({ company_id: null, branch_id: null }),
    ) as SnapshotAssignment;
    expect(parsed.company_id).toBeNull();
  });

  it("rejects a branch without a company", () => {
    expect(() => SnapshotAssignmentSchema.parse(assignment({ company_id: null }))).toThrow();
  });

  it("rejects a validity range that ends before it starts", () => {
    expect(() =>
      SnapshotAssignmentSchema.parse(assignment({ valid_until: "2026-08-01T00:00:00Z" })),
    ).toThrow();
  });

  it("rejects an empty validity range", () => {
    expect(() =>
      SnapshotAssignmentSchema.parse(assignment({ valid_until: "2026-09-01T00:00:00Z" })),
    ).toThrow();
  });

  it("rejects duplicated permission codes", () => {
    expect(() =>
      SnapshotAssignmentSchema.parse(
        assignment({
          permissions: [
            { code: "CASH_SHIFT_OPEN", status: "ACTIVE" },
            { code: "CASH_SHIFT_OPEN", status: "RETIRED" },
          ],
        }),
      ),
    ).toThrow();
  });

  it("carries a revoked assignment instead of dropping it", () => {
    const parsed = SnapshotAssignmentSchema.parse(assignment({ status: "REVOKED" })) as SnapshotAssignment;
    expect(parsed.status).toBe("REVOKED");
  });

  it("carries a retired role status", () => {
    const parsed = SnapshotAssignmentSchema.parse(assignment({ role_status: "RETIRED" })) as SnapshotAssignment;
    expect(parsed.role_status).toBe("RETIRED");
  });

  it("rejects an unmodelled assignment status", () => {
    expect(() => SnapshotAssignmentSchema.parse(assignment({ status: "PENDING" }))).toThrow();
  });

  it("rejects an unmodelled role status", () => {
    expect(() => SnapshotAssignmentSchema.parse(assignment({ role_status: "DRAFT" }))).toThrow();
  });

  it("rejects unexpected fields", () => {
    expect(() => SnapshotAssignmentSchema.parse(assignment({ cash_register_id: BRANCH }))).toThrow();
  });

  it("rejects a non-uuid tenant", () => {
    expect(() => SnapshotAssignmentSchema.parse(assignment({ tenant_id: "tenant-1" }))).toThrow();
  });
});

describe("GrantedPermissionSchema", () => {
  it("accepts an active stable code", () => {
    expect(GrantedPermissionSchema.parse({ code: "CASH_SHIFT_OPEN", status: "ACTIVE" }).code)
      .toBe("CASH_SHIFT_OPEN");
  });

  it("rejects a lowercase permission code", () => {
    expect(() => GrantedPermissionSchema.parse({ code: "cash_shift_open", status: "ACTIVE" }))
      .toThrow();
  });

  it("rejects an unmodelled permission status", () => {
    expect(() => GrantedPermissionSchema.parse({ code: "CASH_SHIFT_OPEN", status: "MAYBE" }))
      .toThrow();
  });
});

describe("AuthorizationSnapshotClaimsSchema", () => {
  it("accepts a well formed snapshot", () => {
    const parsed = AuthorizationSnapshotClaimsSchema.parse(claims()) as AuthorizationSnapshotClaims;
    expect(parsed.sequence).toBe(1);
  });

  it("accepts a snapshot carrying no assignments", () => {
    const parsed = AuthorizationSnapshotClaimsSchema.parse(
      claims({ assignments: [] }),
    ) as AuthorizationSnapshotClaims;
    expect(parsed.assignments).toHaveLength(0);
  });

  it("rejects expires_at before issued_at", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(
      claims({ expires_at: "2026-09-02T00:00:00Z" }),
    )).toThrow();
  });

  it("rejects expires_at equal to issued_at", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(
      claims({ expires_at: "2026-09-03T00:00:00Z" }),
    )).toThrow();
  });

  it("rejects a null expires_at, unlike a license", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(claims({ expires_at: null }))).toThrow();
  });

  it("rejects a non-utc timestamp", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(
      claims({ issued_at: "2026-09-03T00:00:00-05:00" }),
    )).toThrow();
  });

  it("rejects a zero sequence", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(claims({ sequence: 0 }))).toThrow();
  });

  it("rejects a negative sequence", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(claims({ sequence: -1 }))).toThrow();
  });

  it("rejects a fractional sequence", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(claims({ sequence: 1.5 }))).toThrow();
  });

  it("rejects repeating the same scope twice", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(
      claims({ assignments: [assignment(), assignment()] }),
    )).toThrow();
  });

  it("accepts two assignments on distinct scopes", () => {
    const parsed = AuthorizationSnapshotClaimsSchema.parse(
      claims({ assignments: [assignment(), assignment({ branch_id: null })] }),
    ) as AuthorizationSnapshotClaims;
    expect(parsed.assignments).toHaveLength(2);
  });

  it("rejects unexpected fields", () => {
    expect(() => AuthorizationSnapshotClaimsSchema.parse(claims({ tenant_id: TENANT }))).toThrow();
  });

  it("rejects a payload missing the binding", () => {
    const incomplete = claims() as Record<string, unknown>;
    delete incomplete["device_id"];
    expect(() => AuthorizationSnapshotClaimsSchema.parse(incomplete)).toThrow();
  });

  it("rejects a payload missing the key id", () => {
    const incomplete = claims() as Record<string, unknown>;
    delete incomplete["key_id"];
    expect(() => AuthorizationSnapshotClaimsSchema.parse(incomplete)).toThrow();
  });
});

describe("SignedAuthorizationSnapshotSchema", () => {
  it("accepts a base64url signature of the expected length", () => {
    const parsed = SignedAuthorizationSnapshotSchema.parse({
      claims: claims(),
      signature: SIGNATURE,
    });
    expect(parsed.signature).toBe(SIGNATURE);
  });

  it("rejects a signature with non base64url characters", () => {
    expect(() => SignedAuthorizationSnapshotSchema.parse({
      claims: claims(),
      signature: `${"a".repeat(85)}+`,
    })).toThrow();
  });

  it("rejects an absent signature", () => {
    expect(() => SignedAuthorizationSnapshotSchema.parse({ claims: claims() })).toThrow();
  });

  it("rejects a truncated signature", () => {
    expect(() => SignedAuthorizationSnapshotSchema.parse({
      claims: claims(),
      signature: "a".repeat(10),
    })).toThrow();
  });

  it("rejects unexpected fields in the envelope", () => {
    expect(() => SignedAuthorizationSnapshotSchema.parse({
      claims: claims(),
      signature: SIGNATURE,
      algorithm: "ED25519",
    })).toThrow();
  });
});
