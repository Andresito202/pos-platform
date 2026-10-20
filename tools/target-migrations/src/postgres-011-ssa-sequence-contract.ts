import type { MigrationDescriptor } from "./contract.js";

/** Central SSA issuer watermark; not a session and not an authorization grant. */
export const POSTGRES_011_SSA_SEQUENCE_TABLES = ["identity.session_assertion_sequences"] as const;
export const POSTGRES_011_SSA_SEQUENCE_COLUMNS = [
  "user_id", "installation_id", "device_id", "last_issued_sequence", "created_at", "updated_at",
] as const;

export const POSTGRES_011_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "011_session_assertion_sequences",
  manifestVersion: 1,
  dependencies: ["004_device_trust", "010_webauthn_credential_material"],
  upArtifact: "postgres/011_session_assertion_sequences.up.sql",
  downArtifact: "postgres/011_session_assertion_sequences.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["identity"],
  ownedTables: POSTGRES_011_SSA_SEQUENCE_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
