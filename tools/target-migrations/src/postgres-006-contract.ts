import type { MigrationDescriptor } from "./contract.js";
import { POSTGRES_005_DESCRIPTOR } from "./postgres-005-contract.js";

/** `DEC-026` §13.10: fuente monótona de `sequence` para SSA y SAS (`DEC-011`). */
export const SESSION_TRUST_006_SEQUENCE = "identity.session_trust_sequence" as const;

export const POSTGRES_006_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "006_session_trust_sequence",
  manifestVersion: 1,
  dependencies: [POSTGRES_005_DESCRIPTOR.migrationId],
  upArtifact: "postgres/006_session_trust_sequence.up.sql",
  downArtifact: "postgres/006_session_trust_sequence.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: [],
  ownedTables: [],
  ownedPolicies: [],
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
