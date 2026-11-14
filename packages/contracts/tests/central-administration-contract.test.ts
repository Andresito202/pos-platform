import { describe, expect, it } from "vitest";
import {
  CENTRAL_ADMINISTRATION_ACTOR_TYPE,
  CENTRAL_ADMINISTRATION_AUTHORITY,
  CentralAdministrationOperation,
} from "../src/central-administration.js";

describe("central administration contract", () => {
  it("keeps all administrative operations central", () => {
    expect(CENTRAL_ADMINISTRATION_ACTOR_TYPE).toBe("PLATFORM_ACCOUNT");
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.tenantAuthority).toBe("CENTRAL");
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.authorizationAuthority).toBe("CENTRAL");
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.licensingAuthority).toBe("CENTRAL");
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.clientMayMutate).toBe(false);
  });

  it("does not invent a standalone Plan authority", () => {
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.planAuthority).toBe("LICENSE_CONTRACT");
    expect(CENTRAL_ADMINISTRATION_AUTHORITY.entitlementAuthority).toBe("LICENSE");
    expect("PLAN_CREATE" in CentralAdministrationOperation).toBe(false);
    expect("PLAN_UPDATE" in CentralAdministrationOperation).toBe(false);
  });

  it("contains only lifecycle actions backed by the existing administrative contract", () => {
    expect(Object.values(CentralAdministrationOperation)).toEqual([
      "TENANT_INITIALIZE",
      "USER_MANAGE",
      "ROLE_MANAGE",
      "ROLE_PERMISSION_GRANT_MANAGE",
      "LICENSE_ISSUE",
      "LICENSE_RENEW",
      "LICENSE_SUSPEND",
      "LICENSE_REACTIVATE",
      "LICENSE_RESTRICT",
      "LICENSE_REVOKE",
      "LICENSE_TERMINATE",
      "LICENSE_CHANGE_PLAN",
      "LICENSE_GRANT_GRACE",
    ]);
  });
});
