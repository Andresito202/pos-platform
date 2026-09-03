import { describe, expect, it } from "vitest";
import {
  ActorSchema,
  ActorTypeSchema,
  AuthorizationScopeSchema,
  PermissionCodeSchema,
} from "../src/index.js";

const TENANT = "11111111-1111-7111-8111-111111111111";
const COMPANY = "33333333-3333-7333-8333-333333333333";
const BRANCH = "55555555-5555-7555-8555-555555555555";
const USER = "77777777-7777-7777-8777-777777777777";

describe("ActorTypeSchema", () => {
  it("accepts the four modelled actor types", () => {
    for (const type of ["USER", "PLATFORM_ACCOUNT", "SYSTEM", "DEVICE"]) {
      expect(ActorTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects an unmodelled actor type", () => {
    expect(() => ActorTypeSchema.parse("ROBOT")).toThrow();
  });
});

describe("ActorSchema", () => {
  it("accepts a user actor carrying an id", () => {
    expect(ActorSchema.parse({ actor_type: "USER", actor_id: USER }).actor_id).toBe(USER);
  });

  it("accepts a SYSTEM actor without id", () => {
    expect(ActorSchema.parse({ actor_type: "SYSTEM", actor_id: null }).actor_id).toBeNull();
  });

  it("rejects a SYSTEM actor carrying an id", () => {
    expect(() => ActorSchema.parse({ actor_type: "SYSTEM", actor_id: USER })).toThrow();
  });

  it("rejects a user actor without id", () => {
    expect(() => ActorSchema.parse({ actor_type: "USER", actor_id: null })).toThrow();
  });

  it("rejects a non-uuid actor id", () => {
    expect(() => ActorSchema.parse({ actor_type: "USER", actor_id: "cajero-1" })).toThrow();
  });

  it("rejects unknown fields at the boundary", () => {
    expect(() => ActorSchema.parse({ actor_type: "USER", actor_id: USER, role: "ADMIN" }))
      .toThrow();
  });
});

describe("AuthorizationScopeSchema", () => {
  it("accepts a fully qualified scope", () => {
    const scope = AuthorizationScopeSchema.parse({
      tenant_id: TENANT,
      company_id: COMPANY,
      branch_id: BRANCH,
    });
    expect(scope.branch_id).toBe(BRANCH);
  });

  it("accepts a tenant-wide scope", () => {
    const scope = AuthorizationScopeSchema.parse({
      tenant_id: TENANT,
      company_id: null,
      branch_id: null,
    });
    expect(scope.company_id).toBeNull();
  });

  it("rejects a branch without a company", () => {
    expect(() =>
      AuthorizationScopeSchema.parse({ tenant_id: TENANT, company_id: null, branch_id: BRANCH }),
    ).toThrow();
  });

  it("rejects a missing tenant", () => {
    expect(() =>
      AuthorizationScopeSchema.parse({ tenant_id: null, company_id: null, branch_id: null }),
    ).toThrow();
  });

  it("rejects a non-uuid tenant", () => {
    expect(() =>
      AuthorizationScopeSchema.parse({ tenant_id: "tenant-1", company_id: null, branch_id: null }),
    ).toThrow();
  });
});

describe("PermissionCodeSchema", () => {
  it("accepts a stable uppercase code", () => {
    expect(PermissionCodeSchema.parse("CASH_SHIFT_OPEN")).toBe("CASH_SHIFT_OPEN");
  });

  it("rejects a lowercase code", () => {
    expect(() => PermissionCodeSchema.parse("cash_shift_open")).toThrow();
  });

  it("rejects a blank code", () => {
    expect(() => PermissionCodeSchema.parse("")).toThrow();
  });
});
