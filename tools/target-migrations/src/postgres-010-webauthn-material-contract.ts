import type { MigrationDescriptor } from "./contract.js";

/** One-to-one material companion of identity.mfa_factors (NOT another factor). */
export const WEBAUTHN_010_TABLES = ["identity.webauthn_credential_material"] as const;
export const WEBAUTHN_010_COLUMNS = [
  "id", "factor_id", "credential_id", "public_key_cose_base64url",
  "counter", "backup_eligible", "backed_up", "created_at", "last_used_at", "version",
] as const;

export const POSTGRES_010_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "010_webauthn_credential_material",
  manifestVersion: 1,
  dependencies: ["009_webauthn_challenges"],
  upArtifact: "postgres/010_webauthn_credential_material.up.sql",
  downArtifact: "postgres/010_webauthn_credential_material.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["identity"],
  ownedTables: WEBAUTHN_010_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
