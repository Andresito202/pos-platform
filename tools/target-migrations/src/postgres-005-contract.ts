import type { MigrationDescriptor } from "./contract.js";
import { POSTGRES_004_DESCRIPTOR } from "./postgres-004-contract.js";

/** `DEC-026` §13.3–§13.4: brechas `G-1`–`G-6` entre la 001 y la política de login. */
export const IDENTITY_LOGIN_005_TABLES = [
  "identity.user_login_names",
  "identity.mfa_recovery_codes",
] as const;

/** Columnas que la 005 añade o crea; el runner las exige tras aplicar. */
export const IDENTITY_LOGIN_005_COLUMNS = {
  "identity.user_login_names": ["id","tenant_id","tenant_membership_id","user_id","login_name","login_name_normalized","status","created_at","retired_at","version"],
  "identity.mfa_recovery_codes": ["id","user_id","batch_id","code_hash","status","created_at","consumed_at","revoked_at","version"],
  "identity.user_credentials": ["must_change_at_next_login","last_failed_at"],
} as const;

/** Restricciones de la 001 que la 005 sustituye; el runner exige que ya no estén. */
export const IDENTITY_LOGIN_005_REPLACED_CONSTRAINTS = [
  "sessions_device_deferred_ck",
  "security_events_device_deferred_ck",
] as const;

export const POSTGRES_005_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "005_identity_login",
  manifestVersion: 1,
  dependencies: [POSTGRES_004_DESCRIPTOR.migrationId],
  upArtifact: "postgres/005_identity_login.up.sql",
  downArtifact: "postgres/005_identity_login.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: [],
  ownedTables: IDENTITY_LOGIN_005_TABLES,
  ownedPolicies: [],
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
