import type { MigrationDescriptor } from "./contract.js";

export const PASSWORD_RECOVERY_007_TABLES = ["identity.password_recovery_requests"] as const;

export const POSTGRES_007_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "007_password_recovery",
  manifestVersion: 1,
  dependencies: ["006_licensing_foundation"],
  upArtifact: "postgres/007_password_recovery.up.sql",
  downArtifact: "postgres/007_password_recovery.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["identity"],
  ownedTables: PASSWORD_RECOVERY_007_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};