import type { MigrationDescriptor } from "./contract.js";

export const LICENSING_006_TABLES = [
  "licensing.plans",
  "licensing.plan_entitlements",
  "licensing.licenses",
  "licensing.license_entitlements",
] as const;

export const POSTGRES_006_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "006_licensing_foundation",
  manifestVersion: 1,
  dependencies: ["005_onboarding_bootstrap_hardening"],
  upArtifact: "postgres/006_licensing_foundation.up.sql",
  downArtifact: "postgres/006_licensing_foundation.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["licensing"],
  ownedTables: LICENSING_006_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
