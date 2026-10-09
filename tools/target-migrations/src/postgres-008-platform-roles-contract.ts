import type { MigrationDescriptor } from "./contract.js";

export const PLATFORM_ROLE_008_TABLES = ["authorization.platform_role_assignments"] as const;

export const PLATFORM_ROLE_008_COLUMNS = [
  "id", "user_id", "role_id", "role_scope_type", "status", "valid_from", "valid_until",
  "created_at", "created_by_actor_type", "created_by_actor_id", "revoked_at",
  "revoked_by_actor_type", "revoked_by_actor_id", "revocation_reason", "version",
] as const;

export const POSTGRES_008_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "008_platform_role_assignments",
  manifestVersion: 1,
  dependencies: ["007_password_recovery"],
  upArtifact: "postgres/008_platform_role_assignments.up.sql",
  downArtifact: "postgres/008_platform_role_assignments.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["authorization"],
  ownedTables: PLATFORM_ROLE_008_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
