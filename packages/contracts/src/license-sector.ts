import * as z from "zod";

/**
 * Sector modules projected through signed license capacity entitlements.
 * Not a parallel licensing system — codes travel in
 * `CAMACHO_LICENSE_CAPACITY_V2.claims.entitlements` alongside `CASH_REGISTER`.
 */
export const LicenseSectorEntitlement = {
  SALSAMENTARIA: "SECTOR_SALSAMENTARIA",
  FARMACIA: "SECTOR_FARMACIA",
  PASTELERIA: "SECTOR_PASTELERIA",
} as const;

export const LicenseSectorEntitlementCodeSchema = z.enum([
  LicenseSectorEntitlement.SALSAMENTARIA,
  LicenseSectorEntitlement.FARMACIA,
  LicenseSectorEntitlement.PASTELERIA,
]);

export type LicenseSectorEntitlementCode = z.infer<typeof LicenseSectorEntitlementCodeSchema>;

export const CASH_REGISTER_ENTITLEMENT = "CASH_REGISTER" as const;

/** Sector codes that may appear in local signed capacity when contracted. */
export const LICENSE_SECTOR_OFFLINE_CAPABILITIES = [
  LicenseSectorEntitlement.SALSAMENTARIA,
  LicenseSectorEntitlement.FARMACIA,
  LicenseSectorEntitlement.PASTELERIA,
] as const;

export function isLicenseSectorEntitlement(code: string): code is LicenseSectorEntitlementCode {
  return LicenseSectorEntitlementCodeSchema.safeParse(code).success;
}

/**
 * Plan entitlement catalog for GLOBAL draft administration.
 * Always requires cash register; sectors are optional and independent.
 */
export function normalizePlanEntitlementCodes(codes: readonly string[]): string[] {
  const unique = [...new Set(codes)];
  if (!unique.includes(CASH_REGISTER_ENTITLEMENT)) {
    throw new Error("LICENSE_CASH_REGISTER_ENTITLEMENT_REQUIRED");
  }
  for (const code of unique) {
    if (code !== CASH_REGISTER_ENTITLEMENT && !isLicenseSectorEntitlement(code)) {
      throw new Error("LICENSE_ENTITLEMENT_CODE_REJECTED");
    }
  }
  return unique.slice().sort();
}
