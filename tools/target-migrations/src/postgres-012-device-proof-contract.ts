import type { MigrationDescriptor } from "./contract.js";

export const DEVICE_PROOF_012_TABLES = ["identity.device_request_proof_replays"] as const;
export const DEVICE_PROOF_012_COLUMNS = [
  "credential_id", "nonce_sha256", "request_id", "correlation_id", "signed_at", "consumed_at",
] as const;

export const POSTGRES_012_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "012_device_request_proof_replays",
  manifestVersion: 1,
  dependencies: ["011_session_assertion_sequences"],
  upArtifact: "postgres/012_device_request_proof_replays.up.sql",
  downArtifact: "postgres/012_device_request_proof_replays.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["identity"],
  ownedTables: DEVICE_PROOF_012_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
