import type { MigrationDescriptor } from "./contract.js";

export const DOMAIN_PROJECTIONS_028_TABLES = ["sync.domain_projections"] as const;

export const POSTGRES_028_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "028_sync_domain_projections",
  manifestVersion: 1,
  dependencies: ["027_merchant_notice_revocation_guard"],
  upArtifact: "postgres/028_sync_domain_projections.up.sql",
  downArtifact: "postgres/028_sync_domain_projections.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["sync"],
  ownedTables: DOMAIN_PROJECTIONS_028_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
