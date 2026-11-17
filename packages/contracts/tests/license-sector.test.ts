import { describe, expect, it } from "vitest";
import {
  CASH_REGISTER_ENTITLEMENT,
  LicenseSectorEntitlement,
  isLicenseSectorEntitlement,
  normalizePlanEntitlementCodes,
} from "../src/license-sector.js";

describe("license sector entitlements", () => {
  it("recognizes the three independent sector modules", () => {
    expect(isLicenseSectorEntitlement(LicenseSectorEntitlement.SALSAMENTARIA)).toBe(true);
    expect(isLicenseSectorEntitlement(LicenseSectorEntitlement.FARMACIA)).toBe(true);
    expect(isLicenseSectorEntitlement(LicenseSectorEntitlement.PASTELERIA)).toBe(true);
    expect(isLicenseSectorEntitlement("CASH_REGISTER")).toBe(false);
    expect(isLicenseSectorEntitlement("SECTOR_OTHER")).toBe(false);
  });

  it("requires cash register and accepts independent sector combinations", () => {
    expect(normalizePlanEntitlementCodes([CASH_REGISTER_ENTITLEMENT])).toEqual(["CASH_REGISTER"]);
    expect(normalizePlanEntitlementCodes([
      LicenseSectorEntitlement.FARMACIA,
      CASH_REGISTER_ENTITLEMENT,
      LicenseSectorEntitlement.SALSAMENTARIA,
    ])).toEqual([
      "CASH_REGISTER",
      LicenseSectorEntitlement.FARMACIA,
      LicenseSectorEntitlement.SALSAMENTARIA,
    ]);
    expect(() => normalizePlanEntitlementCodes([LicenseSectorEntitlement.PASTELERIA]))
      .toThrow("LICENSE_CASH_REGISTER_ENTITLEMENT_REQUIRED");
    expect(() => normalizePlanEntitlementCodes([CASH_REGISTER_ENTITLEMENT, "SECTOR_OTHER"]))
      .toThrow("LICENSE_ENTITLEMENT_CODE_REJECTED");
  });
});
