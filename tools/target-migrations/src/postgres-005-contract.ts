import type { MigrationDescriptor } from "./contract.js";

export const POSTGRES_005_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "005_onboarding_bootstrap_hardening",
  manifestVersion: 1,
  dependencies: ["004_device_trust"],
  upArtifact: "postgres/005_onboarding_bootstrap_hardening.up.sql",
  downArtifact: "postgres/005_onboarding_bootstrap_hardening.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: [],
  ownedTables: [],
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
